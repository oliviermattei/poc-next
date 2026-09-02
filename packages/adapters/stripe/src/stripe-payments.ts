import type {
  CreateCheckoutInput,
  CreateCheckoutResult,
  CreatePortalSessionResult,
  ListPurchasesInput,
  ListPurchasesResult,
  ListSubscriptionsInput,
  ListSubscriptionsResult,
  PaymentEvent,
  PaymentPurchase,
  Payments,
  PaymentsError,
  PaymentsErrorCode,
  PaymentsLogger,
  PaymentsOperation,
  PaymentStatus,
  PaymentSubscription,
  VerifyWebhookInput,
  VerifyWebhookResult,
} from '@repo/ports'
import Stripe from 'stripe'

import {
  backoffDelayMs,
  classifyStripeError,
  isTransientPaymentsError,
  sanitize,
  type BackoffPolicy,
} from './retry'

/**
 * **L'unique implémentation livrée du port `Payments`** (ADR 008). Il n'y en
 * aura pas de seconde : LemonSqueezy, Polar, Creem et Dodo sont au cimetière du
 * PRD. Les doublures de `@repo/payments-testing` sont des outils de test.
 *
 * Tout est **injecté** — la fonction `fetch`, le délai, la politique de recul,
 * le sommeil, le journal —, ce qui rend cet adaptateur constructible dans un
 * test sans réseau et sans environnement. Il ne lit ni `process.env`, ni
 * `NODE_ENV` : un fournisseur choisi par l'environnement est intestable et se
 * trompera un jour d'environnement.
 *
 * Aucune méthode ne rejette : l'échec est une valeur (`docs/reliability.md` §2).
 */

/**
 * La version d'API, **posée** et jamais laissée au défaut du compte.
 *
 * Les types de `stripe@22.6.0` ne décrivent que celle-ci. La laisser au compte
 * ferait recevoir des objets d'une autre forme sans qu'aucune commande ne le
 * dise — et c'est exactement le champ que la recherche a trouvé déplacé
 * (`current_period_end`, §2.2).
 */
const API_VERSION = '2026-08-26.dahlia'

/** Le maximum que le fournisseur accepte par page. */
const PAGE_SIZE = 100

/**
 * Le plafond de pages d'une lecture de réconciliation — **dix mille
 * abonnements pour un client**.
 *
 * Une boucle de pagination sans borne est une série d'appels sortants sans
 * borne (`docs/reliability.md` §3) : un `has_more` qui resterait vrai
 * bloquerait la commande pour toujours.
 */
const MAX_LIST_PAGES = 100

export interface StripePaymentsOptions {
  readonly apiKey: string
  readonly webhookSecret: string
  /** La sortie réseau, injectée : c'est elle qu'un test remplace, jamais le SDK. */
  readonly fetch: typeof fetch
  /** `docs/reliability.md` §3 : aucun appel sans délai. Le défaut du SDK est 80 s. */
  readonly timeoutMs: number
  /** Tentatives **au total**, reprises comprises. */
  readonly maxAttempts: number
  readonly backoff: BackoffPolicy
  readonly sleep: (ms: number) => Promise<void>
  readonly log?: PaymentsLogger
}

const failure = (
  code: PaymentsErrorCode,
  message: string,
  attempts: number,
): PaymentsError => ({ code, message: sanitize(message), attempts })

/* -------------------------------------------------------------------------- *
 * Normalisation des objets du fournisseur
 * -------------------------------------------------------------------------- */

/**
 * Les statuts du fournisseur, ramenés à l'union fermée du port.
 *
 * `OtherString` est dans le type du SDK : la valeur inconnue **existe**. Elle
 * retombe sur `incomplete`, qui n'accorde aucun accès — un défaut se ferme, il
 * ne s'ouvre pas.
 */
const STATUS: Readonly<Record<string, PaymentStatus>> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  unpaid: 'past_due',
  canceled: 'canceled',
  incomplete: 'incomplete',
  incomplete_expired: 'canceled',
  paused: 'paused',
}

class NormalisationError extends Error {}

