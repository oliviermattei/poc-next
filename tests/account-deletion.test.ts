import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import {
  buildRegistry,
  defineModule,
  dispatchModuleJob,
  purgeModules,
  type ModuleScope,
  type ModuleSession,
} from '@repo/core'
import {
  createDatabaseClient,
  planModuleMigrations,
  runModuleMigrations,
  type DatabaseConnection,
} from '@repo/db'
import { createRecordingJobs, type RecordingJobs } from '@repo/jobs-testing'
import { createRecordingMailer, type RecordingMailer } from '@repo/mailer-testing'
import {
  ACCOUNT_PURGE_JOB,
  ACCOUNT_PURGE_JOB_FIELD,
  ACCOUNT_PURGE_JOB_LOCALE,
  authModule,
  authRoutePath,
  configureAuth,
  resetAuthService,
  type AuthService,
} from '@repo/module-auth'
import {
  adminModule,
  configureAdmin,
  resetAdminService,
  type AdminService,
} from '@repo/module-admin'
import {
  configureNotifications,
  notificationsModule,
  resetNotificationsService,
} from '@repo/module-notifications'
import {
  configureOrganizations,
  organizationRoutePath,
  organizationsModule,
  resetOrganizationsService,
  type OrganizationsService,
} from '@repo/module-organizations'
import type { EmitJobResult, JobEmission, Jobs, Mailer } from '@repo/ports'
import { sql } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availableModules, enabledModules } from '../config/features'
import { appLocales, defaultLocale } from '../config/i18n'
import { databaseUrl, isDatabaseReachable } from './fixtures/database'
import { createPlatformRoleLock } from './fixtures/platform-role-lock'
import { dispatchAllowingRateLimit } from './fixtures/rate-limit'

/**
 * **La suppression de compte** (s34) — l'orchestration que `purgeModules`
 * attendait.
 *
 * Ce fichier ne rejoue pas ce qui est prouvé ailleurs : l'ordre d'appel des
 * purges vit dans `tests/module-registry.test.ts`, la purge du stockage dans
 * `tests/storage.test.ts`, celle des notifications dans
 * `tests/notifications.test.ts`. Ce qui se mesure ici est ce qu'aucune d'elles
 * ne pouvait mesurer :
 *
 * 1. **la confirmation**, comparée par le serveur — jamais par l'appelant ;
 * 2. **le rejeu** : une suppression interrompue puis relancée aboutit, et
 *    l'effet reste unique (`docs/reliability.md` §1, joué deux fois) ;
 * 3. **le balayage** : après l'effacement, plus aucune ligne conservée ne porte
 *    l'identifiant ni l'adresse du compte — dérivé du contrat des modules
 *    activés, et il ne nomme aucun module ;
 * 4. **l'anonymisation**, éprouvée sur un module de test qui la déclare, parce
 *    que la configuration livrée n'en a **aucune** — et ce zéro est asserté ;
 * 5. **les sessions**, mesurées sur une requête réellement servie et sur une
 *    reconnexion refusée, jamais sur la valeur de retour d'une révocation ;
 * 6. **le repli synchrone** : la suppression aboutit avec ou sans le module de
 *    tâches de fond.
 */

const databaseReachable = await isDatabaseReachable()

/**
 * **L'exclusivité sur `admin_platform_role`** (s37b1) : ce fichier promeut des
 * superadmins pendant que `tests/admin.test.ts` exige une table vide. Le détail,
 * et la mesure qui l'a rendue nécessaire, sont dans le fixture.
 */
const platformRoleLock = createPlatformRoleLock()

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_URL = 'http://localhost:3000'
const TEST_SECRET = 'secret-de-test-uniquement-0123456789abcdef'
const PASSWORD = 'mot-de-passe-de-test-1'

/**
 * **Le satisfaisant que la configuration livrée n'a pas** (critère 4).
 *
 * Sur les catégories de rétention déclarées par les modules **activés**, aucune
 * ne vaut `anonymize` — le cas « la configuration livrée n'en a aucune » est
 * asserté plus bas, et c'est la moitié qui empêche ce fichier de balayer le
 * vide en se croyant vert. L'autre moitié est ici : un module qui en déclare
 * une, dont la purge **rompt le lien** au lieu d'effacer la ligne.
 *
 * Il porte aussi la panne du critère 2 : `failNextPurge` fait lever sa purge
 * une fois. Il requiert `auth`, donc l'ordre inverse du graphe (ADR 029) le
 * purge **avant** lui — la ligne du compte survit à l'interruption, et c'est
 * exactement ce qui rend l'opération rejouable.
 */
interface FixtureNote {
  ownerId: string | null
  readonly body: string
  /** L'adresse au moment de l'écriture : ce que l'anonymisation doit faire disparaître. */
  authorEmail: string | null
}

const fixtureNotes: FixtureNote[] = []
let failNextPurge = false
/** Combien de fois la purge de la fixture a été **appelée**. Un module coupé : zéro. */
let fixturePurgeCalls = 0

const fixtureModule = defineModule({
  id: 'deletion-fixture',
  requires: ['auth'],
  schema: {},
  migrations: null,
  routes: [],
  navigation: [],
  publicUrls: () => [],
  messages: { fr: {}, en: {} },
  emails: [],
  webhooks: [],
  jobs: [],
  dataCategories: ['fixture-note'],
  // **La seule catégorie `anonymize` que ce dépôt exécute.** Elle est ici, dans
  // une fixture, et non forcée dans un module livré : inventer un satisfaisant
  // dans le produit pour verdir un test serait une donnée conservée que
  // personne n'a demandée.
  retention: { 'fixture-note': 'anonymize' },
  purge: (scope: ModuleScope) => {
    fixturePurgeCalls += 1

    if (failNextPurge) {
      failNextPurge = false

      return Promise.reject(new Error('le tiers de la fixture ne répond pas'))
    }

    if (scope.kind !== 'user') {
      return Promise.resolve()
    }

    for (const note of fixtureNotes) {
      if (note.ownerId === scope.userId) {
        // `anonymize` : la ligne reste, le lien est rompu, **et rien
        // d'identifiant ne subsiste** — l'adresse part avec le rattachement.
        note.ownerId = null
        note.authorEmail = null
      }
    }

    return Promise.resolve()
  },
  export: () => Promise.resolve({}),
})

/**
 * Le registre de la suite, **construit par le test**.
 *
 * Quatre modules réels — `auth`, `organizations`, `notifications` — plus la
 * fixture. Les assertions portent donc sur l'orchestration, pas sur l'état dans
 * lequel `config/features.ts` se trouve.
 */
const registry = buildRegistry({
  available: [adminModule, authModule, notificationsModule, organizationsModule, fixtureModule],
  enabled: ['admin', 'auth', 'notifications', 'organizations', 'deletion-fixture'],
  locales: [...appLocales],
})

/**
 * **La configuration où tout ce qui est optionnel est coupé.**
 *
 * `pnpm test:minimal-profile` coupe `organizations`, `notifications` et `jobs`,
 * et rejoue cette suite — mais la suite construit **son** registre, si bien que
 * la recette n'y éprouvait pas la suppression dans la configuration qu'elle
 * coupe. Ce second registre est ce qui ferme l'écart : la suppression est
 * mesurée dans les deux configurations, ici, sans dépendre de la recette.
 */
const socleOnly = buildRegistry({
  available: [adminModule, authModule, notificationsModule, organizationsModule, fixtureModule],
  enabled: ['auth'],
  locales: [...appLocales],
})

/** Le registre que la purge du service parcourt. Bascule par cas. */
let purgeRegistry = registry

let connection: DatabaseConnection
let mailer: RecordingMailer
let auth: AuthService
let recordingJobs: RecordingJobs
let organizationsService: OrganizationsService
let adminService: AdminService

/**
 * **Les deux régimes de tâches, injectés** — c'est le critère 9, et les deux
 * sont livrables.
 *
 * `synchronous` est ce que `lib/jobs.ts` monte quand le module `jobs` est
 * **coupé** : une tentative, aucune reprise, l'exécution dans la requête
 * appelante. `recording` est la doublure de s33 (`createRecordingJobs`), qui
 * enregistre sans exécuter : c'est le régime d'un ordonnanceur réel, où la
 * requête rend la main avant que quoi que ce soit ne soit effacé.
 */
let jobsRegime: 'synchronous' | 'recording' = 'synchronous'

/**
 * **L'état du compte au moment où la confirmation part** (critère 8).
 *
 * Le patron de `authPurgedWhenFilesRemained` (s18) : l'ordre de deux effets ne
 * s'observe pas depuis l'extérieur, il s'observe **pendant**. `null` tant
 * qu'aucune confirmation n'est partie.
 */
let accountExistedWhenConfirmed: boolean | null = null

/**
 * **L'annulation d'abonnement, telle que le module d'organisations la voit.**
 *
 * Le module ne connaît pas la facturation : il reçoit une fonction, comme il
 * reçoit déjà `seatSync` (s23). La doublure enregistre ce qu'on lui a demandé
 * et sait échouer — c'est ce qui rend « un échec du fournisseur interrompt la
 * suppression » mesurable. L'appel réel au fournisseur, lui, est éprouvé dans
 * `tests/billing.test.ts`, là où il vit.
 */
const cancelledScopes: string[] = []
let cancellationFails = false

const synchronousJobs: Jobs = {
  emit: async (emission: JobEmission): Promise<EmitJobResult> => {
    const outcome = await dispatchModuleJob({
      registry,
      emission,
      log: () => {},
      retry: { maxAttempts: 1, baseMs: 0, maxMs: 0 },
      now: () => new Date(),
    })

    return outcome.ok
      ? { ok: true, id: `${emission.job}:${emission.key}` }
      : { ok: false, error: outcome.error }
  },
}

