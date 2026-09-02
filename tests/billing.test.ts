import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { parseEnv, type Env } from '@repo/config'
import {
  buildRegistry,
  dispatchModuleRequest,
  type ModuleScope,
  type ModuleSession,
} from '@repo/core'
import {
  closeDatabase,
  createDatabaseClient,
  planModuleMigrations,
  runModuleMigrations,
  type DatabaseConnection,
} from '@repo/db'
import { createRecordingMailer } from '@repo/mailer-testing'
import { createStripePayments } from '@repo/adapter-stripe'
import { authModule, authUser } from '@repo/module-auth'
import {
  BILLING_KEYS,
  billingModule,
  billingRoutePath,
  billingSubscription,
  configureBilling,
  EMPTY_BILLING_VIEW,
  offerDescriptionKey,
  offerNameKey,
  parseBillingCatalogue,
  requireBillingService,
  resetBillingService,
  stateTitleKey,
  subscriptionReadOrder,
  type BillingPermission,
  type ConfigureBillingOptions,
} from '@repo/module-billing'
import {
  configureOrganizations,
  EMPTY_ORGANIZATIONS_VIEW,
  organizationMember,
  organizationsModule,
  resetOrganizationsService,
  type OrganizationRole,
  type OrganizationsService,
} from '@repo/module-organizations'
import { BillingScreen } from '@repo/module-billing/presentation'
import { demoEnabledModule } from '@repo/module-demo-enabled'
import { eq, sql } from 'drizzle-orm'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Stripe from 'stripe'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { billing as appBilling } from '../apps/web/lib/billing'
import { LOCAL_WEBHOOK_SECRET, resolveBillingConfig } from '../apps/web/lib/billing-config'
import { billingPermissionOf } from '../apps/web/lib/billing-permission'
import { organizations as appOrganizations } from '../apps/web/lib/organizations'
import { billingOffers } from '../config/billing'
import { appLocales, defaultLocale } from '../config/i18n'
import { databaseUrl, isDatabaseReachable } from './fixtures/database'

/**
 * Le câblage de la facturation, éprouvé là où il traverse les packages.
 *
 * Ce qui appartient à un package est éprouvé chez lui : les règles pures dans
 * `packages/modules/billing/src/domain/billing-rules.test.ts`, l'adaptateur
 * dans `packages/adapters/stripe/src/stripe-payments.test.ts`, la simulation
 * dans `packages/payments-testing/src/payments-testing.test.ts`. Ici, seulement
 * ce qui n'existe qu'assemblé.
 */

const BASE: Record<string, string> = {
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/app',
  AUTH_SECRET: 'x'.repeat(32),
  APP_URL: 'https://app.test',
  EMAIL_LOCAL_CAPTURE: '1',
}

const env = (overrides: Record<string, string | undefined> = {}): Env =>
  parseEnv({ ...BASE, ...overrides })

describe('le choix du fournisseur de paiement', () => {
  it('retient le fournisseur quand la clé et le secret de webhook sont là', () => {
    expect(
      resolveBillingConfig(
        env({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }),
      ),
    ).toEqual({ kind: 'provider', apiKey: 'sk_test_x', webhookSecret: 'whsec_x' })
  })

  it('retient la simulation quand le drapeau est posé, sans aucune clé', () => {
    expect(resolveBillingConfig(env({ PAYMENTS_LOCAL_MODE: '1' }))).toEqual({
      kind: 'local',
      webhookSecret: LOCAL_WEBHOOK_SECRET,
    })
  })

  it('refuse de démarrer sans clé et sans drapeau, en nommant les trois variables', () => {
    // `docs/reliability.md` §2 : le mode local est un opt-in, jamais un repli.
    // Un déploiement sans clé qui basculerait tout seul en simulation
    // accorderait des abonnements que personne n'a payés.
    expect(() => resolveBillingConfig(env())).toThrow(/STRIPE_SECRET_KEY/)
    expect(() => resolveBillingConfig(env())).toThrow(/STRIPE_WEBHOOK_SECRET/)
    expect(() => resolveBillingConfig(env())).toThrow(/PAYMENTS_LOCAL_MODE/)
  })

  it('refuse le drapeau sous NODE_ENV=production, en nommant la variable', () => {
    expect(() =>
      resolveBillingConfig(env({ PAYMENTS_LOCAL_MODE: '1', NODE_ENV: 'production' })),
    ).toThrow(/PAYMENTS_LOCAL_MODE/)
  })

  it('ne déduit jamais la simulation de NODE_ENV', () => {
    // Le drapeau est l'unique opt-in : `NODE_ENV` ne l'active pas, il le
    // restreint. Sans drapeau et sans clé, développement compris, c'est un refus.
    expect(() => resolveBillingConfig(env({ NODE_ENV: 'development' }))).toThrow()
    expect(() => resolveBillingConfig(env({ NODE_ENV: 'test' }))).toThrow()
  })

  it('refuse une clé sans son secret de webhook, dès le schéma', () => {
    // Sans cette règle, l'application démarrerait, encaisserait, et refuserait
    // chaque événement en 400 : l'état des abonnements se perdrait en silence.
    expect(() => env({ STRIPE_SECRET_KEY: 'sk_test_x' })).toThrow(/STRIPE_WEBHOOK_SECRET/)
  })

  it('refuse un secret de webhook sans sa clé, dès le schéma', () => {
    expect(() => env({ STRIPE_WEBHOOK_SECRET: 'whsec_x' })).toThrow(/STRIPE_SECRET_KEY/)
  })

  it('refuse le drapeau et une clé ensemble, dès le schéma', () => {
    expect(() =>
      env({
        PAYMENTS_LOCAL_MODE: '1',
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_WEBHOOK_SECRET: 'whsec_x',
      }),
    ).toThrow(/PAYMENTS_LOCAL_MODE/)
  })

  it('laisse démarrer un processus qui ne touche pas au paiement', () => {
    // `pnpm db:migrate` n'encaisse rien : le **schéma** ne doit exiger de
    // personne un fournisseur de paiement (revue de s06, G3). C'est la règle
    // ci-dessus, appliquée seulement quand le module est activé, qui l'exige.
    expect(() => env()).not.toThrow()
  })
})

/* -------------------------------------------------------------------------- *
 * Le module, contre une vraie base et à travers le répartiteur — le même chemin
 * qu'une requête de l'application.
 *
 * Ce fichier porte ce qui décide de la story, et rien de ce qui se prouve
 * ailleurs : les règles pures vivent dans
 * `packages/modules/billing/src/domain/billing-rules.test.ts`, l'adaptateur dans
 * `packages/adapters/stripe/src/stripe-payments.test.ts`. Ici, l'assemblage.
 *
 * **Régime de CI** : la sortie réseau est doublée
 * (`Stripe.createFetchHttpClient`), le SDK est réel, et les événements entrants
 * sont des charges utiles **enregistrées** que le SDK signe à l'exécution — donc
 * la vraie vérification de signature s'exécute (`docs/architecture.md`).
 * -------------------------------------------------------------------------- */

const databaseReachable = await isDatabaseReachable()

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_URL = 'http://localhost:3000'
const WEBHOOK_SECRET = 'whsec_s19_double'

/**
 * Le registre du module, **construit par le test** : les assertions portent sur
 * la modularité, pas sur l'état dans lequel `config/features.ts` se trouve. Ce
 * fichier est donc vert dans les deux configurations du dépôt.
 */
const registry = buildRegistry({
  available: [billingModule],
  enabled: ['billing'],
  locales: [...appLocales],
})

/** La même configuration, **sans** le module. */
const withoutBilling = buildRegistry({
  available: [billingModule, demoEnabledModule],
  enabled: ['demo-enabled'],
  locales: [...appLocales],
})

