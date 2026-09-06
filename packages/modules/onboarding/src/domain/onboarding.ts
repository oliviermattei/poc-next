/**
 * Les règles pures du parcours d'intégration (s40).
 *
 * **Aucun nom de module n'apparaît ici, et c'est tout le sujet de la story.**
 * Les étapes arrivent en **données** — le point de composition de
 * l'application les dérive des modules montés —, si bien que couper un module
 * retire une étape sans qu'aucune ligne de ce fichier ne change. Une liste
 * écrite ici casserait l'angle du PRD, exactement comme la note de la story
 * l'annonce.
 *
 * Ce fichier ne connaît ni framework, ni ORM, ni SDK : il reçoit des étapes et
 * une progression, il rend un parcours.
 */

export const ONBOARDING_MODULE_ID = 'onboarding'

/**
 * L'adresse de l'écran du parcours, **constante du code**.
 *
 * C'est elle que la racine emploie pour rediriger un compte dont le parcours
 * reste à faire : la destination d'une redirection ne vient jamais d'un
 * paramètre d'URL (`docs/security.md` §4), et le docblock d'`apps/web/app/page.tsx`
 * pose déjà la règle.
 */
export const ONBOARDING_SCREEN_PATH = '/onboarding'

/**
 * Les champs qu'une étape peut recueillir.
 *
 * Ce sont des **valeurs**, pas des modules : l'avatar disparaît de l'étape de
 * profil quand le stockage n'est pas monté, et c'est le point de composition
 * qui le retire de la liste. Le critère 2 est ce piège précis — une *partie*
 * d'étape dépend d'un module, là où les critères 3 et 8 font disparaître des
 * étapes entières.
 */
export const ONBOARDING_FIELD_NAME = 'name'
export const ONBOARDING_FIELD_AVATAR = 'avatar'

/**
 * Une étape du parcours, telle que l'application la dérive.
 *
 * `satisfied` est la seule chose que le module ne peut pas calculer : ce que
 * l'étape recueille appartient à d'autres modules — le nom à `auth`, l'offre à
 * la facturation. Il la **reçoit**, comme `storage` reçoit ses périmètres
 * lisibles.
 */
export interface OnboardingStep {
  readonly id: string
  /** Une étape obligatoire ne peut pas être passée (critère 6). */
  readonly required: boolean
  /** Ce que l'étape recueille, dérivé des modules montés. */
  readonly fields: readonly string[]
  /** L'exigence de l'étape est-elle remplie, dans la donnée réelle ? */
  readonly satisfied: boolean
}

/** L'état persisté d'un compte : ce qu'il a franchi, et si le parcours est clos. */
export interface OnboardingProgress {
  readonly clearedSteps: readonly string[]
  /**
   * **La porte à sens unique** (critère 5). Non nulle, le parcours n'est plus
   * proposé — quoi qu'il advienne ensuite de la liste des étapes. Un module
   * activé après coup ne remet donc personne dans le parcours : une erreur de
   * ce côté enferme l'utilisateur dans une boucle.
   *
   * **Elle n'est armée que par un franchissement** (`progressAfter`), et c'est
   * la limite exacte de ce qu'elle garantit : un parcours dont la dernière
   * étape **sort de la liste** — l'application ne la dérive plus — cesse d'être
   * proposé sans être clos, et cette étape rouvre le parcours si elle redevient
   * dérivable. Les deux moitiés sont mesurées dans `onboarding.test.ts`, « ne
   * se re-propose pas après une fin de parcours » et « cesse d'être proposé
   * quand la dernière étape sort de la liste ».
   */
  readonly completedAt: Date | null
}

export const EMPTY_PROGRESS: OnboardingProgress = { clearedSteps: [], completedAt: null }

export type OnboardingStepState = 'cleared' | 'current' | 'upcoming'

export interface OnboardingStepView {
  readonly id: string
  readonly required: boolean
  readonly fields: readonly string[]
  readonly satisfied: boolean
  readonly state: OnboardingStepState
}

export interface OnboardingCourse {
  /** Le parcours doit-il être proposé à ce compte ? */
  readonly proposed: boolean
  readonly current: OnboardingStepView | null
  readonly steps: readonly OnboardingStepView[]
  readonly completed: boolean
}

/**
 * Le parcours d'un compte, dérivé de ses étapes et de sa progression.
 *
 * Une étape franchie que plus aucun module ne propose est **ignorée**, jamais
 * refusée : c'est la question que la recherche laissait ouverte, et sa réponse.
 * L'utilisateur n'y peut rien, et une progression qui bloque sur une décision
 * d'exploitant est pire que la même progression amputée.
 */
