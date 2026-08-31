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
 * Base UI se stabilise — sans elle, changer de socle redevient un refactor
 * traversant.
 *
 * Une intention ne se vérifie pas. Voici la commande qui échoue.
 *
 * **Ce qui est balayé**, cas par cas, et rien de plus : import statique et
 * import de type, réexport, import d'effet de bord, sous-chemin, import
 * dynamique — en guillemets simples et doubles. Non balayé, et connu : un
 * spécificateur reconstruit à l'exécution (`import('@radix' + '-ui/…')`), et
 * les fichiers sous l'exception nommée du harnais de test (`tests/`, `e2e/`,
 * `packages/*\/src/**\/*.test.ts`), où `no-restricted-imports` est éteint. Le
 * périmètre couvert est `apps/**`, `packages/**` et `tooling/**`, sauf
 * `packages/ui`.
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

  it.each([
    [
      'un composant de module',
      'packages/modules/auth/src/presentation/probe.tsx',
      "import * as Dialog from '@radix-ui/react-dialog'\nexport const P = () => <Dialog.Root />",
    ],
    [
      'un écran de l’application',
      'apps/web/app/probe.tsx',
      'import * as Dialog from "@radix-ui/react-dialog"\nexport const P = () => <Dialog.Root />',
    ],
    [
      'un sous-chemin',
      'apps/web/app/probe.ts',
      "import { Root } from '@radix-ui/react-dialog/dist/index.mjs'\nexport const R = Root",
    ],
    [
      'un import de type',
      'packages/core/src/probe.ts',
      "import type { DialogProps } from '@radix-ui/react-dialog'\nexport type P = DialogProps",
    ],
    [
      'un import dynamique',
      'packages/modules/auth/src/presentation/probe.ts',
      "export const load = () => import('@radix-ui/react-dialog')",
    ],
  ])('refuse Radix hors de packages/ui — %s', async (_name, path, code) => {
    const ruleIds = await ruleIdsFor(code, path)

    expect(ruleIds.filter((id) => id.startsWith('no-restricted-'))).not.toEqual([])
  })

  it('laisse packages/ui l’importer — c’est sa raison d’être', async () => {
    // Trop large, la règle interdirait au socle de composants d'exister : elle
    // prouverait qu'elle est fausse, pas qu'elle marche.
    const ruleIds = await ruleIdsFor(
      "import * as Dialog from '@radix-ui/react-dialog'\nexport const Root = Dialog.Root",
      'packages/ui/src/components/sheet.tsx',
    )

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
