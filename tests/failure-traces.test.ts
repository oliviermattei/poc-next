import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { TRACES_OUTPUT_DIRECTORY } from '../playwright.config'

/**
 * **La trace d'un parcours en échec, téléchargeable depuis la CI** (s51).
 *
 * Le job des parcours téléversait `playwright-report/`, alors que Playwright
 * écrit ses traces dans son `outputDir`. `upload-artifact` qui ne trouve aucun
 * fichier **n'échoue pas** — son `if-no-files-found` vaut `warn` par défaut
 * (vérifié dans `action.yml` de `actions/upload-artifact@v7`, dont les options
 * sont `warn | error | ignore`). L'étape était donc verte à chaque échec, en
 * n'archivant rien, depuis que la CI existe.
 *
 * Ce que ce fichier garde, et qui ne se garde pas ailleurs : le chemin
 * téléversé est **dérivé** de la configuration Playwright, jamais recopié. Une
 * story qui changerait l'`outputDir` sans toucher au workflow rouvrirait
 * exactement la même dérive, et rien ne le dirait — l'étape resterait verte.
 *
 * Ce n'est **pas** le mécanisme du parcours doré, et il ne faut pas le
 * dupliquer : celui-ci travaille dans un clone qu'il détruit, donc il *recopie*
 * ses traces hors du clone avant la suppression, d'où sa constante et son
 * dossier propres (`scripts/golden-path-regime.ts`). Le job principal, lui,
 * tourne dans l'arbre : il n'a rien à recopier, seulement à pointer le dossier
 * que Playwright vient d'écrire.
 *
 * Ce que ce balayage lit, décrit plutôt que promis : les étapes du fichier de
 * workflow, avec le job qui les porte, leur `uses:`, leur `run:` et les clés de
 * leur bloc `with:`. Il ne lit ni une étape écrite sous une autre indentation,
 * ni une valeur multiligne d'un `with:` — il n'y en a aucune à ce jour. C'est
 * pourquoi le plancher ci-dessous existe : une correspondance qui cesse de
 * correspondre rendrait tout ce fichier vert en ne vérifiant rien.
 */

const WORKFLOW = readFileSync(
  fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url)),
  'utf8',
)

interface Step {
  readonly job: string
  id: string
  uses: string
  run: string
  condition: string
  readonly inputs: Record<string, string>
}

/** Les étapes du workflow, avec leur job, leur `if:` et les clés de leur `with:`. */
const stepsOf = (source: string): Step[] => {
  const steps: Step[] = []
  let job = ''
  let current: Step | null = null
  let inWith = false

  const apply = (step: Step, entry: string): void => {
    const pair = /^([\w-]+):\s*(.*)$/.exec(entry)

    if (pair === null) {
      return
    }

    if (pair[1] === 'id') {
      step.id = pair[2] ?? ''
    }

    if (pair[1] === 'uses') {
      step.uses = pair[2] ?? ''
    }

    if (pair[1] === 'run') {
      step.run = pair[2] ?? ''
    }

    if (pair[1] === 'if') {
      step.condition = pair[2] ?? ''
    }

    inWith = pair[1] === 'with'
  }

  for (const raw of source.split('\n')) {
    const line = raw.replace(/\s+$/, '')

    if (line === '' || /^\s*#/.test(line)) {
      continue
    }

    const declared = /^ {2}([A-Za-z_][\w-]*):\s*$/.exec(line)

    if (declared !== null) {
      job = declared[1] ?? ''
      current = null
      inWith = false
      continue
    }

    const starts = /^ {6}- (.*)$/.exec(line)

    if (starts !== null) {
      current = { job, id: '', uses: '', run: '', condition: '', inputs: {} }
      steps.push(current)
      inWith = false
      apply(current, starts[1] ?? '')
      continue
    }

    if (current === null) {
      continue
    }

    const key = /^ {8}([\w-].*)$/.exec(line)

    if (key !== null) {
      apply(current, key[1] ?? '')
      continue
    }

    const input = /^ {10}([\w-]+):\s*(.*)$/.exec(line)

    if (input !== null && inWith) {
      current.inputs[input[1] ?? ''] = input[2] ?? ''
    }
  }

  return steps
}

