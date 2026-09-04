/**
 * **Les règles de la configuration « socle »** (s48), isolées de la commande qui
 * les exécute — même forme que `scripts/minimal-profile-rules.ts` face à
 * `scripts/minimal-profile.ts`, et pour la même raison : une règle enfermée dans
 * un script n'est éprouvable qu'en lançant le script, donc en pratique jamais.
 *
 * ## L'interdit central : aucun module n'est nommé ici
 *
 * Ce fichier ne connaît aucun identifiant de module. La liste des modules coupés
 * est **dérivée de `.github/workflows/ci.yml`**, c'est-à-dire de la seule
 * définition qu'ait la configuration « socle » dans ce dépôt. Une seconde liste,
 * écrite ici ou dans `package.json`, divergerait de la première au premier
 * module ajouté — et une commande locale qui couperait autre chose que la CI
 * donnerait le pire des résultats : un vert qui ne dit rien de la moitié rouge.
 *
 * Noter que `config/profiles.ts` **ne convient pas** comme source : le profil
 * minimal de s26 et la branche « socle » de la CI ne coupent pas le même
 * ensemble (mesuré à la recherche de s48, deux modules d'écart). Ce sont deux
 * configurations distinctes, et les confondre rendrait la commande fausse en
 * paraissant plus simple.
 */

/** La valeur de matrice qui, dans le workflow, désigne la configuration réduite. */
export const SOCLE_MATRIX_VALUE = 'socle'

/** Le geste que la CI exécute pour couper un module : le CLI, jamais une édition. */
const TOGGLE = /pnpm ks toggle ([A-Za-z0-9-]+)/g

/** Le début d'une étape du workflow : ce qui referme la garde de la précédente. */
const STEP_START = /^\s*-\s/

const GUARD = new RegExp(`if:\\s*.*modules\\s*==\\s*'${SOCLE_MATRIX_VALUE}'`)

export class SocleConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SocleConfigurationError'
  }
}

const fail = (message: string): never => {
  throw new SocleConfigurationError(message)
}

const quote = (value: string): string => `« ${value} »`

/**
 * Les modules que la CI coupe, lus dans son fichier de workflow.
 *
 * Deux refus, et le second est celui qu'on n'attend pas :
 *
 * 1. **aucune bascule dans l'étape gardée** — la commande passerait sans avoir
 *    rien coupé, donc en jouant la configuration complète sous le nom de
 *    l'autre. C'est le « balayage vide » de s26, transposé ;
 * 2. **une bascule posée hors de l'étape gardée** — elle s'appliquerait aux
 *    deux branches de la matrice, et la dérivation la manquerait en silence.
 *    Plutôt que de deviner l'intention, on refuse en la nommant.
 */
export function socleToggles(workflow: string): readonly string[] {
  const guardedToggles: string[] = []
  const strayToggles: string[] = []
  let guarded = false

  for (const line of workflow.split('\n')) {
    if (STEP_START.test(line)) {
      guarded = false
    }

    if (GUARD.test(line)) {
      guarded = true
    }

    for (const match of line.matchAll(TOGGLE)) {
      ;(guarded ? guardedToggles : strayToggles).push(match[1] ?? '')
    }
  }

  if (strayToggles.length > 0) {
    fail(
      `Le workflow coupe ${strayToggles.map(quote).join(', ')} hors d’une étape gardée par ` +
        `${quote(`matrix.modules == '${SOCLE_MATRIX_VALUE}'`)}. Une bascule qui s’applique aux ` +
        'deux branches de la matrice ne se dérive pas : elle doit être gardée, ou la commande ' +
        'locale et la CI ne joueront pas la même configuration.',
    )
  }

  if (guardedToggles.length === 0) {
    fail(
      `Aucune bascule de module n’est déclarée dans une étape gardée par ` +
        `${quote(`matrix.modules == '${SOCLE_MATRIX_VALUE}'`)} : la commande couperait zéro ` +
        'module et jouerait la configuration complète sous le nom de l’autre.',
    )
  }

  return guardedToggles
}

/**
 * Les modules coupés, **confrontés à l'annuaire** avant qu'une seule commande ne
 * soit lancée.
 *
 * L'annuaire et le socle sont **reçus**, jamais lus ici : c'est la discipline de
 * `@repo/core` et de `minimal-profile-rules.ts`, sans laquelle aucun test ne
 * pourrait éprouver un annuaire que le dépôt ne contient pas.
 */
export function cutModulesOfSocle(input: {
  readonly workflow: string
  readonly available: readonly { readonly id: string }[]
  readonly required: readonly string[]
}): readonly string[] {
  const cut = socleToggles(input.workflow)
  const known = new Set(input.available.map((module) => module.id))
  const socle = new Set(input.required)

  for (const id of cut) {
    if (!known.has(id)) {
      fail(
        `Le workflow coupe ${quote(id)}, qu’aucun module de l’annuaire ne déclare. ` +
          `Modules connus : ${[...known].join(', ')}.`,
      )
    }

    if (socle.has(id)) {
      fail(
        `Le workflow coupe ${quote(id)}, qui appartient au socle non désactivable (ADR 021). ` +
          'Le CLI le refuserait, et la CI échouerait à cette étape.',
      )
    }
  }

  return cut
}

