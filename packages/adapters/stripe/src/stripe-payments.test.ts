import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createStripePayments, type StripePaymentsOptions } from './stripe-payments'
import { backoffDelayMs, classifyStripeError, isTransientPaymentsError, sanitize } from './retry'

/**
 * **Le réseau est doublé, le SDK est réel.**
 *
 * `Stripe.createFetchHttpClient(fetchFn)` accepte une fonction `fetch` : ce
 * qu'on remplace est donc la sortie réseau, pas le SDK. La sérialisation en
 * `application/x-www-form-urlencoded`, les en-têtes, la version d'API, la clé
 * d'idempotence et le traitement de la réponse restent ceux de Stripe. Doubler
 * `checkout.sessions.create` par une fonction à soi n'éprouverait que cette
 * fonction — c'est le piège relevé en revue de s01.
 *
 * L'autre régime — clés de test réelles — vit dans `stripe-live.test.ts`, hors
 * CI, sur commande explicite (`docs/architecture.md`).
 */

const API_KEY = 'sk_test_double'
const WEBHOOK_SECRET = 'whsec_double'

interface Call {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: string
}

const headersOf = (init: RequestInit | undefined): Record<string, string> =>
  Object.fromEntries(new Headers(init?.headers).entries())

/** Une réponse JSON du fournisseur, telle que le SDK la lira. */
const json = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': 'req_double' },
  })

const SESSION = {
  id: 'cs_test_1',
  object: 'checkout.session',
  url: 'https://checkout.stripe.com/c/pay/cs_test_1',
  customer: 'cus_1',
}

const CUSTOMER = { id: 'cus_created', object: 'customer' }

const PERIOD_END = 1_800_000_000
const TRIAL_END = 1_790_000_000

const subscriptionPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'sub_1',
  object: 'subscription',
  customer: 'cus_1',
  status: 'active',
  cancel_at_period_end: false,
  trial_end: null,
  items: {
    object: 'list',
    data: [
      {
        id: 'si_1',
        object: 'subscription_item',
        quantity: 3,
        // **Le champ qui n'est plus sur l'abonnement** (recherche §2.2).
        current_period_end: PERIOD_END,
        current_period_start: PERIOD_END - 2_592_000,
        price: { id: 'price_pro_monthly', object: 'price' },
      },
    ],
  },
  ...overrides,
})

/** Le harnais : une file de réponses, et la trace de ce qui a été demandé. */
const harness = (responses: readonly (() => Response | Promise<Response>)[]) => {
  const calls: Call[] = []
  let index = 0

  const fetchDouble: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: headersOf(init),
      body: typeof init?.body === 'string' ? init.body : '',
    })

    const next = responses[Math.min(index, responses.length - 1)]

    index += 1

    return await (next?.() ?? json(200, {}))
  }

  return { calls, fetchDouble }
}

const slept: number[] = []
const drawn: number[] = []

const options = (
  fetchDouble: typeof fetch,
  overrides: Partial<StripePaymentsOptions> = {},
): StripePaymentsOptions => ({
  apiKey: API_KEY,
  webhookSecret: WEBHOOK_SECRET,
  fetch: fetchDouble,
  timeoutMs: 200,
  maxAttempts: 3,
  backoff: { baseMs: 100, maxMs: 400, random: () => drawn.push(0.5) && 0.5 },
  sleep: async (ms) => {
    slept.push(ms)
  },
  ...overrides,
})

const CHECKOUT = {
  priceId: 'price_pro_monthly',
  mode: 'subscription',
  quantity: 3,
  customerId: 'cus_1',
  customerEmail: null,
  reference: 'organization:org_1',
  successUrl: 'https://app.test/billing?checkout=success',
  cancelUrl: 'https://app.test/billing?checkout=cancelled',
  trialPeriodDays: 14,
  locale: 'fr',
  idempotencyKey: 'idem-fixe',
} as const

beforeEach(() => {
  slept.length = 0
  drawn.length = 0
})