const CATALOGUE = parseBillingCatalogue([
  {
    id: 'pro-monthly',
    mode: 'subscription',
    priceId: 'price_pro_monthly',
    amount: 2900,
    currency: 'eur',
    interval: 'month',
    trialDays: 14,
    perSeat: false,
  },
  {
    id: 'team-monthly',
    mode: 'subscription',
    priceId: 'price_team_monthly',
    amount: 900,
    currency: 'eur',
    interval: 'month',
    trialDays: null,
    perSeat: true,
  },
])

let connection: DatabaseConnection
let clock = new Date('2026-09-01T12:00:00.000Z')
let sequence = 0

/** Le périmètre que la fonction unique de l'application résoudrait. */
let currentScope: ModuleScope | null = null
/** La permission que le module `organizations` accorderait (ADR 034). */
let permitted = true
/**
 * Le prédicat de permission **effectivement branché** sur le service.
 *
 * Par défaut, le drapeau `permitted` — ce qui suffit aux cas qui mesurent autre
 * chose. Le bloc « le droit de gérer la facturation » y pose le prédicat **de
 * production** (`billingPermissionOf`), branché sur la vraie vue du module
 * `organizations` : sans cela, le fil entre la matrice de rôles et la route
 * n'est tenu par rien (constat F3 de la revue).
 */
let permission: BillingPermission = () => Promise.resolve(permitted)
let seats = 1
let organizationsService: OrganizationsService

interface RecordedCall {
  readonly url: string
  readonly body: string
}

const calls: RecordedCall[] = []
let responses: (() => Response)[] = []

/**
 * La doublure du **réseau** : elle enregistre la requête sérialisée par le SDK
 * et rend la réponse programmée. Doubler le port lui-même n'éprouverait ni la
 * sérialisation, ni les en-têtes, ni le traitement de la réponse.
 */
const fetchDouble: typeof fetch = async (input, init) => {
  calls.push({ url: String(input), body: typeof init?.body === 'string' ? init.body : '' })

  const next = responses.shift()

  return (
    next?.() ??
    new Response(JSON.stringify({ error: { type: 'api_error', message: 'non programmé' } }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  )
}

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const payments = createStripePayments({
  apiKey: 'sk_test_s19_double',
  webhookSecret: WEBHOOK_SECRET,
  fetch: fetchDouble,
  timeoutMs: 500,
  maxAttempts: 1,
  backoff: { baseMs: 1, maxMs: 1, random: () => 0 },
  sleep: async () => {},
})

const call = async (
  path: 'checkout' | 'portal' | 'webhook',
  options: {
    readonly session?: { readonly userId: string; readonly roles: readonly string[] } | null
    readonly body?: unknown
    readonly raw?: string
    readonly signature?: string
  } = {},
): Promise<Response> => {
  const url = `${APP_URL}${billingRoutePath(path)}`
  const request =
    options.raw === undefined
      ? new Request(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(options.body ?? {}),
        })
      : new Request(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(options.signature === undefined ? {} : { 'stripe-signature': options.signature }),
          },
          body: options.raw,
        })

  return await dispatchModuleRequest(registry, request, {
    resolveSession: () => Promise.resolve(options.session ?? null),
  })
}

/** Une charge utile d'événement, telle que le fournisseur l'enverrait. */
const eventPayload = (input: {
  readonly id: string
  readonly type: string
  readonly created: number
  readonly object: Record<string, unknown>
}): string =>
  JSON.stringify({
    id: input.id,
    object: 'event',
    api_version: '2026-08-26.dahlia',
    created: input.created,
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: input.type,
    data: { object: input.object },
  })

const subscriptionObject = (input: {
  readonly customer: string
  readonly status?: string
  readonly quantity?: number
  readonly periodEnd: number
  readonly cancelAtPeriodEnd?: boolean
  readonly priceId?: string
  /** L'abonnement du fournisseur. Plusieurs se succèdent pour un même client. */
  readonly id?: string
}): Record<string, unknown> => ({
  id: input.id ?? 'sub_s19_1',
  object: 'subscription',
  customer: input.customer,
  status: input.status ?? 'active',
  cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
  trial_end: null,
  items: {
    object: 'list',
    data: [
      {
        id: 'si_s19_1',
        object: 'subscription_item',
        quantity: input.quantity ?? 1,
        current_period_start: input.periodEnd - 2_592_000,
        current_period_end: input.periodEnd,
        price: { id: input.priceId ?? 'price_pro_monthly', object: 'price' },
      },
    ],
  },
})

/** L'événement, signé par le SDK : la vérification qui suit est la vraie. */
const deliver = async (payload: string, secret = WEBHOOK_SECRET): Promise<Response> =>
  await call('webhook', {
    raw: payload,
    signature: Stripe.webhooks.generateTestHeaderString({ payload, secret }),
  })

const countRows = async (table: string): Promise<number> => {
  const counted = await connection.db.execute<{ count: number }>(
    sql`select count(*)::int as count from ${sql.identifier(table)}`,
  )

  return Number(counted.rows[0]?.count ?? 0)
}

const storedSubscription = async (): Promise<Record<string, unknown> | undefined> => {
  const rows = await connection.db.execute<Record<string, unknown>>(
    sql`select * from billing_subscription limit 1`,
  )

  return rows.rows[0]
}

/**
 * Un compte réel : les appartenances portent une clé étrangère vers
 * `auth_user`, et le point de composition de l'application y lit l'adresse
 * qu'il transmet au fournisseur.
 */
const anAccount = async (
  email = `s19-${randomUUID()}@example.test`,
): Promise<ModuleSession> => {
  const userId = `usr_s19_${randomUUID()}`

  await connection.db.insert(authUser).values({ id: userId, name: 'Compte de test', email })

  return { userId, roles: [] }
}

/**
 * Une organisation, son propriétaire, et un second compte au rôle demandé.
 *
 * Au niveau du fichier parce que **deux** blocs s'en servent : celui qui éprouve
 * la règle de permission, et celui qui éprouve le point de composition de
 * l'application, qui la branche.
 */
const anOrganizationWithRole = async (
  role: OrganizationRole,
  email?: string,
): Promise<{ readonly other: ModuleSession; readonly organizationId: string }> => {
  const owner = await anAccount()
  const created = await organizationsService.useCases.createOrganization({
    userId: owner.userId,
    body: { name: 'Studio s19', slug: `s19-${randomUUID().slice(0, 8)}` },
  })

  expect(created.status).toBe('ok')

  const organizationId =
    (await organizationsService.useCases.viewOrganizations(owner.userId)).current?.id ?? ''
  const other = await anAccount(email)

  // **Écrite directement** : construire un rôle avec la route qui les
  // distribue ferait une fixture qui dépend du code mesuré.
  await connection.db.insert(organizationMember).values({
    id: `mbr_s19_${randomUUID()}`,
    organizationId,
    userId: other.userId,
    role,
  })

  // **L'organisation devient la sienne, la courante.** C'est la même
  // sélection dont `dataOwnerOf` dérive le périmètre en production : sans
  // elle, la vue ne porte aucune organisation, `permissionsOf(null)` accorde
  // tout, et le cas mesurerait le contraire de ce qu'il annonce.
  const switched = await organizationsService.useCases.switchOrganization({
    userId: other.userId,
    body: { organizationId },
  })

  expect(switched.status).toBe('ok')

  return { other, organizationId }
}

/**
 * Le service **de cette suite** : périmètre, permission, sièges et adresse sont
 * pilotés par les variables ci-dessus, parce que la plupart des cas mesurent
 * autre chose. Le bloc « le point de composition de l'application » le remplace
 * par celui que `apps/web/lib/billing.ts` compose, puis le repose ici.
 */
