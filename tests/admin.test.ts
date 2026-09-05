import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { buildRegistry, MODULE_ROUTE_PREFIX, type ModuleSession } from '@repo/core'
import {
  createDatabaseClient,
  planModuleMigrations,
  runModuleMigrations,
  type DatabaseConnection,
} from '@repo/db'
import { createRecordingMailer } from '@repo/mailer-testing'
import {
  adminModule,
  adminPlatformRole,
  adminRoutePath,
  configureAdmin,
  resetAdminService,
  SUPERADMIN_ROLE,
  type AdminAccountsPort,
  type AdminSecurityEvent,
} from '@repo/module-admin'
import {
  authModule,
  configureAuth,
  resetAuthService,
  type AuthService,
} from '@repo/module-auth'
import { BAN_REASON_MAX_LENGTH } from '@repo/module-auth'
import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { admin, missingSuperadminWarning } from '../apps/web/lib/admin'
import { availableModules, enabledModules, requiredModules } from '../config/features'
import { appLocales } from '../config/i18n'
import { minimalProfile } from '../config/profiles'
import { applyProfile, sweepProfile } from '../scripts/minimal-profile-rules'
import { databaseUrl, isDatabaseReachable } from './fixtures/database'
import { dispatchAllowingRateLimit } from './fixtures/rate-limit'

/**
 * **L'administration de la plateforme** (s37a), éprouvée contre une vraie base
 * et à travers le répartiteur de modules — le même chemin qu'une requête de
 * l'application.
 *
 * Ce fichier porte ce qui décide de la story, et rien de ce qui se prouve
 * ailleurs : la matrice des règles pures vit dans
 * `packages/modules/admin/src/domain/admin-rules.test.ts` et n'est pas rejouée
 * ici — ce fichier prouve qu'elle est **appelée**. Le refus de connexion d'un
 * compte banni et la révocation de ses sessions vivent dans le socle, donc dans
 * `tests/auth.test.ts` ; ce qui est mesuré ici est le bout du fil : bannir
 * **depuis le back-office** ferme bien la porte.
 *
 * Quatre mesures :
 *
 * 1. **la désignation** — sur une base vierge, la variable d'environnement
 *    nomme le premier superadmin, et personne d'autre ;
 * 2. **le garde-fou du dernier** — la plateforme ne peut pas devenir
 *    inadministrable ;
 * 3. **le 404** — un non-superadmin, et une plateforme sans superadmin, ne
 *    distinguent pas le back-office d'une URL inventée ;
 * 4. **le module coupé** — plus aucune route.
 */

const databaseReachable = await isDatabaseReachable()

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_URL = 'http://localhost:3000'
const TEST_SECRET = 'secret-de-test-uniquement-0123456789abcdef'
const PASSWORD = 'mot-de-passe-de-test-1'

/**
 * Le registre du module et de son requis, **construit par le test** : les
 * assertions portent sur la modularité, pas sur l'état du dépôt. C'est ce qui
 * rend ce fichier vert dans les deux configurations.
 */
const registry = buildRegistry({
  available: [authModule, adminModule],
  enabled: ['auth', 'admin'],
  locales: [...appLocales],
})

/** La même configuration, **sans** le module : la plateforme sans back-office. */
const withoutAdmin = buildRegistry({
  available: [authModule, adminModule],
  enabled: ['auth'],
  locales: [...appLocales],
})

let connection: DatabaseConnection
let auth: AuthService

const securityEvents: AdminSecurityEvent[] = []

const anEmail = (): string => `s37a-${randomUUID()}@example.test`

/**
 * Le port des comptes, câblé sur le **vrai** module `auth` — les trois mêmes
 * lignes que `apps/web/lib/admin.ts`.
 *
 * Une doublure aurait prouvé que le module d'administration appelle quelque
 * chose ; ici, bannir depuis une route d'administration écrit réellement dans
 * le socle, et le compte visé cesse réellement de pouvoir se connecter.
 */
/**
 * Une porte posée **dans** le bannissement, pour un seul cas : celui qui mesure
 * que le verrou du rôle de plateforme est tenu pendant l'écriture du socle.
 * `null` partout ailleurs, remis à `null` avant chaque cas.
 */
let banGate: (() => Promise<void>) | null = null