describe('ouvrir un checkout', () => {
  it('envoie au fournisseur ce que le serveur a décidé, et rend l’URL', async () => {
    const { calls, fetchDouble } = harness([() => json(200, SESSION)])
    const payments = createStripePayments(options(fetchDouble))

    const result = await payments.createCheckout(CHECKOUT)

    expect(result).toEqual({
      ok: true,
      checkout: { url: SESSION.url, customerId: 'cus_1' },
    })

    const call = calls[0]

    expect(call?.url).toBe('https://api.stripe.com/v1/checkout/sessions')
    expect(call?.method).toBe('POST')
    // La version d'API est **posée**, jamais laissée au défaut du compte : la
    // forme des objets reçus en dépend (recherche §2.1).
    expect(call?.headers['stripe-version']).toBe('2026-08-26.dahlia')
    expect(call?.headers['idempotency-key']).toBe('idem-fixe')

    const sent = new URLSearchParams(call?.body ?? '')

    expect(sent.get('mode')).toBe('subscription')
    expect(sent.get('line_items[0][price]')).toBe('price_pro_monthly')
    expect(sent.get('line_items[0][quantity]')).toBe('3')
    expect(sent.get('customer')).toBe('cus_1')
    expect(sent.get('subscription_data[trial_period_days]')).toBe('14')
    expect(sent.get('client_reference_id')).toBe('organization:org_1')
  })

  it('crée le client avant la session quand il n’existe pas, et le rend', async () => {
    // **Le rattachement précède le checkout** (ADR 034) : c'est ce qui permet à
    // un `customer.subscription.updated` arrivé en premier de retrouver son
    // propriétaire. L'appelant a besoin de cet identifiant pour l'écrire.
    const { calls, fetchDouble } = harness([
      () => json(200, CUSTOMER),
      () => json(200, { ...SESSION, customer: 'cus_created' }),
    ])
    const payments = createStripePayments(options(fetchDouble))

    const result = await payments.createCheckout({
      ...CHECKOUT,
      customerId: null,
      customerEmail: 'client@example.test',
    })

    expect(result.ok && result.checkout.customerId).toBe('cus_created')
    expect(calls[0]?.url).toBe('https://api.stripe.com/v1/customers')
    expect(calls[1]?.url).toBe('https://api.stripe.com/v1/checkout/sessions')
    expect(new URLSearchParams(calls[1]?.body ?? '').get('customer')).toBe('cus_created')
  })

  it('refuse une session sans URL au lieu de rendre un succès vide', async () => {
    // `url` est nullable côté fournisseur (checkout intégré). Rendre
    // `{ok:true, url:null}` obligerait chaque appelant à revérifier.
    const { fetchDouble } = harness([() => json(200, { ...SESSION, url: null })])
    const payments = createStripePayments(options(fetchDouble))

    const result = await payments.createCheckout(CHECKOUT)

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('invalid_request')
  })
})

describe('le portail client', () => {
  it('rend l’URL du portail', async () => {
    const { calls, fetchDouble } = harness([
      () => json(200, { id: 'bps_1', object: 'billing_portal.session', url: 'https://billing.stripe.com/p/session/x' }),
    ])
    const payments = createStripePayments(options(fetchDouble))

    const result = await payments.createPortalSession({
      customerId: 'cus_1',
      returnUrl: 'https://app.test/billing',
    })

    expect(result).toEqual({ ok: true, session: { url: 'https://billing.stripe.com/p/session/x' } })
    expect(calls[0]?.url).toBe('https://api.stripe.com/v1/billing_portal/sessions')
  })
})

describe('les reprises', () => {
  it('rejoue une erreur transitoire, avec la même clé d’idempotence à chaque tentative', async () => {
    // **Une seule clé pour toutes les tentatives** : si la réponse s'est perdue,
    // une reprise ne doit pas ouvrir un second checkout (`docs/reliability.md` §1).
    const { calls, fetchDouble } = harness([
      () => json(429, { error: { type: 'rate_limit_error', message: 'slow down' } }),
      () => json(429, { error: { type: 'rate_limit_error', message: 'slow down' } }),
      () => json(200, SESSION),
    ])
    const payments = createStripePayments(options(fetchDouble))

    const result = await payments.createCheckout(CHECKOUT)

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(3)
    expect(new Set(calls.map((call) => call.headers['idempotency-key']))).toEqual(
      new Set(['idem-fixe']),
    )
    // Recul exponentiel, dispersé et plafonné.
    expect(slept).toEqual([75, 150])
    expect(drawn).toHaveLength(2)
  })

  it('ne rejoue pas une erreur définitive, et compte la tentative', async () => {
    const { calls, fetchDouble } = harness([
      () => json(400, { error: { type: 'invalid_request_error', message: 'No such price: price_x' } }),
    ])
    const payments = createStripePayments(options(fetchDouble))

    const result = await payments.createCheckout(CHECKOUT)

    expect(calls).toHaveLength(1)
    expect(!result.ok && result.error).toMatchObject({ code: 'invalid_request', attempts: 1 })
    expect(slept).toEqual([])
  })

  it('abandonne après le nombre maximal de tentatives', async () => {
    const { calls, fetchDouble } = harness([
      () => json(503, { error: { type: 'api_error', message: 'down' } }),
    ])
    const payments = createStripePayments(options(fetchDouble))

    const result = await payments.createCheckout(CHECKOUT)

    expect(calls).toHaveLength(3)
    expect(!result.ok && result.error).toMatchObject({ code: 'provider_unavailable', attempts: 3 })
  })

  it('rend `timeout` quand le délai d’attente est dépassé, et le journalise', async () => {
    const logged: unknown[] = []
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')

          error.name = 'AbortError'
          reject(error)
        })
      })

    const payments = createStripePayments(
      options(hanging, {
        timeoutMs: 30,
        maxAttempts: 1,
        log: (record) => logged.push(record),
      }),
    )

    const result = await payments.createPortalSession({
      customerId: 'cus_1',
      returnUrl: 'https://app.test/billing',
    })

    expect(!result.ok && result.error.code).toBe('timeout')
    expect(logged).toEqual([
      {
        event: 'payments.call_failed',
        operation: 'create_portal_session',
        code: 'timeout',
        attempts: 1,
        message: expect.any(String),
      },
    ])
  })
})

