import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { boundariesOnlyConfig } from '@repo/eslint-config/boundaries'
import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

const FIXTURES = 'tests/fixtures/layers/packages/modules/demo/src'

/**
 * Les frontières de couches ne sont pas vérifiables sur le dépôt : aucun module
 * n'existe encore, le premier arrive en s03. Une règle écrite sur une
 * arborescence vide est inerte sans qu'on s'en aperçoive — le motif de chemin
 * ne matche rien, et le lint reste vert quoi qu'on écrive.
 *
 * Ce test l'exécute donc sur `tests/fixtures/layers/`, qui reproduit à
 * l'identique la structure annoncée par `docs/architecture.md`
 * (`packages/modules/<module>/src/<couche>`) et contient une violation réelle
 * de chacune des sept arêtes interdites.
 *
 * Ce que ce test a déjà attrapé : sans `import/resolver` dans les settings, le
 * résolveur par défaut ne connaît pas l'extension `.ts`, aucune dépendance
 * n'est classée, et les sept violations passent en silence.
 */
const FORBIDDEN_EDGES = [
  { from: 'domain', to: 'application', file: `${FIXTURES}/domain/reaches-application.ts` },
  { from: 'domain', to: 'infrastructure', file: `${FIXTURES}/domain/reaches-infrastructure.ts` },
  { from: 'domain', to: 'presentation', file: `${FIXTURES}/domain/reaches-presentation.ts` },
  {
    from: 'application',
    to: 'infrastructure',
    file: `${FIXTURES}/application/reaches-infrastructure.ts`,
  },
  {
    from: 'application',
    to: 'presentation',
    file: `${FIXTURES}/application/reaches-presentation.ts`,
  },
  {
    from: 'infrastructure',
    to: 'presentation',
    file: `${FIXTURES}/infrastructure/reaches-presentation.ts`,
  },
  {
    from: 'presentation',
    to: 'infrastructure',
    file: `${FIXTURES}/presentation/reaches-infrastructure.ts`,
  },
]

/**
 * Pureté du `domain` (ADR 006), tranchée en s03.
 *
 * s02 avait livré la règle de dépendance **entre couches** et laissé la pureté
 * du `domain` de côté, faute d'une liste de refus. La voici : ni framework, ni
 * ORM, ni pilote, ni couche API, ni authentification, ni SDK tiers, ni package
 * d'infrastructure du dépôt, ni module natif de Node.
 *
 * Le mécanisme n'était pas gratuit à trouver : `boundaries/dependencies` ignore
 * par défaut tout ce qui ne vient pas du dépôt (`checkAllOrigins` vaut `false`),
 * ce qui est exactement pourquoi un `domain` important `zod` — ou `drizzle-orm`
 * — passait sans erreur après s02.
 */
const FORBIDDEN_EXTERNALS = [
  // Le motif porte sur la base du spécificateur : `drizzle-orm` attrape
  // `drizzle-orm/pg-core`, seule écriture qu'on rencontre en vrai.
  { what: 'un ORM', file: `${FIXTURES}/domain/reaches-orm.ts`, source: 'drizzle-orm/pg-core' },
  { what: 'un module natif de Node', file: `${FIXTURES}/domain/reaches-node.ts`, source: 'node:fs' },
  // Un port est l'interface d'une dépendance externe : il vit dans
  // `application`, jamais dans `domain` (ADR 006). Sans cette entrée, la règle
  // laissait passer `import type { Mailer } from '@repo/ports'` au centre —
  // l'interdit de s06 n'était alors qu'une phrase.
  { what: 'un port', file: `${FIXTURES}/domain/reaches-port.ts`, source: '@repo/ports' },
]

/** Fichiers qui n'enfreignent rien : la règle doit les laisser passer. */
const ALLOWED_FILES = [
  `${FIXTURES}/domain/order.ts`,
  // zod est explicitement autorisé dans le `domain` : ni framework, ni ORM, ni
  // SDK. Une règle de pureté qui interdirait tout serait contournée au premier
  // type de valeur validé.
  `${FIXTURES}/domain/uses-zod.ts`,
  `${FIXTURES}/application/place-order.ts`,
  // Le pendant de `domain/reaches-port.ts` : refuser un port partout prouverait
  // que la règle est trop large, pas qu'elle marche.
  `${FIXTURES}/application/uses-port.ts`,
  `${FIXTURES}/infrastructure/order-repository.ts`,
  // La pureté ne vaut que pour le `domain` : refuser l'ORM ici prouverait que
  // la règle est trop large, pas qu'elle marche.
  `${FIXTURES}/infrastructure/uses-orm.ts`,
  `${FIXTURES}/presentation/order-route.ts`,
]

type FixtureReport = Map<string, ESLint.LintResult>

const lintFixtures = async (): Promise<FixtureReport> => {
  const eslint = new ESLint({
    cwd: REPO_ROOT,
    // La configuration du dépôt ne juge pas cette arborescence, pour deux
    // raisons cumulées : elle est dans les exclusions globales (elle n'est
    // faite que de violations, `pnpm lint` échouerait en permanence), et elle
    // tombe sous l'exception nommée du harnais de test. Le test rejoue donc la
    // règle seule, sans passer par `eslint.config.ts`.
    overrideConfigFile: true,
    overrideConfig: boundariesOnlyConfig,
  })

  const results = await eslint.lintFiles([`${FIXTURES}/**/*.ts`])

  return new Map(results.map((result) => [result.filePath.replace(REPO_ROOT, ''), result]))
}

describe('règle de dépendance des couches (ADR 006)', () => {
  let report: FixtureReport

  beforeAll(async () => {
    report = await lintFixtures()
  })

  it.each(FORBIDDEN_EDGES)('refuse $from → $to', ({ from, to, file }) => {
    const messages = report.get(file)?.messages ?? []

    expect(messages.map((message) => message.ruleId)).toContain('boundaries/dependencies')
    expect(messages.map((message) => message.message).join('\n')).toContain(
      `${from} ne peut pas importer ${to}`,
    )
  })

  it.each(ALLOWED_FILES)('laisse passer %s', (file) => {
    expect(report.get(file)?.messages ?? []).toEqual([])
  })

  it.each(FORBIDDEN_EXTERNALS)('refuse $what dans le domain', ({ file, source }) => {
    const messages = report.get(file)?.messages ?? []

    expect(messages.map((message) => message.ruleId)).toContain('boundaries/dependencies')
    expect(messages.map((message) => message.message).join('\n')).toContain(
      `Pureté du domain (ADR 006) : « ${source} »`,
    )
  })

  it('classe réellement les quatre couches — sinon la règle serait muette', () => {
    // Garde contre l'inertie : si les motifs de chemin ne matchaient plus la
    // structure de `docs/architecture.md`, les assertions ci-dessus resteraient
    // vertes pour les fichiers autorisés et rouges pour les autres. Celle-ci
    // constate que les onze fixtures ont bien été analysées.
    expect(report.size).toBe(
      FORBIDDEN_EDGES.length + FORBIDDEN_EXTERNALS.length + ALLOWED_FILES.length,
    )
  })
})