export function courseOf(
  steps: readonly OnboardingStep[],
  progress: OnboardingProgress,
): OnboardingCourse {
  const cleared = new Set(progress.clearedSteps)
  const current = steps.find((step) => !cleared.has(step.id)) ?? null
  const completed = progress.completedAt !== null

  const views: readonly OnboardingStepView[] = steps.map((step) => ({
    id: step.id,
    required: step.required,
    fields: step.fields,
    satisfied: step.satisfied,
    state: cleared.has(step.id) ? 'cleared' : step.id === current?.id ? 'current' : 'upcoming',
  }))

  return {
    proposed: !completed && current !== null,
    current: views.find((view) => view.state === 'current') ?? null,
    steps: views,
    completed,
  }
}

/**
 * Le parcours d'un compte qu'aucune étape ne concerne — **dérivé**, jamais
 * recopié : un littéral perdrait la première clé ajoutée à `OnboardingCourse`.
 * C'est ce que rend le point de composition quand le module est coupé.
 */
export const EMPTY_COURSE: OnboardingCourse = courseOf([], EMPTY_PROGRESS)

/** L'intention de l'appelant : valider l'étape, ou la passer. */
export type ClearIntent = 'continue' | 'skip'

/** Les refus que le module nomme. Le serveur rend un code, jamais une phrase. */
export type ClearRefusal = 'unknown_step' | 'step_required' | 'step_not_satisfied'

export const CLEAR_REFUSALS = [
  'unknown_step',
  'step_required',
  'step_not_satisfied',
] as const satisfies readonly ClearRefusal[]

/**
 * A-t-on le droit de franchir cette étape, et pourquoi non.
 *
 * Deux refus, et ils ne se recouvrent pas :
 *
 * - **passer une étape obligatoire** est refusé (critère 6). C'est un défaut
 *   *silencieux* quand il manque : rien ne casse, l'utilisateur arrive au
 *   tableau de bord sans nom ;
 * - **valider une étape dont l'exigence n'est pas remplie** est refusé aussi.
 *   Sans lui, la garde ci-dessus se contourne en cliquant « continuer ».
 *
 * Une étape que la liste ne contient pas est **inconnue** : l'appelant a nommé
 * une étape d'un module coupé, ou inventé un identifiant. Les deux répondent
 * pareil.
 */
export function clearanceOf(
  step: OnboardingStep | undefined,
  intent: ClearIntent,
): ClearRefusal | null {
  if (step === undefined) {
    return 'unknown_step'
  }

  if (intent === 'skip') {
    return step.required ? 'step_required' : null
  }

  return step.satisfied ? null : 'step_not_satisfied'
}

/**
 * La progression après un franchissement.
 *
 * **Rejouable sans effet supplémentaire** (`docs/reliability.md` §1) : une
 * étape déjà franchie n'est pas ajoutée deux fois, et l'instant de fin n'est
 * jamais réécrit — sans quoi un double clic déplacerait la date de clôture du
 * parcours.
 */
export function progressAfter(
  steps: readonly OnboardingStep[],
  progress: OnboardingProgress,
  stepId: string,
  now: Date,
): OnboardingProgress {
  const clearedSteps = progress.clearedSteps.includes(stepId)
    ? progress.clearedSteps
    : [...progress.clearedSteps, stepId]
  const cleared = new Set(clearedSteps)
  const remaining = steps.some((step) => !cleared.has(step.id))

  return {
    clearedSteps,
    completedAt: remaining ? progress.completedAt : (progress.completedAt ?? now),
  }
}

/**
 * **Le nom affiché est-il celui que la personne a choisi ?**
 *
 * L'inscription pose le nom **à l'adresse** (`auth-routes.ts`, route `signUp` :
 * `{ ...input, name: input.email }`). « Le nom est renseigné » ne peut donc pas
 * se lire « le nom n'est pas vide » : ce serait vrai de tout compte dès sa
 * création, et l'étape obligatoire de profil serait franchie sans que personne
 * n'ait rien saisi — le défaut silencieux du critère 6, à la lettre.
 *
 * Deux chaînes, aucune connaissance de `auth` : la comparaison est celle de
 * deux valeurs, insensible à la casse et aux espaces de bord comme l'est une
 * adresse.
 */
export function displayNameProvided(name: string, email: string): boolean {
  const trimmed = name.trim()

  return trimmed !== '' && trimmed.toLowerCase() !== email.trim().toLowerCase()
}