const suiteBilling = (): ConfigureBillingOptions => ({
  db: connection.db,
  payments,
  catalogue: CATALOGUE,
  appUrl: APP_URL,
  ownerOf: () => Promise.resolve(currentScope),
  canManage: async (scope, userId) => await permission(scope, userId),
  seatsOf: () => Promise.resolve(seats),
  emailOfScope: () => Promise.resolve('client@example.test'),
  now: () => clock,
  generateId: () => {
    sequence += 1

    return `bc_s19_${sequence}`
  },
})

const cleanup = async (): Promise<void> => {
  await connection.db.execute(sql`delete from billing_customer`)
  await connection.db.execute(sql`delete from billing_webhook_event`)
}

beforeAll(async () => {
  if (!databaseReachable) {
    return
  }

  connection = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 5 })

  await runModuleMigrations({
    db: connection.db,
    // `auth` et `organizations` sont là pour **un seul** bloc : celui qui
    // éprouve le droit de gérer la facturation avec un rôle réel en base. Les
    // migrations sont idempotentes, et la suite ne doit pas dépendre d'un
    // `pnpm db:migrate` lancé avant elle.
    plan: planModuleMigrations({
      modules: [authModule, organizationsModule, billingModule],
      repoRoot: REPO_ROOT,
    }),
  })

  organizationsService = configureOrganizations({
    db: connection.db,
    reservedSlugs: new Set(['account', 'sign-in']),
    generateId: (prefix: string) => `${prefix}_s19_${randomUUID()}`,
    mailer: createRecordingMailer(),
    appUrl: APP_URL,
    emailLocale: defaultLocale,
    now: () => clock,
  })

  configureBilling(suiteBilling())
})

afterAll(async () => {
  resetBillingService()
  resetOrganizationsService()

  if (databaseReachable) {
    await cleanup()
    // Les comptes de cette suite, et eux seuls : appartenances et sélections
    // suivent par cascade.
    await connection.db.execute(sql`delete from auth_user where email like 's19-%'`)
    await connection.db.execute(sql`delete from organization where slug like 's19-%'`)
    await connection.close()
  }
})

beforeEach(async () => {
  calls.length = 0
  responses = []
  currentScope = { kind: 'organization', organizationId: 'org_s19' }
  permitted = true
  permission = () => Promise.resolve(permitted)
  seats = 1
  clock = new Date('2026-09-01T12:00:00.000Z')

  if (databaseReachable) {
    await cleanup()
  }
})

