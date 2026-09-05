import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Env } from '@repo/config'
import {
  buildRegistry,
  defineModule,
  exportModules,
  purgeModules,
  unflattenMessages,
  visibleNavigation,
  type ModuleSession,
} from '@repo/core'
import { createDatabaseClient, planModuleMigrations, runModuleMigrations, type DatabaseConnection } from '@repo/db'
import {
  createNotificationEmitter,
  notificationTemplateId,
  type NotificationEmitter,
  type NotificationTypeDeclaration,
} from '@repo/emails'
import {
  configureNotifications,
  notificationRoutePath,
  notificationsModule,
  resetNotificationsService,
  typeBodyKey,
  typeLabelKey,
  NOTIFICATIONS_KEYS,
  NOTIFICATIONS_SCREEN_PATH,
  type NotificationsService,
  type NotificationsView,
} from '@repo/module-notifications'
import { NotificationsScreen } from '@repo/module-notifications/presentation'
import { authUser } from '@repo/module-auth'
import { MEMBER_JOINED_NOTIFICATION } from '@repo/module-organizations'
import { createTranslator } from 'next-intl'
import type { Mailer, SendEmailInput } from '@repo/ports'
import { sql } from 'drizzle-orm'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createAppMailer } from '../apps/web/lib/mailer'
import { moduleRegistry } from '../apps/web/lib/module-registry'
import {
  notificationCentreOf,
  notifications,
  notificationScopeOf,
  notificationTypeSummaries,
  notificationTypes,
} from '../apps/web/lib/notifications'
import { flatMessagesFor } from '../apps/web/lib/messages'
import { availableModules } from '../config/features'
import { appLocales } from '../config/i18n'
import { databaseUrl, isDatabaseReachable } from './fixtures/database'
import { dispatchAllowingRateLimit } from './fixtures/rate-limit'

/**
 * Le socle de s32 : **le registre de types, et la garantie que rien ne le
 * contourne** (critère 6).
 *
 * La recherche de la story a établi que ce critère risquait d'être **vide à la
 * livraison** : les six templates d'email que le dépôt sait envoyer sont tous
 * rangés par la story dans les « appels directs légitimes », si bien qu'un
 * balayage naïf n'aurait vérifié que les types que s32 vient d'écrire. Le
 * plancher est donc **assertionné**, et la liste des exclus **dérivée** — jamais
 * recopiée.
 *
 * Deux filets, et ils ne se remplacent pas :
 *
 * 1. **le filet exécutable** — le catalogue de rendu du mailer que les modules
 *    reçoivent ne contient **pas** les templates de notification. Un module qui
 *    enverrait `notification.<type>` directement obtient `invalid_request` du
 *    port, à l'exécution, en production comprise ;
 * 2. **le balayage** — aucun appel à `mailer.send` d'un fichier de production,
 *    hors de la fonction d'émission, ne nomme un type déclaré. Ce qu'il voit :
 *    l'expression écrite dans `template:`. Ce qu'il ne voit pas : un
 *    identifiant reconstruit à l'exécution à partir de morceaux.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Le fichier qui porte la fonction d'émission — le seul exclu du balayage. */
const EMISSION_FILE = 'packages/emails/src/notifications.ts'

const SOURCE_ROOTS = ['packages', 'apps', 'config']

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.next', '.turbo', 'migrations'])

/** Les fichiers de **production** du dépôt : ni test, ni artefact régénérable. */
const productionSources = (): readonly string[] => {
  const found: string[] = []

  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)

      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          walk(path)
        }
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        found.push(relative(REPO_ROOT, path))
      }
    }
  }

  for (const root of SOURCE_ROOTS) {
    walk(join(REPO_ROOT, root))
  }

  return found.sort()
}

const SOURCES = productionSources()

const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8')