/**
 * Surface client de `@repo/config` (finding N13 de s01).
 *
 * La garde de s01 lisait le fichier et cherchait `/from\s+'([^']+)'/` : elle ne
 * reconnaissait ni les guillemets doubles, ni les spécificateurs nus, ni
 * `require`, ni l'import dynamique. Un `import … from "node:fs"` passait.
 *
 * Les cas ci-dessous ne touchent pas au disque : ils soumettent un contenu à la
 * configuration réelle du dépôt, sous le nom d'un fichier de
 * `packages/config/src`, et vérifient ce qu'elle en dit.
 */
describe('surface client de @repo/config', () => {
  const CLIENT_FILE = 'packages/config/src/env.ts'
  const SERVER_FILE = 'packages/config/src/dotenv.ts'

  let eslint: ESLint

  beforeAll(() => {
    eslint = new ESLint({ cwd: REPO_ROOT })
  })

  const lint = async (code: string, filePath: string): Promise<string[]> => {
    const [result] = await eslint.lintText(code, { filePath })

    return (result?.messages ?? []).map((message) => message.ruleId ?? '')
  }

  it.each([
    ['guillemets simples', "import { readFileSync } from 'node:fs'\nexport const read = readFileSync"],
    ['guillemets doubles', 'import { readFileSync } from "node:fs"\nexport const read = readFileSync'],
    ['spécificateur nu', "import { readFileSync } from 'fs'\nexport const read = readFileSync"],
    ['réexport', "export { readFileSync } from 'node:fs'"],
    ['import d’effet de bord', "import 'node:fs'"],
    ['require', "export const fs = require('node:fs')"],
    ['import dynamique', "export const fs = await import('fs')"],
    ['réexport du chargeur serveur', "export { loadRootEnv } from './dotenv'"],
  ])('refuse un module Node dans la surface client — %s', async (_name, code) => {
    const ruleIds = await lint(code, CLIENT_FILE)

    expect(ruleIds.filter((id) => id.startsWith('no-restricted-'))).not.toEqual([])
  })

  it('laisse le chargeur serveur lire le système de fichiers', async () => {
    // `@repo/config/server` existe pour ça : trop large, la règle interdirait
    // au dépôt de charger son propre `.env`.
    const ruleIds = await lint(
      "import { existsSync } from 'node:fs'\nexport const exists = existsSync",
      SERVER_FILE,
    )

    expect(ruleIds.filter((id) => id.startsWith('no-restricted-'))).toEqual([])
  })
})

/**
 * **Un module n'importe jamais `@repo/db`** (ADR 020), et la règle est celle du
 * lint — pas une expression régulière.
 *
 * La garde livrée par s07 lisait le texte des fichiers et cherchait
 * `from '@repo/db'` : `import type { ModuleSchema } from "@repo/db"`, en
 * guillemets doubles, passait `pnpm test`, `pnpm lint` **et** `pnpm typecheck`,
 * prouvé par mutation en revue. C'est la deuxième fois que ce dépôt se fait
 * prendre par la même classe de défaut (voir la surface client de
 * `@repo/config` ci-dessus) : une règle que la mise en forme défait n'est pas
 * une règle.
 *
 * Les cas ci-dessous soumettent chaque écriture du même import à la
 * configuration **réelle** du dépôt, sous le nom d'un fichier de module. Le
 * dépôt lui-même est balayé ailleurs (`tests/module-registry.test.ts`), avec la
 * même règle : ici on prouve que la règle mord, là qu'aucun fichier ne la viole.
 */