const accounts: AdminAccountsPort = {
  findIdByEmail: async (email) => ({
    ok: true,
    userId: (await auth.useCases.identifyAccount(email))?.userId ?? null,
  }),
  ban: async (input) => {
    await banGate?.()

    return await auth.useCases.banAccount(input)
  },
  unban: async (input) => await auth.useCases.unbanAccount(input),
}

/** Reconfigure le module avec l'adresse désignée du moment. */
const configure = (email: string | null): void => {
  configureAdmin({
    db: connection.db,
    accounts,
    designatedEmail: email,
    securityLog: (event) => securityEvents.push(event),
  })
}

interface CallOptions {
  readonly session?: ModuleSession | null
  readonly body?: unknown
}

/** Une requête d'administration, telle que l'application la sert. */
const call = async (
  path: 'grantSuperadmin' | 'revokeSuperadmin' | 'banAccount' | 'unbanAccount',
  options: CallOptions = {},
): Promise<Response> =>
  await dispatchAllowingRateLimit(
    registry,
    new Request(`${APP_URL}${adminRoutePath(path)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(options.body ?? {}),
    }),
    { resolveSession: () => Promise.resolve(options.session ?? null) },
  )

/** Une requête vers une route du module `auth`, pour mesurer la connexion. */
const callAuth = async (path: string, body: unknown): Promise<Response> =>
  await dispatchAllowingRateLimit(
    registry,
    new Request(`${APP_URL}${MODULE_ROUTE_PREFIX}/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_URL },
      body: JSON.stringify(body),
    }),
    { resolveSession: (request) => auth.resolveSession(request) },
  )

/** Un compte réel et vérifié : la table des rôles porte une clé étrangère. */
const anAccount = async (email?: string): Promise<{ session: ModuleSession; email: string }> => {
  const address = email ?? anEmail()
  const userId = `usr_s37a_${randomUUID()}`

  await connection.db.execute(
    sql`insert into auth_user (id, name, email, email_verified) values (${userId}, ${'Compte de test'}, ${address}, true)`,
  )

  return { session: { userId, roles: [] }, email: address }
}

const superadminRows = async (): Promise<number> => {
  const counted = await connection.db.execute<{ count: number }>(
    sql`select count(*)::int as count from admin_platform_role where role = ${SUPERADMIN_ROLE}`,
  )

  return Number(counted.rows[0]?.count ?? 0)
}

beforeAll(async () => {
  if (!databaseReachable) {
    return
  }

  connection = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 5 })

  await runModuleMigrations({
    db: connection.db,
    plan: planModuleMigrations({ modules: [authModule, adminModule], repoRoot: REPO_ROOT }),
  })

  auth = configureAuth({
    db: connection.db,
    mailer: createRecordingMailer(),
    secret: TEST_SECRET,
    appUrl: APP_URL,
  })
})

beforeEach(async () => {
  if (!databaseReachable) {
    return
  }

  // Chaque cas part d'une plateforme **sans aucun superadmin** : c'est l'état
  // que le critère nomme (« base vierge »), et le seul dans lequel la
  // désignation a un sens.
  await connection.db.execute(sql`delete from admin_platform_role`)
  securityEvents.length = 0
  banGate = null
  configure(null)
})

afterAll(async () => {
  resetAdminService()
  resetAuthService()

  if (databaseReachable) {
    // Les comptes de la suite, et eux seuls : les rôles suivent par cascade.
    await connection.db.execute(sql`delete from auth_user where email like 's37a-%'`)
    await connection.close()
  }
})

