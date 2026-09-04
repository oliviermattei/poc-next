import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { availableModules, requiredModules } from '../config/features'
import {
  cutModulesOfSocle,
  SOCLE_MATRIX_VALUE,
  SOCLE_STEP_DISPOSITION,
  socleJobPlan,
  socleJobSteps,
  socleToggles,
} from '../scripts/socle-rules'

/**
 * **La configuration « socle », jouable ailleurs qu'en CI** (s48).
 *
 * La matrice de `.github/workflows/ci.yml` joue deux configurations, et la
 * seconde — tout ce qui est optionnel coupé — n'était reproductible **nulle
 * part** hors du runner : `pnpm test:minimal-profile` joue le profil de
 * `config/profiles.ts`, qui ne coupe pas les mêmes modules (mesuré à la
 * recherche de s48 : les deux listes diffèrent de deux modules). La moitié rouge
 * de la matrice ne se constatait donc qu'après un push.
 *
 * `pnpm test:socle` rejoue cette configuration dans une copie. Ce qu'elle coupe
 * est **dérivé du fichier de workflow**, jamais recopié : deux listes écrites
 * séparément divergent, et une commande locale qui couperait autre chose que la
 * CI donnerait le pire des résultats — un vert qui ne dit rien.
 */

const WORKFLOW = readFileSync(
  fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url)),
  'utf8',
)

/** Un workflow d'essai : la dérivation s'éprouve sur une forme, pas sur ce dépôt. */
const workflowOf = (steps: readonly string[]): string =>
  ['jobs:', '  quality:', '    steps:', ...steps].join('\n')

const étape = (options: {
  readonly guarded: boolean
  readonly run: string
  readonly name?: string
}): string[] => [
  `      - name: ${options.name ?? 'Une étape'}`,
  ...(options.guarded ? [`        if: matrix.modules == '${SOCLE_MATRIX_VALUE}'`] : []),
  `        run: ${options.run}`,
]

describe('les modules que la CI coupe, dérivés de son fichier de workflow', () => {
  it('lit les identifiants de l’étape gardée par la valeur de matrice', () => {
    expect(
      socleToggles(
        workflowOf(étape({ guarded: true, run: 'pnpm ks toggle alpha && pnpm ks toggle beta' })),
      ),
    ).toEqual(['alpha', 'beta'])
  })

  it('refuse un workflow où l’étape gardée ne coupe rien', () => {
    // Le « balayage vide » de s26, transposé : une liste vide ferait passer la
    // commande sans qu'elle ait coupé quoi que ce soit.
    expect(() =>
      socleToggles(workflowOf(étape({ guarded: true, run: 'pnpm install' }))),
    ).toThrow(new RegExp(SOCLE_MATRIX_VALUE))
  })

  it('refuse une coupure posée hors de l’étape gardée, en la nommant', () => {
    // Sans ce refus, une bascule ajoutée ailleurs dans le workflow ferait
    // diverger la commande locale de la CI **en silence**, ce qui est
    // exactement ce que la dérivation existe pour empêcher.
    expect(() =>
      socleToggles(
        workflowOf([
          ...étape({ guarded: true, run: 'pnpm ks toggle alpha' }),
          ...étape({ guarded: false, run: 'pnpm ks toggle beta' }),
        ]),
      ),
    ).toThrow(/beta/)
  })
})

describe('les modules coupés, confrontés à l’annuaire', () => {
  const annuaire = {
    available: [{ id: 'auth' }, { id: 'alpha' }, { id: 'beta' }],
    required: ['auth'],
  }

  it('refuse un identifiant que l’annuaire ne connaît pas, en le nommant', () => {
    expect(() =>
      cutModulesOfSocle({
        workflow: workflowOf(étape({ guarded: true, run: 'pnpm ks toggle gamma' })),
        ...annuaire,
      }),
    ).toThrow(/gamma/)
  })

  it('refuse un module du socle non désactivable, en le nommant', () => {
    expect(() =>
      cutModulesOfSocle({
        workflow: workflowOf(étape({ guarded: true, run: 'pnpm ks toggle auth' })),
        ...annuaire,
      }),
    ).toThrow(/auth/)
  })

  /**
   * **Le fichier réel** : c'est ce cas qui rougit le jour où la CI change ses
   * bascules sans que la commande suive, ou nomme un module que le dépôt a
   * renommé.
   */
  it('dérive du workflow du dépôt une liste non vide, connue de l’annuaire et hors socle', () => {
    const cut = cutModulesOfSocle({
      workflow: WORKFLOW,
      available: [...availableModules],
      required: [...requiredModules],
    })

    expect(cut).not.toEqual([])

    for (const id of cut) {
      expect(availableModules.map((module) => module.id)).toContain(id)
      expect([...requiredModules]).not.toContain(id)
    }
  })
})

