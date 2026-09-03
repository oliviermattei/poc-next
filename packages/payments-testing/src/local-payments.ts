import { createStripePayments } from '@repo/adapter-stripe'
import type {
  CheckoutMode,
  CreateCheckoutInput,
  CreateCheckoutResult,
  CreatePortalSessionInput,
  CreatePortalSessionResult,
  ListPurchasesInput,
  ListPurchasesResult,
  ListSubscriptionsInput,
  ListSubscriptionsResult,
  PaymentPurchase,
  Payments,
  UpdateSubscriptionQuantityInput,
  UpdateSubscriptionQuantityResult,
  VerifyWebhookInput,
  VerifyWebhookResult,
} from '@repo/ports'
import Stripe from 'stripe'

/**
 * **Le mode local du port `Payments` — un outil, pas un fournisseur** (ADR 008).
 *
 * Il n'appelle aucun service : il simule ce que le fournisseur ferait, pour
 * qu'un développeur sans clé puisse dérouler le parcours complet
 * (`docs/reliability.md` §2). Il est **choisi par un drapeau explicite**
 * (`PAYMENTS_LOCAL_MODE=1`), jamais déduit de `NODE_ENV` ni de l'absence de
 * clé, et `apps/web/lib/billing-config.ts` refuse de démarrer sous
 * `NODE_ENV=production` s'il est posé.
 *
 * **Ce qu'il ne réimplémente pas.** La vérification de signature et la
 * normalisation des objets appartiennent à l'unique adaptateur : ce fichier lui
 * délègue `verifyWebhook`. C'est ce qui rend la simulation utile — les charges
 * utiles qu'elle produit traversent exactement le code qui traitera celles du
 * vrai fournisseur. Une seconde normalisation serait une seconde vérité, et la
 * première à diverger serait celle qu'aucun parcours n'exerce.
 *
 * **Ce qu'il ne simule pas**, et c'est écrit plutôt que sous-entendu : le
 * changement d'offre et l'annulation depuis le portail, l'échec de paiement, la
 * fin de période réelle, le **remboursement** d'un achat unique et le **montant
 * prélevé** — le port ne transporte aucun prix, délibérément. Le portail local
 * ramène simplement dans l'application. Ces états-là s'éprouvent par rejeu
 * d'événements enregistrés (`tests/billing.test.ts`), pas au navigateur.
 *
 * **L'état vit en mémoire du processus** : redémarrer le serveur oublie les
 * sessions ouvertes. C'est un simulateur, pas une base.
 */

/** Le chemin, servi par l'application, où mène un checkout local. */
export const LOCAL_CHECKOUT_PATH = '/api/billing-local-checkout'

/**
 * Le préfixe d'une référence de périmètre **invité** (s24, ADR 047).
 *
 * Recopié plutôt qu'importé : ce paquet n'est pas un module et ne dépend
 * d'aucun. La forme est celle de `guestScopeReference`
 * (`packages/modules/billing/src/domain/guest.ts`), et `tests/billing.test.ts`
 * — le seul fichier qui voie les deux — compare les deux écritures.
 */
const GUEST_REFERENCE_PREFIX = 'guest:'

/** Une livraison de webhook, telle que la route la recevrait du fournisseur. */
export interface LocalWebhookDelivery {
  readonly payload: string
  readonly signature: string
}

export interface LocalPayments extends Payments {
  /**
   * Termine une session locale et rend les livraisons à jouer, **dans l'ordre
   * où le simulateur les envoie** — c'est-à-dire dans le désordre (ADR 034).
   *
   * `reference` est le périmètre de l'appelant, et il est **obligatoire** :
   * l'identifiant d'une session locale est déterministe, donc devinable, et une
   * session ne se termine que pour le périmètre qui l'a ouverte. Un paramètre
   * facultatif se serait oublié en silence au point d'appel.
   *
   * Rend une liste vide pour une session inconnue **ou pour un autre
   * périmètre** : un simulateur ne lève pas plus qu'un port.
   */
  completeCheckout(sessionId: string, reference: string): readonly LocalWebhookDelivery[]

  /**
   * Termine une session **invitée** (s24) et rend ses livraisons.
   *
   * Distincte de `completeCheckout`, et la distinction est la garde : celle-ci
   * ne termine que les sessions dont la référence est un périmètre invité, et
   * l'autre ne termine que celles d'un périmètre de compte —
   * `billingScopeReference` ne produit jamais de référence `guest:`. Aucune des
   * deux ne peut donc servir à terminer la session de l'autre.
   *
   * `email` tient la place de l'adresse que la page hébergée du fournisseur
   * aurait collectée. Le simulateur n'en invente pas la valeur : elle est
   * décidée par l'appelant, comme le visiteur la déciderait.
   *
   * Rend une liste vide pour une session inconnue **ou** pour une session qui
   * n'est pas invitée.
   */
  completeGuestCheckout(sessionId: string, email: string): readonly LocalWebhookDelivery[]
}

