import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
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

  /**
   * **Constat m1 de la troisième revue de s28** : le quatrième port
   * (`rate-limit.ts`) est arrivé sans que la règle qui vit **à côté** de lui en
   * dise un mot — pas de section, pas de ligne dans le tableau de la forme du
   * journal, et une ligne « une panne de tiers **dégrade** » que ce port
   * contredit délibérément. L'agent qui lit la règle la plus proche du code y
   * lisait l'inverse de la décision.
   *
   * La liste est **dérivée du disque** : un cinquième port non documenté rougit,
   * là où une énumération écrite à la main serait restée verte.
   */
  it('packages/ports/AGENTS.md nomme chacun des fichiers de capacité de `src/`', () => {
    const capabilities = readdirSync(join(REPO_ROOT, 'packages/ports/src'))
      .filter((entry) => entry.endsWith('.ts') && entry !== 'index.ts')
      .filter((entry) => !entry.endsWith('.test.ts'))
    const content = read('packages/ports', 'AGENTS.md')

    // Un balayage vide passerait pour une raison qui n'en est pas une (s26).
    expect(capabilities.length).toBeGreaterThanOrEqual(4)

    for (const capability of capabilities) {
      expect(content, `packages/ports/AGENTS.md ne dit rien de ${capability}`).toContain(capability)
    }
  })

  /**
   * **Constat F4 de la revue de s29** : `apps/web/AGENTS.md` annonçait « Sept
   * fichiers font exception » au-dessus d'une liste qui en comptait huit — la
   * story avait ajouté le huitième sans toucher au nombre. Un décompte écrit à
   * la main périme en silence, et le lecteur suivant le lit comme vérifié.
   *
   * La liste est donc **dérivée du disque** : tout fichier de `apps/web/lib`
   * qui importe un module doit être nommé dans la règle qui vit à côté de lui,
   * sous sa forme exacte entre accents graves — un nom contenu dans un autre
   * (`lib/blog.ts` dans `lib/blog-body.tsx`) passerait sinon pour couvert. Ce
   * que ce cas ne dit pas : ce que la prose **raconte** de chaque fichier.
   */
  it('apps/web/AGENTS.md nomme chaque fichier de `lib/` qui importe un module', () => {
    const importers = readdirSync(join(REPO_ROOT, 'apps/web/lib'))
      .filter((entry) => /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
      .filter((entry) => read('apps/web/lib', entry).includes('@repo/module-'))
    const content = read('apps/web', 'AGENTS.md')

    // Un balayage vide passerait pour une raison qui n'en est pas une (s26).
    expect(importers.length).toBeGreaterThanOrEqual(8)

    for (const file of importers) {
      expect(content, `apps/web/AGENTS.md ne dit rien de lib/${file}`).toContain(`\`lib/${file}\``)
    }
  })
})

/**
 * Le squelette généré passe la garde qu'il devra passer une fois écrit.
 *
 * `CODING_STANDARDS.md` ordonne de **générer** un module plutôt que de le
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
 * Les règles de jugement du projet, lues par un agent avant de toucher au
 * dépôt et par `/code-review` à chaque revue. Elles vivent dans
 * `CODING_STANDARDS.md`, à la racine : `AGENTS.md` n'y fait que renvoyer, et
 * une section qui disparaît de ce fichier disparaît de chaque revue.
 */
describe('Règles de jugement (CODING_STANDARDS.md)', () => {
  const content = read('CODING_STANDARDS.md')

  it('décrit les quatre couches et leur sens de dépendance', () => {
    for (const layer of ['domain', 'application', 'infrastructure', 'presentation']) {
      expect(content).toContain(layer)
    }
  })

  it('porte les sections opposables en revue', () => {
    for (const section of [
      '## Technical conventions',
      '## Security baseline',
      '## Reliability baseline',
      '## Agent-oriented repo',
    ]) {
      expect(content, `CODING_STANDARDS.md n'a pas de section « ${section} »`).toContain(section)
    }
  })
})

/**
 * Les scripts nommés en tête d'une ligne du tableau de `docs/commands.md`,
 * `pnpm <script>` ou `pnpm run <script>`.
 *
 * Lus cellule par cellule, jamais par une recherche de sous-chaîne :
 * `pnpm test` est contenu dans `pnpm test:e2e`, si bien qu'une ligne
 * `pnpm test` retirée serait restée couverte par sa voisine.
 */
export const documentedScripts = (reference: string): string[] =>
  [...reference.matchAll(/^\|\s*`pnpm (?:run )?([\w:-]+)`\s*\|/gm)].map((match) => match[1] ?? '')