/** Les fichiers de production qui appellent le port d'envoi. */
const SENDERS = SOURCES.filter((path) => /mailer\.send\(/.test(read(path)))

/**
 * L'expression écrite dans `template:` de chaque appel à `mailer.send({…})`.
 *
 * Le dépôt n'écrit jamais un identifiant de template en littéral simple : les
 * sept appels existants passent par un accent grave et une constante de module
 * (`` `auth.${AUTH_EMAIL_TEMPLATES.verification}` ``). C'est donc l'expression
 * **telle qu'elle est écrite** qui est examinée, pas une valeur résolue.
 */
const templateExpressionsOf = (source: string): readonly string[] =>
  [...source.matchAll(/mailer\.send\(\{([\s\S]*?)\n\s*\}\)/g)].flatMap((call) => {
    const found = /^\s*template:\s*(.+?),\s*$/m.exec(call[1] ?? '')

    return found === null ? [] : [found[1] ?? '']
  })

/**
 * Reconnaît un envoi de **type de notification**, quelle que soit son écriture.
 *
 * Les motifs sont **dérivés** du registre et de la fonction qui qualifie les
 * identifiants : ajouter un type le fait entrer dans le détecteur sans que
 * personne y pense.
 */
const namesANotificationType = (expression: string): boolean =>
  expression.includes('notificationTemplateId') ||
  expression.includes('NOTIFICATION_TEMPLATE_NAMESPACE') ||
  notificationTypes.ids.some((id) => expression.includes(id))

/**
 * Les données qu'attend le template d'un type, **dérivées de son texte livré**.
 *
 * L'interpolation lève sur une donnée absente. Un jeu recopié à la main ferait
 * échouer l'envoi de contrôle du filet ci-dessous dès qu'un type gagne un
 * marqueur, et cet échec-là se confondrait avec le refus qu'il doit distinguer.
 */
const emailDataFor = (
  type: NotificationTypeDeclaration | null,
  locale: string,
): Record<string, string> => {
  const content = type?.email?.locales[locale]
  const found: Record<string, string> = {}

  for (const text of [content?.subject ?? '', content?.body ?? '']) {
    for (const marker of text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) {
      found[marker[1] ?? ''] = 'valeur-de-test'
    }
  }

  return found
}

/** Les templates que les modules déclarent, qualifiés — la liste des exclus, dérivée. */
const MODULE_TEMPLATE_IDS = availableModules.flatMap((module) =>
  module.emails.map((template) => `${module.id}.${template.id}`),
)

describe('le registre de types de notification, à l’échelle du dépôt (s32)', () => {
  it('déclare au moins un type : un registre vide ne vérifierait rien', () => {
    // Le plancher de la story. Le refus d'un registre vide est prouvé à la
    // règle (`packages/emails/src/notification-emission.test.ts`) ; ici, c'est
    // la configuration **livrée** qui est mesurée.
    expect(notificationTypes.ids.length).toBeGreaterThanOrEqual(1)
  })

  it('déclare le type que le module `organizations` produit', () => {
    // **Le lien exécutable entre un producteur et le catalogue du socle** (s32).
    //
    // `organizations` nomme l'événement qu'il possède
    // (`MEMBER_JOINED_NOTIFICATION`) sans pouvoir lire `config/notifications.ts`
    // — il en dépendrait. Un type retiré ou renommé rendrait `unknown_type` à
    // l'émission : le produit cesserait d'avertir, sans erreur et sans signal.
    expect(notificationTypes.ids).toContain(MEMBER_JOINED_NOTIFICATION)
  })

  it('n’emprunte l’identifiant d’aucun template de module', () => {
    // Six templates de module mesurés à l'écriture de la story (auth 3,
    // marketing 2, organizations 1) ; le plancher dit ce qui a été balayé, il
    // n'énumère pas ce qui existe.
    expect(MODULE_TEMPLATE_IDS.length).toBeGreaterThanOrEqual(6)

    const qualified = notificationTypes.emails.map((entry) =>
      notificationTemplateId(entry.template.id),
    )

    expect(qualified.length).toBeGreaterThanOrEqual(1)

    for (const id of qualified) {
      expect(MODULE_TEMPLATE_IDS).not.toContain(id)
    }
  })
})

describe('critère 6 — aucun type déclaré n’appelle le mailer directement', () => {
  it('balaie les fichiers de production qui appellent le mailer, et ils sont plusieurs', () => {
    // Sans ce plancher, tout ce bloc serait vert sur zéro fichier. Trois
    // fichiers de module appelaient le mailer à l'ouverture de la story, plus
    // la fonction d'émission écrite ici.
    expect(SENDERS.length).toBeGreaterThanOrEqual(4)
    expect(SENDERS).toContain(EMISSION_FILE)
  })

  it('lit réellement l’expression `template:` de chaque appel', () => {
    const expressions = SENDERS.flatMap((path) => templateExpressionsOf(read(path)))

    // Sept appels mesurés dans les modules, plus celui de l'émission : un
    // balayage qui n'extrairait rien passerait le cas suivant sans rien lire.
    expect(expressions.length).toBeGreaterThanOrEqual(8)
  })

  it('reconnaît un envoi de type de notification là où il existe', () => {
    // **L'anti-vacuité du détecteur.** Si celui-ci ne voyait plus rien, le cas
    // suivant serait vert quoi qu'on écrive dans les modules.
    const emission = templateExpressionsOf(read(EMISSION_FILE))

    expect(emission.length).toBeGreaterThanOrEqual(1)
    expect(emission.every(namesANotificationType)).toBe(true)
  })

  it('ne trouve aucun type déclaré envoyé hors de la fonction d’émission', () => {
    for (const path of SENDERS.filter((candidate) => candidate !== EMISSION_FILE)) {
      for (const expression of templateExpressionsOf(read(path))) {
        expect(
          namesANotificationType(expression),
          `${path} envoie un type de notification directement : ${expression}`,
        ).toBe(false)
      }
    }
  })

  it('refuse à l’exécution un template de notification envoyé par le mailer des modules', async () => {
    // **Le filet qui n'est pas syntaxique — et il est posé au point de
    // composition, pas sur une copie.**
    //
    // Ce que les modules reçoivent est `createAppMailer()` : c'est lui, et son
    // catalogue **par défaut**, qui décide. La première écriture de ce cas
    // construisait elle-même un `createEmailRenderer(moduleRegistry.emails)` :
    // élargir le catalogue par défaut du mailer — la régression exacte que le
    // filet prétend empêcher — la laissait verte (revue s32, F1). Le catalogue
    // n'est donc plus jamais construit ici ; il est **lu** là où l'application
    // le construit.
    const type = notificationTypes.types.find((candidate) => candidate.email !== null)
    const locale = appLocales[0] ?? ''

    // Sans type portant un email, tout ce cas serait vert sans rien envoyer.
    expect(type).toBeDefined()

    const send = {
      to: 'destinataire@example.test',
      template: notificationTemplateId(type?.id ?? ''),
      locale,
      // Les données sont **dérivées** du template livré : un type qui gagne un
      // marqueur entre ici sans que personne y pense, et l'envoi de contrôle
      // ci-dessous ne peut pas échouer pour une donnée manquante — ce qui
      // ferait passer une interpolation fautive pour un refus de catalogue.
      data: emailDataFor(type ?? null, locale),
    }

    const directory = await mkdtemp(join(tmpdir(), 'notifications-mailer-'))
    const env = {
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/app',
      EMAIL_LOCAL_CAPTURE: '1',
    } as Env

    // Le mailer **des modules** : celui que `lib/mailer.ts` monte quand
    // personne ne lui passe de catalogue.
    const refused = await createAppMailer({ env, captureDirectory: directory }).send(send)

    expect(refused.ok).toBe(false)
    expect(refused.ok ? null : refused.error.code).toBe('invalid_request')

    // **L'anti-vacuité.** Le même mailer, avec le catalogue élargi de
    // l'émission, accepte le même envoi : le refus ci-dessus vient bien du
    // catalogue, et pas d'un mailer qui refuserait tout.
    const accepted = await createAppMailer({
      env,
      captureDirectory: directory,
      emails: [...moduleRegistry.emails, ...notificationTypes.emails],
    }).send(send)

    expect(accepted.ok).toBe(true)
  })
})

/* ------------------------------------------------------------------------- *
 * Le module, contre une **vraie base** et à travers le **répartiteur** — le
 * même chemin qu'une requête de l'application.
 *
 * Le registre est construit par le test, jamais lu dans `config/features.ts` :
 * les assertions portent sur la modularité, pas sur l'état dans lequel le dépôt
 * se trouve, et ce fichier reste vert sous `pnpm test:minimal-profile` comme
 * sous `pnpm test:socle`.
 * ------------------------------------------------------------------------- */

const databaseReachable = await isDatabaseReachable()

const APP_URL = 'http://localhost:3000'

/**
 * Le **requis**, tenu par une doublure de contrat.
 *
 * `notifications` déclare `requires: ['auth']`, donc aucun registre ne peut
 * l'activer sans lui. Le vrai module `auth` demanderait un mailer, un secret et
 * une URL publique — tout ce que cette suite n'a pas à monter pour parler de
 * notifications. Ce qui est doublé est un **contrat**, pas une règle.
 */
const authStandIn = defineModule({
  id: 'auth',
  requires: [],
  schema: {},
  migrations: null,
  routes: [],
  navigation: [],
  publicUrls: () => [],
  messages: { fr: {}, en: {} },
  emails: [],
  webhooks: [],
  jobs: [],
  dataCategories: [],
  retention: {},
  purge: async () => {},
  export: async () => ({}),
})

const registry = buildRegistry({
  available: [authStandIn, notificationsModule],
  enabled: ['auth', 'notifications'],
  locales: [...appLocales],
})

/** La même configuration, **sans** le module — le critère 7. */
const withoutNotifications = buildRegistry({
  available: [authStandIn, notificationsModule],
  enabled: ['auth'],
  locales: [...appLocales],
})

const EMAIL_TYPE = 'organization.member-joined'

let connection: DatabaseConnection
let service: NotificationsService
let sent: SendEmailInput[] = []
let organizationsOf: (userId: string) => readonly string[] = () => []

/**
 * L'annuaire des noms affichables, tel que le point de composition le donne au
 * module (revue s32, R1).
 *
 * Ce qui est doublé est **l'annuaire**, pas la règle : la résolution est prouvée
 * pure dans `packages/modules/notifications/src/domain/notification-rules.test.ts`.
 * Ici, on décide simplement qui existe encore — et un compte absent de cette
 * table est un compte effacé.
 */
let displayNames = new Map<string, string>()

const mailer: Mailer = {
  send: async (input) => {
    sent.push(input)

    return { ok: true, id: `msg_${sent.length}` }
  },
}

/** L'émission, telle que le point de composition la monte, pour un registre donné. */
const emitterFor = (target: typeof registry): NotificationEmitter =>
  createNotificationEmitter({
    types: notificationTypes,
    mailer,
    centre: notificationCentreOf(target),
  })

const anAccount = (): ModuleSession => ({
  userId: `usr_s32_${Math.random().toString(36).slice(2, 10)}`,
  roles: [],
})

interface CallOptions {
  readonly session?: ModuleSession | null
  readonly body?: Record<string, unknown>
  readonly query?: Record<string, string>
}

/** Une requête telle que l'application la sert : par le répartiteur du registre. */
const call = async (
  path: Parameters<typeof notificationRoutePath>[0],
  method: 'GET' | 'POST',
  options: CallOptions = {},
  target = registry,
): Promise<Response> => {
  const url = new URL(`${APP_URL}${notificationRoutePath(path)}`)

  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value)
  }

  const request =
    options.body === undefined
      ? new Request(url, { method })
      : new Request(url, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(options.body),
        })

  return await dispatchAllowingRateLimit(target, request, {
    resolveSession: () => Promise.resolve(options.session ?? null),
  })
}

