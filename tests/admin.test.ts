import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildRegistry,
  MODULE_ROUTE_PREFIX,
  visibleNavigation,
  type ModuleSession,
} from '@repo/core'
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
  BACK_OFFICE_PAGE_SIZE,
  configureAdmin,
  resetAdminService,
  SUPERADMIN_ROLE,
  type AdminAccountsPort,
  type AdminOrganizationsPort,
  type AdminSecurityEvent,
  type AdminService,
} from '@repo/module-admin'
import {
  authModule,
  configureAuth,
  resetAuthService,
  type AuthService,
} from '@repo/module-auth'
import { BILLING_DISPLAY_STATES } from '@repo/module-billing'
import { ORGANIZATION_ROLES, organizationsModule } from '@repo/module-organizations'
import { BAN_REASON_MAX_LENGTH } from '@repo/module-auth'
import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { admin, adminAccountsPort, missingSuperadminWarning } from '../apps/web/lib/admin'
import { availableModules, enabledModules, requiredModules } from '../config/features'
import { appLocales } from '../config/i18n'
import { minimalProfile } from '../config/profiles'
import { applyProfile, sweepProfile } from '../scripts/minimal-profile-rules'
import { databaseUrl, isDatabaseReachable } from './fixtures/database'
import { createPlatformRoleLock } from './fixtures/platform-role-lock'
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
/**
 * Le service du module, **retenu** : les écrans du back-office (s37b2) passent
 * par ses cas d'usage, pas par une route — ce sont des composants serveur.
 */
let service: AdminService
/** Le mailer du socle, retenu : la réinitialisation de s37b2 se mesure sur l'envoi. */
const mailer = createRecordingMailer()

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

/**
 * La même porte, posée dans la **lecture des comptes fermés** : elle sert au cas
 * concurrent qui mesure que la promotion prend le verrou. `null` partout
 * ailleurs.
 */
let blockedGate: (() => Promise<void>) | null = null

/**
 * La lecture des comptes est-elle possible ? Un seul cas la coupe : celui qui
 * mesure qu'un port en échec **refuse** au lieu de décider sur un décompte
 * qu'il n'a pas.
 */
let blockedReadable = true

/**
 * La **nature de la session de l'appelant** est-elle lisible ? Un seul cas la
 * coupe, pour la même raison : ne pas savoir si une session est empruntée
 * n'autorise pas à supposer qu'elle ne l'est pas.
 */
let borrowerReadable = true

/**
 * La **page de comptes** est-elle lisible ? Un seul cas la coupe : celui qui
 * mesure qu'une liste qu'on n'a pas pu lire rend une erreur nommée, et non une
 * liste vide — un back-office qui affiche « aucun compte » sur une panne ment.
 */
let listReadable = true

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
  endBorrowsBy: async (userId) => ({ ok: true, ended: await auth.useCases.endBorrowsBy(userId) }),
  startImpersonation: async (input) => await auth.startImpersonation(input),
  stopImpersonation: async (input) => await auth.stopImpersonation(input),
  borrowerOf: async (request) =>
    borrowerReadable
      ? { ok: true, impersonatedBy: await auth.borrowerOf(request) }
      : { ok: false },
  sweepExpiredImpersonations: async (at) => ({
    ok: true,
    ended: (await auth.useCases.sweepExpiredImpersonations(at)).map((ended) => ({
      userId: ended.userId,
      impersonatedBy: ended.impersonatedBy,
    })),
  }),
  signInBlockedAmong: async (userIds) => {
    await blockedGate?.()

    return blockedReadable
      ? { ok: true, blocked: await auth.useCases.signInBlockedAmong(userIds) }
      : { ok: false }
  },
  /**
   * **Les lectures du back-office** (s37b2), câblées sur le **vrai** module
   * `auth` comme les autres : la page de comptes vient de la base, la recherche
   * la filtre en base, et la révocation efface une vraie ligne de session.
   */
  listAccounts: async (input) =>
    listReadable
      ? { ok: true, ...(await auth.useCases.searchAccounts(input)) }
      : { ok: false },
  describeAccount: async (userId) => {
    if (!listReadable) {
      return { ok: false }
    }

    const account = await auth.useCases.describeAccount(userId)

    if (account === null) {
      return { ok: true, detail: null }
    }

    return {
      ok: true,
      detail: {
        account,
        sessions: (
          await auth.useCases.listSessions({ userId, currentSessionId: null })
        ).map((session) => ({
          sessionId: session.id,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
        })),
      },
    }
  },
  revokeSession: async ({ userId, sessionId }) => ({
    ok: true,
    revoked: await auth.useCases.revokeSession({ userId, sessionId }),
  }),
  /**
   * La même ligne que `apps/web/lib/admin.ts` : le socle part d'un
   * **identifiant** et relit l'adresse lui-même. Aucune adresse ne traverse le
   * back-office.
   */
  sendPasswordReset: async ({ userId }) => ({
    ok: true,
    sent: await auth.requestPasswordResetFor(userId),
  }),
}

/**
 * **Les organisations, vues du back-office** — une doublure, et c'est la bonne
 * forme ici.
 *
 * Elle remplace un **autre module**, pas la règle éprouvée : ce que ce fichier
 * mesure est la garde du back-office et la mise en forme, jamais la lecture des
 * appartenances, qui se prouve là où elle vit (`tests/organizations.test.ts`).
 * Un seul témoin de refus lui suffit — un port en échec fait refuser l'écran.
 */
let organizationsReadable = true

const ORGANIZATION = {
  organizationId: 'org_s37b2',
  name: 'Organisation de test',
  slug: 'organisation-de-test',
  memberCount: 2,
  offerId: 'pro',
  subscriptionState: 'active',
} as const

const organizations: AdminOrganizationsPort = {
  listOrganizations: async ({ search }) =>
    organizationsReadable
      ? {
          ok: true,
          organizations:
            search === null || ORGANIZATION.name.includes(search) ? [ORGANIZATION] : [],
          total: search === null || ORGANIZATION.name.includes(search) ? 1 : 0,
        }
      : { ok: false },
  describeOrganization: async (organizationId) =>
    organizationsReadable
      ? {
          ok: true,
          detail:
            organizationId === ORGANIZATION.organizationId
              ? {
                  organization: ORGANIZATION,
                  members: [
                    { userId: 'usr_owner', email: 'owner@example.test', role: 'owner' },
                  ],
                }
              : null,
        }
      : { ok: false },
  membershipsOf: async () =>
    organizationsReadable
      ? {
          ok: true,
          memberships: [
            {
              organizationId: ORGANIZATION.organizationId,
              name: ORGANIZATION.name,
              role: 'owner',
            },
          ],
        }
      : { ok: false },
}

/** Reconfigure le module avec l'adresse désignée du moment. */
const configure = (email: string | null): void => {
  service = configureAdmin({
    db: connection.db,
    accounts,
    organizations,
    designatedEmail: email,
    securityLog: (event) => securityEvents.push(event),
  })
}

interface CallOptions {
  readonly session?: ModuleSession | null
  readonly body?: unknown
  /**
   * Le cookie de session de l'appelant, quand le cas en exige un **vrai**.
   *
   * Les cas de `s37a` posent une `ModuleSession` : ce qu'ils mesurent ne dépend
   * pas du cookie. L'impersonation, si — elle fait tourner la session, et une
   * rotation ne se mesure que sur le jeton réellement posé. La session du
   * répartiteur est alors résolue **du cookie**, exactement comme dans
   * l'application.
   */
  readonly cookie?: string
}