/** Les envois différés, retenus pour être attendus (le patron de `tests/auth.test.ts`). */
const backgroundTasks: Promise<unknown>[] = []

const settled = async (): Promise<void> => {
  await Promise.all(backgroundTasks.splice(0))
}

/**
 * **Les migrations des modules que ce fichier n'est pas seul à monter.**
 *
 * Quatre suites écrivent dans la même base et migrent des modules qui se
 * recouvrent — `tests/organizations.test.ts` monte `auth` et `organizations`,
 * `tests/notifications.test.ts` monte `notifications`, celle-ci monte les
 * quatre. Sur une base **déjà migrée**, personne ne crée rien ; sur une base
 * **créée pour l'exécution** — ce que fait `pnpm test:minimal-profile`, où les
 * modules coupés ne sont pas migrés par la recette —, deux workers émettaient le
 * même `create table` et le perdant échouait sur le catalogue.
 *
 * Le rejeu qui fait converger cela vit dans `runMigrations` (`@repo/db`), pas
 * ici : rejouer d'un seul côté déplaçait simplement l'échec sur l'autre suite —
 * mesuré.
 */
beforeAll(async () => {
  if (!databaseReachable) {
    return
  }

  await platformRoleLock.open()

  connection = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 5 })

  await runModuleMigrations({
    db: connection.db,
    plan: planModuleMigrations({
      modules: [adminModule, authModule, notificationsModule, organizationsModule],
      repoRoot: REPO_ROOT,
    }),
  })

  const tables = await connection.db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public'`,
  )

  existingTables = new Set(tables.rows.map((row) => row.table_name))

  mailer = createRecordingMailer()
  recordingJobs = createRecordingJobs({ registry })

  const observingMailer: Mailer = {
    send: async (input) => {
      if (input.template === 'auth.account-deleted') {
        const rows = await connection.db.execute<{ rows: number }>(
          sql`select count(*)::int as rows from auth_user where email = ${input.to}`,
        )

        accountExistedWhenConfirmed = (rows.rows[0]?.rows ?? 0) > 0
      }

      return await mailer.send(input)
    },
  }

  configureNotifications({
    db: connection.db,
    types: [],
    scopeOf: (userId) => Promise.resolve({ userId, organizationIds: [] }),
    displayNamesOf: () => Promise.resolve(new Map()),
  })

  adminService = configureAdmin({
    db: connection.db,
    // s37b2 : le back-office des organisations n'est pas ce que cette suite
    // traverse. Les trois lectures rendent des listes vides.
    organizations: {
      listOrganizations: () =>
        Promise.resolve({ ok: true as const, organizations: [], total: 0 }),
      describeOrganization: () => Promise.resolve({ ok: true as const, detail: null }),
      membershipsOf: () => Promise.resolve({ ok: true as const, memberships: [] }),
    },
    // Aucune désignation automatique : cette suite promeut explicitement, et
    // une désignation par adresse rendrait le cas dépendant de l'ordre.
    designatedEmail: null,
    accounts: {
      findIdByEmail: () => Promise.resolve({ ok: true, userId: null }),
      ban: () => Promise.resolve({ ok: false, error: 'not_found' as const }),
      unban: () => Promise.resolve({ ok: false, error: 'not_found' as const }),
      // Ce qui traverse cette suite est la purge, pas le décompte : aucun
      // compte n'y est fermé, et aucun emprunt n'y est ouvert.
      signInBlockedAmong: () => Promise.resolve({ ok: true as const, blocked: [] }),
      startImpersonation: () =>
        Promise.resolve({ ok: false as const, error: 'unknown_account' as const }),
      stopImpersonation: () =>
        Promise.resolve({ ok: false as const, error: 'not_impersonating' as const }),
      borrowerOf: () => Promise.resolve({ ok: true as const, impersonatedBy: null }),
      // s37b2 : le back-office n'est pas ce que cette suite traverse. Les
      // lectures refusent **fermé**, ce qui rendrait une liste en alerte plutôt
      // qu'en état vide si un cas y passait — aucun n'y passe.
      listAccounts: () => Promise.resolve({ ok: false as const }),
      describeAccount: () => Promise.resolve({ ok: false as const }),
      revokeSession: () => Promise.resolve({ ok: false as const }),
      sendPasswordReset: () => Promise.resolve({ ok: false as const }),
      endBorrowsBy: () => Promise.resolve({ ok: true as const, ended: [] }),
      sweepExpiredImpersonations: () => Promise.resolve({ ok: true as const, ended: [] }),
    },
    securityLog: () => {},
  })

  organizationsService = configureOrganizations({
    db: connection.db,
    reservedSlugs: new Set<string>(),
    mailer,
    appUrl: APP_URL,
    emailLocale: 'fr',
    seatSync: () => Promise.resolve({ ok: true }),
    // Ce fichier ne mesure pas les notifications émises par les organisations :
    // elles ont leur suite. La forme est respectée, l'émission est neutre.
    notify: () => Promise.resolve({ ok: true }),
    purgeScope: async (scope) => await purgeModules(registry, scope),
    cancelBilling: async (organizationId) => {
      cancelledScopes.push(organizationId)

      return cancellationFails ? { ok: false } : { ok: true }
    },
  })

  auth = configureAuth({
    db: connection.db,
    mailer: observingMailer,
    secret: TEST_SECRET,
    appUrl: APP_URL,
    runInBackground: (task) => backgroundTasks.push(task),
    // Les locales servies et **comment** lire la langue d'une requête : le
    // module ne connaît ni `config/i18n.ts`, ni le nom d'un cookie. Sans cette
    // injection, toute langue connue vaudrait celle du site et le cas de la
    // confirmation en anglais ne mesurerait rien.
    locales: [...appLocales],
    defaultLocale,
    readRequestLocale: (request) =>
      (request.headers.get('accept-language') ?? '').startsWith('en') ? 'en' : null,
    // **Ce que le module ne peut pas se procurer** : l'effacement de *tous* les
    // modules activés. `auth` ne connaît pas le registre — il reçoit la
    // fonction, comme il reçoit son mailer.
    purgeScope: async (scope) => await purgeModules(purgeRegistry, scope),
    // Le module `auth` ne connaît pas les organisations : il reçoit la
    // question, comme le point de composition la lui donne.
    soleOwnerships: async (userId) =>
      await organizationsService.useCases.soleOwnerships(userId),
    releaseOrganizations: async (userId) =>
      await organizationsService.useCases.releaseMemberships(userId),
    jobs: {
      emit: async (emission) =>
        jobsRegime === 'recording'
          ? await recordingJobs.jobs.emit(emission)
          : await synchronousJobs.emit(emission),
    },
  })
})

afterEach(async () => {
  if (databaseReachable) {
    await platformRoleLock.release()
  }
})

afterAll(async () => {
  resetAuthService()
  resetAdminService()
  resetNotificationsService()
  resetOrganizationsService()

  if (databaseReachable) {
    await connection.db.execute(sql`delete from auth_user where email like 's34-%'`)
    await connection.close()
    await platformRoleLock.close()
  }
})

beforeEach(async () => {
  // **L'exclusivité sur `admin_platform_role`** : ce fichier y promeut des
  // comptes, `tests/admin.test.ts` a besoin qu'elle soit vide, et Vitest les
  // exécute en parallèle sur la même base
  // (`fixtures/platform-role-lock.ts`).
  if (databaseReachable) {
    await platformRoleLock.acquire()
  }

  mailer.reset()
  recordingJobs.reset()
  fixtureNotes.length = 0
  failNextPurge = false
  jobsRegime = 'synchronous'
  purgeRegistry = registry
  fixturePurgeCalls = 0
  accountExistedWhenConfirmed = null
  cancelledScopes.length = 0
  cancellationFails = false
})

/** Un compte réel, créé par la route d'inscription : la suite ne fabrique rien à la main. */
const anAccount = async (
  address?: string,
): Promise<{
  readonly session: ModuleSession
  readonly email: string
}> => {
  const email = address ?? `s34-${randomUUID()}@example.test`
  const response = await callAuth('signUp', { email, password: PASSWORD, name: 'Compte s34' })

  expect(response.status).toBe(200)

  const identified = await auth.useCases.identifyAccount(email)

  return { session: { userId: identified?.userId ?? '', roles: [] }, email }
}

type AuthPath = Parameters<typeof authRoutePath>[0]

