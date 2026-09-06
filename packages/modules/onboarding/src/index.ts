/**
 * Le baril du module : **le contrat, `domain` et `application`**, jamais un
 * `.tsx` (ADR 024).
 *
 * `config/features.ts` importe ce fichier, et il est lu par `pnpm db:generate`
 * comme par `pnpm ks`, dont les compilateurs ne connaissent pas le JSX.
 * L'écran passe par le second point d'entrée,
 * `@repo/module-onboarding/presentation`.
 */
export { onboardingModule } from './module'
/**
 * La table, **réexportée à plat** : c'est la seule forme que
 * `drizzle-kit generate` sait lire depuis le baril généré (`generated/schema/`).
 */
export { onboardingProgress, onboardingSchema } from './schema'
export {
  clearanceOf,
  courseOf,
  displayNameProvided,
  progressAfter,
  CLEAR_REFUSALS,
  EMPTY_COURSE,
  EMPTY_PROGRESS,
  ONBOARDING_FIELD_AVATAR,
  ONBOARDING_FIELD_NAME,
  ONBOARDING_MODULE_ID,
  ONBOARDING_SCREEN_PATH,
  type ClearIntent,
  type ClearRefusal,
  type OnboardingCourse,
  type OnboardingProgress,
  type OnboardingStep,
  type OnboardingStepState,
  type OnboardingStepView,
} from './domain/onboarding'
export {
  onboardingKey,
  stepActionKey,
  stepDescriptionKey,
  stepTitleKey,
  ONBOARDING_KEYS,
} from './domain/message-keys'
export {
  createOnboardingUseCases,
  type OnboardingUseCases,
} from './application/onboarding-use-cases'
export type { OnboardingProgressRepository } from './application/ports'
export {
  configureOnboarding,
  provideOnboarding,
  requireOnboardingService,
  resetOnboardingService,
  OnboardingNotConfiguredError,
  type ConfigureOnboardingOptions,
  type OnboardingService,
} from './infrastructure/onboarding-runtime'
export type { OnboardingDatabase } from './infrastructure/drizzle-onboarding-repository'
export {
  createOnboardingRoutes,
  onboardingRoutePath,
  type OnboardingRouteService,
} from './presentation/onboarding-routes'