describe('Référence des commandes (docs/commands.md)', () => {
  // Une commande que la référence ne décrit pas n'existe pas pour un agent :
  // il en réinventera une autre. La liste vient de `package.json`, jamais
  // d'une copie.
  const scripts = Object.keys(
    (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts,
  )
  const documented = documentedScripts(read('docs/commands.md'))

  it('décrit chaque script du `package.json` racine sur sa propre ligne', () => {
    // Un `package.json` sans script rendrait la boucle verte sur rien.
    expect(scripts.length).toBeGreaterThanOrEqual(1)

    for (const script of scripts) {
      expect(documented, `docs/commands.md n'a pas de ligne pour pnpm ${script}`).toContain(script)
    }
  })

  it('ne décrit aucun script que le `package.json` racine ne déclare pas', () => {
    for (const script of documented) {
      expect(scripts, `docs/commands.md décrit pnpm ${script}, qui n'existe pas`).toContain(script)
    }
  })

  it('ne lit pas la ligne de `pnpm test:e2e` comme celle de `pnpm test`', () => {
    expect(documentedScripts('| `pnpm test:e2e` | parcours | échec |')).toEqual(['test:e2e'])
    expect(documentedScripts('| `pnpm run audit` | audit | échec |')).toEqual(['audit'])
  })
})

/**
 * Les ADR vivent là où les skills d'ingénierie les cherchent :
 * `docs/adr/NNNN-slug.md` (ADR 082). Un fichier hors de ce nom est invisible
 * pour `/domain-modeling`, qui choisirait alors un numéro déjà pris.
 */
const ADR_DIRECTORY = 'docs/adr'

/** Le gabarit MADR range avec les ADR, sans être une décision. */
const ADR_TEMPLATE = 'template.md'

/** Le numéro d'un fichier `NNNN-slug.md`, `null` hors de ce nom. */
export const adrNumberOf = (fileName: string): number | null => {
  const match = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.exec(fileName)

  return match ? Number(match[1]) : null
}

const adrFiles = (): string[] =>
  readdirSync(join(REPO_ROOT, ADR_DIRECTORY)).filter((name) => name !== ADR_TEMPLATE)

/**
 * Les numéros cités dans un texte, sous toutes les formes en usage :
 * « ADR 069 », « ADR 69 », « ADR-0069 ». Le code et les tests citent les ADR
 * par leur numéro, jamais par leur chemin : le numéro doit donc désigner un
 * fichier, sans quoi la raison qu'il porte est perdue.
 */
export const citedAdrNumbers = (text: string): number[] =>
  [...text.matchAll(/\bADR[- ]?(\d{1,4})\b/g)].map((match) => Number(match[1]))

/** Fichiers suivis par git, lus en texte : un fichier binaire ne cite rien. */
const trackedTextFiles = (): { path: string; content: string }[] =>
  execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1e8 })
    .split('\0')
    .filter((path) => path !== '')
    // Un fichier supprimé mais pas encore retiré de l'index reste listé.
    .filter((path) => statSync(join(REPO_ROOT, path), { throwIfNoEntry: false })?.isFile())
    .map((path) => ({ path, buffer: readFileSync(join(REPO_ROOT, path)) }))
    .filter(({ buffer }) => !buffer.includes(0))
    .map(({ path, buffer }) => ({ path, content: buffer.toString('utf8') }))

describe('ADR (docs/adr)', () => {
  it('chaque fichier suit `NNNN-slug.md`', () => {
    const files = adrFiles()

    // Le plancher refuse un balayage vide : les 80 ADR d'avant le déplacement.
    expect(files.length).toBeGreaterThanOrEqual(80)

    const misnamed = files.filter((name) => adrNumberOf(name) === null)
    expect(misnamed, `hors du format NNNN-slug.md : ${misnamed.join(', ')}`).toEqual([])
  })

  it('le gabarit des nouvelles ADR est rangé avec elles', () => {
    expect(existsSync(join(REPO_ROOT, ADR_DIRECTORY, ADR_TEMPLATE))).toBe(true)
  })

  it('chaque citation « ADR NNN » d’un fichier suivi désigne un fichier existant', () => {
    const existing = new Set(adrFiles().map(adrNumberOf))
    const citations = trackedTextFiles().flatMap(({ path, content }) =>
      content
        .split('\n')
        .flatMap((line, index) =>
          citedAdrNumbers(line).map((adr) => ({ adr, where: `${path}:${index + 1}` })),
        ),
    )

    // Le plancher refuse un balayage vide : une expression qui ne lit plus
    // rien rendrait la boucle verte sur rien.
    expect(citations.length).toBeGreaterThanOrEqual(1)

    const dangling = citations
      .filter(({ adr }) => !existing.has(adr))
      .map(({ adr, where }) => `${where} cite l'ADR ${String(adr).padStart(3, '0')}`)
    expect(dangling, `ADR citées sans fichier :\n${dangling.join('\n')}`).toEqual([])
  })

  it('lit une citation sous chacune de ses formes', () => {
    expect(citedAdrNumbers('voir ADR 069, ADR 69 et ADR-0069')).toEqual([69, 69, 69])
    expect(citedAdrNumbers('# ADR <number> — <title>')).toEqual([])
    expect(citedAdrNumbers('les ADRs et MADR')).toEqual([])
  })

  it('lit le numéro sur quatre chiffres, et rien d’autre', () => {
    expect(adrNumberOf('0069-donnees-de-demonstration.md')).toBe(69)
    expect(adrNumberOf('069-donnees-de-demonstration.md')).toBeNull()
    expect(adrNumberOf('0069_donnees.md')).toBeNull()
    expect(adrNumberOf('0069-Donnees.md')).toBeNull()
    expect(adrNumberOf('0069-.md')).toBeNull()
  })
})