describe.runIf(databaseReachable)('ouvrir un checkout', () => {
  it('rattache le client **avant** de rendre l’URL, pour que l’ordre des événements cesse de compter', async () => {
    responses = [
      () => json({ id: 'cus_s19', object: 'customer' }),
      () =>
        json({
          id: 'cs_s19',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s19',
          customer: 'cus_s19',
        }),
    ]

    const response = await call('checkout', {
      session: { userId: 'usr_s19', roles: [] },
      body: { offerId: 'pro-monthly' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      url: 'https://checkout.stripe.com/c/pay/cs_s19',
    })
    // La ligne existe **maintenant**, pas à la réception du webhook (ADR 034).
    expect(await countRows('billing_customer')).toBe(1)
  })

  /**
   * **Le prix ne vient jamais du client.** Le corps ne porte qu'un identifiant
   * d'offre ; le prix envoyé au fournisseur est celui du catalogue.
   */
  it('n’envoie au fournisseur que le prix du catalogue', async () => {
    responses = [
      () => json({ id: 'cus_s19', object: 'customer' }),
      () =>
        json({
          id: 'cs_s19',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s19',
          customer: 'cus_s19',
        }),
    ]

    await call('checkout', {
      session: { userId: 'usr_s19', roles: [] },
      body: { offerId: 'pro-monthly' },
    })

    const sent = new URLSearchParams(calls.at(-1)?.body ?? '')

    expect(sent.get('line_items[0][price]')).toBe('price_pro_monthly')
    expect(sent.get('line_items[0][quantity]')).toBe('1')
  })

  /**
   * **L'adresse du compte part avec le client créé** (constat F4 de la revue).
   *
   * `emailOfScope` rendait `null` en dur : les clients créés chez le
   * fournisseur n'avaient aucune adresse, et personne ne pouvait les
   * recontacter — pas un reçu, pas une relance d'échec de paiement.
   */
  it('crée le client du fournisseur avec l’adresse du compte appelant', async () => {
    responses = [
      () => json({ id: 'cus_s19', object: 'customer' }),
      () =>
        json({
          id: 'cs_s19',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s19',
          customer: 'cus_s19',
        }),
    ]

    await call('checkout', {
      session: { userId: 'usr_s19', roles: [] },
      body: { offerId: 'pro-monthly' },
    })

    expect(new URLSearchParams(calls[0]?.body ?? '').get('email')).toBe('client@example.test')
  })

  it('refuse un corps qui prétend porter un prix ou un montant, sans appeler le fournisseur', async () => {
    // Le schéma est **strict** : refuser plutôt qu'ignorer dit à l'appelant que
    // ces champs n'existent pas, et fait rougir si quelqu'un les ajoute au client.
    const response = await call('checkout', {
      session: { userId: 'usr_s19', roles: [] },
      body: { offerId: 'pro-monthly', priceId: 'price_gratuit', amount: 1 },
    })

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  })

  it('ignore un périmètre glissé dans le corps : il n’en accepte aucun', async () => {
    responses = [
      () => json({ id: 'cus_s19', object: 'customer' }),
      () =>
        json({
          id: 'cs_s19',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s19',
          customer: 'cus_s19',
        }),
    ]

    const response = await call('checkout', {
      session: { userId: 'usr_s19', roles: [] },
      body: { offerId: 'pro-monthly', organizationId: 'org_de_quelqu_un_d_autre' },
    })

    // **404 est inatteignable ici, et c'est mieux qu'un 404** : aucune route de
    // ce module n'accepte d'identifiant de périmètre, donc viser celui d'un
    // autre n'est pas refusé — c'est impossible à formuler. Le corps est refusé
    // par le schéma strict, et le périmètre reste celui de la session.
    expect(response.status).toBe(400)
    expect(await countRows('billing_customer')).toBe(0)
  })

  it('refuse une offre inconnue sans appeler le fournisseur', async () => {
    const response = await call('checkout', {
      session: { userId: 'usr_s19', roles: [] },
      body: { offerId: 'offre-inventee' },
    })

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  })

  it('refuse celui qui n’a pas le droit de gérer la facturation, sans écrire ni appeler', async () => {
    // ADR 034 : un `member` d'organisation ne souscrit pas et n'annule pas.
    permitted = false

    const response = await call('checkout', {
      session: { userId: 'usr_s19', roles: [] },
      body: { offerId: 'pro-monthly' },
    })

    expect(response.status).toBe(403)
    expect(calls).toEqual([])
    expect(await countRows('billing_customer')).toBe(0)
  })

  it('refuse un appel anonyme avant d’atteindre le gestionnaire', async () => {
    const response = await call('checkout', { body: { offerId: 'pro-monthly' } })

    expect(response.status).toBe(401)
    expect(calls).toEqual([])
  })

  it('résout la quantité côté serveur pour une offre au siège', async () => {
    seats = 7
    responses = [
      () => json({ id: 'cus_s19', object: 'customer' }),
      () =>
        json({
          id: 'cs_s19',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s19',
          customer: 'cus_s19',
        }),
    ]

    await call('checkout', {
      session: { userId: 'usr_s19', roles: [] },
      body: { offerId: 'team-monthly' },
    })

    expect(new URLSearchParams(calls.at(-1)?.body ?? '').get('line_items[0][quantity]')).toBe('7')
  })
})

describe.runIf(databaseReachable)('le portail client', () => {
  it('refuse quand aucun client n’existe encore', async () => {
    const response = await call('portal', { session: { userId: 'usr_s19', roles: [] } })

    expect(response.status).toBe(409)
    expect(calls).toEqual([])
  })

  it('rend l’URL du portail quand un client existe', async () => {
    responses = [
      () => json({ id: 'cus_s19', object: 'customer' }),
      () =>
        json({
          id: 'cs_s19',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s19',
          customer: 'cus_s19',
        }),
      () =>
        json({
          id: 'bps_s19',
          object: 'billing_portal.session',
          url: 'https://billing.stripe.com/p/session/s19',
        }),
    ]

    await call('checkout', {
      session: { userId: 'usr_s19', roles: [] },
      body: { offerId: 'pro-monthly' },
    })

    const response = await call('portal', { session: { userId: 'usr_s19', roles: [] } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      url: 'https://billing.stripe.com/p/session/s19',
    })
  })

  it('refuse celui qui n’a pas le droit de gérer la facturation', async () => {
    permitted = false

    const response = await call('portal', { session: { userId: 'usr_s19', roles: [] } })

    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })
})

describe.runIf(databaseReachable)('le webhook entrant', () => {
  const PERIOD_END = 1_800_000_000

  const linkCustomer = async (): Promise<void> => {
    responses = [
      () => json({ id: 'cus_s19', object: 'customer' }),
      () =>
        json({
          id: 'cs_s19',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s19',
          customer: 'cus_s19',
        }),
    ]

    await call('checkout', {
      session: { userId: 'usr_s19', roles: [] },
      body: { offerId: 'pro-monthly' },
    })
  }

  it('refuse une signature invalide en 400, **sans rien écrire**', async () => {
    await linkCustomer()

    const payload = eventPayload({
      id: 'evt_s19_forge',
      type: 'customer.subscription.created',
      created: 1_788_000_000,
      object: subscriptionObject({ customer: 'cus_s19', periodEnd: PERIOD_END }),
    })

    const response = await deliver(payload, 'whsec_autre')

    expect(response.status).toBe(400)
    // Ni journal, ni état : la vérification a lieu **avant** tout effet de bord.
    expect(await countRows('billing_webhook_event')).toBe(0)
    expect(await countRows('billing_subscription')).toBe(0)
  })

  it('refuse une signature absente en 400', async () => {
    const response = await call('webhook', {
      raw: eventPayload({
        id: 'evt_s19_nu',
        type: 'customer.subscription.created',
        created: 1_788_000_000,
        object: subscriptionObject({ customer: 'cus_s19', periodEnd: PERIOD_END }),
      }),
    })

    expect(response.status).toBe(400)
    expect(await countRows('billing_webhook_event')).toBe(0)
  })

  it('écrit l’état de l’abonnement et le rejeu ne produit **aucun** effet supplémentaire', async () => {
    await linkCustomer()

    const payload = eventPayload({
      id: 'evt_s19_created',
      type: 'customer.subscription.created',
      created: 1_788_000_000,
      object: subscriptionObject({ customer: 'cus_s19', periodEnd: PERIOD_END, quantity: 3 }),
    })

    const first = await deliver(payload)

    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toMatchObject({ applied: true })
    expect(await countRows('billing_subscription')).toBe(1)

    // **Le rejeu**, mot pour mot, signature comprise.
    const second = await deliver(payload)

    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toMatchObject({ applied: false })
    expect(await countRows('billing_subscription')).toBe(1)
    expect(await countRows('billing_webhook_event')).toBe(1)
    expect((await storedSubscription())?.['quantity']).toBe(3)
  })

  /**
   * **Le désordre**, joué : le changement d'abonnement arrive avant la session
   * de checkout qui l'a causé. Le rattachement ayant eu lieu à l'ouverture du
   * checkout (ADR 034), l'état est écrit quand même.
   */
  it('applique un changement d’abonnement livré avant sa session de checkout', async () => {
    await linkCustomer()

    const subscriptionEvent = eventPayload({
      id: 'evt_s19_sub_avant',
      type: 'customer.subscription.updated',
      created: 1_788_000_100,
      object: subscriptionObject({ customer: 'cus_s19', periodEnd: PERIOD_END }),
    })
    const checkoutEvent = eventPayload({
      id: 'evt_s19_checkout_apres',
      type: 'checkout.session.completed',
      created: 1_788_000_000,
      object: {
        id: 'cs_s19',
        object: 'checkout.session',
        mode: 'subscription',
        customer: 'cus_s19',
        subscription: 'sub_s19_1',
        client_reference_id: 'organization:org_s19',
      },
    })

    await deliver(subscriptionEvent)
    await deliver(checkoutEvent)

    expect(await countRows('billing_subscription')).toBe(1)
    expect((await storedSubscription())?.['status']).toBe('active')
  })

  it('n’écrase pas l’état courant avec un événement plus ancien', async () => {
    await linkCustomer()

    await deliver(
      eventPayload({
        id: 'evt_s19_recent',
        type: 'customer.subscription.updated',
        created: 1_788_000_200,
        object: subscriptionObject({
          customer: 'cus_s19',
          periodEnd: PERIOD_END,
          quantity: 5,
          status: 'active',
        }),
      }),
    )

    await deliver(
      eventPayload({
        id: 'evt_s19_ancien',
        type: 'customer.subscription.updated',
        created: 1_788_000_100,
        object: subscriptionObject({
          customer: 'cus_s19',
          periodEnd: PERIOD_END,
          quantity: 1,
          status: 'canceled',
        }),
      }),
    )

    const stored = await storedSubscription()

    expect(stored?.['quantity']).toBe(5)
    expect(stored?.['status']).toBe('active')
    // L'ancien est **journalisé** : il ne sera pas rejoué pour rien.
    expect(await countRows('billing_webhook_event')).toBe(2)
  })

  it('applique un événement du même instant', async () => {
    await linkCustomer()

    const at = 1_788_000_300

    await deliver(
      eventPayload({
        id: 'evt_s19_a',
        type: 'customer.subscription.updated',
        created: at,
        object: subscriptionObject({ customer: 'cus_s19', periodEnd: PERIOD_END, quantity: 2 }),
      }),
    )
    await deliver(
      eventPayload({
        id: 'evt_s19_b',
        type: 'customer.subscription.updated',
        created: at,
        object: subscriptionObject({ customer: 'cus_s19', periodEnd: PERIOD_END, quantity: 4 }),
      }),
    )

    expect((await storedSubscription())?.['quantity']).toBe(4)
  })

  it('journalise un événement dont le client est inconnu, sans rien écrire', async () => {
    // Le cas d'un abonnement créé depuis le tableau de bord du fournisseur : la
    // réconciliation le rattrapera, et le rejeu n'a pas à retraverser la chaîne.
    const response = await deliver(
      eventPayload({
        id: 'evt_s19_orphelin',
        type: 'customer.subscription.created',
        created: 1_788_000_400,
        object: subscriptionObject({ customer: 'cus_inconnu', periodEnd: PERIOD_END }),
      }),
    )

    expect(response.status).toBe(200)
    expect(await countRows('billing_webhook_event')).toBe(1)
    expect(await countRows('billing_subscription')).toBe(0)
  })

  it('marque le paiement en retard sur un échec de facture', async () => {
    await linkCustomer()

    await deliver(
      eventPayload({
        id: 'evt_s19_ok',
        type: 'customer.subscription.created',
        created: 1_788_000_000,
        object: subscriptionObject({ customer: 'cus_s19', periodEnd: PERIOD_END }),
      }),
    )

    await deliver(
      eventPayload({
        id: 'evt_s19_echec',
        type: 'invoice.payment_failed',
        created: 1_788_000_500,
        object: {
          id: 'in_s19',
          object: 'invoice',
          customer: 'cus_s19',
          subscription: 'sub_s19_1',
        },
      }),
    )

    expect((await storedSubscription())?.['status']).toBe('past_due')
  })

  it('accepte un type qu’il ne traite pas, et le journalise quand même', async () => {
    const response = await deliver(
      eventPayload({
        id: 'evt_s19_autre',
        type: 'invoice.created',
        created: 1_788_000_600,
        object: { id: 'in_s19_2', object: 'invoice' },
      }),
    )

    expect(response.status).toBe(200)
    expect(await countRows('billing_webhook_event')).toBe(1)
  })
})

describe.runIf(databaseReachable)('la vue de l’écran', () => {
  it('dit « aucun abonnement » et propose les offres', async () => {
    const view = await requireBillingService().useCases.view({
      session: { userId: 'usr_s19', roles: [] },
      locale: 'fr',
    })

    expect(view.state).toBe('none')
    expect(view.hasAccess).toBe(false)
    expect(view.offers.map((offer) => offer.id)).toEqual(['pro-monthly', 'team-monthly'])
    expect(view.hasCustomer).toBe(false)
  })

  it('dit « paiement échoué » après un échec de facture', async () => {
    responses = [
      () => json({ id: 'cus_s19', object: 'customer' }),
      () =>
        json({
          id: 'cs_s19',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s19',
          customer: 'cus_s19',
        }),
    ]
    await call('checkout', {
      session: { userId: 'usr_s19', roles: [] },
      body: { offerId: 'pro-monthly' },
    })
    await deliver(
      eventPayload({
        id: 'evt_s19_pastdue',
        type: 'customer.subscription.updated',
        created: 1_788_000_700,
        object: subscriptionObject({
          customer: 'cus_s19',
          periodEnd: Math.floor(clock.getTime() / 1000) + 86_400,
          status: 'past_due',
        }),
      }),
    )

    const view = await requireBillingService().useCases.view({
      session: { userId: 'usr_s19', roles: [] },
      locale: 'fr',
    })

    expect(view.state).toBe('past_due')
    expect(view.subscription?.offerId).toBe('pro-monthly')
  })
})

/* -------------------------------------------------------------------------- *
 * Le client qui se réabonne — **constat F1 de la revue**.
 *
 * Un client qui annule puis souscrit à nouveau a deux lignes en cache. La
 * lecture en prenait une au hasard du moteur, et l'écran disait « expiré » à
 * quelqu'un qui venait de payer. Ce bloc joue le parcours complet, jusqu'à ce
 * que l'écran lit.
 * -------------------------------------------------------------------------- */
describe.runIf(databaseReachable)('un client qui se réabonne', () => {
  const PERIOD_END = 1_900_000_000

  const openCheckout = async (): Promise<void> => {
    responses = [
      () => json({ id: 'cus_s19', object: 'customer' }),
      () =>
        json({
          id: 'cs_s19',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s19',
          customer: 'cus_s19',
        }),
    ]

    await call('checkout', {
      session: { userId: 'usr_s19', roles: [] },
      body: { offerId: 'pro-monthly' },
    })
  }

  const currentView = async () =>
    await requireBillingService().useCases.view({
      session: { userId: 'usr_s19', roles: [] },
      locale: 'fr',
    })

  it('souscrit, annule, se réabonne — et l’écran dit « actif », pas « expiré »', async () => {
    await openCheckout()

    await deliver(
      eventPayload({
        id: 'evt_s19_ancien_cree',
        type: 'customer.subscription.created',
        created: 1_788_100_000,
        object: subscriptionObject({ id: 'sub_ancien', customer: 'cus_s19', periodEnd: PERIOD_END }),
      }),
    )
    await deliver(
      eventPayload({
        id: 'evt_s19_ancien_supprime',
        type: 'customer.subscription.deleted',
        created: 1_788_100_100,
        object: subscriptionObject({
          id: 'sub_ancien',
          customer: 'cus_s19',
          periodEnd: PERIOD_END,
          status: 'canceled',
        }),
      }),
    )
    await deliver(
      eventPayload({
        id: 'evt_s19_neuf_cree',
        type: 'customer.subscription.created',
        created: 1_788_100_200,
        object: subscriptionObject({
          id: 'sub_neuf',
          customer: 'cus_s19',
          periodEnd: PERIOD_END,
          quantity: 3,
        }),
      }),
    )

    // Les deux lignes existent : l'historique n'est pas effacé, c'est la
    // lecture qui décide.
    expect(await countRows('billing_subscription')).toBe(2)

    const view = await currentView()

    expect(view.state).toBe('active')
    expect(view.hasAccess).toBe(true)
    expect(view.subscription?.quantity).toBe(3)
  })

  /**
   * **Le cas que l'ordre seul ne tranche pas.** L'ancien abonnement est annulé
   * *après* que le neuf a été ouvert : son événement est donc le plus récent.
   * Trier par horodatage et prendre la première ligne rejouerait le défaut.
   */
  it('reste actif quand l’annulation de l’ancien arrive en dernier', async () => {
    await openCheckout()

    await deliver(
      eventPayload({
        id: 'evt_s19_double_neuf',
        type: 'customer.subscription.created',
        created: 1_788_200_000,
        object: subscriptionObject({ id: 'sub_neuf', customer: 'cus_s19', periodEnd: PERIOD_END }),
      }),
    )
    await deliver(
      eventPayload({
        id: 'evt_s19_double_ancien',
        type: 'customer.subscription.deleted',
        created: 1_788_200_500,
        object: subscriptionObject({
          id: 'sub_ancien',
          customer: 'cus_s19',
          periodEnd: PERIOD_END,
          status: 'canceled',
        }),
      }),
    )

    const view = await currentView()

    expect(view.state).toBe('active')
    expect(view.hasAccess).toBe(true)
  })

  /**
   * Quand **aucun** ne donne plus l'accès, c'est le plus récemment changé qui
   * s'affiche — et cet ordre vient de la requête, pas de l'ordre d'insertion
   * que PostgreSQL rend par défaut.
   */
  it('affiche le dernier abonnement en date quand tous sont terminés', async () => {
    await openCheckout()

    await deliver(
      eventPayload({
        id: 'evt_s19_fini_ancien',
        type: 'customer.subscription.deleted',
        created: 1_788_300_000,
        object: subscriptionObject({
          id: 'sub_ancien',
          customer: 'cus_s19',
          periodEnd: PERIOD_END,
          status: 'canceled',
          quantity: 1,
        }),
      }),
    )
    await deliver(
      eventPayload({
        id: 'evt_s19_fini_neuf',
        type: 'customer.subscription.deleted',
        created: 1_788_300_500,
        object: subscriptionObject({
          id: 'sub_neuf',
          customer: 'cus_s19',
          periodEnd: PERIOD_END,
          status: 'canceled',
          quantity: 9,
        }),
      }),
    )

    const view = await currentView()

    expect(view.state).toBe('expired')
    expect(view.hasAccess).toBe(false)
    expect(view.subscription?.quantity).toBe(9)
  })

  /**
   * **La réconciliation fabriquait le même état** : elle liste *tous* les
   * statuts du fournisseur, donc l'historique complet. Elle doit laisser le
   * cache lisible.
   */
  it('reste actif après une réconciliation qui relit tout l’historique', async () => {
    await openCheckout()

    responses = [
      () =>
        json({
          object: 'list',
          has_more: false,
          data: [
            subscriptionObject({
              id: 'sub_ancien',
              customer: 'cus_s19',
              periodEnd: PERIOD_END,
              status: 'canceled',
            }),
            subscriptionObject({
              id: 'sub_neuf',
              customer: 'cus_s19',
              periodEnd: PERIOD_END,
              quantity: 4,
            }),
          ],
        }),
    ]

    await requireBillingService().useCases.reconcile()

    const view = await currentView()

    expect(view.state).toBe('active')
    expect(view.hasAccess).toBe(true)
    expect(view.subscription?.quantity).toBe(4)
  })

  it('exporte tous les abonnements du périmètre, le courant en tête', async () => {
    await openCheckout()

    await deliver(
      eventPayload({
        id: 'evt_s19_export_ancien',
        type: 'customer.subscription.deleted',
        created: 1_788_400_000,
        object: subscriptionObject({
          id: 'sub_ancien',
          customer: 'cus_s19',
          periodEnd: PERIOD_END,
          status: 'canceled',
        }),
      }),
    )
    await deliver(
      eventPayload({
        id: 'evt_s19_export_neuf',
        type: 'customer.subscription.created',
        created: 1_788_400_100,
        object: subscriptionObject({
          id: 'sub_neuf',
          customer: 'cus_s19',
          periodEnd: PERIOD_END,
          quantity: 5,
        }),
      }),
    )

    const exported = await requireBillingService().useCases.export({
      kind: 'organization',
      organizationId: 'org_s19',
    })

    // **Les deux lignes**, l'abonnement courant d'abord (constat m3 de la
    // seconde revue). Le contrat dit « rend les données du périmètre » : un
    // export qui n'en rend qu'une sur N invente un filtre que personne n'a
    // décidé, et le portable n'y retrouverait pas son historique.
    expect(exported['subscriptions']).toEqual([
      expect.objectContaining({ status: 'active', quantity: 5 }),
      expect.objectContaining({ status: 'canceled' }),
    ])
  })

  /* ------------------------------------------------------------------------ *
   * **Le bouton qui facture deux fois** — constat M3 de la seconde revue.
   *
   * `checkout.sessions.create({ mode: 'subscription' })` crée **toujours** un
   * abonnement de plus chez le fournisseur : le SDK n'offre aucun paramètre de
   * remplacement. Un abonné qui cliquait la seconde offre se retrouvait donc
   * avec deux abonnements prélevés, dont l'écran n'en montrait qu'un — le
   * second devenait invisible dans l'application.
   *
   * Le sixième critère de la story confie le changement d'offre au **portail**.
   * Le catalogue ne l'ouvre donc plus à qui a déjà un abonnement vivant, et la
   * garde est **côté serveur** : masquer un bouton n'est pas une permission
   * (`docs/security.md` §3).
   * ------------------------------------------------------------------------ */
  const anActiveSubscription = async (): Promise<void> => {
    await openCheckout()

    await deliver(
      eventPayload({
        id: 'evt_s19_double_facturation',
        type: 'customer.subscription.created',
        created: 1_788_500_000,
        object: subscriptionObject({ id: 'sub_vivant', customer: 'cus_s19', periodEnd: PERIOD_END }),
      }),
    )
  }

  it('refuse un second checkout à qui a déjà un abonnement vivant, sans appeler le fournisseur', async () => {
    await anActiveSubscription()

    calls.length = 0
    responses = []

    const response = await call('checkout', {
      session: { userId: 'usr_s19', roles: [] },
      body: { offerId: 'team-monthly' },
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: BILLING_KEYS.refusal.alreadySubscribed })
    // Un refus qui atteint le fournisseur n'est pas un refus : c'est déjà un
    // second abonnement ouvert.
    expect(calls).toEqual([])
    expect(await countRows('billing_subscription')).toBe(1)
  })

  it('rouvre le catalogue quand l’abonnement ne donne plus l’accès', async () => {
    await anActiveSubscription()

    await deliver(
      eventPayload({
        id: 'evt_s19_double_facturation_fin',
        type: 'customer.subscription.deleted',
        created: 1_788_500_100,
        object: subscriptionObject({
          id: 'sub_vivant',
          customer: 'cus_s19',
          periodEnd: PERIOD_END,
          status: 'canceled',
        }),
      }),
    )

    calls.length = 0
    responses = [
      () =>
        json({
          id: 'cs_s19_reabonnement',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s19_reabonnement',
          customer: 'cus_s19',
        }),
    ]

    const response = await call('checkout', {
      session: { userId: 'usr_s19', roles: [] },
      body: { offerId: 'team-monthly' },
    })

    expect(response.status).toBe(200)
  })
})

describe.runIf(databaseReachable)('l’index qui porte l’ordre de lecture', () => {
  /**
   * **Un index qui ne sert pas la requête qui l'a motivé est une affirmation
   * fausse**, en plus d'être inutile (constat m1 de la seconde revue).
   *
   * `.desc()` fait écrire `DESC NULLS LAST` à Drizzle dans une définition
   * d'index, tandis que `desc(colonne)` émet `DESC` — donc `NULLS FIRST` — dans
   * une requête. Les clés de tri ne correspondaient jamais, et le planificateur
   * empilait un `Sort` par-dessus l'index. Le déterminisme venait de
   * l'`ORDER BY` seul ; les trois colonnes ajoutées à l'index ne servaient rien,
   * pendant que `schema.ts` affirmait le contraire.
   *
   * L'ordre mesuré est **celui du dépôt** (`subscriptionReadOrder`), pas une
   * recopie : deux écritures divergeraient, et c'est la mesure qui mentirait.
   *
   * **Deux stratégies sont coupées le temps de la transaction**, et il faut les
   * deux : sur une table de quelques lignes, le planificateur balaye
   * (`enable_seqscan`), et à défaut il prend un parcours d'index **par bitmap**,
   * qui ne rend aucun ordre et retrie toujours (`enable_bitmapscan`) — mesuré
   * sur une base fraîchement migrée, où ce second chemin faisait échouer le cas
   * pour une raison qui n'était pas la sienne. Ce qui est mesuré est donc :
   * « quand l'index est parcouru dans l'ordre, suffit-il ? ».
   */
  it('sert l’ordre du dépôt, sans que le planificateur ait à retrier', async () => {
    const query = connection.db
      .select({ providerSubscriptionId: billingSubscription.providerSubscriptionId })
      .from(billingSubscription)
      .where(eq(billingSubscription.billingCustomerId, 'bc_s19_explain'))
      .orderBy(...subscriptionReadOrder)
      .toSQL()

    const plan = await connection.db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`)
      await tx.execute(sql`set local enable_bitmapscan = off`)

      const explained = await tx.execute<{ 'QUERY PLAN': string }>(
        sql.raw(`explain ${query.sql.replace(/\$1/, `'bc_s19_explain'`)}`),
      )

      return explained.rows.map((row) => row['QUERY PLAN']).join('\n')
    })

    expect(plan).toContain('billing_subscription_customer_idx')
    expect(plan).not.toContain('Sort')
  })
})

describe.runIf(databaseReachable)('la réconciliation', () => {
  const subscribe = async (): Promise<void> => {
    responses = [
      () => json({ id: 'cus_s19', object: 'customer' }),
      () =>
        json({
          id: 'cs_s19',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s19',
          customer: 'cus_s19',
        }),
    ]

    await call('checkout', {
      session: { userId: 'usr_s19', roles: [] },
      body: { offerId: 'pro-monthly' },
    })
  }

  it('rattrape un abonnement qu’aucun webhook n’a apporté, puis ne change plus rien', async () => {
    await subscribe()

    const listed = (): Response =>
      json({
        object: 'list',
        has_more: false,
        data: [subscriptionObject({ customer: 'cus_s19', periodEnd: 1_800_000_000, quantity: 2 })],
      })

    responses = [listed]

    const first = await requireBillingService().useCases.reconcile()

    expect(first).toEqual({ customers: 1, changed: 1 })
    expect(await countRows('billing_subscription')).toBe(1)

    // **Rejouée** : le fournisseur dit la même chose, rien n'est réécrit.
    responses = [listed]

    const second = await requireBillingService().useCases.reconcile()

    expect(second).toEqual({ customers: 1, changed: 0 })
  })
})

describe.runIf(databaseReachable)('la purge et l’export', () => {
  it('efface le périmètre, abonnement compris, et la purge rejouée n’efface plus rien', async () => {
    responses = [
      () => json({ id: 'cus_s19', object: 'customer' }),
      () =>
        json({
          id: 'cs_s19',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s19',
          customer: 'cus_s19',
        }),
    ]
    await call('checkout', {
      session: { userId: 'usr_s19', roles: [] },
      body: { offerId: 'pro-monthly' },
    })
    await deliver(
      eventPayload({
        id: 'evt_s19_purge',
        type: 'customer.subscription.created',
        created: 1_788_000_800,
        object: subscriptionObject({ customer: 'cus_s19', periodEnd: 1_800_000_000 }),
      }),
    )

    const scope: ModuleScope = { kind: 'organization', organizationId: 'org_s19' }

    const exported = await requireBillingService().useCases.export(scope)

    expect(exported['subscriptions']).toHaveLength(1)

    await requireBillingService().useCases.purge(scope)

    expect(await countRows('billing_customer')).toBe(0)
    // La clé étrangère `on delete cascade` reste **dans** le module (ADR 018).
    expect(await countRows('billing_subscription')).toBe(0)

    await requireBillingService().useCases.purge(scope)

    expect(await countRows('billing_customer')).toBe(0)
  })
})

/* -------------------------------------------------------------------------- *
 * La permission, **du rôle en base jusqu'au refus de la route** — constat F3 de
 * la revue.
 *
 * Ce que la suite prouvait déjà : que la matrice de s17 distingue les rôles
 * (chez elle, `organization-rules.test.ts`), et que les routes appellent le
 * prédicat qu'on leur injecte. Ce qu'elle ne prouvait pas : **le fil entre les
 * deux**. `apps/web/lib/billing.ts#canManage` neutralisé en `return true` —
 * c'est-à-dire tout membre annulant l'abonnement de son organisation — laissait
 * 1 298 tests verts.
 *
 * `docs/security.md` §3 : « chaque combinaison rôle × action sensible est
 * couverte par un test d'API ». La forme est celle de s17
 * (`tests/organizations.test.ts`) : un rôle **réel en base**, la vraie vue du
 * module `organizations`, et le refus mesuré à la route.
 * -------------------------------------------------------------------------- */
describe.runIf(databaseReachable)('le droit de gérer la facturation', () => {
  const SENSITIVE = ['checkout', 'portal'] as const

  /** Le prédicat **de production**, branché sur la vraie vue des organisations. */
  const realPermission = billingPermissionOf({
    available: true,
    view: async (userId) => await organizationsService.useCases.viewOrganizations(userId),
  })

  it('refuse les deux portes à un simple membre, sans écrire ni appeler', async () => {
    const { other, organizationId } = await anOrganizationWithRole('member')

    currentScope = { kind: 'organization', organizationId }
    permission = realPermission

    const refusals = await Promise.all(
      SENSITIVE.map(async (path) =>
        await call(path, { session: other, body: { offerId: 'pro-monthly' } }),
      ),
    )

    expect(refusals.map((response) => response.status)).toEqual([403, 403])
    // Un refus qui atteint la donnée ou le fournisseur n'est pas un refus.
    expect(calls).toEqual([])
    expect(await countRows('billing_customer')).toBe(0)
  })

  it('laisse passer le propriétaire et l’administrateur', async () => {
    for (const role of ['owner', 'admin'] as const) {
      const { other, organizationId } = await anOrganizationWithRole(role)

      currentScope = { kind: 'organization', organizationId }
      permission = realPermission
      responses = [
        () => json({ id: 'cus_s19', object: 'customer' }),
        () =>
          json({
            id: 'cs_s19',
            object: 'checkout.session',
            url: 'https://checkout.stripe.com/c/pay/cs_s19',
            customer: 'cus_s19',
          }),
      ]

      const response = await call('checkout', {
        session: other,
        body: { offerId: 'pro-monthly' },
      })

      expect(response.status, role).toBe(200)

      await cleanup()
    }
  })

  it('accorde tout au compte quand les organisations sont coupées, sans rien leur demander', async () => {
    // Critère 7 de s17 : sans organisation, le compte est propriétaire de sa
    // donnée. Le prédicat ne doit alors poser aucune question au module.
    const asked: string[] = []
    const withoutOrganizations = billingPermissionOf({
      available: false,
      view: (userId) => {
        asked.push(userId)

        return Promise.resolve(EMPTY_ORGANIZATIONS_VIEW)
      },
    })

    expect(await withoutOrganizations({ kind: 'user', userId: 'usr_s19' }, 'usr_s19')).toBe(true)
    expect(
      await withoutOrganizations({ kind: 'organization', organizationId: 'org_s19' }, 'usr_s19'),
    ).toBe(true)
    expect(asked).toEqual([])
  })
})

/* -------------------------------------------------------------------------- *
 * **Le point de composition de l'application** (`apps/web/lib/billing.ts`).
 *
 * Le bloc précédent éprouve la **règle** ; celui-ci éprouve le **fil**. La
 * distinction n'est pas théorique : la première revue avait posé ses deux
 * mutations majeures ici — `canManage` neutralisé en `() => true`,
 * `emailOfScope` ramené à `null` —, le tour de correction les a refermées dans
 * le voisin et dans le module, et la seconde revue les a reposées **au point de
 * composition** où vivait le défaut : 1 320 cas sur 1 320 verts, deux fois
 * (constats M1 et M2).
 *
 * Ce que ce bloc branche est donc le vrai objet `billing` : son `ownerOf` est
 * `dataOwnerOf`, son `canManage` est `billingPermissionOf(organizations)`, son
 * `emailOfScope` va lire l'adresse par `lib/auth`, son catalogue est
 * `config/billing.ts`. Seuls la base, le port et l'URL publique lui sont donnés
 * — c'est-à-dire exactement ce qu'il irait chercher dans l'ambiance.
 *
 * **Il ne rejoue pas la matrice de rôles** : elle appartient au bloc précédent,
 * et la rejouer ici multiplierait la même décision par une porte de plus. Un
 * refus témoin suffit à prouver que la règle est appelée.
 *
 * Il ne s'exécute que si les deux modules sont activés dans la configuration du
 * dépôt : sans `organizations`, tout périmètre est un compte et la permission
 * n'a personne à qui poser la question. La configuration « socle » de la CI le
 * saute donc, comme `tests/organizations.test.ts` saute les siens.
 * -------------------------------------------------------------------------- */
const compositionMeasurable = databaseReachable && appBilling.available && appOrganizations.available

describe.runIf(compositionMeasurable)('le point de composition de l’application', () => {
  /** L'offre du catalogue **livré**, celui que le point de composition donne. */
  const SHIPPED_OFFER = billingOffers[0].id

  beforeAll(() => {
    // `emailOfScope` construit l'authentification de l'application à la
    // demande, et elle lit ces variables. Le job de CI ne les pose pas : il ne
    // monte aucun serveur pour `pnpm test`.
    vi.stubEnv('AUTH_SECRET', 'x'.repeat(40))
    vi.stubEnv('APP_URL', APP_URL)
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_FROM', '')
    vi.stubEnv('EMAIL_LOCAL_CAPTURE', '1')
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    // `lib/auth` a ouvert sa propre connexion, par `getDatabase()` : sans cette
    // fermeture, le processus de test ne rend jamais la main.
    await closeDatabase()
  })

  beforeEach(() => {
    resetBillingService()
    appBilling.prepare({ db: connection.db, payments, appUrl: APP_URL })
  })

  afterEach(() => {
    // La suite retrouve **son** service : les blocs suivants pilotent le
    // périmètre et la permission par leurs variables.
    resetBillingService()
    configureBilling(suiteBilling())
  })

  it('refuse au simple membre les deux portes, sans écrire ni appeler', async () => {
    const { other } = await anOrganizationWithRole('member')

    const refusals = await Promise.all(
      ['checkout', 'portal'].map(
        async (path) =>
          await call(path as 'checkout' | 'portal', {
            session: other,
            body: { offerId: SHIPPED_OFFER },
          }),
      ),
    )

    expect(refusals.map((response) => response.status)).toEqual([403, 403])
    // Un refus qui atteint la donnée ou le fournisseur n'est pas un refus.
    expect(calls).toEqual([])
    expect(await countRows('billing_customer')).toBe(0)
  })

  it('donne au fournisseur l’adresse du compte qui ouvre le checkout', async () => {
    const email = `s19-composition-${randomUUID()}@example.test`
    const { other } = await anOrganizationWithRole('owner', email)

    responses = [
      () => json({ id: 'cus_s19_composition', object: 'customer' }),
      () =>
        json({
          id: 'cs_s19_composition',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s19_composition',
          customer: 'cus_s19_composition',
        }),
    ]

    const response = await call('checkout', { session: other, body: { offerId: SHIPPED_OFFER } })

    expect(response.status).toBe(200)
    // Ce que le **réseau** a vu partir : l'adresse est celle du compte appelant,
    // résolue par `lib/auth` à partir de son seul identifiant.
    expect(new URLSearchParams(calls[0]?.body ?? '').get('email')).toBe(email)
  })
})

describe('un module de facturation non activé', () => {
  it('déclare pourtant bien des routes et une entrée de navigation', () => {
    expect(billingModule.routes.length).toBeGreaterThan(0)
    expect(billingModule.navigation.length).toBeGreaterThan(0)
  })

  it('n’expose aucune route : le webhook déclaré répond 404', async () => {
    const response = await dispatchModuleRequest(
      withoutBilling,
      new Request(`${APP_URL}${billingRoutePath('webhook')}`, { method: 'POST', body: '{}' }),
    )

    expect(response.status).toBe(404)
  })

  it('n’apparaît dans aucune entrée de navigation', () => {
    expect(withoutBilling.navigation.map((entry) => entry.moduleId)).not.toContain('billing')
  })

  it('ne laisse aucune traduction dans le catalogue', () => {
    const keys = Object.values(withoutBilling.messages).flatMap((catalog) => Object.keys(catalog))

    expect(keys.filter((key) => key.startsWith('billing.'))).toEqual([])
  })
})

/* -------------------------------------------------------------------------- *
 * L'écran, sur ce qu'il **décide** — constat F5 de la revue.
 *
 * `OfferView.current` était calculé, typé, exporté… et jamais lu : l'offre déjà
 * souscrite affichait encore « Souscrire », et cliquer rouvrait un checkout —
 * c'est-à-dire le chemin qui fabrique la seconde ligne de F1. Rien d'autre du
 * rendu n'est mesuré ici : le texte l'est par `tests/rendered-text.test.ts`, et
 * la mise en page au navigateur.
 * -------------------------------------------------------------------------- */
describe('l’offre déjà souscrite', () => {
  const offerView = (id: string, current: boolean) => ({
    id,
    price: '29,00 €',
    interval: 'month' as const,
    trialDays: null,
    perSeat: false,
    current,
  })

  const render = (offers: readonly ReturnType<typeof offerView>[], hasAccess = false): string =>
    renderToStaticMarkup(
      createElement(BillingScreen, {
        view: { ...EMPTY_BILLING_VIEW, offers, hasAccess, canManage: true },
        intl: { t: (key: string) => key, formatDate: () => '1 janvier 2026' },
        manageAction: createElement('span', null, 'action:gerer'),
        subscribeActions: Object.fromEntries(
          offers.map((offer) => [offer.id, createElement('span', null, `action:${offer.id}`)]),
        ),
        checkoutOutcome: null,
      }),
    )

  it('ne propose plus aucune souscription à qui a déjà l’accès', () => {
    const markup = render([offerView('pro-monthly', true), offerView('pro-yearly', false)], true)

    expect(markup).not.toContain('action:pro-monthly')
    // **Ni l'autre offre** (constat M3) : la souscrire ouvrirait un second
    // abonnement facturé, que l'écran ne saurait même pas afficher.
    expect(markup).not.toContain('action:pro-yearly')
    // L'offre en cours est **nommée**, pas seulement privée de son bouton : une
    // carte sans rien ne dirait pas pourquoi.
    expect(markup).toContain(BILLING_KEYS.currentOffer)
    // Et les autres disent par où passe un changement d'offre : le portail.
    expect(markup).toContain(BILLING_KEYS.changeThroughPortal)
  })

  it('propose de souscrire chacune des offres quand aucune n’est en cours', () => {
    const markup = render([offerView('pro-monthly', false), offerView('pro-yearly', false)])

    expect(markup).toContain('action:pro-monthly')
    expect(markup).toContain('action:pro-yearly')
    expect(markup).not.toContain(BILLING_KEYS.currentOffer)
  })

  it('rouvre l’offre expirée : c’est la même carte qui sert à se réabonner', () => {
    // Sans accès, l'abonnement passé ne ferme rien — c'est le parcours « annuler
    // puis se réabonner » du constat F1, et la carte doit reprendre son bouton.
    const markup = render([offerView('pro-monthly', true), offerView('pro-yearly', false)], false)

    expect(markup).toContain('action:pro-monthly')
    expect(markup).toContain('action:pro-yearly')
    expect(markup).not.toContain(BILLING_KEYS.currentOffer)
  })
})

describe('les traductions du module', () => {
  /**
   * Le catalogue **du module**, lu dans un registre que ce fichier construit.
   *
   * Pas celui de l'application : les traductions d'un module coupé n'y sont
   * pas — c'est la promesse du produit —, et l'assertion deviendrait une
   * mesure de `config/features.ts` au lieu d'une mesure du module. Mesuré :
   * les deux cas ci-dessous rougissaient dans la configuration où `billing`
   * est désactivé, sans qu'aucune traduction ne manque.
   */
  const catalogueFor = (locale: string): Readonly<Record<string, string>> =>
    registry.messages[locale] ?? {}

  /**
   * **Une clé d'offre absente est un écran en 500**, pas un texte manquant :
   * aucune traduction ne se replie sur sa clé depuis s09. Les clés d'offre sont
   * **composées** depuis `config/billing.ts`, donc invisibles au balayage
   * statique de `tests/i18n.test.ts`. Ce cas est ce qui les couvre.
   */
  it('livre le nom et la description de chaque offre déclarée, dans chaque langue', () => {
    const declared = parseBillingCatalogue([...billingOffers])

    for (const locale of appLocales) {
      const catalogue = catalogueFor(locale)

      for (const offer of declared) {
        expect(catalogue[offerNameKey(offer.id)], `${locale} / ${offer.id}`).toBeDefined()
        expect(catalogue[offerDescriptionKey(offer.id)], `${locale} / ${offer.id}`).toBeDefined()
      }
    }
  })

  it('livre un titre et une description **distincts** pour chacun des six états', () => {
    const states = [
      'none',
      'trialing',
      'active',
      'ending',
      'past_due',
      'expired',
    ] as const

    for (const locale of appLocales) {
      const catalogue = catalogueFor(locale)
      const titles = states.map((state) => catalogue[stateTitleKey(state)])

      expect(titles.every((title) => title !== undefined), locale).toBe(true)
      // Le critère est la **distinction** : six libellés identiques
      // satisferaient « chaque état a un texte » sans rien dire à personne.
      expect(new Set(titles).size, locale).toBe(states.length)
    }
  })
})
