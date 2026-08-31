import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildRegistry,
  dispatchModuleRequest,
  MODULE_ROUTE_PREFIX,
  type AnyModuleDefinition,
} from '@repo/core'
import {
  createDemoItem,
  demoItemUseCases,
  InvalidDemoItemError,
} from '@repo/module-demo-enabled'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

import { availableModules, enabledModules, requiredModules } from '../config/features'
import { appLocales } from '../config/i18n'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * Les deux garanties de ce contrat que seul le compilateur peut tenir.
 *
 * « Un identifiant inconnu provoque une erreur de compilation » et « une
 * catégorie de données sans politique de rétention fait échouer la
 * compilation » ne sont pas des validations d'exécution : dégradées en
 * vérification au démarrage, elles perdent leur force et personne ne s'en
 * aperçoit — `config/features.ts` typée `string[]` compile parfaitement.
 *
 * `expectTypeOf` ne suffirait pas : il s'exécute dans le même programme que le
 * test, qui doit compiler. On compile donc réellement une arborescence de
 * fixtures dont trois fichiers **doivent** échouer et un **doit** passer, et on
 * lit les diagnostics. Le fichier valide n'est pas décoratif : sans lui, les
 * trois autres pourraient échouer pour une raison qui n'a rien à voir.
 */