/** Une requête d'administration, telle que l'application la sert. */
const call = async (
  path:
    | 'grantSuperadmin'
    | 'revokeSuperadmin'
    | 'banAccount'
    | 'unbanAccount'
    | 'startImpersonation'
    | 'stopImpersonation'
    | 'revokeAccountSession'
    | 'sendPasswordReset',
  options: CallOptions = {},
): Promise<Response> =>
  await dispatchAllowingRateLimit(
    registry,
    new Request(`${APP_URL}${adminRoutePath(path)}`, {
      method: 'POST',
      headers:
        options.cookie === undefined
          ? { 'content-type': 'application/json' }
          : { 'content-type': 'application/json', cookie: options.cookie },
      body: JSON.stringify(options.body ?? {}),
    }),
    {
      resolveSession:
        options.cookie === undefined
          ? () => Promise.resolve(options.session ?? null)
          : (request) => auth.resolveSession(request),
    },
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

/** Les cookies qu'une réponse pose, tels qu'un navigateur les renverrait. */
const cookieOf = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .filter((pair) => pair !== '')
    .join('; ')

/** Une requête nue portant ce cookie : de quoi demander au socle ce qu'il en dit. */
const requestWith = (cookie: string): Request =>
  new Request(APP_URL, { headers: { cookie } })

/**
 * Un compte réel **et connecté** : inscrit par le parcours du socle, vérifié,
 * puis connecté. Le cookie rendu est celui de sa session.
 */
const signedIn = async (): Promise<{
  readonly userId: string
  readonly email: string
  readonly cookie: string
}> => {
  const email = anEmail()

  await callAuth('/sign-up/email', { email, password: PASSWORD })
  await connection.db.execute(
    sql`update auth_user set email_verified = true where email = ${email}`,
  )

  const response = await callAuth('/sign-in/email', { email, password: PASSWORD })

  return {
    userId: (await auth.useCases.identifyAccount(email))?.userId ?? '',
    email,
    cookie: cookieOf(response),
  }
}

const superadminRows = async (): Promise<number> => {
  const counted = await connection.db.execute<{ count: number }>(
    sql`select count(*)::int as count from admin_platform_role where role = ${SUPERADMIN_ROLE}`,
  )

  return Number(counted.rows[0]?.count ?? 0)
}

/**
 * **L'exclusivité sur la table du rôle**, le temps de chaque cas.
 *
 * Ce fichier vide `admin_platform_role` avant chaque cas — la désignation du
 * premier superadmin n'a de sens que sur une base sans aucun superadmin —, et
 * `tests/account-deletion.test.ts` y écrit les siennes au même moment. Le
 * verrou est ce qui rend les deux fichiers compatibles ; le détail est dans
 * `fixtures/platform-role-lock.ts`.
 */
const platformRoleLock = createPlatformRoleLock()

beforeAll(async () => {
  if (!databaseReachable) {
    return
  }

  await platformRoleLock.open()
  connection = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 5 })

  await runModuleMigrations({
    db: connection.db,
    plan: planModuleMigrations({ modules: [authModule, adminModule], repoRoot: REPO_ROOT }),
  })

  auth = configureAuth({
    db: connection.db,
    mailer,
    secret: TEST_SECRET,
    appUrl: APP_URL,
  })
})

beforeEach(async () => {
  if (!databaseReachable) {
    return
  }

  await platformRoleLock.acquire()

  // Chaque cas part d'une plateforme **sans aucun superadmin** : c'est l'état
  // que le critère nomme (« base vierge »), et le seul dans lequel la
  // désignation a un sens.
  await connection.db.execute(sql`delete from admin_platform_role`)
  securityEvents.length = 0
  banGate = null
  blockedGate = null
  blockedReadable = true
  borrowerReadable = true
  listReadable = true
  organizationsReadable = true
  mailer.reset()
  configure(null)
})

afterEach(async () => {
  if (databaseReachable) {
    await platformRoleLock.release()
  }
})