const asId = (value: unknown): string | null => {
  if (typeof value === 'string' && value !== '') {
    return value
  }

  if (typeof value === 'object' && value !== null && 'id' in value) {
    const id = (value as { id?: unknown }).id

    return typeof id === 'string' && id !== '' ? id : null
  }

  return null
}

const secondsToDate = (value: unknown): Date | null =>
  typeof value === 'number' && Number.isFinite(value) ? new Date(value * 1000) : null

interface SubscriptionItemShape {
  readonly quantity?: unknown
  readonly current_period_end?: unknown
  readonly price?: unknown
}

/**
 * L'abonnement, normalisé — **et le champ le plus dangereux du dépôt**.
 *
 * `current_period_end` ne vit plus sur l'abonnement depuis la version d'API du
 * paquet installé : il est sur ses **lignes** (recherche §2.2). Le lire sur
 * l'abonnement rendrait `undefined`, donc une date invalide, donc un accès
 * perdu ou éternel selon le sens du repli.
 *
 * Le **maximum** des lignes est retenu : c'est le repli qui n'enlève jamais un
 * accès déjà payé. Un abonnement sans ligne exploitable est refusé plutôt que
 * deviné — Stripe n'en produit pas, une charge utile forgée si.
 */
function normalizeSubscription(raw: unknown): PaymentSubscription {
  if (typeof raw !== 'object' || raw === null) {
    throw new NormalisationError('subscription payload is not an object')
  }

  const object = raw as Record<string, unknown>
  const id = asId(object['id'])
  const customerId = asId(object['customer'])

  if (id === null || customerId === null) {
    throw new NormalisationError('subscription is missing its id or its customer')
  }

  const items = (object['items'] as { data?: unknown } | undefined)?.data

  if (!Array.isArray(items) || items.length === 0) {
    throw new NormalisationError('subscription has no items')
  }

  const first = items[0] as SubscriptionItemShape
  const priceId = asId(first.price)

  if (priceId === null) {
    throw new NormalisationError('subscription item has no price')
  }

  const ends = (items as readonly SubscriptionItemShape[])
    .map((item) => secondsToDate(item.current_period_end))
    .filter((date): date is Date => date !== null)

  if (ends.length === 0) {
    throw new NormalisationError('subscription items carry no current_period_end')
  }

  const status = typeof object['status'] === 'string' ? object['status'] : ''

  return {
    id,
    customerId,
    priceId,
    quantity: typeof first.quantity === 'number' ? first.quantity : 1,
    status: STATUS[status] ?? 'incomplete',
    currentPeriodEnd: new Date(Math.max(...ends.map((date) => date.getTime()))),
    cancelAtPeriodEnd: object['cancel_at_period_end'] === true,
    trialEnd: secondsToDate(object['trial_end']),
  }
}

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * Cette session est-elle un **achat unique encaissé** ? (ADR 038 §1)
 *
 * Les deux unions du fournisseur sont ouvertes — `Mode` et `PaymentStatus`
 * déclarent toutes deux `… | OtherString` (recherche §2.1). Le repli est donc
 * **fermé** : tout ce qui n'est pas exactement `payment` **et** `paid` n'accorde
 * rien. Un paiement différé passe ici en `unpaid`, et c'est
 * `checkout.session.async_payment_succeeded` qui le confirmera plus tard.
 */
const isPaidPurchaseSession = (object: Record<string, unknown>): boolean =>
  object['mode'] === 'payment' && object['payment_status'] === 'paid'

/** Les types d'événement qui décrivent un changement d'abonnement. */
const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.pending_update_applied',
  'customer.subscription.pending_update_expired',
])

/** Les types qui signalent un paiement en échec. */
const PAYMENT_FAILED_EVENTS = new Set(['invoice.payment_failed'])

/**
 * Les types qui confirment un **achat unique** — et il en faut deux.
 *
 * `completed` couvre le paiement immédiat ; `async_payment_succeeded` couvre le
 * paiement différé, qui arrive *après* un `completed` non payé (recherche
 * §2.2). N'écouter que le premier laisserait ces acheteurs sans droit pour
 * toujours.
 */