describe.runIf(databaseReachable)('la désignation du premier superadmin', () => {
  it('donne le rôle au compte que la variable nomme, depuis une base vierge', async () => {
    const { session, email } = await anAccount()
    const other = await anAccount()

    expect(await superadminRows()).toBe(0)

    configure(email)

    // Mesuré sur une **requête servie**, pas sur une lecture : c'est le seul
    // fait qui compte — ce compte administre, l'autre non.
    const served = await call('banAccount', {
      session,
      body: { userId: other.session.userId },
    })

    expect(served.status).toBe(200)
    expect(await superadminRows()).toBe(1)
  })

  it('ne donne le rôle à personne d’autre, quelle que soit la session', async () => {
    const designated = await anAccount()
    const intruder = await anAccount()

    configure(designated.email)

    const refused = await call('banAccount', {
      session: intruder.session,
      body: { userId: designated.session.userId },
    })

    // 404, jamais 403 : un 403 confirmerait que le back-office existe.
    expect(refused.status).toBe(404)
    // Et le refus n'atteint pas la règle métier : personne n'a été banni.
    await expect(
      connection.db.execute<{ banned: boolean }>(
        sql`select banned from auth_user where id = ${designated.session.userId}`,
      ),
    ).resolves.toMatchObject({ rows: [{ banned: false }] })
  })

  it('se rejoue sans effet supplémentaire : une seule ligne, quel que soit le nombre d’appels', async () => {
    const { session, email } = await anAccount()
    const target = await anAccount()

    configure(email)

    await call('banAccount', { session, body: { userId: target.session.userId } })
    await call('unbanAccount', { session, body: { userId: target.session.userId } })

    expect(await superadminRows()).toBe(1)
  })

  it('ne redésigne personne une fois qu’un superadmin existe', async () => {
    const first = await anAccount()
    const second = await anAccount()

    configure(first.email)
    await call('grantSuperadmin', {
      session: first.session,
      body: { userId: second.session.userId },
    })

    // La variable nomme maintenant le second, et le premier est révoqué : la
    // désignation ne doit pas le ressusciter — sinon le garde-fou du dernier
    // serait un décor.
    configure(first.email)
    await call('revokeSuperadmin', {
      session: second.session,
      body: { userId: first.session.userId },
    })

    const refused = await call('banAccount', {
      session: first.session,
      body: { userId: second.session.userId },
    })

    expect(refused.status).toBe(404)
  })
})

describe.runIf(databaseReachable)('la promotion et la révocation', () => {
  it('promeut un compte, qui administre à l’instant et sans reconnexion', async () => {
    const { session, email } = await anAccount()
    const promoted = await anAccount()

    configure(email)

    // Avant : le compte n'administre pas.
    expect(
      (await call('banAccount', { session: promoted.session, body: { userId: 'x' } })).status,
    ).toBe(404)

    const granted = await call('grantSuperadmin', {
      session,
      body: { userId: promoted.session.userId },
    })

    expect(granted.status).toBe(200)

    // Après : la même session, sans reconnexion, administre. Le pouvoir suit la
    // ligne, pas le jeton (ADR 030).
    const served = await call('grantSuperadmin', {
      session: promoted.session,
      body: { userId: promoted.session.userId },
    })

    expect(served.status).toBe(200)
  })

  it('révoque un compte, qui cesse d’administrer à l’instant', async () => {
    const { session, email } = await anAccount()
    const promoted = await anAccount()

    configure(email)
    await call('grantSuperadmin', { session, body: { userId: promoted.session.userId } })

    const revoked = await call('revokeSuperadmin', {
      session,
      body: { userId: promoted.session.userId },
    })

    expect(revoked.status).toBe(200)
    expect(
      (await call('banAccount', { session: promoted.session, body: { userId: 'x' } })).status,
    ).toBe(404)
  })

  it('refuse de révoquer le dernier superadmin, et le laisse administrer', async () => {
    const { session, email } = await anAccount()

    configure(email)
    // La désignation a lieu ici : ce compte est le seul superadmin.
    await call('grantSuperadmin', { session, body: { userId: session.userId } })

    expect(await superadminRows()).toBe(1)

    const refused = await call('revokeSuperadmin', {
      session,
      body: { userId: session.userId },
    })

    // **Le garde-fou.** 409 et non 404 : l'appelant administre, il connaît la
    // cible — c'est lui. Le refus lui dit ce qui l'empêche.
    expect(refused.status).toBe(409)
    await expect(refused.json()).resolves.toMatchObject({ reason: 'last_superadmin' })

    // Et la plateforme reste administrable : c'est le seul fait qui compte.
    expect(await superadminRows()).toBe(1)
    expect(
      (await call('grantSuperadmin', { session, body: { userId: session.userId } })).status,
    ).toBe(200)
  })

  it('refuse de révoquer un compte qui ne porte pas le rôle', async () => {
    const { session, email } = await anAccount()
    const other = await anAccount()

    configure(email)
    await call('grantSuperadmin', { session, body: { userId: session.userId } })

    const refused = await call('revokeSuperadmin', {
      session,
      body: { userId: other.session.userId },
    })

    expect(refused.status).toBe(409)
    await expect(refused.json()).resolves.toMatchObject({ reason: 'not_superadmin' })
  })

  it('refuse de promouvoir un compte que le socle ne connaît pas', async () => {
    const { session, email } = await anAccount()

    configure(email)

    const refused = await call('grantSuperadmin', {
      session,
      body: { userId: 'usr_s37a_inexistant' },
    })

    expect(refused.status).toBe(400)
    expect(await superadminRows()).toBe(1)
  })

  it('journalise le changement de rôle et son refus, avec leur acteur', async () => {
    const { session, email } = await anAccount()
    const promoted = await anAccount()

    configure(email)
    await call('grantSuperadmin', { session, body: { userId: promoted.session.userId } })
    // Le promu retire le premier — il en reste un, donc c'est permis —, puis
    // essaie de se retirer lui-même : il est alors le dernier.
    await call('revokeSuperadmin', {
      session: promoted.session,
      body: { userId: session.userId },
    })
    await call('revokeSuperadmin', {
      session: promoted.session,
      body: { userId: promoted.session.userId },
    })

    // La désignation n'a pas d'acteur : elle vient de la configuration.
    expect(securityEvents[0]).toEqual({
      event: 'admin.superadmin_granted',
      actor: 'configuration',
      target: session.userId,
    })
    expect(securityEvents).toContainEqual({
      event: 'admin.superadmin_granted',
      actor: session.userId,
      target: promoted.session.userId,
    })
    expect(securityEvents).toContainEqual({
      event: 'admin.superadmin_revoked',
      actor: promoted.session.userId,
      target: session.userId,
    })
    // Le second retrait est refusé : il ne reste qu'un superadmin.
    expect(securityEvents).toContainEqual({
      event: 'admin.superadmin_revocation_refused',
      actor: promoted.session.userId,
      target: promoted.session.userId,
    })
  })
})