afterAll(async () => {
  resetAdminService()
  resetAuthService()

  if (databaseReachable) {
    await platformRoleLock.close()
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

  /**
   * **Le quatrième décompte** (constat MJ2 de la revue de s37b1) : celui que la
   * désignation regarde.
   *
   * Trois écritures partagent la lecture des comptes fermés ; la désignation est
   * la quatrième, et le critère dit « **tout** décompte ». Ce qu'elle change est
   * une **réparation** : une plateforme dont aucun porteur du rôle ne peut plus
   * se connecter redevient désignable, là où un décompte de lignes la laissait
   * définitivement muette. Elle était correcte et **rien ne la mesurait** —
   * revenir au décompte de lignes laissait la suite entière verte.
   *
   * L'état de départ est atteint par un chemin réel, celui que
   * `packages/modules/admin/AGENTS.md` décrit : bannir un pair superadmin est
   * permis, et le **dernier compte capable** disparaît ensuite par l'effacement
   * de son compte (`purgeAccount`, s34), qui emporte son rôle par cascade.
   */
  it('redésigne quand plus aucun porteur du rôle ne peut se connecter', async () => {
    const first = await anAccount()
    const peer = await anAccount()
    const rescue = await anAccount()

    configure(first.email)
    await call('grantSuperadmin', { session: first.session, body: { userId: peer.session.userId } })
    // Permis : il reste un superadmin capable de se connecter.
    expect(
      (await call('banAccount', { session: first.session, body: { userId: peer.session.userId } }))
        .status,
    ).toBe(200)

    // Le dernier compte capable s'efface : son rôle part avec lui (cascade).
    await connection.db.execute(sql`delete from auth_user where id = ${first.session.userId}`)

    // Il reste **une ligne** de rôle, celle du banni — et zéro superadmin
    // capable d'entrer.
    expect(await superadminRows()).toBe(1)

    configure(rescue.email)

    const served = await call('grantSuperadmin', {
      session: rescue.session,
      body: { userId: rescue.session.userId },
    })

    // La désignation se redéclenche : la plateforme est réparable sans écriture
    // à la main.
    expect(served.status).toBe(200)
    expect(await superadminRows()).toBe(2)
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

  /**
   * **Ne pas savoir si la session est empruntée vaut refus** (constat MAJOR-1 de
   * la seconde revue de s37b1).
   *
   * La garde du back-office demande au socle si la session de l'appelant est un
   * emprunt. Le port peut échouer — c'est une lecture en base —, et la réponse à
   * un échec est le **404**, pas « ce n'est donc pas un emprunt ». Sans ce cas,
   * transformer l'échec en autorisation laissait la suite entière verte : la
   * porte s'ouvrait en grand sur une panne de lecture.
   */
  it('répond 404 quand la nature de la session de l’appelant n’a pas pu être lue', async () => {
    const { session, email } = await anAccount()

    configure(email)
    // La désignation a lieu ici : ce compte administre pour de bon.
    expect(
      (await call('grantSuperadmin', { session, body: { userId: session.userId } })).status,
    ).toBe(200)

    borrowerReadable = false

    const refused = await call('grantSuperadmin', { session, body: { userId: session.userId } })

    expect(refused.status).toBe(404)
    await expect(refused.json()).resolves.toEqual({ error: 'not_found' })
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

/**
 * **Le back-office en lecture** (s37b2), mesuré là où il décide : les cas
 * d'usage. Les écrans sont des composants serveur — il n'y a pas de route à
 * appeler —, et c'est ici que vit la garde qui répond **404 et jamais 403**.
 */
describe.runIf(databaseReachable)('les listes du back-office', () => {
  /** Un superadmin réel : la désignation le nomme, puis il administre. */
  const aSuperadmin = async (): Promise<{ userId: string; email: string }> => {
    const { session, email } = await anAccount()

    configure(email)
    // Une requête servie déclenche la désignation : le rôle est en base après.
    expect(
      (await call('grantSuperadmin', { session, body: { userId: session.userId } })).status,
    ).toBe(200)

    return { userId: session.userId, email }
  }

  const request = (): Request => new Request(APP_URL)

  it('sert une page de comptes, et la recherche la réduit', async () => {
    const superadmin = await aSuperadmin()
    const target = await anAccount()

    const listed = await service.useCases.viewAccounts({
      request: request(),
      viewerId: superadmin.userId,
      query: { search: null, page: 1 },
    })

    expect(listed.ok).toBe(true)

    if (!listed.ok) {
      return
    }

    expect(listed.view.accounts.length).toBeGreaterThan(0)
    expect(listed.view.accounts.length).toBeLessThanOrEqual(BACK_OFFICE_PAGE_SIZE)
    expect(listed.view.total).toBeGreaterThanOrEqual(2)

    // La recherche porte sur l'adresse, et elle est **paramétrée** : le compte
    // visé est le seul rendu.
    const searched = await service.useCases.viewAccounts({
      request: request(),
      viewerId: superadmin.userId,
      query: { search: target.email, page: 1 },
    })

    expect(searched.ok && searched.view.accounts.map((account) => account.email)).toEqual([
      target.email,
    ])
    expect(searched.ok && searched.view.total).toBe(1)

    /**
     * **La colonne « Droits », dans ses deux états** (critère 1, revue F5).
     *
     * Le compte visé n'administre pas, le superadmin si — et c'est la seule
     * mesure de `superadminsAmong` : la rendre vide laissait les cas verts, et
     * l'écran aurait affiché « aucun droit » pour tout le monde, superadmins
     * compris. Le second `expect` sans le premier ne mordrait pas : « faux
     * partout » est ce que le défaut produit.
     */
    expect(searched.ok && searched.view.accounts.map((account) => account.superadmin)).toEqual([
      false,
    ])

    const administrators = await service.useCases.viewAccounts({
      request: request(),
      viewerId: superadmin.userId,
      query: { search: superadmin.email, page: 1 },
    })

    expect(
      administrators.ok && administrators.view.accounts.map((account) => account.superadmin),
    ).toEqual([true])
  })

  it('cherche un pour-cent, il ne rend pas la table entière', async () => {
    const superadmin = await aSuperadmin()

    // Le joker de `like` écrit par l'appelant : échappé, il ne trouve rien.
    // Non échappé, il rendrait tous les comptes et le décompte mentirait.
    const searched = await service.useCases.viewAccounts({
      request: request(),
      viewerId: superadmin.userId,
      query: { search: '%', page: 1 },
    })

    expect(searched.ok && searched.view.total).toBe(0)
  })

  it('répond 404 à un compte qui n’administre pas, sans lire un seul compte', async () => {
    const { email } = await anAccount()
    const intruder = await anAccount()

    configure(email)

    let reads = 0
    const counted = { ...accounts }

    listReadable = true

    const spying: AdminAccountsPort = {
      ...counted,
      listAccounts: async (input) => {
        reads += 1

        return await counted.listAccounts(input)
      },
    }

    const guarded = configureAdmin({
      db: connection.db,
      accounts: spying,
      organizations,
      designatedEmail: email,
      securityLog: (event) => securityEvents.push(event),
    })

    const refused = await guarded.useCases.viewAccounts({
      request: request(),
      viewerId: intruder.session.userId,
      query: { search: null, page: 1 },
    })

    // 404, jamais 403 : un 403 confirmerait que le back-office existe.
    expect(refused).toEqual({ ok: false, error: 'not_found' })
    // Et le refus **n’atteint pas la couche de données** : une liste de comptes
    // lue puis jetée serait une lecture qu'un non-superadmin a provoquée.
    expect(reads).toBe(0)
  })

  it('refuse la liste quand la lecture des comptes échoue, au lieu de la dire vide', async () => {
    const superadmin = await aSuperadmin()

    listReadable = false

    const refused = await service.useCases.viewAccounts({
      request: request(),
      viewerId: superadmin.userId,
      query: { search: null, page: 1 },
    })

    expect(refused).toEqual({ ok: false, error: 'unavailable' })
  })

  it('sert le détail d’un compte : ses sessions, son rôle et ses organisations', async () => {
    const superadmin = await aSuperadmin()
    const target = await signedIn()

    const detailed = await service.useCases.viewAccount({
      request: request(),
      viewerId: superadmin.userId,
      userId: target.userId,
    })

    expect(detailed.ok).toBe(true)

    if (!detailed.ok) {
      return
    }

    expect(detailed.view.account.email).toBe(target.email)
    expect(detailed.view.account.banned).toBe(false)
    // La session ouverte par la connexion est là, **sans son jeton**.
    expect(detailed.view.sessions.length).toBe(1)
    expect(JSON.stringify(detailed.view.sessions)).not.toContain('token')
    // Le rôle de plateforme est **relu en base**, pas déduit de l'appelant.
    expect(detailed.view.superadmin).toBe(false)
    expect(detailed.view.memberships.map((membership) => membership.role)).toEqual(['owner'])
  })

  it('répond 404 sur un compte que le socle ne connaît pas', async () => {
    const superadmin = await aSuperadmin()

    const missing = await service.useCases.viewAccount({
      request: request(),
      viewerId: superadmin.userId,
      userId: 'usr_inconnu',
    })

    expect(missing).toEqual({ ok: false, error: 'not_found' })
  })

  it('répond 404 sur le détail à un compte qui n’administre pas', async () => {
    const { email } = await anAccount()
    const intruder = await anAccount()
    const target = await anAccount()

    configure(email)

    const refused = await service.useCases.viewAccount({
      request: request(),
      viewerId: intruder.session.userId,
      userId: target.session.userId,
    })

    expect(refused).toEqual({ ok: false, error: 'not_found' })
  })

  it('sert la liste des organisations, et son détail', async () => {
    const superadmin = await aSuperadmin()

    const listed = await service.useCases.viewOrganizations({
      request: request(),
      viewerId: superadmin.userId,
      query: { search: null, page: 1 },
    })

    expect(listed.ok && listed.view.organizations.map((entry) => entry.slug)).toEqual([
      'organisation-de-test',
    ])

    const detailed = await service.useCases.viewOrganization({
      request: request(),
      viewerId: superadmin.userId,
      organizationId: 'org_s37b2',
    })

    expect(detailed.ok && detailed.view.members.map((member) => member.role)).toEqual(['owner'])
    expect(detailed.ok && detailed.view.organization.subscriptionState).toBe('active')
  })

  it('répond 404 sur les organisations à un compte qui n’administre pas', async () => {
    const { email } = await anAccount()
    const intruder = await anAccount()

    configure(email)

    // **Un seul témoin de refus par porte** : la matrice des acteurs est
    // éprouvée une fois, à la garde ; ceci prouve que cette porte-là l'appelle.
    expect(
      await service.useCases.viewOrganizations({
        request: request(),
        viewerId: intruder.session.userId,
        query: { search: null, page: 1 },
      }),
    ).toEqual({ ok: false, error: 'not_found' })

    expect(
      await service.useCases.viewOrganization({
        request: request(),
        viewerId: intruder.session.userId,
        organizationId: 'org_s37b2',
      }),
    ).toEqual({ ok: false, error: 'not_found' })
  })
})

describe.runIf(databaseReachable)('les deux gestes du back-office', () => {
  const aSuperadmin = async (): Promise<{ userId: string; email: string }> => {
    const { session, email } = await anAccount()

    configure(email)
    expect(
      (await call('grantSuperadmin', { session, body: { userId: session.userId } })).status,
    ).toBe(200)

    return { userId: session.userId, email }
  }

  it('révoque une session, et le serveur cesse de la servir', async () => {
    const superadmin = await aSuperadmin()
    const target = await signedIn()

    // La session **vaut** avant : sans ce témoin, l'absence d'après ne prouve rien.
    await expect(auth.resolveSession(requestWith(target.cookie))).resolves.not.toBeNull()

    const sessions = await auth.useCases.listSessions({
      userId: target.userId,
      currentSessionId: null,
    })
    const sessionId = sessions[0]?.id ?? ''

    const revoked = await call('revokeAccountSession', {
      session: { userId: superadmin.userId, roles: [] },
      body: { userId: target.userId, sessionId },
    })

    expect(revoked.status).toBe(200)
    // **Côté serveur** (`docs/security.md` §2) : ce n'est pas un bouton qui a
    // disparu d'un écran, c'est le cookie qui ne désigne plus personne.
    await expect(auth.resolveSession(requestWith(target.cookie))).resolves.toBeNull()
  })

  it('accepte la soumission d’un formulaire natif, et renvoie sur l’écran', async () => {
    const superadmin = await aSuperadmin()
    const target = await signedIn()
    const [session] = await auth.useCases.listSessions({
      userId: target.userId,
      currentSessionId: null,
    })

    // **Un `<form method="post">`, pas un appel JSON** : c'est ce que l'écran de
    // détail envoie. Lire uniquement le JSON rendait 400 sur chaque clic, sans
    // que rien ne le dise — et un 200 JSON aurait laissé la personne devant un
    // document au lieu de son écran.
    const submitted = await dispatchAllowingRateLimit(
      registry,
      new Request(`${APP_URL}${adminRoutePath('revokeAccountSession')}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          userId: target.userId,
          sessionId: session?.id ?? '',
        }).toString(),
      }),
      { resolveSession: () => Promise.resolve({ userId: superadmin.userId, roles: [] }) },
    )

    expect(submitted.status).toBe(303)
    expect(submitted.headers.get('location')).toContain(`/admin/users/${target.userId}`)
    await expect(auth.resolveSession(requestWith(target.cookie))).resolves.toBeNull()
  })

  /**
   * **Un appelant JSON qui n'annonce pas son type** (revue de s37b2, constat
   * F10).
   *
   * `s37b1` lisait le corps en JSON sans condition ; s37b2 a ajouté la
   * soumission de formulaire, et l'a fait par un `sinon` — *tout ce qui n'est
   * pas `application/json` est un formulaire*. Un appelant programmatique qui
   * omet l'en-tête recevait donc 400 là où il fonctionnait, et une redirection
   * 303 au lieu de son document.
   *
   * La décision se prend désormais sur ce que la requête **annonce être** — un
   * formulaire —, jamais sur ce qu'elle n'annonce pas : un type absent reste du
   * JSON, comme avant. Les deux moitiés (quel décodage, quelle forme de
   * réponse) sortent du **même** prédicat, si bien qu'elles ne peuvent plus
   * diverger.
   */
  it('sert un appelant JSON qui n’annonce pas son type, comme avant', async () => {
    const superadmin = await aSuperadmin()
    const target = await signedIn()
    const [session] = await auth.useCases.listSessions({
      userId: target.userId,
      currentSessionId: null,
    })

    const answered = await dispatchAllowingRateLimit(
      registry,
      new Request(`${APP_URL}${adminRoutePath('revokeAccountSession')}`, {
        method: 'POST',
        // **Aucun `content-type`** : c'est tout le sujet du cas.
        body: JSON.stringify({ userId: target.userId, sessionId: session?.id ?? '' }),
      }),
      { resolveSession: () => Promise.resolve({ userId: superadmin.userId, roles: [] }) },
    )

    expect(answered.status).toBe(200)
    // Un document, pas une redirection : l'appelant n'est pas un navigateur.
    expect(answered.headers.get('location')).toBeNull()
    await expect(auth.resolveSession(requestWith(target.cookie))).resolves.toBeNull()
  })

  it('ne révoque pas la session d’un autre compte que celui qu’on vise', async () => {
    const superadmin = await aSuperadmin()
    const target = await signedIn()
    const bystander = await signedIn()

    const [session] = await auth.useCases.listSessions({
      userId: bystander.userId,
      currentSessionId: null,
    })

    // L'identifiant de session appartient à `bystander`, le compte visé est
    // `target` : la condition est **dans l'écriture**, pas dans une lecture
    // préalable, donc rien ne bouge et le refus ne distingue rien.
    const refused = await call('revokeAccountSession', {
      session: { userId: superadmin.userId, roles: [] },
      body: { userId: target.userId, sessionId: session?.id ?? '' },
    })

    expect(refused.status).toBe(404)
    await expect(auth.resolveSession(requestWith(bystander.cookie))).resolves.not.toBeNull()
  })

  it('répond 404 à un compte qui n’administre pas, sur les deux gestes', async () => {
    const { email } = await anAccount()
    const intruder = await anAccount()
    const target = await signedIn()

    configure(email)
    // L'inscription de `signedIn()` a déjà fait partir un email de
    // vérification : sans cette remise à zéro, l'absence mesurée plus bas
    // serait vraie pour la mauvaise raison.
    mailer.reset()

    for (const path of ['revokeAccountSession', 'sendPasswordReset'] as const) {
      const refused = await call(path, {
        session: intruder.session,
        body: { userId: target.userId, sessionId: 'peu-importe' },
      })

      expect(refused.status, path).toBe(404)
    }

    // Et rien n'est parti : le refus n'atteint pas le socle.
    expect(mailer.sent.filter((email_) => email_.to === target.email)).toEqual([])
  })

  it('déclenche une réinitialisation vers l’adresse du compte visé', async () => {
    const superadmin = await aSuperadmin()
    const target = await signedIn()

    mailer.reset()

    const asked = await call('sendPasswordReset', {
      session: { userId: superadmin.userId, roles: [] },
      body: { userId: target.userId },
    })

    expect(asked.status).toBe(200)
    // **L'adresse n'est jamais entrée par le back-office** : elle est relue de
    // l'identifiant, ce qui est toute la borne d'import du module.
    expect(mailer.sent.map((sent) => sent.to)).toEqual([target.email])
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
   * **Les deux séquences mesurées en revue de `s37a`** (s37b1), et ce qu'elles
   * laissaient derrière elles.
   *
   * Chacune n'est faite que de gestes **permis** : bannir un pair est de la
   * modération entre pairs, se bannir soi-même et se révoquer sont des gestes
   * ordinaires. Le décompte ne comptait que des **lignes de rôle**, si bien
   * qu'un superadmin banni — incapable de se connecter — comptait encore. Au
   * bout des deux séquences, plus aucun superadmin ne pouvait entrer, la
   * désignation par `SUPERADMIN_EMAIL` ne se redéclenchait jamais (le décompte
   * de lignes rendait 1), et **aucune commande ne répare** cet état.
   *
   * Elles sont mesurées **contre la vraie base**, comme la revue de `s37a` les
   * a mesurées : une doublure du décompte prouverait ce que la doublure croit.
   */
  it('refuse de bannir le dernier superadmin non banni, après le bannissement de son pair', async () => {
    const { session, email } = await anAccount()
    const peer = await anAccount()

    configure(email)
    await call('grantSuperadmin', { session, body: { userId: peer.session.userId } })

    // Geste permis : le pair n'est pas le dernier.
    expect(
      (await call('banAccount', { session, body: { userId: peer.session.userId } })).status,
    ).toBe(200)

    // Deux **lignes** de rôle, mais un seul compte capable de se connecter.
    expect(await superadminRows()).toBe(2)

    const refused = await call('banAccount', {
      session,
      body: { userId: session.userId },
    })

    expect(refused.status).toBe(409)
    await expect(refused.json()).resolves.toMatchObject({ reason: 'last_superadmin' })

    // Et la plateforme reste administrable : le seul fait qui compte.
    expect(
      (await call('grantSuperadmin', { session, body: { userId: session.userId } })).status,
    ).toBe(200)
  })

  it('refuse de révoquer le dernier superadmin non banni, après le bannissement de son pair', async () => {
    const { session, email } = await anAccount()
    const peer = await anAccount()

    configure(email)
    await call('grantSuperadmin', { session, body: { userId: peer.session.userId } })
    expect(
      (await call('banAccount', { session, body: { userId: peer.session.userId } })).status,
    ).toBe(200)

    const refused = await call('revokeSuperadmin', {
      session,
      body: { userId: session.userId },
    })

    expect(refused.status).toBe(409)
    await expect(refused.json()).resolves.toMatchObject({ reason: 'last_superadmin' })

    // La ligne est toujours là, et son porteur administre encore.
    expect(await superadminRows()).toBe(2)
    expect(
      (await call('grantSuperadmin', { session, body: { userId: session.userId } })).status,
    ).toBe(200)
  })

  /**
   * **La promotion sérialisée avec la révocation** (s37b1, tâche 5), mesurée
   * sur un cas **concurrent** — un cas séquentiel laisse cette garde verte.
   *
   * Ce que la fenêtre ouvre, quand la promotion ne prend pas le verrou : la
   * révocation lit les porteurs du rôle et demande au socle lesquels sont
   * fermés ; une promotion validée entre cette lecture et son `delete` ajoute
   * une ligne dont personne n'a demandé si son porteur peut entrer. Le prédicat
   * la compte comme un survivant, et le **dernier superadmin utilisable** perd
   * son rôle. Aucune commande ne répare cet état.
   */
  it('sérialise la promotion : promouvoir un compte fermé ne fait pas retirer le dernier', async () => {
    const { session, email } = await anAccount()
    const closed = await anAccount()

    configure(email)
    // La désignation a lieu ici : ce compte est le seul superadmin.
    await call('grantSuperadmin', { session, body: { userId: session.userId } })
    // Un compte banni, sans rôle : c'est lui que la promotion concurrente vise.
    expect(
      (await call('banAccount', { session, body: { userId: closed.session.userId } })).status,
    ).toBe(200)

    // Plus aucune adresse désignée : la garde d'accès ne consulte donc plus les
    // comptes, et la porte ci-dessous ne s'ouvre que dans la transaction de la
    // révocation.
    configure(null)

    let release = (): void => {}
    let entered = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const entering = new Promise<void>((resolve) => {
      entered = resolve
    })

    blockedGate = async () => {
      entered()

      await gate
    }

    try {
      const revoking = call('revokeSuperadmin', { session, body: { userId: session.userId } })

      // Le verrou est tenu, les porteurs du rôle sont lus, l'état des comptes
      // est demandé au socle : c'est exactement la fenêtre.
      await entering

      const granting = call('grantSuperadmin', { session, body: { userId: closed.session.userId } })

      // Sans verrou sur la promotion, elle est commise ici — et le prédicat de
      // la révocation comptera sa ligne.
      await new Promise((resolve) => setTimeout(resolve, 250))

      release()

      const refused = await revoking

      expect(refused.status).toBe(409)
      await expect(refused.json()).resolves.toMatchObject({ reason: 'last_superadmin' })
      expect((await granting).status).toBe(200)

      // Le seul fait qui compte : la plateforme est encore administrable.
      expect(
        (await call('grantSuperadmin', { session, body: { userId: session.userId } })).status,
      ).toBe(200)
    } finally {
      release()
      blockedGate = null
    }
  }, 30_000)

  /**
   * **Une lecture des comptes en échec refuse**, elle ne décide pas (s37b1).
   *
   * Le port ne lève pas : il rend un échec. Le prendre pour « personne n'est
   * banni » ferait décider les deux gardes sur un décompte qu'elles n'ont pas —
   * le sens ouvert, et la dette de `s37a` à nouveau.
   */
  it('refuse de bannir quand l’état des comptes n’a pas pu être lu', async () => {
    const { session, email } = await anAccount()
    const peer = await anAccount()

    configure(email)
    await call('grantSuperadmin', { session, body: { userId: peer.session.userId } })

    blockedReadable = false

    const refused = await call('banAccount', { session, body: { userId: peer.session.userId } })

    expect(refused.status).toBe(409)
    await expect(refused.json()).resolves.toMatchObject({ reason: 'accounts_unavailable' })
    // Et rien n'a été écrit : le refus n'atteint pas le socle.
    await expect(
      connection.db.execute<{ banned: boolean }>(
        sql`select banned from auth_user where id = ${peer.session.userId}`,
      ),
    ).resolves.toMatchObject({ rows: [{ banned: false }] })
  })

  /**
   * **Le geste qui nettoie une plateforme à moitié fermée**, mesuré de bout en
   * bout (minoritaire de la revue de s37b1 : la règle pure était éprouvée, le
   * chemin servi ne l'était pas).
   *
   * Retirer son rôle à un superadmin **banni** ne retire rien à
   * l'administrabilité — il ne pouvait déjà plus entrer. Sans cette permission,
   * la seule sortie d'une plateforme à moitié fermée serait une écriture en base
   * à la main.
   */
  it('laisse révoquer le rôle d’un superadmin banni, même s’il ne reste qu’un compte capable', async () => {
    const { session, email } = await anAccount()
    const peer = await anAccount()

    configure(email)
    await call('grantSuperadmin', { session, body: { userId: peer.session.userId } })
    await call('banAccount', { session, body: { userId: peer.session.userId } })

    // Un seul compte capable de se connecter : l'appelant.
    const revoked = await call('revokeSuperadmin', {
      session,
      body: { userId: peer.session.userId },
    })

    expect(revoked.status).toBe(200)
    expect(await superadminRows()).toBe(1)
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

describe.runIf(databaseReachable)('l’impersonation', () => {
  /**
   * **L'impersonation est une élévation de privilège** (s37b1), et
   * `docs/security.md` §2 y impose la rotation de session : l'identifiant en
   * cours n'est jamais réutilisé.
   *
   * Ce fichier la mesure **de bout en bout, sur de vrais cookies** : une
   * doublure de session prouverait que le module appelle quelque chose, pas que
   * le navigateur du superadmin se retrouve avec une session utilisable au nom
   * d'autrui — ni que l'ancienne a cessé de valoir.
   */
  it('ouvre une session au nom du compte visé, et l’ancienne cesse de valoir', async () => {
    const superadmin = await signedIn()
    const target = await signedIn()

    configure(superadmin.email)
    await call('grantSuperadmin', {
      cookie: superadmin.cookie,
      body: { userId: superadmin.userId },
    })

    const started = await call('startImpersonation', {
      cookie: superadmin.cookie,
      body: { userId: target.userId },
    })

    expect(started.status).toBe(200)

    // **Les attributs du socle**, sur le seul cookie de session que ce dépôt
    // pose lui-même (ADR 064) : ils viennent de la bibliothèque, ils ne sont
    // pas recopiés — mais rien ne le dirait si un jour ils l'étaient.
    const posed = started.headers.get('set-cookie') ?? ''

    expect(posed).toContain('HttpOnly')
    expect(posed).toContain('Secure')
    expect(posed).toContain('SameSite=Strict')

    const borrowed = cookieOf(started)

    // **La rotation** : ce n'est pas le même jeton…
    expect(borrowed).not.toBe(superadmin.cookie)
    // … il désigne le compte visé…
    await expect(auth.resolveSession(requestWith(borrowed))).resolves.toMatchObject({
      userId: target.userId,
    })
    // … et l'ancien ne vaut plus rien : une élévation qui laisserait la session
    // précédente utilisable n'en serait pas une (mesuré en s14 sur l'enrôlement).
    await expect(auth.resolveSession(requestWith(superadmin.cookie))).resolves.toBeNull()
  }, 60_000)

  it('rend la main : la sortie ferme la session empruntée et en rouvre une pour l’emprunteur', async () => {
    const superadmin = await signedIn()
    const target = await signedIn()

    configure(superadmin.email)
    await call('grantSuperadmin', {
      cookie: superadmin.cookie,
      body: { userId: superadmin.userId },
    })

    const borrowed = cookieOf(
      await call('startImpersonation', {
        cookie: superadmin.cookie,
        body: { userId: target.userId },
      }),
    )

    const stopped = await call('stopImpersonation', { cookie: borrowed })

    expect(stopped.status).toBe(200)

    const restored = cookieOf(stopped)

    // La session rendue est celle de l'emprunteur, et c'est une **nouvelle** :
    // la sortie fait tourner la session comme l'entrée.
    await expect(auth.resolveSession(requestWith(restored))).resolves.toMatchObject({
      userId: superadmin.userId,
    })
    expect(restored).not.toBe(borrowed)
    // Et la session empruntée est morte : le retour n'en laisse pas une ouverte
    // au nom du client.
    await expect(auth.resolveSession(requestWith(borrowed))).resolves.toBeNull()
  }, 60_000)

  /**
   * **Le premier des deux refus** (critère de la story) : un superadmin ne
   * s'emprunte pas. Emprunter un pair reviendrait à s'accorder ses droits sans
   * qu'aucun journal ne nomme un changement de rôle.
   */
  it('refuse d’emprunter la session d’un superadmin', async () => {
    const superadmin = await signedIn()
    const peer = await signedIn()

    configure(superadmin.email)
    await call('grantSuperadmin', { cookie: superadmin.cookie, body: { userId: peer.userId } })

    const refused = await call('startImpersonation', {
      cookie: superadmin.cookie,
      body: { userId: peer.userId },
    })

    expect(refused.status).toBe(409)
    await expect(refused.json()).resolves.toMatchObject({ reason: 'superadmin_target' })
    // Aucune session n'a été ouverte, et celle de l'appelant est intacte.
    expect(cookieOf(refused)).toBe('')
    await expect(auth.resolveSession(requestWith(superadmin.cookie))).resolves.toMatchObject({
      userId: superadmin.userId,
    })
  }, 60_000)

  /**
   * **Le second refus, et il n'était dans aucun critère** : une session
   * **empruntée** n'administre pas.
   *
   * Le chemin se découvre en production : le compte emprunté est promu pendant
   * l'emprunt. La session empruntée porte alors le compte d'un superadmin, et
   * sans cette garde elle ouvrirait le back-office — donc l'enchaînement d'une
   * impersonation depuis une impersonation, et un journal où l'acteur n'est
   * plus celui qui agit.
   */
  /**
   * **La journalisation aux deux bouts** (critère de la story), et les deux
   * identifiants à chaque bout : sans la cible, le journal ne dit pas au nom de
   * qui on est entré ; sans l'acteur, il ne dit pas qui est entré.
   */
  it('journalise le début et la fin de l’emprunt, avec les deux comptes', async () => {
    const superadmin = await signedIn()
    const target = await signedIn()

    configure(superadmin.email)
    await call('grantSuperadmin', {
      cookie: superadmin.cookie,
      body: { userId: superadmin.userId },
    })

    const borrowed = cookieOf(
      await call('startImpersonation', {
        cookie: superadmin.cookie,
        body: { userId: target.userId },
      }),
    )

    await call('stopImpersonation', { cookie: borrowed })

    expect(securityEvents).toContainEqual({
      event: 'admin.impersonation_started',
      actor: superadmin.userId,
      target: target.userId,
    })
    expect(securityEvents).toContainEqual({
      event: 'admin.impersonation_ended',
      actor: superadmin.userId,
      target: target.userId,
    })
  }, 60_000)

  it('journalise le refus d’emprunter un superadmin', async () => {
    const superadmin = await signedIn()
    const peer = await anAccount()

    configure(superadmin.email)
    await call('grantSuperadmin', { cookie: superadmin.cookie, body: { userId: peer.session.userId } })

    await call('startImpersonation', {
      cookie: superadmin.cookie,
      body: { userId: peer.session.userId },
    })

    expect(securityEvents).toContainEqual({
      event: 'admin.impersonation_refused',
      actor: superadmin.userId,
      target: peer.session.userId,
    })
  }, 60_000)

  /**
   * **Une session d'impersonation qui expire sans sortie explicite compte comme
   * une fin** (tâche 8 du plan).
   *
   * Sans ce balayage, le second événement n'est jamais émis pour un emprunt
   * abandonné : le journal n'aurait que des débuts, et lire « personne n'en est
   * sorti » y serait faux. La tâche est prise **dans le contrat du module**, pas
   * recopiée : une story qui la retirerait ferait rougir ce cas.
   */
  it('compte l’expiration d’un emprunt comme une fin, et ne la compte qu’une fois', async () => {
    const superadmin = await signedIn()
    const target = await signedIn()

    configure(superadmin.email)
    await call('grantSuperadmin', {
      cookie: superadmin.cookie,
      body: { userId: superadmin.userId },
    })

    await call('startImpersonation', {
      cookie: superadmin.cookie,
      body: { userId: target.userId },
    })

    // L'emprunt est abandonné : personne n'appelle la sortie, et son échéance
    // passe.
    await connection.db.execute(
      sql`update auth_session set expires_at = now() - interval '1 minute'
          where impersonated_by = ${superadmin.userId}`,
    )

    const [sweep] = adminModule.jobs

    expect(sweep, 'le module doit déclarer la tâche de balayage').toBeDefined()

    await sweep?.run({ key: 'test', data: {}, attempt: 1, now: new Date() })

    const ended = securityEvents.filter(
      (event) => event.event === 'admin.impersonation_ended' && event.actor === superadmin.userId,
    )

    expect(ended).toEqual([
      {
        event: 'admin.impersonation_ended',
        actor: superadmin.userId,
        target: target.userId,
      },
    ])

    // **Rejouée**, elle ne trouve plus rien : la session a été effacée, et
    // l'événement n'est pas réémis (`docs/reliability.md` §1).
    await sweep?.run({ key: 'test', data: {}, attempt: 2, now: new Date() })

    expect(
      securityEvents.filter(
        (event) => event.event === 'admin.impersonation_ended' && event.actor === superadmin.userId,
      ),
    ).toHaveLength(1)
  }, 60_000)

  it('refuse le back-office à une session empruntée, même quand le compte emprunté administre', async () => {
    const superadmin = await signedIn()
    const peer = await signedIn()
    const target = await signedIn()
    const someone = await anAccount()

    configure(superadmin.email)
    await call('grantSuperadmin', {
      cookie: superadmin.cookie,
      body: { userId: superadmin.userId },
    })
    await call('grantSuperadmin', { cookie: superadmin.cookie, body: { userId: peer.userId } })

    const borrowed = cookieOf(
      await call('startImpersonation', {
        cookie: superadmin.cookie,
        body: { userId: target.userId },
      }),
    )

    expect(borrowed).not.toBe('')

    // Le compte emprunté est promu **pendant** l'emprunt, par un autre
    // superadmin : la session empruntée porte désormais un compte qui
    // administre.
    expect(
      (await call('grantSuperadmin', { cookie: peer.cookie, body: { userId: target.userId } }))
        .status,
    ).toBe(200)

    const chained = await call('startImpersonation', {
      cookie: borrowed,
      body: { userId: someone.session.userId },
    })

    // 404, comme une URL inventée : ce n'est pas 403, et ce n'est surtout pas
    // une seconde session empruntée.
    expect(chained.status).toBe(404)
    expect(cookieOf(chained)).toBe('')
  }, 60_000)
})

/**
 * **Les quatre scénarios de la revue de `s37b1`**, mesurés contre PostgreSQL et
 * gardés ici pour de bon.
 *
 * Ils partagent une seule cause : `sessions.create` écrit la ligne de session
 * **en Drizzle**, donc hors du crochet `databaseHooks.session.create.before` de
 * la bibliothèque — la garde dont `better-auth-service.ts` dit qu'elle est posée
 * « au seul endroit que **tous** les parcours traversent … et tout parcours écrit
 * demain y passent ». Cette story est le parcours qui a démenti la phrase.
 *
 * Ce que ces cas exigent est donc plus large que leurs quatre énoncés : **toute**
 * session que ce dépôt ouvre passe par le même refus, et **tout** geste qui
 * ferme un compte ferme aussi les sessions qu'il **tient** chez autrui.
 */
describe.runIf(databaseReachable)('un emprunt ne survit pas à ce qui ferme son emprunteur', () => {
  /**
   * **C1 — le retour de bannissement, en libre-service.** Tous les gestes sont
   * permis, et à l'arrivée le compte banni s'est débanni lui-même.
   */
  it('n’ouvre aucune session à un superadmin banni pendant son emprunt, et ne le laisse pas se débannir', async () => {
    const superadmin = await signedIn()
    const peer = await signedIn()
    const target = await signedIn()

    configure(superadmin.email)
    await call('grantSuperadmin', {
      cookie: superadmin.cookie,
      body: { userId: superadmin.userId },
    })
    await call('grantSuperadmin', { cookie: superadmin.cookie, body: { userId: peer.userId } })

    const borrowed = cookieOf(
      await call('startImpersonation', {
        cookie: superadmin.cookie,
        body: { userId: target.userId },
      }),
    )

    expect(borrowed).not.toBe('')

    // Le pair bannit l'emprunteur. Geste permis : il reste un superadmin.
    expect(
      (await call('banAccount', { cookie: peer.cookie, body: { userId: superadmin.userId } }))
        .status,
    ).toBe(200)

    // La sortie ne doit **pas** rendre une session au compte banni.
    const stopped = await call('stopImpersonation', { cookie: borrowed })
    const restored = cookieOf(stopped)

    await expect(auth.resolveSession(requestWith(restored))).resolves.toBeNull()

    // Et le compte banni ne se débannit pas lui-même.
    await call('unbanAccount', {
      cookie: restored === '' ? borrowed : restored,
      body: { userId: superadmin.userId },
    })

    await expect(
      connection.db.execute<{ banned: boolean }>(
        sql`select banned from auth_user where id = ${superadmin.userId}`,
      ),
    ).resolves.toMatchObject({ rows: [{ banned: true }] })
  }, 60_000)

  /**
   * **C3 — bannir l'emprunteur doit éteindre l'emprunt.** `revokeAllForUser`
   * filtrait sur `user_id` : la ligne empruntée porte celui de la **cible**, et
   * survivait donc au bannissement de l'administrateur qui la tenait.
   */
  it('éteint la session empruntée quand l’emprunteur est banni', async () => {
    const superadmin = await signedIn()
    const peer = await signedIn()
    const target = await signedIn()

    configure(superadmin.email)
    await call('grantSuperadmin', {
      cookie: superadmin.cookie,
      body: { userId: superadmin.userId },
    })
    await call('grantSuperadmin', { cookie: superadmin.cookie, body: { userId: peer.userId } })

    const borrowed = cookieOf(
      await call('startImpersonation', {
        cookie: superadmin.cookie,
        body: { userId: target.userId },
      }),
    )

    await call('banAccount', { cookie: peer.cookie, body: { userId: superadmin.userId } })

    await expect(auth.resolveSession(requestWith(borrowed))).resolves.toBeNull()
    // La fin est journalisée : un emprunt fermé par un bannissement reste un
    // emprunt fermé, et le journal nomme les deux comptes.
    expect(securityEvents).toContainEqual({
      event: 'admin.impersonation_ended',
      actor: superadmin.userId,
      target: target.userId,
    })
  }, 60_000)

  /**
   * **Le même geste, par le retrait du rôle** : un compte qui n'administre plus
   * ne garde pas la session d'un client ouverte.
   */
  it('éteint la session empruntée quand le rôle de l’emprunteur est révoqué', async () => {
    const superadmin = await signedIn()
    const peer = await signedIn()
    const target = await signedIn()

    configure(superadmin.email)
    await call('grantSuperadmin', {
      cookie: superadmin.cookie,
      body: { userId: superadmin.userId },
    })
    await call('grantSuperadmin', { cookie: superadmin.cookie, body: { userId: peer.userId } })

    const borrowed = cookieOf(
      await call('startImpersonation', {
        cookie: superadmin.cookie,
        body: { userId: target.userId },
      }),
    )

    expect(
      (await call('revokeSuperadmin', { cookie: peer.cookie, body: { userId: superadmin.userId } }))
        .status,
    ).toBe(200)

    await expect(auth.resolveSession(requestWith(borrowed))).resolves.toBeNull()
    expect(securityEvents).toContainEqual({
      event: 'admin.impersonation_ended',
      actor: superadmin.userId,
      target: target.userId,
    })
  }, 60_000)

  /**
   * **MJ1 — un compte banni ne s'emprunte pas.** Le refus n'est pas une
   * politesse : la session empruntée porte le compte du banni, et l'ouvrir
   * revient à lui rendre une session par la bande.
   */
  it('refuse d’emprunter un compte banni', async () => {
    const superadmin = await signedIn()
    const target = await signedIn()

    configure(superadmin.email)
    await call('grantSuperadmin', {
      cookie: superadmin.cookie,
      body: { userId: superadmin.userId },
    })
    await call('banAccount', { cookie: superadmin.cookie, body: { userId: target.userId } })

    const refused = await call('startImpersonation', {
      cookie: superadmin.cookie,
      body: { userId: target.userId },
    })

    expect(refused.status).not.toBe(200)
    expect(cookieOf(refused)).toBe('')
  }, 60_000)

  /**
   * **C2 — l'échéance courte doit tenir.** `shouldBeUpdated`
   * (`api/routes/session.mjs`) vaut `expiresAt - expiresIn + updateAge <= now` :
   * il est **toujours vrai** pour une ligne écrite avec une échéance plus courte
   * que celle de la bibliothèque. Mesuré avant correction : la première lecture
   * portait l'échéance d'une heure à sept jours, et l'heure annoncée par
   * `AuthPolicy`, par `admin/AGENTS.md` et par l'ADR 064 était fausse.
   */
  /**
   * **La résolution de session porte l'emprunt** (revue de s37b2, F3).
   *
   * La coquille applicative affichait son bandeau au prix de deux
   * allers-retours de base supplémentaires par page authentifiée : un second
   * `getSession`, puis une lecture de la ligne de session. Elle lit désormais
   * `impersonatedBy` **sur la ligne que la résolution vient de charger**.
   *
   * Ce cas est ce qui rend cette lecture opposable : la colonne appartient à ce
   * dépôt (ADR 064), pas à la bibliothèque, et rien ne garantit contractuellement
   * qu'elle traverse. Si une version cessait de la rendre, ce cas rougit — au
   * lieu de laisser le bandeau disparaître en silence pour la seule personne
   * qui a besoin de le voir.
   */
  it('rend l’emprunteur avec la session, et rien pour une session ordinaire', async () => {
    const superadmin = await signedIn()
    const target = await signedIn()

    configure(superadmin.email)
    await call('grantSuperadmin', {
      cookie: superadmin.cookie,
      body: { userId: superadmin.userId },
    })

    // Une session ordinaire : personne ne l'emprunte.
    await expect(auth.resolveActiveSession(requestWith(target.cookie))).resolves.toMatchObject({
      session: { userId: target.userId },
      impersonatedBy: null,
    })

    const borrowed = cookieOf(
      await call('startImpersonation', {
        cookie: superadmin.cookie,
        body: { userId: target.userId },
      }),
    )

    // La session empruntée : elle nomme **l'emprunteur**, pas le compte affiché.
    await expect(auth.resolveActiveSession(requestWith(borrowed))).resolves.toMatchObject({
      session: { userId: target.userId },
      impersonatedBy: superadmin.userId,
    })
  }, 60_000)

  it('ne prolonge pas une session empruntée à la première lecture', async () => {
    const superadmin = await signedIn()
    const target = await signedIn()

    configure(superadmin.email)
    await call('grantSuperadmin', {
      cookie: superadmin.cookie,
      body: { userId: superadmin.userId },
    })

    const borrowed = cookieOf(
      await call('startImpersonation', {
        cookie: superadmin.cookie,
        body: { userId: target.userId },
      }),
    )

    const deadlineOf = async (): Promise<number> => {
      const rows = await connection.db.execute<{ seconds: number }>(
        sql`select extract(epoch from (expires_at - now()))::int as seconds
            from auth_session where impersonated_by = ${superadmin.userId}`,
      )

      return Number(rows.rows[0]?.seconds ?? 0)
    }

    expect(await deadlineOf()).toBeLessThanOrEqual(3600)

    // Une lecture — celle que fait n'importe quelle requête servie.
    await expect(auth.resolveSession(requestWith(borrowed))).resolves.toMatchObject({
      userId: target.userId,
    })

    // L'échéance n'a pas bougé : elle reste celle de l'emprunt.
    expect(await deadlineOf()).toBeLessThanOrEqual(3600)
  }, 60_000)

  /**
   * **Et la fenêtre glissante reste intacte pour tout le monde d'autre** : la
   * correction ci-dessus ne doit pas éteindre le renouvellement des sessions
   * ordinaires, sans quoi elle changerait la durée de vie d'une connexion.
   */
  it('prolonge toujours une session ordinaire arrivant en fin de fenêtre', async () => {
    const person = await signedIn()

    // Six jours ont passé sur une session de sept : la bibliothèque la
    // renouvelle à la lecture suivante.
    await connection.db.execute(
      sql`update auth_session set expires_at = now() + interval '6 days'
          where user_id = ${person.userId}`,
    )

    await expect(auth.resolveSession(requestWith(person.cookie))).resolves.toMatchObject({
      userId: person.userId,
    })

    const rows = await connection.db.execute<{ seconds: number }>(
      sql`select extract(epoch from (expires_at - now()))::int as seconds
          from auth_session where user_id = ${person.userId}`,
    )

    expect(Number(rows.rows[0]?.seconds ?? 0)).toBeGreaterThan(6 * 24 * 3600 + 3600)
  }, 60_000)
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
/**
 * **L'entrée du back-office se dérive du registre** (s37b2, ADR 066).
 *
 * C'est la forme que `s31` a établie pour le pied de page, appliquée à une
 * troisième surface : un module qui veut une entrée dans le back-office la
 * **déclare** à son contrat, et elle disparaît avec lui — sans qu'aucun fichier
 * de l'application, ni du module `admin`, ne le nomme.
 *
 * Aucune base ici : ce qui se prouve sur des contrats se prouve sans base.
 */
describe('l’entrée du back-office se dérive du registre', () => {
  const adminSurface = (enabled: readonly string[]): readonly string[] =>
    visibleNavigation(
      buildRegistry({
        available: [authModule, adminModule, organizationsModule],
        enabled: [...enabled],
        locales: [...appLocales],
      }),
      { userId: 'usr_1', roles: [] },
      'admin',
    ).map((entry) => `${entry.moduleId}:${entry.id}`)

  it('rend l’entrée d’un module activé, et la retire avec lui', () => {
    const withOrganizations = adminSurface(['auth', 'admin', 'organizations'])
    const withoutOrganizations = adminSurface(['auth', 'admin'])

    // Le contrôle positif : sans lui, l'absence ci-dessous serait vraie parce
    // que la surface entière est vide.
    expect(withOrganizations.length).toBeGreaterThan(withoutOrganizations.length)
    expect(
      withOrganizations.some((id) => id.startsWith(`${organizationsModule.id}:`)),
    ).toBe(true)
    expect(
      withoutOrganizations.some((id) => id.startsWith(`${organizationsModule.id}:`)),
    ).toBe(false)
    // Et l'entrée du module `admin`, elle, est toujours là.
    expect(withoutOrganizations.some((id) => id.startsWith(`${adminModule.id}:`))).toBe(true)
  })

  it('ne contribue plus rien quand le module d’administration est coupé', () => {
    const registry = buildRegistry({
      available: [authModule, adminModule, organizationsModule],
      enabled: ['auth', 'organizations'],
      locales: [...appLocales],
    })

    // `adminNavigation` cesse de contribuer, sur **toutes** les surfaces, et
    // aucune de ses routes n'est dans la table de routage.
    expect(registry.navigation.filter((entry) => entry.moduleId === adminModule.id)).toEqual([])
    expect(registry.routes.filter((route) => route.moduleId === adminModule.id)).toEqual([])

    // **Ce que cela ne fait pas**, dit plutôt que sous-entendu : l'entrée que
    // `organizations` déclare pour la surface du back-office reste dans le
    // registre. Elle n'est **rendue par personne** — le seul lecteur de cette
    // surface est un écran du back-office, et il n'existe plus (les quatre
    // répondent 404). C'est le pendant de la ligne du dessus : la surface
    // disparaît avec son unique lecteur, pas avec ses contributeurs.
    expect(adminSurface(['auth', 'organizations'])).toEqual([
      `${organizationsModule.id}:admin-organizations`,
    ])
  })

  it('ne paraît jamais dans la barre latérale du produit', () => {
    // Un lien « Administration » visible de tout compte connecté divulguerait
    // l'existence du back-office (`docs/security.md` §7). La surface est ce qui
    // l'en tient à l'écart, et `ModuleSession.roles` ne porte pas le rôle de
    // plateforme — une protection `role` ne serait satisfaite par personne.
    const sidebar = visibleNavigation(
      buildRegistry({
        available: [authModule, adminModule, organizationsModule],
        enabled: ['auth', 'admin', 'organizations'],
        locales: [...appLocales],
      }),
      { userId: 'usr_1', roles: [] },
    ).map((entry) => `${entry.moduleId}:${entry.id}`)

    expect(sidebar.some((id) => id.startsWith(`${adminModule.id}:`))).toBe(false)
    expect(sidebar).toContain(`${organizationsModule.id}:organizations`)
  })

  it('ne dépend d’aucun module de contenu, ni dans le module ni dans son point de composition', () => {
    // La dérivation n'a de valeur que si rien ne nomme le module par ailleurs :
    // une entrée dérivée du registre à côté d'un import direct serait un
    // deuxième chemin, et le second est celui qui survit à la coupure.
    const manifest: { readonly dependencies?: Record<string, string> } = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages/modules/admin/package.json'), 'utf8'),
    )

    expect(Object.keys(manifest.dependencies ?? {})).not.toContain(
      '@repo/module-organizations',
    )

    const composition = readFileSync(join(REPO_ROOT, 'apps/web/lib/back-office.ts'), 'utf8')
    const modulesImported = [...composition.matchAll(/@repo\/module-([a-z-]+)/g)].map(
      (match) => match[1],
    )

    // Le seul module que la composition du back-office connaît est celui du
    // back-office lui-même.
    expect([...new Set(modulesImported)]).toEqual([adminModule.id])
  })
})

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

/**
 * **Un port ne lève pas** (`AGENTS.md` racine), et c'est au point de composition
 * que la promesse se tient (constat MJ4 de la revue de s37b1).
 *
 * Les trois lectures branchées sur le socle parlent à la base. Sans cette
 * enveloppe, une panne **levait** : la branche `{ ok: false }` du module — celle
 * qui refuse un bannissement plutôt que de le décider sur un décompte qu'elle
 * n'a pas, et celle qui refuse le back-office à une session dont elle ne sait
 * pas si elle est empruntée — n'était atteignable par rien en production. Le
 * sens fermé survivait par accident : l'exception remontait en 500.
 *
 * La panne est jouée par la panne la plus banale qui soit : le service
 * d'authentification qui n'est pas là.
 */
describe('le port des comptes, quand la lecture échoue', () => {
  const port = adminAccountsPort(() => {
    throw new Error('base injoignable')
  })

  it('rend un refus, jamais une exception', async () => {
    await expect(port.signInBlockedAmong(['usr_1'])).resolves.toEqual({ ok: false })
    await expect(port.borrowerOf(new Request(APP_URL))).resolves.toEqual({ ok: false })
    await expect(port.endBorrowsBy('usr_1')).resolves.toEqual({ ok: false })
    await expect(port.sweepExpiredImpersonations(new Date())).resolves.toEqual({ ok: false })
  })

  it('n’ouvre ni ne ferme d’emprunt sur une panne, et le dit dans son vocabulaire', async () => {
    await expect(
      port.startImpersonation({
        request: new Request(APP_URL),
        actorId: 'usr_1',
        userId: 'usr_2',
      }),
    ).resolves.toEqual({ ok: false, error: 'unknown_account' })
    await expect(port.stopImpersonation({ request: new Request(APP_URL) })).resolves.toEqual({
      ok: false,
      error: 'not_impersonating',
    })
  })
})

/**
 * **Les deux clés composées du back-office, contre les vocabulaires dont elles
 * viennent** (revue de s37b2, constat F7).
 *
 * L'écran des organisations traduit un **état d'abonnement** et un **rôle de
 * membre** par des clés construites : `admin.subscription.<état>` et
 * `admin.role.<rôle>`. Les deux vocabulaires appartiennent à d'autres modules —
 * `billing` et `organizations` —, que le module `admin` ne peut pas importer
 * (il ne les requiert pas, et c'est la raison d'être de ses ports). Personne ne
 * rougissait donc quand ils dérivaient, et `intl.t` **lève** : un septième état
 * d'abonnement ou un quatrième rôle transformait l'écran en 500.
 *
 * Ce fichier est le seul endroit qui puisse tenir ce fil, parce qu'il est à la
 * racine et voit les trois modules. **Rien n'y est recopié** : les deux listes
 * sont dérivées de leur module d'origine, et les locales du contrat du module
 * `admin` — ajouter une langue n'ajoute pas une ligne ici.
 */
describe('le vocabulaire emprunté par le back-office', () => {
  const catalogues = Object.entries(adminModule.messages) as readonly (readonly [
    string,
    Record<string, string>,
  ])[]

  it('balaie réellement quelque chose : le module livre des catalogues et les listes ne sont pas vides', () => {
    // L'anti-vacuité : une liste vide ou un catalogue absent rendrait les deux
    // cas suivants verts sans rien vérifier.
    expect(catalogues.length).toBeGreaterThan(0)
    expect(BILLING_DISPLAY_STATES.length).toBeGreaterThan(0)
    expect(ORGANIZATION_ROLES.length).toBeGreaterThan(0)
  })

  it('traduit chaque état d’abonnement que `billing` sait afficher', () => {
    for (const [locale, catalogue] of catalogues) {
      expect(
        BILLING_DISPLAY_STATES.filter((state) => catalogue[`subscription.${state}`] === undefined),
        `${locale} — états d’abonnement sans libellé`,
      ).toEqual([])
    }
  })

  it('traduit chaque rôle que `organizations` sait attribuer', () => {
    for (const [locale, catalogue] of catalogues) {
      expect(
        ORGANIZATION_ROLES.filter((role) => catalogue[`role.${role}`] === undefined),
        `${locale} — rôles sans libellé`,
      ).toEqual([])
    }
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
    vi.stubEnv('INNGEST_EVENT_KEY', '')
    vi.stubEnv('INNGEST_SIGNING_KEY', '')
    vi.stubEnv('INNGEST_BASE_URL', '')
    vi.stubEnv('JOBS_LOCAL_RUNNER', '1')
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
