import { createHmac, randomUUID } from 'node:crypto'
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
import type { Mailer } from '@repo/ports'
import {
  authModule,
  authSchema,
  configureAuth,
  createDrizzleVerificationTokenRepository,
  resetAuthService,
  type AuthService,
  type ConfigureAuthOptions,
} from '@repo/module-auth'
import { AUTH_MODELS } from '@repo/module-auth'
import { getAuthTables } from 'better-auth'
import { appLocales } from '../config/i18n'
import { magicLink } from 'better-auth/plugins/magic-link'
import { twoFactor } from 'better-auth/plugins/two-factor'
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
const registry = buildRegistry({ available: [authModule], enabled: ['auth'], locales: [...appLocales] })

let connection: DatabaseConnection
let mailer: RecordingMailer
let service: AuthService
let logs: SecurityEventRecord[] = []

/**
 * Le mailer de la suite, avec un **retard réglable**.
 *
 * Sans lui, aucun chronomètre ne verrait la différence : la doublure
 * d'enregistrement répond en quelques microsecondes, alors qu'un fournisseur
 * réel met des centaines de millisecondes. Le retard n'est posé que dans le cas
 * qui mesure, et il est rendu à zéro juste après.
 */
let mailerDelayMillis = 0

const slowMailer: Mailer = {
  send: async (input) => {
    if (mailerDelayMillis > 0) {
      await new Promise((accept) => setTimeout(accept, mailerDelayMillis))
    }

    return await mailer.send(input)
  },
}

/**
 * Les envois différés, retenus ici pour être attendus.
 *
 * En production, `runInBackground` rend la main immédiatement : c'est ce qui
 * ferme le canal temporel de `/request-password-reset`. La suite a malgré tout
 * besoin de savoir *quand* l'email est parti — d'où ce collecteur, et
 * `settled()` là où l'email doit avoir atterri.
 */
const backgroundTasks: Promise<unknown>[] = []

const settled = async (): Promise<void> => {
  await Promise.all(backgroundTasks.splice(0))
}

/** La configuration de la suite, écrite une fois : quatre cas la remontent. */
const configureService = (overrides: Partial<ConfigureAuthOptions> = {}): AuthService =>
  configureAuth({
    db: connection.db,
    mailer: slowMailer,
    secret: TEST_SECRET,
    appUrl: APP_URL,
    log: (record) => logs.push(record),
    runInBackground: (task) => backgroundTasks.push(task),
    ...overrides,
  })

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

/**
 * La **doublure de réseau** des parcours OAuth (s12).
 *
 * Elle remplace le réseau, **jamais le SDK** (`AGENTS.md`) : le vrai
 * fournisseur GitHub de la bibliothèque construit son URL d'autorisation,
 * échange son code et lit son profil — seuls les trois points de terminaison de
 * `github.com` répondent ici. Tout ce qu'elle ne sert pas reste **refusé**,
 * donc un appel sortant que personne n'a demandé échoue toujours.
 *
 * `null` par défaut : les parcours qui ne parlent pas à un fournisseur gardent
 * la garde d'origine, mot pour mot.
 */
let providerNetwork: ((url: string) => Response | Promise<Response> | null) | null = null

beforeAll(async () => {
  globalThis.fetch = ((input: unknown) => {
    const url = String(input)

    outboundCalls.push(url)

    const served = providerNetwork?.(url) ?? null

    return served === null
      ? Promise.reject(new Error('appel réseau sortant interdit dans cette suite'))
      : Promise.resolve(served)
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
  service = configureService()
})

afterAll(async () => {
  globalThis.fetch = realFetch
  resetAuthService()

  if (databaseReachable) {
    // Les comptes de la suite, et eux seuls : sessions, identifiants et jetons
    // suivent par cascade.
    await connection.db.execute(sql`delete from auth_user where email like 's07-%'`)
    await connection.db.execute(sql`delete from auth_user where email like 's12-%'`)
    await connection.db.execute(sql`delete from auth_verification where value like '%s07-%'`)
    await connection.db.execute(sql`delete from auth_verification where value like '%s12-%'`)
    await connection.close()
  }
})

beforeEach(() => {
  mailer?.reset()
  logs = []
  outboundCalls.length = 0
  backgroundTasks.length = 0
  mailerDelayMillis = 0
  providerNetwork = null
})

const anEmail = (): string => `s07-${randomUUID()}@example.test`

/** La médiane d'une série de mesures : une valeur aberrante ne la déplace pas. */
const median = (values: readonly number[]): number =>
  [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)] ?? 0

interface CallOptions {
  readonly method?: string
  readonly body?: unknown
  readonly cookie?: string
  /** Employé par le seul cas qui présente un jeton nu — voir `bearer`. */
  readonly authorization?: string
}

/** Une requête telle que l'application la sert : par le répartiteur du registre. */
const call = async (path: string, options: CallOptions = {}): Promise<Response> => {
  const headers = new Headers({ 'content-type': 'application/json', origin: APP_URL })

  if (options.cookie !== undefined) {
    headers.set('cookie', options.cookie)
  }

  if (options.authorization !== undefined) {
    headers.set('authorization', options.authorization)
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
      plugins: [
        magicLink({ sendMagicLink: () => Promise.resolve() }),
        // s13 : le greffon ajoute une table **et** une colonne à `auth_user`.
        // Le nom de modèle est celui que le module monte — la bibliothèque
        // lit `schema.twoFactor.modelName`, jamais l'option `twoFactorTable`,
        // qui ne renommerait que la déclaration et laisserait ses trois
        // lectures sur `"twoFactor"` (mesuré dans 1.7.2).
        twoFactor({ schema: { twoFactor: AUTH_MODELS.twoFactor } }),
      ],
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
    await settled()

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
      service = configureService()
    }
  }, 30_000)
})

describe.skipIf(!databaseReachable)('parcours d’inscription et de vérification', () => {
  it('crée le compte, envoie la vérification, et refuse la connexion tant qu’elle n’a pas eu lieu', async () => {
    const email = anEmail()

    expect((await call('/sign-up/email', { body: { email, password: PASSWORD } })).status).toBe(200)
    expect(mailer.sent.map((sent) => sent.template)).toEqual(['auth.verify-email'])

    const refused = await signIn(email)

    // 401 comme un compte inconnu : le refus ne dit pas que l'adresse existe
    // mais n'est pas vérifiée. Ce qui le prouve est l'absence de session.
    expect(refused.status).toBe(401)
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
    expect((await signIn(email)).status).toBe(401)
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
    await settled()

    const firstLink = lastLink('reset-password')

    await call('/request-password-reset', { body: { email } })
    await settled()

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
    expect((await call('/revoke-session', { body: { sessionId: 'peu-importe' } })).status).toBe(401)
    expect((await call('/change-name', { body: { name: 'Peu importe' } })).status).toBe(401)
  })

  it('n’authentifie rien avec le jeton que la bibliothèque laisse dans le corps de la connexion', async () => {
    const { email } = await aVerifiedAccount()
    const opened = await signIn(email)
    const payload = (await opened.json()) as { readonly token?: unknown }

    // Le corps de `/sign-in/email` porte encore le jeton de session
    // (`api/routes/sign-in.mjs`), et la route le relaie — contrairement aux
    // cinq routes du second facteur, qui réécrivent le leur. La revue s13 (C4)
    // le laisse **mineur** parce que rien, dans ce montage, n'accepte un jeton
    // nu : le cookie de session est signé, et le greffon `bearer` n'est pas
    // monté. C'était écrit en gras dans l'`AGENTS.md` du module, et **aucune
    // commande ne le vérifiait**. Celle-ci le fait : monter `bearer` — ou
    // livrer des jetons d'API — rend ce cas rouge, et c'est précisément le
    // moment où il faut réécrire la réponse de `/sign-in/email`.
    expect(typeof payload.token).toBe('string')

    const bearer = `Bearer ${String(payload.token)}`

    expect((await call('/change-name', { body: { name: 'Peu importe' }, authorization: bearer })).status).toBe(401)
    expect(
      await service.resolveSession(new Request(APP_URL, { headers: { authorization: bearer } })),
    ).toBeNull()
  }, 20_000)

  it('liste les sessions du compte, la courante en tête, sans jamais rendre de jeton', async () => {
    const { email, userId } = await aVerifiedAccount()

    await signIn(email)

    const current = sessionCookie(await signIn(email))
    const currentSessionId = await service.resolveSessionId(
      new Request(APP_URL, { headers: { cookie: current?.value ?? '' } }),
    )

    const listed = await service.useCases.listSessions({ userId, currentSessionId })

    expect(listed).toHaveLength(2)
    expect(listed[0]?.id).toBe(currentSessionId)
    expect(listed.filter((session) => session.current)).toHaveLength(1)

    // Le jeton de session est ce que le cookie porte : le rendre à un écran
    // reviendrait à écrire dans le HTML de quoi rejouer la session.
    const [token] = await connection.db
      .select({ token: authSchema.authSession.token })
      .from(authSchema.authSession)
      .where(sql`user_id = ${userId}`)

    expect(token?.token).toBeTruthy()
    expect(JSON.stringify(listed)).not.toContain(token?.token ?? 'jeton-introuvable')
  }, 30_000)

  it('révoque une session individuellement, et le serveur la refuse ensuite', async () => {
    const { email, userId } = await aVerifiedAccount()
    const other = sessionCookie(await signIn(email))
    const current = sessionCookie(await signIn(email))

    const otherSessionId = await service.resolveSessionId(
      new Request(APP_URL, { headers: { cookie: other?.value ?? '' } }),
    )

    const response = await call('/revoke-session', {
      body: { sessionId: otherSessionId },
      cookie: current?.value,
    })

    expect(response.status).toBe(200)

    // Côté serveur, pas dans une liste : la ligne n'existe plus.
    expect(
      (await call('/sign-out', { method: 'POST', body: {}, cookie: other?.value })).status,
    ).toBe(401)

    // Et la session qui a demandé la révocation, elle, survit : révoquer une
    // session ne doit pas déconnecter tout le compte.
    const [remaining] = await connection.db
      .select({ count: sql<number>`count(*)::int` })
      .from(authSchema.authSession)
      .where(sql`user_id = ${userId}`)

    expect(Number(remaining?.count ?? -1)).toBe(1)
  }, 30_000)

  it('refuse de révoquer la session d’un autre compte — 404, et rien n’est supprimé', async () => {
    // `docs/security.md` §3 : la ressource d'autrui répond **404**, jamais 403.
    // Un 403 confirmerait que cet identifiant de session existe.
    const victim = await aVerifiedAccount()
    const attacker = await aVerifiedAccount()

    const victimCookie = sessionCookie(await signIn(victim.email))
    const attackerCookie = sessionCookie(await signIn(attacker.email))

    const victimSessionId = await service.resolveSessionId(
      new Request(APP_URL, { headers: { cookie: victimCookie?.value ?? '' } }),
    )

    // Le corps porte **aussi** le compte visé : c'est l'écriture qu'un
    // attaquant essaie en premier, et la seule qui distingue « la route ignore
    // ce que le client prétend être » de « le client n'a rien prétendu ».
    // Sans ce champ, remplacer `context.session.userId` par un identifiant reçu
    // du corps laissait la suite entièrement verte — mutation jouée, mesurée.
    const response = await call('/revoke-session', {
      body: { sessionId: victimSessionId, userId: victim.userId },
      cookie: attackerCookie?.value,
    })

    expect(response.status).toBe(404)

    // La session visée est intacte : le refus n'a rien supprimé au passage.
    const [remaining] = await connection.db
      .select({ count: sql<number>`count(*)::int` })
      .from(authSchema.authSession)
      .where(sql`user_id = ${victim.userId}`)

    expect(Number(remaining?.count ?? -1)).toBe(1)
  }, 30_000)

  it('change le nom affiché du compte, et refuse un nom vide sans rien écrire', async () => {
    const { email, userId } = await aVerifiedAccount()
    const cookie = sessionCookie(await signIn(email))

    // Le corps porte un compte que l'appelant n'est pas : la route doit
    // l'ignorer. Le lire ferait échouer ce cas en 404 — c'est ce qui distingue
    // « le compte vient de la session » d'un simple silence.
    expect(
      (
        await call('/change-name', {
          body: { name: '  Olivier  ', userId: 'un-compte-qui-n-est-pas-le-mien' },
          cookie: cookie?.value,
        })
      ).status,
    ).toBe(200)

    const account = await service.useCases.viewAccount(userId)

    expect(account?.name).toBe('Olivier')

    // Un seul témoin de refus : la règle du `domain` est éprouvée chez elle,
    // la route prouve seulement qu'elle l'appelle.
    expect((await call('/change-name', { body: { name: '   ' }, cookie: cookie?.value })).status).toBe(
      400,
    )
    expect((await service.useCases.viewAccount(userId))?.name).toBe('Olivier')
  }, 30_000)

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
    expect((await signIn(email)).status).toBe(401)
  }, 30_000)
})