/** Une étape du job, réduite à ce que la commande peut rejouer : un nom, une commande. */
export interface WorkflowStep {
  readonly name: string
  readonly run: string
}

/** Le début d'un job : une clé à deux espaces d'indentation, sous `jobs:`. */
const JOB = /^ {2}([A-Za-z0-9_-]+):\s*$/

interface ParsedStep {
  readonly job: string
  name: string
  run: string
  guarded: boolean
}

/**
 * Les étapes du workflow, lues à la main plutôt que par un analyseur YAML.
 *
 * Le dépôt n'a aucune dépendance d'analyse YAML, et en ajouter une pour lire
 * treize étapes coûterait plus que la lecture elle-même. La forme reconnue est
 * celle de ce fichier : une clé de job à deux espaces, des étapes à six, leurs
 * clés à huit, et un bloc `run: |` indenté davantage.
 */
const parseSteps = (workflow: string): ParsedStep[] => {
  const lines = workflow.split('\n')
  const steps: ParsedStep[] = []

  let job = ''
  let current: ParsedStep | undefined
  let keyIndent = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''

    const jobMatch = JOB.exec(line)

    if (jobMatch !== null) {
      job = jobMatch[1] ?? ''
      current = undefined
      continue
    }

    const isStepStart = STEP_START.test(line)

    if (isStepStart) {
      current = { job, name: '', run: '', guarded: false }
      keyIndent = line.length - line.trimStart().length + 2
      steps.push(current)
    }

    if (current === undefined) continue

    // Le tiret d'une entrée de liste occupe la place d'un espace : le remplacer
    // aligne la première clé de l'étape sur les suivantes, et une seule
    // arithmétique d'indentation suffit ensuite.
    const normalized = isStepStart ? line.replace(/^(\s*)-(\s)/, '$1 $2') : line

    if (normalized.length - normalized.trimStart().length !== keyIndent) continue

    if (GUARD.test(normalized)) {
      current.guarded = true
      continue
    }

    const nameMatch = /^\s*name:\s*(.+?)\s*$/.exec(normalized)

    if (nameMatch !== null && current.name === '') {
      current.name = nameMatch[1] ?? ''
      continue
    }

    const runMatch = /^\s*run:\s*(.*)$/.exec(normalized)

    if (runMatch === null) continue

    const value = (runMatch[1] ?? '').trim()

    if (!/^[|>]-?\+?$/.test(value)) {
      current.run = value
      continue
    }

    // Bloc scalaire : tout ce qui est indenté plus que la clé lui appartient.
    const block: string[] = []

    while (index + 1 < lines.length) {
      const next = lines[index + 1] ?? ''

      if (next.trim() !== '' && next.length - next.trimStart().length <= keyIndent) break

      block.push(next)
      index += 1
    }

    const written = block.filter((entry) => entry.trim() !== '')
    const margin = Math.min(...written.map((entry) => entry.length - entry.trimStart().length))

    current.run = block
      .map((entry) => entry.slice(margin))
      .join('\n')
      .trim()
  }

  return steps
}

/**
 * Les étapes `run:` du **job qui porte la garde**, dans l'ordre du fichier.
 *
 * Le job n'est pas nommé ici, il est dérivé comme le reste : c'est celui où vit
 * l'étape gardée par la valeur de matrice. Nommer `quality` aurait été une
 * seconde écriture de plus à faire diverger.
 *
 * Une étape sans `name:` est désignée par sa commande — la répartition
 * ci-dessous se lit par nom, et un nom vide n'en serait pas un.
 */
export function socleJobSteps(workflow: string): readonly WorkflowStep[] {
  const steps = parseSteps(workflow)
  const guardedJob = steps.find((step) => step.guarded)?.job

  if (guardedJob === undefined) {
    fail(
      `Aucune étape du workflow n’est gardée par ${quote(
        `matrix.modules == '${SOCLE_MATRIX_VALUE}'`,
      )} : le job à rejouer ne se dérive pas.`,
    )
  }

  return steps
    .filter((step) => step.job === guardedJob && step.run !== '')
    .map((step) => ({ name: step.name === '' ? step.run : step.name, run: step.run }))
}

/**
 * Ce qu'on fait d'une étape du job : la rejouer, ou l'exclure **avec sa raison**.
 * Il n'y a pas de troisième valeur, et c'est le point : une étape non décidée
 * fait échouer la commande.
 */
export type SocleDisposition =
  | { readonly kind: 'executed' }
  | { readonly kind: 'excluded'; readonly reason: string }

export interface SocleJobPlan {
  readonly executed: readonly WorkflowStep[]
  readonly excluded: readonly { readonly step: WorkflowStep; readonly reason: string }[]
}