describe('un module ne dépend pas du package de base de données', () => {
  const MODULE_FILE = 'packages/modules/auth/src/infrastructure/probe.ts'

  let eslint: ESLint

  beforeAll(() => {
    eslint = new ESLint({ cwd: REPO_ROOT })
  })

  const ruleIdsFor = async (code: string, filePath: string): Promise<string[]> => {
    const [result] = await eslint.lintText(code, { filePath })

    return (result?.messages ?? []).map((message) => message.ruleId ?? '')
  }

  it.each([
    ['guillemets simples', "import { db } from '@repo/db'\nexport const connection = db"],
    ['guillemets doubles', 'import { db } from "@repo/db"\nexport const connection = db'],
    [
      'import de type en guillemets doubles',
      'import type { ModuleSchema } from "@repo/db"\nexport type Schema = ModuleSchema',
    ],
    ['réexport', "export { db } from '@repo/db'"],
    ['import d’effet de bord', "import '@repo/db'"],
    ['sous-chemin', "import { schema } from '@repo/db/schema'\nexport const s = schema"],
    ['require', "export const db = require('@repo/db')"],
    ['import dynamique', "export const db = await import('@repo/db')"],
    // Un `TemplateLiteral` n'est pas un `Literal` : la première version de la
    // règle AST, qui ne visait que `Literal`, laissait passer les deux écritures
    // ci-dessous — prouvé par mutation en revue, sur `pnpm lint`, `tsc` et
    // `pnpm test`. Troisième fois que ce dépôt se fait prendre par une garde
    // plus étroite que sa description.
    ['import dynamique en accent grave', 'export const db = await import(`@repo/db`)'],
    ['require en accent grave', 'export const db = require(`@repo/db`)'],
    [
      'gabarit interpolé dont le préfixe suffit',
      'export const db = await import(`@repo/db${suffix}`)\ndeclare const suffix: string',
    ],
    // Trouvées en essayant de défaire ma propre correction. La première est la
    // plus gênante : elle est **typée**, elle compile, et elle donne au module
    // le type qu'il cherchait sans qu'aucun `import` n'apparaisse. La seconde
    // était déjà refusée par `@typescript-eslint/no-require-imports` — ce n'est
    // pas la garde d'ADR 020 qui la tenait.
    ['import de type en position d’annotation', "export type S = import('@repo/db').ModuleSchema"],
    ['import-equals', "import db = require('@repo/db')\nexport const connection = db"],
  ])('refuse `@repo/db` dans un module — %s', async (_name, code) => {
    const ruleIds = await ruleIdsFor(code, MODULE_FILE)

    expect(ruleIds.filter((id) => id.startsWith('no-restricted-'))).not.toEqual([])
  })

  // La règle visait `packages/modules/**/*.ts`. Un fichier qu'aucune
  // configuration ne matche n'est pas « autorisé » : il n'est **pas linté du
  // tout**, silencieusement, alors que le `tsconfig` du module l'inclut
  // (`include: ["src"]`, toutes extensions TypeScript). Le premier composant de
  // s08 sortait de la portée sans qu'un seul cas ne rougisse.
  it.each([
    [
      'un composant, en `.tsx`',
      'packages/modules/auth/src/presentation/probe.tsx',
      "import { db } from '@repo/db'\nexport const Connection = () => <p>{String(db)}</p>",
    ],
    [
      'un module ES, en `.mts`',
      'packages/modules/auth/src/infrastructure/probe.mts',
      "import { db } from '@repo/db'\nexport const connection = db",
    ],
    [
      'un module CommonJS, en `.cts`',
      'packages/modules/auth/src/infrastructure/probe.cts',
      "import { db } from '@repo/db'\nexport const connection = db",
    ],
  ])('juge le fichier de module quelle que soit son extension — %s', async (_name, path, code) => {
    const ruleIds = await ruleIdsFor(code, path)

    expect(ruleIds.filter((id) => id.startsWith('no-restricted-'))).not.toEqual([])
  })

  it('laisse le module importer ce dont il a le droit', async () => {
    // Trop large, la règle interdirait au module son propre contrat : elle
    // prouverait alors qu'elle est fausse, pas qu'elle marche.
    const ruleIds = await ruleIdsFor(
      "import { MODULE_ROUTE_PREFIX } from '@repo/core'\nexport const prefix = MODULE_ROUTE_PREFIX",
      MODULE_FILE,
    )

    expect(ruleIds.filter((id) => id.startsWith('no-restricted-'))).toEqual([])
  })

  it('laisse le point de composition, lui, brancher la connexion', async () => {
    // C'est tout le sens d'ADR 020 : la connexion est **injectée** par
    // l'application. Refuser `@repo/db` partout casserait le seul endroit qui
    // a le droit de la construire.
    const ruleIds = await ruleIdsFor(
      "import { db } from '@repo/db'\nexport const connection = db",
      'apps/web/lib/probe.ts',
    )

    expect(ruleIds.filter((id) => id.startsWith('no-restricted-'))).toEqual([])
  })
})

/**
 * **`packages/ui` est la seule frontière avec le socle de composants** (ADR 022).
 *
 * L'ADR 022 remplace Base UI par Radix parce que Base UI n'a jamais publié de
 * version stable, et il garde de l'ADR 009 la clause qui rend le choix
 * réversible : aucun module, aucune application n'importe le socle
 * directement. C'est cette clause qui borne le coût du basculement le jour où
 * Base UI se stabilisera — sans elle, changer de socle redevient un refactor
 * traversant.
 *
 * Une intention ne se vérifie pas. Voici la commande qui échoue.
 *
 * **Chaque site de déclaration a ses cas.** En configuration plate, la garde
 * n'est pas déclarée une fois : elle est reprise par les quatre blocs qui
 * occupent `no-restricted-syntax`. La revue de s08 a mesuré que deux de ces
 * sites pouvaient être vidés sans qu'un seul test ne bouge — un seul chemin de
 * fichier était éprouvé. Les cas ci-dessous croisent donc les sites et les
 * écritures : `apps/**`, `packages/**`, `packages/config/src`,
 * `packages/modules/**`, `tooling/**`.
 *
 * **Ce qui est balayé**, cas par cas, et rien de plus : import statique, import
 * de type, réexport, sous-chemin, import dynamique, gabarit, l'import de type
 * en position d'annotation (`import('@radix-ui/…').P`) et le paquet unifié
 * `radix-ui` — croisés avec les neuf emplacements ci-dessous, plus les
 * extensions `.tsx`, `.mts`, `.mjs` et `.jsx`. L'écriture en position
 * d'annotation passait partout avant cette correction, module compris, alors
 * que la même était déjà fermée pour `@repo/db`.
 *
 * **Non balayé, et connu** : un spécificateur reconstruit à l'exécution
 * (`import('@radix' + '-ui/…')`), les fichiers du harnais de test (`tests/`,
 * `e2e/`, `packages/*\/src/**\/*.test.ts`) — exception nommée, où
 * `no-restricted-imports` est éteint et qu'aucune portée `no-restricted-syntax`
 * ne vise —, et `templates/` comme `docs/`, qui ne portent aucune source
 * aujourd'hui. `generated/` y figurait aussi jusqu'à la seconde passe de revue :
 * il est désormais dans la portée. Mesuré une écriture à la fois contre la
 * configuration réelle, le 31 août 2026.
 */
