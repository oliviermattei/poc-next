import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { parseEnv, type Env } from '@repo/config'
import {
  buildRegistry,
  dispatchModuleRequest,
  visibleNavigation,
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
import { authModule, authUser, safeRedirectPath } from '@repo/module-auth'
import {
  BILLING_KEYS,
  BILLING_SCREEN_PATH,
  PRICING_SCREEN_PATH,
  billingModule,
  formatOfferPrice,
  offerById,
  billingRoutePath,
  billingPurchase,
  billingSubscription,
  configureBilling,
  EMPTY_BILLING_VIEW,
  offerDescriptionKey,
  offerNameKey,
  parseBillingCatalogue,
  purchaseReadOrder,
  requireBillingService,
  resetBillingService,
  stateTitleKey,
  subscriptionReadOrder,
  type BillingPermission,
  type BillingView,
  type ConfigureBillingOptions,
  type ScopeSeats,
} from '@repo/module-billing'
import {
  configureOrganizations,
  EMPTY_ORGANIZATIONS_VIEW,
  organizationMember,
  organizationsModule,
  resetOrganizationsService,
  type ConfigureOrganizationsOptions,
  type OrganizationRole,
  type OrganizationsService,
  type SeatSync,
} from '@repo/module-organizations'
import { BillingScreen } from '@repo/module-billing/presentation'
import { demoEnabledModule } from '@repo/module-demo-enabled'
import { eq, sql } from 'drizzle-orm'
import { NextIntlClientProvider } from 'next-intl'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Stripe from 'stripe'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { billing as appBilling } from '../apps/web/lib/billing'
import { LOCAL_WEBHOOK_SECRET, resolveBillingConfig } from '../apps/web/lib/billing-config'
import { billingPermissionOf } from '../apps/web/lib/billing-permission'
import { entitlements as appEntitlements } from '../apps/web/lib/entitlements'
import { featureGates } from '../apps/web/lib/feature-gates'
import { organizations as appOrganizations } from '../apps/web/lib/organizations'
import { seatSyncOf, type SeatSyncBilling } from '../apps/web/lib/seat-sync'
import { localeRouting } from '../apps/web/lib/locale-routing'
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
  /**
   * La **seconde** offre d'abonnement à essai, comme `config/billing.ts` en
   * porte une : sans elle, « ne réaccorde pas l'essai sur une autre offre » ne
   * pouvait que rouvrir la même, et le cas était un doublon (constat m3 de la
   * revue).
   */
  {
    id: 'pro-yearly',
    mode: 'subscription',
    priceId: 'price_pro_yearly',
    amount: 29_000,
    currency: 'eur',
    interval: 'year',
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
  // s20 — l'offre **unique** : ni périodicité, ni essai. Le catalogue refuse
  // les deux pour ce mode, au démarrage.
  {
    id: 'lifetime',
    mode: 'one_time',
    priceId: 'price_lifetime',
    amount: 49_000,
    currency: 'eur',
    interval: null,
    trialDays: null,
    perSeat: false,
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

/**
 * s23 — **ce que le module `organizations` fait traverser avant de valider une
 * écriture d'appartenance** (ADR 046).
 *
 * Par défaut, un accord qui n'appelle personne : la plupart des cas de ce
 * fichier mesurent autre chose. Le bloc « la quantité facturée suit les
 * membres » y branche la **vraie** synchronisation, celle que
 * `apps/web/lib/organizations.ts` compose.
 */
const seatSyncCalls: { organizationId: string; seats: number }[] = []
let seatSync: SeatSync = async (change) => {
  seatSyncCalls.push({ ...change })

  return true
}

/** s23 — le nombre de membres que la réconciliation lira. `null` : aucun nombre. */
let scopeSeats: ScopeSeats = () => Promise.resolve(null)

/** Le courrier sortant du module `organizations` : c'est lui qui porte le jeton. */
const invitationOutbox = createRecordingMailer()

interface RecordedCall {
  readonly url: string
  readonly body: string
  /**
   * Les en-têtes que le SDK a posés — c'est là que vit la **clé
   * d'idempotence** (s23). Sans elle, un cas ne peut pas distinguer « deux
   * appels qui visent le même état » de « deux écritures ».
   */
  readonly headers: Record<string, string>
}

const calls: RecordedCall[] = []
let responses: (() => Response)[] = []

/**
 * La doublure du **réseau** : elle enregistre la requête sérialisée par le SDK
 * et rend la réponse programmée. Doubler le port lui-même n'éprouverait ni la
 * sérialisation, ni les en-têtes, ni le traitement de la réponse.
 */
const fetchDouble: typeof fetch = async (input, init) => {
  calls.push({
    url: String(input),
    body: typeof init?.body === 'string' ? init.body : '',
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
  })

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

/**
 * Les deux lectures d'achats que la réconciliation fait **avant** celle des
 * abonnements — sessions, puis charges — quand le client n'en a aucun.
 *
 * Écrites une fois : la doublure de réseau est une file, et chaque cas qui
 * réconcilie doit décrire tous les appels, dans l'ordre.
 */
const noPurchases = (): readonly (() => Response)[] => [
  () => json({ object: 'list', has_more: false, data: [] }),
  () => json({ object: 'list', has_more: false, data: [] }),
]

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
  seatsOfScope: async (scope) => await scopeSeats(scope),
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
  // Le journal des remboursements est **hors périmètre**, comme celui des
  // événements : il n'a pas de client, donc la cascade ne l'emporte pas. Sans
  // cette ligne, un `pi_life_1` remboursé par un cas révoquerait l'achat des
  // cas suivants, qui réemploient le même identifiant de paiement.
  await connection.db.execute(sql`delete from billing_refunded_payment`)
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
    mailer: invitationOutbox,
    appUrl: APP_URL,
    emailLocale: defaultLocale,
    now: () => clock,
    // s23 : le module ne sait pas qu'il existe une facturation. Il sait qu'une
    // écriture d'appartenance peut être refusée par l'extérieur, et il lui
    // donne le nombre de membres qu'elle produirait.
    seatSync: async (change) => await seatSync(change),
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
  seatSyncCalls.length = 0
  seatSync = async (change) => {
    seatSyncCalls.push({ ...change })

    return true
  }
  scopeSeats = () => Promise.resolve(null)
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
    expect(view.offers.map((offer) => offer.id)).toEqual([
      'pro-monthly',
      'pro-yearly',
      'team-monthly',
      'lifetime',
    ])
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
      ...noPurchases(),
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

    responses = [...noPurchases(), listed]

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

  /**
   * **Le compteur serveur et celui du checkout comptent la même chose** (s23).
   *
   * `seatsOf` — la quantité envoyée au fournisseur à l'ouverture d'un
   * checkout — dérive de `organizations.view(userId).members`, la vue **du
   * compte courant**. `countMembers(organizationId)` part d'un identifiant
   * d'organisation, parce que la réconciliation n'a pas de compte. Deux
   * chemins, un seul nombre : s'ils divergeaient, une facture corrigée par
   * `pnpm billing:reconcile` contredirait celle ouverte au checkout.
   */
  it('compte les mêmes membres par l’organisation que par le compte', async () => {
    const { other, organizationId } = await anOrganizationWithRole('owner')

    const seen = (await appOrganizations.view(other.userId)).members.length

    // Le propriétaire fondateur et le compte de ce cas : sans cette ligne, le
    // cas serait vert sur deux zéros.
    expect(seen).toBe(2)
    expect(await appOrganizations.countMembers(organizationId)).toBe(seen)
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

  /**
   * **Le droit d'accès de l'application vient de la facturation montée** (s21).
   *
   * L'autre moitié du sixième critère — module coupé, tout est accordé — vit
   * dans `tests/entitlements.test.ts`, qui n'a besoin d'aucune base. Celle-ci a
   * besoin des trois : une vraie session, un vrai client, un vrai abonnement.
   */
  it('n’ouvre la fonctionnalité réservée qu’une fois l’offre détenue', async () => {
    const { other } = await anOrganizationWithRole('owner')

    responses = [
      () => json({ id: 'cus_s21_composition', object: 'customer' }),
      () =>
        json({
          id: 'cs_s21_composition',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s21_composition',
          customer: 'cus_s21_composition',
        }),
    ]

    expect(
      (await call('checkout', { session: other, body: { offerId: SHIPPED_OFFER } })).status,
    ).toBe(200)

    // Le client existe chez le fournisseur, **rien n'est encore payé** : aucune
    // fonctionnalité réservée n'est ouverte. Un checkout ouvert n'est pas un
    // droit.
    expect(await appEntitlements.featuresOf(other)).toEqual(new Set())

    await deliver(
      eventPayload({
        id: `evt_s21_composition_${randomUUID()}`,
        type: 'customer.subscription.updated',
        created: 1_788_000_000,
        object: subscriptionObject({
          customer: 'cus_s21_composition',
          periodEnd: 1_790_000_000,
          priceId: billingOffers[0].priceId,
        }),
      }),
    )

    // Ce que l'offre livrée ouvre est **dérivé** de `config/gating.ts`, jamais
    // recopié : ajouter une fonctionnalité à cette offre ne fait pas rougir ce
    // cas, en retirer la déclaration si.
    const opened = featureGates()
      .filter((gate) => gate.offers.includes(SHIPPED_OFFER))
      .map((gate) => gate.id)

    expect(opened.length).toBeGreaterThan(0)
    expect(await appEntitlements.featuresOf(other)).toEqual(new Set(opened))
  })
})

/* -------------------------------------------------------------------------- *
 * s20 — **l'achat unique**, contre la vraie base et à travers le répartiteur.
 *
 * L'invariant que ce bloc existe pour tenir : *on ne facture pas deux fois le
 * même acte d'achat*. Il est éprouvé trois fois, parce qu'il a trois manières
 * de casser — un événement rejoué, deux ouvertures simultanées, et une seconde
 * ligne écrite en base.
 * -------------------------------------------------------------------------- */
describe.runIf(databaseReachable)('l’achat unique', () => {
  const SESSION = { userId: 'usr_s19', roles: [] }
  const CUSTOMER = 'cus_s20'

  const sessionObject = (id: string): Record<string, unknown> => ({
    id,
    object: 'checkout.session',
    url: `https://checkout.stripe.com/c/pay/${id}`,
    customer: CUSTOMER,
  })

  /** Ouvre le checkout de l'offre unique. Le client n'est créé qu'au premier. */
  const openPurchase = async (
    sessionId = 'cs_life_1',
    options: { readonly withCustomer?: boolean } = {},
  ): Promise<Response> => {
    responses = [
      ...(options.withCustomer === false ? [] : [() => json({ id: CUSTOMER, object: 'customer' })]),
      () => json(sessionObject(sessionId)),
    ]

    return await call('checkout', { session: SESSION, body: { offerId: 'lifetime' } })
  }

  const paidEvent = (input: {
    readonly id: string
    readonly sessionId: string
    readonly created: number
    readonly paymentId?: string
    readonly amountTotal?: number
  }): string =>
    eventPayload({
      id: input.id,
      type: 'checkout.session.completed',
      created: input.created,
      object: {
        id: input.sessionId,
        object: 'checkout.session',
        mode: 'payment',
        payment_status: 'paid',
        customer: CUSTOMER,
        payment_intent: input.paymentId ?? 'pi_life_1',
        amount_total: input.amountTotal ?? 49_000,
        currency: 'eur',
        client_reference_id: 'organization:org_s19',
      },
    })

  const refundEvent = (input: {
    readonly id: string
    readonly created: number
    readonly amountRefunded: number
    readonly paymentId?: string
  }): string =>
    eventPayload({
      id: input.id,
      type: 'charge.refunded',
      created: input.created,
      object: {
        id: 'ch_life_1',
        object: 'charge',
        payment_intent: input.paymentId ?? 'pi_life_1',
        amount: 49_000,
        amount_refunded: input.amountRefunded,
      },
    })

  const purchases = async (): Promise<readonly Record<string, unknown>[]> =>
    (
      await connection.db.execute<Record<string, unknown>>(
        sql`select * from billing_purchase order by created_at`,
      )
    ).rows

  const view = async () =>
    await requireBillingService().useCases.view({ session: SESSION, locale: 'fr' })

  it('ouvre un paiement, jamais un abonnement, et écrit l’achat **avant** l’URL', async () => {
    const response = await openPurchase()

    expect(response.status).toBe(200)

    // Ce que le serveur a décidé, envoyé au fournisseur : le mode vient du
    // catalogue, pas de la requête, et aucune donnée d'abonnement ne part.
    const sent = new URLSearchParams(calls.at(-1)?.body ?? '')

    expect(sent.get('mode')).toBe('payment')
    expect(sent.get('line_items[0][price]')).toBe('price_lifetime')
    expect(sent.get('subscription_data[trial_period_days]')).toBeNull()

    // **La ligne existe déjà**, en attente, et elle porte l'offre — que la
    // confirmation ne dira pas (ADR 038 §1).
    const rows = await purchases()

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      offer_id: 'lifetime',
      status: 'pending',
      provider_session_id: 'cs_life_1',
    })

    // Un achat en attente n'accorde rien et n'est pas un paiement : il
    // n'apparaît pas dans l'historique.
    const screen = await view()

    expect(screen.hasAccess).toBe(false)
    expect(screen.purchases).toEqual([])
  })

  it('accorde un droit permanent à la confirmation, et le rejeu n’en accorde pas un second', async () => {
    await openPurchase()

    const payload = paidEvent({ id: 'evt_life_paid', sessionId: 'cs_life_1', created: 1_788_100_000 })
    const first = await deliver(payload)
    const replayed = await deliver(payload)

    expect(await first.json()).toEqual({ received: true, applied: true })
    // **Le septième critère** : un événement rejoué n'accorde pas un second
    // droit — le journal le refuse, et il n'y a de toute façon qu'une ligne.
    expect(await replayed.json()).toEqual({ received: true, applied: false })

    const rows = await purchases()

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      status: 'paid',
      provider_payment_id: 'pi_life_1',
      amount: 49_000,
      currency: 'eur',
    })

    const screen = await view()

    // **Un droit permanent, sans aucun abonnement** (critères 2 et 3) : aucune
    // date n'y entre, et l'état d'abonnement reste « aucun ».
    expect(screen.hasAccess).toBe(true)
    expect(screen.hasSubscription).toBe(false)
    expect(screen.state).toBe('none')
    expect(screen.purchases).toHaveLength(1)
    expect(screen.purchases[0]).toMatchObject({ offerId: 'lifetime', refunded: false })
    // Le montant vient du **fournisseur**, formaté pour l'affichage.
    expect(screen.purchases[0]?.price).toContain('490')
    // Quatrième critère : rien à gérer au portail pour un acheteur unique pur.
    expect(screen.canOpenPortal).toBe(false)
    expect(screen.hasCustomer).toBe(true)
  })

  it('dit « offre retirée du catalogue » pour un achat dont l’offre a disparu', async () => {
    await openPurchase()
    await deliver(paidEvent({ id: 'evt_life_paid7', sessionId: 'cs_life_1', created: 1_788_101_300 }))

    // L'offre est retirée de `config/billing.ts` : la ligne reste, et la vue ne
    // doit **pas** rendre un identifiant qu'aucun catalogue de traduction ne
    // connaît — le traducteur lève sur une clé absente depuis s09.
    await connection.db.execute(
      sql`update billing_purchase set offer_id = 'offre-disparue' where offer_id = 'lifetime'`,
    )

    const screen = await view()

    expect(screen.purchases[0]?.offerId).toBeNull()
    // Le droit, lui, survit : c'est un achat payé, pas une ligne de catalogue.
    expect(screen.hasAccess).toBe(true)
  })

  it('n’écrit rien pour une session qu’il n’a pas ouverte, et journalise quand même', async () => {
    await openPurchase()

    const response = await deliver(
      paidEvent({ id: 'evt_life_inconnu', sessionId: 'cs_jamais_ouverte', created: 1_788_100_100 }),
    )

    expect(await response.json()).toEqual({ received: true, applied: true })
    expect((await purchases())[0]).toMatchObject({ status: 'pending' })
  })

  it('n’applique pas une confirmation plus ancienne que ce qui est déjà écrit', async () => {
    await openPurchase()
    await deliver(paidEvent({ id: 'evt_life_a', sessionId: 'cs_life_1', created: 1_788_100_300 }))
    await deliver(
      paidEvent({
        id: 'evt_life_b',
        sessionId: 'cs_life_1',
        created: 1_788_100_200,
        paymentId: 'pi_perime',
        amountTotal: 1,
      }),
    )

    // Le désordre de livraison est absorbé par le prédicat d'écriture, comme
    // pour un abonnement (ADR 034 §2).
    expect((await purchases())[0]).toMatchObject({ provider_payment_id: 'pi_life_1', amount: 49_000 })
  })

  /* ------------------------------------------------------------------------ *
   * La session supplantée (constat C1 de la revue).
   * ------------------------------------------------------------------------ */

  it('rattache le paiement d’une session supplantée par une seconde ouverture', async () => {
    await openPurchase('cs_life_1')
    await openPurchase('cs_life_2', { withCustomer: false })

    // **Ce que la ligne porte après une seconde ouverture**, que rien ne
    // fixait : la dernière session ouverte. La revue l'a établi par une
    // mutation verte — remplacer l'écriture par un `do nothing` laissait la
    // suite entière au vert.
    expect((await purchases())[0]).toMatchObject({
      provider_session_id: 'cs_life_2',
      status: 'pending',
    })

    // L'utilisateur revient en arrière et paie la **première** session, restée
    // payable chez le fournisseur. Le paiement encaissé doit accorder le droit,
    // pas se perdre parce que la ligne ne porte plus cette session-là.
    const response = await deliver(
      paidEvent({ id: 'evt_life_supplante', sessionId: 'cs_life_1', created: 1_788_102_000 }),
    )

    expect(await response.json()).toEqual({ received: true, applied: true })

    const rows = await purchases()

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'paid', provider_payment_id: 'pi_life_1' })
    expect((await view()).hasAccess).toBe(true)

    // Et le second prélèvement est fermé : l'offre est possédée, donc refusée
    // **avant** tout appel sortant.
    calls.length = 0
    responses = []

    const refused = await call('checkout', { session: SESSION, body: { offerId: 'lifetime' } })

    expect(refused.status).toBe(409)
    expect(calls).toHaveLength(0)
  })

  /* ------------------------------------------------------------------------ *
   * La fenêtre de bascule du déploiement (constat C4 de la seconde revue).
   *
   * `docs/reliability.md` décrit une migration appliquée **avant** que le
   * trafic ne bascule : pendant cet intervalle, la version encore en ligne
   * ouvre des checkouts en n'écrivant que `billing_purchase.provider_session_id`
   * — elle ne connaît pas l'index inverse. Le rattrapage de la migration `0004`
   * ne reprend que les sessions présentes à l'instant où elle passe.
   *
   * L'ancien emplacement est donc **relu tant que la transition dure** : c'est
   * ce que « ajouter avant de lire » demande. Les deux cas ci-dessous
   * reproduisent cette fenêtre en effaçant l'index inverse — l'état exact que
   * l'ancienne version laisse — et exigent que les **deux** chemins retrouvent
   * l'achat.
   * ------------------------------------------------------------------------ */

  /** L'état qu'un checkout ouvert par la version précédente laisse en base. */
  const asOpenedByPreviousVersion = async (): Promise<void> => {
    await connection.db.execute(sql`delete from billing_purchase_session`)
  }

  it('confirme un checkout ouvert par la version précédente, pendant la bascule', async () => {
    await openPurchase('cs_life_bascule')
    await asOpenedByPreviousVersion()

    const response = await deliver(
      paidEvent({ id: 'evt_life_bascule', sessionId: 'cs_life_bascule', created: 1_788_104_000 }),
    )

    expect(await response.json()).toEqual({ received: true, applied: true })

    const rows = await purchases()

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'paid', provider_payment_id: 'pi_life_1' })
    expect((await view()).hasAccess).toBe(true)
  })

  it('réconcilie un checkout ouvert par la version précédente, pendant la bascule', async () => {
    await openPurchase('cs_life_bascule')
    await asOpenedByPreviousVersion()

    responses = [
      () =>
        json({
          object: 'list',
          has_more: false,
          data: [
            {
              id: 'cs_life_bascule',
              object: 'checkout.session',
              mode: 'payment',
              payment_status: 'paid',
              payment_intent: 'pi_bascule',
              amount_total: 49_000,
              currency: 'eur',
            },
          ],
        }),
      () => json({ object: 'list', has_more: false, data: [] }),
      () => json({ object: 'list', has_more: false, data: [] }),
    ]

    expect((await requireBillingService().useCases.reconcile()).changed).toBe(1)
    expect((await purchases())[0]).toMatchObject({
      status: 'paid',
      provider_payment_id: 'pi_bascule',
    })
  })

  /* ------------------------------------------------------------------------ *
   * Le remboursement (critère 5).
   * ------------------------------------------------------------------------ */

  it('révoque le droit sur un remboursement total', async () => {
    await openPurchase()
    await deliver(paidEvent({ id: 'evt_life_paid2', sessionId: 'cs_life_1', created: 1_788_100_400 }))
    await deliver(refundEvent({ id: 'evt_life_refund', created: 1_788_100_500, amountRefunded: 49_000 }))

    expect((await purchases())[0]).toMatchObject({ status: 'refunded' })

    const screen = await view()

    expect(screen.hasAccess).toBe(false)
    // L'achat reste dans l'historique, avec son statut : le paiement a eu lieu.
    expect(screen.purchases[0]).toMatchObject({ refunded: true })
    // Et l'offre redevient achetable.
    expect(screen.offers.find((offer) => offer.id === 'lifetime')?.owned).toBe(false)
  })

  it('laisse le droit sur un geste commercial partiel', async () => {
    await openPurchase()
    await deliver(paidEvent({ id: 'evt_life_paid3', sessionId: 'cs_life_1', created: 1_788_100_600 }))

    const response = await deliver(
      refundEvent({ id: 'evt_life_partiel', created: 1_788_100_700, amountRefunded: 100 }),
    )

    // Journalisé — donc non rejoué — et sans effet (ADR 038 §3).
    expect(await response.json()).toEqual({ received: true, applied: true })
    expect((await purchases())[0]).toMatchObject({ status: 'paid' })
    expect((await view()).hasAccess).toBe(true)
  })

  it('applique un remboursement livré **avant** la confirmation qu’il annule', async () => {
    await openPurchase()

    // Le remboursement arrive le premier — le désordre que l'ADR 034 déclare
    // possible, et que les reprises de livraison du fournisseur produisent. La
    // ligne n'a pas encore de paiement : `charge.refunded` ne porte que
    // celui-ci, donc rien ne l'y rattache.
    const refunded = await deliver(
      refundEvent({ id: 'evt_life_refund_avant', created: 1_788_102_300, amountRefunded: 49_000 }),
    )

    expect(await refunded.json()).toEqual({ received: true, applied: true })
    expect((await purchases())[0]).toMatchObject({ status: 'pending' })

    // La confirmation suit, et elle est **plus ancienne** : le paiement a bien
    // eu lieu avant son remboursement, seule la livraison était inversée. Elle
    // ne doit pas accorder l'accès à un achat intégralement remboursé.
    await deliver(
      paidEvent({ id: 'evt_life_paid_apres', sessionId: 'cs_life_1', created: 1_788_102_200 }),
    )

    const rows = await purchases()

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'refunded' })
    expect(rows[0]?.['refunded_at']).not.toBeNull()

    const screen = await view()

    expect(screen.hasAccess).toBe(false)
    expect(screen.purchases[0]).toMatchObject({ refunded: true })
  })

  it('remboursé puis racheté : la ligne repayée ne porte plus la date de remboursement', async () => {
    await openPurchase()
    await deliver(paidEvent({ id: 'evt_life_cycle_paid', sessionId: 'cs_life_1', created: 1_788_102_400 }))
    await deliver(refundEvent({ id: 'evt_life_cycle_refund', created: 1_788_102_500, amountRefunded: 49_000 }))

    // L'offre est redevenue achetable (ADR 038 §3) : le rachat rouvre **la
    // même ligne**, et il ouvre une nouvelle session chez le fournisseur.
    await openPurchase('cs_life_rachat', { withCustomer: false })

    expect((await purchases())[0]).toMatchObject({
      status: 'pending',
      refunded_at: null,
      provider_payment_id: null,
      amount: null,
      purchased_at: null,
    })

    await deliver(
      paidEvent({
        id: 'evt_life_cycle_repaid',
        sessionId: 'cs_life_rachat',
        created: 1_788_102_600,
        paymentId: 'pi_life_rachat',
      }),
    )

    const scope: ModuleScope = { kind: 'organization', organizationId: 'org_s19' }
    const exported = (await requireBillingService().useCases.export(scope)) as {
      readonly purchases: readonly Record<string, unknown>[]
    }

    // **Ce que l'export dit du périmètre** : un achat payé, et rien qui
    // prétende qu'il a été remboursé. Le cycle précédent est clos, pas
    // superposé au neuf.
    expect(exported.purchases).toHaveLength(1)
    expect(exported.purchases[0]).toMatchObject({ status: 'paid', refundedAt: null })
    expect((await view()).hasAccess).toBe(true)
  })

  /* ------------------------------------------------------------------------ *
   * L'invariant central : jamais deux fois pour le même acte d'achat.
   * ------------------------------------------------------------------------ */

  it('refuse un second achat de la même offre, **sans appeler le fournisseur**', async () => {
    await openPurchase()
    await deliver(paidEvent({ id: 'evt_life_paid4', sessionId: 'cs_life_1', created: 1_788_100_800 }))

    calls.length = 0
    responses = []

    const refused = await call('checkout', { session: SESSION, body: { offerId: 'lifetime' } })

    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: BILLING_KEYS.refusal.alreadyPurchased })
    // Rien n'est parti chez le fournisseur : le refus est **avant** l'appel.
    expect(calls).toHaveLength(0)
    expect(await purchases()).toHaveLength(1)
  })

  it('converge sur une seule ligne quand deux ouvertures partent en même temps', async () => {
    await openPurchase()

    responses = [() => json(sessionObject('cs_life_2')), () => json(sessionObject('cs_life_3'))]

    const [first, second] = await Promise.all([
      call('checkout', { session: SESSION, body: { offerId: 'lifetime' } }),
      call('checkout', { session: SESSION, body: { offerId: 'lifetime' } }),
    ])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    // **Une contrainte d'unicité, pas une lecture** : les deux ouvertures
    // convergent, et le périmètre ne peut pas se retrouver avec deux achats de
    // la même offre.
    expect(await purchases()).toHaveLength(1)
  })

  it('refuse **par le moteur** une seconde ligne pour la même offre', async () => {
    await openPurchase()

    const stored = (await purchases())[0]

    await expect(
      connection.db.execute(sql`
        insert into billing_purchase (id, billing_customer_id, offer_id, price_id, provider_session_id, status)
        values ('bp_double', ${String(stored?.['billing_customer_id'])}, 'lifetime', 'price_lifetime', 'cs_double', 'paid')
      `),
    ).rejects.toThrow()
  })

  /* ------------------------------------------------------------------------ *
   * Le cumul (critère 6) : les deux fermetures ne se regardent pas.
   * ------------------------------------------------------------------------ */

  it('laisse s’abonner un acheteur à vie, et acheter à vie un abonné', async () => {
    await openPurchase()
    await deliver(paidEvent({ id: 'evt_life_paid5', sessionId: 'cs_life_1', created: 1_788_100_900 }))

    // L'accès consolidé est déjà accordé, et pourtant la souscription passe.
    responses = [() => json(sessionObject('cs_sub_apres'))]

    const subscribed = await call('checkout', {
      session: SESSION,
      body: { offerId: 'pro-monthly' },
    })

    expect(subscribed.status).toBe(200)

    await deliver(
      eventPayload({
        id: 'evt_life_sub',
        type: 'customer.subscription.created',
        created: 1_788_101_000,
        object: subscriptionObject({
          customer: CUSTOMER,
          periodEnd: Math.floor(clock.getTime() / 1000) + 86_400,
        }),
      }),
    )

    // **Aucun des deux n'a écrasé l'autre** : deux tables, deux lignes.
    const screen = await view()

    expect(screen.hasSubscription).toBe(true)
    expect(screen.hasAccess).toBe(true)
    expect(screen.subscription?.offerId).toBe('pro-monthly')
    expect(screen.purchases).toHaveLength(1)
    expect(await countRows('billing_subscription')).toBe(1)
    expect(await purchases()).toHaveLength(1)
  })

  it('n’oppose pas l’abonnement en cours à l’achat unique', async () => {
    // L'abonné a l'accès : `already_subscribed` fermerait le catalogue si la
    // garde regardait l'accès consolidé au lieu des seuls abonnements.
    responses = [() => json({ id: CUSTOMER, object: 'customer' }), () => json(sessionObject('cs_sub_1'))]
    await call('checkout', { session: SESSION, body: { offerId: 'pro-monthly' } })
    await deliver(
      eventPayload({
        id: 'evt_life_sub2',
        type: 'customer.subscription.created',
        created: 1_788_101_100,
        object: subscriptionObject({
          customer: CUSTOMER,
          periodEnd: Math.floor(clock.getTime() / 1000) + 86_400,
        }),
      }),
    )

    responses = [() => json(sessionObject('cs_life_9'))]

    const bought = await call('checkout', { session: SESSION, body: { offerId: 'lifetime' } })

    expect(bought.status).toBe(200)
    expect(await purchases()).toHaveLength(1)
  })

  /* ------------------------------------------------------------------------ *
   * La permission, la purge, la réconciliation.
   * ------------------------------------------------------------------------ */

  it('refuse l’achat à qui n’a pas le droit de gérer la facturation, sans appeler', async () => {
    permitted = false
    calls.length = 0

    const refused = await call('checkout', { session: SESSION, body: { offerId: 'lifetime' } })

    expect(refused.status).toBe(403)
    expect(calls).toHaveLength(0)
    expect(await purchases()).toHaveLength(0)
  })

  it('efface les achats avec le périmètre, et l’export les rend', async () => {
    await openPurchase()
    await deliver(paidEvent({ id: 'evt_life_paid6', sessionId: 'cs_life_1', created: 1_788_101_200 }))

    const scope: ModuleScope = { kind: 'organization', organizationId: 'org_s19' }
    const exported = (await requireBillingService().useCases.export(scope)) as {
      readonly purchases: readonly Record<string, unknown>[]
    }

    expect(exported.purchases).toHaveLength(1)
    expect(exported.purchases[0]).toMatchObject({ offerId: 'lifetime', status: 'paid' })

    await requireBillingService().useCases.purge(scope)

    // La clé étrangère reste **à l'intérieur du module** : les achats partent
    // par la cascade, comme les abonnements.
    expect(await purchases()).toHaveLength(0)
  })

  /**
   * **L'inventaire déclaré ne doit pas mentir** (constat m9 de la seconde
   * revue).
   *
   * `dataCategories` déclarait `billing-customer` et `subscription` alors que le
   * module stockait des achats, que l'export les rend et que la purge les
   * efface. Aucune donnée ne survivait — c'est l'inventaire qui était faux —,
   * et c'est lui que liront s34 et s35 : `retention` n'est contrainte que par ce
   * que `dataCategories` déclare.
   *
   * L'exigence est **dérivée** de ce que l'export rend, jamais recopiée d'une
   * liste : une collection ajoutée à l'export sans sa catégorie fait rougir ce
   * cas. Le singulier est dérivé du pluriel de la clé, ce qui est la convention
   * de nommage de ce contrat (`subscriptions` → `subscription`).
   */
  it('déclare une catégorie et une rétention pour chaque collection que l’export rend', async () => {
    await openPurchase()
    await deliver(paidEvent({ id: 'evt_life_paid8', sessionId: 'cs_life_1', created: 1_788_105_000 }))

    const exported = (await requireBillingService().useCases.export({
      kind: 'organization',
      organizationId: 'org_s19',
    })) as Record<string, unknown>

    const collections = Object.entries(exported)
      .filter(([, value]) => Array.isArray(value))
      .map(([key]) => key)

    // Le cas ne vaut que s'il voit quelque chose : un export vide le rendrait
    // vert sans rien exiger.
    expect(collections.length).toBeGreaterThan(1)

    for (const collection of collections) {
      const category = collection.replace(/s$/, '')

      expect(billingModule.dataCategories).toContain(category)
      expect(billingModule.retention).toHaveProperty(category)
    }
  })

  it('rattrape un achat qu’aucun webhook n’a confirmé, puis ne change plus rien', async () => {
    await openPurchase()

    responses = [
      // L'ordre des appels : la lecture des achats d'abord — sessions, puis
      // charges —, celle des abonnements ensuite.
      () =>
        json({
          object: 'list',
          has_more: false,
          data: [
            {
              id: 'cs_life_1',
              object: 'checkout.session',
              mode: 'payment',
              payment_status: 'paid',
              payment_intent: 'pi_reconcile',
              amount_total: 49_000,
              currency: 'eur',
            },
          ],
        }),
      () => json({ object: 'list', has_more: false, data: [] }),
      // Les abonnements : aucun.
      () => json({ object: 'list', has_more: false, data: [] }),
    ]

    const first = await requireBillingService().useCases.reconcile()

    expect(first.changed).toBe(1)
    expect((await purchases())[0]).toMatchObject({ status: 'paid', provider_payment_id: 'pi_reconcile' })

    responses = [
      () =>
        json({
          object: 'list',
          has_more: false,
          data: [
            {
              id: 'cs_life_1',
              object: 'checkout.session',
              mode: 'payment',
              payment_status: 'paid',
              payment_intent: 'pi_reconcile',
              amount_total: 49_000,
              currency: 'eur',
            },
          ],
        }),
      () => json({ object: 'list', has_more: false, data: [] }),
      () => json({ object: 'list', has_more: false, data: [] }),
    ]

    // **Rejouée, elle ne change rien** : c'est ce que le compte prouve
    // (`docs/reliability.md` §1).
    expect((await requireBillingService().useCases.reconcile()).changed).toBe(0)
  })

  /**
   * **La réconciliation répare ce que le constat C1 déclarait irréparable**
   * (constat C3 de la seconde revue).
   *
   * L'index inverse est interrogé à deux endroits — la confirmation et cette
   * commande —, et seul le premier était exigé par un cas : résoudre l'achat
   * par la colonne dans la réconciliation laissait 82 cas sur 82 au vert. C'est
   * ce cas-ci qui rougit alors.
   *
   * Le scénario est celui de C1 sans aucun webhook : deux ouvertures, la
   * **première** encaissée chez le fournisseur, la colonne de l'achat portant
   * désormais la seconde.
   */
  it('retrouve un achat par une session supplantée, qu’aucun webhook n’a confirmé', async () => {
    await openPurchase('cs_life_1')
    await openPurchase('cs_life_2', { withCustomer: false })

    expect((await purchases())[0]).toMatchObject({
      provider_session_id: 'cs_life_2',
      status: 'pending',
    })

    responses = [
      () =>
        json({
          object: 'list',
          has_more: false,
          data: [
            {
              id: 'cs_life_1',
              object: 'checkout.session',
              mode: 'payment',
              payment_status: 'paid',
              payment_intent: 'pi_supplante',
              amount_total: 49_000,
              currency: 'eur',
            },
          ],
        }),
      () => json({ object: 'list', has_more: false, data: [] }),
      () => json({ object: 'list', has_more: false, data: [] }),
    ]

    expect((await requireBillingService().useCases.reconcile()).changed).toBe(1)
    expect((await purchases())[0]).toMatchObject({
      status: 'paid',
      provider_payment_id: 'pi_supplante',
    })
    expect((await view()).hasAccess).toBe(true)
  })

  it('ne rétrograde pas un achat payé à cause de la session abandonnée du même achat', async () => {
    // Deux ouvertures, donc deux sessions rattachées au **même** achat depuis
    // le constat C1. Le fournisseur en rend une encaissée et une abandonnée :
    // la seconde ne doit pas défaire ce que la première a promu.
    await openPurchase('cs_life_1')
    await openPurchase('cs_life_2', { withCustomer: false })
    await deliver(paidEvent({ id: 'evt_life_rec_2s', sessionId: 'cs_life_1', created: 1_788_103_400 }))

    const listing = (): Response =>
      json({
        object: 'list',
        has_more: false,
        data: [
          {
            id: 'cs_life_1',
            object: 'checkout.session',
            mode: 'payment',
            payment_status: 'paid',
            payment_intent: 'pi_life_1',
            amount_total: 49_000,
            currency: 'eur',
          },
          {
            id: 'cs_life_2',
            object: 'checkout.session',
            mode: 'payment',
            payment_status: 'unpaid',
            amount_total: 49_000,
            currency: 'eur',
          },
        ],
      })

    responses = [
      listing,
      () => json({ object: 'list', has_more: false, data: [] }),
      () => json({ object: 'list', has_more: false, data: [] }),
    ]

    expect((await requireBillingService().useCases.reconcile()).changed).toBe(0)
    expect((await purchases())[0]).toMatchObject({ status: 'paid' })
    expect((await view()).hasAccess).toBe(true)
  })

  it('ne ré-accorde pas un achat remboursé dont la charge est introuvable', async () => {
    await openPurchase()
    await deliver(paidEvent({ id: 'evt_life_rec_paid', sessionId: 'cs_life_1', created: 1_788_103_000 }))
    await deliver(
      refundEvent({ id: 'evt_life_rec_refund', created: 1_788_103_100, amountRefunded: 49_000 }),
    )

    expect((await purchases())[0]).toMatchObject({ status: 'refunded' })

    responses = [
      // La session est bien encaissée chez le fournisseur — un remboursement ne
      // la rend pas impayée.
      () =>
        json({
          object: 'list',
          has_more: false,
          data: [
            {
              id: 'cs_life_1',
              object: 'checkout.session',
              mode: 'payment',
              payment_status: 'paid',
              payment_intent: 'pi_life_1',
              amount_total: 49_000,
              currency: 'eur',
            },
          ],
        }),
      // **Aucune charge relue** : au-delà du plafond de pagination, ou en mode
      // local, où le montant prélevé n'existe pas. « Charge introuvable » n'est
      // pas « rien n'a été remboursé ».
      () => json({ object: 'list', has_more: false, data: [] }),
      () => json({ object: 'list', has_more: false, data: [] }),
    ]

    expect((await requireBillingService().useCases.reconcile()).changed).toBe(0)
    expect((await purchases())[0]).toMatchObject({ status: 'refunded' })
    expect((await view()).hasAccess).toBe(false)
  })

  /**
   * **Deux sessions payées pour le même achat, et la commande reste rejouable**
   * (constat m7 de la seconde revue).
   *
   * La fenêtre laissée ouverte — deux onglets, deux sessions vivantes — autorise
   * deux prélèvements. Le droit reste juste, mais les deux lectures se
   * départagent sur le paiement : chaque passage réécrivait alternativement
   * l'une puis l'autre, `changed: 2` **indéfiniment**, là où
   * `docs/reliability.md` §1 exige qu'un second passage n'ait aucun effet
   * supplémentaire.
   */
  it('reste rejouable quand deux sessions du même achat sont payées', async () => {
    await openPurchase('cs_life_1')
    await openPurchase('cs_life_2', { withCustomer: false })

    const listing = (): Response =>
      json({
        object: 'list',
        has_more: false,
        data: [
          {
            id: 'cs_life_1',
            object: 'checkout.session',
            mode: 'payment',
            payment_status: 'paid',
            payment_intent: 'pi_deux_a',
            amount_total: 49_000,
            currency: 'eur',
          },
          {
            id: 'cs_life_2',
            object: 'checkout.session',
            mode: 'payment',
            payment_status: 'paid',
            payment_intent: 'pi_deux_b',
            amount_total: 49_000,
            currency: 'eur',
          },
        ],
      })

    responses = [
      listing,
      () => json({ object: 'list', has_more: false, data: [] }),
      () => json({ object: 'list', has_more: false, data: [] }),
    ]

    // **Une lecture qui tranche consomme l'achat pour ce passage** : la
    // première dans l'ordre du fournisseur l'emporte, et l'ordre est le sien —
    // pas celui d'un tirage.
    expect((await requireBillingService().useCases.reconcile()).changed).toBe(1)
    expect((await purchases())[0]).toMatchObject({
      status: 'paid',
      provider_payment_id: 'pi_deux_a',
    })

    responses = [
      listing,
      () => json({ object: 'list', has_more: false, data: [] }),
      () => json({ object: 'list', has_more: false, data: [] }),
    ]

    expect((await requireBillingService().useCases.reconcile()).changed).toBe(0)
    expect((await purchases())[0]).toMatchObject({ provider_payment_id: 'pi_deux_a' })
  })

  /**
   * **La réconciliation rejoue le journal des remboursements**, comme la
   * promotion le fait déjà (constat m6 de la seconde revue).
   *
   * C2 n'était refermé que sur le chemin des webhooks. L'autre chemin qui pose
   * un `provider_payment_id` est celui-ci, et il ne consultait jamais
   * `billing_refunded_payment` : un remboursement journalisé dont la
   * confirmation ne vient jamais, plus une charge introuvable — le cas
   * **permanent** du mode local —, et l'accès était accordé sur un achat
   * intégralement remboursé.
   */
  it('n’accorde pas un achat dont le remboursement est journalisé mais non appliqué', async () => {
    await openPurchase()

    // Le remboursement arrive avant la confirmation : il est journalisé sous la
    // seule clé qu'il porte, et la ligne reste en attente.
    await deliver(
      refundEvent({ id: 'evt_life_rec_avant', created: 1_788_104_500, amountRefunded: 49_000 }),
    )

    expect((await purchases())[0]).toMatchObject({ status: 'pending' })

    const listing = (): Response =>
      json({
        object: 'list',
        has_more: false,
        data: [
          {
            id: 'cs_life_1',
            object: 'checkout.session',
            mode: 'payment',
            payment_status: 'paid',
            payment_intent: 'pi_life_1',
            amount_total: 49_000,
            currency: 'eur',
          },
        ],
      })

    // La confirmation n'arrivera jamais ; c'est la réconciliation qui pose le
    // paiement. Aucune charge relue — le cas du mode local.
    responses = [
      listing,
      () => json({ object: 'list', has_more: false, data: [] }),
      () => json({ object: 'list', has_more: false, data: [] }),
    ]

    expect((await requireBillingService().useCases.reconcile()).changed).toBe(1)

    const rows = await purchases()

    expect(rows[0]).toMatchObject({ status: 'refunded', provider_payment_id: 'pi_life_1' })
    expect(rows[0]?.['refunded_at']).not.toBeNull()
    expect((await view()).hasAccess).toBe(false)

    responses = [
      listing,
      () => json({ object: 'list', has_more: false, data: [] }),
      () => json({ object: 'list', has_more: false, data: [] }),
    ]

    // Rejouée, elle ne change rien de plus (`docs/reliability.md` §1).
    expect((await requireBillingService().useCases.reconcile()).changed).toBe(0)
  })

  /**
   * **L'ordre de lecture et l'index doivent rester d'accord** — la conséquence
   * que l'ADR 037 demande de surveiller, appliquée à la nouvelle table.
   *
   * Le constat m1 de la seconde revue de s19 avait montré un index que la
   * requête qui l'a motivé ne servait pas : la position des `NULL` divergeait,
   * et le planificateur retriait par-dessus. Ici comme là-bas, c'est le plan
   * réel qui répond, pas un commentaire.
   */
  it('sert l’ordre de lecture des achats depuis l’index, sans retri', async () => {
    const query = connection.db
      .select({ id: billingPurchase.id })
      .from(billingPurchase)
      .where(eq(billingPurchase.billingCustomerId, 'bc_s20_explain'))
      .orderBy(...purchaseReadOrder)
      .toSQL()

    const plan = await connection.db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`)
      await tx.execute(sql`set local enable_bitmapscan = off`)

      const explained = await tx.execute<{ 'QUERY PLAN': string }>(
        sql.raw(`explain ${query.sql.replace(/\$1/, `'bc_s20_explain'`)}`),
      )

      return explained.rows.map((row) => row['QUERY PLAN']).join('\n')
    })

    expect(plan).toContain('billing_purchase_customer_idx')
    expect(plan).not.toContain('Sort')
  })
})

/* -------------------------------------------------------------------------- *
 * s21 — l'essai accordé une seule fois, et le droit d'accès **nommé par offre**.
 *
 * Assemblé : le module à travers le répartiteur, contre une vraie base, avec le
 * vrai adaptateur dont seul le réseau est doublé. Les règles pures, elles, sont
 * éprouvées dans `packages/modules/billing/src/domain/billing-rules.test.ts` —
 * ici, c'est le **câblage** qui est en jeu.
 * -------------------------------------------------------------------------- */
describe.runIf(databaseReachable)('l’essai, une fois par périmètre', () => {
  const trialSubscription = (input: {
    readonly id: string
    readonly created: number
    readonly status: string
    readonly trialEnd: number | null
  }): string =>
    eventPayload({
      id: input.id,
      type: 'customer.subscription.updated',
      created: input.created,
      object: {
        ...subscriptionObject({ customer: 'cus_s19', periodEnd: 1_790_000_000 }),
        status: input.status,
        trial_end: input.trialEnd,
      },
    })

  /** Ouvre un checkout d'abonnement et rend ce qui est parti au fournisseur. */
  const openSubscriptionCheckout = async (
    offerId: string,
    withExistingCustomer: boolean,
  ): Promise<URLSearchParams> => {
    responses = withExistingCustomer
      ? [
          () =>
            json({
              id: 'cs_s21',
              object: 'checkout.session',
              url: 'https://checkout.stripe.com/c/pay/cs_s21',
              customer: 'cus_s19',
            }),
        ]
      : [
          () => json({ id: 'cus_s19', object: 'customer' }),
          () =>
            json({
              id: 'cs_s21',
              object: 'checkout.session',
              url: 'https://checkout.stripe.com/c/pay/cs_s21',
              customer: 'cus_s19',
            }),
        ]

    const response = await call('checkout', {
      session: { userId: 'usr_s21', roles: [] },
      body: { offerId },
    })

    expect(response.status).toBe(200)

    return new URLSearchParams(calls.at(-1)?.body ?? '')
  }

  it('accorde les jours d’essai de l’offre au premier checkout', async () => {
    const sent = await openSubscriptionCheckout('pro-monthly', false)

    expect(sent.get('subscription_data[trial_period_days]')).toBe('14')
  })

  /**
   * **Le trou que la story ferme.** Le fournisseur n'a aucune mémoire d'essai
   * par client : redemander un checkout après un essai terminé rendait quatorze
   * jours de plus, offre après offre, indéfiniment.
   */
  it('ne le réaccorde pas à un périmètre qui a déjà essayé', async () => {
    await openSubscriptionCheckout('pro-monthly', false)

    // L'essai a eu lieu, puis l'abonnement a été résilié : la ligne en cache
    // porte un `trial_end`, et c'est la seule trace nécessaire.
    const applied = await deliver(
      trialSubscription({
        id: 'evt_s21_trial',
        created: 1_788_000_000,
        status: 'canceled',
        trialEnd: 1_788_500_000,
      }),
    )

    expect(applied.status).toBe(200)
    expect(await storedSubscription()).toMatchObject({ status: 'canceled' })

    const sent = await openSubscriptionCheckout('pro-monthly', true)

    expect(sent.get('subscription_data[trial_period_days]')).toBeNull()
  })

  /**
   * **Une autre offre, réellement** (constat m3 de la revue).
   *
   * Le cas rouvrait `pro-monthly` sous un nom qui annonçait le contraire, et son
   * commentaire nommait `team-monthly`, qui ne déclare aucun essai. Le
   * catalogue de la suite porte désormais une seconde offre d'abonnement à
   * essai, et l'offre du cas en est **dérivée** — jamais recopiée. Les deux
   * premières assertions disent ce que le cas exige du catalogue : sans elles,
   * retirer cette offre rendrait le cas vert et vide.
   */
  const OTHER_TRIAL_OFFER = CATALOGUE.filter(
    (offer) => offer.mode === 'subscription' && offer.trialDays !== null,
  )[1]

  it('ne le réaccorde pas davantage sur une **autre** offre', async () => {
    expect(OTHER_TRIAL_OFFER?.id).toBeDefined()
    expect(OTHER_TRIAL_OFFER?.id).not.toBe('pro-monthly')

    await openSubscriptionCheckout('pro-monthly', false)
    await deliver(
      trialSubscription({
        id: 'evt_s21_trial_2',
        created: 1_788_000_000,
        status: 'canceled',
        trialEnd: 1_788_500_000,
      }),
    )

    // Cette offre-là déclare bien un essai : sans la garde, elle en enverrait
    // les jours — c'est exactement le trou que la story ferme, « offre après
    // offre, indéfiniment ».
    const sent = await openSubscriptionCheckout(OTHER_TRIAL_OFFER?.id ?? '', true)

    expect(sent.get('subscription_data[trial_period_days]')).toBeNull()
  })

  /**
   * **La réconciliation rétablit la mémoire d'essai** (constat m4 de la revue).
   *
   * L'ADR 044 l'affirme — « la trace est le cache, et elle est reconstructible
   * depuis le fournisseur » — et rien ne la rejouait. Le cas pose l'incident :
   * le cache d'abonnements est perdu, l'essai redevient disponible, puis
   * `pnpm billing:reconcile` relit le fournisseur et le referme.
   *
   * Ce qu'il mesure vraiment, c'est que `trial_end` **fait l'aller-retour** par
   * `subscriptions.list` : le supprimer du mappage de l'adaptateur laisse le
   * cache reconstruit sans mémoire d'essai, et ce cas rougit.
   */
  it('retrouve la mémoire d’essai par la réconciliation, cache perdu', async () => {
    await openSubscriptionCheckout('pro-monthly', false)
    await deliver(
      trialSubscription({
        id: 'evt_s21_trial_perdu',
        created: 1_788_000_000,
        status: 'canceled',
        trialEnd: 1_788_500_000,
      }),
    )

    // Le cache est perdu — le client, lui, reste rattaché : c'est la situation
    // que la commande de réconciliation existe pour rattraper.
    await connection.db.execute(sql`delete from billing_subscription`)

    // Sans elle, l'essai est bel et bien réaccordé : c'est la mesure de la
    // perte, et c'est ce qui rend la ligne suivante autre chose qu'un rite.
    expect(
      (await openSubscriptionCheckout('pro-monthly', true)).get(
        'subscription_data[trial_period_days]',
      ),
    ).toBe('14')

    // Le fournisseur, lui, n'a rien oublié : l'abonnement résilié porte
    // toujours son `trial_end`.
    responses = [
      ...noPurchases(),
      () =>
        json({
          object: 'list',
          has_more: false,
          data: [
            {
              ...subscriptionObject({ customer: 'cus_s19', periodEnd: 1_790_000_000 }),
              status: 'canceled',
              trial_end: 1_788_500_000,
            },
          ],
        }),
    ]

    expect(await requireBillingService().useCases.reconcile()).toEqual({
      customers: 1,
      changed: 1,
    })

    const sent = await openSubscriptionCheckout('pro-monthly', true)

    expect(sent.get('subscription_data[trial_period_days]')).toBeNull()
  })

  it('laisse l’essai à un périmètre dont l’abonnement n’en a jamais porté', async () => {
    await openSubscriptionCheckout('pro-monthly', false)
    await deliver(
      trialSubscription({
        id: 'evt_s21_no_trial',
        created: 1_788_000_000,
        status: 'canceled',
        trialEnd: null,
      }),
    )

    const sent = await openSubscriptionCheckout('pro-monthly', true)

    expect(sent.get('subscription_data[trial_period_days]')).toBe('14')
  })

  /**
   * **L'essai expire sans qu'aucun événement n'arrive** — le cœur de la story,
   * mesuré à l'assemblage : la ligne reste `trialing` en base, le temps passe,
   * et l'accès se ferme.
   */
  it('ferme l’accès au terme de l’essai, la base inchangée', async () => {
    await openSubscriptionCheckout('pro-monthly', false)
    await deliver(
      trialSubscription({
        id: 'evt_s21_running',
        created: 1_788_000_000,
        status: 'trialing',
        // 2026-09-15T12:00:00Z, quatorze jours après l'horloge de la suite.
        trialEnd: 1_789_819_200,
      }),
    )

    const running = await requireBillingService().useCases.view({
      session: { userId: 'usr_s21', roles: [] },
      locale: 'fr',
    })

    expect(running.state).toBe('trialing')
    expect(running.hasAccess).toBe(true)

    const stored = await storedSubscription()

    clock = new Date('2026-09-20T12:00:00.000Z')

    const expired = await requireBillingService().useCases.view({
      session: { userId: 'usr_s21', roles: [] },
      locale: 'fr',
    })

    expect(expired.hasAccess).toBe(false)
    expect(expired.state).toBe('expired')
    // **Rien n'a bougé en base** : aucun webhook n'est arrivé, et c'est le
    // point. L'accès s'est fermé sur le temps seul.
    expect(await storedSubscription()).toEqual(stored)
  })
})

/* -------------------------------------------------------------------------- *
 * s23 — **la quantité facturée suit le nombre de membres** (ADR 046).
 *
 * Le bloc branche la vraie synchronisation : le module `organizations` écrit,
 * compte ce qu'il a écrit, le donne au point de composition, et celui-ci le
 * porte chez le fournisseur **avant** que la transaction soit validée. Ce qui
 * est mesuré est donc ce que le **réseau** a vu partir, jamais un appel à une
 * doublure de port.
 *
 * L'offre au siège est celle du catalogue de cette suite (`team-monthly`) : le
 * catalogue livré n'en déclare aucune, et s23 n'a pas à en ajouter une —
 * `perSeat` y est déjà un champ validé.
 * -------------------------------------------------------------------------- */
describe.runIf(databaseReachable)('la quantité facturée suit les membres', () => {
  const SEAT_OFFER = CATALOGUE.find((offer) => offer.perSeat)
  const CUSTOMER = 'cus_s23'
  const SUBSCRIPTION = 'sub_s23'

  /** Ce que le fournisseur répond à une relecture d'abonnement, puis à l'écriture. */
  const seatWrite = (quantity: number): readonly (() => Response)[] => [
    () =>
      json(
        subscriptionObject({
          id: SUBSCRIPTION,
          customer: CUSTOMER,
          periodEnd: 1_800_000_000,
          priceId: SEAT_OFFER?.priceId,
          quantity: 1,
        }),
      ),
    () =>
      json(
        subscriptionObject({
          id: SUBSCRIPTION,
          customer: CUSTOMER,
          periodEnd: 1_800_000_000,
          priceId: SEAT_OFFER?.priceId,
          quantity,
        }),
      ),
  ]

  /** Les quantités **réellement** parties chez le fournisseur, dans l'ordre. */
  const quantitiesSent = (): readonly string[] =>
    calls
      .map((entry) => new URLSearchParams(entry.body).get('items[0][quantity]'))
      .filter((quantity): quantity is string => quantity !== null)

  /** Les clés d'idempotence des **écritures de quantité**, dans l'ordre. */
  const seatKeysSent = (): readonly string[] =>
    calls
      .filter((entry) => new URLSearchParams(entry.body).get('items[0][quantity]') !== null)
      .map((entry) => entry.headers['idempotency-key'] ?? '')

  /**
   * Une organisation abonnée au siège : son propriétaire, son client chez le
   * fournisseur, et un abonnement en cache à **une** place.
   */
  const anOrganizationOnSeats = async (): Promise<{
    readonly owner: ModuleSession
    readonly organizationId: string
  }> => {
    const owner = await anAccount()
    const created = await organizationsService.useCases.createOrganization({
      userId: owner.userId,
      body: { name: 'Studio s23', slug: `s19-${randomUUID().slice(0, 8)}` },
    })

    expect(created.status).toBe('ok')

    const organizationId =
      (await organizationsService.useCases.viewOrganizations(owner.userId)).current?.id ?? ''

    currentScope = { kind: 'organization', organizationId }

    responses = [
      () => json({ id: CUSTOMER, object: 'customer' }),
      () =>
        json({
          id: 'cs_s23',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s23',
          customer: CUSTOMER,
        }),
    ]

    expect(
      (await call('checkout', { session: owner, body: { offerId: SEAT_OFFER?.id ?? '' } })).status,
    ).toBe(200)

    await deliver(
      eventPayload({
        id: `evt_s23_${randomUUID()}`,
        type: 'customer.subscription.created',
        created: 1_788_000_000,
        object: subscriptionObject({
          id: SUBSCRIPTION,
          customer: CUSTOMER,
          periodEnd: 1_800_000_000,
          priceId: SEAT_OFFER?.priceId,
          quantity: 1,
        }),
      }),
    )

    calls.length = 0

    // **La vraie synchronisation**, celle que `apps/web/lib/organizations.ts`
    // compose : le module rend le nombre de membres, le point de composition le
    // porte chez le fournisseur, et un échec annule l'écriture.
    seatSync = async ({ organizationId: id, seats: counted }) => {
      seatSyncCalls.push({ organizationId: id, seats: counted })

      const outcome = await requireBillingService().useCases.syncSeats({
        scope: { kind: 'organization', organizationId: id },
        seats: counted,
      })

      return outcome.status !== 'failed'
    }

    return { owner, organizationId }
  }

  /** Invite une adresse et rend le jeton du lien envoyé. */
  const anInvitation = async (
    owner: ModuleSession,
    organizationId: string,
  ): Promise<{ readonly guest: ModuleSession; readonly token: string }> => {
    const email = `s19-seat-${randomUUID()}@example.test`
    const guest = await anAccount(email)

    expect(
      (
        await organizationsService.useCases.inviteMember({
          userId: owner.userId,
          body: { organizationId, email },
        })
      ).status,
    ).toBe('ok')

    const link = String(invitationOutbox.sent.at(-1)?.data['url'])

    return { guest, token: new URL(link).searchParams.get('token') ?? '' }
  }

  const membersOf = async (organizationId: string): Promise<number> =>
    await organizationsService.useCases.countMembers(organizationId)

  it('déclare bien une offre facturée au siège', () => {
    // Sans elle, tout ce bloc serait vert et vide.
    expect(SEAT_OFFER?.mode).toBe('subscription')
  })

  it('porte la quantité chez le fournisseur à l’acceptation, jamais à l’invitation', async () => {
    const { owner, organizationId } = await anOrganizationOnSeats()
    const { guest, token } = await anInvitation(owner, organizationId)

    // **Une invitation en attente n'est pas facturée** (critère 4) : elle vit
    // dans une autre table, et rien n'a bougé chez le fournisseur.
    expect(seatSyncCalls).toEqual([])
    expect(quantitiesSent()).toEqual([])
    expect(await membersOf(organizationId)).toBe(1)

    responses = [...seatWrite(2)]

    const accepted = await organizationsService.useCases.acceptInvitation({
      userId: guest.userId,
      body: { token },
    })

    expect(accepted.status).toBe('ok')
    expect(await membersOf(organizationId)).toBe(2)
    // La quantité visée est le nombre de membres **après** l'écriture.
    expect(seatSyncCalls).toEqual([{ organizationId, seats: 2 }])
    expect(quantitiesSent()).toEqual(['2'])
  })

  /**
   * **Une invitation en attente n'occupe aucun siège** (critère 4), et le cas
   * en laisse une *pendante pendant* qu'une autre est acceptée.
   *
   * C'est ce qui le distingue du cas précédent : là-bas, l'invitation acceptée
   * cesse d'être en attente au moment même où l'on compte, si bien qu'un
   * compteur qui additionnerait les invitations resterait vert. Ici, une
   * invitation reste vivante, et un tel compteur enverrait trois.
   */
  it('ne facture pas l’invitation qui reste en attente', async () => {
    const { owner, organizationId } = await anOrganizationOnSeats()
    const accepted = await anInvitation(owner, organizationId)

    // Une seconde invitation, **jamais acceptée** : elle reste en attente
    // pendant toute la mesure.
    await anInvitation(owner, organizationId)

    responses = [...seatWrite(2)]

    expect(
      (
        await organizationsService.useCases.acceptInvitation({
          userId: accepted.guest.userId,
          body: { token: accepted.token },
        })
      ).status,
    ).toBe('ok')

    // Deux membres, une invitation en attente : deux sièges.
    expect(quantitiesSent()).toEqual(['2'])
    expect(await membersOf(organizationId)).toBe(2)
  })

  it('n’ajoute pas le membre quand le fournisseur refuse', async () => {
    const { owner, organizationId } = await anOrganizationOnSeats()
    const { guest, token } = await anInvitation(owner, organizationId)

    responses = [
      () =>
        json(
          subscriptionObject({
            id: SUBSCRIPTION,
            customer: CUSTOMER,
            periodEnd: 1_800_000_000,
            priceId: SEAT_OFFER?.priceId,
            quantity: 1,
          }),
        ),
      () =>
        new Response(JSON.stringify({ error: { type: 'api_error', message: 'panne' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
    ]

    const refused = await organizationsService.useCases.acceptInvitation({
      userId: guest.userId,
      body: { token },
    })

    // **Le critère 6** : atomique. Aucun membre ajouté, et le motif dit qu'il
    // faut réessayer — pas que le lien serait invalide.
    expect(refused).toEqual({ status: 'refused', refusal: 'seat_sync_unavailable' })
    expect(await membersOf(organizationId)).toBe(1)

    // **Et rejouable** : l'invitation n'a pas été consommée, le même lien
    // fonctionne dès que le fournisseur répond.
    responses = [...seatWrite(2)]

    expect(
      (
        await organizationsService.useCases.acceptInvitation({
          userId: guest.userId,
          body: { token },
        })
      ).status,
    ).toBe('ok')
    expect(await membersOf(organizationId)).toBe(2)
  })

  /**
   * **La clé d'idempotence porte la quantité visée, jamais un compteur.**
   *
   * C'est l'endroit où cette story peut facturer deux fois. Le cas mesure la
   * clé **telle que le réseau la voit** : deux synchronisations qui visent le
   * même état doivent être *le même appel* — sinon une réponse perdue et sa
   * reprise écriraient deux fois —, et deux états différents doivent être deux
   * appels — sinon le fournisseur rejouerait sa première réponse et la seconde
   * correction n'aurait jamais lieu.
   *
   * Une clé dérivée d'un incrément, d'un instant ou d'un tirage échoue la
   * première assertion ; une clé constante échoue la seconde.
   */
  it('dérive la clé d’idempotence de la quantité visée, jamais d’un compteur', async () => {
    const { organizationId } = await anOrganizationOnSeats()
    const scope: ModuleScope = { kind: 'organization', organizationId }
    const sync = async (seats: number): Promise<void> => {
      await requireBillingService().useCases.syncSeats({ scope, seats })
    }

    responses = [...seatWrite(2), ...seatWrite(2), ...seatWrite(3)]

    await sync(2)
    await sync(2)
    await sync(3)

    const keys = seatKeysSent()

    expect(keys).toHaveLength(3)
    // Même cible, même appel.
    expect(keys[0]).toBe(keys[1])
    // Cible différente, appel différent.
    expect(keys[0]).not.toBe(keys[2])
    // Et la cible **est** dans la clé : c'est elle qui la rend convergente.
    expect(keys[0]?.endsWith(':2')).toBe(true)
    expect(keys[2]?.endsWith(':3')).toBe(true)
  })

  it('n’ajoute pas une seconde appartenance au rejeu de l’acceptation', async () => {
    const { owner, organizationId } = await anOrganizationOnSeats()
    const { guest, token } = await anInvitation(owner, organizationId)

    responses = [...seatWrite(2), ...seatWrite(2)]

    await organizationsService.useCases.acceptInvitation({ userId: guest.userId, body: { token } })
    await organizationsService.useCases.acceptInvitation({ userId: guest.userId, body: { token } })

    expect(await membersOf(organizationId)).toBe(2)
    expect(new Set(quantitiesSent())).toEqual(new Set(['2']))
  })

  it('décrémente au retrait, et la quantité égale toujours le nombre de membres', async () => {
    const { owner, organizationId } = await anOrganizationOnSeats()

    const first = await anInvitation(owner, organizationId)

    responses = [...seatWrite(2)]
    await organizationsService.useCases.acceptInvitation({
      userId: first.guest.userId,
      body: { token: first.token },
    })

    const second = await anInvitation(owner, organizationId)

    responses = [...seatWrite(3)]
    await organizationsService.useCases.acceptInvitation({
      userId: second.guest.userId,
      body: { token: second.token },
    })

    responses = [...seatWrite(2)]
    expect(
      (
        await organizationsService.useCases.removeMember({
          userId: owner.userId,
          body: { organizationId, userId: second.guest.userId },
        })
      ).status,
    ).toBe('ok')

    // **Le critère 3** : après ajout, ajout, retrait, la dernière quantité
    // partie est le nombre de membres.
    expect(quantitiesSent()).toEqual(['2', '3', '2'])
    expect(Number(quantitiesSent().at(-1))).toBe(await membersOf(organizationId))
  })

  it('ne retire pas le membre quand le fournisseur refuse le retrait', async () => {
    const { owner, organizationId } = await anOrganizationOnSeats()
    const { guest, token } = await anInvitation(owner, organizationId)

    responses = [...seatWrite(2)]
    await organizationsService.useCases.acceptInvitation({ userId: guest.userId, body: { token } })

    responses = [
      () =>
        new Response(JSON.stringify({ error: { type: 'api_error', message: 'panne' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
    ]

    expect(
      await organizationsService.useCases.removeMember({
        userId: owner.userId,
        body: { organizationId, userId: guest.userId },
      }),
    ).toEqual({ status: 'refused', refusal: 'seat_sync_unavailable' })
    expect(await membersOf(organizationId)).toBe(2)
  })

  it('ne synchronise rien pour une offre au forfait', async () => {
    const owner = await anAccount()

    await organizationsService.useCases.createOrganization({
      userId: owner.userId,
      body: { name: 'Studio forfait', slug: `s19-${randomUUID().slice(0, 8)}` },
    })

    const organizationId =
      (await organizationsService.useCases.viewOrganizations(owner.userId)).current?.id ?? ''

    currentScope = { kind: 'organization', organizationId }

    responses = [
      () => json({ id: 'cus_s23_forfait', object: 'customer' }),
      () =>
        json({
          id: 'cs_s23_forfait',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s23_forfait',
          customer: 'cus_s23_forfait',
        }),
    ]

    await call('checkout', { session: owner, body: { offerId: 'pro-monthly' } })
    await deliver(
      eventPayload({
        id: `evt_s23_forfait_${randomUUID()}`,
        type: 'customer.subscription.created',
        created: 1_788_000_000,
        object: subscriptionObject({
          id: 'sub_s23_forfait',
          customer: 'cus_s23_forfait',
          periodEnd: 1_800_000_000,
          priceId: 'price_pro_monthly',
        }),
      }),
    )

    calls.length = 0
    responses = []

    // Le point de composition appelle quand même : c'est la **règle** du
    // domaine qui décide, pas l'appelant.
    expect(
      await requireBillingService().useCases.syncSeats({
        scope: { kind: 'organization', organizationId },
        seats: 4,
      }),
    ).toEqual({ status: 'not_applicable' })
    // **Aucun appel sortant** : vérifier l'absence d'appel, pas seulement
    // l'absence d'erreur.
    expect(calls).toEqual([])
  })

  /**
   * **Le forfait du périmètre compte** (critère 8), mesuré sur un compte qui a
   * bel et bien un abonnement au siège chez le fournisseur : sans la garde, la
   * quantité partirait. Le cas ne mesure donc pas l'absence de client.
   */
  it('ne synchronise rien pour un périmètre compte, même abonné au siège', async () => {
    const scope: ModuleScope = { kind: 'user', userId: 'usr_s23_seul' }

    currentScope = scope
    responses = [
      () => json({ id: 'cus_s23_seul', object: 'customer' }),
      () =>
        json({
          id: 'cs_s23_seul',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s23_seul',
          customer: 'cus_s23_seul',
        }),
    ]

    await call('checkout', {
      session: { userId: 'usr_s23_seul', roles: [] },
      body: { offerId: SEAT_OFFER?.id ?? '' },
    })
    await deliver(
      eventPayload({
        id: `evt_s23_seul_${randomUUID()}`,
        type: 'customer.subscription.created',
        created: 1_788_000_000,
        object: subscriptionObject({
          id: 'sub_s23_seul',
          customer: 'cus_s23_seul',
          periodEnd: 1_800_000_000,
          priceId: SEAT_OFFER?.priceId,
        }),
      }),
    )

    calls.length = 0
    responses = []

    expect(await requireBillingService().useCases.syncSeats({ scope, seats: 3 })).toEqual({
      status: 'not_applicable',
    })
    // **Aucun appel sortant** : vérifier l'absence d'appel, pas seulement
    // l'absence d'erreur.
    expect(calls).toEqual([])
  })
})

/* -------------------------------------------------------------------------- *
 * s23 — **la réconciliation corrige la quantité, et dans l'autre sens**.
 *
 * L'ADR 034 fait du local un cache du fournisseur : le statut, la période et
 * l'offre viennent de lui. L'ADR 046 **inverse ce sens pour le seul champ
 * quantité** : le nombre de membres fait foi, et la quantité du fournisseur y
 * est ramenée. Un agent qui appliquerait la doctrine générale écraserait le
 * nombre de membres par la quantité Stripe, c'est-à-dire propagerait l'erreur
 * au lieu de la corriger.
 * -------------------------------------------------------------------------- */
describe.runIf(databaseReachable)('la réconciliation des sièges', () => {
  const SEAT_OFFER = CATALOGUE.find((offer) => offer.perSeat)
  const CUSTOMER = 'cus_s23r'
  const SUBSCRIPTION = 'sub_s23r'

  const providerSubscription = (quantity: number): Record<string, unknown> =>
    subscriptionObject({
      id: SUBSCRIPTION,
      customer: CUSTOMER,
      periodEnd: 1_800_000_000,
      priceId: SEAT_OFFER?.priceId,
      quantity,
    })

  /** Le client et son abonnement au siège, connus du cache. */
  const anOrganizationOnSeats = async (providerQuantity: number): Promise<void> => {
    currentScope = { kind: 'organization', organizationId: 'org_s23r' }

    responses = [
      () => json({ id: CUSTOMER, object: 'customer' }),
      () =>
        json({
          id: 'cs_s23r',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s23r',
          customer: CUSTOMER,
        }),
    ]

    await call('checkout', {
      session: { userId: 'usr_s23r', roles: [] },
      body: { offerId: SEAT_OFFER?.id ?? '' },
    })

    await deliver(
      eventPayload({
        id: `evt_s23r_${randomUUID()}`,
        type: 'customer.subscription.created',
        created: 1_788_000_000,
        object: providerSubscription(providerQuantity),
      }),
    )

    calls.length = 0
  }

  /** Ce que le fournisseur répond : les achats, puis les abonnements. */
  const providerSees = (quantity: number): (() => Response)[] => [
    ...noPurchases(),
    () => json({ object: 'list', has_more: false, data: [providerSubscription(quantity)] }),
  ]

  const quantitiesWritten = (): readonly string[] =>
    calls
      .map((entry) => new URLSearchParams(entry.body).get('items[0][quantity]'))
      .filter((quantity): quantity is string => quantity !== null)

  /**
   * **Toute tentative de toucher à cet abonnement**, relecture comprise.
   *
   * Mesurer les seules quantités parties ne suffit pas : corriger la quantité
   * commence par relire l'abonnement, et une relecture en échec laisserait
   * `quantitiesWritten()` vide alors que la commande *a bien décidé* de baisser
   * la facture. Ce qui doit rester vide, c'est la tentative.
   */
  const seatCallAttempts = (): readonly string[] =>
    calls
      .filter((entry) => entry.url.includes(`/v1/subscriptions/${SUBSCRIPTION}`))
      .map((entry) => entry.url)

  it('ramène la quantité du fournisseur au nombre de membres, puis ne change plus rien', async () => {
    await anOrganizationOnSeats(1)

    // Trois membres en base, un seul siège facturé : l'écart que la commande
    // existe pour fermer.
    scopeSeats = () => Promise.resolve(3)
    responses = [...providerSees(1), () => json(providerSubscription(1)), () => json(providerSubscription(3))]

    const first = await requireBillingService().useCases.reconcile()

    expect(first.changed).toBeGreaterThan(0)
    expect(quantitiesWritten()).toEqual(['3'])

    // **Rejouée** : le fournisseur dit désormais trois, le nombre de membres
    // aussi. Rien n'est réécrit, et aucune écriture ne part.
    calls.length = 0
    responses = [...providerSees(3)]

    expect(await requireBillingService().useCases.reconcile()).toEqual({
      customers: 1,
      changed: 0,
    })
    expect(quantitiesWritten()).toEqual([])
  })

  /**
   * **Le défaut de facturation silencieux** que la recherche redoute.
   *
   * Une lecture des membres en échec — base en cours de migration, organisation
   * à demi supprimée — ne doit pas faire *baisser* une facture. Elle interrompt
   * la commande, qui se relance.
   */
  it('ne baisse aucune quantité quand la lecture des membres échoue', async () => {
    await anOrganizationOnSeats(5)

    scopeSeats = () => Promise.reject(new Error('la base ne répond pas'))
    responses = [...providerSees(5)]

    await expect(requireBillingService().useCases.reconcile()).rejects.toThrow()

    // Aucune écriture de quantité n'est partie : ni cinq, ni un, ni zéro. Et
    // aucune correction n'a même été **tentée**.
    expect(quantitiesWritten()).toEqual([])
    expect(seatCallAttempts()).toEqual([])
  })

  it('ne baisse aucune quantité quand l’organisation ne rend aucun membre', async () => {
    await anOrganizationOnSeats(5)

    // Zéro n'est pas un état : aucune organisation n'a zéro membre, puisque sa
    // création écrit l'appartenance de son créateur dans la même transaction.
    scopeSeats = () => Promise.resolve(0)
    responses = [...providerSees(5)]

    await requireBillingService().useCases.reconcile()

    expect(quantitiesWritten()).toEqual([])
    expect(seatCallAttempts()).toEqual([])
  })

  it('ne touche pas à la quantité d’une offre au forfait', async () => {
    currentScope = { kind: 'organization', organizationId: 'org_s23r_forfait' }
    responses = [
      () => json({ id: 'cus_s23r_forfait', object: 'customer' }),
      () =>
        json({
          id: 'cs_s23r_forfait',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s23r_forfait',
          customer: 'cus_s23r_forfait',
        }),
    ]

    await call('checkout', {
      session: { userId: 'usr_s23r', roles: [] },
      body: { offerId: 'pro-monthly' },
    })

    calls.length = 0
    scopeSeats = () => Promise.resolve(9)
    responses = [
      ...noPurchases(),
      () =>
        json({
          object: 'list',
          has_more: false,
          data: [
            subscriptionObject({
              id: 'sub_s23r_forfait',
              customer: 'cus_s23r_forfait',
              periodEnd: 1_800_000_000,
              priceId: 'price_pro_monthly',
              quantity: 1,
            }),
          ],
        }),
    ]

    await requireBillingService().useCases.reconcile()

    expect(quantitiesWritten()).toEqual([])
  })
})

/* -------------------------------------------------------------------------- *
 * s23 — **le forfait**, c'est-à-dire ce qui se passe quand il n'y a rien à
 * facturer (critère 8).
 *
 * La règle est dans `apps/web/lib/seat-sync.ts` plutôt qu'au point de
 * composition, et pour la raison mesurée deux fois par les revues de s19 : une
 * règle écrite dans `lib/organizations.ts` ne peut être neutralisée par aucun
 * cas, faute de pouvoir être construite à côté.
 * -------------------------------------------------------------------------- */
describe('la synchronisation des sièges quand il n’y a rien à facturer', () => {
  /** Une facturation qui **crie** si on l'interroge. */
  const forbidden: SeatSyncBilling['syncSeats'] = () => {
    throw new Error('La facturation ne doit pas être interrogée ici.')
  }

  it('laisse passer l’écriture, module de facturation coupé, sans rien demander', async () => {
    const sync = seatSyncOf(async () => ({ available: false, syncSeats: forbidden }))

    expect(await sync({ organizationId: 'org_s23', seats: 4 })).toBe(true)
  })

  it('laisse passer l’écriture quand il n’y a rien à synchroniser', async () => {
    const sync = seatSyncOf(async () => ({
      available: true,
      syncSeats: () => Promise.resolve({ status: 'not_applicable' }),
    }))

    expect(await sync({ organizationId: 'org_s23', seats: 4 })).toBe(true)
  })

  it('annule l’écriture quand le fournisseur a échoué', async () => {
    const sync = seatSyncOf(async () => ({
      available: true,
      syncSeats: () => Promise.resolve({ status: 'failed' }),
    }))

    expect(await sync({ organizationId: 'org_s23', seats: 4 })).toBe(false)
  })

  it('transmet le périmètre organisation et la quantité visée, jamais un delta', async () => {
    const asked: unknown[] = []
    const sync = seatSyncOf(async () => ({
      available: true,
      syncSeats: async (input) => {
        asked.push(input)

        return { status: 'synced', quantity: input.seats }
      },
    }))

    await sync({ organizationId: 'org_s23', seats: 4 })

    expect(asked).toEqual([{ scope: { kind: 'organization', organizationId: 'org_s23' }, seats: 4 }])
  })
})

/* -------------------------------------------------------------------------- *
 * s23 — **le fil**, et non plus la règle : ce que le point de composition de
 * l'application accroche réellement au module des organisations.
 *
 * Le bloc précédent éprouve `seatSyncOf` ; celui-ci éprouve que
 * `apps/web/lib/organizations.ts` s'en serve. La distinction a été mesurée : la
 * revue de s23 a remplacé `seatSync: seatSyncOf(…)` par
 * `() => Promise.resolve(true)` **au point de composition** et a obtenu la suite
 * entière au vert, `pnpm test:e2e` compris (constat F1) — l'application aurait
 * accepté des invitations sans jamais rien porter chez le fournisseur, et le
 * critère 6 aurait disparu en silence. C'est la leçon de s19, reposée une fois
 * de plus : une mutation posée ailleurs qu'au site du défaut ne prouve rien.
 *
 * La mesure prend le `seatSync` que le point de composition **donne au
 * module** — en interceptant `provideOrganizations`, qui dit comment construire
 * sans construire — puis le branche sur une facturation qui échoue : c'est le
 * seul sens dans lequel un fil coupé se distingue d'un fil branché. Un fil coupé
 * rend `true` sans interroger personne ; le vrai fil rend `false` et porte le
 * périmètre organisation.
 *
 * Ni base ni service : rien n'est construit, et la connexion est doublée pour
 * qu'aucun pool ne survive au cas.
 * -------------------------------------------------------------------------- */
describe.runIf(appOrganizations.available)('le fil des sièges au point de composition', () => {
  it('accroche au module la synchronisation qui interroge vraiment la facturation', async () => {
    const asked: unknown[] = []
    const provided: (() => ConfigureOrganizationsOptions)[] = []

    // Le point de composition lit l'environnement pour construire le mailer et
    // l'URL publique. Le job de CI ne les pose pas : il ne monte aucun serveur.
    vi.stubEnv('DATABASE_URL', 'postgres://s23:s23@127.0.0.1:5432/s23')
    vi.stubEnv('AUTH_SECRET', 'x'.repeat(40))
    vi.stubEnv('APP_URL', APP_URL)
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_FROM', '')
    vi.stubEnv('EMAIL_LOCAL_CAPTURE', '1')

    vi.resetModules()
    vi.doMock('@repo/module-organizations', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@repo/module-organizations')>()

      return {
        ...actual,
        provideOrganizations: (factory: () => ConfigureOrganizationsOptions) => {
          provided.push(factory)
        },
      }
    })
    vi.doMock('@repo/db', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@repo/db')>()

      // La connexion n'est pas ce qui est mesuré, et l'ouvrir ici laisserait un
      // second pool derrière ce cas.
      return { ...actual, getDatabase: () => ({ db: {} }) }
    })
    vi.doMock('../apps/web/lib/billing', () => ({
      billing: {
        available: true,
        syncSeats: (input: unknown) => {
          asked.push(input)

          return Promise.resolve({ status: 'failed' })
        },
      },
    }))

    try {
      const { organizations } = await import('../apps/web/lib/organizations')

      organizations.prepare()

      // Sans cette garde, le cas serait vert sur une fabrique jamais posée.
      expect(provided).toHaveLength(1)

      const options = provided[0]?.()

      // Le fournisseur a échoué : l'écriture d'appartenance doit être annulée.
      expect(await options?.seatSync({ organizationId: 'org_s23_fil', seats: 4 })).toBe(false)
      // Et la facturation de l'application a bien été interrogée, avec le
      // périmètre organisation et la quantité visée.
      expect(asked).toEqual([
        { scope: { kind: 'organization', organizationId: 'org_s23_fil' }, seats: 4 },
      ])
    } finally {
      vi.doUnmock('@repo/module-organizations')
      vi.doUnmock('@repo/db')
      vi.doUnmock('../apps/web/lib/billing')
      vi.resetModules()
      vi.unstubAllEnvs()
    }
  })
})

/* -------------------------------------------------------------------------- *
 * s23 — **le compteur serveur n'est atteignable par aucune requête**.
 *
 * `organizations.countMembers(organizationId)` est la seule lecture de tout le
 * dépôt qui parte d'un identifiant d'organisation nu, et c'est exactement la
 * forme que la porte de lecture de s15 ferme. Elle existe pour un unique
 * appelant sans session — `pnpm billing:reconcile` —, et l'invariant est qu'elle
 * n'ait aucun autre chemin.
 *
 * Ce que ce cas balaie, dit plutôt que sous-entendu : les fichiers `.ts` et
 * `.tsx` de `apps/web/app` (les écrans et les routes de l'application) et de la
 * couche `presentation` du module `organizations`. Il ne balaie pas les autres
 * packages : `countMembers` n'y est pas importable, le module n'exposant que son
 * service.
 * -------------------------------------------------------------------------- */
describe('le compteur serveur de membres', () => {
  const filesUnder = async (directory: string): Promise<readonly string[]> => {
    const entries = await readdir(directory, { withFileTypes: true, recursive: true })

    return entries
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
      .map((entry) => `${entry.parentPath}/${entry.name}`)
  }

  it('n’est nommé par aucun écran ni aucune route', async () => {
    const swept = [
      ...(await filesUnder(fileURLToPath(new URL('../apps/web/app', import.meta.url)))),
      ...(await filesUnder(
        fileURLToPath(
          new URL('../packages/modules/organizations/src/presentation', import.meta.url),
        ),
      )),
    ]

    // Sans cette garde, le cas serait vert sur un balayage vide.
    expect(swept.length).toBeGreaterThan(10)

    const naming = (
      await Promise.all(
        swept.map(async (file) => ({
          file,
          mentions: (await readFile(file, 'utf8')).includes('countMembers'),
        })),
      )
    ).filter((entry) => entry.mentions)

    expect(naming.map((entry) => entry.file)).toEqual([])
  })
})

describe.runIf(databaseReachable)('les offres qu’un périmètre détient', () => {
  const session = { userId: 'usr_s21', roles: [] }

  const entitled = async (): Promise<readonly string[]> =>
    await requireBillingService().useCases.entitledOffers({ session })

  it('n’en rend aucune à un périmètre sans client chez le fournisseur', async () => {
    expect(await entitled()).toEqual([])
  })

  it('n’en rend aucune quand le périmètre n’est pas résolu', async () => {
    currentScope = null

    expect(await entitled()).toEqual([])
  })

  it('rend l’offre de l’abonnement vivant', async () => {
    responses = [
      () => json({ id: 'cus_s19', object: 'customer' }),
      () =>
        json({
          id: 'cs_s21',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_s21',
          customer: 'cus_s19',
        }),
    ]

    await call('checkout', { session, body: { offerId: 'pro-monthly' } })

    await deliver(
      eventPayload({
        id: 'evt_s21_active',
        type: 'customer.subscription.updated',
        created: 1_788_000_000,
        object: subscriptionObject({ customer: 'cus_s19', periodEnd: 1_790_000_000 }),
      }),
    )

    expect(await entitled()).toEqual(['pro-monthly'])
  })

  it('rend l’offre d’un achat unique payé, sans aucun abonnement', async () => {
    responses = [
      () => json({ id: 'cus_s19', object: 'customer' }),
      () =>
        json({
          id: 'cs_life_s21',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_life_s21',
          customer: 'cus_s19',
        }),
    ]

    await call('checkout', { session, body: { offerId: 'lifetime' } })

    await deliver(
      eventPayload({
        id: 'evt_s21_paid',
        type: 'checkout.session.completed',
        created: 1_788_000_000,
        object: {
          id: 'cs_life_s21',
          object: 'checkout.session',
          mode: 'payment',
          payment_status: 'paid',
          customer: 'cus_s19',
          payment_intent: 'pi_life_s21',
          amount_total: 49_000,
          currency: 'eur',
          client_reference_id: 'organization:org_s19',
        },
      }),
    )

    expect(await entitled()).toEqual(['lifetime'])
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
 * s22 — l'entrée de navigation **publique** des tarifs.
 *
 * C'est la moitié « navigation » du sixième critère : le lien disparaît avec le
 * module, **par déclaration** et sans qu'aucun composant ne porte de condition.
 * L'autre moitié — la page répond 404 — vit plus bas, avec l'écran.
 *
 * Le niveau de protection n'est pas relu comme une donnée : ce qui est mesuré
 * est ce qu'il **produit**, c'est-à-dire ce qu'un visiteur sans session voit.
 * La règle elle-même (`satisfiesProtection`) est éprouvée chez elle, dans
 * `packages/core/src/protection.test.ts` ; ici, un seul témoin par sens.
 * -------------------------------------------------------------------------- */
describe('l’entrée de navigation des tarifs', () => {
  const hrefsFor = (built: typeof registry, session: ModuleSession | null): readonly string[] =>
    visibleNavigation(built, session).map((entry) => entry.href)

  it('s’affiche pour un visiteur sans session, contrairement à l’écran de facturation', () => {
    const anonymous = hrefsFor(registry, null)

    expect(anonymous).toContain(PRICING_SCREEN_PATH)
    // Le témoin de refus, sur le **même** module : la facturation reste
    // `authenticated`, et une entrée visible vers un écran qui redirige
    // promettrait ce qu'elle ne tient pas.
    expect(anonymous).not.toContain(BILLING_SCREEN_PATH)
  })

  it('disparaît avec le module, sans condition dans aucun composant', () => {
    expect(hrefsFor(withoutBilling, null)).not.toContain(PRICING_SCREEN_PATH)
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
    mode: 'subscription' as const,
    price: '29,00 €',
    interval: 'month' as const,
    trialDays: null,
    perSeat: false,
    current,
    owned: false,
  })

  /** s20 — une offre unique : elle se ferme sur sa propre possession. */
  const purchaseView = (id: string, owned: boolean) => ({
    id,
    mode: 'one_time' as const,
    price: '490,00 €',
    interval: null,
    trialDays: null,
    perSeat: false,
    current: false,
    owned,
  })

  const render = (
    offers: readonly ReturnType<typeof offerView | typeof purchaseView>[],
    view: Partial<BillingView> = {},
  ): string =>
    renderToStaticMarkup(
      createElement(BillingScreen, {
        view: { ...EMPTY_BILLING_VIEW, offers, canManage: true, ...view },
        intl: { t: (key: string) => key, formatDate: () => '1 janvier 2026' },
        manageAction: createElement('span', null, 'action:gerer'),
        subscribeActions: Object.fromEntries(
          offers.map((offer) => [offer.id, createElement('span', null, `action:${offer.id}`)]),
        ),
        checkoutOutcome: null,
      }),
    )

  it('ne propose plus aucune souscription à qui a déjà l’accès', () => {
    const markup = render([offerView('pro-monthly', true), offerView('pro-yearly', false)], {
      hasSubscription: true,
      hasAccess: true,
    })

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
    const markup = render([offerView('pro-monthly', true), offerView('pro-yearly', false)])

    expect(markup).toContain('action:pro-monthly')
    expect(markup).toContain('action:pro-yearly')
    expect(markup).not.toContain(BILLING_KEYS.currentOffer)
  })

  /* ---------------------------------------------------------------------- *
   * s20 — les deux fermetures ne se regardent pas (critère 6).
   * ---------------------------------------------------------------------- */

  it('laisse acheter à vie **pendant** un abonnement en cours', () => {
    const markup = render([offerView('pro-monthly', true), purchaseView('lifetime', false)], {
      hasSubscription: true,
      hasAccess: true,
    })

    expect(markup).not.toContain('action:pro-monthly')
    expect(markup).toContain('action:lifetime')
    // Et surtout : l'achat unique n'est pas renvoyé au portail, où il n'y a
    // rien à gérer.
    expect(markup).not.toContain(BILLING_KEYS.ownedOffer)
  })

  it('laisse souscrire **alors qu’un achat à vie donne déjà l’accès**', () => {
    // L'accès consolidé est vrai, et pourtant le catalogue d'abonnements reste
    // ouvert : le fermer sur `hasAccess` rejouerait le défaut que le sixième
    // critère interdit.
    const markup = render([offerView('pro-monthly', false), purchaseView('lifetime', true)], {
      hasAccess: true,
      hasSubscription: false,
    })

    expect(markup).toContain('action:pro-monthly')
    expect(markup).not.toContain('action:lifetime')
    expect(markup).toContain(BILLING_KEYS.ownedOffer)
  })

  it('n’offre le portail que lorsqu’il y a un abonnement à gérer', () => {
    // Quatrième critère : « le portail client n'est pas proposé pour un achat
    // unique ». Un client existe pourtant chez le fournisseur.
    const acheteur = render([purchaseView('lifetime', true)], {
      hasAccess: true,
      hasCustomer: true,
      canOpenPortal: false,
    })

    expect(acheteur).not.toContain('action:gerer')

    const abonne = render([offerView('pro-monthly', true)], {
      hasSubscription: true,
      hasAccess: true,
      hasCustomer: true,
      canOpenPortal: true,
    })

    expect(abonne).toContain('action:gerer')
  })

  it('rend l’historique des paiements, et le distingue d’un remboursement', () => {
    const markup = render([purchaseView('lifetime', true)], {
      hasAccess: true,
      purchases: [
        { offerId: 'lifetime', price: '490,00 €', purchasedAt: new Date(), refunded: false },
        { offerId: null, price: null, purchasedAt: new Date(), refunded: true },
      ],
    })

    expect(markup).toContain(BILLING_KEYS.purchasesTitle)
    // Les deux statuts portent un **libellé**, pas seulement une couleur.
    expect(markup).toContain(BILLING_KEYS.purchasePaid)
    expect(markup).toContain(BILLING_KEYS.purchaseRefunded)
    // Une offre retirée du catalogue est **nommée comme telle**, jamais par sa
    // clé : depuis s09 le traducteur lève sur une clé absente, donc un achat
    // dont l'offre a disparu de `config/billing.ts` mettrait l'écran en 500.
    expect(markup).toContain(BILLING_KEYS.unknownOffer)
  })

  it('n’affiche pas de carte d’achats quand il n’y en a aucun', () => {
    expect(render([offerView('pro-monthly', false)])).not.toContain(BILLING_KEYS.purchasesTitle)
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

/* -------------------------------------------------------------------------- *
 * s22 — la page **publique** de tarifs.
 *
 * Ce qui est mesuré ici n'existe qu'assemblé : le catalogue réel de
 * `config/billing.ts`, l'écran du module, les déclencheurs de l'application et
 * la garde `billing.available`. Les deux règles pures qu'il emploie — l'offre
 * mise en avant et la périodicité — sont prouvées chez elles, dans
 * `packages/modules/billing/src/domain/pricing.test.ts`, et ne sont pas rejouées.
 *
 * Le point de départ : **cette page n'a aucun effet de bord**. Elle lit un
 * catalogue déjà validé au démarrage et rend du HTML ; la seule écriture
 * possible est déclenchée par un clic, jamais par une URL (ADR 045).
 * -------------------------------------------------------------------------- */
describe('la page publique de tarifs', () => {
  interface PricingRender {
    readonly html: string
    readonly digest: string | null
  }

  const aSession = (): ModuleSession => ({ userId: 'usr_s22', roles: [] })

  /**
   * Rend l'écran avec un point de composition **injecté**.
   *
   * L'injection permet d'éprouver les deux états — module monté et coupé —
   * dans la même exécution, quelle que soit la configuration du dépôt. Un cas
   * qui n'exercerait « module coupé » que lorsque `config/features.ts` le coupe
   * ne prouverait rien le reste du temps.
   *
   * Ce qui est remplacé est le **contexte de requête** (session, langue) et la
   * disponibilité du module — jamais une règle. Le catalogue reste celui de
   * `config/billing.ts`, sauf quand un cas en fournit un autre : c'est ainsi
   * que le premier critère — « ajouter une offre la fait apparaître » — se
   * mesure sans toucher au fichier du projet.
   */
  const renderPricing = async (input: {
    readonly available: boolean
    readonly session: ModuleSession | null
    readonly params?: Record<string, string | string[] | undefined>
    readonly catalogue?: readonly unknown[]
  }): Promise<PricingRender> => {
    vi.resetModules()
    vi.doMock('../apps/web/lib/billing', () => ({ billing: { available: input.available } }))
    vi.doMock('../apps/web/lib/auth', () => ({
      currentViewer: () => Promise.resolve({ session: input.session, account: null }),
    }))
    vi.doMock('../apps/web/lib/i18n', () => ({
      appIntl: () =>
        Promise.resolve({
          locale: defaultLocale,
          // La clé rendue telle quelle : ce fichier mesure ce que l'écran
          // **décide**, pas ce qu'il écrit. Les textes sont éprouvés par
          // `tests/rendered-text.test.ts`, qui rend cette page avec un vrai
          // catalogue pseudo-locale.
          t: (key: string) => key,
          path: (pathname: string) => localeRouting.publicPath(pathname, defaultLocale),
        }),
    }))

    if (input.catalogue !== undefined) {
      const offers = parseBillingCatalogue([...input.catalogue])

      vi.doMock('../apps/web/lib/billing-catalogue', () => ({ billingCatalogue: () => offers }))
    }

    try {
      const { default: PricingPage } = (await import('../apps/web/app/pricing/page')) as {
        default: (props: {
          searchParams?: Promise<Record<string, string | string[] | undefined>>
        }) => Promise<ReactNode>
      }

      const tree = await PricingPage({ searchParams: Promise.resolve(input.params ?? {}) })

      return {
        html: renderToStaticMarkup(
          createElement(NextIntlClientProvider, {
            locale: defaultLocale,
            messages: {},
            timeZone: 'UTC',
            // Le déclencheur de l'application est un composant **client** : il
            // traduit sa clé lui-même. Le repli la rend telle quelle, comme le
            // `t` du serveur juste au-dessus.
            onError: () => {},
            getMessageFallback: ({ key }: { key: string }) => key,
            children: tree,
          }),
        ),
        digest: null,
      }
    } catch (error) {
      const digest = (error as { digest?: unknown }).digest

      if (typeof digest !== 'string') {
        throw error
      }

      return { html: '', digest }
    } finally {
      vi.doUnmock('../apps/web/lib/billing')
      vi.doUnmock('../apps/web/lib/auth')
      vi.doUnmock('../apps/web/lib/i18n')
      vi.doUnmock('../apps/web/lib/billing-catalogue')
    }
  }

  /** Le nombre de fois qu'une chaîne apparaît dans un rendu. */
  const occurrences = (html: string, needle: string): number => html.split(needle).length - 1

  it('n’existe pas quand le module est coupé', async () => {
    // La moitié « page » du sixième critère. L'autre — le lien qui disparaît —
    // est mesurée plus haut, sur la navigation.
    const outcome = await renderPricing({ available: false, session: null })

    expect(outcome.digest).toContain('NEXT_HTTP_ERROR_FALLBACK;404')
  })

  it('rend une carte par offre du catalogue, sans que la page les connaisse', async () => {
    // Le premier critère, mesuré sur **deux** catalogues : le nombre de cartes
    // suit la configuration, il n'est écrit nulle part dans l'écran.
    const served = await renderPricing({ available: true, session: null })

    expect(served.digest).toBeNull()

    for (const offer of billingOffers) {
      expect(occurrences(served.html, offerNameKey(offer.id)), offer.id).toBe(1)
    }

    const narrowed = await renderPricing({
      available: true,
      session: null,
      catalogue: [billingOffers[0]],
    })

    expect(occurrences(narrowed.html, offerNameKey(billingOffers[0]?.id ?? ''))).toBe(1)

    // Et les offres retirées du catalogue ne sont plus rendues : sans cette
    // moitié, le cas serait vert sur une page qui affiche toujours tout.
    for (const offer of billingOffers.slice(1)) {
      expect(occurrences(narrowed.html, offerNameKey(offer.id)), offer.id).toBe(0)
    }
  })

  it('mène un visiteur sans session à la connexion, en gardant son offre', async () => {
    // Le quatrième critère, première moitié. Le retour est un chemin
    // **interne** : c'est l'écran de connexion qui le met dans la forme
    // publique de sa locale, une seule fois.
    const outcome = await renderPricing({ available: true, session: null })
    const signIn = localeRouting.publicPath('/sign-in', defaultLocale)

    for (const offer of billingOffers) {
      const back = encodeURIComponent(`${PRICING_SCREEN_PATH}?offer=${offer.id}`)

      expect(outcome.html, offer.id).toContain(`href="${signIn}?next=${back}"`)
    }

    // **Et aucun formulaire** : le déclencheur de l'application viserait une
    // route `authenticated`, donc un 403 — du bruit, et un signal trompeur.
    // L'avertissement « le tunnel exige JavaScript » est alors porté par
    // l'écran, une seule fois, puisque plus aucun bouton ne le porte.
    expect(occurrences(outcome.html, '<form')).toBe(0)
    expect(occurrences(outcome.html, '<noscript>')).toBe(1)
  })

  it('repose l’offre choisie au retour de connexion, sans rien acheter', async () => {
    // ADR 045 : `?offer=` met la carte en évidence et donne le focus à son
    // bouton. Elle n'ouvre **pas** le tunnel — un lien forgé envoyé à quelqu'un
    // de connecté créerait sinon une session de paiement à son nom.
    const chosen = billingOffers[0]?.id ?? ''
    const outcome = await renderPricing({
      available: true,
      session: aSession(),
      params: { offer: chosen },
    })

    expect(outcome.digest).toBeNull()
    expect(occurrences(outcome.html, 'aria-current="true"')).toBe(1)
  })

  /**
   * **Ce que ce cas prouve, et ce qu'il ne prouve pas** — mesuré, pas supposé.
   *
   * Il prouve qu'un paramètre forgé ne provoque ni erreur, ni mise en évidence,
   * ni écho dans le balisage. Il **ne prouve pas** que la confrontation au
   * catalogue (`offerById`) soit nécessaire : remplacée par la valeur brute, le
   * 2 septembre 2026, les sept cas de ce bloc restent verts — rien du rendu ne
   * consomme un identifiant qui ne désigne aucune carte. Cette confrontation
   * est donc une défense en profondeur, et ce cas est ce qui rougira le jour où
   * quelqu'un réinjectera le paramètre quelque part.
   *
   * Ce qui bite aujourd'hui est le sens inverse, juste au-dessus : une
   * sélection toujours nulle fait rougir « repose l'offre choisie ».
   */
  it('ignore un « offer » que le catalogue ne connaît pas, sans erreur ni écho', async () => {
    for (const forged of ['inconnu', '../secret', '<img src=x onerror=alert(1)>', '']) {
      const outcome = await renderPricing({
        available: true,
        session: null,
        params: { offer: forged },
      })

      expect(outcome.digest, forged).toBeNull()
      expect(occurrences(outcome.html, 'aria-current="true"'), forged).toBe(0)
      // Et elle n'est **jamais réinjectée** dans le rendu, sous aucune forme.
      if (forged !== '') {
        expect(outcome.html, forged).not.toContain(forged)
      }
    }

    // Une valeur répétée (`?offer=a&offer=b`) arrive en tableau : le schéma la
    // refuse, comme toute forme que la page n'attend pas.
    const repeated = await renderPricing({
      available: true,
      session: null,
      params: { offer: [billingOffers[0]?.id ?? '', 'inconnu'] },
    })

    expect(repeated.digest).toBeNull()
    expect(occurrences(repeated.html, 'aria-current="true"')).toBe(0)
  })

  it('ouvre le checkout pour un visiteur connecté, sans passer par la connexion', async () => {
    // Le quatrième critère, seconde moitié : une session, donc le déclencheur
    // de l'application — celui qui porte l'attente, le `<noscript>` et la
    // désactivation avant hydratation.
    const outcome = await renderPricing({ available: true, session: aSession() })
    const signIn = localeRouting.publicPath('/sign-in', defaultLocale)

    expect(outcome.digest).toBeNull()
    // Un formulaire par offre — le déclencheur de l'application — et son
    // avertissement « sans JavaScript, ce bouton reste éteint ».
    expect(occurrences(outcome.html, '<form')).toBe(billingOffers.length)
    expect(occurrences(outcome.html, '<noscript>')).toBe(billingOffers.length)
    // Et plus aucun renvoi vers la connexion : le compte est déjà là.
    expect(outcome.html).not.toContain(`href="${signIn}?next=`)
  })

  /**
   * **Le retour de connexion est borné par la règle du module `auth`**, et ce
   * cas est le témoin de cette page-là.
   *
   * La règle est énumérée chez elle
   * (`packages/modules/auth/src/domain/auth-rules.test.ts`) : ce qui se mesure
   * ici est que le `next` **produit** par cet écran la traverse sans être
   * réécrit — donc que l'offre survit à l'aller-retour —, et qu'une cible
   * forgée retombe sur le repli plutôt que de sortir du site.
   */
  /* ------------------------------------------------------------------------ *
   * Le **second critère** : « les prix affichés sont ceux envoyés au checkout ».
   *
   * Ce qu'il prouve : sur chaque carte, le montant lu par un visiteur et
   * l'identifiant d'offre que son bouton emporte désignent **la même ligne** de
   * `config/billing.ts`. Une seconde liste de prix introduite dans l'écran, ou
   * une carte qui afficherait le prix d'une autre offre, le fait rougir.
   *
   * **Ce qu'il ne prouve pas, et il faut le lire** : `config/billing.ts` dit que
   * « `priceId` est ce qui fait foi ; `amount` et `currency` ne servent qu'à
   * l'affichage ». Un `amount: 2900` en regard d'un prix Stripe à 39 € affiche
   * un mensonge que **rien en local ne peut détecter** — les deux valeurs sont
   * cohérentes entre elles et fausses ensemble. La divergence réellement
   * dangereuse est locale ↔ fournisseur, et elle relève du régime « clés de
   * test réelles hors CI », pas de ce fichier.
   * ------------------------------------------------------------------------ */
  it('affiche, sur chaque carte, le prix de l’offre que son bouton emporte', async () => {
    const catalogue = parseBillingCatalogue([...billingOffers])
    const priced = catalogue.map((offer) => ({
      id: offer.id,
      price: formatOfferPrice(offer, defaultLocale),
    }))

    // Garde contre l'inertie : deux offres au même prix rendraient la
    // comparaison ci-dessous vraie par accident.
    expect(new Set(priced.map((offer) => offer.price)).size).toBe(priced.length)
    expect(priced.length).toBeGreaterThan(1)

    // Le visiteur **sans session** : son bouton porte sa cible dans le
    // balisage, donc l'appariement « prix affiché ↔ offre emportée » est
    // entièrement observable sur le document servi.
    const outcome = await renderPricing({ available: true, session: null })

    expect(outcome.digest).toBeNull()

    const boundaries = priced.map((offer) => outcome.html.indexOf(offerNameKey(offer.id)))

    for (const [index, at] of boundaries.entries()) {
      expect(at, priced[index]?.id).toBeGreaterThanOrEqual(0)
    }

    for (const [index, offer] of priced.entries()) {
      const card = outcome.html.slice(boundaries[index] ?? 0, boundaries[index + 1] ?? undefined)

      // Le prix **de cette offre**, sur la carte de cette offre.
      expect(card, offer.id).toContain(offer.price)
      // L'identifiant que le bouton emporte, sur la même carte.
      expect(card, offer.id).toContain(`offer%3D${offer.id}`)

      // Et **aucun prix d'une autre offre** : sans cette moitié, une carte qui
      // afficherait tous les prix passerait.
      for (const other of priced.filter((candidate) => candidate.id !== offer.id)) {
        expect(card, `${offer.id} ← ${other.id}`).not.toContain(other.price)
      }
    }
  })

  it('n’envoie qu’un identifiant d’offre au checkout, jamais un prix', async () => {
    // L'autre moitié du second critère, pour un visiteur **connecté** : sa
    // cible ne vit pas dans le balisage mais dans les props du déclencheur.
    // C'est l'appariement au point de composition — l'offre dont le prix est
    // affiché est celle dont l'identifiant partira.
    const catalogue = parseBillingCatalogue([...billingOffers])
    const triggers = new Map<string, Record<string, unknown>>()

    vi.resetModules()
    vi.doMock('../apps/web/lib/billing', () => ({ billing: { available: true } }))
    vi.doMock('../apps/web/lib/auth', () => ({
      currentViewer: () => Promise.resolve({ session: aSession(), account: null }),
    }))
    vi.doMock('../apps/web/lib/i18n', () => ({
      appIntl: () =>
        Promise.resolve({
          locale: defaultLocale,
          t: (key: string) => key,
          path: (pathname: string) => localeRouting.publicPath(pathname, defaultLocale),
        }),
    }))

    try {
      const { default: PricingPage } = (await import('../apps/web/app/pricing/page')) as {
        default: (props: {
          searchParams?: Promise<Record<string, string | string[] | undefined>>
        }) => Promise<ReactNode>
      }

      const tree = (await PricingPage({ searchParams: Promise.resolve({}) })) as {
        props: {
          offers: readonly { readonly id: string; readonly price: string }[]
          actions: Readonly<Record<string, { readonly props: Record<string, unknown> }>>
        }
      }

      for (const [id, action] of Object.entries(tree.props.actions)) {
        triggers.set(id, action.props)
      }

      // Le prix affiché de chaque offre, apparié à ce que son déclencheur envoie.
      for (const offer of tree.props.offers) {
        const source = offerById(catalogue, offer.id)

        expect(source, offer.id).not.toBeNull()
        expect(offer.price, offer.id).toBe(
          formatOfferPrice(
            { amount: source?.amount ?? -1, currency: source?.currency ?? '' },
            defaultLocale,
          ),
        )

        const trigger = triggers.get(offer.id) ?? {}

        expect(trigger['offerId'], offer.id).toBe(offer.id)
        // **Aucun montant, aucune devise, aucun prix de fournisseur** ne quitte
        // le navigateur : le corps du checkout est un `z.strictObject` à un
        // champ, et il refuserait ces clés plutôt que de les ignorer.
        for (const forbidden of ['amount', 'currency', 'price', 'priceId']) {
          expect(Object.keys(trigger), `${offer.id} / ${forbidden}`).not.toContain(forbidden)
        }
      }

      expect(triggers.size).toBe(catalogue.length)
    } finally {
      vi.doUnmock('../apps/web/lib/billing')
      vi.doUnmock('../apps/web/lib/auth')
      vi.doUnmock('../apps/web/lib/i18n')
    }
  })

  it('produit un retour que la règle de redirection accepte, et refuse l’absolu', () => {
    for (const offer of billingOffers) {
      const back = `${PRICING_SCREEN_PATH}?offer=${offer.id}`

      expect(safeRedirectPath(back, '/'), offer.id).toBe(back)
    }

    for (const forged of ['https://evil.test/pricing', '//evil.test/pricing']) {
      expect(safeRedirectPath(forged, PRICING_SCREEN_PATH), forged).toBe(PRICING_SCREEN_PATH)
    }
  })
})
