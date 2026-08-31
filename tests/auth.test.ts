import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { buildRegistry, dispatchModuleRequest, MODULE_ROUTE_PREFIX } from '@repo/core'
import {
  createDatabaseClient,
  listDatabaseTables,
  planModuleMigrations,
  runModuleMigrations,
  type DatabaseConnection,
} from '@repo/db'
import { createRecordingMailer, type RecordingMailer } from '@repo/mailer-testing'
import {
  authModule,
  authSchema,
  configureAuth,
  createDrizzleVerificationTokenRepository,
  resetAuthService,
  type AuthService,
} from '@repo/module-auth'
import { AUTH_MODELS } from '@repo/module-auth'
import { getAuthTables } from 'better-auth'
import { magicLink } from 'better-auth/plugins/magic-link'
import { sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import type { SecurityEventRecord } from '@repo/module-auth'
import { databaseUrl, isDatabaseReachable } from './fixtures/database'

/**
 * L'authentification, éprouvée **contre une vraie base** et à travers le
 * répartiteur de modules — c'est-à-dire par le même chemin qu'une requête de
 * l'application.
 *
 * Ce fichier porte les trois mesures qui décident de la story, et aucune n'est
 * une lecture de code :
 *
 * 1. **le schéma** — les tables réellement créées sur une base vierge, et les
 *    champs que la bibliothèque attend, confrontés à ce que le module déclare ;
 * 2. **les emails** — ce qui transite par le port `Mailer`, et la preuve qu'il
 *    ne part *rien* d'autre : aucun appel réseau sortant pendant les parcours ;
 * 3. **la session** — les attributs du cookie effectivement posé, sa rotation à
 *    la connexion, et sa révocation côté serveur.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_URL = 'http://localhost:3000'
const AUTH_PREFIX = `${MODULE_ROUTE_PREFIX}/auth`
const TEST_SECRET = 'secret-de-test-uniquement-0123456789abcdef'
const PASSWORD = 'mot-de-passe-de-test-1'

const databaseReachable = await isDatabaseReachable()

/** Le registre du module seul : la modularité ne dépend pas de la configuration du dépôt. */
const registry = buildRegistry({ available: [authModule], enabled: ['auth'] })

let connection: DatabaseConnection
let mailer: RecordingMailer
let service: AuthService
let logs: SecurityEventRecord[] = []

/**
 * Aucun appel réseau sortant n'est toléré pendant ces parcours.
 *
 * C'est la seconde moitié de la frontière « les emails passent par le port » :
 * vérifier que la doublure reçoit trois emails ne dit rien de ce qui aurait pu
 * partir **à côté**. La base parle par une socket PostgreSQL, jamais par
 * `fetch` : tout appel ici est donc une sortie que personne n'a demandée.
 */
const outboundCalls: string[] = []
const realFetch = globalThis.fetch

beforeAll(async () => {
  globalThis.fetch = ((input: unknown) => {
    outboundCalls.push(String(input))

    return Promise.reject(new Error('appel réseau sortant interdit dans cette suite'))
  }) as typeof fetch

  if (!databaseReachable) {
    return
  }

  connection = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 5 })

  // Les migrations du module, jouées ici : elles sont idempotentes, et la suite
  // ne doit pas dépendre d'un `pnpm db:migrate` lancé avant elle.
  await runModuleMigrations({
    db: connection.db,
    plan: planModuleMigrations({ modules: [authModule], repoRoot: REPO_ROOT }),
  })

  // **Préchauffage du pool.** `node-postgres` établit ses connexions une par
  // une, à la demande : sans cela, deux requêtes lancées ensemble se
  // sérialisent le temps que la seconde connexion s'ouvre, et le cas des « deux
  // clics simultanés » ne prouve plus rien — mesuré, il reste vert même avec
  // une consommation en deux temps. Cinq connexions ouvertes puis rendues au
  // pool rendent la concurrence réelle.
  await Promise.all([1, 2, 3, 4, 5].map(() => connection.db.execute(sql`select 1`)))

  mailer = createRecordingMailer()
  service = configureAuth({
    db: connection.db,
    mailer,
    secret: TEST_SECRET,
    appUrl: APP_URL,
    log: (record) => logs.push(record),
  })
})