describe('le socle de composants ne sort pas de packages/ui (ADR 022)', () => {
  let eslint: ESLint

  beforeAll(() => {
    eslint = new ESLint({ cwd: REPO_ROOT })
  })

  const ruleIdsFor = async (code: string, filePath: string): Promise<string[]> => {
    const [result] = await eslint.lintText(code, { filePath })

    return (result?.messages ?? []).map((message) => message.ruleId ?? '')
  }

  /** Les blocs qui déclarent la garde, par un fichier de chacun. */
  const SITES = [
    ['un écran de l’application', 'apps/web/app/probe.ts'],
    ['un package', 'packages/core/src/probe.ts'],
    ['la surface client de la configuration', 'packages/config/src/probe.ts'],
    ['un module', 'packages/modules/auth/src/presentation/probe.ts'],
    ['le tooling', 'tooling/eslint/probe.ts'],
    // Ces trois-là n'étaient dans aucune portée, mesuré en revue.
    ['la configuration du projet', 'config/probe.ts'],
    ['un script', 'scripts/probe.ts'],
    ['un fichier de premier niveau', 'probe.ts'],
    // Le quatrième, mesuré en seconde passe : `generated/` est versionné,
    // compilé, et réécrit par `pnpm ks toggle`. « Ces fichiers ne peuvent pas
    // contenir de JSX » est exactement l'affirmation d'exhaustivité que
    // `AGENTS.md` interdit — le gabarit de génération peut changer, la portée
    // du lint ne doit pas dépendre de ce qu'il produit aujourd'hui.
    ['un baril généré', 'generated/schema/probe.ts'],
  ] as const

  const WRITINGS = [
    [
      'import statique',
      "import * as Dialog from '@radix-ui/react-dialog'\nexport const Root = Dialog.Root",
    ],
    [
      'guillemets doubles',
      'import * as Dialog from "@radix-ui/react-dialog"\nexport const Root = Dialog.Root',
    ],
    ['réexport', "export { Root } from '@radix-ui/react-dialog'"],
    [
      'sous-chemin',
      "import { Root } from '@radix-ui/react-dialog/dist/index.mjs'\nexport const R = Root",
    ],
    [
      'import de type',
      "import type { DialogProps } from '@radix-ui/react-dialog'\nexport type P = DialogProps",
    ],
    ['import dynamique', "export const load = () => import('@radix-ui/react-dialog')"],
    ['import dynamique en accent grave', 'export const load = () => import(`@radix-ui/react-dialog`)'],
    // Trouvée en essayant de défaire la garde : elle est **typée**, elle
    // compile, elle donne le type Radix sans qu'aucun `import` n'apparaisse.
    // C'est textuellement l'écriture déjà fermée pour `@repo/db`.
    [
      'import de type en position d’annotation',
      "export type P = import('@radix-ui/react-dialog').DialogProps",
    ],
    // Le paquet unifié : ce que la documentation de Radix installe aujourd'hui.
    // Il n'est pas dans le dépôt ; sans ce motif, un `pnpm add radix-ui`
    // contournait la garde entière.
    ['le paquet unifié', "import { Dialog } from 'radix-ui'\nexport const D = Dialog"],
  ] as const

  it.each(
    SITES.flatMap(([site, path]) =>
      WRITINGS.map(([writing, code]) => [`${site} — ${writing}`, path, code] as const),
    ),
  )('refuse Radix hors de packages/ui — %s', async (_name, path, code) => {
    const ruleIds = await ruleIdsFor(code, path)

    expect(ruleIds.filter((id) => id.startsWith('no-restricted-'))).not.toEqual([])
  })

  // Un fichier qu'aucune portée ne nomme n'est pas « autorisé » : il n'est pas
  // linté du tout. La portée de `apps/**` s'arrêtait à `*.{ts,tsx}` quand celle
  // de `packages/**` allait jusqu'à `.mts` et `.cts` — mesuré en revue.
  it.each([
    [
      'un composant d’application, en `.tsx`',
      'apps/web/app/probe.tsx',
      "import * as Dialog from '@radix-ui/react-dialog'\nexport const P = () => <Dialog.Root />",
    ],
    [
      'un module ES d’application, en `.mts`',
      'apps/web/lib/probe.mts',
      "import * as Dialog from '@radix-ui/react-dialog'\nexport const Root = Dialog.Root",
    ],
    [
      'un module CommonJS d’application, en `.cts`',
      'apps/web/lib/probe.cts',
      "export const load = () => import('@radix-ui/react-dialog')",
    ],
    [
      'un composant de module, en `.tsx`',
      'packages/modules/auth/src/presentation/probe.tsx',
      "import * as Dialog from '@radix-ui/react-dialog'\nexport const P = () => <Dialog.Root />",
    ],
    // Le dépôt n'a que deux sources JavaScript, toutes deux de configuration.
    // Une portée qui repose sur le fait qu'on n'en écrira pas d'autre n'est pas
    // une portée : Next compile un `.mjs` d'application comme le reste.
    [
      'un module ES d’application, en `.mjs`',
      'apps/web/lib/probe.mjs',
      "import * as Dialog from '@radix-ui/react-dialog'\nexport const Root = Dialog.Root",
    ],
    [
      'un composant d’application, en `.jsx`',
      'apps/web/app/probe.jsx',
      "export const load = () => import('@radix-ui/react-dialog')",
    ],
  ])('juge le fichier quelle que soit son extension — %s', async (_name, path, code) => {
    const ruleIds = await ruleIdsFor(code, path)

    expect(ruleIds.filter((id) => id.startsWith('no-restricted-'))).not.toEqual([])
  })

  it.each([
    [
      'import statique',
      "import * as Dialog from '@radix-ui/react-dialog'\nexport const Root = Dialog.Root",
    ],
    // Le bloc qui porte la règle des formulaires vise aussi `packages/ui` :
    // s'il y ramenait la garde de Radix, le socle ne pourrait plus exister.
    ['import dynamique', "export const load = () => import('@radix-ui/react-dialog')"],
  ])('laisse packages/ui l’importer — %s', async (_name, code) => {
    // Trop large, la règle interdirait au socle de composants d'exister : elle
    // prouverait qu'elle est fausse, pas qu'elle marche.
    const ruleIds = await ruleIdsFor(code, 'packages/ui/src/components/sheet.tsx')

    expect(ruleIds.filter((id) => id.startsWith('no-restricted-'))).toEqual([])
  })

  it('garde l’interdit d’importer une application, là où il portait déjà', async () => {
    // La garde de Radix redéfinit `no-restricted-imports` sur `packages/**` :
    // en configuration plate, une seconde déclaration **remplace** les options
    // de la première. Sans ce cas, ajouter Radix aurait effacé en silence
    // l'interdit de `libraryConfig` sur tous les packages.
    const ruleIds = await ruleIdsFor(
      "import { GET } from '@repo/web'\nexport const handler = GET",
      'packages/core/src/probe.ts',
    )

    expect(ruleIds).toContain('no-restricted-imports')
  })
})

