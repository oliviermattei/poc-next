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