afterAll(async () => {
  globalThis.fetch = realFetch
  resetAuthService()

  if (databaseReachable) {
    // Les comptes de la suite, et eux seuls : sessions, identifiants et jetons
    // suivent par cascade.
    await connection.db.execute(sql`delete from auth_user where email like 's07-%'`)
    await connection.db.execute(sql`delete from auth_verification where value like '%s07-%'`)
    await connection.close()
  }
})

beforeEach(() => {
  mailer?.reset()
  logs = []
  outboundCalls.length = 0
})

const anEmail = (): string => `s07-${randomUUID()}@example.test`

interface CallOptions {
  readonly method?: string
  readonly body?: unknown
  readonly cookie?: string
}

/** Une requête telle que l'application la sert : par le répartiteur du registre. */
const call = async (path: string, options: CallOptions = {}): Promise<Response> => {
  const headers = new Headers({ 'content-type': 'application/json', origin: APP_URL })

  if (options.cookie !== undefined) {
    headers.set('cookie', options.cookie)
  }

  return await dispatchModuleRequest(
    registry,
    new Request(`${APP_URL}${AUTH_PREFIX}${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { resolveSession: (request) => service.resolveSession(request) },
  )
}

interface SetCookie {
  readonly value: string
  readonly attributes: string
}

const sessionCookie = (response: Response): SetCookie | null => {
  const header = response.headers
    .getSetCookie()
    .find((candidate) => candidate.includes('session_token='))

  if (header === undefined) {
    return null
  }

  const [pair = '', ...rest] = header.split(';')

  return { value: pair.trim(), attributes: rest.join(';') }
}

/** Le lien contenu dans le dernier email d'un template donné. */
const lastLink = (template: string): string => {
  const sent = [...mailer.sent].reverse().find((email) => email.template === `auth.${template}`)

  if (sent === undefined) {
    throw new Error(`Aucun email « auth.${template} » enregistré.`)
  }

  return String(sent.data.url)
}

/** Le chemin d'un lien d'email, tel que le répartiteur l'attend. */
const pathOf = (link: string): string => {
  const url = new URL(link)

  return `${url.pathname.slice(AUTH_PREFIX.length)}${url.search}`
}

/** Inscrit un compte, vérifie son email, et rend de quoi s'y connecter. */
const aVerifiedAccount = async (): Promise<{ email: string; userId: string }> => {
  const email = anEmail()
  const signUp = await call('/sign-up/email', { body: { email, password: PASSWORD } })

  expect(signUp.status).toBe(200)

  const verified = await call(pathOf(lastLink('verify-email')))

  expect(verified.status).toBe(302)

  const [row] = await connection.db
    .select({ id: authSchema.authUser.id })
    .from(authSchema.authUser)
    .where(sql`email = ${email}`)

  return { email, userId: row?.id ?? '' }
}

/** Ouvre une session et rend son cookie. */
const signIn = async (email: string, cookie?: string): Promise<Response> =>
  await call('/sign-in/email', { body: { email, password: PASSWORD }, cookie })

describe.skipIf(!databaseReachable)('frontière — le schéma appartient au module', () => {
  it('ne crée sur une base vierge que les tables que le module déclare', async () => {
    // Une base réellement vierge : un schéma PostgreSQL jetable, où les
    // migrations du module sont rejouées de zéro. Lire les fichiers de
    // migration ne dirait que ce qu'on a écrit ; une table créée par un import
    // transitif ou par la bibliothèque elle-même ne s'y verrait pas.
    const probe = `s07_probe_${Date.now()}`

    await connection.db.execute(sql`create schema ${sql.identifier(probe)}`)

    const isolated = createDatabaseClient({
      connectionString: `${databaseUrl}?options=-c%20search_path%3D${probe}`,
      maxConnections: 1,
    })

    try {
      await runModuleMigrations({
        db: isolated.db,
        plan: planModuleMigrations({ modules: [authModule], repoRoot: REPO_ROOT }).map((step) => ({
          ...step,
          migrationsSchema: probe,
        })),
      })

      const created = await listDatabaseTables({ db: isolated.db, schemaName: probe })
      const declared = Object.values(authModule.schema)
        .map((table) => getTableConfig(table as never).name)
        .sort()

      expect(created.filter((name) => !name.startsWith('__drizzle'))).toEqual(declared)
    } finally {
      await isolated.close()
      await connection.db.execute(sql`drop schema ${sql.identifier(probe)} cascade`)
    }
  }, 60_000)

  it('déclare chaque champ que la bibliothèque attend, sous le nom qu’elle attend', () => {
    // Better Auth résout une colonne par le **nom de propriété** de l'objet
    // Drizzle : un champ manquant ou renommé ne casse pas la compilation, il
    // casse la requête, en production. `getAuthTables` est la source de vérité
    // de la bibliothèque installée — cette liste n'est recopiée nulle part, et
    // une montée de version qui ajoute un champ fait rougir ce cas.
    const expected = getAuthTables({
      ...AUTH_MODELS,
      plugins: [magicLink({ sendMagicLink: () => Promise.resolve() })],
    } as never)

    const declaredByModelName = new Map(
      Object.values(authSchema).map((table) => [
        getTableConfig(table).name,
        new Set(Object.keys(table)),
      ]),
    )

    for (const table of Object.values(expected)) {
      const declared = declaredByModelName.get(table.modelName)

      expect(declared, `table « ${table.modelName} » absente du module`).toBeDefined()

      for (const field of Object.keys(table.fields)) {
        expect(declared?.has(field), `champ « ${table.modelName}.${field} » absent`).toBe(true)
      }

      expect(declared?.has('id')).toBe(true)
    }
  })
})

describe.skipIf(!databaseReachable)('frontière — tout email passe par le port', () => {
  it('envoie la vérification, le magic link et la réinitialisation par le port, et rien d’autre', async () => {
    const { email } = await aVerifiedAccount()

    await call('/sign-in/magic-link', { body: { email } })
    await call('/request-password-reset', { body: { email } })

    const templates = mailer.sent.map((sent) => sent.template)

    expect(templates).toEqual([
      'auth.verify-email',
      'auth.magic-link',
      'auth.reset-password',
    ])

    for (const sent of mailer.sent) {
      expect(sent.to).toBe(email)
      expect(sent.locale).toBe('fr')
      expect(String(sent.data.url)).toContain(APP_URL)
    }

    // La preuve que le port est le **seul** chemin : rien n'est sorti à côté.
    expect(outboundCalls).toEqual([])
  }, 60_000)

  it('déclare les trois templates au contrat, dans toutes ses locales', () => {
    const locales = Object.keys(authModule.messages)

    expect(authModule.emails.map((template) => template.id).sort()).toEqual([
      'magic-link',
      'reset-password',
      'verify-email',
    ])

    for (const template of authModule.emails) {
      for (const locale of locales) {
        expect(Object.keys(template.locales)).toContain(locale)
      }
    }
  })

  it('dit l’échec de l’envoi plutôt que de rendre un compte muet', async () => {
    // `docs/reliability.md` §2 : sans service d'email, l'inscription échoue
    // **proprement en le disant**. Le compte existe, et un nouvel envoi reste
    // possible : l'opération est reprenable.
    const broken = configureAuth({
      db: connection.db,
      mailer: {
        send: () =>
          Promise.resolve({
            ok: false as const,
            error: { code: 'provider_unavailable' as const, message: 'panne', attempts: 2 },
          }),
      },
      secret: TEST_SECRET,
      appUrl: APP_URL,
      log: () => {},
    })

    try {
      const email = anEmail()
      const response = await dispatchModuleRequest(
        registry,
        new Request(`${APP_URL}${AUTH_PREFIX}/sign-up/email`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: APP_URL },
          body: JSON.stringify({ email, password: PASSWORD }),
        }),
        { resolveSession: (request) => broken.resolveSession(request) },
      )

      expect(response.status).toBe(502)
      await expect(response.json()).resolves.toMatchObject({
        error: 'verification_email_not_sent',
      })
    } finally {
      service = configureAuth({
        db: connection.db,
        mailer,
        secret: TEST_SECRET,
        appUrl: APP_URL,
        log: (record) => logs.push(record),
      })
    }
  }, 30_000)
})

describe.skipIf(!databaseReachable)('parcours d’inscription et de vérification', () => {
  it('crée le compte, envoie la vérification, et refuse la connexion tant qu’elle n’a pas eu lieu', async () => {
    const email = anEmail()

    expect((await call('/sign-up/email', { body: { email, password: PASSWORD } })).status).toBe(200)
    expect(mailer.sent.map((sent) => sent.template)).toEqual(['auth.verify-email'])

    const refused = await signIn(email)

    expect(refused.status).toBe(403)
    expect(sessionCookie(refused)).toBeNull()
  }, 30_000)

  it('vérifie le compte au premier clic, et refuse le second', async () => {
    const email = anEmail()
    await call('/sign-up/email', { body: { email, password: PASSWORD } })

    const link = pathOf(lastLink('verify-email'))
    const first = await call(link)

    expect(first.status).toBe(302)
    expect(first.headers.get('location')).toBe('/sign-in?verified=1')

    // Un lien déjà consommé ne vérifie rien et le **dit** : c'est ce que le
    // jeton signé de la bibliothèque ne savait pas faire.
    const second = await call(link)

    expect(second.headers.get('location')).toBe('/verify-email?error=invalid_token')
  }, 30_000)

  it('refuse un jeton de vérification inconnu sans rien vérifier', async () => {
    const email = anEmail()
    await call('/sign-up/email', { body: { email, password: PASSWORD } })

    const response = await call('/verify-email?token=jeton-invente')

    expect(response.headers.get('location')).toBe('/verify-email?error=invalid_token')
    expect((await signIn(email)).status).toBe(403)
  }, 30_000)

  it('refuse une inscription dont le mot de passe est plus court que la politique, sans rien écrire', async () => {
    const email = anEmail()
    const response = await call('/sign-up/email', { body: { email, password: 'court' } })

    expect(response.status).toBe(400)
    expect(mailer.sent).toEqual([])

    const rows = await connection.db
      .select({ id: authSchema.authUser.id })
      .from(authSchema.authUser)
      .where(sql`email = ${email}`)

    expect(rows).toEqual([])
  }, 30_000)
})

describe.skipIf(!databaseReachable)('connexion, magic link et réinitialisation', () => {
  it('ouvre une session vérifiée et donne accès aux routes protégées', async () => {
    const { email } = await aVerifiedAccount()
    const response = await signIn(email)

    expect(response.status).toBe(200)

    const cookie = sessionCookie(response)

    expect(cookie).not.toBeNull()
    expect((await call('/sign-out', { method: 'POST', body: {}, cookie: cookie?.value })).ok).toBe(
      true,
    )
  }, 30_000)

  it('ouvre une session par magic link, une seule fois', async () => {
    const { email } = await aVerifiedAccount()

    await call('/sign-in/magic-link', { body: { email } })

    const link = pathOf(lastLink('magic-link'))
    const first = await call(link)

    expect(sessionCookie(first)).not.toBeNull()

    const second = await call(link)

    expect(sessionCookie(second)).toBeNull()
  }, 30_000)

  it('périme le lien précédent quand un nouveau magic link est demandé', async () => {
    const { email } = await aVerifiedAccount()

    await call('/sign-in/magic-link', { body: { email } })
    const first = pathOf(lastLink('magic-link'))

    await call('/sign-in/magic-link', { body: { email } })
    const second = pathOf(lastLink('magic-link'))

    expect(first).not.toBe(second)
    expect(sessionCookie(await call(first))).toBeNull()
    expect(sessionCookie(await call(second))).not.toBeNull()
  }, 30_000)

  it('réinitialise le mot de passe et invalide les liens frères', async () => {
    const { email } = await aVerifiedAccount()

    await call('/request-password-reset', { body: { email } })
    const firstLink = lastLink('reset-password')

    await call('/request-password-reset', { body: { email } })
    const secondLink = lastLink('reset-password')

    // Le lien mène à l'**écran** de réinitialisation, qui repasse le jeton à la
    // route déclarée. Un lien vers un segment dynamique
    // (`/reset-password/<jeton>`) répondrait 404 : le contrat de module n'en
    // déclare pas, et le répartiteur ne l'apparierait pas.
    const tokenOf = (link: string): string =>
      new URL(link).searchParams.get('token') ?? ''

    expect(new URL(firstLink).pathname).toBe('/reset-password')

    const changed = await call('/reset-password', {
      body: { token: tokenOf(secondLink), newPassword: `${PASSWORD}-nouveau` },
    })

    expect(changed.status).toBe(200)

    // Le lien consommé invalide les autres liens en cours : le premier ne vaut
    // plus rien, alors qu'il n'a jamais servi.
    const replayed = await call('/reset-password', {
      body: { token: tokenOf(firstLink), newPassword: `${PASSWORD}-encore` },
    })

    expect(replayed.status).toBe(400)
  }, 30_000)
})

describe.skipIf(!databaseReachable)('durcissement de la session', () => {
  it('pose un cookie HttpOnly, Secure et SameSite=Strict', async () => {
    const { email } = await aVerifiedAccount()
    const cookie = sessionCookie(await signIn(email))
    const attributes = cookie?.attributes.toLowerCase() ?? ''

    expect(attributes).toContain('httponly')
    expect(attributes).toContain('secure')
    expect(attributes).toContain('samesite=strict')
  }, 30_000)

  it('régénère l’identifiant de session à la connexion', async () => {
    const { email } = await aVerifiedAccount()
    const first = sessionCookie(await signIn(email))

    // Le cookie précédent est présenté à la connexion suivante : c'est la
    // situation de la fixation de session, où l'attaquant impose son propre
    // identifiant avant que la victime ne s'authentifie.
    const second = sessionCookie(await signIn(email, first?.value))

    expect(second?.value).not.toBe(first?.value)
  }, 30_000)

  it('révoque la session côté serveur à la déconnexion', async () => {
    const { email, userId } = await aVerifiedAccount()
    const cookie = sessionCookie(await signIn(email))

    await call('/sign-out', { method: 'POST', body: {}, cookie: cookie?.value })

    // Côté serveur, pas dans une liste : la ligne n'existe plus, et l'ancien
    // cookie ne satisfait plus aucune route protégée.
    const [remaining] = await connection.db
      .select({ count: sql<number>`count(*)::int` })
      .from(authSchema.authSession)
      .where(sql`user_id = ${userId}`)

    expect(Number(remaining?.count ?? -1)).toBe(0)
    expect((await call('/sign-out', { method: 'POST', body: {}, cookie: cookie?.value })).status).toBe(
      401,
    )
  }, 30_000)

  it('révoque les autres sessions au changement de mot de passe', async () => {
    const { email, userId } = await aVerifiedAccount()
    const other = sessionCookie(await signIn(email))
    const current = sessionCookie(await signIn(email))

    const response = await call('/change-password', {
      body: { currentPassword: PASSWORD, newPassword: `${PASSWORD}-change` },
      cookie: current?.value,
    })

    expect(response.status).toBe(200)

    // L'ancienne session est refusée par le serveur, et la nouvelle a un
    // identifiant différent : le changement de mot de passe est une élévation
    // de privilège, il fait tourner la session.
    expect(
      (await call('/sign-out', { method: 'POST', body: {}, cookie: other?.value })).status,
    ).toBe(401)

    const [rows] = await connection.db
      .select({ count: sql<number>`count(*)::int` })
      .from(authSchema.authSession)
      .where(sql`user_id = ${userId}`)

    expect(Number(rows?.count ?? -1)).toBe(1)
    expect(sessionCookie(response)?.value).not.toBe(current?.value)
  }, 30_000)

  it('révoque les autres sessions au changement d’email, une fois la nouvelle adresse confirmée', async () => {
    const { email, userId } = await aVerifiedAccount()
    const cookie = sessionCookie(await signIn(email))
    const newEmail = anEmail()

    const asked = await call('/change-email', { body: { email: newEmail }, cookie: cookie?.value })

    expect(asked.status).toBe(200)

    const sent = mailer.sent.at(-1)

    expect(sent?.to).toBe(newEmail)

    const confirmed = await call(pathOf(lastLink('verify-email')))

    expect(confirmed.headers.get('location')).toBe('/sign-in?email_changed=1')

    const [rows] = await connection.db
      .select({ count: sql<number>`count(*)::int` })
      .from(authSchema.authSession)
      .where(sql`user_id = ${userId}`)

    expect(Number(rows?.count ?? -1)).toBe(0)
    expect((await signIn(newEmail)).status).toBe(200)
  }, 30_000)

  it('refuse une route protégée sans session, sans atteindre la bibliothèque', async () => {
    expect((await call('/sign-out', { method: 'POST', body: {} })).status).toBe(401)
    expect((await call('/change-password', { body: {} })).status).toBe(401)
  })

  it('vaut vérification pour le magic link, et efface ce que le compte avait accumulé avant la preuve', async () => {
    // Comportement de la bibliothèque, mesuré et épinglé ici parce qu'il
    // surprend : quand un magic link résout un compte **non vérifié**, Better
    // Auth supprime ses identifiants et ses sessions avant d'ouvrir la
    // sienne (`revokeUnprovenAccountAccess`). Un attaquant qui s'inscrit avec
    // l'adresse d'autrui n'hérite donc de rien le jour où le propriétaire
    // prouve sa boîte — mais le mot de passe choisi avant la vérification est
    // perdu, et c'est le parcours « mot de passe oublié » qui le rétablit.
    const email = anEmail()
    await call('/sign-up/email', { body: { email, password: PASSWORD } })
    await call('/sign-in/magic-link', { body: { email } })

    const opened = await call(pathOf(lastLink('magic-link')))

    expect(sessionCookie(opened)).not.toBeNull()
    expect((await signIn(email)).status).toBe(401)
  }, 30_000)
})

describe.skipIf(!databaseReachable)('jetons à usage unique', () => {
  it('ne consomme un jeton qu’une fois, même sur deux consommations concurrentes', async () => {
    // La concurrence est éprouvée **là où elle se joue** : deux connexions
    // distinctes et déjà ouvertes, deux consommations lancées dans le même
    // tour de boucle. Le faire par deux requêtes HTTP donnait un cas *flaky* —
    // mesuré : avec une consommation en deux temps, il ne rougissait qu'une
    // fois sur trois, parce que le pipeline complet ne garantit pas que les
    // deux lectures tombent dans la même fenêtre. Un test intermittent ne
    // garde rien.
    const identifier = `email-verification:course-${randomUUID()}`
    const second = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 1 })

    try {
      await second.db.execute(sql`select 1`)

      const first = createDrizzleVerificationTokenRepository(connection.db)
      const rival = createDrizzleVerificationTokenRepository(second.db)

      await first.create({
        identifier,
        value: 's07-course@example.test',
        expiresAt: new Date(Date.now() + 60_000),
      })

      const outcomes = await Promise.all([first.consume(identifier), rival.consume(identifier)])

      expect(outcomes.filter((outcome) => outcome !== null)).toHaveLength(1)
    } finally {
      await second.close()
      await connection.db.execute(
        sql`delete from auth_verification where identifier = ${identifier}`,
      )
    }
  }, 30_000)

  it('refuse un lien de vérification expiré', async () => {
    const email = anEmail()
    await call('/sign-up/email', { body: { email, password: PASSWORD } })

    const link = pathOf(lastLink('verify-email'))

    await connection.db.execute(
      sql`update auth_verification set expires_at = now() - interval '1 minute' where identifier like 'email-verification:%'`,
    )

    const response = await call(link)

    expect(response.headers.get('location')).toBe('/verify-email?error=invalid_token')
    expect((await signIn(email)).status).toBe(403)
  }, 30_000)
})

describe.skipIf(!databaseReachable)('indistinguabilité compte inconnu / mot de passe invalide', () => {
  it('rend la même réponse, au même statut', async () => {
    const { email } = await aVerifiedAccount()

    const unknown = await call('/sign-in/email', {
      body: { email: anEmail(), password: PASSWORD },
    })
    const wrongPassword = await call('/sign-in/email', {
      body: { email, password: `${PASSWORD}-faux` },
    })

    expect(unknown.status).toBe(wrongPassword.status)
    await expect(unknown.json()).resolves.toEqual(await wrongPassword.json())
  }, 30_000)

  it('répond en un temps que le chronomètre ne distingue pas', async () => {
    const { email } = await aVerifiedAccount()
    const attempts = 9
    const unknown: number[] = []
    const wrong: number[] = []

    // Les deux cas sont **entrelacés** : mesurer neuf fois l'un puis neuf fois
    // l'autre attribuerait à la règle toute dérive de la machine.
    for (let index = 0; index < attempts; index += 1) {
      const startUnknown = performance.now()
      await call('/sign-in/email', { body: { email: anEmail(), password: PASSWORD } })
      unknown.push(performance.now() - startUnknown)

      const startWrong = performance.now()
      await call('/sign-in/email', { body: { email, password: `${PASSWORD}-faux` } })
      wrong.push(performance.now() - startWrong)
    }

    const median = (values: number[]): number =>
      [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)] ?? 0

    const unknownMedian = median(unknown)
    const wrongMedian = median(wrong)
    const gap = Math.abs(unknownMedian - wrongMedian)

    // Le compte inconnu doit coûter un hachage, comme le mot de passe faux.
    // Sans cela, il répond en une requête de lecture — un ordre de grandeur
    // plus vite, et l'existence du compte se lit au chronomètre.
    expect(gap).toBeLessThan(Math.max(unknownMedian, wrongMedian) * 0.5)
  }, 120_000)
})

describe.skipIf(!databaseReachable)('journalisation des événements de sécurité', () => {
  it('journalise la connexion avec son acteur, l’échec sans acteur', async () => {
    const { email, userId } = await aVerifiedAccount()

    await signIn(email)
    await call('/sign-in/email', { body: { email, password: `${PASSWORD}-faux` } })

    const succeeded = logs.find((record) => record.event === 'auth.sign_in_succeeded')
    const failed = logs.find((record) => record.event === 'auth.sign_in_failed')

    expect(succeeded?.actor).toBe(userId)
    expect(failed?.actor).toBe('anonymous')
  }, 30_000)

  it('ne journalise ni jeton, ni mot de passe, ni cookie', async () => {
    const { email } = await aVerifiedAccount()

    await call('/sign-in/magic-link', { body: { email } })
    await call('/request-password-reset', { body: { email } })

    const magicLinkUrl = lastLink('magic-link')
    const journal = JSON.stringify(logs)

    expect(journal).not.toContain(PASSWORD)
    expect(journal).not.toContain(new URL(magicLinkUrl).searchParams.get('token') ?? 'jeton')
    expect(journal).not.toContain('session_token')
  }, 30_000)
})

describe.skipIf(!databaseReachable)('module non configuré', () => {
  it('échoue en le disant plutôt que de servir une requête à moitié', async () => {
    resetAuthService()

    try {
      await expect(
        dispatchModuleRequest(
          registry,
          new Request(`${APP_URL}${AUTH_PREFIX}/sign-in/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: anEmail(), password: PASSWORD }),
          }),
        ),
      ).rejects.toThrow(/configur/i)
    } finally {
      service = configureAuth({
        db: connection.db,
        mailer,
        secret: TEST_SECRET,
        appUrl: APP_URL,
        log: (record) => logs.push(record),
      })
    }
  })
})