describe('ce qui sort dans un message d’erreur', () => {
  /**
   * Mesuré : le fournisseur met une clé, un identifiant de client et une URL de
   * session dans son propre message (recherche §2.5). Le port promet un message
   * assaini ; c'est ici que la promesse se tient.
   */
  const LEAKY =
    'No such price: price_x (key sk_test_51ABCdefGHIjklMNO used, customer cus_9, url https://checkout.stripe.com/c/pay/cs_test_secret)'

  it('n’y laisse ni clé, ni identifiant de client, ni URL', async () => {
    const { fetchDouble } = harness([
      () => json(400, { error: { type: 'invalid_request_error', message: LEAKY } }),
    ])
    const payments = createStripePayments(options(fetchDouble))

    const result = await payments.createCheckout(CHECKOUT)
    const message = !result.ok ? result.error.message : ''

    expect(message).not.toContain('sk_test_51ABCdefGHIjklMNO')
    expect(message).not.toContain('cus_9')
    expect(message).not.toContain('https://checkout.stripe.com')
    expect(message).not.toContain('cs_test_secret')
    // Il reste diagnosticable : le prix, lui, n'est pas une donnée personnelle.
    expect(message).toContain('price_x')
  })

  it('n’y laisse pas la clé d’API du client, quel que soit l’endroit du message', () => {
    expect(sanitize(`clé ${API_KEY} et whsec_abcdef`)).not.toContain('sk_test_double')
    expect(sanitize(`clé ${API_KEY} et whsec_abcdef`)).not.toContain('whsec_abcdef')
  })

  it('borne la longueur : un fournisseur bavard ne remplit pas le journal', () => {
    expect(sanitize('x'.repeat(1000)).length).toBeLessThanOrEqual(300)
  })
})

