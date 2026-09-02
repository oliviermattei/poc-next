import { createStripePayments } from '@repo/adapter-stripe'
import type {
  CreateCheckoutInput,
  CreateCheckoutResult,
  CreatePortalSessionInput,
  CreatePortalSessionResult,
  ListSubscriptionsInput,
  ListSubscriptionsResult,
  Payments,
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
 * fin de période réelle. Le portail local ramène simplement dans l'application.
 * Ces états-là s'éprouvent par rejeu d'événements enregistrés
 * (`tests/billing.test.ts`), pas au navigateur.
 *
 * **L'état vit en mémoire du processus** : redémarrer le serveur oublie les
 * sessions ouvertes. C'est un simulateur, pas une base.
 */

/** Le chemin, servi par l'application, où mène un checkout local. */
export const LOCAL_CHECKOUT_PATH = '/api/billing-local-checkout'

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
      })

      const url = new URL(`${options.appUrl}${LOCAL_CHECKOUT_PATH}`)

      url.searchParams.set('session', id)

      return { ok: true, checkout: { url: url.toString(), customerId } }
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

    completeCheckout: (sessionId, reference) => {
      const session = sessions.get(sessionId)

      // Session inconnue **ou** ouverte par un autre périmètre : rien. Les deux
      // refus sont indiscernables, et c'est voulu — distinguer dirait à un
      // visiteur qu'une session existe pour quelqu'un d'autre.
      if (session === undefined || session.reference !== reference) {
        return []
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
          id: `evt_local_sub_${sessionId}`,
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
          id: `evt_local_checkout_${sessionId}`,
          object: 'event',
          api_version: null,
          created,
          livemode: false,
          pending_webhooks: 0,
          request: { id: null, idempotency_key: null },
          type: 'checkout.session.completed',
          data: {
            object: {
              id: sessionId,
              object: 'checkout.session',
              mode: 'subscription',
              customer: session.customerId,
              subscription: subscriptionId,
              client_reference_id: session.reference,
            },
          },
        }),
      ]
    },
  }
}