/** Les étapes qui téléversent un artefact, quel que soit leur job. */
const archiveSteps = (source: string): Step[] =>
  stepsOf(source).filter((step) => step.uses.startsWith('actions/upload-artifact@'))

/** L'étape qui exécute les parcours navigateur. */
const journeysStep = (source: string): Step | undefined =>
  stepsOf(source).find((step) => step.run.trim() === 'pnpm test:e2e')

/**
 * L'étape qui archive les traces des parcours, **dérivée** : celle qui téléverse
 * un artefact depuis le job qui exécute `pnpm test:e2e`. Nommer l'étape ou son
 * chemin ici les recopierait, ce qui est le défaut que cette story ferme.
 */
const journeysArchiveStep = (source: string): Step | undefined => {
  const job = journeysStep(source)?.job

  return stepsOf(source).find(
    (step) => step.job === job && step.uses.startsWith('actions/upload-artifact@'),
  )
}

/**
 * Les valeurs de matrice d'un job, pour une clé donnée.
 *
 * Le bloc du job court jusqu'à la **prochaine clé de job** (deux espaces
 * d'indentation) ou, à défaut, jusqu'à la **fin de l'entrée** — écrite
 * `$(?![\s\S])`, la seule forme qui l'exprime ici : `\Z` n'existe pas en
 * JavaScript (il y vaut le caractère `Z`, ce qui rendait ce balayage dépendant
 * de l'absence de `Z` majuscule dans le fichier) et `$` sous le drapeau `m`
 * s'arrêterait à la première fin de ligne.
 */
const matrixValuesOf = (source: string, job: string, key: string): string[] => {
  const block = new RegExp(
    `^ {2}${job}:$([\\s\\S]*?)(?=^ {2}[A-Za-z_][\\w-]*:$|$(?![\\s\\S]))`,
    'm',
  ).exec(source)
  const values = new RegExp(`^ {8}${key}: \\[(.*)\\]$`, 'm').exec(block?.[1] ?? '')

  return (values?.[1] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '')
}

