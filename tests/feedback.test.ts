import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  buildRegistry,
  defineModule,
  MODULE_ROUTE_PREFIX,
  exportModules,
  purgeModules,
  routeIsRateLimited,
  visibleNavigation,
  type ExportModulesOutcome,
  type ModuleSession,
  type RegistryRoute,
} from '@repo/core'
import {
  createDatabaseClient,
  planModuleMigrations,
  runModuleMigrations,
  type DatabaseConnection,
} from '@repo/db'
import { createNotificationEmitter } from '@repo/emails'
import { AdminFeedbackScreen } from '@repo/module-admin/presentation'
import { parseBackOfficeFeedbackQuery } from '@repo/module-admin'
import {
  configureFeedback,
  feedbackModule,
  feedbackNavigation,
  feedbackRoutePath,
  resetFeedbackService,
  ADMIN_FEEDBACK_SCREEN_PATH,
  FEEDBACK_CATEGORIES,
  FEEDBACK_SCREEN_PATH,
  FEEDBACK_STATUSES,
  type FeedbackService,
} from '@repo/module-feedback'
import type { Mailer, SendEmailInput } from '@repo/ports'
import { sql } from 'drizzle-orm'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { notificationTypes } from '../apps/web/lib/notifications'
import { shellNavigation } from '../apps/web/lib/navigation'
import { appLocales } from '../config/i18n'
import { rateLimitPolicies } from '../config/security'
import { databaseUrl, isDatabaseReachable } from './fixtures/database'
import { dispatchAllowingRateLimit } from './fixtures/rate-limit'

/**
 * s43 — **le retour depuis l'application**, et les cinq questions que la story
 * ne peut pas laisser à la revue.
 *
 * 1. la **route est authentifiée**, donc elle n'est limitée que parce qu'elle le
 *    **déclare** : la couverture est dérivée du registre et ne couvre par
 *    défaut que les routes publiques ;
 * 2. l'**URL d'origine est une donnée du client**, et l'écran d'administration
 *    la rend — elle ne doit jamais devenir un `href` ;
 * 3. la **notification retombe sur l'email** quand le centre n'existe pas, et
 *    c'est le catalogue de types qui le décide, pas ce module ;
 * 4. le **déclencheur est dérivé du registre** : module coupé, il disparaît sans
 *    qu'aucun fichier de la coquille ne nomme un module ;
 * 5. **module coupé, aucune route de retour n'existe**, et la purge comme
 *    l'export du contrat portent réellement sur la table.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_URL = 'http://localhost:3000'

/**
 * Le socle doublé : ce module déclare `auth` et `admin` dans ses requis, et
 * aucun des deux n'est ce que ces cas mesurent. Ce qui est doublé est un
 * **contrat**, pas une règle.
 */
const standIn = (id: string) =>
  defineModule({
    id,
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

const available = [standIn('auth'), standIn('admin'), feedbackModule]

const registry = buildRegistry({
  available,
  enabled: ['auth', 'admin', 'feedback'],
  locales: [...appLocales],
})

/** La même configuration, **sans** le module — le critère 6. */
const withoutFeedback = buildRegistry({
  available,
  enabled: ['auth', 'admin'],
  locales: [...appLocales],
})

const AUTHOR = 'usr_s43_author'
const SUPERADMIN = 'usr_s43_superadmin'
const INTRUDER = 'usr_s43_intruder'

const sessionOf = (userId: string): ModuleSession => ({ userId, roles: [] })

let connection: DatabaseConnection
let databaseReachable = false
let service: FeedbackService
let announced: { feedbackId: string; category: string }[] = []
let authorized = new Set<string>()

beforeAll(async () => {
  databaseReachable = await isDatabaseReachable()

  if (!databaseReachable) {
    return
  }

  connection = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 5 })

  await runModuleMigrations({
    db: connection.db,
    plan: planModuleMigrations({ modules: [feedbackModule], repoRoot: REPO_ROOT }),
  })

  service = configureFeedback({
    db: connection.db,
    announce: async (input) => {
      announced.push({ feedbackId: input.feedbackId, category: input.category })
    },
    activeOrganizationOf: async () => 'org_s43',
    // **L'annonce est attendue** dans ces cas : sans cela l'ordre « écrite
    // d'abord, annoncée ensuite » ne serait pas observable.
    runInBackground: (task) => {
      void task
    },
    // La garde du back-office est **injectée**, comme dans l'application : ces
    // cas la remplacent par un ensemble d'identifiants, pas par un « oui ».
    authorizeBackOffice: async ({ userId }) => authorized.has(userId),
  })

  authorized = new Set([SUPERADMIN])
})