/**
 * **Un `<form>` déclare toujours sa méthode** (C1 de la revue de s08).
 *
 * Un formulaire sans `method` est un `GET` vers l'URL courante : c'est le
 * défaut du navigateur, et il s'applique chaque fois que le gestionnaire React
 * n'est pas encore attaché. Mesuré en revue, sur l'écran de compte comme sur
 * celui de connexion :
 * `/account?currentPassword=…&newPassword=…`. Le secret atterrit alors dans le
 * journal d'accès, dans l'historique et dans le `Referer` des requêtes
 * suivantes — `docs/security.md` §5.
 *
 * La correction ne pouvait pas être « chaque écran y pense » : c'est la
 * fondation dont quinze écrans hériteront. Voici la commande qui échoue, sur
 * les quatre sites qui déclarent `no-restricted-syntax`, `packages/ui` compris
 * — c'est là que vivront les composants `Form` du design system.
 *
 * **Ce qui est balayé** : l'absence d'un `method` écrit en toutes lettres sur
 * un élément `<form>` en JSX — attribut manquant, étalé depuis un objet,
 * calculé, ou `undefined` —, sur les dix emplacements ci-dessous, `.tsx` et
 * `.jsx`. **Non balayé, et connu** : un `<form>` construit par `createElement`,
 * et les fichiers du harnais de test (`tests/`, `e2e/`), qu'aucune portée ne
 * vise et qui ne livrent pas d'écran. La **valeur** n'est pas jugée :
 * `method="get"` reste légitime pour un formulaire sans secret — la règle exige
 * que le choix soit écrit, pas qu'il soit `post`.
 */
describe('un formulaire déclare sa méthode', () => {
  let eslint: ESLint

  beforeAll(() => {
    eslint = new ESLint({ cwd: REPO_ROOT })
  })

  const ruleIdsFor = async (code: string, filePath: string): Promise<string[]> => {
    const [result] = await eslint.lintText(code, { filePath })

    return (result?.messages ?? []).map((message) => message.ruleId ?? '')
  }

  const form = (attributes: string): string =>
    `export const P = () => (\n  <form ${attributes}>\n    <input name="password" type="password" />\n    <button type="submit">Envoyer</button>\n  </form>\n)`

  const SITES = [
    ['un écran de l’application', 'apps/web/app/probe.tsx'],
    ['un composant du design system', 'packages/ui/src/components/probe.tsx'],
    ['un composant de module', 'packages/modules/auth/src/presentation/probe.tsx'],
    ['un package', 'packages/core/src/probe.tsx'],
    ['la surface client de la configuration', 'packages/config/src/probe.tsx'],
    ['la configuration du projet', 'config/probe.tsx'],
    ['un script', 'scripts/probe.tsx'],
    ['un fichier de premier niveau', 'probe.tsx'],
    ['un baril généré', 'generated/probe.tsx'],
    ['un écran en `.jsx`', 'apps/web/app/probe.jsx'],
  ] as const

  it.each(SITES)('refuse un formulaire sans `method` — %s', async (_name, path) => {
    const ruleIds = await ruleIdsFor(form('onSubmit={submit}'), path)

    expect(ruleIds).toContain('no-restricted-syntax')
  })

  // Trouvés en essayant de défaire la règle : trois écritures qui **ont** un
  // `method` sans que le sélecteur puisse dire ce qu'il vaut. Les accepter
  // ferait de la garde une formalité.
  it.each([
    ['un attribut étalé', '{...props}'],
    ['une valeur calculée', 'method={methodOf(props)}'],
    ['une valeur absente', 'method={undefined}'],
  ])('refuse un `method` que le sélecteur ne peut pas lire — %s', async (_name, attributes) => {
    const ruleIds = await ruleIdsFor(form(attributes), 'apps/web/app/probe.tsx')

    expect(ruleIds).toContain('no-restricted-syntax')
  })

  it.each(SITES)('laisse passer un formulaire qui déclare `post` — %s', async (_name, path) => {
    // Trop large, la règle interdirait les formulaires : elle prouverait
    // qu'elle est fausse, pas qu'elle marche.
    const ruleIds = await ruleIdsFor(form('method="post" onSubmit={submit}'), path)

    expect(ruleIds).not.toContain('no-restricted-syntax')
  })

  it('laisse passer `method="get"` — un formulaire sans secret en a le droit', async () => {
    // La règle exige que le choix soit écrit, pas qu'il soit `post` : une
    // recherche en `GET` est légitime, et une garde trop large se fait
    // désactiver au premier cas honnête.
    const ruleIds = await ruleIdsFor(form('method="get"'), 'apps/web/app/probe.tsx')

    expect(ruleIds).not.toContain('no-restricted-syntax')
  })
})

/**
 * Sens des dépendances entre packages et applications.
 *
 * `apps/web` dépend de `@repo/config` et `@repo/db` ; l'inverse rendrait ces
 * packages indéployables ailleurs et créerait un cycle que `pnpm` accepterait
 * sans rien dire.
 */
describe('un package ne dépend pas d’une application', () => {
  let eslint: ESLint

  beforeAll(() => {
    eslint = new ESLint({ cwd: REPO_ROOT })
  })

  const ruleIdsFor = async (code: string, filePath: string): Promise<string[]> => {
    const [result] = await eslint.lintText(code, { filePath })

    return (result?.messages ?? []).map((message) => message.ruleId ?? '')
  }

  it('refuse un import de `@repo/web` depuis un package', async () => {
    const ruleIds = await ruleIdsFor(
      "import { GET } from '@repo/web'\nexport const handler = GET",
      'packages/db/src/probe.ts',
    )

    expect(ruleIds).toContain('no-restricted-imports')
  })

  it('laisse l’application importer les packages du dépôt', async () => {
    const ruleIds = await ruleIdsFor(
      "import { getEnv } from '@repo/config'\nexport const env = getEnv",
      'apps/web/app/probe.ts',
    )

    expect(ruleIds).not.toContain('no-restricted-imports')
  })

  /**
   * **Le même interdit, dans un composant.**
   *
   * La portée s'arrêtait à `packages/**\/*.ts`. Un `.tsx` de package n'était
   * pas « autorisé » : aucune configuration ne le matchait, donc ESLint ne le
   * lintait **pas du tout** — zéro message, quoi qu'on y écrive. s08 apporte
   * les premiers composants React de package (`packages/ui`, puis le
   * `presentation/` d'un module) : sans cette extension, la règle serait morte
   * en silence le jour même où elle devient utile. Signalé par l'implémenteur
   * de s07, mesuré ici avant d'être corrigé.
   *
   * Ce qui a été mesuré, et rien de plus : les règles de `baseConfig`
   * atteignaient déjà les `.tsx` (le preset `typescript-eslint` porte ses
   * propres `files`), une variable inutilisée y était bien signalée. Ce sont
   * les blocs dont la portée est écrite en `.ts` — `libraryConfig` ici — qui
   * s'arrêtaient à la porte.
   */
  it('juge un composant de package, en `.tsx`', async () => {
    const ruleIds = await ruleIdsFor(
      "import { HomePage } from '../../../apps/web/app/page'\n" +
        'export const Probe = () => <p>{String(HomePage)}</p>',
      'packages/ui/src/probe.tsx',
    )

    expect(ruleIds).toContain('no-restricted-imports')
  })
})