const listOf = async (
  session: ModuleSession,
  query: Record<string, string> = {},
): Promise<{
  notifications: readonly { id: string; type: string; read: boolean }[]
  unreadCount: number
  page: number
  pageCount: number
}> =>
  (await (await call('list', 'GET', { session, query })).json()) as never

beforeAll(async () => {
  if (!databaseReachable) {
    return
  }

  connection = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 5 })

  await runModuleMigrations({
    db: connection.db,
    plan: planModuleMigrations({ modules: [notificationsModule], repoRoot: REPO_ROOT }),
  })

  service = configureNotifications({
    db: connection.db,
    types: notificationTypeSummaries,
    scopeOf: (userId) =>
      Promise.resolve({ userId, organizationIds: organizationsOf(userId) }),
    displayNamesOf: (userIds) =>
      Promise.resolve(
        new Map(
          userIds.flatMap((userId) => {
            const name = displayNames.get(userId)

            return name === undefined ? [] : [[userId, name] as const]
          }),
        ),
      ),
  })
})

afterAll(async () => {
  resetNotificationsService()

  if (databaseReachable) {
    await connection.db.execute(sql`delete from notification where recipient_id like 'usr_s32_%'`)
    await connection.db.execute(
      sql`delete from notification_preference where user_id like 'usr_s32_%'`,
    )
    await connection.close()
  }
})