describe.skipIf(!databaseReachable)('indistinguabilité compte inconnu / mot de passe invalide', () => {
  it('rend la même réponse, au même statut, pour les trois états de compte', async () => {
    // Trois états, un seul refus. Le troisième est celui que la bibliothèque
    // distinguait : mesuré à travers le répartiteur, un compte **non vérifié**
    // répondait `403 EMAIL_NOT_VERIFIED` là où un compte inconnu répondait
    // `401 INVALID_EMAIL_OR_PASSWORD`. Le mot de passe faux sur ce même compte
    // non vérifié répondait déjà 401 — la bibliothèque ne vérifie l'adresse
    // qu'**après** le mot de passe —, donc la porte n'était ouverte qu'à qui
    // connaissait déjà le mot de passe. Elle est fermée quand même : c'est un
    // oracle de bourrage d'identifiants, et `docs/security.md` §7 n'admet
    // aucune distinction, « ni par message, ni par code de statut ».
    const { email } = await aVerifiedAccount()
    const unverified = anEmail()

    await call('/sign-up/email', { body: { email: unverified, password: PASSWORD } })

    const unknown = await call('/sign-in/email', {
      body: { email: anEmail(), password: PASSWORD },
    })
    const wrongPassword = await call('/sign-in/email', {
      body: { email, password: `${PASSWORD}-faux` },
    })
    const notVerified = await call('/sign-in/email', {
      body: { email: unverified, password: PASSWORD },
    })

    const reference = await unknown.json()

    expect([wrongPassword.status, notVerified.status]).toEqual([unknown.status, unknown.status])
    await expect(wrongPassword.json()).resolves.toEqual(reference)
    await expect(notVerified.json()).resolves.toEqual(reference)

    // Et le refus reste un refus : aucune session n'est ouverte au passage.
    expect(sessionCookie(notVerified)).toBeNull()
  }, 30_000)

  it('répond au mot de passe oublié en un temps que le chronomètre ne distingue pas', async () => {
    // La bibliothèque prend deux chemins sur ce point d'entrée : compte inconnu
    // → un identifiant jeté et une lecture de vérification factice ; compte
    // connu → l'écriture du jeton **puis l'envoi de l'email**. Sans
    // `advanced.backgroundTasks.handler`, `runInBackgroundOrAwait` fait
    // `await promise` (`dist/context/create-context.mjs`) : l'envoi est dans le
    // temps de réponse, et un fournisseur réel y met des centaines de
    // millisecondes. Le retard du mailer est donc posé ici — sans lui, la
    // doublure répond trop vite pour que le cas prouve quoi que ce soit.
    const { email } = await aVerifiedAccount()
    const attempts = 5
    const known: number[] = []
    const unknown: number[] = []

    mailerDelayMillis = 120

    try {
      for (let index = 0; index < attempts; index += 1) {
        const startKnown = performance.now()
        await call('/request-password-reset', { body: { email } })
        known.push(performance.now() - startKnown)

        const startUnknown = performance.now()
        await call('/request-password-reset', { body: { email: anEmail() } })
        unknown.push(performance.now() - startUnknown)
      }
    } finally {
      mailerDelayMillis = 0
      await settled()
    }

    const gap = Math.abs(median(known) - median(unknown))

    // L'écart doit rester très en deçà du coût d'un envoi : si l'email partait
    // encore dans la réponse, il vaudrait le retard entier.
    expect(gap).toBeLessThan(60)
  }, 120_000)

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

  it('journalise aussi la connexion par magic link, avec son acteur', async () => {
    // Lacune antérieure à s12, fermée par le même utilitaire que le parcours
    // OAuth : le lien ouvre une session, et §7 demande que « connexion » soit
    // journalisée quel que soit le moyen.
    const { email, userId } = await aVerifiedAccount()

    await call('/sign-in/magic-link', { body: { email } })

    const link = pathOf(lastLink('magic-link'))

    logs = []
    await call(link)

    expect(logs.find((record) => record.event === 'auth.sign_in_succeeded')?.actor).toBe(userId)

    logs = []
    // Le même lien, consommé : c'est un échec de connexion, et il se voit.
    await call(link)

    expect(logs.find((record) => record.event === 'auth.sign_in_failed')?.actor).toBe('anonymous')
  }, 30_000)

  it('ne journalise ni jeton, ni mot de passe, ni cookie', async () => {
    const { email } = await aVerifiedAccount()

    await call('/sign-in/magic-link', { body: { email } })
    await call('/request-password-reset', { body: { email } })
    await settled()

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
      service = configureService()
    }
  })
})

/* ------------------------------------------------------------------------- *
 * s12 — la connexion par fournisseur externe.
 *
 * Le fournisseur est **GitHub**, et c'est le vrai : sa construction d'URL, son
 * échange de code et sa lecture de profil sont ceux de la bibliothèque. Seuls
 * ses trois points de terminaison réseau sont servis par la doublure — c'est le
 * régime que `AGENTS.md` impose en CI (« doublures pour les appels sortants »),
 * jamais une doublure du SDK.
 *
 * Google n'est pas éprouvé ici, et la raison est mesurée : son `emailVerified`
 * vient d'une claim d'ID token vérifiée contre le JWKS du fournisseur, donc
 * doublable seulement en fabriquant des clés. La **décision** de liaison, elle,
 * ne dépend pas du fournisseur : elle est prise par `handleOAuthUserInfo` et
 * par la configuration que ce module épingle, communs aux deux.
 * ------------------------------------------------------------------------- */

const GITHUB_CREDENTIALS = {
  id: 'github',
  clientId: 's12-client-id',
  clientSecret: 's12-client-secret',
} as const

const anOAuthEmail = (): string => `s12-${randomUUID()}@example.test`

/** Où atterrit un refus : la route de normalisation du module, jamais un code. */
const OAUTH_ERROR_ROUTE = `${AUTH_PREFIX}/oauth-error`

interface GithubIdentity {
  readonly email: string
  readonly emailVerified: boolean
  readonly accountId?: string
}

/**
 * Les trois points de terminaison de GitHub, et rien d'autre.
 *
 * L'identifiant de compte **chez le fournisseur** est tiré au sort à chaque
 * doublure, sauf quand le cas en impose un : c'est lui qui identifie le compte
 * externe, et deux parcours qui le partageraient se retrouveraient sur le même
 * compte local quelle que soit l'adresse — mesuré, et c'est ce qui rendait deux
 * cas de liaison verts pour la mauvaise raison.
 */
const githubNetwork = (identity: GithubIdentity) => {
  const accountId = identity.accountId ?? `s12-account-${randomUUID()}`

  return (url: string): Response | Promise<Response> | null => {
    const json = (body: unknown): Response =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })

    if (url.startsWith('https://github.com/login/oauth/access_token')) {
      return json({ access_token: 's12-access-token', token_type: 'bearer', scope: 'read:user' })
    }

    if (url === 'https://api.github.com/user') {
      return json({
        id: accountId,
        login: 's12-login',
        name: 'Compte de fournisseur',
        email: identity.email,
        avatar_url: 'https://example.test/avatar.png',
      })
    }

    if (url === 'https://api.github.com/user/emails') {
      return json([{ email: identity.email, primary: true, verified: identity.emailVerified }])
    }

    return null
  }
}

/** Les cookies posés par une réponse, dans la forme d'un en-tête `Cookie`. */
const cookiesOf = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((header) => header.split(';')[0]?.trim() ?? '')
    .filter((pair) => pair !== '' && !pair.endsWith('='))
    .join('; ')