/**
 * **La décision, étape par étape, pour le job réel** (s48, correctif de revue).
 *
 * Deux exclusions parce que l'amorçage joue déjà l'étape autrement, une parce
 * qu'elle provisionne un runner plutôt qu'elle ne vérifie quelque chose. Tout
 * le reste est rejoué, parcours navigateur et audit compris — c'est ce qui
 * distingue « rejoue le job » d'une promesse plus large que sa couverture.
 */
export const SOCLE_STEP_DISPOSITION: Readonly<Record<string, SocleDisposition>> = {
  'Installer les dépendances': {
    kind: 'excluded',
    reason:
      'L’amorçage l’exécute déjà dans la copie, avec la même commande et le même `--frozen-lockfile` ; ' +
      'la rejouer ici réinstallerait le même arbre.',
  },
  'Couper les modules optionnels': {
    kind: 'excluded',
    reason:
      'L’amorçage joue les mêmes bascules, dérivées de cette étape-ci, une par une, puis relit ce que ' +
      'la copie active réellement — ce que la CI, elle, ne vérifie pas.',
  },
  // Les deux clés ci-dessous portent l'apostrophe **droite** du workflow, et non
  // la typographique du reste du fichier : ce sont des noms d'étapes lus dans
  // `ci.yml`, pas de la prose.
  "Photographier l'arbre après configuration": { kind: 'executed' },
  Typage: { kind: 'executed' },
  Lint: { kind: 'executed' },
  'Régénérer les migrations des modules activés': { kind: 'executed' },
  Migrations: { kind: 'executed' },
  'Tests unitaires': { kind: 'executed' },
  Build: { kind: 'executed' },
  'Installer le navigateur': {
    kind: 'excluded',
    reason:
      '`--with-deps` installe des paquets système du runner, en root : c’est du provisionnement de ' +
      'machine, pas un contrôle. Le poste fournit son navigateur, et les parcours échouent en le ' +
      'nommant s’il manque.',
  },
  'Parcours end-to-end': { kind: 'executed' },
  "L'arbre reste propre après le build et les parcours": { kind: 'executed' },
  'Audit de dépendances': { kind: 'executed' },
}

/**
 * **Chaque étape du job est exécutée, ou exclue avec sa raison écrite.**
 *
 * C'est le correctif du constat majeur de la revue de s48 : la liste des
 * bascules était dérivée du workflow, celle des commandes était écrite en dur,
 * et le job pouvait gagner une étape sans que rien ne rougisse — la commande
 * promettait alors « les commandes du job » en en rejouant six sur neuf.
 *
 * Quatre refus :
 *
 * 1. une étape que la répartition ne classe pas — le job de demain force une
 *    décision au lieu d'hériter du silence ;
 * 2. une exclusion sans raison — sans quoi « exclue » redeviendrait « oubliée » ;
 * 3. une décision qui ne correspond à aucune étape — une étape renommée en CI
 *    laisserait sinon une décision périmée derrière elle ;
 * 4. une répartition qui n'exécute rien — le « balayage vide » de s26.
 */
export function socleJobPlan(input: {
  readonly workflow: string
  readonly disposition: Readonly<Record<string, SocleDisposition>>
}): SocleJobPlan {
  const steps = socleJobSteps(input.workflow)

  const unclassified = steps.filter((step) => input.disposition[step.name] === undefined)

  if (unclassified.length > 0) {
    fail(
      `Le job gardé porte ${unclassified.map((step) => quote(step.name)).join(', ')}, que ` +
        '`SOCLE_STEP_DISPOSITION` ne classe pas. Décider : rejouée par la commande, ou exclue avec ' +
        'sa raison écrite — une étape non décidée rendrait la commande plus large que sa couverture.',
    )
  }

  const executed: WorkflowStep[] = []
  const excluded: { step: WorkflowStep; reason: string }[] = []

  for (const step of steps) {
    const decision = input.disposition[step.name]

    if (decision === undefined || decision.kind === 'executed') {
      executed.push(step)
      continue
    }

    if (decision.reason.trim() === '') {
      fail(
        `L’étape ${quote(step.name)} est exclue sans raison écrite. Une exclusion sans raison est ` +
          'une étape oubliée qui a l’air décidée.',
      )
    }

    excluded.push({ step, reason: decision.reason })
  }

  const names = new Set(steps.map((step) => step.name))
  const stale = Object.keys(input.disposition).filter((name) => !names.has(name))

  if (stale.length > 0) {
    fail(
      `La répartition décide de ${stale.map(quote).join(', ')}, qu’aucune étape du job gardé ne ` +
        'porte. Une étape renommée ou retirée en CI laisse sa décision derrière elle : la retirer ' +
        'est le geste qui accompagne le changement.',
    )
  }

  if (executed.length === 0) {
    fail(
      'La répartition n’exécute aucune étape du job gardé : la commande passerait sans avoir rejoué ' +
        'la moindre commande de la CI.',
    )
  }

  return { executed, excluded }
}