describe.skipIf(!databaseReachable)('le centre de notifications, contre la base', () => {
  it('liste les notifications du compte, les plus récentes en premier (critère 1)', async () => {
    const session = anAccount()

    for (const rank of ['1', '2', '3']) {
      await service.useCases.record({
        type: EMAIL_TYPE,
        userId: session.userId,
        organizationId: null,
        channels: ['in_app'],
        defaults: { in_app: true },
        payload: { member: rank, organization: 'Acme' },
      })
    }

    const view = await listOf(session)

    expect(view.notifications).toHaveLength(3)
    expect(view.unreadCount).toBe(3)
    expect(view.page).toBe(1)
    expect(view.pageCount).toBe(1)
  })

  it('pagine, et le badge compte l’ensemble et non la page affichée (critère 2)', async () => {
    const session = anAccount()

    for (let index = 0; index < 21; index += 1) {
      await service.useCases.record({
        type: EMAIL_TYPE,
        userId: session.userId,
        organizationId: null,
        channels: ['in_app'],
        defaults: { in_app: true },
        payload: { member: String(index), organization: 'Acme' },
      })
    }

    const first = await listOf(session)
    const second = await listOf(session, { page: '2' })

    expect(first.notifications).toHaveLength(20)
    expect(second.notifications).toHaveLength(1)
    expect(second.page).toBe(2)
    expect(first.pageCount).toBe(2)
    // Le piège nommé par la recherche : un badge dérivé de la page compterait
    // vingt, pas vingt-et-un.
    expect(first.unreadCount).toBe(21)
  })

  it('refuse une pagination qui n’est pas un nombre (Zod à la frontière)', async () => {
    const session = anAccount()
    const response = await call('list', 'GET', { session, query: { page: 'trois' } })

    expect(response.status).toBe(400)
  })

  it('marque une notification comme lue, et le badge suit (critères 2 et 3)', async () => {
    const session = anAccount()

    await service.useCases.record({
      type: EMAIL_TYPE,
      userId: session.userId,
      organizationId: null,
      channels: ['in_app'],
      defaults: { in_app: true },
      payload: { member: 'Ada', organization: 'Acme' },
    })

    const before = await listOf(session)
    const target = before.notifications[0]?.id ?? ''
    const response = await call('read', 'POST', { session, body: { id: target } })

    expect(response.status).toBe(303)

    const after = await listOf(session)

    expect(after.unreadCount).toBe(0)
    expect(after.notifications[0]?.read).toBe(true)
  })

  it('marque toutes les notifications comme lues (critère 3)', async () => {
    const session = anAccount()

    for (const member of ['Ada', 'Bob']) {
      await service.useCases.record({
        type: EMAIL_TYPE,
        userId: session.userId,
        organizationId: null,
        channels: ['in_app'],
        defaults: { in_app: true },
        payload: { member, organization: 'Acme' },
      })
    }

    expect((await call('readAll', 'POST', { session })).status).toBe(303)
    expect((await listOf(session)).unreadCount).toBe(0)
  })

  it('répond 404, jamais 403, sur la notification d’un autre compte (critère 5)', async () => {
    const owner = anAccount()
    const intruder = anAccount()

    await service.useCases.record({
      type: EMAIL_TYPE,
      userId: owner.userId,
      organizationId: null,
      channels: ['in_app'],
      defaults: { in_app: true },
      payload: { member: 'Ada', organization: 'Acme' },
    })

    const target = (await listOf(owner)).notifications[0]?.id ?? ''
    const response = await call('read', 'POST', { session: intruder, body: { id: target } })

    expect(response.status).toBe(404)
    // Un refus qui aurait quand même écrit n'est pas un refus.
    expect((await listOf(owner)).unreadCount).toBe(1)
  })

  it('cache une notification d’organisation à qui n’en est plus membre (critère 5)', async () => {
    const session = anAccount()

    organizationsOf = (userId) => (userId === session.userId ? ['org_s32'] : [])

    await service.useCases.record({
      type: EMAIL_TYPE,
      userId: session.userId,
      organizationId: 'org_s32',
      channels: ['in_app'],
      defaults: { in_app: true },
      payload: { member: 'Ada', organization: 'Acme' },
    })

    expect((await listOf(session)).notifications).toHaveLength(1)

    // Il quitte l'organisation : la notification n'existe plus pour lui.
    organizationsOf = () => []

    const view = await listOf(session)
    const target = view.notifications[0]?.id

    expect(view.notifications).toHaveLength(0)
    expect(target).toBeUndefined()
  })
})

describe.skipIf(!databaseReachable)('les préférences, respectées à l’émission (critère 4)', () => {
  it('crée l’in-app sans envoyer d’email quand le canal email est coupé', async () => {
    const session = anAccount()

    sent = []

    const outcome = await emitterFor(registry)({
      type: EMAIL_TYPE,
      recipient: { userId: session.userId, email: 'ada@example.test', locale: 'fr' },
      organizationId: null,
      data: { member: 'ada@example.test', organization: 'Acme' },
      stored: { member: 'usr_s32_ada', organization: 'Acme' },
    })

    // Le type livré coupe l'email par défaut : l'in-app existe, l'email non.
    expect(outcome).toEqual({ ok: true, delivered: ['in_app'] })
    expect(sent).toEqual([])
    expect((await listOf(session)).unreadCount).toBe(1)
  })

  it('envoie l’email sans créer d’in-app quand le compte coupe l’in-app et ouvre l’email', async () => {
    const session = anAccount()

    sent = []

    for (const [channel, enabled] of [
      ['in_app', false],
      ['email', true],
    ] as const) {
      const response = await call('setPreference', 'POST', {
        session,
        body: { type: EMAIL_TYPE, channel, enabled },
      })

      expect(response.status).toBe(303)
    }

    const outcome = await emitterFor(registry)({
      type: EMAIL_TYPE,
      recipient: { userId: session.userId, email: 'ada@example.test', locale: 'fr' },
      organizationId: null,
      data: { member: 'ada@example.test', organization: 'Acme' },
      stored: { member: 'usr_s32_ada', organization: 'Acme' },
    })

    expect(outcome).toEqual({ ok: true, delivered: ['email'] })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.template).toBe(notificationTemplateId(EMAIL_TYPE))
    expect((await listOf(session)).unreadCount).toBe(0)
  })

  it('rend les préférences du compte, défauts du catalogue compris', async () => {
    const session = anAccount()
    const view = (await (await call('preferences', 'GET', { session })).json()) as {
      preferences: readonly { type: string; channels: readonly { channel: string; enabled: boolean }[] }[]
    }

    // Dérivé du catalogue livré : un type de plus apparaît sans que ce cas bouge.
    expect(view.preferences.map((entry) => entry.type)).toEqual([...notificationTypes.ids])

    const email = view.preferences
      .find((entry) => entry.type === EMAIL_TYPE)
      ?.channels.find((entry) => entry.channel === 'email')

    expect(email?.enabled).toBe(false)
  })

  it('refuse un type ou un canal que le catalogue ne déclare pas, sans rien écrire', async () => {
    const session = anAccount()

    expect(
      (
        await call('setPreference', 'POST', {
          session,
          body: { type: 'inexistant', channel: 'email', enabled: true },
        })
      ).status,
    ).toBe(404)

    expect(
      (
        await call('setPreference', 'POST', {
          session,
          body: { type: EMAIL_TYPE, channel: 'sms', enabled: true },
        })
      ).status,
    ).toBe(400)
  })
})