/**
 * **Ce que la commande rejoue du job, et ce qu'elle en exclut.**
 *
 * Constat de la revue de s48 : la liste des **bascules** était dérivée du
 * workflow, mais la liste des **commandes** était écrite en dur dans le script —
 * si bien que le job pouvait gagner une étape sans que rien ne rougisse, et que
 * la commande promettait « les commandes du job » en en rejouant six sur les
 * treize que le job déclarait — parcours navigateur et audit compris parmi les
 * absentes.
 *
 * D'où la règle éprouvée ici : chaque étape `run:` du job gardé est **soit
 * exécutée, soit exclue avec sa raison écrite**, et une étape qui n'est ni l'une
 * ni l'autre fait échouer la commande en la nommant. Un job qui gagne une étape
 * force donc une décision, au lieu d'hériter du silence.
 */
describe('les commandes du job, dérivées du même fichier', () => {
  const jobsOf = (jobs: Record<string, readonly string[]>): string =>
    [
      'jobs:',
      ...Object.entries(jobs).flatMap(([id, steps]) => [`  ${id}:`, '    steps:', ...steps]),
    ].join('\n')

  /** Un job gardé, plus un autre job : la dérivation ne doit lire que le premier. */
  const workflowOfQuality = (steps: readonly string[]): string =>
    jobsOf({
      'un-autre-job': étape({ guarded: false, run: 'pnpm autre-chose', name: 'Ailleurs' }),
      quality: [
        ...étape({ guarded: true, run: 'pnpm ks toggle alpha', name: 'Couper les modules' }),
        ...steps,
      ],
    })

  it('lit les étapes `run:` du job qui porte la garde, dans l’ordre, et rien d’autre', () => {
    const workflow = workflowOfQuality([
      '      - uses: actions/checkout@v7',
      ...étape({ guarded: false, run: 'pnpm typecheck', name: 'Typage' }),
      '      - name: Un bloc de plusieurs lignes',
      '        run: |',
      '          git status --porcelain',
      '          exit 0',
      '      - name: Traces des parcours en échec',
      '        if: failure()',
      '        uses: actions/upload-artifact@v7',
      '        with:',
      '          name: playwright-report',
    ])

    expect(socleJobSteps(workflow)).toEqual([
      { name: 'Couper les modules', run: 'pnpm ks toggle alpha' },
      { name: 'Typage', run: 'pnpm typecheck' },
      { name: 'Un bloc de plusieurs lignes', run: 'git status --porcelain\nexit 0' },
    ])
  })

  it('refuse une étape que la répartition ne classe ni exécutée ni exclue, en la nommant', () => {
    // **Le cas qui existe pour le job de demain** : une étape ajoutée en CI et
    // ignorée ici rendrait la commande verte sur une promesse plus large que sa
    // couverture — le défaut que la revue a nommé.
    expect(() =>
      socleJobPlan({
        workflow: workflowOfQuality(étape({ guarded: false, run: 'pnpm test:e2e', name: 'Parcours' })),
        disposition: { 'Couper les modules': { kind: 'executed' } },
      }),
    ).toThrow(/Parcours/)
  })

  it('refuse une exclusion sans raison écrite', () => {
    // Une exclusion sans raison est une étape oubliée qui a l'air décidée.
    expect(() =>
      socleJobPlan({
        workflow: workflowOfQuality([]),
        disposition: { 'Couper les modules': { kind: 'excluded', reason: '   ' } },
      }),
    ).toThrow(/Couper les modules/)
  })

  it('refuse une répartition qui n’exécute rien', () => {
    // Le « balayage vide » de s26, transposé aux commandes : tout exclure ferait
    // passer la commande sans qu'elle ait rejoué la moindre étape du job.
    expect(() =>
      socleJobPlan({
        workflow: workflowOfQuality([]),
        disposition: {
          'Couper les modules': { kind: 'excluded', reason: 'L’amorçage la joue déjà.' },
        },
      }),
    ).toThrow(/aucune/i)
  })

  it('refuse une décision qui ne correspond à aucune étape du job', () => {
    // Une étape renommée en CI laisserait sinon une décision périmée derrière
    // elle, et personne ne saurait qu'elle ne s'applique plus à rien.
    expect(() =>
      socleJobPlan({
        workflow: workflowOfQuality([]),
        disposition: {
          'Couper les modules': { kind: 'executed' },
          'Une étape disparue': { kind: 'excluded', reason: 'Raison écrite.' },
        },
      }),
    ).toThrow(/Une étape disparue/)
  })

  /**
   * **Le fichier réel** : c'est ce cas qui rougit le jour où le job gagne une
   * étape, en la nommant, plutôt que de la laisser hors de la commande en
   * silence.
   */
  it('classe chaque étape du job réel, exécute au moins l’une d’elles et motive chaque exclusion', () => {
    const plan = socleJobPlan({ workflow: WORKFLOW, disposition: SOCLE_STEP_DISPOSITION })

    expect(plan.executed).not.toEqual([])

    for (const excluded of plan.excluded) {
      expect(excluded.reason.trim().length).toBeGreaterThan(0)
    }

    expect(plan.executed.length + plan.excluded.length).toBe(socleJobSteps(WORKFLOW).length)
  })
})