describe('la vérification de signature', () => {
  const payloadOf = (event: Record<string, unknown>): string => JSON.stringify(event)

  const CHECKOUT_EVENT = {
    id: 'evt_checkout',
    object: 'event',
    api_version: '2026-08-26.dahlia',
    created: 1_788_000_000,
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        object: 'checkout.session',
        customer: 'cus_1',
        subscription: 'sub_1',
        client_reference_id: 'organization:org_1',
        mode: 'subscription',
      },
    },
  }

  const sign = (payload: string, secret = WEBHOOK_SECRET): string =>
    Stripe.webhooks.generateTestHeaderString({ payload, secret })

  it('rend un événement normalisé quand la signature est valide', async () => {
    const { fetchDouble } = harness([() => json(200, {})])
    const payments = createStripePayments(options(fetchDouble))
    const payload = payloadOf(CHECKOUT_EVENT)

    const result = await payments.verifyWebhook({ payload, signature: sign(payload) })

    expect(result).toEqual({
      ok: true,
      event: {
        kind: 'checkout_completed',
        id: 'evt_checkout',
        occurredAt: new Date(1_788_000_000 * 1000),
        reference: 'organization:org_1',
        customerId: 'cus_1',
        subscriptionId: 'sub_1',
      },
    })
  })

  it('refuse une signature forgée, sans rien lire de la charge utile', async () => {
    const { fetchDouble } = harness([() => json(200, {})])
    const payments = createStripePayments(options(fetchDouble))
    const payload = payloadOf(CHECKOUT_EVENT)

    const result = await payments.verifyWebhook({
      payload,
      signature: sign(payload, 'whsec_autre'),
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('invalid_signature')
  })

  it('refuse une signature absente', async () => {
    const { fetchDouble } = harness([() => json(200, {})])
    const payments = createStripePayments(options(fetchDouble))

    const result = await payments.verifyWebhook({ payload: '{}', signature: '' })

    expect(!result.ok && result.error.code).toBe('invalid_signature')
  })

  it('lit la fin de période sur les **lignes** de l’abonnement', async () => {
    const { fetchDouble } = harness([() => json(200, {})])
    const payments = createStripePayments(options(fetchDouble))
    const payload = payloadOf({
      id: 'evt_sub',
      object: 'event',
      api_version: '2026-08-26.dahlia',
      created: 1_788_000_100,
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      type: 'customer.subscription.updated',
      data: { object: subscriptionPayload({ trial_end: TRIAL_END, cancel_at_period_end: true }) },
    })

    const result = await payments.verifyWebhook({ payload, signature: sign(payload) })

    expect(result.ok && result.event.kind).toBe('subscription_changed')
    expect(result.ok && result.event.kind === 'subscription_changed' && result.event.subscription).toEqual({
      id: 'sub_1',
      customerId: 'cus_1',
      priceId: 'price_pro_monthly',
      quantity: 3,
      status: 'active',
      currentPeriodEnd: new Date(PERIOD_END * 1000),
      cancelAtPeriodEnd: true,
      trialEnd: new Date(TRIAL_END * 1000),
    })
  })

  it('retombe fermé sur un statut que le fournisseur invente', async () => {
    // Le SDK type `status` en `… | OtherString` : la valeur inconnue existe. Un
    // repli ouvert accorderait un accès sur un mot que personne n'a lu.
    const { fetchDouble } = harness([() => json(200, {})])
    const payments = createStripePayments(options(fetchDouble))
    const payload = payloadOf({
      id: 'evt_sub_2',
      object: 'event',
      api_version: '2026-08-26.dahlia',
      created: 1_788_000_200,
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      type: 'customer.subscription.created',
      data: { object: subscriptionPayload({ status: 'quantum_superposition' }) },
    })

    const result = await payments.verifyWebhook({ payload, signature: sign(payload) })

    expect(
      result.ok && result.event.kind === 'subscription_changed' && result.event.subscription.status,
    ).toBe('incomplete')
  })

  it('rend `unhandled` — et non une absence — pour un type qu’on ne traite pas', async () => {
    // Il doit quand même être journalisé par son identifiant : sinon un rejeu le
    // ferait retraverser la chaîne, et le fournisseur en envoie plus qu'on n'en
    // demande.
    const { fetchDouble } = harness([() => json(200, {})])
    const payments = createStripePayments(options(fetchDouble))
    const payload = payloadOf({
      id: 'evt_other',
      object: 'event',
      api_version: '2026-08-26.dahlia',
      created: 1_788_000_300,
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      type: 'invoice.created',
      data: { object: { id: 'in_1', object: 'invoice' } },
    })

    const result = await payments.verifyWebhook({ payload, signature: sign(payload) })

    expect(result.ok && result.event).toMatchObject({ kind: 'unhandled', id: 'evt_other', type: 'invoice.created' })
  })

  it('reconnaît un échec de paiement', async () => {
    const { fetchDouble } = harness([() => json(200, {})])
    const payments = createStripePayments(options(fetchDouble))
    const payload = payloadOf({
      id: 'evt_failed',
      object: 'event',
      api_version: '2026-08-26.dahlia',
      created: 1_788_000_400,
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_2', object: 'invoice', customer: 'cus_1', subscription: 'sub_1' } },
    })

    const result = await payments.verifyWebhook({ payload, signature: sign(payload) })

    expect(result.ok && result.event).toMatchObject({
      kind: 'payment_failed',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
    })
  })
})