describe.skipIf(!databaseReachable)(
  'ce qui est stocké ne nomme personne (revue s32, R1)',
  () => {
    it('écrit une référence, pas une adresse, et l’effacement du compte nommé laisse la ligne lisible', async () => {
      // **Le défaut que ce cas ferme.** La ligne écrite est celle des **autres**
      // membres, et `purge({kind:'user'})` n'efface que ce qui est **adressé**
      // au compte : une adresse écrite dans la charge utile survivrait donc à
      // l'effacement de la personne qu'elle nomme, pendant que le contrat du
      // module promet `retention: { notification: 'erase' }`.
      const reader = anAccount()
      const joiner = anAccount()
      const address = `${joiner.userId}@example.test`

      displayNames = new Map([[joiner.userId, 'Ada Lovelace']])

      await service.useCases.record({
        type: MEMBER_JOINED_NOTIFICATION,
        userId: reader.userId,
        organizationId: null,
        channels: ['in_app'],
        defaults: { in_app: true },
        payload: { member: joiner.userId, organization: 'Acme' },
      })

      // **La ligne réellement écrite**, relue en base : c'est elle qui survit,
      // pas ce que la vue en fait.
      const rows = await connection.db.execute<{ payload: Record<string, unknown> }>(
        sql`select payload from notification where recipient_id = ${reader.userId}`,
      )
      const stored = JSON.stringify(rows.rows[0]?.payload ?? {})

      expect(stored).toContain(joiner.userId)
      expect(stored).not.toContain(address)
      expect(stored).not.toContain('@')

      // Le nom est **résolu à la lecture** tant que le compte existe.
      const before = await service.useCases.view({
        scope: { userId: reader.userId, organizationIds: [] },
        page: 1,
      })

      expect(before.notifications[0]?.payload['member']).toBe('Ada Lovelace')

      // **Le compte nommé disparaît.** Sa purge n'efface que ce qui lui est
      // adressé — la ligne de `reader` n'est pas la sienne et reste là.
      //
      // **Ce que ce cas ne prouve pas**, et il faut le lire : la doublure de
      // contrat `auth` de ce fichier a un `purge` vide, donc `purgeModules`
      // n'efface ici aucun compte. Le `null` vient de l'annuaire de noms vidé
      // à la ligne suivante, pas d'une ligne de `auth_user` disparue. Ce qui
      // est mesuré ici est la moitié qui compte pour R1 — **la ligne des
      // autres survit à la purge du compte nommé, et ne porte pas son
      // adresse** ; la résolution d'un identifiant absent est mesurée à part
      // (« résout un compte par son nom, ignore un compte parti »).
      displayNames = new Map()
      await purgeModules(registry, { kind: 'user', userId: joiner.userId })

      const after = await service.useCases.view({
        scope: { userId: reader.userId, organizationIds: [] },
        page: 1,
      })

      // Celui qui reste garde sa ligne, et elle ne porte pas l'adresse de celui
      // qui est parti. `null` dit « ce compte n'existe plus » ; l'écran y met son
      // libellé, il ne rend ni un identifiant ni une ligne cassée.
      expect(after.notifications).toHaveLength(1)
      expect(after.notifications[0]?.payload['member']).toBeNull()
      expect(JSON.stringify(after.notifications[0]?.payload)).not.toContain('@')
    })
  },
)

/**
 * **Toute requête émise par n'importe quel pool du processus.**
 *
 * Posé sur le prototype de `pg`, seule position qui voie ce qu'ouvre un service
 * construit ailleurs — `appAuth()` a son propre pool, pas celui de la suite.
 */
interface CountedPool {
  query: (...args: unknown[]) => unknown
}

const countingQueriesOn = (
  matching: RegExp,
): { readonly seen: string[]; readonly restore: () => void } => {
  const probe = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 1 })
  const prototype = Object.getPrototypeOf(probe.pool) as CountedPool

  void probe.close()

  const original = prototype.query
  const seen: string[] = []

  prototype.query = function (this: unknown, ...args: unknown[]) {
    const first = args[0] as { text?: string } | string | undefined
    const text = typeof first === 'object' ? (first.text ?? '') : (first ?? '')

    if (matching.test(text)) {
      seen.push(text)
    }

    return original.apply(this, args)
  }

  return { seen, restore: () => (prototype.query = original) }
}