afterAll(async () => {
  resetFeedbackService()

  if (databaseReachable) {
    await connection.db.execute(sql`delete from feedback where author_id like 'usr_s43_%'`)
    await connection.close()
  }
})

const clear = async (): Promise<void> => {
  await connection.db.execute(sql`delete from feedback where author_id like 'usr_s43_%'`)
  announced = []
}

/** Une soumission, telle que le formulaire natif la poste. */
const submit = async (
  body: Record<string, string>,
  options: { readonly session?: ModuleSession | null } = {},
): Promise<Response> =>
  await dispatchAllowingRateLimit(
    registry,
    new Request(`${APP_URL}${feedbackRoutePath('submit')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    }),
    {
      resolveSession: () =>
        Promise.resolve(options.session === undefined ? sessionOf(AUTHOR) : options.session),
    },
  )

const handle = async (
  id: string,
  session: ModuleSession | null,
): Promise<Response> =>
  await dispatchAllowingRateLimit(
    registry,
    new Request(`${APP_URL}${feedbackRoutePath('handle')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    }),
    { resolveSession: () => Promise.resolve(session) },
  )

const rows = async (): Promise<
  readonly {
    id: string
    author_id: string
    organization_id: string | null
    category: string
    message: string
    origin_path: string | null
    status: string
    handled_at: Date | null
  }[]
> =>
  (
    await connection.db.execute(
      sql`select * from feedback where author_id like 'usr_s43_%' order by created_at desc`,
    )
  ).rows as never