/**
 * Portée de l'exception nommée du harnais de test.
 *
 * `vitest.config.ts` autorise deux emplacements, dont un motif à double
 * astérisque qui couvre les futurs modules (`packages/modules/<module>/src/`).
 * L'exception du lint, elle, est volontairement **plus étroite** : un seul
 * astérisque, donc les packages de premier niveau uniquement.
 *
 * C'est un arbitrage, pas un astérisque oublié. L'exception existe pour que les
 * tests du harnais puissent observer le câblage qu'ils vérifient ; elle n'a
 * aucune raison de s'étendre à l'intérieur d'un module, où la règle de couches
 * est précisément ce qui a le plus de valeur. Un test de `domain` qui a besoin
 * d'`infrastructure` ne signale pas une règle trop stricte, il signale un
 * `domain` qui n'est plus pur. Élargir maintenant relâcherait le contrôle avant
 * d'avoir un seul cas qui le justifie.
 *
 * Ces assertions rendent la décision opposable : l'élargir fait rougir la
 * seconde.
 */
describe('portée de l’exception du harnais de test', () => {
  let eslint: ESLint

  beforeAll(() => {
    eslint = new ESLint({ cwd: REPO_ROOT })
  })

  const boundariesSeverity = async (file: string): Promise<unknown> => {
    const config = (await eslint.calculateConfigForFile(join(REPO_ROOT, file))) as {
      rules?: Record<string, unknown[]>
    }

    return config.rules?.['boundaries/dependencies']?.[0]
  }

  it.each(['tests/lint-rules.test.ts', 'e2e/health.spec.ts', 'packages/config/src/env.test.ts'])(
    'exempte le harnais transverse — %s',
    async (file) => {
      expect(await boundariesSeverity(file)).toBe(0)
    },
  )

  it('juge le test d’un module comme le module lui-même', async () => {
    expect(await boundariesSeverity('packages/modules/orders/src/domain/order.test.ts')).toBe(2)
  })
})

/**
 * **Un appel réseau sortant d'un module passe par la porte bornée** (s12,
 * `docs/reliability.md` §3 : « tout appel réseau sortant porte un délai
 * d'attente explicite »).
 *
 * La règle existe parce que la conformité d'aujourd'hui ne dit rien de demain :
 * les deux bornes posées par s12 couvrent les appels **connus** — les deux
 * lectures de profil GitHub par leur crochet, et le reste par l'échéance du
 * rappel. Un appel sortant écrit plus tard, ailleurs dans le module, hériterait
 * de la seconde sans que personne ne le remarque, et n'aurait ni reprise, ni
 * délai propre. « Quelle commande échoue si je casse ça ? » : celle-ci,
 * `pnpm lint`.
 *
 * La porte est `infrastructure/oauth-outbound.ts`, et elle est la seule.
 */
describe('un module n’appelle pas le réseau à main nue', () => {
  const MODULE_FILE = 'packages/modules/auth/src/infrastructure/probe.ts'
  const GATE_FILE = 'packages/modules/auth/src/infrastructure/oauth-outbound.ts'

  let eslint: ESLint

  beforeAll(() => {
    eslint = new ESLint({ cwd: REPO_ROOT })
  })

  const ruleIdsFor = async (code: string, filePath: string): Promise<string[]> => {
    const [result] = await eslint.lintText(code, { filePath })

    return (result?.messages ?? []).map((message) => message.ruleId ?? '')
  }

  it.each([
    ['appel nu', "export const profil = async () => await fetch('https://api.example.test/user')"],
    [
      'par `globalThis`',
      "export const profil = async () => await globalThis.fetch('https://api.example.test/user')",
    ],
    [
      'dans la présentation',
      "export const profil = async () => await fetch('https://api.example.test/user')",
    ],
  ])('refuse `fetch` dans un module — %s', async (_name, code) => {
    const ruleIds = await ruleIdsFor(code, MODULE_FILE)

    expect(ruleIds.filter((id) => id.startsWith('no-restricted-'))).not.toEqual([])
  })

  it('laisse la porte bornée appeler le réseau : c’est sa raison d’être', async () => {
    const ruleIds = await ruleIdsFor(
      "export const call = async (url: string) => await fetch(url, { signal: AbortSignal.timeout(1) })",
      GATE_FILE,
    )

    expect(ruleIds.filter((id) => id.startsWith('no-restricted-'))).toEqual([])
  })

  it('n’interdit pas un appel qui passe par la porte', async () => {
    // Trop large, la règle refuserait l'usage même qu'elle impose : elle
    // prouverait qu'elle est fausse, pas qu'elle marche.
    const ruleIds = await ruleIdsFor(
      "declare const boundedFetch: (url: string) => Promise<Response | null>\nexport const profil = async () => await boundedFetch('https://api.example.test/user')",
      MODULE_FILE,
    )

    expect(ruleIds.filter((id) => id.startsWith('no-restricted-'))).toEqual([])
  })

  it('laisse l’application, elle, appeler le réseau', async () => {
    const ruleIds = await ruleIdsFor(
      "export const ping = async () => await fetch('https://api.example.test/')",
      'apps/web/lib/probe.ts',
    )

    expect(ruleIds.filter((id) => id.startsWith('no-restricted-'))).toEqual([])
  })
})