describe.skipIf(!databaseReachable)(
  'le câblage de la résolution, au point de composition (revue s32, ronde 3)',
  () => {
    it('résout un compte par son nom, ignore un compte parti, et lit la base une seule fois', async () => {
      // **Ce cas ferme trois mutations restées vertes sur 2258** (R3-1, R3-3) :
      // rendre `account.email` au lieu de `account.name` — l'adresse de
      // l'arrivant sur l'écran de tous les autres membres, la moitié visible du
      // défaut que R1 ferme —, et déplier la lecture groupée en une requête par
      // identifiant.
      //
      // Rien n'est doublé ici : le compte est écrit en base, et c'est le vrai
      // `appAuth()` qui le relit.
      const present = `usr_s32_wiring_${randomUUID()}`
      const departed = `usr_s32_wiring_${randomUUID()}`
      const address = `s32-wiring-${randomUUID()}@example.test`

      await connection.db
        .insert(authUser)
        .values({ id: present, name: 'Ada Lovelace', email: address })

      // **Le cas déclare l'intégralité de ce que `appAuth()` lit**, il n'en
      // hérite rien (précédent : `tests/admin.test.ts`, « un cas qui n'annonce
      // que sa variable ne passe que sur un poste dont le `.env` complète le
      // reste », revue de s06, G1).
      //
      // Mesuré : sans ces lignes, le cas passait ici et **rougissait sur les
      // deux branches de la matrice de CI**, où le job n'apporte que
      // `DATABASE_URL` — `resolveAuthConfig` levait en nommant `AUTH_SECRET` et
      // `APP_URL` avant la première assertion.
      //
      // `DATABASE_URL` est déclarée comme les autres, à la valeur que la suite
      // utilise déjà : ce résolveur ouvre **son** pool par `getDatabase()`, et
      // il doit lire la base où le compte vient d'être écrit.
      vi.stubEnv('DATABASE_URL', databaseUrl)
      vi.stubEnv('AUTH_SECRET', 'x'.repeat(40))
      vi.stubEnv('APP_URL', APP_URL)
      // Le mailer que `appAuth()` monte : la capture locale, jamais un
      // fournisseur. Sans ce trio, `resolveMailerConfig` refuse le choix
      // ambigu.
      vi.stubEnv('RESEND_API_KEY', '')
      vi.stubEnv('EMAIL_FROM', '')
      vi.stubEnv('EMAIL_LOCAL_CAPTURE', '1')
      // Aucun fournisseur externe : une paire incomplète, héritée d'un poste,
      // arrêterait la construction en nommant la variable absente.
      vi.stubEnv('GOOGLE_CLIENT_ID', '')
      vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
      vi.stubEnv('GITHUB_CLIENT_ID', '')
      vi.stubEnv('GITHUB_CLIENT_SECRET', '')

      // Le graphe est rechargé pour que l'environnement déclaré ci-dessus soit
      // celui que lisent `getEnv()` et le service d'authentification, tous deux
      // mémoïsés à leur première construction.
      vi.resetModules()

      const { displayNamesOf } = await import('../apps/web/lib/notifications')
      const reads = countingQueriesOn(/auth_user/i)

      try {
        const names = await displayNamesOf([present, departed])

        expect(names.get(present)).toBe('Ada Lovelace')

        // **Le compte parti n'a pas d'entrée** : c'est ce que la lecture traduit
        // en `null`, et l'écran en « Compte supprimé ».
        expect(names.has(departed)).toBe(false)

        // **Aucune adresse ne sort du résolveur.** L'assertion porte sur ce que
        // le destinataire verrait, pas sur le nom d'un champ.
        expect([...names.values()].join(' ')).not.toContain('@')

        // **Une lecture groupée pour N identifiants** (R3-3) : le commentaire du
        // module promet un appel, et le point de composition ne doit pas le
        // déplier en vingt requêtes derrière son dos.
        expect(reads.seen).toHaveLength(1)
      } finally {
        reads.restore()
        vi.unstubAllEnvs()
        vi.resetModules()
        await connection.db.execute(sql`delete from auth_user where id = ${present}`)
      }
    })

    it('donne au module l’organisation active, et une liste vide quand il n’y en a pas', () => {
      // **R3-2** : rendre `organizationIds: []` sans condition — ce qui rend
      // invisible à tout le monde chaque notification du seul producteur livré —
      // laissait 2258 cas au vert. Ce que ce cas tient est la **composition de
      // la liste** ; le choix « l'active plutôt que toutes » reste une décision
      // écrite, que rien ne mesure.
      expect(notificationScopeOf('usr-1', 'org-1')).toEqual({
        userId: 'usr-1',
        organizationIds: ['org-1'],
      })

      expect(notificationScopeOf('usr-1', null)).toEqual({
        userId: 'usr-1',
        organizationIds: [],
      })
    })
  },
)

describe.skipIf(!databaseReachable)('la purge et l’export du module', () => {
  it('efface les notifications et les préférences du compte, et le rejeu n’ajoute rien', async () => {
    const session = anAccount()
    const scope = { kind: 'user', userId: session.userId } as const

    await service.useCases.record({
      type: EMAIL_TYPE,
      userId: session.userId,
      organizationId: null,
      channels: ['in_app'],
      defaults: { in_app: true },
      payload: { member: 'Ada', organization: 'Acme' },
    })
    await call('setPreference', 'POST', {
      session,
      body: { type: EMAIL_TYPE, channel: 'email', enabled: true },
    })

    const exported = (await exportModules(registry, scope))['notifications'] as {
      notifications: readonly unknown[]
      preferences: readonly unknown[]
    }

    expect(exported.notifications).toHaveLength(1)
    expect(exported.preferences).toHaveLength(1)

    await purgeModules(registry, scope)
    await purgeModules(registry, scope)

    expect((await listOf(session)).unreadCount).toBe(0)

    const after = (await exportModules(registry, scope))['notifications'] as {
      notifications: readonly unknown[]
      preferences: readonly unknown[]
    }

    expect(after.notifications).toEqual([])
    expect(after.preferences).toEqual([])
  })
})