describe.runIf(await isDatabaseReachable())('la table et le contrat (critère 2)', () => {
  it('persiste l’auteur, l’organisation, la catégorie, le message et le chemin d’origine', async () => {
    await clear()

    const response = await submit({
      category: 'bug',
      message: '  Le bouton ne répond pas.  ',
      origin: '/account?tab=security',
    })

    // Un formulaire natif repart sur son écran, pas sur un document JSON.
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${APP_URL}${FEEDBACK_SCREEN_PATH}?sent=1`)

    const [written] = await rows()

    expect(written).toMatchObject({
      author_id: AUTHOR,
      organization_id: 'org_s43',
      category: 'bug',
      message: 'Le bouton ne répond pas.',
      origin_path: '/account?tab=security',
      status: 'open',
      handled_at: null,
    })
  })

  it('n’écrit rien d’un chemin d’origine que le domaine refuse, et accepte quand même le retour', async () => {
    await clear()

    // La valeur hostile est celle qu'un appelant écrit dans le champ caché.
    await submit({ category: 'idea', message: 'Bonjour', origin: 'javascript:alert(1)' })

    const [written] = await rows()

    expect(written?.origin_path).toBeNull()
    expect(written?.message).toBe('Bonjour')
  })

  it('refuse une catégorie hors du vocabulaire, sans rien écrire', async () => {
    await clear()

    const response = await submit({ category: 'facture', message: 'Bonjour' })

    expect(response.headers.get('location')).toBe(
      `${APP_URL}${FEEDBACK_SCREEN_PATH}?refused=category`,
    )
    // **Le refus n'atteint pas la couche de données** : un refus qui écrit
    // quand même n'est pas un refus.
    expect(await rows()).toHaveLength(0)
    expect(announced).toEqual([])
  })

  it('annonce le retour **après** l’avoir écrit, une fois et avec sa catégorie', async () => {
    await clear()

    await submit({ category: 'other', message: 'Merci' })

    const [written] = await rows()

    expect(announced).toEqual([{ feedbackId: written?.id, category: 'other' }])
  })
})

describe.runIf(await isDatabaseReachable())('la purge et l’export du contrat (s34, s35)', () => {
  it('efface les retours de l’auteur, et le rejeu n’efface plus rien', async () => {
    await clear()
    await submit({ category: 'bug', message: 'À effacer' })

    expect(await rows()).toHaveLength(1)

    const scope = { kind: 'user', userId: AUTHOR } as const

    expect(await purgeModules(registry, scope)).toMatchObject({ ok: true })
    expect(await rows()).toHaveLength(0)

    // **Rejouable sans effet supplémentaire** (`docs/reliability.md` §1) :
    // prouvé en le rejouant, jamais affirmé dans un commentaire.
    expect(await purgeModules(registry, scope)).toMatchObject({ ok: true })
    expect(await rows()).toHaveLength(0)
  })

  it('rend les retours de l’auteur dans son export, et rien dans celui d’une organisation', async () => {
    await clear()
    await submit({ category: 'idea', message: 'À exporter' })

    const payloadOf = (outcome: ExportModulesOutcome): Record<string, unknown> => {
      if (!outcome.ok) {
        throw new Error(`export refusé par « ${outcome.failed} » : ${outcome.message}`)
      }

      return outcome.payloads[feedbackModule.id] as Record<string, unknown>
    }

    const mine = payloadOf(
      await exportModules(registry, { kind: 'user', userId: AUTHOR }),
    )

    expect(mine['feedback']).toMatchObject([{ category: 'idea', message: 'À exporter' }])

    const theirs = payloadOf(
      await exportModules(registry, { kind: 'organization', organizationId: 'org_s43' }),
    )

    // L'export appartient à une personne : une organisation exporte ce que ses
    // membres exportent, chacun pour lui.
    expect(theirs).toEqual({})
  })
})

describe('la limitation de débit d’une route authentifiée (critère 1)', () => {
  const submitRoute = (): RegistryRoute => {
    const found = registry.routes.find(
      (route) => `${MODULE_ROUTE_PREFIX}${route.path}` === feedbackRoutePath('submit'),
    )

    if (found === undefined) {
      throw new Error('la route de soumission n’est pas dans le registre')
    }

    return found
  }

  it('déclare une politique que `config/security.ts` connaît', () => {
    const route = submitRoute()

    // **Le refus nomme la politique obtenue** : retirer la déclaration rend
    // `undefined`, et l'échec le dit au lieu d'annoncer « quelque chose ».
    expect(route.rateLimit?.policy ?? 'aucune politique déclarée').toBe('feedback')
    expect(Object.keys(rateLimitPolicies)).toContain('feedback')
  })

  it('est comptée par la dérivation du registre, comme une route publique', () => {
    // `routeIsRateLimited` ne couvre par dérivation que les routes **publiques**.
    // Celle-ci est `authenticated` : sans sa déclaration, elle ne serait comptée
    // par personne — une session n'est pas une limite.
    expect(submitRoute().protection.level).toBe('authenticated')
    expect(routeIsRateLimited(submitRoute())).toBe(true)
  })

  it('fait consulter le garde du répartiteur, et refuse en 429 quand il refuse', async () => {
    const consulted: string[] = []

    const response = await dispatchAllowingRateLimit(
      registry,
      new Request(`${APP_URL}${feedbackRoutePath('submit')}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: 'bug', message: 'Bonjour' }),
      }),
      {
        resolveSession: () => Promise.resolve(sessionOf(AUTHOR)),
        rateLimit: async ({ route }) => {
          consulted.push(route.path)

          return { allowed: false, retryAfterSeconds: 42 }
        },
      },
    )

    expect(consulted).toContain('/feedback/submit')
    expect(response.status).toBe(429)
  })
})

