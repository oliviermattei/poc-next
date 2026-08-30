import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

const read = (...segments: string[]): string =>
  readFileSync(join(REPO_ROOT, ...segments), 'utf8')

/**
 * Dossiers de packages, dérivés des motifs de `pnpm-workspace.yaml`.
 *
 * Dérivés, jamais recopiés : une liste écrite à la main rendrait ce test aveugle
 * au package suivant, c'est-à-dire à tous ceux qui restent à écrire.
 */
const workspacePackages = (): string[] => {
  const workspace = read('pnpm-workspace.yaml')
  const packagesBlock = workspace.slice(
    workspace.indexOf('packages:'),
    workspace.indexOf('\n\n', workspace.indexOf('packages:')),
  )

  const roots = [...packagesBlock.matchAll(/-\s*"?([\w-]+)\/\*"?/g)].map((match) => match[1] ?? '')

  return roots.flatMap((root) =>
    readdirSync(join(REPO_ROOT, root), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${root}/${entry.name}`)
      .filter((directory) => existsSync(join(REPO_ROOT, directory, 'package.json'))),
  )
}

const PACKAGES = workspacePackages()

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

describe('AGENTS.md par package (ADR 013)', () => {
  it('trouve les packages du workspace', () => {
    // Sans cette garde, un motif de workspace qui ne matche plus rien rendrait
    // toutes les assertions ci-dessous vertes sur zéro package.
    expect(PACKAGES.length).toBeGreaterThanOrEqual(5)
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
    const manifest = JSON.parse(read(directory, 'package.json')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    // Les dépendances d'exécution, plus les packages du dépôt : ce sont elles
    // que « ce package peut importer » désigne. L'outillage de développement
    // (types, compilateur) n'entre pas dans le graphe d'import du produit.
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.entries(manifest.devDependencies ?? {})
        .filter(([, range]) => range.startsWith('workspace:'))
        .map(([name]) => name),
    ]

    const content = read(directory, 'AGENTS.md')

    for (const dependency of declared) {
      expect(content).toContain(dependency)
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