interface SocialStart {
  readonly response: Response
  readonly authorizeUrl: URL
  readonly state: string
  readonly cookie: string
}

const startSocial = async (
  body: Record<string, unknown>,
  cookie?: string,
): Promise<SocialStart> => {
  const response = await call('/sign-in/social', { body, cookie })
  const location = response.headers.get('location') ?? ''
  const authorizeUrl = new URL(location === '' ? 'https://absente.test' : location)

  return {
    response,
    authorizeUrl,
    state: authorizeUrl.searchParams.get('state') ?? '',
    cookie: [cookiesOf(response), cookie ?? ''].filter((value) => value !== '').join('; '),
  }
}

describe.skipIf(!databaseReachable)('connexion par un fournisseur externe', () => {
  beforeAll(() => {
    service = configureService({ oauth: { providers: [GITHUB_CREDENTIALS] } })
  })

  afterAll(() => {
    service = configureService()
  })

  /** Le parcours complet : démarrage, aller chez le fournisseur, retour. */
  const signInWith = async (
    identity: GithubIdentity,
    options: { readonly next?: string; readonly cookie?: string } = {},
  ): Promise<{ readonly start: SocialStart; readonly back: Response }> => {
    providerNetwork = githubNetwork(identity)

    const start = await startSocial(
      { provider: 'github', ...(options.next === undefined ? {} : { next: options.next }) },
      options.cookie,
    )
    const back = await call(
      `/callback/github?code=code-${randomUUID()}&state=${encodeURIComponent(start.state)}`,
      { cookie: start.cookie },
    )

    return { start, back }
  }

  const userRow = async (email: string) =>
    await connection.db
      .select({
        id: authSchema.authUser.id,
        emailVerified: authSchema.authUser.emailVerified,
      })
      .from(authSchema.authUser)
      .where(sql`email = ${email}`)

  const accountRows = async (userId: string) =>
    await connection.db
      .select({ providerId: authSchema.authAccount.providerId })
      .from(authSchema.authAccount)
      .where(sql`user_id = ${userId}`)

  it('envoie chez le fournisseur avec un état lié au navigateur, sans jamais l’appeler elle-même', async () => {
    providerNetwork = githubNetwork({ email: anOAuthEmail(), emailVerified: true })

    const start = await startSocial({ provider: 'github' })

    expect(start.response.status).toBe(302)
    expect(start.authorizeUrl.origin).toBe('https://github.com')
    expect(start.state).not.toBe('')
    // PKCE : le défi part chez le fournisseur, le vérificateur reste ici.
    expect(start.authorizeUrl.searchParams.get('code_challenge')).not.toBeNull()
    expect(start.authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256')
    // L'état est **lié au navigateur** par un cookie, et ce cookie doit pouvoir
    // revenir d'un autre site : `SameSite=Lax` (`docs/security.md` §1).
    const stateCookie = start.response.headers
      .getSetCookie()
      .find((header) => header.includes('state='))

    expect(stateCookie?.toLowerCase()).toContain('samesite=lax')
    expect(stateCookie?.toLowerCase()).toContain('httponly')
    expect(stateCookie?.toLowerCase()).toContain('secure')
    // Rien n'est parti sur le réseau : la redirection est construite, pas demandée.
    expect(outboundCalls).toEqual([])
  }, 30_000)

  it('crée le compte avec l’adresse attestée par le fournisseur et ouvre une session', async () => {
    const email = anOAuthEmail()
    const { back } = await signInWith({ email, emailVerified: true })

    expect(back.status).toBe(302)
    expect(sessionCookie(back)).not.toBeNull()

    const [user] = await userRow(email)

    expect(user?.emailVerified).toBe(true)
    expect((await accountRows(user?.id ?? '')).map((row) => row.providerId)).toEqual(['github'])

    // La session est réellement résolue côté serveur, pas seulement posée.
    const resolved = await service.resolveSession(
      new Request(APP_URL, { headers: { cookie: sessionCookie(back)?.value ?? '' } }),
    )

    expect(resolved?.userId).toBe(user?.id)
  }, 30_000)

  it('n’ouvre pas de session au retour du fournisseur quand le compte est protégé', async () => {
    const enrolled = await anAccountWithTwoFactor()
    const { back } = await signInWith({ email: enrolled.email, emailVerified: true })

    // Troisième et dernière voie d'entrée de l'application. Mesurée comme les
    // deux autres : le retour du fournisseur atteste l'adresse, il n'atteste
    // pas le second facteur.
    expect(await openedSession(back)).toBeNull()
    expect(back.status).toBe(302)
    expect(back.headers.get('location')).toContain('/two-factor')

    const verified = await call('/two-factor/verify-totp', {
      body: { code: totpAt(enrolled.totpURI, 1) },
      cookie: cookiesOf(back),
    })

    expect(await openedSession(verified)).not.toBeNull()
  }, 60_000)

  it('reconnaît le même compte de fournisseur au lieu d’en créer un second', async () => {
    const email = anOAuthEmail()
    const identity = { email, emailVerified: true, accountId: `s12-${randomUUID()}` }

    await signInWith(identity)
    await signInWith(identity)

    const users = await userRow(email)

    expect(users).toHaveLength(1)
    expect(await accountRows(users[0]?.id ?? '')).toHaveLength(1)
  }, 30_000)

  it('lie le fournisseur au compte mot de passe **vérifié** qui porte la même adresse', async () => {
    const { email, userId } = await aVerifiedAccount()
    const { back } = await signInWith({ email, emailVerified: true })

    expect(sessionCookie(back)).not.toBeNull()
    expect(await userRow(email)).toHaveLength(1)
    expect((await accountRows(userId)).map((row) => row.providerId).sort()).toEqual([
      'credential',
      'github',
    ])
  }, 30_000)

  it('refuse de lier un compte mot de passe **non vérifié** : c’est la prise de contrôle par pré-enregistrement', async () => {
    const email = anEmail()

    await call('/sign-up/email', { body: { email, password: PASSWORD } })

    const [before] = await userRow(email)
    const { back } = await signInWith({ email, emailVerified: true })

    expect(sessionCookie(back)).toBeNull()

    // Le compte de la victime n'a rien reçu : ni fournisseur lié, ni adresse
    // marquée vérifiée par un tiers.
    const [after] = await userRow(email)

    expect(after?.emailVerified).toBe(false)
    expect((await accountRows(before?.id ?? '')).map((row) => row.providerId)).toEqual([
      'credential',
    ])
  }, 30_000)

  it('refuse une identité que le fournisseur n’atteste pas, et ne crée **aucune** ligne', async () => {
    const email = anOAuthEmail()
    const { back } = await signInWith({ email, emailVerified: false })

    expect(sessionCookie(back)).toBeNull()
    // Sans cette garde, la bibliothèque écrit le compte puis refuse la session,
    // et l'adresse d'un tiers reste squattée par une ligne que personne ne
    // contrôle.
    expect(await userRow(email)).toEqual([])
  }, 30_000)

  it('ramène à la connexion avec un refus qui ne dit rien de l’état du compte', async () => {
    const { email } = await aVerifiedAccount()

    providerNetwork = githubNetwork({ email, emailVerified: false })

    const start = await startSocial({ provider: 'github' })
    const refused = await call(
      `/callback/github?code=code-${randomUUID()}&state=${encodeURIComponent(start.state)}`,
      { cookie: start.cookie },
    )
    const errorUrl = new URL(refused.headers.get('location') ?? '', APP_URL)
    const landing = await call(`${errorUrl.pathname.slice(AUTH_PREFIX.length)}${errorUrl.search}`)

    expect(sessionCookie(refused)).toBeNull()
    expect(landing.headers.get('location')).toBe('/sign-in?oauth=failed')

    const denied = await call('/oauth-error?error=access_denied')

    expect(denied.headers.get('location')).toBe('/sign-in?oauth=denied')

    // Aucun code de la bibliothèque n'atteint l'URL du navigateur : ni
    // « account_not_linked », ni « email_not_found ».
    for (const response of [landing, denied]) {
      expect(response.headers.get('location')).not.toContain('account')
      expect(response.headers.get('location')).not.toContain('email')
    }
  }, 30_000)

  it('refuse un retour sans état, avec l’état d’un autre navigateur, ou rejoué', async () => {
    const email = anOAuthEmail()

    providerNetwork = githubNetwork({ email, emailVerified: true })

    const start = await startSocial({ provider: 'github' })
    const code = `code-${randomUUID()}`

    // Sans le cookie d'état : c'est le retour fabriqué par un tiers.
    const forged = await call(
      `/callback/github?code=${code}&state=${encodeURIComponent(start.state)}`,
    )

    expect(sessionCookie(forged)).toBeNull()
    expect(await userRow(email)).toEqual([])

    // Avec le cookie, une fois : la session s'ouvre.
    const first = await call(
      `/callback/github?code=${code}&state=${encodeURIComponent(start.state)}`,
      { cookie: start.cookie },
    )

    expect(sessionCookie(first)).not.toBeNull()

    // Rejoué : l'état a été consommé (`docs/reliability.md` §1).
    const replayed = await call(
      `/callback/github?code=${code}&state=${encodeURIComponent(start.state)}`,
      { cookie: start.cookie },
    )

    expect(sessionCookie(replayed)).toBeNull()
  }, 30_000)

  it('filtre la destination de retour : un paramètre ne pilote pas la redirection', async () => {
    const email = anOAuthEmail()
    const { back } = await signInWith({ email, emailVerified: true }, { next: 'https://evil.test' })
    const destination = back.headers.get('location') ?? ''

    expect(destination).not.toContain('evil.test')
    expect(destination.startsWith('/')).toBe(true)
  }, 30_000)

  it('respecte une destination interne demandée', async () => {
    const email = anOAuthEmail()
    const { back } = await signInWith({ email, emailVerified: true }, { next: '/account' })

    expect(back.headers.get('location')).toContain(encodeURIComponent('/account'))
  }, 30_000)

  it('ne transmet pas le corps du client à la bibliothèque : un `idToken` n’ouvre rien', async () => {
    providerNetwork = githubNetwork({ email: anOAuthEmail(), emailVerified: true })

    const response = await call('/sign-in/social', {
      body: {
        provider: 'github',
        idToken: { token: 'jeton-fabrique' },
        callbackURL: 'https://evil.test',
        errorCallbackURL: 'https://evil.test',
      },
    })

    // La branche `idToken` de la bibliothèque ouvrirait une session sans
    // redirection ; ici le champ n'a pas été transmis, donc le parcours reste
    // celui du navigateur.
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('https://github.com/login/oauth/authorize')
    expect(sessionCookie(response)).toBeNull()
  }, 30_000)

  it('émet un identifiant de session neuf au retour, et remplace le cookie du navigateur', async () => {
    // **Le nom dit exactement ce que le cas tient**, et pas un mot de plus.
    // Il s'appelait « fait tourner l'identifiant de session », ce qui se lit
    // « l'ancien ne vaut plus » — mesuré, c'est faux : après le retour,
    // l'ancienne session résout encore côté serveur.
    //
    // Et elle ne peut pas être révoquée ici : le cookie de session est
    // `SameSite=Strict` (`docs/security.md` §1), donc il **n'est pas envoyé**
    // sur le rappel, qui est une navigation inter-sites — c'est la raison même
    // d'exister du rebond de `/oauth/return`. Le serveur ne connaît donc pas
    // l'ancien identifiant au moment où il en émet un neuf. Ce qui est tenu, et
    // qui est ce que §2 demande d'une élévation de privilège : un identifiant
    // neuf est émis, il porte le **même nom de cookie** — le navigateur
    // remplace l'ancien au lieu d'en garder deux —, et il ouvre bien la session
    // du compte. Révoquer les autres appareils reste un geste explicite, servi
    // par la liste de sessions de s07.
    const { email, userId } = await aVerifiedAccount()
    const existing = sessionCookie(await signIn(email))
    const { back } = await signInWith({ email, emailVerified: true }, { cookie: existing?.value })
    const rotated = sessionCookie(back)

    expect(rotated?.value).not.toBe(existing?.value)
    expect(rotated?.value.split('=')[0]).toBe(existing?.value.split('=')[0])

    const resolved = await service.resolveSession(
      new Request(APP_URL, { headers: { cookie: rotated?.value ?? '' } }),
    )

    expect(resolved?.userId).toBe(userId)
  }, 30_000)

  it('liste les moyens de connexion sans en rendre ni jeton ni empreinte', async () => {
    const { email, userId } = await aVerifiedAccount()

    await signInWith({ email, emailVerified: true })

    const methods = await service.useCases.listSignInMethods(userId)

    expect(methods.map((method) => method.providerId).sort()).toEqual(['credential', 'github'])
    expect(methods.every((method) => method.removable)).toBe(true)

    // Ni le jeton d'accès du fournisseur, ni l'empreinte du mot de passe : ce
    // que le magasin en dit se limite à ce qu'un écran a le droit d'afficher.
    // C'est exactement cette valeur que l'écran de paramètres reçoit.
    const serialized = JSON.stringify(methods).toLowerCase()

    expect(serialized).not.toContain('s12-access-token')
    expect(serialized).not.toContain('password')
    expect(serialized).not.toContain('token')
  }, 30_000)

  it('délie un fournisseur, et refuse de retirer le dernier moyen de connexion', async () => {
    const { email, userId } = await aVerifiedAccount()
    const { back } = await signInWith({ email, emailVerified: true })
    const cookie = sessionCookie(back)?.value
    const linked = await service.useCases.listSignInMethods(userId)
    const github = linked.find((method) => method.providerId === 'github')
    const credential = linked.find((method) => method.providerId === 'credential')

    expect(
      (await call('/unlink-provider', { body: { accountId: github?.id }, cookie })).status,
    ).toBe(200)

    // Il ne reste que le mot de passe : le retirer laisserait un compte sans
    // aucun moyen de se connecter, et aucun parcours de reprise n'existe.
    const last = await call('/unlink-provider', { body: { accountId: credential?.id }, cookie })

    expect(last.status).toBe(400)
    expect(await accountRows(userId)).toHaveLength(1)
    expect((await service.useCases.listSignInMethods(userId))[0]?.removable).toBe(false)
  }, 30_000)

  it('répond 404 sur le moyen de connexion d’un autre compte, jamais 403', async () => {
    const victim = await aVerifiedAccount()
    const attacker = await aVerifiedAccount()
    const [target] = await service.useCases.listSignInMethods(victim.userId)
    const cookie = sessionCookie(await signIn(attacker.email))?.value

    const response = await call('/unlink-provider', { body: { accountId: target?.id }, cookie })

    // 403 confirmerait que cet identifiant existe (`docs/security.md` §3) : la
    // réponse est la même que pour un identifiant inventé.
    expect(response.status).toBe(404)
    expect(await accountRows(victim.userId)).toHaveLength(1)
    expect(
      (await call('/unlink-provider', { body: { accountId: 'invente' }, cookie })).status,
    ).toBe(404)
  }, 30_000)

  it('deux déliements simultanés ne laissent jamais un compte sans moyen de connexion', async () => {
    const { email, userId } = await aVerifiedAccount()

    await signInWith({ email, emailVerified: true })

    const methods = await service.useCases.listSignInMethods(userId)

    // Les deux déliements partent **ensemble**, au plus près de la base : la
    // course se joue entre la lecture et la suppression, et l'ajouter par la
    // route la noierait dans les allers-retours de la résolution de session —
    // mesuré, elle s'y sérialise et le cas reste vert même sans verrou.
    const outcomes = await Promise.all(
      methods.map(
        async (method) =>
          await service.useCases.unlinkSignInMethod({ userId, accountId: method.id }),
      ),
    )

    // Compter puis supprimer — ce que fait la bibliothèque — laisse les deux
    // requêtes voir « il en reste deux » et retirer chacune la sienne.
    expect([...outcomes].sort()).toEqual(['last-method', 'unlinked'])
    expect(await accountRows(userId)).toHaveLength(1)
  }, 30_000)

  it('journalise la connexion par fournisseur, son échec, et le refus du parcours', async () => {
    // `docs/security.md` §7 : « Événements de sécurité journalisés avec leur
    // acteur : connexion, échec de connexion… ». Un moyen de connexion de plus
    // n'est pas une exception — et les tentatives de liaison refusées en série
    // sur l'adresse d'une victime sont exactement l'attaque que l'ADR 023
    // décrit. Sans journal, elles sont invisibles.
    const email = anOAuthEmail()

    logs = []

    const { back } = await signInWith({ email, emailVerified: true })
    const [user] = await userRow(email)
    const succeeded = logs.find((record) => record.event === 'auth.sign_in_succeeded')

    expect(sessionCookie(back)).not.toBeNull()
    expect(succeeded?.actor).toBe(user?.id)
    expect(succeeded?.details.provider).toBe('github')

    // Un retour refusé : l'échec est journalisé **sans acteur**, comme celui du
    // mot de passe — le journal ne nomme pas un compte que le refus ne
    // reconnaît pas.
    logs = []
    await signInWith({ email: anOAuthEmail(), emailVerified: false })

    const failed = logs.find((record) => record.event === 'auth.sign_in_failed')

    expect(failed?.actor).toBe('anonymous')
    expect(failed?.details.provider).toBe('github')

    // Le refus du parcours porte son **propre** nom : compté comme un échec de
    // connexion, il en doublerait chaque occurrence, et le verrouillage
    // progressif de s28 compterait deux fois le même retour.
    logs = []
    await call('/oauth-error?error=access_denied')

    expect(logs.map((record) => record.event)).toEqual(['auth.oauth_refused'])
    expect(logs[0]?.details.class).toBe('denied')

    // Un fournisseur qu'on ne sert pas : refusé au départ, et le refus se voit.
    logs = []
    await call('/sign-in/social', { body: { provider: 'inconnu' } })

    expect(logs.map((record) => record.event)).toEqual(['auth.oauth_refused'])

    // Aucun secret dans tout cela : ni jeton d'accès du fournisseur, ni adresse
    // en clair (`docs/security.md` §5).
    logs = []
    await signInWith({ email, emailVerified: true })

    const journal = JSON.stringify(logs)

    expect(journal).not.toContain('s12-access-token')
    expect(journal).not.toContain(email)
  }, 30_000)

  it('sans fournisseur configuré, aucun parcours ne démarre et aucun rappel n’ouvre de session', async () => {
    // Le rappel d'un fournisseur **configuré**, avec un état inutilisable :
    // c'est la réponse à laquelle le rappel non configuré doit ressembler,
    // sinon l'état de configuration se lit depuis l'extérieur.
    const configured = await call('/callback/github?code=x&state=y')

    service = configureService()

    try {
      // Démarrer est **impossible** : la réponse est celle d'un chemin non
      // déclaré, et elle ne dit pas si le fournisseur existe ou s'il n'est pas
      // configuré.
      const start = await call('/sign-in/social', { body: { provider: 'github' } })
      const undeclared = await call('/sign-in/social/inexistant', { body: {} })

      expect(start.status).toBe(undeclared.status)
      expect(await start.text()).toBe(await undeclared.text())
      expect([...start.headers]).toEqual([...undeclared.headers])

      // Le rappel garde son chemin — `e2e/modules.spec.ts` exige qu'une route
      // publique d'un module activé soit servie — mais il refuse : pas de
      // session, et le refus passe par la normalisation, donc par le message
      // générique.
      const callback = await call('/callback/github?code=x&state=y')

      expect(sessionCookie(callback)).toBeNull()
      expect(callback.headers.get('location')).toContain(OAUTH_ERROR_ROUTE)

      // **Et il refuse exactement comme le rappel configuré refuse un état
      // inutilisable** : même statut, même destination. C'est la propriété qui
      // compte et qui est réellement tenue — *l'état de configuration d'un
      // fournisseur ne se lit pas depuis l'extérieur*. Ce qui reste énumérable,
      // et que la recherche de cette story affirmait fermé à tort, est la liste
      // des identifiants que le code **connaît** : `/callback/github` a un
      // chemin, `/callback/invente` n'en a pas. Information publique dans un
      // boilerplate ; la fermer demanderait de construire les rappels depuis
      // les fournisseurs configurés, ce que le montage du registre ne permet
      // pas aujourd'hui (voir `docs/reviews/s12-oauth-signin.md`).
      expect(callback.status).toBe(configured.status)
      expect(callback.headers.get('location')).toBe(configured.headers.get('location'))

      // Un identifiant de fournisseur inventé, lui, n'a aucun chemin.
      expect((await call('/callback/invente?code=x&state=y')).status).toBe(404)
    } finally {
      service = configureService({ oauth: { providers: [GITHUB_CREDENTIALS] } })
    }
  }, 30_000)

  /* ----------------------------------------------------------------------- *
   * Les appels sortants, bornés (`docs/reliability.md` §3).
   *
   * s12 ouvre les **premiers** appels sortants du module — trois par connexion
   * GitHub — et `@better-fetch/fetch@1.3.1` n'arme aucun délai par défaut
   * (`getTimeout` n'abandonne que si `options.timeout` est fourni, vérifié dans
   * le paquet installé). Un point de terminaison de fournisseur qui **pend**
   * tiendrait donc la requête de rappel ouverte sans borne applicative.
   *
   * Les trois cas ci-dessous sont écrits avec des durées minuscules et un
   * `sleep` injecté : ce qui est mesuré est la **borne** et le **recul**, pas la
   * patience de la suite.
   * ----------------------------------------------------------------------- */
  describe('délais et reprises', () => {
    /** Les attentes réellement demandées entre deux essais. */
    let waited: number[] = []

    /**
     * Le service, avec une politique d'appel sortant serrée.
     *
     * `random: () => 1` fige la dispersion sur sa borne haute : l'attente
     * devient exactement le recul, donc lisible dans une assertion.
     */
    const withOutbound = (): AuthService =>
      configureService({
        oauth: {
          providers: [GITHUB_CREDENTIALS],
          outbound: {
            timeoutMs: 150,
            callbackDeadlineMs: 400,
            maxAttempts: 3,
            baseDelayMs: 20,
            maxDelayMs: 40,
            random: () => 1,
            sleep: async (ms) => {
              waited.push(ms)

              await Promise.resolve()
            },
          },
        },
      })

    beforeEach(() => {
      waited = []
      service = withOutbound()
    })

    afterAll(() => {
      service = configureService({ oauth: { providers: [GITHUB_CREDENTIALS] } })
    })

    it('ne laisse pas un fournisseur muet tenir le rappel ouvert', async () => {
      const email = anOAuthEmail()
      // L'échange de code **pend** : c'est la panne que `betterFetch` ne borne
      // pas. Elle n'est pas simulée par un rejet — un rejet, la bibliothèque
      // sait le traiter ; une promesse qui ne se résout jamais est exactement ce
      // qu'un délai d'attente existe pour couper.
      providerNetwork = (url) =>
        url.startsWith('https://github.com/login/oauth/access_token')
          ? new Promise<Response>(() => {})
          : githubNetwork({ email, emailVerified: true })(url)

      const start = await startSocial({ provider: 'github' })
      const back = await call(
        `/callback/github?code=code-${randomUUID()}&state=${encodeURIComponent(start.state)}`,
        { cookie: start.cookie },
      )

      // La requête rend la main, sans session, et par le refus générique — pas
      // par une exception ni par un 500.
      expect(back.status).toBe(302)
      expect(sessionCookie(back)).toBeNull()
      expect(back.headers.get('location')).toContain(OAUTH_ERROR_ROUTE)
      expect(await userRow(email)).toEqual([])
    }, 20_000)

    it('ne laisse pas une lecture de profil muette tenir le rappel ouvert', async () => {
      const email = anOAuthEmail()
      // Le second appel sortant, celui que `getUserInfo` porte : il est borné
      // par son propre délai, en amont de l'échéance du gestionnaire.
      providerNetwork = (url) =>
        url === 'https://api.github.com/user'
          ? new Promise<Response>(() => {})
          : githubNetwork({ email, emailVerified: true })(url)

      const start = await startSocial({ provider: 'github' })
      const back = await call(
        `/callback/github?code=code-${randomUUID()}&state=${encodeURIComponent(start.state)}`,
        { cookie: start.cookie },
      )

      expect(sessionCookie(back)).toBeNull()
      expect(back.headers.get('location')).toContain(OAUTH_ERROR_ROUTE)
      // Un délai sans reprise ne serait qu'un abandon : les deux essais suivants
      // ont bien eu lieu, après une attente qui recule et qui plafonne.
      expect(waited).toEqual([20, 40])
    }, 20_000)

    it('rejoue une panne passagère du fournisseur, et **pas** son refus', async () => {
      const email = anOAuthEmail()
      let profileCalls = 0

      providerNetwork = (url) => {
        if (url === 'https://api.github.com/user') {
          profileCalls += 1

          return profileCalls === 1
            ? new Response('indisponible', { status: 503 })
            : githubNetwork({ email, emailVerified: true, accountId: 's12-flaky' })(url)
        }

        return githubNetwork({ email, emailVerified: true, accountId: 's12-flaky' })(url)
      }

      const start = await startSocial({ provider: 'github' })
      const back = await call(
        `/callback/github?code=code-${randomUUID()}&state=${encodeURIComponent(start.state)}`,
        { cookie: start.cookie },
      )

      // Un 503 est transitoire : la reprise rattrape la panne, et la connexion
      // aboutit.
      expect(profileCalls).toBe(2)
      expect(waited).toEqual([20])
      expect(sessionCookie(back)).not.toBeNull()

      // Un refus, lui, est **définitif** : rejouer une requête que le
      // fournisseur refuse est un défaut, pas une précaution.
      waited = []
      profileCalls = 0
      providerNetwork = (url) => {
        if (url === 'https://api.github.com/user') {
          profileCalls += 1

          return new Response('non autorisé', { status: 401 })
        }

        return githubNetwork({ email: anOAuthEmail(), emailVerified: true })(url)
      }

      const refusedStart = await startSocial({ provider: 'github' })
      const refused = await call(
        `/callback/github?code=code-${randomUUID()}&state=${encodeURIComponent(refusedStart.state)}`,
        { cookie: refusedStart.cookie },
      )

      expect(profileCalls).toBe(1)
      expect(waited).toEqual([])
      expect(sessionCookie(refused)).toBeNull()
    }, 20_000)
  })
})

/**
 * ## Le second facteur (s13)
 *
 * Les codes sont **calculés ici**, jamais demandés à la bibliothèque : c'est
 * ce qui permet de choisir le compteur, donc d'éprouver les deux bords de la
 * fenêtre de vérification sans toucher à l'horloge du processus.
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

const base32Decode = (input: string): Buffer => {
  let bits = 0
  let value = 0
  const bytes: number[] = []

  for (const character of input.toUpperCase().replace(/=+$/, '')) {
    const index = BASE32_ALPHABET.indexOf(character)

    if (index < 0) {
      throw new Error(`Caractère base32 inattendu : « ${character} »`)
    }

    value = (value << 5) | index
    bits += 5

    if (bits >= 8) {
      bits -= 8
      bytes.push((value >>> bits) & 0xff)
    }
  }

  return Buffer.from(bytes)
}

/** HOTP (RFC 4226) : la primitive dont TOTP n'est que le compteur horaire. */
const hotp = (secret: Buffer, counter: number): string => {
  const block = Buffer.alloc(8)

  block.writeBigUInt64BE(BigInt(counter))

  const digest = createHmac('sha1', secret).update(block).digest()
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f
  const truncated =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff)

  return (truncated % 1_000_000).toString().padStart(6, '0')
}