describe('le repli de notification (critère 3)', () => {
  const emailsOf = (): { sent: SendEmailInput[]; mailer: Mailer } => {
    const sent: SendEmailInput[] = []

    return {
      sent,
      mailer: {
        send: async (input) => {
          sent.push(input)

          return { ok: true, id: randomUUID() }
        },
      },
    }
  }

  it('envoie un email quand le centre de notifications n’est pas monté', async () => {
    const { sent, mailer } = emailsOf()

    const emit = createNotificationEmitter({
      types: notificationTypes,
      mailer,
      // **Le centre absent est une valeur**, pas une condition sur un nom de
      // module : c'est exactement l'état d'une configuration qui coupe
      // `notifications`.
      centre: null,
    })

    const outcome = await emit({
      type: 'feedback.received',
      recipient: { userId: SUPERADMIN, email: 'root@example.test', locale: 'fr' },
      organizationId: null,
      data: { category: 'bug' },
      stored: { category: 'bug' },
    })

    expect(outcome).toMatchObject({ ok: true, delivered: ['email'] })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.template).toBe('notification.feedback.received')
  })

  it('passe par le centre quand il est monté, et n’envoie alors que ce qu’il retient', async () => {
    const { sent, mailer } = emailsOf()
    const recorded: unknown[] = []

    const emit = createNotificationEmitter({
      types: notificationTypes,
      mailer,
      centre: {
        record: async (input) => {
          recorded.push(input)

          return { ok: true, channels: ['in_app'] }
        },
      },
    })

    await emit({
      type: 'feedback.received',
      recipient: { userId: SUPERADMIN, email: 'root@example.test', locale: 'fr' },
      organizationId: null,
      data: { category: 'bug' },
      stored: { category: 'bug' },
    })

    expect(recorded).toHaveLength(1)
    expect(sent).toEqual([])
  })

  it('ne stocke aucune donnée personnelle : le type ne déclare aucun acteur', () => {
    const declared = notificationTypes.find('feedback.received')

    // La ligne du centre survit à l'effacement de son auteur, alors que le
    // contrat du module promet `retention: 'erase'` : elle ne peut donc porter
    // qu'une référence — ici la catégorie, d'un vocabulaire fermé.
    expect(declared?.actors).toEqual([])
  })
})

describe('le déclencheur, dérivé du registre (critère 1)', () => {
  const intl = { locale: 'fr' as const, t: (key: string) => key, path: (p: string) => p }

  it('apparaît dans la coquille pour un compte, et pour personne d’autre', () => {
    const forAccount = shellNavigation(registry, sessionOf(AUTHOR), intl)
    const forAnonymous = shellNavigation(registry, null, intl)

    expect(forAccount.map((item) => item.href)).toContain(FEEDBACK_SCREEN_PATH)
    // Afficher l'entrée d'un écran auquel on n'a pas accès divulgue son
    // existence et promet ce qu'on refusera ensuite.
    expect(forAnonymous.map((item) => item.href)).not.toContain(FEEDBACK_SCREEN_PATH)
  })

  it('disparaît avec le module, sans qu’un fichier de la coquille le nomme', () => {
    expect(
      shellNavigation(withoutFeedback, sessionOf(AUTHOR), intl).map((item) => item.href),
    ).not.toContain(FEEDBACK_SCREEN_PATH)

    // Le shell ne connaît aucun module : il rend ce que `visibleNavigation` lui
    // donne. Un `if` sur un identifiant masquerait l'entrée au lieu de ne pas
    // l'avoir — c'est la règle d'`apps/web/AGENTS.md`.
    expect(readFileSync(`${REPO_ROOT}apps/web/app/app-shell.tsx`, 'utf8')).not.toContain(
      'feedback',
    )
  })

  it('déclare son entrée de back-office sur la surface d’administration, et pas ailleurs', () => {
    const inAdmin = visibleNavigation(registry, sessionOf(SUPERADMIN), 'admin')

    expect(inAdmin.map((entry) => entry.href)).toContain(ADMIN_FEEDBACK_SCREEN_PATH)
    // Un lien de service au rang des fonctionnalités du produit serait une
    // régression d'écran : la surface les sépare.
    expect(
      shellNavigation(registry, sessionOf(SUPERADMIN), intl).map((item) => item.href),
    ).not.toContain(ADMIN_FEEDBACK_SCREEN_PATH)
  })

  it('déclare une entrée par surface, et aucune sans surface connue', () => {
    expect(feedbackNavigation.map((entry) => entry.surface ?? 'app').sort()).toEqual([
      'admin',
      'app',
    ])
  })
})