describe('module `notifications` coupé — les quatre garanties (critère 7)', () => {
  it('déclare pourtant bien des routes, une entrée de navigation et des tables', () => {
    // Sans cette garde, tout ce bloc serait un tour de passe-passe : un module
    // qui ne déclare rien n'expose rien.
    expect(notificationsModule.routes.length).toBeGreaterThanOrEqual(1)
    expect(notificationsModule.navigation.length).toBeGreaterThanOrEqual(1)
    expect(Object.keys(notificationsModule.schema).length).toBeGreaterThanOrEqual(1)
  })

  it('n’expose aucune route : chacune répond 404', async () => {
    for (const route of notificationsModule.routes) {
      const response = await dispatchAllowingRateLimit(
        withoutNotifications,
        new Request(`${APP_URL}/api/modules${route.path}`, { method: route.method }),
      )

      expect(response.status).toBe(404)
    }
  })

  it('n’apparaît dans aucune entrée de navigation', () => {
    const entries = visibleNavigation(withoutNotifications, { userId: 'u-1', roles: [] })

    expect(entries.map((entry) => entry.moduleId)).not.toContain(notificationsModule.id)
    expect(entries.map((entry) => entry.href)).not.toContain(NOTIFICATIONS_SCREEN_PATH)
  })

  it('replie sur l’email les types qui le veulent par défaut, et eux seuls', async () => {
    // **Le repli, contre le vrai registre et sur le catalogue livré.** Le module
    // qui tient les préférences est coupé : le **défaut déclaré** fait donc
    // autorité, et il décide dans les deux sens. Un type qui déclare
    // `email: false` n'envoie rien — couper un module ne doit pas ajouter du
    // trafic sortant que la configuration complète n'aurait jamais émis.
    //
    // Les deux types sont **dérivés** du catalogue, jamais nommés : la règle
    // porte sur le défaut, pas sur l'identifiant du jour.
    const wantsEmail = notificationTypes.types.find((type) => type.defaults.email === true)
    const refusesEmail = notificationTypes.types.find(
      (type) => type.channels.includes('email') && type.defaults.email === false,
    )

    // Sans ces deux planchers, le cas serait vert sur un catalogue qui ne
    // porterait aucun des deux côtés de la règle.
    expect(wantsEmail, 'aucun type déclaré ne veut l’email par défaut').toBeDefined()
    expect(
      refusesEmail,
      'aucun type déclaré ne refuse l’email par défaut : la moitié qui mord ne serait pas mesurée',
    ).toBeDefined()

    const emit = emitterFor(withoutNotifications)
    const recipient = { userId: 'usr_s32_coupe', email: 'ada@example.test', locale: 'fr' }
    const data = { member: 'Ada', organization: 'Acme', summary: 'une connexion inconnue' }

    sent = []

    const delivered = await emit({
      type: wantsEmail?.id ?? '',
      recipient,
      organizationId: null,
      data,
      stored: data,
    })

    expect(delivered).toEqual({ ok: true, delivered: ['email'] })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.template).toBe(notificationTemplateId(wantsEmail?.id ?? ''))

    sent = []

    const withheld = await emit({
      type: refusesEmail?.id ?? '',
      recipient,
      organizationId: null,
      data,
      stored: data,
    })

    // Ce n'est pas une erreur : le type est déclaré, il n'y a simplement rien à
    // livrer quand le seul canal restant est éteint par le catalogue.
    expect(withheld).toEqual({ ok: true, delivered: [] })
    expect(sent).toEqual([])
  })
})

describe('le catalogue de types et les catalogues de traduction (s32)', () => {
  it('livre un libellé et un texte pour chaque type déclaré, dans chaque locale', () => {
    // **La règle exécutable qui relie le socle au module.** Le catalogue de
    // types vit dans `config/notifications.ts` (socle) et le texte affiché dans
    // le module : un type ajouté sans son libellé ferait un écran en 500 —
    // aucune traduction ne se replie sur sa clé (s09) — et rien ne le dirait
    // avant. Les deux listes sont dérivées, aucune n'est recopiée.
    //
    // **L'attente est dérivée de l'état du module**, pas concédée : module
    // coupé, ces clés doivent au contraire avoir **disparu** du catalogue —
    // c'est la moitié « aucune trace » du critère 7, et ce cas la mesure dans
    // les deux configurations plutôt que de se sauter dans l'une.
    expect(notificationTypes.ids.length).toBeGreaterThanOrEqual(1)
    expect(appLocales.length).toBeGreaterThanOrEqual(1)

    for (const locale of appLocales) {
      const catalogue = Object.keys(flatMessagesFor(locale))

      for (const id of notificationTypes.ids) {
        for (const key of [typeLabelKey(id), typeBodyKey(id)]) {
          expect(catalogue.includes(key), `${locale} / ${key}`).toBe(notifications.available)
        }
      }
    }
  })
})