describe.runIf(databaseReachable)('le back-office réservé', () => {
  /**
   * **Toutes** les routes du module, dérivées du contrat plutôt qu'énumérées :
   * une cinquième route ajoutée demain est couverte sans que personne y pense,
   * et une route qui échapperait à la garde fait rougir ce cas.
   */
  const declaredRoutes = adminModule.routes

  it('déclare au moins une route, sans quoi le balayage ci-dessous ne vérifie rien', () => {
    expect(declaredRoutes.length).toBeGreaterThan(0)
  })

  it('répond 404 à un compte qui n’administre pas, sur chacune de ses routes', async () => {
    const { session, email } = await anAccount()
    const intruder = await anAccount()

    configure(email)

    for (const route of declaredRoutes) {
      const response = await dispatchAllowingRateLimit(
        registry,
        new Request(`${APP_URL}${MODULE_ROUTE_PREFIX}${route.path}`, {
          method: route.method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: session.userId }),
        }),
        { resolveSession: () => Promise.resolve(intruder.session) },
      )

      expect(response.status, `${route.method} ${route.path}`).toBe(404)
      await expect(response.json()).resolves.toEqual({ error: 'not_found' })
    }
  })

  it('répond 404 à tout le monde quand aucun superadmin n’est configuré', async () => {
    const { session } = await anAccount()

    // Aucune adresse désignée, aucune ligne en base : la plateforme démarre,
    // mais son back-office n'existe pour personne.
    configure(null)

    const refused = await call('grantSuperadmin', {
      session,
      body: { userId: session.userId },
    })

    expect(refused.status).toBe(404)
    expect(await superadminRows()).toBe(0)
  })

  it('décide de l’accès **avant** de juger le corps', async () => {
    const { email } = await anAccount()
    const intruder = await anAccount()

    configure(email)

    // Un corps vide, donc invalide. Un non-superadmin doit recevoir 404, pas
    // 400 : la distinction lui apprendrait que la route existe et ce qu'elle
    // attend (revue de s17, F5).
    const refused = await call('banAccount', { session: intruder.session, body: {} })

    expect(refused.status).toBe(404)
  })

  it('refuse un corps sans compte visé, et n’écrit rien', async () => {
    const { session, email } = await anAccount()

    configure(email)

    const refused = await call('banAccount', { session, body: { userId: '   ' } })

    expect(refused.status).toBe(400)
  })

  it('refuse un motif trop long au lieu de le tronquer', async () => {
    const { session, email } = await anAccount()
    const target = await anAccount()

    configure(email)

    const refused = await call('banAccount', {
      session,
      body: { userId: target.session.userId, reason: 'x'.repeat(BAN_REASON_MAX_LENGTH + 1) },
    })

    expect(refused.status).toBe(400)
    // Et le refus n'a rien écrit : le compte n'est pas banni « sans motif ».
    await expect(
      connection.db.execute<{ banned: boolean }>(
        sql`select banned from auth_user where id = ${target.session.userId}`,
      ),
    ).resolves.toMatchObject({ rows: [{ banned: false }] })
  })
})