export interface LocalPaymentsOptions {
  /** L'URL publique de l'application : c'est elle qui sert le checkout simulé. */
  readonly appUrl: string
  /** Le secret qui signe les événements simulés. Il n'ouvre rien d'autre. */
  readonly webhookSecret: string
  /** Injectée : une simulation qui lit l'horloge n'est pas reproductible. */
  readonly now?: () => Date
}

interface PendingSession {
  readonly id: string
  readonly customerId: string
  readonly priceId: string
  readonly quantity: number
  readonly reference: string
  readonly trialPeriodDays: number | null
  /** `subscription` ou `payment` : les deux ne produisent pas les mêmes événements. */
  readonly mode: CheckoutMode
}

/** Trente jours : la période simulée d'un abonnement local. */
const PERIOD_DAYS = 30
const DAY_MS = 86_400_000

/**
 * Un identifiant de client **déterministe**, dérivé du périmètre.
 *
 * Deux ouvertures de checkout pour le même propriétaire doivent rendre le même
 * client : c'est la propriété qui empêche la simulation de fabriquer un second
 * client à chaque essai, comme la clé d'idempotence le fait chez le vrai
 * fournisseur.
 */
const customerIdFor = (reference: string): string =>
  `cus_local_${[...reference].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) % 1_000_000_007, 7).toString(36)}`

const seconds = (date: Date): number => Math.floor(date.getTime() / 1000)