describe('le compteur de non-lues, à une seule non-lue (s32)', () => {
  it('accorde le texte du compteur dans chaque locale servie', () => {
    // **Le défaut relevé en revue (F3)** : « {count} non lues » affichait
    // « 1 non lues ». L'idiome existait déjà dans le dépôt
    // (`apps/web/messages/fr.json`, « {minutes, plural, one {…} other {…}} ») et
    // n'avait pas été employé.
    //
    // Le catalogue est lu sur le **module**, via un registre construit ici : la
    // mesure vaut dans les deux configurations du dépôt, y compris celle qui
    // coupe le module et où ces clés ont disparu du catalogue de l'application.
    expect(appLocales.length).toBeGreaterThanOrEqual(1)

    for (const locale of appLocales) {
      const flat = flatMessagesFor(locale, registry)
      const pattern = flat[NOTIFICATIONS_KEYS.unread]

      // **La forme, dans chaque locale.** Une locale qui n'accorde pas — le
      // français en accorde — lirait « 1 non lues » sans qu'aucun rendu ne s'en
      // plaigne, et une locale ajoutée sans catégorie de pluriel hériterait du
      // silence.
      expect(pattern, locale).toMatch(/\{\s*count\s*,\s*plural\s*,/)

      const t = createTranslator({
        locale,
        messages: unflattenMessages(flat),
      }) as unknown as (key: string, values: Record<string, unknown>) => string

      const one = t(NOTIFICATIONS_KEYS.unread, { count: 1 })
      const many = t(NOTIFICATIONS_KEYS.unread, { count: 2 })

      // Le motif compile et rend bien le compte : un pluriel mal écrit rendrait
      // la clé, ou lèverait, sans que la forme ci-dessus s'en aperçoive.
      expect(one, locale).toContain('1')
      expect(many, locale).toContain('2')

      // **Le témoin d'accord, dans la langue où il se mesure.** Toutes les
      // langues n'accordent pas — l'anglais ne distingue pas ici, et exiger deux
      // branches différentes partout serait faux. Le français, lui, accorde :
      // c'est là que « 1 non lues » se voyait, et c'est là qu'il rougit.
      if (locale === 'fr') {
        expect(one).toBe('1 non lue')
        expect(many).toBe('2 non lues')
      }
    }
  })
})

describe('l’écran du centre — ce qu’il montre et ce qu’il retire', () => {
  /** Un traducteur qui rend la clé : ce cas juge la structure, pas le texte. */
  const intl = { t: (key: string) => key }

  const render = (view: NotificationsView): string =>
    renderToStaticMarkup(
      createElement(NotificationsScreen, {
        view,
        intl,
        actions: { read: '/read', readAll: '/read-all', setPreference: '/set' },
        hrefForPage: (page: number) => `/notifications?page=${page}`,
      }),
    )

  const view = (overrides: Partial<NotificationsView>): NotificationsView => ({
    notifications: [],
    unreadCount: 0,
    page: 1,
    pageCount: 1,
    preferences: [],
    ...overrides,
  })

  it('propose « tout marquer comme lu » seulement quand il reste des non-lues', () => {
    const withUnread = render(
      view({
        unreadCount: 1,
        notifications: [
          {
            id: 'n1',
            type: 'account.security-alert',
            organizationId: null,
            payload: {},
            createdAt: new Date('2026-01-01T00:00:00Z'),
            read: false,
          },
        ],
      }),
    )

    expect(withUnread).toContain('/read-all')
    // Tout est lu : l'action globale disparaît, et l'action de ligne aussi.
    expect(render(view({}))).not.toContain('/read-all')
  })

  it('nomme un compte effacé plutôt que de laisser un trou dans la ligne', () => {
    // **La moitié visible de R1.** La ligne appartient à celui qui reste : elle
    // doit rester lisible quand la personne qu'elle nomme a été effacée. `null`
    // vient de la lecture — l'identifiant n'a pas été résolu —, et l'écran y met
    // son libellé. Retirer ce libellé laissait la suite entière verte (revue
    // s32, ronde 3, R3-1) : la ligne affichait alors « a rejoint Acme », sans
    // sujet.
    // Le traducteur du bloc rend la clé et **ignore les valeurs** : il ne
    // pourrait pas voir ce que l'écran interpole. Celui-ci les rend, ce qui est
    // exactement ce que ce cas mesure — la valeur mise à la place de `null`.
    const interpolating = {
      t: (key: string, values?: Record<string, string | number>) =>
        [key, ...Object.values(values ?? {})].join(' '),
    }

    const rowWith = (member: string | null): string =>
      renderToStaticMarkup(
        createElement(NotificationsScreen, {
          intl: interpolating,
          actions: { read: '/read', readAll: '/read-all', setPreference: '/set' },
          hrefForPage: (page: number) => `/notifications?page=${page}`,
          view: view({
          notifications: [
            {
              id: 'n1',
              type: 'organization.member-joined',
              organizationId: 'org-1',
              payload: { member, organization: 'Acme' },
              createdAt: new Date('2026-01-01T00:00:00Z'),
              read: true,
            },
          ],
          }),
        }),
      )

    expect(rowWith(null)).toContain(NOTIFICATIONS_KEYS.deletedActor)

    // Et il n'apparaît pas quand le compte existe : sans cette moitié, un écran
    // qui écrirait le libellé partout serait vert.
    const alive = rowWith('Ada Lovelace')

    expect(alive).toContain('Ada Lovelace')
    expect(alive).not.toContain(NOTIFICATIONS_KEYS.deletedActor)
  })

  it('remplace la liste vide par un état vide **avec sa sortie**', () => {
    const html = render(view({}))

    // Un tableau vide sans action est un écran cassé (`docs/design-system.md`).
    expect(html).toContain('#notification-preferences')
  })

  it('n’affiche aucune pagination quand il n’y a qu’une page', () => {
    // **Ce que ce cas mesure est le garde de l'écran**, pas la sortie du
    // composant. Rendre `Pagination` inconditionnellement le laissait vert
    // (revue s32, F4) : à une seule page le composant n'émet que la page 1,
    // donc « pas de `?page=2` » restait vrai pendant qu'une barre de navigation
    // vide s'affichait. Le témoin est donc le **nom accessible** de cette
    // barre — ce que le composant rend toujours, quel que soit le nombre de
    // pages ; le traducteur de ce bloc rend la clé, donc c'est elle qu'on lit.
    const single = render(view({}))

    expect(single).not.toContain(NOTIFICATIONS_KEYS.paginationLabel)
    expect(single).not.toContain('?page=1')

    const paginated = render(view({ pageCount: 2 }))

    expect(paginated).toContain(NOTIFICATIONS_KEYS.paginationLabel)
    expect(paginated).toContain('?page=2')
  })
})

describe('le câblage du point de composition', () => {
  it('prépare le module **avant** qu’une de ses routes ne soit servie', async () => {
    // **Le défaut que ce cas ferme a été mesuré au navigateur**, et aucune des
    // 2 100 autres assertions ne le voyait : la suite appelle
    // `configureNotifications` elle-même, si bien que le module y est toujours
    // configuré. En production, il ne l'est que si `prepareModuleServices()`
    // l'y met — et sans cette ligne, `POST /api/modules/notifications/read`
    // répond **500** en disant que le module n'est pas configuré. C'est
    // exactement le défaut que `lib/module-services.ts` documente pour les
    // organisations, reproduit à l'identique.
    resetNotificationsService()

    const { prepareModuleServices } = await import('../apps/web/lib/module-services')

    prepareModuleServices()

    const { requireNotificationsService } = await import('@repo/module-notifications')

    // **L'attente est dérivée de l'état du module.** Module coupé, la
    // préparation est un no-op — elle ne doit rien lever — et le service n'est
    // pas configuré : c'est la bonne réponse, pas un défaut.
    if (notifications.available) {
      expect(() => requireNotificationsService()).not.toThrow()
    } else {
      expect(() => requireNotificationsService()).toThrowError(/notifications/)
    }

    // La suite qui précède a rendu la main : on remet le service du test.
    //
    // **Le cas lui-même ne dépend d'aucune base** — c'est le nettoyage qui en
    // a besoin, et rien d'autre. Le garder sous `describe.skipIf` le faisait
    // disparaître en silence sur un exécutant sans Postgres (revue s32), c'est-
    // à-dire là où personne ne le verrait manquer.
    resetNotificationsService()

    if (databaseReachable) {
      service = configureNotifications({
        db: connection.db,
        types: notificationTypeSummaries,
        scopeOf: (userId) =>
          Promise.resolve({ userId, organizationIds: organizationsOf(userId) }),
        displayNamesOf: (userIds) =>
          Promise.resolve(
            new Map(
              userIds.flatMap((userId) => {
                const name = displayNames.get(userId)

                return name === undefined ? [] : [[userId, name] as const]
              }),
            ),
          ),
      })
    }
  })
})