/**
 * **Le périmètre organisationnel, rendu exécutable** (constat F2 de la revue de
 * s15).
 *
 * La story affirmait que le module rend « l'oubli du périmètre impossible ».
 * La revue a mesuré le contraire : un fichier neuf posé dans
 * `infrastructure/`, lisant `organization` par un identifiant venu du corps de
 * la requête, passait `pnpm typecheck`, `pnpm lint` et les 811 tests. La marque
 * de type ne protège que les deux écritures qui la déclarent ; une **lecture**
 * n'était gardée par rien.
 *
 * La garde est donc déplacée là où une commande la tient : **une seule porte de
 * lecture**, `infrastructure/scoped-reads.ts`, dont chaque fonction prend le
 * propriétaire en premier paramètre — donc ne peut pas l'omettre. Partout
 * ailleurs dans le module, appeler `select`, `from` ou `execute` sur une
 * connexion est refusé par `pnpm lint`.
 *
 * **Ce que cette garde ne tient pas**, dit plutôt que sous-entendu : à
 * l'intérieur de la porte elle-même, rien n'oblige le prédicat à porter le
 * compte — c'est `tests/organizations.test.ts` (« cesse de résoudre vers une
 * organisation qu'on a quittée ») qui l'éprouve, par mutation. Et un appel
 * dont le nom de méthode n'est pas visible à la syntaxe
 * (`const { select } = db`) n'est pas vu. La garde borne la surface à un
 * fichier — dix lectures à ce jour ; elle ne lit pas le SQL.
 */
describe('une lecture du module `organizations` passe par sa porte unique', () => {
  const PERIMETER = 'scoped-reads.ts'

  /** La sonde de la revue, à la lettre : une lecture sans appartenance. */
  const UNSCOPED_READ = [
    "import { eq } from 'drizzle-orm'",
    "import { organization } from '../schema'",
    'export const readAnyOrganization = async (db: any, body: { organizationId: string }) =>',
    '  await db.select().from(organization).where(eq(organization.id, body.organizationId))',
  ].join('\n')

  let eslint: ESLint

  beforeAll(() => {
    eslint = new ESLint({ cwd: REPO_ROOT })
  })

  const messagesFor = async (code: string, filePath: string): Promise<string[]> => {
    const [result] = await eslint.lintText(code, { filePath })

    return (result?.messages ?? []).map((message) => message.message)
  }

  it.each([
    ['un fichier neuf d’infrastructure', 'infrastructure/probe.ts'],
    ['la couche application', 'application/probe.ts'],
    ['la couche présentation', 'presentation/probe.ts'],
    // Le fichier des repositories est le plus tentant : c'est là que vit déjà
    // la connexion. Il n'a pas de passe-droit — il délègue ses lectures.
    [
      'le fichier des repositories lui-même',
      'infrastructure/drizzle-organization-repositories.ts',
    ],
  ])('refuse la lecture non périmétrée — %s', async (_name, path) => {
    const messages = await messagesFor(
      UNSCOPED_READ,
      `packages/modules/organizations/src/${path}`,
    )

    expect(messages.filter((message) => message.includes(PERIMETER))).not.toEqual([])
  })

  it('laisse la porte de lecture lire, sans quoi la règle serait fausse', async () => {
    const messages = await messagesFor(
      UNSCOPED_READ,
      'packages/modules/organizations/src/infrastructure/scoped-reads.ts',
    )

    expect(messages.filter((message) => message.includes(PERIMETER))).toEqual([])
  })

  it('ne juge pas les autres modules, qui n’ont pas ce périmètre', async () => {
    const messages = await messagesFor(
      UNSCOPED_READ,
      'packages/modules/auth/src/infrastructure/probe.ts',
    )

    expect(messages.filter((message) => message.includes(PERIMETER))).toEqual([])
  })

  /**
   * En configuration plate, un second bloc `no-restricted-syntax` sur les mêmes
   * fichiers **remplace** les options du premier : sans reprise explicite, le
   * module des organisations serait le seul du dépôt où `@repo/db` et un
   * `<form>` sans `method` passeraient. Les deux cas ci-dessous rougissent si la
   * reprise disparaît.
   */
  it.each([
    [
      '`@repo/db` reste refusé',
      'infrastructure/probe.ts',
      "import { db } from '@repo/db'\nexport const connection = db",
      '@repo/db',
    ],
    [
      'un `<form>` sans méthode reste refusé',
      'presentation/probe.tsx',
      'export const Probe = () => <form action="/x" />',
      'method',
    ],
  ])('garde les interdits que ce bloc aurait pu écraser — %s', async (_n, path, code, needle) => {
    const messages = await messagesFor(code, `packages/modules/organizations/src/${path}`)

    expect(messages.filter((message) => message.includes(needle))).not.toEqual([])
  })

  /**
   * **L'élargissement du tour de correction, et sa borne** (s16, F1).
   *
   * Fermer la course du dernier propriétaire demande `pg_advisory_xact_lock`,
   * qui s'appelle par `execute`. Un seul fichier l'obtient —
   * `infrastructure/transaction-locks.ts` — et il n'obtient que celui-là : une
   * lecture de table y reste refusée, et `execute` reste refusé partout
   * ailleurs. Sans ces trois cas, « la porte s'élargit d'un cran » serait une
   * phrase, pas une borne.
   */
  const LOCK_FILE = 'packages/modules/organizations/src/infrastructure/transaction-locks.ts'
  const ADVISORY_LOCK = [
    "import { sql } from 'drizzle-orm'",
    'export const lock = async (db: any, id: string) =>',
    '  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`)',
  ].join('\n')

  it('laisse le fichier des verrous prendre un verrou consultatif', async () => {
    expect(
      (await messagesFor(ADVISORY_LOCK, LOCK_FILE)).filter((message) =>
        message.includes(PERIMETER),
      ),
    ).toEqual([])
  })

  it('refuse quand même la lecture d’une table dans le fichier des verrous', async () => {
    expect(
      (await messagesFor(UNSCOPED_READ, LOCK_FILE)).filter((message) =>
        message.includes(PERIMETER),
      ),
    ).not.toEqual([])
  })

  it('refuse `execute` partout ailleurs dans le module', async () => {
    const messages = await messagesFor(
      ADVISORY_LOCK,
      'packages/modules/organizations/src/infrastructure/drizzle-organization-repositories.ts',
    )

    expect(messages.filter((message) => message.includes(PERIMETER))).not.toEqual([])
  })
})

/**
 * **`@repo/module-auth` ne s'importe que dans deux fichiers du module**
 * (revue de s16, F9).
 *
 * L'`AGENTS.md` du module l'écrivait déjà — `src/schema.ts` pour les clés
 * étrangères, `infrastructure/scoped-reads.ts` pour la jointure qui donne un
 * nom lisible à un membre — mais aucune commande ne le tenait : un troisième
 * fichier qui l'importerait ne faisait rougir rien. Or c'est cette borne qui
 * rend l'absence d'énumération de comptes **structurelle** : les lectures
 * partent d'un identifiant de compte, jamais d'une adresse, et la surface à
 * relire pour s'en assurer tient dans deux fichiers.
 */
