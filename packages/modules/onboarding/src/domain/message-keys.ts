import { qualifyMessageKey } from '@repo/core'

import { ONBOARDING_MODULE_ID } from './onboarding'

/**
 * **Toutes** les clés de traduction du module, dérivées ici et nulle part
 * ailleurs — la discipline d'`organizations` et de `notifications`, pour leurs
 * deux raisons :
 *
 * 1. `tests/i18n.test.ts` balaie les fichiers **rendus** et exige que chaque
 *    clé citée existe dans le catalogue. Une clé écrite dans un `.tsx` y est vue
 *    **non qualifiée** (`step.profile.title`) alors que le catalogue la porte
 *    qualifiée (`onboarding.step.profile.title`) ;
 * 2. les clés d'étape dépendent d'une **valeur** — l'identifiant de l'étape,
 *    que le point de composition dérive des modules montés. Elles sont
 *    invisibles à tout balayage statique, et un gabarit écrit dans un `.tsx` se
 *    lirait comme un morceau de phrase concaténé.
 */

/** Une clé du module, qualifiée comme le registre le fera. */
export const onboardingKey = (key: string): string =>
  qualifyMessageKey(ONBOARDING_MODULE_ID, key)

/** Le titre d'une étape. L'identifiant vient des modules montés, jamais d'ici. */
export const stepTitleKey = (stepId: string): string => onboardingKey(`step.${stepId}.title`)

/** Ce que l'étape demande de faire. */
export const stepDescriptionKey = (stepId: string): string =>
  onboardingKey(`step.${stepId}.description`)

/** Le libellé de l'action principale d'une étape. */
export const stepActionKey = (stepId: string): string => onboardingKey(`step.${stepId}.action`)

/** Les clés fixes de l'écran, qualifiées une fois pour toutes. */
export const ONBOARDING_KEYS = {
  screenTitle: onboardingKey('screen.title'),
  screenDescription: onboardingKey('screen.description'),
  /** Le nom accessible du fil d'étapes — c'est une navigation, elle se nomme. */
  trailLabel: onboardingKey('screen.trailLabel'),
  /**
   * Une pastille du fil : le nom de l'étape **et son état, dit en toutes
   * lettres**. Une couleur de badge n'est lisible ni au clavier, ni par une
   * aide technique.
   */
  trailItem: onboardingKey('screen.trailItem'),
  /** « Étape 2 sur 3 » : la position, dite en toutes lettres. */
  position: onboardingKey('screen.position'),
  stateCleared: onboardingKey('screen.state.cleared'),
  stateCurrent: onboardingKey('screen.state.current'),
  stateUpcoming: onboardingKey('screen.state.upcoming'),
  /** Franchir l'étape en cours, une fois son exigence remplie. */
  continue: onboardingKey('screen.continue'),
  /** Passer une étape facultative. Jamais rendu sur une étape obligatoire. */
  skip: onboardingKey('screen.skip'),
  /** Ce que l'écran dit d'une étape obligatoire pas encore remplie. */
  required: onboardingKey('screen.required'),
} as const