const TOTP_PERIOD_MS = 30_000

/** Le secret d'une URI `otpauth://` — celui que l'écran d'enrôlement affiche. */
const secretOf = (totpURI: string): Buffer => {
  const secret = new URL(totpURI).searchParams.get('secret')

  if (secret === null) {
    throw new Error('L’URI d’enrôlement ne porte pas de secret.')
  }

  return base32Decode(secret)
}

/**
 * Le code TOTP à `offset` périodes de maintenant.
 *
 * Le serveur recalcule son propre compteur au moment où il vérifie : traverser
 * une frontière de période entre les deux décalerait le résultat d'un cran, et
 * `offset = 1` deviendrait `offset = 2`. `withinStablePeriod` écarte ce cas.
 */
const totpAt = (totpURI: string, offset = 0): string =>
  hotp(secretOf(totpURI), Math.floor(Date.now() / TOTP_PERIOD_MS) + offset)

/**
 * Attend le début d'une période quand la fin est trop proche.
 *
 * Sans cela, le cas des bords de fenêtre serait vert quatre-vingt-dix-neuf
 * fois sur cent — `retries: 0` est délibéré dans ce dépôt, un cas instable n'y
 * garde rien.
 */
const withinStablePeriod = async (): Promise<void> => {
  const remaining = TOTP_PERIOD_MS - (Date.now() % TOTP_PERIOD_MS)

  if (remaining < 3_000) {
    await new Promise((accept) => setTimeout(accept, remaining + 50))
  }
}