describe('la lecture pour la réconciliation', () => {
  it('rend les abonnements normalisés d’un client', async () => {
    const { calls, fetchDouble } = harness([
      () => json(200, { object: 'list', data: [subscriptionPayload()], has_more: false }),
    ])
    const payments = createStripePayments(options(fetchDouble))

    const result = await payments.listSubscriptions({ customerId: 'cus_1' })

    expect(result.ok && result.subscriptions).toHaveLength(1)
    expect(result.ok && result.subscriptions[0]?.currentPeriodEnd).toEqual(
      new Date(PERIOD_END * 1000),
    )
    expect(calls[0]?.url).toContain('/v1/subscriptions')
  })

  /**
   * **La pagination, jusqu'au bout** (constat F8 de la revue).
   *
   * Le fournisseur rend cent abonnements par page. Sans cette boucle, la
   * réconciliation d'un client à l'historique long était **partielle et
   * silencieuse** — et c'est précisément la commande dont le rôle est de
   * réparer une divergence.
   */
  it('suit les pages jusqu’à la dernière, en repartant du dernier lu', async () => {
    const { calls, fetchDouble } = harness([
      () =>
        json(200, {
          object: 'list',
          data: [subscriptionPayload({ id: 'sub_page1' })],
          has_more: true,
        }),
      () =>
        json(200, {
          object: 'list',
          data: [subscriptionPayload({ id: 'sub_page2' })],
          has_more: false,
        }),
    ])
    const payments = createStripePayments(options(fetchDouble))

    const result = await payments.listSubscriptions({ customerId: 'cus_1' })

    expect(result.ok && result.subscriptions.map((entry) => entry.id)).toEqual([
      'sub_page1',
      'sub_page2',
    ])
    expect(calls).toHaveLength(2)
    expect(calls[1]?.url).toContain('starting_after=sub_page1')
  })

  it('s’arrête à la dernière page annoncée, sans demander la suivante', async () => {
    const { calls, fetchDouble } = harness([
      () =>
        json(200, { object: 'list', data: [subscriptionPayload()], has_more: false }),
    ])
    const payments = createStripePayments(options(fetchDouble))

    await payments.listSubscriptions({ customerId: 'cus_1' })

    expect(calls).toHaveLength(1)
  })
})

describe('l’adaptateur ne rejette jamais', () => {
  it('rend un échec même si le SDK lève une erreur qui n’est pas la sienne', async () => {
    const exploding: typeof fetch = () => {
      throw new RangeError('boum')
    }
    const payments = createStripePayments(options(exploding, { maxAttempts: 1 }))

    const result = await payments.createCheckout(CHECKOUT)

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('provider_unavailable')
  })

  it('rend un échec au lieu de lever quand la vérification explose', async () => {
    const { fetchDouble } = harness([() => json(200, {})])
    const payments = createStripePayments(options(fetchDouble))
    const broken = vi
      .spyOn(Stripe.webhooks, 'constructEvent')
      .mockImplementation(() => {
        throw new RangeError('boum')
      })

    const result = await payments.verifyWebhook({ payload: '{}', signature: 't=1,v1=x' })

    expect(result.ok).toBe(false)
    broken.mockRestore()
  })
})

describe('la politique de reprise, isolée', () => {
  it('ne rejoue que les erreurs transitoires', () => {
    const transient = ['rate_limited', 'provider_unavailable', 'timeout'] as const
    const definitive = ['invalid_request', 'unauthorized', 'invalid_signature', 'not_found'] as const

    for (const code of transient) {
      expect(isTransientPaymentsError(code), code).toBe(true)
    }

    for (const code of definitive) {
      expect(isTransientPaymentsError(code), code).toBe(false)
    }
  })

  it('plafonne le recul et le disperse à moitié', () => {
    const policy = { baseMs: 100, maxMs: 250, random: () => 1 }

    expect(backoffDelayMs(1, policy)).toBe(100)
    expect(backoffDelayMs(2, policy)).toBe(200)
    // Plafonné : sans le plafond, la quatrième attente vaudrait 800 ms.
    expect(backoffDelayMs(4, policy)).toBe(250)
    // Dispersée : avec un tirage nul, l'attente vaut la moitié du recul.
    expect(backoffDelayMs(2, { ...policy, random: () => 0 })).toBe(100)
  })

  it('classe une erreur inconnue sur son code HTTP, jamais en définitif par défaut', () => {
    expect(classifyStripeError({ statusCode: 503 })).toBe('provider_unavailable')
    expect(classifyStripeError({ statusCode: 429 })).toBe('rate_limited')
    expect(classifyStripeError({ statusCode: 401 })).toBe('unauthorized')
    expect(classifyStripeError({ statusCode: 404 })).toBe('not_found')
    expect(classifyStripeError({ statusCode: 400 })).toBe('invalid_request')
    expect(classifyStripeError({})).toBe('provider_unavailable')
  })
})