/**
 * Les emplacements de l'ancienne méthode, retirés du dépôt (ADR 082). Un
 * renvoi vers l'un d'eux pointe vers le vide : la raison qu'il portait doit
 * être écrite sur place, ou renvoyée vers une ADR ou une issue.
 *
 * Chaque motif refuse un caractère de chemin juste avant lui, si bien que
 * `packages/foo/templates/` ou `user-stories.md` ne sont pas lus comme le
 * dossier ou le fichier de la méthode. Le CLI de modules du produit
 * (`pnpm ks`, `ks scaffold`, `packages/cli`) n'est visé par aucun.
 */
const REMOVED_LOCATIONS: readonly { name: string; pattern: RegExp }[] = [
  {
    name: 'un artefact du pipeline',
    pattern: /(?<![\w-])docs\/(?:research|plans|reviews|verif|designs)\b/,
  },
  { name: 'l’ancien dossier des ADR', pattern: /(?<![\w-])docs\/decisions\b/ },
  { name: 'le fichier des stories', pattern: /(?<![\w.-])stories\.md\b/ },
  { name: 'le fichier d’état', pattern: /(?<![\w.-])STATE\.md\b/ },
  { name: 'le journal de la méthode', pattern: /killer-saas-feedback\b/ },
  { name: 'le fichier de réglages de la méthode', pattern: /\bAGENTS\.local\.md\b/ },
  { name: 'le dossier de la méthode', pattern: /\.killer-saas\// },
  { name: 'les gabarits de la méthode', pattern: /(?<![\w./-])templates\// },
  { name: 'une commande de la méthode', pattern: /(?<![\w.-])\/ks-[a-z]/ },
]

/** Les emplacements retirés qu'une ligne cite, nommés. */
export const removedLocationsCitedIn = (line: string): string[] =>
  REMOVED_LOCATIONS.filter(({ pattern }) => pattern.test(line)).map(({ name }) => name)

/**
 * Seule exemption durable : l'état des lieux figé, qui cite ces emplacements
 * volontairement, par des liens fixés à un commit. Ce fichier-ci porte les
 * motifs et leurs cas, il ne renvoie à rien.
 */
const CITES_REMOVED_LOCATIONS_ON_PURPOSE = [
  'docs/agents/etat-des-lieux.md',
  'tests/agents-md.test.ts',
]

describe('aucun renvoi vers un emplacement retiré de la méthode (ADR 082)', () => {
  it('aucun fichier suivi ne cite un emplacement retiré', () => {
    const scanned = trackedTextFiles().filter(
      ({ path }) => !CITES_REMOVED_LOCATIONS_ON_PURPOSE.includes(path),
    )

    // Le plancher refuse un balayage vide : le dépôt suit des centaines de
    // fichiers hors de la méthode.
    expect(scanned.length).toBeGreaterThanOrEqual(500)

    const offending = scanned.flatMap(({ path, content }) =>
      content
        .split('\n')
        .flatMap((line, index) =>
          removedLocationsCitedIn(line).map((name) => `${path}:${index + 1} cite ${name}`),
        ),
    )
    expect(offending, `renvois vers un emplacement retiré :\n${offending.join('\n')}`).toEqual([])
  })

  it('reconnaît chaque emplacement retiré', () => {
    for (const line of [
      'voir `docs/plans/s26.md`',
      'relevé dans `docs/reviews/`',
      '`docs/research/s45-security-headers.md` §2.1',
      '`docs/designs/s29-blog-mdx.md`',
      '`docs/verif/s01.md`',
      '`docs/decisions/018-cles-etrangeres.md`',
      '`docs/stories.md`, critère 2',
      'le mode d’échec n°9 de `STATE.md`',
      'le journal `docs/killer-saas-feedback.md`',
      'lit `AGENTS.local.md`',
      '`.killer-saas/bin/ks.mjs`',
      'les gabarits de `templates/`',
      'capturé par `/ks-design-system`',
    ]) {
      expect(removedLocationsCitedIn(line), line).not.toEqual([])
    }
  })

  it('ne lit ni le CLI du produit ni un dossier homonyme comme la méthode', () => {
    for (const line of [
      '`pnpm ks list`, `npx ks toggle`',
      '`ks scaffold` dans `packages/cli/src/index.ts`',
      'les gabarits `packages/modules/email/src/templates/`',
      '`docs/design-system.md`, `docs/adr/0082-killer-saas.md`',
      'le fichier `user-stories.md`',
      'le nom de produit `killer-saas-web:ci`',
    ]) {
      expect(removedLocationsCitedIn(line), line).toEqual([])
    }
  })
})

describe('point d’entrée des agents', () => {
  it('`CLAUDE.md` importe `AGENTS.md`, et lui seul', () => {
    expect(read('CLAUDE.md').trim()).toBe('@AGENTS.md')
  })

  it('le fichier de réglages de la méthode a disparu', () => {
    expect(existsSync(join(REPO_ROOT, 'AGENTS.local.md'))).toBe(false)
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