describe('l’écran du back-office (critères 4 et 5)', () => {
  const intl = {
    t: (key: string, values?: Readonly<Record<string, string | number>>) =>
      values === undefined ? key : `${key}(${Object.values(values).join(',')})`,
    path: (p: string) => p,
    date: (value: Date) => value.toISOString().slice(0, 10),
    money: (amount: number, currency: string) => `${amount}${currency}`,
  }

  const view = (over: Record<string, unknown> = {}) => ({
    feedback: [
      {
        id: 'fbk_1',
        authorId: AUTHOR,
        authorName: 'Ada',
        category: 'bug',
        message: 'Le bouton ne répond pas.',
        originPath: '/account',
        status: 'open',
        createdAt: new Date('2026-02-03T10:00:00.000Z'),
      },
    ],
    category: null as string | null,
    categories: [...FEEDBACK_CATEGORIES],
    status: null as string | null,
    statuses: [...FEEDBACK_STATUSES],
    total: 1,
    page: 1,
    pageCount: 3,
    search: null as string | null,
    ...over,
  })

  const render = (over: Record<string, unknown> = {}): string =>
    renderToStaticMarkup(
      createElement(AdminFeedbackScreen, {
        view: view(over) as never,
        intl,
        navigation: [],
        screenPath: ADMIN_FEEDBACK_SCREEN_PATH,
        handleAction: feedbackRoutePath('handle'),
      }),
    )

  it('ne rend jamais le chemin d’origine dans un `href`', () => {
    // Une ligne écrite avant que la règle existe — ou par un autre chemin que
    // la route — porte ce que l'appelant a voulu. L'écran doit rester sûr.
    const markup = render({
      feedback: [
        {
          ...view().feedback[0],
          originPath: 'javascript:alert(1)',
        },
      ],
    })

    expect(markup).toContain('javascript:alert(1)')
    // …mais **comme du texte**, jamais comme une destination.
    expect(markup).not.toContain('href="javascript:')
    expect(markup).not.toMatch(/href="[^"]*javascript:/)
  })

  it('reporte les deux filtres dans la pagination, la recherche et l’autre filtre', () => {
    const markup = render({ category: 'bug', status: 'open', search: 'bouton' })

    // **La pagination porte la sélection** : la perdre en paginant sert une
    // liste plausible et fausse, pas une panne — la leçon de s37c.
    expect(markup).toContain('category=bug&amp;status=open&amp;q=bouton&amp;page=2')
    // La recherche la reporte en champs cachés : un `GET` de formulaire
    // **remplace** la chaîne de requête.
    expect(markup).toContain('name="category" value="bug"')
    expect(markup).toContain('name="status" value="open"')
    // Et chaque filtre reporte **l'autre** : changer de catégorie ne doit pas
    // effacer le statut choisi.
    expect(markup).toContain(`href="${ADMIN_FEEDBACK_SCREEN_PATH}?status=open&amp;category=idea`)
  })

  it('propose l’action de traitement au retour reçu, et pas au retour traité', () => {
    expect(render()).toContain(`action="${feedbackRoutePath('handle')}"`)
    expect(render({ feedback: [{ ...view().feedback[0], status: 'handled' }] })).not.toContain(
      `action="${feedbackRoutePath('handle')}"`,
    )
  })

  it('lit sa sélection de l’adresse, et n’en transmet rien de démesuré', () => {
    expect(parseBackOfficeFeedbackQuery({ category: 'bug', status: 'open', q: 'x', page: '2' })).toEqual(
      { category: 'bug', status: 'open', search: 'x', page: 2 },
    )
    // Bornée, comme tout ce qui vient d'une adresse : au-delà, ce n'est plus un
    // filtre, et rien ne descend jusqu'à la requête.
    expect(parseBackOfficeFeedbackQuery({ category: 'a'.repeat(65) }).category).toBeNull()
  })

  it('livre un libellé pour chaque catégorie et chaque statut déclarés, dans chaque locale', () => {
    // **Dérivé du vocabulaire du module**, jamais recopié : une catégorie
    // ajoutée là-bas force une décision ici plutôt que de rendre un écran en
    // 500 — `intl.t` lève sur une clé absente.
    for (const locale of appLocales) {
      const catalogue = JSON.parse(
        readFileSync(`${REPO_ROOT}packages/modules/admin/src/messages/${locale}.json`, 'utf8'),
      ) as Record<string, string>

      for (const category of FEEDBACK_CATEGORIES) {
        expect(catalogue, `${locale} / ${category}`).toHaveProperty(
          `feedback.category.${category}`,
        )
      }

      for (const status of FEEDBACK_STATUSES) {
        expect(catalogue, `${locale} / ${status}`).toHaveProperty(`feedback.status.${status}`)
      }
    }
  })
})