describe.runIf(databaseReachable)('bannir depuis le back-office', () => {
  it('ferme la connexion du compte visé, et la rouvre au débannissement', async () => {
    const { session, email } = await anAccount()

    configure(email)

    // Un compte réel, inscrit et vérifié par le parcours du socle : c'est lui
    // qui doit cesser de pouvoir se connecter.
    const victim = anEmail()

    await callAuth('/sign-up/email', { email: victim, password: PASSWORD })
    await connection.db.execute(
      sql`update auth_user set email_verified = true where email = ${victim}`,
    )

    const before = await callAuth('/sign-in/email', { email: victim, password: PASSWORD })

    expect(before.status).toBe(200)

    const victimId =
      (await auth.useCases.identifyAccount(victim))?.userId ?? ''

    const banned = await call('banAccount', {
      session,
      body: { userId: victimId, reason: 'abus signalé' },
    })

    expect(banned.status).toBe(200)
    // Le bannissement révoque : la session ouverte plus haut est comptée.
    await expect(banned.json()).resolves.toMatchObject({ revokedSessions: 1 })

    const after = await callAuth('/sign-in/email', { email: victim, password: PASSWORD })

    expect(after.status).toBe(401)

    await call('unbanAccount', { session, body: { userId: victimId } })

    const restored = await callAuth('/sign-in/email', { email: victim, password: PASSWORD })

    expect(restored.status).toBe(200)
  }, 60_000)

  it('répond 404 pour un compte que le socle ne connaît pas', async () => {
    const { session, email } = await anAccount()

    configure(email)

    const refused = await call('banAccount', { session, body: { userId: 'usr_s37a_absent' } })

    expect(refused.status).toBe(404)
  })

  /**
   * **Le garde-fou du dernier superadmin, sur la route voisine** (revue de
   * s37a, F2).
   *
   * Sans lui, le superadmin unique qui se bannit obtient : ses sessions
   * révoquées, la connexion refusée par le socle, **et sa ligne toujours dans
   * `admin_platform_role`**. Le décompte rend donc 1, la désignation par
   * `SUPERADMIN_EMAIL` ne se redéclenche jamais, et **aucune commande ne
   * répare** : la plateforme est définitivement inadministrable, en un clic.
   */
  it('refuse de bannir le dernier superadmin, et le laisse administrer', async () => {
    const { session, email } = await anAccount()

    configure(email)
    // La désignation a lieu ici : ce compte est le seul superadmin.
    await call('grantSuperadmin', { session, body: { userId: session.userId } })

    expect(await superadminRows()).toBe(1)

    const refused = await call('banAccount', {
      session,
      body: { userId: session.userId, reason: 'geste de trop' },
    })

    // 409 et non 404, comme la révocation : l'appelant **est** superadmin, il
    // connaît la cible — c'est lui. Le refus lui dit ce qui l'empêche.
    expect(refused.status).toBe(409)
    await expect(refused.json()).resolves.toMatchObject({ reason: 'last_superadmin' })

    // Le refus n'atteint pas le socle : rien n'est écrit, aucune session
    // révoquée, aucun motif posé.
    await expect(
      connection.db.execute<{ banned: boolean; reason: string | null }>(
        sql`select banned, banned_reason as reason from auth_user where id = ${session.userId}`,
      ),
    ).resolves.toMatchObject({ rows: [{ banned: false, reason: null }] })

    // Et la plateforme reste administrable : le seul fait qui compte.
    expect(
      (await call('grantSuperadmin', { session, body: { userId: session.userId } })).status,
    ).toBe(200)
  })

  it('refuse de bannir le superadmin resté seul après la révocation de son pair', async () => {
    const { session, email } = await anAccount()
    const peer = await anAccount()

    configure(email)
    await call('grantSuperadmin', { session, body: { userId: peer.session.userId } })
    await call('revokeSuperadmin', { session, body: { userId: peer.session.userId } })

    expect(await superadminRows()).toBe(1)

    const refused = await call('banAccount', { session, body: { userId: session.userId } })

    expect(refused.status).toBe(409)
    await expect(refused.json()).resolves.toMatchObject({ reason: 'last_superadmin' })
  })

  /**
   * **Bannir un superadmin qui n'est pas le dernier reste permis**, et c'est
   * une décision, pas un trou : c'est de la modération entre pairs, et le
   * garde-fou ne protège que l'administrabilité de la plateforme. Ce que cette
   * permission laisse ouvert est écrit dans `packages/modules/admin/AGENTS.md`.
   */
  it('laisse bannir un superadmin dès qu’il en reste un autre', async () => {
    const { session, email } = await anAccount()
    const peer = await anAccount()

    configure(email)
    await call('grantSuperadmin', { session, body: { userId: peer.session.userId } })

    const banned = await call('banAccount', {
      session,
      body: { userId: peer.session.userId },
    })

    expect(banned.status).toBe(200)
    await expect(
      connection.db.execute<{ banned: boolean }>(
        sql`select banned from auth_user where id = ${peer.session.userId}`,
      ),
    ).resolves.toMatchObject({ rows: [{ banned: true }] })
  })

  /**
   * **La sérialisation avec la révocation**, mesurée et non raisonnée.
   *
   * Le garde-fou ne vaut que si aucune révocation ne peut se glisser entre la
   * décision et l'écriture du socle : les deux opérations prennent le **même**
   * verrou consultatif, et le bannissement le tient jusqu'à son terme. Une
   * révocation concurrente attend donc son tour, puis ré-évalue.
   *
   * Ce que ce cas ne prouve pas : il mesure une attente, donc un vert reste
   * possible sur une machine où la révocation mettrait plus de 300 ms sans
   * verrou. Le rouge, lui, est certain dès que le verrou tombe.
   */
  it('tient le verrou du rôle de plateforme pendant le bannissement', async () => {
    const { session, email } = await anAccount()
    const peer = await anAccount()
    const victim = await anAccount()

    configure(email)
    await call('grantSuperadmin', { session, body: { userId: peer.session.userId } })

    let release = (): void => {}
    let entered = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const entering = new Promise<void>((resolve) => {
      entered = resolve
    })

    banGate = async () => {
      entered()

      await gate
    }

    try {
      const banning = call('banAccount', { session, body: { userId: victim.session.userId } })

      // Le garde-fou est passé, le verrou est tenu, l'écriture du socle attend.
      await entering

      const revoking = call('revokeSuperadmin', {
        session,
        body: { userId: peer.session.userId },
      })
      const raced = await Promise.race([
        revoking.then(() => 'servie'),
        new Promise((resolve) => setTimeout(() => resolve('en attente'), 300)),
      ])

      expect(raced).toBe('en attente')

      release()

      expect((await banning).status).toBe(200)
      expect((await revoking).status).toBe(200)
    } finally {
      release()
      banGate = null
    }
  }, 30_000)
})