const PURCHASE_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
])

/**
 * L'événement du fournisseur, ramené à la forme du port.
 *
 * `unhandled` est une **valeur**, pas une absence : un événement qu'on ne traite
 * pas doit quand même être journalisé par son identifiant, sinon un rejeu le
 * fait retraverser toute la chaîne.
 */
function normalizeEvent(event: Stripe.Event): PaymentEvent {
  const id = event.id
  const occurredAt = new Date(event.created * 1000)
  const object = event.data.object as unknown as Record<string, unknown>

  if (PURCHASE_EVENTS.has(event.type) && isPaidPurchaseSession(object)) {
    return {
      kind: 'purchase_paid',
      id,
      occurredAt,
      sessionId: asId(object['id']) ?? '',
      customerId: asId(object['customer']),
      paymentId: asId(object['payment_intent']),
      // **Ce qui a été prélevé**, pas ce que le catalogue affiche : c'est la
      // seule source honnête pour un historique de paiements (ADR 038 §4).
      amountTotal: asNumber(object['amount_total']),
      currency: typeof object['currency'] === 'string' ? object['currency'] : null,
      reference:
        typeof object['client_reference_id'] === 'string' ? object['client_reference_id'] : null,
    }
  }

  if (event.type === 'charge.refunded') {
    const paymentId = asId(object['payment_intent'])
    const amount = asNumber(object['amount'])

    // Un remboursement qu'on ne sait rattacher à aucun paiement est journalisé
    // et n'écrit rien — comme un événement d'abonnement dont le client est
    // inconnu. Inventer un rattachement révoquerait au hasard.
    if (paymentId !== null && amount !== null) {
      return {
        kind: 'purchase_refunded',
        id,
        occurredAt,
        paymentId,
        amount,
        // **Aucune décision ici** (ADR 038 §3) : les deux montants traversent
        // jusqu'au domaine, qui dit ce qu'un remboursement fait perdre.
        amountRefunded: asNumber(object['amount_refunded']) ?? 0,
      }
    }
  }

  // **Le mode départage**, et il est comparé en toutes lettres : `Mode` est une
  // union ouverte chez le fournisseur, et une session qui n'est ni un
  // abonnement ni un achat encaissé n'accorde rien — elle est journalisée comme
  // `unhandled`, donc pas rejouée, et c'est tout.
  if (event.type === 'checkout.session.completed' && object['mode'] === 'subscription') {
    return {
      kind: 'checkout_completed',
      id,
      occurredAt,
      reference: typeof object['client_reference_id'] === 'string' ? object['client_reference_id'] : null,
      customerId: asId(object['customer']),
      subscriptionId: asId(object['subscription']),
    }
  }

  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    return { kind: 'subscription_changed', id, occurredAt, subscription: normalizeSubscription(object) }
  }

  if (PAYMENT_FAILED_EVENTS.has(event.type)) {
    return {
      kind: 'payment_failed',
      id,
      occurredAt,
      customerId: asId(object['customer']),
      subscriptionId: asId(object['subscription']),
    }
  }

  return { kind: 'unhandled', id, occurredAt, type: event.type }
}

/* -------------------------------------------------------------------------- *
 * L'adaptateur
 * -------------------------------------------------------------------------- */