/** Une requête d'authentification, servie par le répartiteur comme en production. */
const callAuth = async (
  path: AuthPath,
  body: Record<string, unknown>,
  session: ModuleSession | null = null,
  headers: Record<string, string> = {},
): Promise<Response> =>
  await dispatchAllowingRateLimit(
    registry,
    new Request(`${APP_URL}${authRoutePath(path)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    { resolveSession: () => Promise.resolve(session) },
  )

/**
 * Les confirmations de suppression parties pendant ce cas, **quel que soit le
 * destinataire**.
 *
 * Le destinataire est asserté à part. Compter par adresse cachait le défaut que
 * ce cas existe pour trouver : une seconde exécution qui ne retrouve plus le
 * compte peut envoyer un email **ailleurs** — mesuré, la première rédaction de
 * ce cas restait verte quand on retirait le garde du rejeu.
 */
const deletionEmails = (): readonly { readonly to: string; readonly locale: string }[] =>
  mailer.sent.filter((sent) => sent.template === 'auth.account-deleted')

/** Les avis d'une suppression **qui n'a pas abouti**, et pourquoi (critique R2). */
const blockedEmails = (): readonly { readonly to: string; readonly locale: string }[] =>
  mailer.sent.filter((sent) => sent.template === 'auth.account-deletion-blocked')

/** Une requête du module d'organisations, servie par le même répartiteur. */
const callOrganizations = async (
  path: Parameters<typeof organizationRoutePath>[0],
  body: Record<string, unknown>,
  session: ModuleSession,
): Promise<Response> =>
  await dispatchAllowingRateLimit(
    registry,
    new Request(`${APP_URL}${organizationRoutePath(path)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { resolveSession: () => Promise.resolve(session) },
  )

/**
 * Une requête authentifiée **servie par le vrai résolveur de session**.
 *
 * `changeName` est choisie parce qu'elle est authentifiée et sans effet
 * observable ici : ce qui est mesuré est le code de retour du répartiteur, pas
 * le renommage.
 */
const servedWithCookie = async (cookie: string): Promise<Response> =>
  await dispatchAllowingRateLimit(
    registry,
    new Request(`${APP_URL}${authRoutePath('changeName')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Nom servi' }),
    }),
    { resolveSession: async (request) => await auth.resolveSession(request) },
  )

/**
 * Ajoute un membre à une organisation, avec son rôle, **par un `insert`
 * direct**.
 *
 * Dit plutôt que sous-entendu : ce raccourci contourne l'invitation, son
 * acceptation et la distribution des rôles. Il est acceptable **ici** parce
 * qu'aucun cas de ce fichier ne mesure ces chemins — ils ont leur suite
 * (`tests/organizations.test.ts`, qui pose le même raccourci et le dit) — et
 * parce que ce qui est mesuré ensuite est l'effacement, qui part de la ligne
 * quel que soit le geste qui l'a écrite.
 */
const joinAs = async (
  organizationId: string,
  peer: { readonly session: ModuleSession; readonly email: string },
  role: 'owner' | 'admin' | 'member',
): Promise<void> => {
  await connection.db.execute(
    sql`insert into organization_member (id, organization_id, user_id, role, created_at)
        values (${`mbr_${randomUUID()}`}, ${organizationId}, ${peer.session.userId}, ${role}, now())`,
  )
}

/** Une note de la fixture, écrite pour ce compte. */
const aFixtureNote = (userId: string, email: string): void => {
  fixtureNotes.push({ ownerId: userId, body: 'note de fixture', authorEmail: email })
}

describe.runIf(databaseReachable)('la suppression rejouée', () => {
  it('interrompue par un module en panne, relancée, aboutit sans double effet', async () => {
    const { session, email } = await anAccount()

    aFixtureNote(session.userId, email)

    failNextPurge = true

    // **Premier passage : il échoue.** Le module fautif est nommé, et rien de
    // ce qui vient après lui dans l'ordre inverse n'a été touché.
    await expect(auth.useCases.runAccountPurge({ userId: session.userId })).rejects.toThrow(
      /deletion-fixture/,
    )
    await settled()

    // Le compte est toujours là : `auth` est purgé **en dernier** (ADR 029),
    // donc une interruption laisse de quoi rejouer.
    expect(await auth.useCases.viewAccount(session.userId)).not.toBeNull()
    // Et aucun email de confirmation n'est parti : il n'y a rien à confirmer.
    expect(deletionEmails()).toHaveLength(0)

    // **Second passage : il aboutit.**
    await auth.useCases.runAccountPurge({ userId: session.userId })
    await settled()

    expect(await auth.useCases.viewAccount(session.userId)).toBeNull()

    const afterFirst = deletionEmails().length

    // Et elle est bien partie **à l'adresse retenue avant l'effacement**.
    expect(deletionEmails().map((sent) => sent.to)).toEqual([email])

    // **Troisième passage : rien de plus.** C'est l'idempotence jouée, pas
    // affirmée — un compte déjà parti n'a ni purge ni email à recevoir.
    await auth.useCases.runAccountPurge({ userId: session.userId })
    await settled()

    expect(deletionEmails()).toHaveLength(afterFirst)
    expect(afterFirst).toBe(1)
  })
})

describe.runIf(databaseReachable)('la confirmation', () => {
  it('refuse un corps sans confirmation, et n’efface rien', async () => {
    const { session } = await anAccount()

    const response = await callAuth('deleteAccount', {}, session)

    expect(response.status).toBe(400)
    // Le refus n'atteint pas la purge : le compte est intact.
    expect(await auth.useCases.viewAccount(session.userId)).not.toBeNull()
    expect(deletionEmails()).toHaveLength(0)
  })

  it('refuse une saisie qui ne correspond pas, et n’efface rien', async () => {
    const { session } = await anAccount()

    const response = await callAuth(
      'deleteAccount',
      { confirmation: 'oui, supprimez' },
      session,
    )

    expect(response.status).toBe(400)
    expect(await auth.useCases.viewAccount(session.userId)).not.toBeNull()
    expect(deletionEmails()).toHaveLength(0)
  })

  /**
   * **La comparaison est faite par le serveur, pas par l'appelant** (critère 1,
   * `docs/security.md` §3).
   *
   * Le cas forge exactement ce qu'un écran qui déciderait à la place du serveur
   * laisserait passer : l'appelant a une session valide, il envoie une saisie
   * qui « ressemble » — l'adresse d'un **autre** compte, qui existe bel et
   * bien — et il l'envoie sans passer par aucun écran. Un serveur qui se
   * contenterait de recevoir l'ordre effacerait.
   */
  it('refuse l’adresse d’un autre compte, pourtant réelle', async () => {
    const { session } = await anAccount()
    const other = await anAccount()

    const response = await callAuth(
      'deleteAccount',
      { confirmation: other.email },
      session,
    )

    expect(response.status).toBe(400)
    expect(await auth.useCases.viewAccount(session.userId)).not.toBeNull()
    // Et surtout : l'autre compte n'a rien vu passer.
    expect(await auth.useCases.viewAccount(other.session.userId)).not.toBeNull()
  })

  it('accepte l’adresse du compte, à la casse et aux espaces près', async () => {
    const { session, email } = await anAccount()

    const response = await callAuth(
      'deleteAccount',
      { confirmation: `  ${email.toLocaleUpperCase()}  ` },
      session,
    )

    expect(response.status).toBe(202)
    await settled()
    expect(await auth.useCases.viewAccount(session.userId)).toBeNull()
  })

  /**
   * **Ce que Zod tient, et que la comparaison ne tiendrait pas** (`docs/security.md`
   * §4). Une confirmation qui n'est pas une chaîne n'atteint pas la règle : sans
   * la validation à la frontière, la comparaison reçoit l'objet tel quel.
   */
  it('refuse une confirmation qui n’est pas une chaîne, **avant** la comparaison', async () => {
    const { session, email } = await anAccount()

    const malformed = await callAuth(
      'deleteAccount',
      { confirmation: { toString: 1 } },
      session,
    )

    expect(malformed.status).toBe(400)
    // **Le motif distingue la frontière de la règle** : celui-ci vient de Zod,
    // qui a refusé la forme ; sans lui, la comparaison recevrait l'objet tel
    // quel. C'est ce qui rend la validation observable de l'extérieur, donc
    // mesurable (constat F6 de la revue).
    await expect(malformed.json()).resolves.toMatchObject({ reason: 'confirmation_absente' })

    // Et le motif de l'autre refus est **différent** : la règle a comparé.
    const mismatched = await callAuth('deleteAccount', { confirmation: `x${email}` }, session)

    expect(mismatched.status).toBe(400)
    await expect(mismatched.json()).resolves.toMatchObject({
      reason: 'confirmation_differente',
    })

    expect(await auth.useCases.viewAccount(session.userId)).not.toBeNull()
  })

  it('refuse sans session : le répartiteur n’atteint jamais la règle', async () => {
    const response = await callAuth('deleteAccount', { confirmation: 'peu importe' }, null)

    expect(response.status).toBe(401)
  })
})

/**
 * **Ce que le balayage regarde**, dérivé du contrat et de rien d'autre.
 *
 * Les tables viennent de la clé `schema` des modules **activés** par
 * `config/features.ts` : ce fichier ne nomme aucun module, et un module ajouté
 * demain est balayé sans que personne y pense. Toutes les colonnes sont
 * comparées en texte, y compris les charges utiles JSON — c'est exactement là
 * que la revue de s32 a trouvé l'adresse d'un tiers, et une comparaison qui
 * n'aurait porté que sur les colonnes « adresse » ne l'aurait pas vue.
 */
const declaredTables = (): readonly { readonly name: string; readonly columns: readonly string[] }[] =>
  availableModules
    .filter((module) => (enabledModules as readonly string[]).includes(module.id))
    .flatMap((module) => Object.values(module.schema))
    .filter((candidate): candidate is PgTable => candidate instanceof PgTable)
    .map((table) => getTableConfig(table))
    .map((config) => ({
      name: config.name,
      columns: config.columns.map((column) => column.name),
    }))

/**
 * Les tables déclarées **qui existent réellement**, lues dans
 * `information_schema` — jamais dans les fichiers de migration.
 *
 * L'intersection est nécessaire et il faut dire pourquoi : cette suite ne migre
 * que les modules dont elle écrit des données, alors que la dérivation porte sur
 * **tous** les modules activés. En intégration continue, `pnpm db:migrate`
 * précède `pnpm test` et l'intersection est totale ; sur un poste dont la base
 * est en retard, elle ne l'est pas — d'où le plancher, qui rougit si le
 * balayage ne regarde rien.
 */
let existingTables: ReadonlySet<string> = new Set()

const sweptTables = (): readonly { readonly name: string; readonly columns: readonly string[] }[] =>
  declaredTables().filter((table) => existingTables.has(table.name))

/**
 * Les tables qui portent encore l'une de ces valeurs, avec le nombre de lignes.
 *
 * Une **sous-chaîne**, pas une égalité : un identifiant ou une adresse cachés
 * dans un JSON ou dans une URL sont exactement le défaut cherché.
 */
const tablesNaming = async (
  values: readonly string[],
): Promise<readonly { readonly table: string; readonly rows: number }[]> => {
  const found: { table: string; rows: number }[] = []

  for (const table of sweptTables()) {
    if (table.columns.length === 0) {
      continue
    }

    const predicate = sql.join(
      table.columns.flatMap((column) =>
        values.map(
          (value) => sql`cast(${sql.identifier(column)} as text) like ${`%${value}%`}`,
        ),
      ),
      sql` or `,
    )

    const counted = await connection.db.execute<{ rows: number }>(
      sql`select count(*)::int as rows from ${sql.identifier(table.name)} where ${predicate}`,
    )
    const rows = counted.rows[0]?.rows ?? 0

    if (rows > 0) {
      found.push({ table: table.name, rows })
    }
  }

  return found
}

describe.runIf(databaseReachable)('après la suppression, plus rien ne nomme le compte', () => {
  /**
   * **Ce que ce balayage couvre, et ce qu'il ne couvre pas** (constat F2 de la
   * revue).
   *
   * Les **tables** sont dérivées du contrat — toutes celles des modules
   * activés, toutes leurs colonnes, comparées en texte. Les **lignes**, non :
   * le balayage ne trouve que ce que ce cas a écrit. Une table qu'aucune
   * écriture ne peuple est balayée vide, et son défaut passe inaperçu — c'est
   * exactement ce que la revue a mesuré en neutralisant l'effacement de
   * l'adresse invitée, qui laissait ce balayage vert.
   *
   * D'où la liste ci-dessous : elle nomme les tables que ce cas **peuple
   * réellement**, et elle est assertée. Une table qui cesse d'être peuplée fait
   * rougir, et une table qui devrait l'être et ne l'est pas se lit ici plutôt
   * que de se supposer.
   *
   * **Le choix des quatre premières n'est pas un hasard** : ce sont celles qui
   * nomment un compte **sans clé étrangère vers lui**, donc celles qu'aucune
   * cascade n'emporte et que seule une purge explicite atteint. Les tables liées
   * par clé étrangère (`auth_session`, `auth_account`, `organization_member`…)
   * partent avec la ligne du compte, et le moteur en est la garantie.
   */
  const POPULATED = [
    // sans clé étrangère vers le compte — la purge doit les atteindre elle-même
    'admin_platform_role', // `granted_by`, constat F1
    'auth_verification', // la valeur **est** l'adresse
    'organization_invitation', // l'adresse invitée, constat F6 de s16
    'notification', // la charge utile qui nomme, revue de s32
    // avec clé étrangère — la cascade les emporte, elles sont là comme témoins
    'auth_user',
    'auth_account',
    'organization_active_selection',
    'organization_member',
  ]

  it('n’en laisse ni l’identifiant ni l’adresse dans aucune table d’un module activé', async () => {
    const { session, email } = await anAccount()
    const host = await anAccount()

    // Une notification **adressée** au compte, dont la charge utile le nomme :
    // c'est la forme exacte que la revue de s32 a trouvée porteuse d'une
    // adresse de tiers, et ce que ce balayage existe pour attraper.
    await connection.db.execute(
      sql`insert into notification (id, recipient_id, type, payload, created_at)
          values (${`ntf_${randomUUID()}`}, ${session.userId}, 'test.s34',
                  ${JSON.stringify({ actorId: session.userId, email })}::jsonb, now())`,
    )

    /**
     * Son organisation à lui : l'appartenance et la sélection active partent
     * avec le compte.
     *
     * **Un copropriétaire l'accompagne**, et ce n'est pas un détail de montage :
     * depuis la critique de la seconde revue, un compte qui serait le **dernier**
     * propriétaire d'une organisation ne peut plus être effacé du tout. Sans ce
     * pair, ce cas mesurerait le refus au lieu du balayage.
     */
    await callOrganizations(
      'create',
      { name: 'Studio s34', slug: `s34-${randomUUID().slice(0, 8)}` },
      session,
    )

    const own =
      (await organizationsService.useCases.viewOrganizations(session.userId)).current?.id ?? ''

    await joinAs(own, host, 'owner')

    /**
     * **Une invitation qui lui est adressée, émise par quelqu'un d'autre.**
     *
     * `organization_invitation.email` nomme une personne sans aucune clé
     * étrangère vers son compte : la cascade ne l'atteint pas, c'est
     * `organizations.purge` qui l'efface en lisant l'adresse (s16, constat F6).
     * Sans cette ligne, le balayage ne regardait cette table que vide — et
     * neutraliser cet effacement le laissait vert.
     */
    const hostOrganization = await anOrganization(host.session, 'Studio hôte')

    await callOrganizations(
      'invite',
      { organizationId: hostOrganization.organizationId, email, role: 'member' },
      host.session,
    )

    // Un rôle qu'il a **accordé** : `granted_by`, sans clé étrangère (F1).
    await adminService.useCases.grantSuperadmin({
      actorId: session.userId,
      userId: host.session.userId,
    })

    aFixtureNote(session.userId, email)

    /**
     * **Le plancher du balayage**, et il est triple.
     *
     * Sans lui, un balayage qui ne regarderait rien — aucune table dérivée,
     * aucune ligne portant le compte, ou une table qui a cessé d'être peuplée —
     * serait vert en ne vérifiant rien. C'est le défaut de balayage vide,
     * trouvé trois fois sur ce dépôt.
     */
    expect(sweptTables().length).toBeGreaterThan(0)

    const before = await tablesNaming([session.userId, email])

    /**
     * **Les tables réellement peuplées sont celles qu'on croit** — une de moins
     * et la couverture a rétréci sans que personne le voie.
     *
     * L'attendu est **intersecté avec ce que le balayage regarde**, et ce n'est
     * pas un assouplissement : `sweptTables()` est dérivé de
     * `config/features.ts`, donc un profil qui coupe un module retire ses
     * tables des deux côtés de l'égalité. Sans l'intersection, ce cas rougissait
     * sous `pnpm test:minimal-profile` — qui coupe `admin`, `notifications` et
     * `organizations` — en reprochant au balayage de ne pas voir des tables
     * qu'aucune configuration ne lui donnait à voir.
     *
     * Le plancher reste, et il est **dérivé** plutôt que chiffré : la liste
     * attendue n'est jamais vide, parce que `auth` est du socle et ne se coupe
     * pas (ADR 021) — ses tables sont donc regardées dans **toutes** les
     * configurations. Un chiffre écrit ici vieillirait avec le profil.
     */
    const expected = POPULATED.filter((table) =>
      sweptTables().some((swept) => swept.name === table),
    )

    expect(expected.length).toBeGreaterThan(0)
    expect(before.map((entry) => entry.table).sort()).toEqual([...expected].sort())

    await auth.useCases.runAccountPurge({ userId: session.userId })
    await settled()

    // **Aucune ligne conservée ne le nomme.** Ni son identifiant, ni son
    // adresse, dans aucune table d'aucun module activé.
    await expect(tablesNaming([session.userId, email])).resolves.toEqual([])
    // Et le balayage regardait toujours quelque chose.
    expect(sweptTables().length).toBeGreaterThan(0)
  })
})

/** Les propriétaires d'une organisation, tels que la table les porte. */
const ownersOf = async (organizationId: string): Promise<number> => {
  const counted = await connection.db.execute<{ rows: number }>(
    sql`select count(*)::int as rows from organization_member
        where organization_id = ${organizationId} and role = 'owner'`,
  )

  return counted.rows[0]?.rows ?? 0
}

/** Exécute la tâche mise en file par la doublure d'enregistrement, dans l'ordre. */
const runQueuedJob = async (index = 0): Promise<{ readonly ok: boolean }> => {
  const emission = recordingJobs.emissions[index]

  expect(emission).toBeDefined()

  const outcome = await dispatchModuleJob({
    registry,
    emission: emission ?? { job: '', key: '', data: {} },
    log: () => {},
    retry: { maxAttempts: 1, baseMs: 0, maxMs: 0 },
    now: () => new Date(),
  })

  await settled()

  return { ok: outcome.ok }
}

/** Les rôles de plateforme qu'un compte a **accordés**, tels que la table les porte. */
const grantsMadeBy = async (userId: string): Promise<number> => {
  const counted = await connection.db.execute<{ rows: number }>(
    sql`select count(*)::int as rows from admin_platform_role where granted_by = ${userId}`,
  )

  return counted.rows[0]?.rows ?? 0
}

/**
 * Les jetons de vérification qui portent **exactement** cette valeur. Aucun
 * jeton n'en sort — la colonne des empreintes n'est jamais lue.
 *
 * L'égalité, jamais un `LIKE` : un `LIKE` ici aurait le défaut même que ces cas
 * mesurent — la première rédaction comptait le jeton du voisin comme celui de
 * la cible, et donnait un rouge pour la mauvaise raison.
 */
const verificationTokensNaming = async (value: string): Promise<number> => {
  const counted = await connection.db.execute<{ rows: number }>(
    sql`select count(*)::int as rows from auth_verification where value = ${value}`,
  )

  return counted.rows[0]?.rows ?? 0
}

describe.runIf(databaseReachable)('l’effacement des jetons qui nomment le compte', () => {
  /**
   * **La purge n'atteint que le compte visé** (constat F4 de la revue).
   *
   * `auth_verification` n'a pas de clé étrangère vers `auth_user`, et la purge
   * y efface sur une table **partagée par tous les comptes**. Le prédicat a
   * d'abord cherché une **sous-chaîne** de la valeur, ce qui débordait de sa
   * cible de deux façons, mesurées l'une après l'autre : les jokers de `LIKE`
   * — `_` est légal dans une adresse —, puis la sous-chaîne elle-même. Il est
   * **ancré** depuis la seconde, et ce cas garde la première porte fermée.
   *
   * Trois documents affirmaient l'échappement ; aucune commande ne rougissait
   * quand il disparaissait. Ce cas est né de là. **Il ne mesure plus
   * l'échappement** depuis que l'adresse est comparée par égalité — c'est
   * « n'efface pas le changement d'email d'un compte dont l'identifiant est
   * voisin » qui le fait —, mais il garde la propriété qui compte pour une
   * adresse : le voisin conserve son jeton.
   */
  it('n’efface pas le jeton d’un voisin dont l’adresse ne diffère que par un joker', async () => {
    const suffix = randomUUID().slice(0, 8)
    // Les deux adresses ne diffèrent **que** par le caractère joker.
    const wildcard = `s34-f4_${suffix}@example.test`
    const neighbour = `s34-f4x${suffix}@example.test`

    const target = await anAccount(wildcard)

    await anAccount(neighbour)

    // Le plancher : les deux comptes ont bien un jeton de vérification en
    // attente. Sans lui, l'assertion d'après serait vraie sur une table vide.
    expect(await verificationTokensNaming(wildcard)).toBeGreaterThan(0)
    expect(await verificationTokensNaming(neighbour)).toBeGreaterThan(0)

    await auth.useCases.runAccountPurge({ userId: target.session.userId })
    await settled()

    // Le compte visé n'a plus de jeton…
    expect(await verificationTokensNaming(wildcard)).toBe(0)
    // …et **le voisin a gardé le sien**. C'est tout le cas.
    expect(await verificationTokensNaming(neighbour)).toBeGreaterThan(0)
  })

  /**
   * **Le second voisin : celui dont l'adresse en contient une autre.**
   *
   * L'échappement des jokers ne suffisait pas, et la seconde revue l'a mesuré :
   * le prédicat cherchait `%<adresse>%`, donc `a@b.co` emportait les jetons de
   * `a@b.com`. Deux adresses ordinaires et distinctes.
   *
   * Les valeurs à atteindre sont **connues et fermées** — l'adresse exacte, ou
   * « identifiant espace adresse » pour un changement d'email en attente —,
   * donc le prédicat n'a besoin d'aucun joker : il est ancré.
   */
  it('n’efface pas le jeton d’un voisin dont l’adresse contient celle de la cible', async () => {
    const suffix = randomUUID().slice(0, 8)
    const address = `s34-pfx${suffix}@example.test`
    // Une adresse **distincte**, qui contient la première comme préfixe.
    const longer = `s34-pfx${suffix}@example.test.io`

    const target = await anAccount(address)

    await anAccount(longer)

    expect(await verificationTokensNaming(address)).toBeGreaterThan(0)
    expect(await verificationTokensNaming(longer)).toBeGreaterThan(0)

    await auth.useCases.runAccountPurge({ userId: target.session.userId })
    await settled()

    expect(await verificationTokensNaming(address)).toBe(0)
    expect(await verificationTokensNaming(longer)).toBeGreaterThan(0)
  })

  /**
   * **L'échappement des jokers, sur le seul motif qui en reste** (constat F2 de
   * la troisième revue).
   *
   * Le prédicat ancré compare l'adresse par égalité — plus aucun joker n'y
   * mord —, si bien que le cas du voisin en `_` passait désormais sur
   * l'égalité seule et ne mesurait plus l'échappement qu'il documentait.
   * `escapeLikePattern` ne garde donc qu'un motif : `<identifiant> %`, celui
   * des changements d'email en attente. Ce cas est le seul qui le fasse
   * mordre, et il exige un identifiant de compte portant un joker — que la
   * bibliothèque ne produit pas, d'où les lignes posées à la main.
   */
  it('n’efface pas le changement d’email d’un compte dont l’identifiant est voisin', async () => {
    const suffix = randomUUID().slice(0, 8)
    const target = `usr_s34_j_${suffix}`
    // Un identifiant **distinct**, qui ne diffère que par le caractère joker.
    const neighbour = `usr_s34_jx${suffix}`
    const targetEmail = `s34-joker-${suffix}@example.test`
    const neighbourEmail = `s34-jokerx-${suffix}@example.test`

    for (const [id, address] of [
      [target, targetEmail],
      [neighbour, neighbourEmail],
    ] as const) {
      await connection.db.execute(
        sql`insert into auth_user (id, name, email, email_verified, created_at, updated_at)
            values (${id}, 'Compte joker', ${address}, true, now(), now())`,
      )
      // La forme exacte d'un changement d'email en attente : « identifiant
      // espace adresse visée ».
      await connection.db.execute(
        sql`insert into auth_verification (id, identifier, value, expires_at)
            values (${`vrf_${randomUUID()}`}, ${`email-change:${id}`},
                    ${`${id} cible-${address}`}, now() + interval '1 hour')`,
      )
    }

    expect(await verificationTokensNaming(`${target} cible-${targetEmail}`)).toBe(1)
    expect(await verificationTokensNaming(`${neighbour} cible-${neighbourEmail}`)).toBe(1)

    await authModule.purge({ kind: 'user', userId: target })

    expect(await verificationTokensNaming(`${target} cible-${targetEmail}`)).toBe(0)
    // **Le voisin garde le sien.** Sans échappement, `usr_s34_j_… %` attrape
    // `usr_s34_jx… …`.
    expect(await verificationTokensNaming(`${neighbour} cible-${neighbourEmail}`)).toBe(1)
  })

  /**
   * **Ce que le prédicat ancré doit encore atteindre** : le jeton d'un
   * changement d'email en attente, dont la valeur est « identifiant espace
   * adresse visée ». Sans ce cas, ancrer le prédicat sur la seule égalité
   * passerait, et laisserait derrière lui l'adresse **vers laquelle** le compte
   * effacé voulait migrer.
   */
  it('efface le jeton d’un changement d’email en attente, qui porte deux valeurs', async () => {
    const target = await anAccount()
    const wanted = `s34-migre-${randomUUID().slice(0, 8)}@example.test`

    await auth.useCases.requestEmailChange({ userId: target.session.userId, newEmail: wanted })
    await settled()

    expect(await verificationTokensNaming(`${target.session.userId} ${wanted}`)).toBeGreaterThan(0)

    await auth.useCases.runAccountPurge({ userId: target.session.userId })
    await settled()

    expect(await verificationTokensNaming(`${target.session.userId} ${wanted}`)).toBe(0)
  })
})

describe.runIf(databaseReachable)('la politique de rétention déclarée', () => {
  /**
   * **Chaque catégorie `anonymize` de la configuration livrée est éprouvée sur
   * son vrai module** (critère 4).
   *
   * L'histoire de ce cas est la raison pour laquelle il est écrit ainsi. À
   * l'écriture de la story, **aucun** module activé ne déclarait `anonymize` :
   * un test qui aurait balayé « les catégories `anonymize` des modules
   * activés » aurait été vert en ne vérifiant rien, et le critère exigeait donc
   * que le mécanisme soit éprouvé quand même — ce que fait le cas suivant, sur
   * une fixture. Le cas de l'époque figeait ce zéro pour qu'il rougisse le jour
   * où un module livré en déclarerait une.
   *
   * **Il a rougi**, et le constat F1 de la revue a nommé pourquoi :
   * `admin_platform_role.granted_by` porte l'identifiant du compte qui a promu,
   * sans clé étrangère vers lui, sur la ligne de quelqu'un d'autre. C'est une
   * catégorie `anonymize` — la ligne reste, le lien part — et la purge d'`admin`
   * l'applique désormais.
   *
   * La liste est donc **écrite en face de la dérivation**, comme la matrice des
   * permissions du module `organizations` : une catégorie `anonymize` de plus
   * fait rougir ce cas, et force à écrire celui qui l'éprouve — au lieu
   * d'hériter du silence.
   */
  it('n’en déclare aucune en « anonymize » qui ne soit éprouvée sur son module', () => {
    /**
     * Les couples que **ce fichier exécute réellement**, et l'endroit où il le
     * fait. Ce n'est pas une copie de la configuration : c'est la liste de ce
     * qui est mesuré.
     */
    const exercised = [
      // « ne survit sur aucun rôle accordé après l'effacement du promoteur »
      'admin.grant-authorship',
      // **Filtré sur la configuration** : un profil qui coupe le module retire
      // sa catégorie des deux côtés de l'égalité (`pnpm test:minimal-profile`
      // coupe `admin`). Sans ce filtre, ce cas reprochait à la configuration de
      // ne pas déclarer ce qu'elle n'active pas.
    ].filter((entry) =>
      (enabledModules as readonly string[]).includes(entry.slice(0, entry.indexOf('.'))),
    )

    const declared = availableModules
      .filter((module) => (enabledModules as readonly string[]).includes(module.id))
      .flatMap((module) =>
        Object.entries(module.retention).map(([category, action]) => ({
          module: module.id,
          category,
          action,
        })),
      )

    // Le plancher : une configuration qui ne déclarerait aucune catégorie
    // rendrait l'assertion suivante vraie sans rien dire.
    expect(declared.length).toBeGreaterThan(0)
    expect(
      declared
        .filter((entry) => entry.action === 'anonymize')
        .map((entry) => `${entry.module}.${entry.category}`)
        .sort(),
    ).toEqual([...exercised].sort())
  })

  /**
   * **Le mécanisme, éprouvé sur un module de test** — celui qui reste quand la
   * configuration livrée n'en déclare aucune, et celui qui vaut pour un module
   * qu'un projet ajouterait demain.
   *
   * Ce que « anonymiser » veut dire, et que ce cas mesure : la ligne survit, le
   * lien vers le compte est rompu, **et aucune donnée identifiante ne
   * subsiste**. La seconde moitié est celle qu'on oublie — une ligne détachée
   * qui garde l'adresse n'est pas anonyme, elle est seulement orpheline.
   */
  it('rompt le lien d’une catégorie « anonymize » sans laisser de donnée identifiante', async () => {
    const { session, email } = await anAccount()

    aFixtureNote(session.userId, email)

    expect(fixtureModule.retention['fixture-note']).toBe('anonymize')

    await auth.useCases.runAccountPurge({ userId: session.userId })
    await settled()

    // La ligne est **conservée** : c'est ce qui distingue `anonymize` d'`erase`.
    expect(fixtureNotes).toHaveLength(1)
    // Le lien est rompu…
    expect(fixtureNotes[0]?.ownerId).toBeNull()
    // …et rien de ce qui reste ne nomme la personne.
    expect(JSON.stringify(fixtureNotes)).not.toContain(session.userId)
    expect(JSON.stringify(fixtureNotes)).not.toContain(email)
  })
})

describe.runIf(databaseReachable)('les sessions, après la suppression', () => {
  /**
   * **La révocation est mesurée sur une requête réellement servie**, jamais sur
   * la valeur de retour d'un appel de révocation — la forme posée par s37a.
   *
   * Le répartiteur reçoit ici le **vrai** résolveur de session, celui du
   * service : la session est donc lue dans le cookie, comme en production, et
   * non injectée par le test. Sans cela, le cas mesurerait le double.
   *
   * **Ce qui tient réellement cet invariant, mesuré et non supposé** : la
   * cascade de `auth_session` vers `auth_user`, déclenchée par l'effacement du
   * compte. `purgeAccount` appelle aussi `sessions.revokeAllForUser`, et
   * neutraliser cet appel laisse ce cas **vert** — la révocation explicite est
   * une ceinture, pas la bretelle. Neutraliser l'effacement du compte, lui,
   * fait rougir quatre cas de ce fichier.
   */
  it('révoque la session servie et rend la reconnexion impossible', async () => {
    const email = `s34-${randomUUID()}@example.test`

    expect((await callAuth('signUp', { email, password: PASSWORD, name: 'Compte s34' })).status).toBe(200)
    await connection.db.execute(
      sql`update auth_user set email_verified = true where email = ${email}`,
    )

    const signedIn = await callAuth('signIn', { email, password: PASSWORD })

    expect(signedIn.status).toBe(200)

    const cookie = signedIn.headers.get('set-cookie') ?? ''

    expect(cookie).not.toBe('')

    // **Avant** : la session ouverte est servie. Sans cette moitié, l'assertion
    // d'après pourrait passer sur un cookie qui n'a jamais rien ouvert.
    expect((await servedWithCookie(cookie)).status).toBe(200)

    const userId = (await auth.useCases.identifyAccount(email))?.userId ?? ''

    await auth.useCases.runAccountPurge({ userId })
    await settled()

    // **Après** : la même requête, le même cookie, refusée par le serveur.
    expect((await servedWithCookie(cookie)).status).toBe(401)
    // Et la reconnexion est impossible : le compte n'existe plus.
    expect((await callAuth('signIn', { email, password: PASSWORD })).status).toBe(401)
  }, 60_000)
})

describe.runIf(databaseReachable)('la confirmation de suppression', () => {
  /**
   * **Le moment de l'envoi est une décision, et elle est mesurée ici.**
   *
   * Le critère ne tranche pas. Les deux formes ont un coût réel : envoyée
   * **avant**, la confirmation annonce une opération qui peut encore échouer —
   * et le critère 2 exige justement qu'elle puisse échouer et être rejouée ;
   * envoyée **après**, l'adresse n'existe plus dans le produit et doit avoir été
   * retenue.
   *
   * La décision retenue est **retenir l'adresse avant, envoyer après**, sur le
   * précédent de `organizations.purge` (s16) qui lit l'adresse d'un compte
   * pendant qu'elle existe pour effacer les invitations qui la nomment. Ce cas
   * la mesure au lieu de la commenter : au moment où la confirmation part, le
   * compte n'est plus là.
   */
  it('part après l’effacement, à l’adresse retenue avant', async () => {
    const { session, email } = await anAccount()

    await auth.useCases.runAccountPurge({ userId: session.userId })
    await settled()

    expect(deletionEmails().map((sent) => sent.to)).toEqual([email])
    expect(accountExistedWhenConfirmed).toBe(false)
  })
})

describe.runIf(databaseReachable)('avec ou sans le module de tâches de fond', () => {
  /**
   * **Module `jobs` coupé** : l'émission s'exécute dans la requête appelante —
   * le repli livré par s33, dont cette story est le premier client. La réponse
   * est la même que dans l'autre régime, et le compte est déjà parti quand elle
   * arrive.
   */
  it('coupé, la suppression aboutit dans la requête qui la demande', async () => {
    const { session, email } = await anAccount()

    jobsRegime = 'synchronous'

    const response = await callAuth('deleteAccount', { confirmation: email }, session)

    expect(response.status).toBe(202)
    await settled()
    expect(await auth.useCases.viewAccount(session.userId)).toBeNull()
    expect(deletionEmails()).toHaveLength(1)
  })

  /**
   * **Module `jobs` activé** : la requête rend la main sur une mise en file, et
   * rien n'est encore effacé. La doublure d'enregistrement de s33 asserte le
   * nom **et la charge utile** — laquelle ne porte qu'une **référence**
   * (`docs/security.md` §5) : l'identifiant, jamais l'adresse.
   */
  it('activé, la suppression est mise en file et n’efface rien avant son exécution', async () => {
    const { session, email } = await anAccount()

    jobsRegime = 'recording'

    const response = await callAuth('deleteAccount', { confirmation: email }, session)

    expect(response.status).toBe(202)

    // Le compte est toujours là : c'est l'ordonnanceur qui l'effacera.
    expect(await auth.useCases.viewAccount(session.userId)).not.toBeNull()
    expect(deletionEmails()).toHaveLength(0)

    expect(recordingJobs.emissions).toEqual([
      {
        job: `auth.${ACCOUNT_PURGE_JOB}`,
        key: `${ACCOUNT_PURGE_JOB}:${session.userId}`,
        // **Deux références, et rien d'autre** : l'identifiant du compte et la
        // langue de la demande. Ni adresse, ni nom (constat F9 pour la seconde,
        // `docs/security.md` §5 pour la règle).
        data: {
          [ACCOUNT_PURGE_JOB_FIELD]: session.userId,
          [ACCOUNT_PURGE_JOB_LOCALE]: defaultLocale,
        },
      },
    ])
    // **Aucune donnée personnelle dans la charge utile** : elle est écrite chez
    // le fournisseur, relue à l'exécution, et souvent journalisée en chemin.
    expect(JSON.stringify(recordingJobs.emissions)).not.toContain(email)

    // Puis l'ordonnanceur exécute ce qu'il a mis en file, par le répartiteur du
    // socle — le même chemin que le rappel du fournisseur.
    const emitted = recordingJobs.emissions[0]
    const ran = await dispatchModuleJob({
      registry,
      emission: emitted ?? { job: '', key: '', data: {} },
      log: () => {},
      retry: { maxAttempts: 1, baseMs: 0, maxMs: 0 },
      now: () => new Date(),
    })

    await settled()

    expect(ran).toMatchObject({ ok: true, ran: true })
    expect(await auth.useCases.viewAccount(session.userId)).toBeNull()
    expect(deletionEmails()).toHaveLength(1)
  })

  /**
   * **L'échéance cron que le contrat impose** : `ModuleJob.schedule` est
   * obligatoire (s33) et l'adaptateur arme les deux déclencheurs de chaque
   * tâche. Celle-ci est donc appelée périodiquement **sans charge utile**, et
   * elle ne doit alors rien effacer — aucun compte n'est nommé.
   *
   * **Ce cas n'a pas de mutation qui le fait rougir, et c'est dit plutôt que
   * caché** : deux gardes indépendantes tiennent la propriété — celle de la
   * tâche, et le retour anticipé de `runAccountPurge` sur un compte
   * introuvable. Neutraliser l'une laisse l'autre. Il est gardé comme filet de
   * régression sur une échéance que le contrat impose et que personne
   * n'a demandée, pas comme preuve d'une garde en particulier.
   */
  it('une exécution sans charge utile n’efface aucun compte', async () => {
    const { session } = await anAccount()

    const ran = await dispatchModuleJob({
      registry,
      emission: { job: `auth.${ACCOUNT_PURGE_JOB}`, key: 'echeance', data: {} },
      log: () => {},
      retry: { maxAttempts: 1, baseMs: 0, maxMs: 0 },
      now: () => new Date(),
    })

    expect(ran).toMatchObject({ ok: true, ran: true })
    expect(await auth.useCases.viewAccount(session.userId)).not.toBeNull()
    expect(deletionEmails()).toHaveLength(0)
  })
})

/** L'organisation créée par ce compte, avec son identifiant et son nom. */
const anOrganization = async (
  session: ModuleSession,
  name = 'Studio s34',
): Promise<{ readonly organizationId: string; readonly name: string }> => {
  const created = await callOrganizations(
    'create',
    { name, slug: `s34-${randomUUID().slice(0, 12)}` },
    session,
  )

  expect(created.status).toBe(303)

  const view = await organizationsService.useCases.viewOrganizations(session.userId)

  return { organizationId: view.current?.id ?? '', name }
}

const membersOf = async (organizationId: string): Promise<number> => {
  const counted = await connection.db.execute<{ rows: number }>(
    sql`select count(*)::int as rows from organization_member where organization_id = ${organizationId}`,
  )

  return counted.rows[0]?.rows ?? 0
}

describe.runIf(databaseReachable)('la suppression d’une organisation', () => {
  it('efface ses données, retire ses membres et annule son abonnement', async () => {
    const owner = await anAccount()
    const peer = await anAccount()
    const { organizationId, name } = await anOrganization(owner.session)

    await callOrganizations(
      'invite',
      { organizationId, email: peer.email, role: 'admin' },
      owner.session,
    )

    expect(await membersOf(organizationId)).toBe(1)

    const response = await callOrganizations(
      'delete',
      { organizationId, confirmation: name },
      owner.session,
    )

    expect(response.status).toBe(303)
    // **L'annulation chez le fournisseur a été demandée**, pour ce périmètre.
    expect(cancelledScopes).toEqual([organizationId])
    // Les membres sont retirés et l'organisation n'existe plus.
    expect(await membersOf(organizationId)).toBe(0)
    await expect(tablesNaming([organizationId])).resolves.toEqual([])
  })

  /**
   * **Un échec du fournisseur interrompt** (`docs/reliability.md` §3) : rien
   * n'est effacé, et l'organisation reste facturable — c'est le sens fermé. La
   * suppression est rejouable une fois le fournisseur revenu.
   */
  it('interrompue par un fournisseur en panne, n’efface rien', async () => {
    const owner = await anAccount()
    const { organizationId, name } = await anOrganization(owner.session)

    cancellationFails = true

    const response = await callOrganizations(
      'delete',
      { organizationId, confirmation: name },
      owner.session,
    )

    expect(response.status).toBe(303)
    expect(new URL(response.headers.get('location') ?? '', APP_URL).searchParams.get('error')).toBe(
      'billing_cancel_failed',
    )
    expect(await membersOf(organizationId)).toBe(1)

    // Rejouée une fois le fournisseur revenu, elle aboutit.
    cancellationFails = false
    expect(
      (await callOrganizations('delete', { organizationId, confirmation: name }, owner.session))
        .status,
    ).toBe(303)
    expect(await membersOf(organizationId)).toBe(0)
  })

  it('refuse une confirmation qui ne correspond pas au nom, et n’efface rien', async () => {
    const owner = await anAccount()
    const { organizationId } = await anOrganization(owner.session, 'Atelier s34')

    const response = await callOrganizations(
      'delete',
      { organizationId, confirmation: 'Atelier' },
      owner.session,
    )

    expect(new URL(response.headers.get('location') ?? '', APP_URL).searchParams.get('error')).toBe(
      'confirmation_mismatch',
    )
    expect(await membersOf(organizationId)).toBe(1)
    // Le refus n'a même pas parlé au fournisseur.
    expect(cancelledScopes).toEqual([])
  })

  /**
   * **404, jamais 403, sur l'organisation d'autrui** (`docs/security.md` §3) :
   * un 403 confirmerait qu'elle existe.
   */
  it('répond 404 à qui n’est pas membre, et n’efface rien', async () => {
    const owner = await anAccount()
    const stranger = await anAccount()
    const { organizationId, name } = await anOrganization(owner.session)

    const response = await callOrganizations(
      'delete',
      { organizationId, confirmation: name },
      stranger.session,
    )

    expect(response.status).toBe(404)
    expect(await membersOf(organizationId)).toBe(1)
    expect(cancelledScopes).toEqual([])
  })

  /** Un `admin` administre ; il ne supprime pas. Il est membre, donc 403 et non 404. */
  it('refuse un membre qui n’est pas propriétaire', async () => {
    const owner = await anAccount()
    const peer = await anAccount()
    const { organizationId, name } = await anOrganization(owner.session)

    await joinAs(organizationId, peer, 'admin')

    const response = await callOrganizations(
      'delete',
      { organizationId, confirmation: name },
      peer.session,
    )

    expect(response.status).toBe(403)
    expect(await membersOf(organizationId)).toBe(2)
  })
})

describe.runIf(databaseReachable)('le dernier propriétaire d’une organisation', () => {
  /**
   * **Il transfère ou il supprime d'abord** (critère 6), et le refus le dit :
   * il nomme les organisations qui bloquent. Sans elles, « transférez ou
   * supprimez » ne précise rien.
   */
  it('ne peut pas supprimer son compte, et le refus nomme l’organisation', async () => {
    const owner = await anAccount()
    const { name } = await anOrganization(owner.session, 'Studio bloquant')

    const response = await callAuth(
      'deleteAccount',
      { confirmation: owner.email },
      owner.session,
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      reason: 'sole_owner',
      organizations: [name],
    })
    // Refusé **avant** toute mise en file : rien n'a été demandé à personne.
    expect(await auth.useCases.viewAccount(owner.session.userId)).not.toBeNull()
    expect(deletionEmails()).toHaveLength(0)
  })

  it('le peut dès qu’un pair est aussi propriétaire', async () => {
    const owner = await anAccount()
    const peer = await anAccount()
    const { organizationId } = await anOrganization(owner.session, 'Studio partagé')

    await joinAs(organizationId, peer, 'owner')

    const response = await callAuth(
      'deleteAccount',
      { confirmation: owner.email },
      owner.session,
    )

    expect(response.status).toBe(202)
    await settled()
    expect(await auth.useCases.viewAccount(owner.session.userId)).toBeNull()
  })
})

describe.runIf(databaseReachable)('un module non activé', () => {
  /**
   * **La suppression aboutit dans la configuration où tout ce qui est optionnel
   * est coupé** (critère 10), et le module coupé **n'est pas appelé**.
   *
   * Ce cas existe parce que la recette du profil minimal ne le couvrait pas :
   * elle coupe des modules dans un clone puis rejoue cette suite, mais la suite
   * construit son propre registre — la suppression y était donc toujours
   * mesurée avec tous les modules activés. Mesuré, pas supposé.
   */
  it('n’est pas appelé par la suppression, qui aboutit quand même', async () => {
    const { session, email } = await anAccount()

    purgeRegistry = socleOnly

    await auth.useCases.runAccountPurge({ userId: session.userId })
    await settled()

    // Le compte est parti, la confirmation est partie : le produit fonctionne
    // sans les modules optionnels.
    expect(await auth.useCases.viewAccount(session.userId)).toBeNull()
    expect(deletionEmails().map((sent) => sent.to)).toEqual([email])
    // **Et la purge du module coupé n'a pas été appelée.** Observé sur l'appel,
    // parce qu'un module coupé n'a rien écrit dont on pourrait observer
    // l'absence.
    expect(fixturePurgeCalls).toBe(0)
    // Le plancher : dans la configuration complète, elle **est** appelée. Sans
    // lui, une purge qu'on n'appelle jamais rendrait ce cas vert.
    purgeRegistry = registry
    const other = await anAccount()

    await auth.useCases.runAccountPurge({ userId: other.session.userId })
    await settled()

    expect(fixturePurgeCalls).toBe(1)
  })
})

describe.runIf(databaseReachable)('l’identifiant du compte qui a promu (constat F1)', () => {
  /**
   * **Une colonne qui nomme un compte sans clé étrangère vers lui.**
   *
   * `admin_platform_role.granted_by` porte l'identifiant du superadmin qui a
   * promu. Elle n'a **aucune** clé étrangère — délibérément : effacer le
   * promoteur ne doit ni emporter la promotion, ni la bloquer. La conséquence
   * n'avait pas été tirée : la purge d'`admin` était vide, si bien que
   * l'identifiant d'un compte effacé survivait sur **chaque** rôle qu'il avait
   * accordé, en contradiction avec l'invariant de cette story — « aucune ligne
   * conservée ne porte l'identifiant du compte effacé ».
   *
   * C'est une catégorie **`anonymize`** au sens exact du contrat : la ligne
   * survit — le promu garde son rôle —, le lien vers le promoteur est rompu.
   */
  it('ne survit sur aucun rôle accordé après l’effacement du promoteur', async () => {
    const granter = await anAccount()
    const grantee = await anAccount()

    expect(
      await adminService.useCases.grantSuperadmin({
        actorId: granter.session.userId,
        userId: grantee.session.userId,
      }),
    ).toMatchObject({ ok: true })

    // Le plancher : la ligne existe **et** elle nomme le promoteur. Sans lui,
    // l'assertion d'après serait vraie sur une table vide.
    expect(await grantsMadeBy(granter.session.userId)).toBe(1)

    await auth.useCases.runAccountPurge({ userId: granter.session.userId })
    await settled()

    // La promotion **survit** : le promu reste superadmin, effacer le promoteur
    // ne lui retire rien.
    expect(await adminService.useCases.isSuperadmin(grantee.session.userId)).toBe(true)
    // Et plus rien ne nomme le promoteur — ni ici, ni ailleurs : le balayage
    // dérivé du contrat le dit pour toutes les tables des modules activés.
    expect(await grantsMadeBy(granter.session.userId)).toBe(0)
    await expect(tablesNaming([granter.session.userId, granter.email])).resolves.toEqual([])
  })
})

describe.runIf(databaseReachable)('la langue de la confirmation (constat F9)', () => {
  /**
   * **La confirmation part dans la langue de la demande, pas dans celle du
   * site.**
   *
   * La règle du module est « la langue **connue du destinataire** quand elle
   * l'est, celle du site sinon ». Le destinataire d'une confirmation de
   * suppression est la personne qui vient de la demander : sa langue est donc
   * connue — c'est celle de sa requête — et la retomber sur le site donnait un
   * email en français à qui lit l'application en anglais.
   *
   * La langue voyage dans la charge utile de la tâche parce que c'est une
   * **référence**, pas une donnée personnelle (`docs/security.md` §5) : un code
   * de langue ne nomme personne.
   */
  it('part en anglais quand la demande vient d’un appelant anglophone', async () => {
    const { session, email } = await anAccount()

    const response = await callAuth(
      'deleteAccount',
      { confirmation: email },
      session,
      { 'accept-language': 'en-GB,en;q=0.9' },
    )

    expect(response.status).toBe(202)
    await settled()

    expect(deletionEmails().map((sent) => sent.locale)).toEqual(['en'])
  })

  it('part dans la langue du site quand rien n’est connu de la demande', async () => {
    const { session, email } = await anAccount()

    expect((await callAuth('deleteAccount', { confirmation: email }, session)).status).toBe(202)
    await settled()

    expect(deletionEmails().map((sent) => sent.locale)).toEqual([defaultLocale])
  })
})

describe.runIf(databaseReachable)('la fenêtre entre la demande et l’effacement', () => {
  /**
   * **Le refus du dernier propriétaire tient au moment où l'on efface, pas
   * seulement au moment où l'on demande.**
   *
   * Le contrôle du critère 6 était fait à la demande, et **là seulement**.
   * Entre les deux, l'effacement est différé — c'est le mécanisme même du
   * critère 9, et c'est ce que fait la configuration livrée, où le module
   * `jobs` est activé. La fenêtre est donc réelle en production, et elle n'est
   * fermée que dans la configuration où `jobs` est coupé : exactement celle que
   * `pnpm test:minimal-profile` rejoue, ce qui explique que rien ne l'ait
   * attrapée.
   *
   * La sonde de la revue, rejouée ici avec les routes du produit : demander la
   * suppression **sans** organisation, en créer une ensuite, puis laisser la
   * tâche s'exécuter. L'organisation survivait avec zéro propriétaire — un état
   * que `packages/modules/organizations/AGENTS.md` décrit depuis s17 comme
   * ingouvernable et que rien ne répare.
   */
  it('refuse d’effacer un compte devenu dernier propriétaire depuis sa demande', async () => {
    const owner = await anAccount()

    jobsRegime = 'recording'

    // 1. La demande passe : à cet instant, ce compte ne possède rien.
    expect((await callAuth('deleteAccount', { confirmation: owner.email }, owner.session)).status).toBe(202)

    // 2. Entre-temps, il crée une organisation dont il est seul propriétaire.
    const created = await anOrganization(owner.session, 'Studio de la fenêtre')

    expect(await ownersOf(created.organizationId)).toBe(1)

    // De la donnée dans un module purgé **avant** celui des organisations :
    // c'est elle qui dit si le refus a laissé passer des effacements.
    aFixtureNote(owner.session.userId, owner.email)

    // 3. La tâche s'exécute. Elle doit **refuser**.
    expect(await runQueuedJob()).toEqual({ ok: false })

    // Le compte est toujours là — l'effacement se rejouera quand la personne
    // aura transféré ou supprimé son organisation.
    expect(await auth.useCases.viewAccount(owner.session.userId)).not.toBeNull()
    // Et l'organisation garde son propriétaire : c'est tout l'enjeu.
    expect(await ownersOf(created.organizationId)).toBe(1)
    expect(await membersOf(created.organizationId)).toBe(1)

    /**
     * **Un refus n'efface rien, pas même en chemin.** L'ordre de purge est
     * l'inverse du graphe : les modules qui ne portent aucune règle de
     * propriété passent **avant** celui des organisations. Un refus qui
     * n'arriverait qu'à ce moment-là aurait déjà supprimé les fichiers, les
     * notifications et le reste — un compte à moitié effacé, sur une opération
     * qui vient de dire non. C'est ce que le contrôle **avant** la purge
     * empêche, et c'est cette ligne qui le mesure.
     */
    expect(fixtureNotes.filter((note) => note.ownerId === owner.session.userId)).toHaveLength(1)

    // Aucune confirmation n'est partie : il n'y a rien à confirmer.
    expect(deletionEmails()).toHaveLength(0)
    // Mais la personne est prévenue que sa demande n'a pas abouti, et pourquoi.
    expect(blockedEmails().map((sent) => sent.to)).toEqual([owner.email])
  })

  /**
   * **La variante à deux copropriétaires**, que la revue avait raisonnée sans
   * la mesurer : chacun demande sa suppression avant que l'une des deux tâches
   * ne s'exécute. Les deux contrôles de demande passent — il y a bien deux
   * propriétaires à cet instant — et sans contrôle à l'effacement, les deux
   * purges aboutissent.
   */
  it('n’efface que le premier de deux copropriétaires qui partent ensemble', async () => {
    const first = await anAccount()
    const second = await anAccount()
    const shared = await anOrganization(first.session, 'Studio partagé')

    await joinAs(shared.organizationId, second, 'owner')

    expect(await ownersOf(shared.organizationId)).toBe(2)

    jobsRegime = 'recording'

    // Les deux demandes passent : à cet instant, l'organisation a deux
    // propriétaires, aucun n'est le dernier.
    expect((await callAuth('deleteAccount', { confirmation: first.email }, first.session)).status).toBe(202)
    expect((await callAuth('deleteAccount', { confirmation: second.email }, second.session)).status).toBe(202)

    // Le premier part : il restait un propriétaire derrière lui.
    expect(await runQueuedJob(0)).toEqual({ ok: true })
    expect(await auth.useCases.viewAccount(first.session.userId)).toBeNull()

    // Le second est devenu le dernier entre-temps : il ne part pas.
    expect(await runQueuedJob(1)).toEqual({ ok: false })
    expect(await auth.useCases.viewAccount(second.session.userId)).not.toBeNull()
    expect(await ownersOf(shared.organizationId)).toBe(1)
  })

  /**
   * **La même variante, mais réellement simultanée** — et c'est un autre
   * mécanisme qui la tient.
   *
   * Séquentiellement, le contrôle fait avant la purge suffit : le second départ
   * voit l'état commis par le premier. **Ensemble**, les deux contrôles voient
   * chacun deux propriétaires et laissent passer ; ce qui refuse alors est le
   * prédicat de l'écriture, sous le verrou consultatif de l'organisation —
   * exactement le mécanisme que s16 a posé pour deux retraits en vol, sur le
   * chemin que la purge empruntait sans lui.
   *
   * Cinq courses, parce qu'une seule ne prouve rien d'un entrelacement : le
   * précédent de s16 en joue dix, et neuf y étaient rouges sans le verrou.
   */
  it('garde un propriétaire quand deux copropriétaires partent ensemble, à chaque course', async () => {
    for (let race = 0; race < 5; race += 1) {
      const first = await anAccount()
      const second = await anAccount()
      const shared = await anOrganization(first.session, `Studio course ${race}`)

      await joinAs(shared.organizationId, second, 'owner')

      // De la donnée dans un module purgé **avant** celui des organisations,
      // pour chacun des deux : c'est elle qui dit si le perdant de la course a
      // été effacé en chemin.
      aFixtureNote(first.session.userId, first.email)
      aFixtureNote(second.session.userId, second.email)

      const outcomes = await Promise.all([
        auth.useCases
          .runAccountPurge({ userId: first.session.userId })
          .then(() => true)
          .catch(() => false),
        auth.useCases
          .runAccountPurge({ userId: second.session.userId })
          .then(() => true)
          .catch(() => false),
      ])

      await settled()

      // **Au moins un propriétaire survit**, course après course. C'est le seul
      // fait qui compte : une organisation sans propriétaire n'est réparable
      // par aucune commande du produit.
      expect(await ownersOf(shared.organizationId), `course ${race}`).toBeGreaterThanOrEqual(1)
      // Et l'un des deux départs a bien abouti : un verrou qui refuserait les
      // deux fermerait la fenêtre en bloquant le produit.
      expect(outcomes.filter(Boolean), `course ${race}`).toHaveLength(1)

      /**
       * **Le refusé n'a rien perdu, pas même en chemin** (constat F1 de la
       * troisième revue).
       *
       * C'est ici que la course se distingue du cas séquentiel : le contrôle
       * fait avant la purge laisse passer les deux appelants — chacun voit deux
       * propriétaires —, et si le refus n'arrivait qu'à l'intérieur de la
       * purge, les modules purgés plus tôt dans l'ordre inverse auraient déjà
       * effacé les données du perdant. Ses fichiers seraient partis du
       * fournisseur de stockage, définitivement, pendant que son compte survit
       * et qu'un email lui annonce que rien n'a été effacé.
       */
      const refused = outcomes[0] === true ? second : first

      expect(
        fixtureNotes.filter((note) => note.ownerId === refused.session.userId),
        `course ${race} — notes du compte refusé`,
      ).toHaveLength(1)
    }
  }, 60_000)
})