describe.runIf(databaseReachable)('le module coupé', () => {
  it('n’expose aucune de ses routes : chacune répond 404', async () => {
    const { session } = await anAccount()

    for (const route of adminModule.routes) {
      const response = await dispatchAllowingRateLimit(
        withoutAdmin,
        new Request(`${APP_URL}${MODULE_ROUTE_PREFIX}${route.path}`, {
          method: route.method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: session.userId }),
        }),
        { resolveSession: () => Promise.resolve(session) },
      )

      expect(response.status, `${route.method} ${route.path}`).toBe(404)
    }
  })

  it('refuse d’activer un module qui le requiert, en le nommant', () => {
    // Le critère 14 de la story, tenu par la validation de s03 : ce qui dépend
    // du back-office ne peut pas être activé sans lui. C'est le **témoin** que
    // la règle s'applique à ce module ; la matrice des refus vit dans
    // `@repo/core`.
    expect(() =>
      buildRegistry({
        available: [
          authModule,
          adminModule,
          { ...adminModule, id: 'admin-dependant', requires: ['admin'] },
        ],
        enabled: ['auth', 'admin-dependant'],
        locales: [...appLocales],
      }),
    ).toThrowError(/« admin-dependant » requiert « admin »/)
  })
})

/**
 * **Le plancher de la promesse de modularité** (critère 14, tâche 8 du plan).
 *
 * `pnpm test:minimal-profile` dérive « aucune route, aucune table » du contrat
 * des modules coupés — mais il ne dérive rien du tout d'un module que le profil
 * ne coupe pas. Ce cas mesure que le back-office **est balayé**, plutôt que de
 * le supposer : sans lui, retirer `admin` de `config/profiles.ts` rendrait le
 * critère invérifiable par n'importe quelle exécution, en silence.
 *
 * Tout y est **dérivé du contrat** : les routes et la table viennent du module,
 * jamais d'une liste recopiée.
 */