export function createStripePayments(options: StripePaymentsOptions): Payments {
  const client = new Stripe(options.apiKey, {
    apiVersion: API_VERSION,
    // La sortie réseau injectée. Le SDK reste réel : sérialisation, en-têtes et
    // traitement de la réponse sont les siens.
    httpClient: Stripe.createFetchHttpClient(options.fetch),
    // `docs/reliability.md` §3. Le défaut du SDK est de 80 secondes : une
    // requête tiendrait une connexion Next plus d'une minute.
    timeout: options.timeoutMs,
    // **Zéro reprise côté SDK.** La politique du dépôt — recul exponentiel
    // dispersé, plafonné, erreurs transitoires uniquement — est celle de
    // `retry.ts`. Deux politiques superposées multiplieraient les appels sans
    // que personne ne sache combien.
    maxNetworkRetries: 0,
    telemetry: false,
  })

  type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: PaymentsError }

  /**
   * La boucle de reprise, partagée par les quatre opérations.
   *
   * Elle attrape **tout** : une erreur qui n'est pas du fournisseur (un défaut
   * de programmation, un `fetch` qui explose) rend un échec plutôt que de
   * rejeter. Le port promet qu'aucune implémentation ne rejette.
   */
  const run = async <T>(operation: PaymentsOperation, call: () => Promise<T>): Promise<Outcome<T>> => {
    let attempts = 0
    let last: PaymentsError = failure('provider_unavailable', 'aucune tentative', 0)

    while (attempts < options.maxAttempts) {
      attempts += 1

      try {
        return { ok: true, value: await call() }
      } catch (error) {
        const shape = error as { rawType?: string; type?: string; statusCode?: number; detail?: unknown }
        const code = classifyStripeError({
          rawType: typeof shape.rawType === 'string' ? shape.rawType : undefined,
          type: typeof shape.type === 'string' ? shape.type : undefined,
          statusCode: typeof shape.statusCode === 'number' ? shape.statusCode : undefined,
          detail: shape.detail,
        })

        last = failure(code, error instanceof Error ? error.message : 'erreur inconnue', attempts)

        if (!isTransientPaymentsError(code) || attempts >= options.maxAttempts) {
          break
        }

        options.log?.({
          event: 'payments.call_retried',
          operation,
          code,
          attempts,
          message: last.message,
        })

        await options.sleep(backoffDelayMs(attempts, options.backoff))
      }
    }

    options.log?.({
      event: 'payments.call_failed',
      operation,
      code: last.code,
      attempts: last.attempts,
      message: last.message,
    })

    return { ok: false, error: last }
  }

  /**
   * Le client du fournisseur, créé quand il n'existe pas encore.
   *
   * La clé d'idempotence est **dérivée du périmètre**, pas de l'appel : une
   * seconde ouverture de checkout après un échec réutilise le client au lieu
   * d'en créer un second orphelin.
   */
  const ensureCustomer = async (input: CreateCheckoutInput): Promise<Outcome<string>> => {
    if (input.customerId !== null) {
      return { ok: true, value: input.customerId }
    }

    const created = await run('create_checkout', async () =>
      await client.customers.create(
        {
          ...(input.customerEmail === null ? {} : { email: input.customerEmail }),
          metadata: { reference: input.reference },
        },
        { idempotencyKey: `customer:${input.reference}` },
      ),
    )

    return created.ok ? { ok: true, value: created.value.id } : created
  }

  return {
    createCheckout: async (input): Promise<CreateCheckoutResult> => {
      const customer = await ensureCustomer(input)

      if (!customer.ok) {
        return { ok: false, error: customer.error }
      }

      const session = await run('create_checkout', async () =>
        await client.checkout.sessions.create(
          {
            mode: input.mode,
            customer: customer.value,
            line_items: [{ price: input.priceId, quantity: input.quantity }],
            success_url: input.successUrl,
            cancel_url: input.cancelUrl,
            client_reference_id: input.reference,
            ...(input.trialPeriodDays === null
              ? {}
              : { subscription_data: { trial_period_days: input.trialPeriodDays } }),
            // **La facture d'un achat unique est demandée**, celle d'un
            // abonnement ne l'est pas : le fournisseur facture déjà le second,
            // et la lui demander en plus produirait deux factures pour un seul
            // encaissement. Le quatrième critère de s20 exige que les factures
            // restent accessibles ; sans ce paramètre, un paiement hors
            // abonnement n'en produit aucune.
            ...(input.mode === 'payment' ? { invoice_creation: { enabled: true } } : {}),
            ...(input.locale === null ? {} : { locale: input.locale as Stripe.Checkout.SessionCreateParams.Locale }),
          },
          // **Une seule clé pour toutes les tentatives** de cet appel : si la
          // réponse se perd, la reprise ne doit pas ouvrir un second checkout.
          { idempotencyKey: input.idempotencyKey },
        ),
      )

      if (!session.ok) {
        return { ok: false, error: session.error }
      }

      const url = session.value.url

      if (url === null) {
        // `url` est nullable côté fournisseur (checkout intégré). Rendre
        // `{ok:true}` avec une URL absente obligerait chaque appelant à
        // revérifier ce que le type promet déjà.
        return {
          ok: false,
          error: failure('invalid_request', 'la session de paiement n’a pas d’URL hébergée', 1),
        }
      }

      return {
        ok: true,
        // L'identifiant de session est **l'acte d'achat** (ADR 038 §1) :
        // l'appelant l'écrit avant de rendre l'URL, et c'est lui qui rattache
        // l'offre — que la charge utile de confirmation ne porte pas.
        checkout: { url, customerId: customer.value, sessionId: session.value.id },
      }
    },

    createPortalSession: async (input): Promise<CreatePortalSessionResult> => {
      const outcome = await run('create_portal_session', async () =>
        await client.billingPortal.sessions.create({
          customer: input.customerId,
          return_url: input.returnUrl,
        }),
      )

      return outcome.ok
        ? { ok: true, session: { url: outcome.value.url } }
        : { ok: false, error: outcome.error }
    },

    /**
     * **La signature d'abord, tout le reste ensuite** (`docs/security.md` §4).
     *
     * Rien n'est lu de la charge utile avant que `constructEvent` ne l'ait
     * acceptée : c'est le SDK qui parse, après vérification. Aucun réseau, aucun
     * recul — un secret erroné ne devient pas valide en réessayant.
     */
    verifyWebhook: async (input: VerifyWebhookInput): Promise<VerifyWebhookResult> => {
      try {
        const event = Stripe.webhooks.constructEvent(
          input.payload,
          input.signature,
          options.webhookSecret,
        )

        return { ok: true, event: normalizeEvent(event) }
      } catch (error) {
        if (error instanceof NormalisationError) {
          return {
            ok: false,
            error: failure('invalid_request', error.message, 1),
          }
        }

        const shape = error as { type?: string }
        const code = classifyStripeError({
          type: typeof shape.type === 'string' ? shape.type : undefined,
          statusCode: undefined,
        })
        // Une signature invalide est le cas nominal de cette porte ; toute autre
        // exception y devient aussi une valeur, parce que le port ne rejette pas.
        const resolved: PaymentsErrorCode =
          shape.type === 'StripeSignatureVerificationError' ? 'invalid_signature' : code

        options.log?.({
          event: 'payments.call_failed',
          operation: 'verify_webhook',
          code: resolved,
          attempts: 1,
          message: sanitize(error instanceof Error ? error.message : 'erreur inconnue'),
        })

        return {
          ok: false,
          error: failure(resolved, error instanceof Error ? error.message : 'erreur inconnue', 1),
        }
      }
    },

    /**
     * **Toutes les pages, et pas seulement la première.**
     *
     * Le fournisseur en rend cent au plus par appel. S'arrêter là rendait la
     * réconciliation d'un client à l'historique long **partielle et
     * silencieuse** (constat F8 de la revue) — sur la commande dont le rôle est
     * justement de réparer une divergence.
     *
     * La boucle est **plafonnée** : `docs/reliability.md` §3 refuse une série
     * d'appels sortants sans borne, et un `has_more` qui resterait vrai —
     * fournisseur en défaut, curseur mal repris — bloquerait la commande pour
     * toujours. Le plafond atteint, ce qui a été lu est rendu : la
     * réconciliation n'efface jamais, donc une lecture partielle ne coupe
     * personne, et la commande se relance.
     */
    listSubscriptions: async (input: ListSubscriptionsInput): Promise<ListSubscriptionsResult> => {
      const subscriptions: PaymentSubscription[] = []
      let startingAfter: string | undefined

      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const outcome = await run('list_subscriptions', async () =>
          await client.subscriptions.list({
            customer: input.customerId,
            status: 'all',
            limit: PAGE_SIZE,
            ...(startingAfter === undefined ? {} : { starting_after: startingAfter }),
          }),
        )

        if (!outcome.ok) {
          return { ok: false, error: outcome.error }
        }

        try {
          for (const entry of outcome.value.data) {
            subscriptions.push(normalizeSubscription(entry))
          }
        } catch (error) {
          return {
            ok: false,
            error: failure('invalid_request', error instanceof Error ? error.message : 'erreur inconnue', 1),
          }
        }

        const last = outcome.value.data.at(-1)

        if (!outcome.value.has_more || last === undefined) {
          break
        }

        startingAfter = last.id
      }

      return { ok: true, subscriptions }
    },

    /**
     * **Les achats uniques d'un client — deux lectures, et il faut les deux.**
     *
     * La session dit ce qui a été payé ; l'état de **remboursement**, lui,
     * n'est pas sur la session — il est sur la charge (recherche §6). Une
     * réconciliation qui ne lirait que les sessions ne verrait jamais un
     * remboursement dont le webhook s'est perdu, c'est-à-dire un accès qui
     * aurait dû être révoqué.
     *
     * Comme `listSubscriptions`, les deux boucles sont **plafonnées** : une
     * série d'appels sortants sans borne est refusée par
     * `docs/reliability.md` §3.
     *
     * Elle ne rend **pas** l'offre achetée, et c'est une propriété : la session
     * ne porte pas son prix, et la réconciliation ne promeut que des lignes que
     * nous avons ouvertes (ADR 038). Une session inconnue n'a pas d'offre à
     * deviner.
     */
    listPurchases: async (input: ListPurchasesInput): Promise<ListPurchasesResult> => {
      const sessions: Record<string, unknown>[] = []
      let afterSession: string | undefined

      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const outcome = await run('list_purchases', async () =>
          await client.checkout.sessions.list({
            customer: input.customerId,
            limit: PAGE_SIZE,
            ...(afterSession === undefined ? {} : { starting_after: afterSession }),
          }),
        )

        if (!outcome.ok) {
          return { ok: false, error: outcome.error }
        }

        for (const entry of outcome.value.data) {
          sessions.push(entry as unknown as Record<string, unknown>)
        }

        const last = outcome.value.data.at(-1)

        if (!outcome.value.has_more || last === undefined) {
          break
        }

        afterSession = last.id
      }

      const refunds = new Map<string, { readonly amount: number; readonly refunded: number }>()
      let afterCharge: string | undefined

      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        const outcome = await run('list_purchases', async () =>
          await client.charges.list({
            customer: input.customerId,
            limit: PAGE_SIZE,
            ...(afterCharge === undefined ? {} : { starting_after: afterCharge }),
          }),
        )

        if (!outcome.ok) {
          return { ok: false, error: outcome.error }
        }

        for (const charge of outcome.value.data) {
          const paymentId = asId((charge as unknown as Record<string, unknown>)['payment_intent'])

          if (paymentId !== null) {
            refunds.set(paymentId, {
              amount: charge.amount,
              refunded: charge.amount_refunded,
            })
          }
        }

        const last = outcome.value.data.at(-1)

        if (!outcome.value.has_more || last === undefined) {
          break
        }

        afterCharge = last.id
      }

      const purchases: PaymentPurchase[] = []

      for (const session of sessions) {
        // Un abonnement n'est pas un achat, et il ne doit pas en devenir un :
        // les deux vivent dans des tables distinctes, ce qui est exactement ce
        // que le sixième critère de la story demande.
        if (session['mode'] !== 'payment') {
          continue
        }

        const sessionId = asId(session['id'])

        if (sessionId === null) {
          continue
        }

        const paymentId = asId(session['payment_intent'])
        const charge = paymentId === null ? undefined : refunds.get(paymentId)

        purchases.push({
          sessionId,
          paymentId,
          paid: session['payment_status'] === 'paid',
          amountTotal: asNumber(session['amount_total']),
          currency: typeof session['currency'] === 'string' ? session['currency'] : null,
          amountRefunded: charge?.refunded ?? 0,
          chargedAmount: charge?.amount ?? null,
        })
      }

      return { ok: true, purchases }
    },
  }
}