const typecheckFixtures = (): string => {
  try {
    execFileSync('node_modules/.bin/tsc', ['-p', 'tests/fixtures/typing'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    return ''
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: string; stderr?: string }

    return `${stdout ?? ''}${stderr ?? ''}`
  }
}

describe('contraintes du contrat portées par le compilateur', () => {
  const diagnostics = typecheckFixtures()

  it.each([
    ['un identifiant de module inconnu', 'unknown-module-id.ts'],
    ['une catégorie de données sans politique de rétention', 'missing-retention.ts'],
    ['un template d’email sans version dans une locale livrée', 'missing-email-locale.ts'],
    [
      'une politique de rétention pour une catégorie non déclarée',
      'undeclared-retention-category.ts',
    ],
    // s15 : le périmètre organisationnel est tenu par le **compilateur**, pas
    // par une relecture. Un accès fabriqué à partir d'un identifiant reçu du
    // client ne compile pas — retirer la marque de type le ferait compiler, et
    // ce cas rougirait.
    ['un accès à une organisation fabriqué à la main', 'forged-organization-access.ts'],
  ])('refuse %s', (_case, fixture) => {
    expect(diagnostics).toContain(fixture)
  })

  it('laisse compiler un module conforme', () => {
    // Cette fixture porte aussi les gardes d'inertie : si `AvailableModuleId`
    // s'élargissait à `string`, c'est ici que ça rougirait.
    expect(diagnostics).not.toContain('valid-module.ts')
  })
})

/**
 * Fabrique de modules d'essai.
 *
 * Les modules de démonstration prouvent le comportement réel de l'application ;
 * ces déclarations minimales prouvent les règles du registre, avec la
 * combinaison exacte que chaque règle exige — un cycle, un identifiant en
 * double, un template incomplet — qu'aucun module réel n'a de raison de porter.
 */
const moduleFixture = (
  id: string,
  overrides: Partial<AnyModuleDefinition> = {},
): AnyModuleDefinition => ({
  id,
  requires: [],
  schema: {},
  migrations: null,
  routes: [],
  navigation: [],
  messages: { fr: {}, en: {} },
  emails: [],
  webhooks: [],
  jobs: [],
  dataCategories: [],
  retention: {},
  purge: () => Promise.resolve(),
  export: () => Promise.resolve({}),
  ...overrides,
})

describe('validation de la configuration des modules', () => {
  it('refuse un identifiant activé qui n’existe pas, en le nommant', () => {
    // Le compilateur l'attrape déjà dans `config/features.ts` ; cette garde
    // couvre l'autre porte — une configuration construite dynamiquement, ou du
    // JavaScript qui ignore les types.
    expect(() =>
      buildRegistry({ available: [moduleFixture('a')], enabled: ['b'], locales: ['fr'] }),
    ).toThrowError(/« b »/)
  })

  it('refuse un point de composition qui ne déclare pas les locales du projet', () => {
    // La faille mesurée en revue de s06 : la référence était les locales du
    // **module**, si bien qu'un module ne livrant que `fr` passait alors que le
    // projet sert `fr` et `en`. La tâche 2 de s09 l'a fermée en faisant
    // recevoir les locales de l'application — mais le paramètre était
    // facultatif, avec un repli silencieux sur celles du module : retirer
    // `locales` du point de composition de l'application laissait la suite
    // entièrement verte.
    //
    // Le compilateur refuse désormais l'omission. Cette garde couvre l'autre
    // porte, la même que pour un identifiant inconnu : une configuration
    // construite dynamiquement, ou du JavaScript qui ignore les types.
    const composeWithoutLocales = buildRegistry as unknown as (configuration: {
      available: readonly AnyModuleDefinition[]
      enabled: readonly string[]
    }) => unknown

    expect(() =>
      composeWithoutLocales({ available: [moduleFixture('a')], enabled: ['a'] }),
    ).toThrowError(/locales/)
  })

  it('refuse une configuration qui coupe un module du socle, en le nommant', () => {
    // Le socle n'était qu'une phrase : `config/features.ts` écrivait « le
    // retirer ferait échouer la validation des modules qui le requièrent »,
    // alors qu'aucun module ne déclarait `requires: ['auth']`. Rien n'empêchait
    // donc `ks toggle auth`, et cinq parcours end-to-end tombaient dans cet
    // état. La liste est maintenant une **entrée de la résolution**, refusée par
    // son nom, comme un requis manquant (ADR 021).
    expect(() =>
      buildRegistry({
        available: [moduleFixture('auth'), moduleFixture('demo')],
        enabled: ['demo'],
        required: ['auth'],
        locales: ['fr'],
      }),
    ).toThrowError(/« auth »/)
  })

  it('refuse la configuration du dépôt privée de son socle', () => {
    // Le maillon que les cas d'essai ne prouvent pas : que `config/features.ts`
    // arme réellement la règle. Sans lui, le mécanisme serait branché et pointé
    // sur une liste vide.
    expect(() =>
      buildRegistry({
        available: [...availableModules],
        enabled: enabledModules.filter((id) => !requiredModules.includes(id as never)),
        required: [...requiredModules],
        locales: [...appLocales],
      }),
    ).toThrowError(/ne peut pas être désactivé/)
  })

  it('refuse un socle que l’annuaire ne déclare pas, plutôt que de se taire', () => {
    // Sans ce refus, une faute de frappe dans la liste du socle la désarme en
    // silence : le module nommé n'existe pas, donc rien ne le manque jamais.
    expect(() =>
      buildRegistry({
        available: [moduleFixture('a')],
        enabled: ['a'],
        required: ['auht'],
        locales: ['fr'],
      }),
    ).toThrowError(/« auht »/)
  })

  it('laisse passer la configuration qui contient son socle', () => {
    expect(
      buildRegistry({
        available: [moduleFixture('auth'), moduleFixture('demo')],
        enabled: ['auth', 'demo'],
        required: ['auth'],
        locales: ['fr'],
      }).moduleIds,
    ).toEqual(['auth', 'demo'])
  })

  it('refuse un module qui se requiert lui-même', () => {
    expect(() =>
      buildRegistry({
        available: [moduleFixture('a', { requires: ['a'] })],
        enabled: ['a'],
        locales: ['fr'],
      }),
    ).toThrowError(/« a » se requiert lui-même/)
  })

  it('refuse un module activé sans son requis, en nommant les deux', () => {
    const registry = () =>
      buildRegistry({
        available: [moduleFixture('a', { requires: ['b'] }), moduleFixture('b')],
        enabled: ['a'],
        locales: ['fr'],
      })

    expect(registry).toThrowError(/« a »/)
    expect(registry).toThrowError(/« b »/)
  })

  it('distingue un requis inexistant d’un requis non activé', () => {
    expect(() =>
      buildRegistry({
        available: [moduleFixture('a', { requires: ['fantome'] })],
        enabled: ['a'],
        locales: ['fr'],
      }),
    ).toThrowError(/« fantome ».*n’existe pas/)
  })

  it('refuse un cycle en nommant les modules qui le forment', () => {
    const registry = () =>
      buildRegistry({
        available: [
          moduleFixture('a', { requires: ['b'] }),
          moduleFixture('b', { requires: ['a'] }),
        ],
        enabled: ['a', 'b'],
        locales: ['fr'],
      })

    expect(registry).toThrowError(/Cycle/)
    expect(registry).toThrowError(/a → b → a/)
  })

  it('refuse deux modules portant le même identifiant', () => {
    expect(() =>
      buildRegistry({
        available: [moduleFixture('a'), moduleFixture('a')],
        enabled: ['a'],
        locales: ['fr'],
      }),
    ).toThrowError(/« a » est déclaré deux fois/)
  })

  it('refuse un template d’email sans version dans une locale livrée', () => {
    // Le contrat l'attrape à la compilation ; cette garde tient pour un module
    // dont les locales ne sont pas connues statiquement.
    expect(() =>
      buildRegistry({
        available: [
          moduleFixture('a', {
            emails: [{ id: 'welcome', locales: { fr: { subject: 'S', body: 'B' } } }],
          }),
        ],
        enabled: ['a'],
        locales: ['fr', 'en'],
      }),
    ).toThrowError(/« welcome ».*« en »/)
  })

  it('refuse un template d’email absent d’une locale de l’application, et non du module', () => {
    // La faille mesurée en revue de s06 : le contrôle portait sur les locales
    // **du module**, donc un module ne livrant que `fr` passait alors que
    // l'application sert `fr` et `en`, et son email partait dans une langue
    // que le destinataire n'avait pas demandée. L'ensemble de référence est
    // celui de `config/i18n.ts`, transmis comme `requiredModules`.
    expect(() =>
      buildRegistry({
        available: [
          moduleFixture('a', {
            messages: { fr: {} },
            emails: [{ id: 'welcome', locales: { fr: { subject: 'S', body: 'B' } } }],
          }),
        ],
        enabled: ['a'],
        locales: ['fr', 'en'],
      }),
    ).toThrowError(/« welcome ».*« en »/)
  })

  it('refuse une entrée de navigation non traduite dans une locale de l’application', () => {
    expect(() =>
      buildRegistry({
        available: [
          moduleFixture('a', {
            messages: { fr: { 'nav.a': 'A' } },
            navigation: [
              {
                id: 'a',
                href: '/a',
                labelKey: 'nav.a',
                order: 1,
                protection: { level: 'public' },
              },
            ],
          }),
        ],
        enabled: ['a'],
        locales: ['fr', 'en'],
      }),
    ).toThrowError(/« nav\.a ».*« en »/)
  })

  it('refuse la configuration du dépôt privée d’une locale livrée', () => {
    // Le balayage de `tests/i18n.test.ts` porte sur l'annuaire complet ; ce
    // cas-ci prouve que la **construction du registre** refuse, donc que
    // l'application ne démarre pas — pas seulement qu'un test rougit.
    expect(() =>
      buildRegistry({
        available: [...availableModules],
        enabled: [...enabledModules],
        required: [...requiredModules],
        locales: [...appLocales, 'de'],
      }),
    ).toThrowError(/« de »/)
  })

  it('refuse deux modules activés déclarant la même route', () => {
    // Un chemin en double serait servi par l'un des deux, en silence : c'est
    // une route protégée qu'on peut faire disparaître derrière une route
    // publique.
    const route = {
      method: 'GET' as const,
      path: '/collision',
      protection: { level: 'public' as const },
      handler: () => new Response('ok'),
    }

    expect(() =>
      buildRegistry({
        available: [
          moduleFixture('a', { routes: [route] }),
          moduleFixture('b', { routes: [route] }),
        ],
        enabled: ['a', 'b'],
        locales: ['fr'],
      }),
    ).toThrowError(/GET \/collision.*« a ».*« b »/)
  })

  it('refuse une entrée de navigation dont la traduction manque dans une locale', () => {
    expect(() =>
      buildRegistry({
        available: [
          moduleFixture('a', {
            messages: { fr: { 'nav.a': 'A' }, en: {} },
            navigation: [
              {
                id: 'a',
                href: '/a',
                labelKey: 'nav.a',
                order: 1,
                protection: { level: 'public' },
              },
            ],
          }),
        ],
        enabled: ['a'],
        locales: ['fr', 'en'],
      }),
    ).toThrowError(/« nav\.a ».*« en »/)
  })
})

describe('construction du registre', () => {
  it('ordonne les modules selon le graphe, pas selon l’ordre de déclaration', () => {
    // `b` est listé en premier et requiert `a` : c'est le graphe qui décide.
    const registry = buildRegistry({
      available: [moduleFixture('b', { requires: ['a'] }), moduleFixture('a')],
      enabled: ['b', 'a'],
      locales: ['fr'],
    })

    expect(registry.moduleIds).toEqual(['a', 'b'])
  })

  it('n’agrège que les modules activés', () => {
    const registry = buildRegistry({
      available: [...availableModules],
      enabled: ['demo-enabled'],
      locales: [...appLocales],
    })

    const owners = [
      ...registry.routes.map((route) => route.moduleId),
      ...registry.navigation.map((entry) => entry.moduleId),
      ...registry.emails.map((email) => email.moduleId),
      ...registry.webhooks.map((webhook) => webhook.moduleId),
    ]

    expect(new Set(owners)).toEqual(new Set(['demo-enabled']))
    expect(Object.keys(registry.messages.fr ?? {}).join('\n')).not.toContain('demo-disabled')
  })

  it('n’agrège que les tâches planifiées des modules activés', () => {
    // Même problème d'agrégation que les webhooks, et même raison de le régler
    // maintenant : s33 arrive après une trentaine de modules, et son critère
    // « module non activé : les tâches planifiées ne s'exécutent pas » se
    // tiendra ici, sans rouvrir un seul module.
    const job = { id: 'rappel', schedule: '0 3 * * *', run: () => Promise.resolve() }

    const registry = buildRegistry({
      available: [moduleFixture('a', { jobs: [job] }), moduleFixture('b', { jobs: [job] })],
      enabled: ['a'],
      locales: ['fr'],
    })

    expect(registry.jobs.map((entry) => entry.moduleId)).toEqual(['a'])
    expect(registry.jobs.map((entry) => entry.job.id)).toEqual(['rappel'])
  })

  it('préfixe les clés de traduction par leur module', () => {
    const registry = buildRegistry({
      available: [...availableModules],
      enabled: ['demo-enabled'],
      locales: [...appLocales],
    })

    // Sans préfixe, deux modules qui nomment leur clé `navigation.items`
    // s'écrasent l'un l'autre, et le dernier chargé gagne.
    expect(registry.messages.fr?.['demo-enabled.navigation.items']).toBe(
      'Éléments de démonstration',
    )
    expect(registry.navigation[0]?.labelKey).toBe('demo-enabled.navigation.items')
  })

  it('trie la navigation par rang déclaré, puis par module', () => {
    const entry = (id: string, order: number) => ({
      id,
      href: `/${id}`,
      labelKey: `nav.${id}`,
      order,
      protection: { level: 'public' as const },
    })

    const registry = buildRegistry({
      available: [
        moduleFixture('z', {
          messages: { fr: { 'nav.tard': 'Tard' } },
          navigation: [entry('tard', 30)],
        }),
        moduleFixture('a', {
          messages: { fr: { 'nav.tot': 'Tôt' } },
          navigation: [entry('tot', 10)],
        }),
      ],
      // Les modules d'essai ne déclarent que le français.
      locales: ['fr'],
      enabled: ['z', 'a'],
    })

    expect(registry.navigation.map((navigationEntry) => navigationEntry.id)).toEqual([
      'tot',
      'tard',
    ])
  })
})

/** Registre de référence : le module de démonstration activé, l'autre non. */
const demoRegistry = buildRegistry({
  available: [...availableModules],
  enabled: ['demo-enabled'],
  locales: [...appLocales],
})

const requestTo = (path: string, init?: RequestInit): Request =>
  new Request(`http://localhost${MODULE_ROUTE_PREFIX}${path}`, init)

const asAdmin = { resolveSession: () => Promise.resolve({ userId: 'u-admin', roles: ['admin'] }) }
const asMember = { resolveSession: () => Promise.resolve({ userId: 'u-member', roles: [] }) }

const countItemsOf = async (ownerId: string): Promise<number> => {
  const items = await demoItemUseCases.listDemoItems()

  return items.filter((item) => item.ownerId === ownerId).length
}

describe('acheminement des requêtes vers les modules activés', () => {
  it('sert la route publique du module activé', async () => {
    const response = await dispatchModuleRequest(demoRegistry, requestTo('/demo-enabled/items'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toHaveProperty('items')
  })

  it('répond 404 sur un chemin qu’aucun module activé ne déclare', async () => {
    const response = await dispatchModuleRequest(demoRegistry, requestTo('/demo-enabled/inconnu'))

    expect(response.status).toBe(404)
  })

  it('répond 404, et non 405, sur une méthode qu’aucune route ne déclare', async () => {
    // Choix assumé (ADR 017) : répondre 405 dirait quelles méthodes sont
    // acceptées sur ce chemin, ce que le §7 du socle de sécurité refuse. Le
    // comportement est épinglé ici pour que chaque module en hérite sciemment,
    // et non par accident de mise en œuvre.
    const response = await dispatchModuleRequest(
      demoRegistry,
      requestTo('/demo-enabled/admin/report', { method: 'DELETE' }),
      asAdmin,
    )

    expect(response.status).toBe(404)
  })

  it('refuse une route authentifiée sans session, et n’écrit rien', async () => {
    const before = await countItemsOf('u-member')

    const response = await dispatchModuleRequest(
      demoRegistry,
      requestTo('/demo-enabled/items', {
        method: 'POST',
        body: JSON.stringify({ title: 'Créé sans session' }),
      }),
    )

    expect(response.status).toBe(401)
    // Le refus n'atteint pas la persistance : c'est la moitié de la garantie
    // qu'un simple code de retour ne prouve pas.
    expect(await countItemsOf('u-member')).toBe(before)
  })

  it('refuse une route réservée à un rôle quand la session ne l’a pas', async () => {
    const response = await dispatchModuleRequest(
      demoRegistry,
      requestTo('/demo-enabled/admin/report'),
      asMember,
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.not.toHaveProperty('count')
  })

  it('sert la route réservée à un rôle quand la session le porte', async () => {
    const response = await dispatchModuleRequest(
      demoRegistry,
      requestTo('/demo-enabled/admin/report'),
      asAdmin,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toHaveProperty('count')
  })

  it('crée un élément quand la session est là', async () => {
    const response = await dispatchModuleRequest(
      demoRegistry,
      requestTo('/demo-enabled/items', {
        method: 'POST',
        body: JSON.stringify({ title: 'Un élément' }),
      }),
      asAdmin,
    )

    expect(response.status).toBe(201)
    expect(await countItemsOf('u-admin')).toBe(1)
  })
})

/**
 * Un lien de navigation mène quelque part, ou il ment.
 *
 * Le module de démonstration sert de gabarit au générateur de s41 et à tout
 * agent qui écrit son premier module : un `href` qui ne correspond à rien y
 * enseignerait qu'un lien n'a besoin de correspondre à rien (revue de s03, F8).
 * Tant qu'aucun mécanisme de **page** de module n'existe, la seule URL qu'un
 * module sert réellement est sa route montée : c'est là que pointent ses
 * entrées. Le jour où une page existe, cette assertion se déplace vers elle,
 * elle ne disparaît pas.
 */
describe('les entrées de navigation du module de démonstration', () => {
  it.each(demoRegistry.navigation.map((entry) => [entry.id, entry.href] as const))(
    'l’entrée « %s » pointe sur une URL réellement servie',
    async (_id, href) => {
      const response = await dispatchModuleRequest(
        demoRegistry,
        new Request(`http://localhost${href}`),
        asAdmin,
      )

      expect(response.status).toBe(200)
    },
  )
})

describe('règle métier du module de démonstration', () => {
  it('refuse un titre vide', () => {
    // La règle est prouvée là où elle vit : une assertion prise au bord ne dirait
    // que ce que la route en a fait.
    expect(() => createDemoItem({ id: 'x', ownerId: 'u', title: '   ' })).toThrowError(
      InvalidDemoItemError,
    )
  })

  it('refuse un titre vide au bord aussi, sans rien écrire', async () => {
    const before = await countItemsOf('u-admin')

    const response = await dispatchModuleRequest(
      demoRegistry,
      requestTo('/demo-enabled/items', { method: 'POST', body: JSON.stringify({ title: ' ' }) }),
      asAdmin,
    )

    expect(response.status).toBe(400)
    expect(await countItemsOf('u-admin')).toBe(before)
  })
})

describe('webhook déclaré par un module', () => {
  it('rejoue le même événement sans second effet', async () => {
    const handler = demoRegistry.webhooks[0]?.handler
    const event = {
      id: 'evt-1',
      type: 'demo.item.imported',
      payload: { ownerId: 'u-webhook', title: 'Importé' },
    }

    await handler?.handle(event)
    await handler?.handle(event)

    expect(await countItemsOf('u-webhook')).toBe(1)
  })
})

/**
 * La configuration des modules doit compter dans la **clé de cache** du build.
 *
 * `config/features.ts` vit à la racine du dépôt, hors du package `apps/web` :
 * les entrées par défaut d'une tâche Turborepo sont les fichiers du package, ce
 * fichier n'en fait donc pas partie. Sans déclaration explicite, éditer la
 * configuration puis relancer `pnpm build` rend `FULL TURBO` et sert le bundle
 * de l'état **précédent** — le geste central du produit expédie alors le mauvais
 * jeu de modules, en silence (revue de s03, F1).
 *
 * L'assertion ne relit pas `turbo.json` : elle interroge le calcul de hachage de
 * Turborepo lui-même. Une déclaration présente mais qui ne couvrirait pas le
 * fichier — `config/*.md`, un chemin mal orthographié — laisserait passer une
 * lecture du fichier de configuration, pas celle-ci.
 */
describe('la configuration des modules entre dans la clé de cache du build', () => {
  const globalCacheInputs = (): Record<string, string> => {
    const output = execFileSync(
      'node_modules/.bin/turbo',
      ['run', 'build', '--dry=json', '--filter=@repo/web'],
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )

    const plan = JSON.parse(output) as {
      globalCacheInputs?: { files?: Record<string, string> }
    }

    return plan.globalCacheInputs?.files ?? {}
  }

  it('hache `config/features.ts` avant de décider qu’un build est réutilisable', () => {
    expect(Object.keys(globalCacheInputs())).toContain('config/features.ts')
  })
})

/**
 * **Un module n'importe jamais `@repo/db`** (ADR 020).
 *
 * Depuis s07, `packages/db` construit son schéma relationnel depuis l'agrégat
 * généré, qui importe les packages des modules activés. La dépendance inverse
 * fermerait donc un cycle — `@repo/db` → agrégat → module → `@repo/db` — dont
 * la conséquence n'est pas une erreur de compilation mais une table lue avant
 * d'être initialisée, à l'exécution, dans le module le plus sensible du socle.
 *
 * Un module reçoit sa connexion de son point de composition ; il ne va pas la
 * chercher. C'est écrit dans `packages/db/AGENTS.md`, et c'est ce cas qui le
 * fait échouer.
 */
describe('un module ne dépend pas du package de base de données', () => {
  const MODULES_ROOT = join(REPO_ROOT, 'packages', 'modules')

  const sourceFiles = (directory: string): readonly string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name)

      if (entry.isDirectory()) {
        return sourceFiles(path)
      }

      // Les extensions que le `tsconfig` d'un module compile : la portée de ce
      // balayage et celle de la règle du lint doivent être la même, sans quoi
      // la garantie est fausse d'un côté (voir le cas ci-dessous).
      return /\.(?:tsx?|mts|cts)$/.test(entry.name) ? [path] : []
    })

  const modules = readdirSync(MODULES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  it('trouve les modules du dépôt, faute de quoi ce cas ne vérifierait rien', () => {
    expect(modules.length).toBeGreaterThan(0)
  })

  it('collecte toutes les extensions que le module compile, pas seulement `.ts`', () => {
    // Le collecteur ne prenait que `.ts`, et la règle du lint ne visait que
    // `packages/modules/**/*.ts`. Or `docs/architecture.md` place les
    // composants React dans le `presentation/` de chaque module : le premier
    // écran livré serait sorti du balayage **sans rien changer d'autre** —
    // aucun cas ne serait devenu rouge, la portée aurait juste rétréci. Le
    // dépôt n'ayant encore aucun `.tsx` de module, c'est ici, sur une
    // arborescence fabriquée, que la portée est opposable.
    const root = mkdtempSync(join(tmpdir(), 'balayage-module-'))

    try {
      mkdirSync(join(root, 'presentation'))
      writeFileSync(join(root, 'contract.ts'), '')
      writeFileSync(join(root, 'legacy.cts'), '')
      writeFileSync(join(root, 'loader.mts'), '')
      writeFileSync(join(root, 'presentation', 'sign-in-form.tsx'), '')
      writeFileSync(join(root, 'presentation', 'notes.md'), '')

      expect(sourceFiles(root).map((path) => path.slice(root.length + 1)).sort()).toEqual([
        'contract.ts',
        'legacy.cts',
        'loader.mts',
        join('presentation', 'sign-in-form.tsx'),
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each(modules)('le module %s n’importe pas `@repo/db`', async (moduleId) => {
    // Le balayage passe par **la règle du lint**, pas par une expression
    // régulière sur le texte. La garde d'origine cherchait `from '@repo/db'` :
    // les mêmes octets en guillemets doubles la traversaient, et la revue l'a
    // prouvé par mutation. La règle vit dans `eslint.config.ts` et est éprouvée
    // pour elle-même dans `tests/lint-rules.test.ts` ; ici on constate
    // qu'aucun fichier du dépôt ne la viole.
    const results = await new ESLint({ cwd: REPO_ROOT }).lintFiles(
      [...sourceFiles(join(MODULES_ROOT, moduleId, 'src'))],
    )

    const offenders = results.flatMap((result) =>
      result.messages
        .filter((message) => (message.ruleId ?? '').startsWith('no-restricted-'))
        .map((message) => `${result.filePath}:${String(message.line)} ${message.message}`),
    )

    expect(offenders).toEqual([])
  }, 60_000)

  it('déclare le manifeste sans `@repo/db` non plus', () => {
    for (const moduleId of modules) {
      const manifest = JSON.parse(
        readFileSync(join(MODULES_ROOT, moduleId, 'package.json'), 'utf8'),
      ) as { dependencies?: Record<string, string> }

      expect(Object.keys(manifest.dependencies ?? {})).not.toContain('@repo/db')
    }
  })
})