describe.runIf(await isDatabaseReachable())('marquer comme traité (critère 5)', () => {
  it('répond 404 à qui n’administre pas, sans rien écrire', async () => {
    await clear()
    await submit({ category: 'bug', message: 'À traiter' })

    const [written] = await rows()
    const refused = await handle(written?.id ?? '', sessionOf(INTRUDER))

    // 404, jamais 403 : un 403 confirmerait qu'un écran d'administration des
    // retours existe et que ce compte n'y a pas droit.
    expect(refused.status).toBe(404)
    // **Le refus n'atteint pas la couche de données.**
    expect((await rows())[0]).toMatchObject({ status: 'open', handled_at: null })
  })

  it('marque le retour, et le rejeu ne produit aucun effet supplémentaire', async () => {
    await clear()
    await submit({ category: 'bug', message: 'À traiter' })

    const [written] = await rows()
    const first = await handle(written?.id ?? '', sessionOf(SUPERADMIN))

    expect(await first.json()).toEqual({ handled: true })

    const marked = (await rows())[0]

    expect(marked?.status).toBe('handled')
    expect(marked?.handled_at).not.toBeNull()

    const replay = await handle(written?.id ?? '', sessionOf(SUPERADMIN))

    expect(await replay.json()).toEqual({ handled: false })
    // La date de traitement n'est pas réécrite : la condition est dans
    // l'écriture, pas dans une lecture préalable.
    expect((await rows())[0]?.handled_at).toEqual(marked?.handled_at)
  })

  it('rend la liste au back-office, filtrée au plus bas', async () => {
    await clear()
    await submit({ category: 'bug', message: 'Un bogue' })
    await submit({ category: 'idea', message: 'Une idée' })

    const bugs = await service.useCases.list({
      category: 'bug',
      status: null,
      search: null,
      limit: 20,
      offset: 0,
    })

    // Le décompte porte sur **le même filtre** que la page : sinon la
    // pagination annonce des pages qui n'existent pas.
    expect(bugs).toMatchObject({ ok: true, total: 1 })
    expect(bugs.ok && bugs.feedback.map((entry) => entry.category)).toEqual(['bug'])
  })
})

describe('module coupé (critère 6)', () => {
  it('ne sert aucune route de retour', async () => {
    for (const route of feedbackModule.routes) {
      const response = await dispatchAllowingRateLimit(
        withoutFeedback,
        new Request(`${APP_URL}${MODULE_ROUTE_PREFIX}${route.path}`, {
          method: route.method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        }),
        { resolveSession: () => Promise.resolve(sessionOf(SUPERADMIN)) },
      )

      expect(response.status, route.path).toBe(404)
    }
  })

  it('ne laisse aucune entrée de navigation, sur aucune surface', () => {
    for (const surface of ['app', 'footer', 'admin'] as const) {
      expect(
        visibleNavigation(withoutFeedback, sessionOf(SUPERADMIN), surface).map(
          (entry) => entry.moduleId,
        ),
      ).not.toContain(feedbackModule.id)
    }
  })

  it('déclare de quoi rendre le balayage de `pnpm test:minimal-profile` non vide', () => {
    // La recette dérive ses vérifications du contrat des modules **coupés** :
    // un module qui ne déclarerait ni route, ni entrée, ni table la rendrait
    // verte sans rien vérifier.
    expect(feedbackModule.routes.length).toBeGreaterThan(0)
    expect(feedbackModule.navigation.length).toBeGreaterThan(0)
    expect(Object.keys(feedbackModule.schema).length).toBeGreaterThan(0)
  })
})

