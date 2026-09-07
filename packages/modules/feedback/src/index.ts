/**
 * Le baril du module : **le contrat, `domain` et `application`**, jamais un
 * `.tsx` (ADR 024).
 *
 * `config/features.ts` importe ce fichier, et il est lu par `pnpm db:generate`
 * comme par `pnpm ks`, dont les compilateurs ne connaissent pas le JSX. Le
 * formulaire passe par le second point d'entrée,
 * `@repo/module-feedback/presentation`.
 */
export { feedbackModule } from './module'
/**
 * La table, **réexportée à plat** : c'est la seule forme que
 * `drizzle-kit generate` sait lire depuis le baril généré (`generated/schema/`).
 */
export { feedback, feedbackSchema } from './schema'
export {
  parseFeedbackSubmission,
  parseFeedbackTarget,
  parseOriginPath,
  FEEDBACK_CATEGORIES,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_ORIGIN_MAX_LENGTH,
  FEEDBACK_STATUSES,
  type FeedbackCategory,
  type FeedbackStatus,
  type FeedbackSubmission,
  type FeedbackSubmissionOutcome,
} from './domain/feedback'
export {
  createFeedbackUseCases,
  type FeedbackListEntry,
  type FeedbackUseCases,
  type SubmitFeedbackOutcome,
} from './application/feedback-use-cases'
export type {
  ActiveOrganizationResolver,
  BackOfficeAuthorizer,
  FeedbackAnnouncer,
  FeedbackRecord,
  FeedbackRepository,
} from './application/ports'
export {
  FeedbackNotConfiguredError,
  type FeedbackService,
} from './application/feedback-service'
export {
  configureFeedback,
  provideFeedback,
  requireFeedbackService,
  resetFeedbackService,
  type ConfigureFeedbackOptions,
} from './infrastructure/feedback-runtime'
export {
  feedbackNavigation,
  feedbackRoutePath,
  ADMIN_FEEDBACK_SCREEN_PATH,
  FEEDBACK_KEYS,
  FEEDBACK_SCREEN_PATH,
} from './presentation/feedback-routes'