/**
 * La session **réellement ouverte** par une réponse — le seul juge qui compte.
 *
 * `sessionCookie` ne suffit pas ici : le crochet du greffon efface le cookie de
 * session en en posant un **vide**, si bien qu'un `getSetCookie()` contient
 * encore `session_token=` après un défi. Lire le nom dirait qu'une session a
 * été ouverte alors qu'elle vient d'être détruite ; `cookiesOf` écarte les
 * couples vidés, et la résolution tranche.
 */
const openedSession = async (response: Response): Promise<string | null> => {
  const cookie = cookiesOf(response)

  return cookie === ''
    ? null
    : await service.resolveSessionId(new Request(APP_URL, { headers: { cookie } }))
}

interface Enrolment {
  readonly email: string
  readonly userId: string
  readonly cookie: string
  readonly totpURI: string
  readonly backupCodes: readonly string[]
}

/** Un compte protégé par un second facteur **confirmé**, et sa session. */
const anAccountWithTwoFactor = async (): Promise<Enrolment> => {
  const account = await aVerifiedAccount()
  const opened = await signIn(account.email)
  const firstCookie = sessionCookie(opened)?.value ?? ''

  const enabled = await call('/two-factor/enable', {
    body: { password: PASSWORD },
    cookie: firstCookie,
  })

  expect(enabled.status).toBe(200)

  const payload = (await enabled.json()) as {
    totpURI: string
    backupCodes: readonly string[]
  }

  await withinStablePeriod()

  const confirmed = await call('/two-factor/verify-totp', {
    body: { code: totpAt(payload.totpURI) },
    cookie: firstCookie,
  })

  expect(confirmed.status).toBe(200)

  return {
    ...account,
    // La confirmation **fait tourner** la session : c'est le nouveau cookie
    // qui vaut, l'ancien vient d'être détruit.
    cookie: sessionCookie(confirmed)?.value ?? '',
    totpURI: payload.totpURI,
    backupCodes: payload.backupCodes,
  }
}