export function createLocalPayments(options: LocalPaymentsOptions): LocalPayments {
  const now = options.now ?? (() => new Date())
  const sessions = new Map<string, PendingSession>()
  const subscriptions = new Map<string, Record<string, unknown>>()
  /** Les achats uniques terminés, pour la lecture de réconciliation. */
  const purchases = new Map<string, PaymentPurchase>()

  /**
   * La vérification et la normalisation sont **celles de l'adaptateur**.
   *
   * Le `fetch` injecté lève si on l'appelle : `verifyWebhook` ne touche pas au
   * réseau, et si une évolution l'y amenait un jour, le mode local le dirait
   * bruyamment au lieu de tenter une connexion sortante.
   */
  const verifier = createStripePayments({
    apiKey: 'sk_test_local_mode_never_calls_the_network',
    webhookSecret: options.webhookSecret,
    fetch: () => {
      throw new Error('Le mode local n’appelle aucun service : aucune requête sortante n’est permise.')
    },
    timeoutMs: 1,
    maxAttempts: 1,
    backoff: { baseMs: 1, maxMs: 1, random: () => 0 },
    sleep: async () => {},
  })

  /**
   * Signe une charge utile — **avec l'horloge réelle, jamais l'injectée**.
   *
   * Les deux horodatages d'un webhook ne disent pas la même chose :
   *
   * - `created`, dans la charge utile, est une donnée du **domaine** : c'est lui
   *   qui ordonne deux événements (ADR 034), et une simulation reproductible
   *   doit pouvoir le fixer ;
   * - celui de l'en-tête de signature est une donnée de **transport** : le
   *   fournisseur refuse un rejeu hors de sa fenêtre de tolérance, qui est de
   *   300 secondes (`Stripe.webhooks.DEFAULT_TOLERANCE`, mesuré).
   *
   * Les confondre rendait la simulation vérifiable le jour où l'horloge
   * injectée était écrite, et invérifiable le lendemain. Mesuré : cinq cas de
   * `payments-testing.test.ts` sont passés au rouge tout seuls, un jour après
   * avoir été écrits verts.
   */
  const sign = (event: Record<string, unknown>): LocalWebhookDelivery => {
    const payload = JSON.stringify(event)

    return {
      payload,
      signature: Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: options.webhookSecret,
      }),
    }
  }

  /**
   * Termine un **achat unique** : un seul événement, et il suffit.
   *
   * Contrairement à l'abonnement, il n'y a pas de second objet à décrire — pas
   * d'objet `Subscription`, donc pas de désordre à simuler. Ce que ce parcours
   * exerce est la promotion de la ligne écrite à l'ouverture du checkout
   * (ADR 038 §1), à travers la vraie route de webhook.
   *
   * `amount_total` reste **absent** : le port ne transporte aucun montant, et
   * la simulation n'en invente pas. L'historique affichera donc l'achat sans
   * son prix, ce qui est la vérité de ce qu'on sait ici.
   */
  const completePurchase = (
    session: PendingSession,
    email: string | null,
  ): LocalWebhookDelivery => {
    const paymentId = `pi_local_${session.id}`

    purchases.set(session.id, {
      sessionId: session.id,
      paymentId,
      paid: true,
      amountTotal: null,
      currency: null,
      amountRefunded: 0,
      chargedAmount: null,
    })

    return sign({
      id: `evt_local_purchase_${session.id}`,
      object: 'event',
      api_version: null,
      created: seconds(now()),
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      type: 'checkout.session.completed',
      data: {
        object: {
          id: session.id,
          object: 'checkout.session',
          mode: 'payment',
          payment_status: 'paid',
          customer: session.customerId,
          payment_intent: paymentId,
          client_reference_id: session.reference,
          // Ce que la page hébergée du fournisseur aurait collecté. Absent pour
          // un checkout authentifié : nous connaissions déjà l'adresse.
          ...(email === null ? {} : { customer_details: { email } }),
        },
      },
    })
  }


  /**
   * Termine une session, quelle que soit sa nature.
   *
   * `email` n'est posé que pour un checkout **invité** : c'est la seule chose
   * qu'une page hébergée collecte et que nous ne connaissions pas.
   */
  const complete = (session: PendingSession, email: string | null): readonly LocalWebhookDelivery[] => {
    if (session.mode === 'payment') {
      return [completePurchase(session, email)]
    }

      const trial = session.trialPeriodDays
      const start = now()
      const trialEnd = trial === null ? null : new Date(start.getTime() + trial * DAY_MS)
      const periodEnd = new Date((trialEnd ?? start).getTime() + PERIOD_DAYS * DAY_MS)
      const subscriptionId = `sub_local_${session.customerId}`

      const subscription: Record<string, unknown> = {
        id: subscriptionId,
        object: 'subscription',
        customer: session.customerId,
        status: trial === null ? 'active' : 'trialing',
        cancel_at_period_end: false,
        trial_end: trialEnd === null ? null : seconds(trialEnd),
        items: {
          object: 'list',
          data: [
            {
              id: `si_local_${session.customerId}`,
              object: 'subscription_item',
              quantity: session.quantity,
              current_period_start: seconds(start),
              current_period_end: seconds(periodEnd),
              price: { id: session.priceId, object: 'price' },
            },
          ],
        },
      }

      subscriptions.set(subscriptionId, subscription)

      const created = seconds(start)

      // **Volontairement dans le désordre** : le changement d'abonnement part
      // avant la session qui l'a causé. C'est ce que le fournisseur peut faire,
      // et ADR 034 dit pourquoi cela n'a plus d'importance ici.
      return [
        sign({
          id: `evt_local_sub_${session.id}`,
          object: 'event',
          api_version: null,
          created: created + 1,
          livemode: false,
          pending_webhooks: 0,
          request: { id: null, idempotency_key: null },
          type: 'customer.subscription.created',
          data: { object: subscription },
        }),
        sign({
          id: `evt_local_checkout_${session.id}`,
          object: 'event',
          api_version: null,
          created,
          livemode: false,
          pending_webhooks: 0,
          request: { id: null, idempotency_key: null },
          type: 'checkout.session.completed',
          data: {
            object: {
              id: session.id,
              object: 'checkout.session',
              mode: 'subscription',
              customer: session.customerId,
              subscription: subscriptionId,
              client_reference_id: session.reference,
              // Ce que la page hébergée du fournisseur aurait collecté (s24).
              ...(email === null ? {} : { customer_details: { email } }),
            },
          },
        }),
      ]
  }

  return {
    createCheckout: async (input: CreateCheckoutInput): Promise<CreateCheckoutResult> => {
      const customerId = input.customerId ?? customerIdFor(input.reference)
      const id = `cs_local_${customerId}_${input.priceId}`

      sessions.set(id, {
        id,
        customerId,
        priceId: input.priceId,
        quantity: input.quantity,
        reference: input.reference,
        trialPeriodDays: input.trialPeriodDays,
        mode: input.mode,
      })

      const url = new URL(`${options.appUrl}${LOCAL_CHECKOUT_PATH}`)

      url.searchParams.set('session', id)

      return { ok: true, checkout: { url: url.toString(), customerId, sessionId: id } }
    },

    createPortalSession: async (
      input: CreatePortalSessionInput,
    ): Promise<CreatePortalSessionResult> => {
      const url = new URL(input.returnUrl)

      url.searchParams.set('portal', 'local')

      return { ok: true, session: { url: url.toString() } }
    },

    verifyWebhook: async (input: VerifyWebhookInput): Promise<VerifyWebhookResult> =>
      await verifier.verifyWebhook(input),

    listSubscriptions: async (input: ListSubscriptionsInput): Promise<ListSubscriptionsResult> => {
      const owned = [...subscriptions.values()].filter(
        (subscription) => subscription['customer'] === input.customerId,
      )

      if (owned.length === 0) {
        return { ok: true, subscriptions: [] }
      }

      // La même normalisation que partout : la simulation ne produit pas une
      // forme à elle. Elle passe par le lecteur de l'adaptateur, en rejouant un
      // événement plutôt qu'en appelant le réseau.
      const read = await Promise.all(
        owned.map(async (subscription) =>
          await verifier.verifyWebhook(
            sign({
              id: `evt_local_read_${String(subscription['id'])}`,
              object: 'event',
              api_version: null,
              created: seconds(now()),
              livemode: false,
              pending_webhooks: 0,
              request: { id: null, idempotency_key: null },
              type: 'customer.subscription.updated',
              data: { object: subscription },
            }),
          ),
        ),
      )

      return {
        ok: true,
        subscriptions: read.flatMap((entry) =>
          entry.ok && entry.event.kind === 'subscription_changed' ? [entry.event.subscription] : [],
        ),
      }
    },

    /**
     * **La seule écriture de la simulation** (s23, ADR 046).
     *
     * Elle mémorise la quantité **visée** sur l'abonnement simulé, sans le
     * moindre appel sortant — le `fetch` injecté du vérificateur lève, ce qui
     * rendrait bruyante toute tentative. Un rejeu de la même cible converge :
     * c'est une affectation, jamais un incrément, et c'est exactement ce que la
     * clé d'idempotence garantit chez le vrai fournisseur.
     *
     * Abonnement inconnu : un échec, jamais une exception — un simulateur ne
     * lève pas plus qu'un port.
     */
    updateSubscriptionQuantity: async (
      input: UpdateSubscriptionQuantityInput,
    ): Promise<UpdateSubscriptionQuantityResult> => {
      const subscription = subscriptions.get(input.subscriptionId)

      if (subscription === undefined) {
        return {
          ok: false,
          error: {
            code: 'not_found',
            message: 'aucun abonnement simulé ne porte cet identifiant',
            attempts: 1,
          },
        }
      }

      const items = (subscription['items'] as { data?: Record<string, unknown>[] }).data ?? []

      for (const item of items) {
        item['quantity'] = input.quantity
      }

      // La normalisation est **celle de l'adaptateur**, comme partout ici : la
      // simulation ne produit pas une forme à elle.
      const read = await verifier.verifyWebhook(
        sign({
          id: `evt_local_seats_${input.subscriptionId}_${input.quantity}`,
          object: 'event',
          api_version: null,
          created: seconds(now()),
          livemode: false,
          pending_webhooks: 0,
          request: { id: null, idempotency_key: input.idempotencyKey },
          type: 'customer.subscription.updated',
          data: { object: subscription },
        }),
      )

      return read.ok && read.event.kind === 'subscription_changed'
        ? { ok: true, subscription: read.event.subscription }
        : {
            ok: false,
            error: { code: 'invalid_request', message: 'abonnement illisible', attempts: 1 },
          }
    },

    /**
     * La lecture des achats uniques, pour la réconciliation.
     *
     * Elle ne rend **aucun montant** : le port `Payments` ne transporte pas de
     * prix, délibérément (un port qui porterait un montant inviterait
     * quelqu'un à le lui passer depuis un navigateur), et la simulation n'en
     * invente pas. Ce que la réconciliation locale corrige est donc l'état, pas
     * la somme.
     */
    listPurchases: async (input: ListPurchasesInput): Promise<ListPurchasesResult> => ({
      ok: true,
      purchases: [...purchases.entries()]
        .filter(([sessionId]) => sessions.get(sessionId)?.customerId === input.customerId)
        .map(([, purchase]) => purchase),
    }),

    completeCheckout: (sessionId, reference) => {
      const session = sessions.get(sessionId)

      // Session inconnue **ou** ouverte par un autre périmètre : rien. Les deux
      // refus sont indiscernables, et c'est voulu — distinguer dirait à un
      // visiteur qu'une session existe pour quelqu'un d'autre.
      if (session === undefined || session.reference !== reference) {
        return []
      }

      return complete(session, null)
    },

    completeGuestCheckout: (sessionId, email) => {
      const session = sessions.get(sessionId)

      // Session inconnue **ou** session d'un compte : rien, et les deux refus
      // sont indiscernables.
      if (session === undefined || !session.reference.startsWith(GUEST_REFERENCE_PREFIX)) {
        return []
      }

      return complete(session, email)
    },
  }
}