describe('le module `organizations` n’importe `@repo/module-auth` que dans deux fichiers', () => {
  const AUTH_IMPORT = [
    "import { authUser } from '@repo/module-auth'",
    'export const table = authUser',
  ].join('\n')

  let eslint: ESLint

  beforeAll(() => {
    eslint = new ESLint({ cwd: REPO_ROOT })
  })

  const messagesFor = async (filePath: string): Promise<string[]> => {
    const [result] = await eslint.lintText(AUTH_IMPORT, { filePath })

    return (result?.messages ?? []).map((message) => message.message)
  }

  const names = (messages: readonly string[]): readonly string[] =>
    messages.filter((message) => message.includes('@repo/module-auth'))

  it.each([
    ['un fichier neuf d’infrastructure', 'infrastructure/probe.ts'],
    ['la couche application', 'application/probe.ts'],
    ['la couche présentation', 'presentation/probe.ts'],
    ['le fichier des repositories', 'infrastructure/drizzle-organization-repositories.ts'],
    ['le point de composition du module', 'module.ts'],
  ])('le refuse — %s', async (_name, path) => {
    expect(names(await messagesFor(`packages/modules/organizations/src/${path}`))).not.toEqual([])
  })

  it.each([
    ['le schéma, pour les clés étrangères', 'schema.ts'],
    ['la porte de lecture, pour la jointure', 'infrastructure/scoped-reads.ts'],
  ])('le permet — %s', async (_name, path) => {
    expect(names(await messagesFor(`packages/modules/organizations/src/${path}`))).toEqual([])
  })

  it('ne juge pas les autres modules, qui n’ont pas cette borne', async () => {
    expect(names(await messagesFor('packages/modules/marketing/src/probe.ts'))).toEqual([])
  })

  it('garde les interdits que ce bloc aurait pu écraser', async () => {
    // Même piège qu'ailleurs : en configuration plate, une seconde déclaration
    // de `no-restricted-imports` **remplace** la première. Sans reprise, ce
    // module serait le seul où un import de Radix passerait (ADR 022).
    const [result] = await eslint.lintText(
      "import { Dialog } from '@radix-ui/react-dialog'\nexport const D = Dialog",
      { filePath: 'packages/modules/organizations/src/presentation/probe.ts' },
    )

    expect(
      (result?.messages ?? []).filter((message) => message.message.includes('packages/ui')),
    ).not.toEqual([])
  })
})

/**
 * **La matrice des rôles est écrite une fois** (revue de s17, F4).
 *
 * L'`AGENTS.md` du module l'écrivait — « aucune comparaison de rôle hors de
 * `domain/permissions.ts` » — et son propre commit la démentait trois fois : un
 * `role === 'owner'` dans le `.tsx` de l'écran et deux dans `domain/message-keys.ts`.
 * Aucune commande ne la tenait : c'était de la documentation, pas une règle
 * (ADR 013). Elle en est une depuis ce bloc — la comparaison à un rôle littéral
 * est refusée partout dans le module **sauf** dans le fichier qui décide, et la
 * notion d'« ce rôle donne la propriété » y est devenue une fonction nommée.
 *
 * **Ce qu'elle ne tient pas**, dit plutôt que sous-entendu : elle voit les
 * comparaisons à un littéral (`===`, `!==`, `==`, `!=`), pas un `switch (role)`,
 * pas une valeur passée par une variable, pas un `includes`. Elle borne la
 * forme la plus probable, celle qui a été écrite trois fois ici.
 */
describe('la matrice des rôles ne se compare qu’à un endroit', () => {
  const ROLE_COMPARISON = [
    "import type { OrganizationRole } from '../domain/organization'",
    'export const variantFor = (role: OrganizationRole) =>',
    "  role === 'owner' ? 'outline' : 'ghost'",
  ].join('\n')

  let eslint: ESLint

  beforeAll(() => {
    eslint = new ESLint({ cwd: REPO_ROOT })
  })

  const roleMessages = async (code: string, filePath: string): Promise<string[]> => {
    const [result] = await eslint.lintText(code, { filePath })

    return (result?.messages ?? [])
      .map((message) => message.message)
      .filter((message) => message.includes('domain/permissions.ts'))
  }

  it.each([
    ['la couche présentation, en `.tsx`', 'presentation/probe.tsx'],
    ['un cas d’usage', 'application/probe.ts'],
    ['un repository', 'infrastructure/probe.ts'],
    // Le `domain` n'a pas de passe-droit non plus : les deux comparaisons de
    // trop de s17 y vivaient, dans `message-keys.ts`.
    ['un autre fichier du domaine', 'domain/probe.ts'],
  ])('refuse une comparaison de rôle — %s', async (_name, path) => {
    expect(
      await roleMessages(ROLE_COMPARISON, `packages/modules/organizations/src/${path}`),
    ).not.toEqual([])
  })

  it('la laisse au fichier qui décide, sans quoi la règle serait fausse', async () => {
    expect(
      await roleMessages(
        ROLE_COMPARISON,
        'packages/modules/organizations/src/domain/permissions.ts',
      ),
    ).toEqual([])
  })

  it('ne juge pas les autres modules, qui n’ont pas cette matrice', async () => {
    expect(
      await roleMessages(ROLE_COMPARISON, 'packages/modules/auth/src/domain/probe.ts'),
    ).toEqual([])
  })

  it('garde les interdits que ce bloc aurait pu écraser', async () => {
    // En configuration plate, une déclaration de plus de `no-restricted-syntax`
    // **remplace** la précédente : le fichier qui décide doit garder la porte de
    // lecture et les interdits communs.
    const messages = await new ESLint({ cwd: REPO_ROOT })
      .lintText(
        [
          "import { organization } from '../schema'",
          'export const read = async (db: any) => await db.select().from(organization)',
        ].join('\n'),
        { filePath: 'packages/modules/organizations/src/domain/permissions.ts' },
      )
      .then(([result]) => (result?.messages ?? []).map((message) => message.message))

    expect(messages.filter((message) => message.includes('scoped-reads.ts'))).not.toEqual([])
  })
})