describe('les traces d’un parcours en échec, archivées par la CI (s51)', () => {
  /**
   * Le plancher. Une correspondance qui cesse de correspondre — une étape
   * réindentée, un `uses:` déplacé — rendrait chaque assertion de ce fichier
   * verte en ne balayant rien : le défaut trouvé en s26, puis en s48. Le dépôt
   * porte à ce jour trois téléversements (parcours, parcours doré, profil
   * minimal) ; deux est le plancher, pas le compte.
   */
  it('refuse un balayage vide : moins de deux téléversements dérivés', () => {
    expect(archiveSteps(WORKFLOW).length).toBeGreaterThanOrEqual(2)
  })

  it('téléverse le dossier où Playwright écrit ses traces, dérivé de sa configuration', () => {
    expect(journeysArchiveStep(WORKFLOW)?.inputs.path).toBe(`${TRACES_OUTPUT_DIRECTORY}/`)
  })

  /**
   * Le chemin juste ne suffit pas : une étape qui ne trouve rien reste verte,
   * `if-no-files-found` valant `warn` par défaut. Sans ce réglage, la garantie
   * redeviendrait ce qu'elle était — un archivage qui n'archive rien, et
   * personne pour le dire.
   */
  it('échoue quand elle n’archive rien, alors qu’un parcours a rougi', () => {
    expect(journeysArchiveStep(WORKFLOW)?.inputs['if-no-files-found']).toBe('error')
  })

  /**
   * **Et « alors qu'un parcours a rougi » doit être vrai**, sans quoi le nom
   * ci-dessus décrit une garantie que l'étape n'a pas. `if: failure()` est vrai
   * dès qu'une étape **quelconque** du job a échoué — lint, typage, migrations,
   * build, audit —, or aucune de celles-là n'écrit de trace : sur une exécution
   * verte des parcours, le dossier ne porte que `.last-run.json`, un fichier
   * caché qu'`include-hidden-files` exclut par défaut. Couplé à
   * `if-no-files-found: error`, un `failure()` nu ajouterait donc un second
   * rouge trompeur à la majorité des échecs de ce job.
   *
   * La condition est dérivée : elle doit citer la **conclusion de l'étape des
   * parcours**, identifiée par son `id:`.
   */
  it('ne s’exécute que si ce sont les parcours qui ont rougi', () => {
    const id = journeysStep(WORKFLOW)?.id

    expect(id).not.toBe('')
    expect(journeysArchiveStep(WORKFLOW)?.condition).toContain(`steps.${id}.conclusion`)
  })

  /**
   * La lecture des valeurs de matrice, éprouvée sur une **forme** et pas
   * seulement sur ce dépôt : dans le fichier livré, le job de la matrice est
   * suivi d'un autre job, si bien que la fin du bloc n'y est jamais atteinte.
   * Elle l'était par un `\Z` — qui en JavaScript ne vaut pas la fin de l'entrée
   * mais le **caractère** `Z`, donc juste par accident tant qu'aucun `Z`
   * majuscule n'entrait dans le fichier. Les deux conditions sont réunies ici.
   */
  it('lit les valeurs de matrice d’un job qui termine le fichier, ou qui porte un `Z`', () => {
    const job = (before: readonly string[]): string =>
      [
        'jobs:',
        '  quality:',
        ...before,
        '    strategy:',
        '      matrix:',
        '        modules: [tous, socle]',
        '    steps:',
        '      - run: pnpm test:e2e',
      ].join('\n')

    // Aucun autre job derrière : le bloc court jusqu'à la fin de l'entrée. Le
    // `\Z` littéral n'y correspond nulle part — la lecture rendait `[]`.
    expect(matrixValuesOf(job([]), 'quality', 'modules')).toEqual(['tous', 'socle'])

    // Un `Z` majuscule **avant** la matrice : le `\Z` littéral y arrêtait le
    // bloc, qui ne portait alors plus la ligne cherchée. La position compte —
    // un `Z` situé après restait sans effet, ce qui est exactement ce qui rend
    // ce genre de défaut invisible.
    expect(matrixValuesOf(job(['    name: Zèle']), 'quality', 'modules')).toEqual([
      'tous',
      'socle',
    ])
  })

  /**
   * La garantie vaut pour les deux configurations de la matrice. Deux
   * exécutions qui téléverseraient sous le **même** nom se refuseraient l'une
   * l'autre (`overwrite` vaut `false` par défaut) : le nom doit donc varier
   * avec la valeur de matrice qu'il cite.
   *
   * L'expansion ne porte que sur les clés que le nom **cite** — une seule
   * dimension aujourd'hui. Une seconde dimension de matrice non citée par le
   * nom ferait collisionner les exécutions sans que ce cas le voie.
   */
  it('archive séparément chaque branche de la matrice', () => {
    const step = journeysArchiveStep(WORKFLOW)
    const name = step?.inputs.name ?? ''
    const cited = [...name.matchAll(/\$\{\{\s*matrix\.([\w-]+)\s*\}\}/g)].map(
      (match) => match[1] ?? '',
    )

    const expanded = cited.reduce<string[]>(
      (names, key) =>
        matrixValuesOf(WORKFLOW, step?.job ?? '', key).flatMap((value) =>
          names.map((entry) =>
            entry.replace(new RegExp(`\\$\\{\\{\\s*matrix\\.${key}\\s*\\}\\}`, 'g'), value),
          ),
        ),
      [name],
    )

    expect(new Set(expanded).size).toBeGreaterThanOrEqual(2)
  })
})