describe('le profil minimal balaie le back-office', () => {
  const sweep = sweepProfile({
    profileId: minimalProfile.id,
    available: [...availableModules],
    enabled: applyProfile({
      available: [...availableModules],
      enabled: [...enabledModules],
      required: [...requiredModules],
      profile: { id: minimalProfile.id, cut: [...minimalProfile.cut] },
    }),
  })

  it('compte le module parmi les coupés', () => {
    expect(sweep.cutModuleIds).toContain(adminModule.id)
  })

  it('balaie chacune de ses routes', () => {
    expect(adminModule.routes.length).toBeGreaterThan(0)

    for (const route of adminModule.routes) {
      expect(sweep.routes).toContainEqual({
        moduleId: adminModule.id,
        method: route.method,
        path: route.path,
      })
    }
  })

  it('balaie sa table : elle ne doit exister sur aucune base où le module est coupé', () => {
    expect(sweep.absentTables).toContainEqual({
      moduleId: adminModule.id,
      table: getTableConfig(adminPlatformRole).name,
    })
  })
})

describe('l’avertissement de démarrage', () => {
  it('nomme la variable quand aucune adresse n’est renseignée', () => {
    const warning = missingSuperadminWarning({ available: true, designatedEmail: null })

    // **Nommer la variable** est l'exigence du critère : un avertissement qui
    // dit « aucun administrateur » sans dire quoi renseigner envoie lire le
    // code.
    expect(warning).toContain('SUPERADMIN_EMAIL')
  })

  it('se tait quand l’adresse est renseignée', () => {
    expect(
      missingSuperadminWarning({ available: true, designatedEmail: 'admin@example.test' }),
    ).toBeNull()
  })

  it('se tait quand le module est coupé : il n’y a alors pas de back-office', () => {
    expect(missingSuperadminWarning({ available: false, designatedEmail: null })).toBeNull()
  })

  /**
   * **Le témoin de câblage**, et il est nécessaire : les trois cas ci-dessus
   * éprouvent une fonction pure, qu'un démarrage qui ne l'appelle pas laisserait
   * verte. Celui-ci démarre réellement la configuration de Next.
   *
   * L'attente est **dérivée de la configuration** : le module coupé, il n'y a
   * pas de back-office, donc rien à avertir. Une attente écrite en dur ne
   * mordrait que dans une configuration, et `pnpm test:minimal-profile` — qui
   * coupe ce module — rougirait sans qu'aucune régression n'ait eu lieu.
   */
  it('est réellement émis par la garde de démarrage, et pas seulement calculable', async () => {
    // Chaque cas déclare **l'intégralité** de ce que la garde lit : un cas qui
    // n'annonce que sa variable ne passe que sur un poste dont le `.env`
    // complète le reste (revue de s06, G1).
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_FROM', '')
    vi.stubEnv('EMAIL_LOCAL_CAPTURE', '1')
    vi.stubEnv('AUTH_SECRET', 'x'.repeat(40))
    vi.stubEnv('APP_URL', 'http://localhost:3000')
    vi.stubEnv('STORAGE_S3_BUCKET', '')
    vi.stubEnv('STORAGE_S3_REGION', '')
    vi.stubEnv('STORAGE_S3_ACCESS_KEY_ID', '')
    vi.stubEnv('STORAGE_S3_SECRET_ACCESS_KEY', '')
    vi.stubEnv('STORAGE_LOCAL_DIRECTORY', '.storage')
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
    vi.stubEnv('PAYMENTS_LOCAL_MODE', '1')
    // La valeur vide vaut absence : c'est ce que `.env.example` livre.
    vi.stubEnv('SUPERADMIN_EMAIL', '')

    const warned: string[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.map(String).join(' '))
    })

    try {
      vi.resetModules()
      const { default: config } = await import('../apps/web/next.config')

      config('phase-development-server')
    } finally {
      warn.mockRestore()
    }

    const said = warned.join('\n')

    if (admin.available) {
      expect(said).toContain('SUPERADMIN_EMAIL')
    } else {
      expect(said).not.toContain('SUPERADMIN_EMAIL')
    }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })
})
