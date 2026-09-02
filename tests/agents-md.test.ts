import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { scaffoldFiles } from '@repo/cli'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

const read = (...segments: string[]): string =>
  readFileSync(join(REPO_ROOT, ...segments), 'utf8')

/**
 * Racines de packages déclarées par `pnpm-workspace.yaml`.
 *
 * Le motif accepte plusieurs segments : s03 ajoutera `packages/modules/*`, et
 * une expression limitée à un segment aurait laissé tomber cette racine en
 * silence — tous les modules seraient alors passés sous le radar de ce
 * fichier, sans qu'aucune assertion ne rougisse.
 */
export const workspaceRoots = (workspace: string): string[] => {
  const packagesBlock = workspace.slice(
    workspace.indexOf('packages:'),
    workspace.indexOf('\n\n', workspace.indexOf('packages:')),
  )

  return [...packagesBlock.matchAll(/^\s*-\s*['"]?([\w-]+(?:\/[\w-]+)*)\/\*['"]?/gm)].map(
    (match) => match[1] ?? '',
  )
}

const ROOTS = workspaceRoots(read('pnpm-workspace.yaml'))

/**
 * Dossiers de packages, dérivés des motifs de `pnpm-workspace.yaml`.
 *
 * Dérivés, jamais recopiés : une liste écrite à la main rendrait ce test aveugle
 * au package suivant, c'est-à-dire à tous ceux qui restent à écrire.
 */
const packagesUnder = (root: string): string[] =>
  readdirSync(join(REPO_ROOT, root), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${root}/${entry.name}`)
    .filter((directory) => existsSync(join(REPO_ROOT, directory, 'package.json')))

const PACKAGES = ROOTS.flatMap(packagesUnder)

const manifestOf = (directory: string) =>
  JSON.parse(read(directory, 'package.json')) as {
    name?: string
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

/** Noms de packages référencés en `workspace:` par un manifeste du dépôt. */
const workspaceDependencyNames = (): string[] => {
  const manifests = ['.', ...PACKAGES].map(manifestOf)

  return [
    ...new Set(
      manifests.flatMap((manifest) =>
        [
          ...Object.entries(manifest.dependencies ?? {}),
          ...Object.entries(manifest.devDependencies ?? {}),
        ]
          .filter(([, range]) => range.startsWith('workspace:'))
          .map(([name]) => name),
      ),
    ),
  ]
}

/**
 * Règles localisées (ADR 013) : un agent qui ne trouve pas la règle là où il
 * édite en invente une. Chaque package dit donc ce qu'il a le droit d'importer,
 * ce qu'il ne doit jamais contenir, et où vivent ses tests.
 *
 * Le test ne juge pas la prose : il vérifie que les trois questions sont posées,
 * et que la réponse à la première nomme les dépendances réellement déclarées.
 * Ajouter une dépendance sans la documenter fait échouer `pnpm test`.
 */
const REQUIRED_SECTIONS = ['## Imports autorisés', '## Ne doit jamais contenir', '## Tests']

/**
 * Ce que « ce package peut importer » désigne : les dépendances d'exécution,
 * plus les packages du dépôt. L'outillage de développement (types,
 * compilateur) n'entre pas dans le graphe d'import du produit.
 */
const declaredDependencies = (manifest: {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}): string[] => [
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.entries(manifest.devDependencies ?? {})
    .filter(([, range]) => range.startsWith('workspace:'))
    .map(([name]) => name),
]

describe('AGENTS.md par package (ADR 013)', () => {
  // Sans ces deux gardes, un motif de workspace qui ne matche plus rien rendrait
  // toutes les assertions ci-dessous vertes sur zéro package. Un plancher
  // (`length >= 5`) n'y suffit pas : il reste vert si un package disparaît
  // pendant qu'un autre apparaît. Les deux gardes ci-dessous se mettent à jour
  // toutes seules — elles ne recopient aucune liste.
  it.each(ROOTS)('la racine %s déclarée par le workspace porte au moins un package', (root) => {
    expect(packagesUnder(root)).not.toEqual([])
  })

  it('retrouve chaque package référencé en `workspace:` par un manifeste', () => {
    // Un package qui disparaît laisse derrière lui la dépendance
    // `workspace:*` qui le nommait : c'est ce qui rend cette garde sensible à
    // la disparition, là où un simple décompte ne l'était pas.
    const discovered = new Set(PACKAGES.map((directory) => manifestOf(directory).name))

    for (const name of workspaceDependencyNames()) {
      expect([...discovered]).toContain(name)
    }
  })

  it.each(PACKAGES)('%s possède un AGENTS.md', (directory) => {
    expect(existsSync(join(REPO_ROOT, directory, 'AGENTS.md'))).toBe(true)
  })

  it.each(PACKAGES)('%s nomme ses trois règles locales', (directory) => {
    const content = read(directory, 'AGENTS.md')

    for (const section of REQUIRED_SECTIONS) {
      expect(content).toContain(section)
    }
  })

  it.each(PACKAGES)('%s nomme chacune des dépendances qu’il déclare', (directory) => {
    const content = read(directory, 'AGENTS.md')

    for (const dependency of declaredDependencies(manifestOf(directory))) {
      expect(content).toContain(dependency)
    }
  })
})

/**
 * Le squelette généré passe la garde qu'il devra passer une fois écrit.
 *
 * `AGENTS.md` racine ordonne de **générer** un module plutôt que de le
 * deviner : un générateur dont la sortie fait rougir `pnpm test` dès la
 * génération envoie l'agent réparer le dépôt à la main, exactement ce que la
 * commande devait lui éviter. La règle est celle du bloc ci-dessus, appliquée
 * aux fichiers en mémoire — pas une seconde règle écrite pour l'occasion.
 */
describe('le squelette de `ks scaffold` (s41)', () => {
  const files = scaffoldFiles('probe-module')
  const contentOf = (path: string): string => {
    const file = files.find((candidate) => candidate.path === path)

    expect(file, `le squelette écrit ${path}`).toBeDefined()

    return file?.content ?? ''
  }

  const agents = contentOf('AGENTS.md')

  it('nomme ses trois règles locales', () => {
    for (const section of REQUIRED_SECTIONS) {
      expect(agents).toContain(section)
    }
  })

  it('nomme chacune des dépendances que son `package.json` déclare', () => {
    const manifest = JSON.parse(contentOf('package.json')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    for (const dependency of declaredDependencies(manifest)) {
      expect(agents).toContain(dependency)
    }
  })
})

/**
 * `AGENTS.md` racine : le fichier que lit un agent avant de toucher au dépôt.
 * Trois choses doivent y être, faute de quoi il improvise — l'architecture en
 * couches, les règles de module, et les commandes qui vérifient le tout.
 */
describe('AGENTS.md racine', () => {
  const content = read('AGENTS.md')

  it('décrit les quatre couches et leur sens de dépendance', () => {
    for (const layer of ['domain', 'application', 'infrastructure', 'presentation']) {
      expect(content).toContain(layer)
    }
  })

  it('porte les sections opposables en revue', () => {
    for (const section of [
      '## Technical conventions',
      '## Commands',
      '## Security baseline',
      '## Reliability baseline',
      '## Agent-oriented repo',
    ]) {
      expect(content).toContain(section)
    }
  })

  it('nomme chaque commande du dépôt', () => {
    // Une commande que le fichier de règles ne mentionne pas n'existe pas pour
    // un agent : il en réinventera une autre. La liste vient de
    // `package.json`, jamais d'une copie.
    const scripts = Object.keys(
      (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts,
    )

    const commandsSection = content.slice(
      content.indexOf('## Commands'),
      content.indexOf('\n## ', content.indexOf('## Commands')),
    )

    for (const script of scripts) {
      expect(commandsSection).toContain(`pnpm ${script}`)
    }
  })
})

/**
 * Lecture des motifs de `pnpm-workspace.yaml`.
 *
 * `packages/modules/*` n'existe pas encore — s03 l'ajoutera. Une racine à
 * plusieurs segments que l'expression ne reconnaît pas ne fait rien rougir :
 * elle disparaît, et tout le reste de ce fichier reste vert en n'examinant
 * plus rien. D'où ce cas, écrit avant la racine qu'il protège.
 */
describe('motifs de `pnpm-workspace.yaml`', () => {
  it('reconnaît une racine à plusieurs segments', () => {
    const workspace = [
      'packages:',
      '  - "apps/*"',
      '  - "packages/*"',
      '  - "packages/modules/*"',
      '  - "tooling/*"',
      '',
      'onlyBuiltDependencies:',
      '  - esbuild',
      '',
    ].join('\n')

    expect(workspaceRoots(workspace)).toEqual([
      'apps',
      'packages',
      'packages/modules',
      'tooling',
    ])
  })

  it('ne prend pas une entrée de `onlyBuiltDependencies` pour une racine', () => {
    expect(workspaceRoots(read('pnpm-workspace.yaml'))).not.toContain('esbuild')
  })
})