describe.skipIf(!databaseReachable)('second facteur — activation', () => {
  it('refuse l’activation sans le mot de passe courant : une session volée ne suffit pas', async () => {
    const account = await aVerifiedAccount()
    const cookie = sessionCookie(await signIn(account.email))?.value ?? ''

    const withoutPassword = await call('/two-factor/enable', { body: {}, cookie })
    const withWrongPassword = await call('/two-factor/enable', {
      body: { password: `${PASSWORD}-faux` },
      cookie,
    })

    expect(withoutPassword.ok).toBe(false)
    expect(withWrongPassword.ok).toBe(false)

    const [row] = await connection.db
      .select({ id: authSchema.authTwoFactor.id })
      .from(authSchema.authTwoFactor)
      .where(sql`user_id = ${account.userId}`)

    // Le refus n'atteint pas la base : rien n'a été écrit.
    expect(row).toBeUndefined()
  }, 60_000)

  it('rend une URI d’enrôlement et dix codes de secours, sans jamais rendre de jeton de session', async () => {
    const account = await aVerifiedAccount()
    const cookie = sessionCookie(await signIn(account.email))?.value ?? ''

    const enabled = await call('/two-factor/enable', { body: { password: PASSWORD }, cookie })
    const payload = (await enabled.json()) as Record<string, unknown>

    expect(String(payload.totpURI)).toMatch(/^otpauth:\/\/totp\//)
    expect(new URL(String(payload.totpURI)).searchParams.get('digits')).toBe('6')
    expect(new URL(String(payload.totpURI)).searchParams.get('period')).toBe('30')
    expect(payload.backupCodes).toHaveLength(10)

    // La réponse de la bibliothèque porte `token` — le jeton de la session
    // qu'elle vient de poser. Le rendre à un écran, c'est annuler `HttpOnly`
    // (`packages/modules/auth/AGENTS.md`).
    expect(Object.keys(payload).sort()).toEqual(['backupCodes', 'totpURI'])
  }, 60_000)

  it('ne protège la connexion qu’une fois le premier code confirmé', async () => {
    const account = await aVerifiedAccount()
    const cookie = sessionCookie(await signIn(account.email))?.value ?? ''

    await call('/two-factor/enable', { body: { password: PASSWORD }, cookie })

    // Enrôlement commencé, pas confirmé : la connexion se termine après le mot
    // de passe, exactement comme avant.
    expect(await openedSession(await signIn(account.email))).not.toBeNull()
  }, 60_000)

  it('active à la confirmation, et fait tourner l’identifiant de session', async () => {
    const account = await aVerifiedAccount()
    const opened = await signIn(account.email)
    const cookie = sessionCookie(opened)?.value ?? ''
    const before = await service.resolveSessionId(
      new Request(APP_URL, { headers: { cookie } }),
    )

    const enabled = await call('/two-factor/enable', { body: { password: PASSWORD }, cookie })
    const { totpURI } = (await enabled.json()) as { totpURI: string }

    await withinStablePeriod()

    const confirmed = await call('/two-factor/verify-totp', {
      body: { code: totpAt(totpURI) },
      cookie,
    })

    expect(confirmed.status).toBe(200)

    // `docs/security.md` §2 : rotation de l'identifiant de session à
    // l'élévation de privilège. Le cookie change, et l'ancien ne vaut plus.
    const rotated = sessionCookie(confirmed)?.value ?? ''
    const after = await service.resolveSessionId(
      new Request(APP_URL, { headers: { cookie: rotated } }),
    )

    expect(after).not.toBeNull()
    expect(after).not.toBe(before)
    expect(
      await service.resolveSessionId(new Request(APP_URL, { headers: { cookie } })),
    ).toBeNull()

    // Et la connexion demande désormais un second facteur : le mot de passe
    // seul n'ouvre plus rien.
    expect(await openedSession(await signIn(account.email))).toBeNull()
  }, 60_000)

  it('n’écrit ni le secret, ni l’URI, ni le code dans le journal de sécurité', async () => {
    const enrolled = await anAccountWithTwoFactor()
    const serialized = JSON.stringify(logs)

    expect(serialized).not.toContain(new URL(enrolled.totpURI).searchParams.get('secret'))
    expect(serialized).not.toContain('otpauth://')

    for (const code of enrolled.backupCodes) {
      expect(serialized).not.toContain(code)
    }

    expect(logs.map((record) => record.event)).toContain('auth.two_factor_enabled')
  }, 60_000)

  it('ne déclare pas les trois points d’entrée du greffon qu’elle n’offre pas', async () => {
    const enrolled = await anAccountWithTwoFactor()

    // Le greffon en expose sept, le module en déclare cinq. Ces trois-là
    // étaient affirmés « 404 » par l'ADR, par l'`AGENTS.md` du module et par un
    // commentaire — sans qu'aucune commande ne le vérifie (revue s13, C8).
    // `get-totp-uri` est celui qui compte : il rendrait le secret d'un compte
    // **déjà activé**, à volonté, alors que ce secret ne sort qu'une fois.
    for (const path of [
      '/two-factor/get-totp-uri',
      '/two-factor/send-otp',
      '/two-factor/verify-otp',
    ]) {
      const refused = await call(path, {
        body: { password: PASSWORD, code: '000000' },
        cookie: enrolled.cookie,
      })
      const body = await refused.text()

      expect(refused.status, path).toBe(404)
      expect(body, path).not.toContain('otpauth')
      expect(body, path).not.toContain('secret')
    }
  }, 60_000)

  it('ne laisse pas le client décider de l’émetteur affiché dans l’application d’authentification', async () => {
    const account = await aVerifiedAccount()
    const cookie = sessionCookie(await signIn(account.email))?.value ?? ''

    // `enableTwoFactor` lit `issuer` **du corps** et le pose dans l'URI. Le
    // corps est reconstruit par la route : ce que le client envoie n'arrive
    // jamais.
    const enabled = await call('/two-factor/enable', {
      body: { password: PASSWORD, issuer: 'banque-de-la-victime', method: 'otp' },
      cookie,
    })
    const { totpURI } = (await enabled.json()) as { totpURI: string }

    expect(totpURI).not.toContain('banque-de-la-victime')
  }, 60_000)
})

describe.skipIf(!databaseReachable)('second facteur — connexion', () => {
  /** Ouvre un défi : mot de passe bon, aucune session, un cookie de défi. */
  const aChallenge = async (email: string): Promise<string> => {
    const response = await signIn(email)

    expect(response.status).toBe(200)
    expect(await openedSession(response)).toBeNull()

    return cookiesOf(response)
  }

  /** Les sessions **réellement en base** pour ce compte : un refus n'en laisse aucune. */
  const openSessions = async (userId: string): Promise<number> =>
    (
      await connection.db
        .select({ id: authSchema.authSession.id })
        .from(authSchema.authSession)
        .where(sql`user_id = ${userId}`)
    ).length

  /**
   * Oublie le dernier compteur consommé par ce compte.
   *
   * Employé par le **seul** cas qui mesure la fenêtre de la bibliothèque : la
   * garde de rejeu refuse tout compteur déjà passé, si bien que `-1`, `0` et
   * `+1` ne peuvent pas être éprouvés à la suite sur un même compte sans se
   * refuser les uns les autres. Les deux propriétés sont distinctes — la
   * largeur de la fenêtre, et l'unicité d'usage — et chacune a son cas.
   */
  const forgetLastTotpStep = async (userId: string): Promise<void> => {
    await connection.db.execute(
      sql`update auth_two_factor set last_totp_step = null where user_id = ${userId}`,
    )
  }

  it('arrête la connexion après le mot de passe, sans rien dire des facteurs du compte', async () => {
    const enrolled = await anAccountWithTwoFactor()

    logs = []

    const response = await signIn(enrolled.email)
    const payload = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(await openedSession(response)).toBeNull()

    // Le corps de la bibliothèque porte `twoFactorMethods`, qui énumère les
    // facteurs du compte. La réponse est réécrite : un seul champ en sort.
    expect(payload).toEqual({ twoFactor: true })

    // Le journal, lui, garde la distinction : ce n'est **pas** une connexion
    // réussie, aucune session n'existe (`docs/security.md` §7).
    expect(logs.map((record) => record.event)).toEqual(['auth.two_factor_challenged'])
    expect(logs[0]?.actor).toBe(enrolled.userId)
  }, 60_000)

  it('arrête aussi le magic link : une voie sans mot de passe ne saute pas le second facteur', async () => {
    const enrolled = await anAccountWithTwoFactor()

    await call('/sign-in/magic-link', { body: { email: enrolled.email } })

    logs = []

    const link = await call(pathOf(lastLink('magic-link')))

    // **La propriété tenue est celle-ci** : aucune session n'existe sur un
    // compte protégé tant que le second facteur n'a pas été présenté, quelle
    // que soit la voie. Le `matcher` du greffon ne cite que `/sign-in/email` —
    // s'y limiter laissait le bouton voisin de `/sign-in` ignorer la
    // protection que `/account` venait d'activer.
    expect(await openedSession(link)).toBeNull()
    expect(link.status).toBe(302)
    expect(link.headers.get('location')).toContain('/two-factor')
    expect(logs.map((record) => record.event)).toEqual(['auth.two_factor_challenged'])
    expect(logs[0]?.actor).toBe(enrolled.userId)

    // Et la voie n'est pas **fermée**, elle est ramenée au même point que le
    // mot de passe : le défi qu'elle pose est jouable. Le compteur de
    // l'enrôlement est consommé, d'où le pas suivant (garde de rejeu).
    const verified = await call('/two-factor/verify-totp', {
      body: { code: totpAt(enrolled.totpURI, 1) },
      cookie: cookiesOf(link),
    })

    expect(await openedSession(verified)).not.toBeNull()
  }, 90_000)

  it('accepte les trois compteurs de la fenêtre, et refuse les deux qui l’encadrent', async () => {
    const enrolled = await anAccountWithTwoFactor()

    await withinStablePeriod()

    // La fenêtre est **±1 période de trente secondes** :
    // `@better-auth/utils@0.4.2` pose `window = 1` par défaut et
    // `totp/index.mjs` appelle `.verify(code)` sans l'ouvrir. Quatre-vingt-dix
    // secondes d'acceptation, ce que prévoit la RFC 6238 §5.2 pour la dérive
    // d'horloge d'un téléphone.
    for (const offset of [-1, 0, 1]) {
      // Le compteur de l'enrôlement — et celui du tour précédent — est
      // consommé : sans cet oubli, la garde de rejeu refuserait `-1` et `0`,
      // et ce cas mesurerait l'unicité d'usage au lieu de la fenêtre.
      await forgetLastTotpStep(enrolled.userId)

      const cookie = await aChallenge(enrolled.email)
      const verified = await call('/two-factor/verify-totp', {
        body: { code: totpAt(enrolled.totpURI, offset) },
        cookie,
      })

      expect(verified.status, `compteur ${offset}`).toBe(200)
      expect(await openedSession(verified), `compteur ${offset}`).not.toBeNull()
    }

    for (const offset of [-2, 2]) {
      const cookie = await aChallenge(enrolled.email)
      const refused = await call('/two-factor/verify-totp', {
        body: { code: totpAt(enrolled.totpURI, offset) },
        cookie,
      })

      expect(refused.status, `compteur ${offset}`).toBe(401)
      expect(await refused.json(), `compteur ${offset}`).toEqual({ error: 'invalid' })
      expect(await openedSession(refused), `compteur ${offset}`).toBeNull()
    }
  }, 90_000)

  it('ne rejoue pas un défi consommé, et ne rend jamais de jeton de session', async () => {
    const enrolled = await anAccountWithTwoFactor()

    await withinStablePeriod()

    const cookie = await aChallenge(enrolled.email)
    // Le pas suivant celui de l'enrôlement : celui-là est déjà consommé.
    const code = totpAt(enrolled.totpURI, 1)
    const verified = await call('/two-factor/verify-totp', { body: { code }, cookie })

    expect(await verified.json()).toEqual({ status: true })

    // Le même code, le même cookie : le défi a été consommé, il n'existe plus.
    const replayed = await call('/two-factor/verify-totp', { body: { code }, cookie })

    expect(replayed.status).toBe(401)
    expect(await openedSession(replayed)).toBeNull()
  }, 60_000)

  it('refuse un code déjà consommé, même sur un défi neuf', async () => {
    const enrolled = await anAccountWithTwoFactor()

    await withinStablePeriod()

    const code = totpAt(enrolled.totpURI, 1)
    const accepted = await call('/two-factor/verify-totp', {
      body: { code },
      cookie: await aChallenge(enrolled.email),
    })

    expect(await openedSession(accepted)).not.toBeNull()

    const before = await openSessions(enrolled.userId)

    // **Critère 4 de la story** : « un code TOTP erroné ou **rejoué** est
    // refusé ». Le défi consommé, lui, ne se rejoue pas — mais le code restait
    // valable quatre-vingt-dix secondes sur un défi neuf, donc réutilisable par
    // qui l'avait vu une fois.
    const replayed = await call('/two-factor/verify-totp', {
      body: { code },
      cookie: await aChallenge(enrolled.email),
    })

    expect(replayed.status).toBe(401)

    // **Le refus ne ment pas.** Le code présenté est juste : le refuser en
    // disant « ce code n'est pas valide » envoie quelqu'un chercher une
    // compromission là où il n'y en a pas — c'est le cas d'une seconde
    // connexion dans les mêmes trente secondes, ou d'un ré-enrôlement dans la
    // même période (revue s13, C12/C13/C14). La classe est distincte, le
    // **statut** reste celui de tous les refus, et la distinction n'est
    // lisible que par qui a déjà présenté le premier facteur : on n'arrive ici
    // qu'avec un défi ouvert. Un code faux, lui, reste `invalid` — c'est le
    // cas « détruit le défi au sixième essai » qui le mesure.
    expect(await replayed.json()).toEqual({ error: 'used' })
    expect(await openedSession(replayed)).toBeNull()

    // Et le refus ne laisse **rien** derrière lui : la session que la
    // bibliothèque avait créée avant que la garde ne tranche est révoquée.
    expect(await openSessions(enrolled.userId)).toBe(before)

    // **Ce qui a refusé est bien la garde**, et non le code ni le défi :
    // le compteur oublié, le même code sur un troisième défi rouvre une
    // session. Le pas *suivant* n'est pas éprouvé ici — il n'entre dans la
    // fenêtre qu'à la période d'après, et un cas ne dort pas trente secondes.
    await forgetLastTotpStep(enrolled.userId)

    const again = await call('/two-factor/verify-totp', {
      body: { code },
      cookie: await aChallenge(enrolled.email),
    })

    expect(await openedSession(again)).not.toBeNull()
  }, 90_000)

  it('détruit le défi au sixième essai, et le dit à la personne', async () => {
    const enrolled = await anAccountWithTwoFactor()
    const cookie = await aChallenge(enrolled.email)

    // `beginAttempt(5)` de la bibliothèque : les cinq premiers échecs
    // comptent, le sixième trouve le compteur à cinq, **consomme le défi** et
    // expire son cookie. Sans la seconde classe de refus, l'écran répéterait
    // « code invalide » à quelqu'un qui n'a plus rien à valider.
    const classes: string[] = []

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const refused = await call('/two-factor/verify-totp', {
        body: { code: '000000' },
        cookie,
      })

      expect(refused.status).toBe(401)
      classes.push(((await refused.json()) as { error: string }).error)
    }

    expect(classes).toEqual(['invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'restart'])

    // Et le défi est bien mort : un code juste n'y peut plus rien.
    await withinStablePeriod()

    const afterwards = await call('/two-factor/verify-totp', {
      body: { code: totpAt(enrolled.totpURI, 1) },
      cookie,
    })

    expect(await openedSession(afterwards)).toBeNull()
  }, 90_000)

  /**
   * ## Les deux exemptions, éprouvées par leur conséquence
   *
   * La garde vaut désormais sur **tout** chemin qui pose une session, et
   * `infrastructure/two-factor-challenge.ts` n'énumère que les exemptions. Ces
   * deux cas mesurent ce que l'inversion coûterait si l'une manquait : la
   * bibliothèque fait tourner la session d'un compte **déjà authentifié** à
   * deux endroits que le module appelle en direct, et un défi posé là
   * déconnecterait sans raison.
   */
  it('ne pose pas de défi quand la bibliothèque renouvelle une session déjà ouverte', async () => {
    const enrolled = await anAccountWithTwoFactor()

    // `updateAge` vaut un jour : une session fraîche n'est pas renouvelée. La
    // bibliothèque lit `expires_at` pour en décider
    // (`expiresAt - expiresIn + updateAge <= now`), d'où ces cinq jours au lieu
    // de sept — la session a « deux jours ».
    await connection.db.execute(
      sql`update auth_session set expires_at = now() + interval '5 days' where user_id = ${enrolled.userId}`,
    )

    logs = []

    const request = (): Request => new Request(APP_URL, { headers: { cookie: enrolled.cookie } })

    expect(await service.resolveSessionId(request())).not.toBeNull()

    // Le renouvellement a eu lieu ; la session doit avoir **survécu**. Sans
    // l'exemption de `/get-session`, le crochet la détruit ici : la première
    // résolution rend encore un identifiant — le crochet passe après le
    // handler —, et c'est la seconde qui trouve le vide.
    expect(await openSessions(enrolled.userId)).toBe(1)
    expect(await service.resolveSessionId(request())).not.toBeNull()
    expect(logs).toEqual([])
  }, 60_000)

  it('ne pose pas de défi quand le changement de mot de passe fait tourner la session', async () => {
    const enrolled = await anAccountWithTwoFactor()

    logs = []

    const changed = await call('/change-password', {
      body: { currentPassword: PASSWORD, newPassword: `${PASSWORD}-s13` },
      cookie: enrolled.cookie,
    })

    expect(changed.status).toBe(200)

    // La preuve du mot de passe courant vient d'être faite : c'est une rotation,
    // pas une connexion. La session rendue est utilisable tout de suite, et
    // aucun défi n'est journalisé.
    expect(await openedSession(changed)).not.toBeNull()
    expect(await openSessions(enrolled.userId)).toBe(1)
    expect(logs.map((record) => record.event)).not.toContain('auth.two_factor_challenged')
  }, 60_000)
})

describe.skipIf(!databaseReachable)('second facteur — codes de secours', () => {
  const storedCodes = async (userId: string): Promise<string> => {
    const [row] = await connection.db
      .select({ backupCodes: authSchema.authTwoFactor.backupCodes })
      .from(authSchema.authTwoFactor)
      .where(sql`user_id = ${userId}`)

    return row?.backupCodes ?? ''
  }

  const aChallenge = async (email: string): Promise<string> => {
    const response = await signIn(email)

    expect(await openedSession(response)).toBeNull()

    return cookiesOf(response)
  }

  it('ne stocke aucun des dix codes rendus : la base ne porte que des empreintes', async () => {
    const enrolled = await anAccountWithTwoFactor()
    const stored = await storedCodes(enrolled.userId)

    expect(enrolled.backupCodes).toHaveLength(10)

    for (const code of enrolled.backupCodes) {
      expect(stored).not.toContain(code)
    }

    // Et ce qui est stocké est bien une liste d'empreintes, pas une chaîne
    // chiffrée — le défaut de la bibliothèque, réversible avec le secret.
    expect((JSON.parse(stored) as readonly string[]).every((entry) =>
      /^sha256:[0-9a-f]{64}$/.test(entry),
    )).toBe(true)
  }, 60_000)

  it('refuse l’empreinte lue en base, soumise telle quelle : le magasin n’est pas un jeu de codes', async () => {
    const enrolled = await anAccountWithTwoFactor()
    const [digest] = JSON.parse(await storedCodes(enrolled.userId)) as readonly string[]

    // **La question qui décide du hachage**, et que « aucun code en clair dans
    // la colonne » ne pose pas : ce qui est stocké est-il rejouable ? Un vol de
    // base sans `AUTH_SECRET` rendrait sinon dix contournements du second
    // facteur, et l'ADR 028 affirmerait le contraire de ce que le code fait.
    const stolen = await call('/two-factor/verify-backup-code', {
      body: { code: digest },
      cookie: await aChallenge(enrolled.email),
    })

    expect(stolen.status).toBe(401)
    expect(await stolen.json()).toEqual({ error: 'invalid' })
    expect(await openedSession(stolen)).toBeNull()

    // Et le refus n'a **rien consommé** : le code dont c'est l'empreinte vaut
    // toujours. Sans cette moitié, un refus qui brûle le code passerait pour
    // une protection.
    const genuine = await call('/two-factor/verify-backup-code', {
      body: { code: enrolled.backupCodes[0] ?? '' },
      cookie: await aChallenge(enrolled.email),
    })

    expect(await openedSession(genuine)).not.toBeNull()
  }, 90_000)

  it('ouvre une session avec un code, refuse le même ensuite, et laisse les autres intacts', async () => {
    const enrolled = await anAccountWithTwoFactor()
    const [first, second, third] = enrolled.backupCodes as readonly string[]

    const used = await call('/two-factor/verify-backup-code', {
      body: { code: first },
      cookie: await aChallenge(enrolled.email),
    })

    expect(used.status).toBe(200)
    expect(await used.json()).toEqual({ status: true })
    expect(await openedSession(used)).not.toBeNull()

    const replayed = await call('/two-factor/verify-backup-code', {
      body: { code: first },
      cookie: await aChallenge(enrolled.email),
    })

    expect(replayed.status).toBe(401)
    expect(await openedSession(replayed)).toBeNull()

    // **Le cas qui attrape le double hachage.** Après la consommation, la
    // bibliothèque ré-encode les neuf codes restants — qui sont déjà des
    // empreintes. Les hacher une seconde fois les rendrait tous inutilisables,
    // et rien ne le dirait avant ce moment précis.
    for (const code of [second, third]) {
      const later = await call('/two-factor/verify-backup-code', {
        body: { code },
        cookie: await aChallenge(enrolled.email),
      })

      expect(await openedSession(later)).not.toBeNull()
    }
  }, 90_000)

  it('ne laisse passer qu’une seule de deux consommations simultanées du même code', async () => {
    const enrolled = await anAccountWithTwoFactor()

    // **Cinq courses indépendantes, un code chacune**, et pas une seule : la
    // fenêtre est étroite, et un tirage unique laissait la mesure passer trois
    // fois sur quatre alors que le défaut était bien là. Cinq codes différents
    // ne se gênent pas entre eux — chaque course part d'un état propre.
    for (const code of enrolled.backupCodes.slice(0, 5)) {
      // **Deux défis distincts**, et c'est la condition du cas : deux requêtes
      // partageant le même défi seraient départagées par la consommation du
      // compteur de tentatives, bien avant la comparaison-et-échange sur les
      // codes. Elles ne prouveraient donc rien de l'usage unique du code.
      const [firstChallenge, secondChallenge] = await Promise.all([
        aChallenge(enrolled.email),
        aChallenge(enrolled.email),
      ])

      const [left, right] = await Promise.all([
        call('/two-factor/verify-backup-code', { body: { code }, cookie: firstChallenge }),
        call('/two-factor/verify-backup-code', { body: { code }, cookie: secondChallenge }),
      ])

      const opened = (
        await Promise.all([openedSession(left), openedSession(right)])
      ).filter((session) => session !== null)

      expect(opened, `code « ${code} »`).toHaveLength(1)

      // Les deux requêtes ont bien atteint la vérification : la perdante est
      // refusée par la comparaison-et-échange (`CONFLICT`, replié sur la classe
      // `invalid`), pas écartée avant d'avoir joué.
      const loser = [left, right].find((response) => !response.ok)

      expect(loser?.status, `code « ${code} »`).toBe(401)
      expect(await loser?.json(), `code « ${code} »`).toEqual({ error: 'invalid' })
    }
  }, 120_000)

  it('ne journalise pas une activation quand un code est consommé en session', async () => {
    const enrolled = await anAccountWithTwoFactor()

    logs = []

    // La route est **publique** : ce chemin existe, même si l'interface ne
    // l'offre pas. Le journaliser comme une activation ferait mentir le
    // journal sur le seul point qui l'intéresse (revue s13, C9).
    const used = await call('/two-factor/verify-backup-code', {
      body: { code: enrolled.backupCodes[0] ?? '' },
      cookie: enrolled.cookie,
    })

    expect(used.status).toBe(200)
    expect(logs.map((record) => record.event)).toEqual(['auth.two_factor_verified'])
  }, 60_000)

  it('régénère dix codes sur preuve du mot de passe, et invalide les précédents', async () => {
    const enrolled = await anAccountWithTwoFactor()
    const stale = enrolled.backupCodes[0] ?? ''

    const withoutPassword = await call('/two-factor/generate-backup-codes', {
      body: {},
      cookie: enrolled.cookie,
    })

    expect(withoutPassword.ok).toBe(false)

    const regenerated = await call('/two-factor/generate-backup-codes', {
      body: { password: PASSWORD },
      cookie: enrolled.cookie,
    })
    const payload = (await regenerated.json()) as Record<string, unknown>

    expect(Object.keys(payload)).toEqual(['backupCodes'])
    expect(payload.backupCodes).toHaveLength(10)
    expect(payload.backupCodes).not.toEqual(enrolled.backupCodes)

    const stored = await storedCodes(enrolled.userId)

    for (const code of payload.backupCodes as readonly string[]) {
      expect(stored).not.toContain(code)
    }

    // L'ancien jeu ne vaut plus rien.
    const refused = await call('/two-factor/verify-backup-code', {
      body: { code: stale },
      cookie: await aChallenge(enrolled.email),
    })

    expect(await openedSession(refused)).toBeNull()

    // Le nouveau, si.
    const accepted = await call('/two-factor/verify-backup-code', {
      body: { code: (payload.backupCodes as readonly string[])[0] ?? '' },
      cookie: await aChallenge(enrolled.email),
    })

    expect(await openedSession(accepted)).not.toBeNull()
    expect(logs.map((record) => record.event)).toContain(
      'auth.two_factor_backup_codes_regenerated',
    )
  }, 90_000)
})

describe.skipIf(!databaseReachable)('second facteur — désactivation', () => {
  it('exige le mot de passe courant : une session volée ne retire pas le second facteur', async () => {
    const enrolled = await anAccountWithTwoFactor()

    const withoutProof = await call('/two-factor/disable', {
      body: {},
      cookie: enrolled.cookie,
    })
    const withWrongProof = await call('/two-factor/disable', {
      body: { password: `${PASSWORD}-faux` },
      cookie: enrolled.cookie,
    })

    // Le refus est celui du module, uniforme : la bibliothèque distingue
    // « pas de mot de passe » de « mot de passe faux », l'appelant non.
    for (const refused of [withoutProof, withWrongProof]) {
      expect(refused.status).toBe(400)
      expect(await refused.json()).toEqual({
        error: 'invalid_request',
        reason: expect.any(String),
      })
    }

    // Et le journal ne raconte **pas** une désactivation qui n'a pas eu lieu :
    // un événement de sécurité qui ment sur ce qui s'est passé est pire
    // qu'absent (`docs/security.md` §7). C'est ce cas qui rougit si la route
    // laisse passer la réponse de la bibliothèque au lieu de la juger.
    expect(logs.map((record) => record.event)).not.toContain('auth.two_factor_disabled')

    // Rien n'a bougé : la connexion demande toujours un second facteur.
    expect(await openedSession(await signIn(enrolled.email))).toBeNull()
  }, 60_000)

  it('retire le second facteur, ses codes de secours, et fait tourner l’identifiant de session', async () => {
    const enrolled = await anAccountWithTwoFactor()
    const before = await service.resolveSessionId(
      new Request(APP_URL, { headers: { cookie: enrolled.cookie } }),
    )

    const disabled = await call('/two-factor/disable', {
      body: { password: PASSWORD },
      cookie: enrolled.cookie,
    })

    expect(disabled.status).toBe(200)

    // `docs/security.md` §2 : la désactivation est une élévation de privilège
    // comme l'activation, l'identifiant de session change aux deux bouts.
    const after = await openedSession(disabled)

    expect(after).not.toBeNull()
    expect(after).not.toBe(before)
    expect(
      await service.resolveSessionId(
        new Request(APP_URL, { headers: { cookie: enrolled.cookie } }),
      ),
    ).toBeNull()

    // La connexion se termine de nouveau après le mot de passe…
    expect(await openedSession(await signIn(enrolled.email))).not.toBeNull()

    // …et la ligne a disparu, donc les codes de secours avec elle.
    const [row] = await connection.db
      .select({ id: authSchema.authTwoFactor.id })
      .from(authSchema.authTwoFactor)
      .where(sql`user_id = ${enrolled.userId}`)

    expect(row).toBeUndefined()
    expect(logs.map((record) => record.event)).toContain('auth.two_factor_disabled')
  }, 60_000)
})

describe.skipIf(!databaseReachable)('second facteur — aucune énumération', () => {
  it('rend le même refus qu’un compte soit protégé, non protégé ou inexistant', async () => {
    const protectedAccount = await anAccountWithTwoFactor()
    const plainAccount = await aVerifiedAccount()

    const responses = await Promise.all([
      call('/sign-in/email', {
        body: { email: protectedAccount.email, password: `${PASSWORD}-faux` },
      }),
      call('/sign-in/email', {
        body: { email: plainAccount.email, password: `${PASSWORD}-faux` },
      }),
      call('/sign-in/email', { body: { email: anEmail(), password: PASSWORD } }),
    ])

    const observed = await Promise.all(
      responses.map(async (response) => ({
        status: response.status,
        body: await response.text(),
        session: await openedSession(response),
      })),
    )

    // Trois états de compte, une seule réponse. La présence d'un second
    // facteur ne se lit **pas** avant que le premier ne soit prouvé
    // (`docs/security.md` §7).
    expect(observed[1]).toEqual(observed[0])
    expect(observed[2]).toEqual(observed[0])
    expect(observed[0]?.session).toBeNull()
  }, 90_000)
})
