/**
 * L'unique implémentation du port `Jobs` (ADR 008) : Inngest.
 *
 * Le code métier ne connaît que `@repo/ports` ; ce package est monté par le
 * point de composition de l'application (`apps/web/lib/jobs.ts`), qui décide
 * entre le fournisseur et l'exécuteur local sur la **configuration**, jamais sur
 * `NODE_ENV`.
 */
export {
  createInngestJobs,
  createInngestRunner,
  isTransientInngestError,
  JOB_EVENT_PREFIX,
  type InngestDispatchOutcome,
  type InngestJobDispatcher,
  type InngestJobsOptions,
  type InngestRunnerOptions,
} from './inngest-jobs'
