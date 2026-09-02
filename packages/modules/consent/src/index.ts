/**
 * Le module `consent` — le contrat, son domaine, ses cas d'usage.
 *
 * **Aucun `.tsx` n'est réexporté ici** (ADR 024) : ce barril est lu par
 * `config/features.ts`, donc par `pnpm db:generate`, `pnpm ks` et le
 * `typecheck` de `@repo/db`, dont aucun ne compile du JSX. Les composants
 * passent par le second point d'entrée, `@repo/module-consent/presentation`.
 */
export { consentModule } from './module'

export {
  CONSENT_CATEGORIES,
  CONSENT_MODULE_ID,
  CONSENT_STATUSES,
  declaredCategories,
  decideFrom,
  resolveConsentState,
  statusOf,
  type ConsentCategory,
  type ConsentDecisions,
  type ConsentIntent,
  type ConsentState,
  type ConsentStatus,
  type ConsentSubmission,
  type NonEssentialScript,
} from './domain/consent-category'

export {
  CONSENT_COOKIE,
  CONSENT_COOKIE_MAX_AGE,
  consentSetCookie,
  decodeConsentCookie,
  encodeConsentCookie,
} from './domain/consent-cookie'

export {
  BANNER_ACCEPT_KEY,
  BANNER_CUSTOMIZE_KEY,
  BANNER_DESCRIPTION_KEY,
  BANNER_LABEL_KEY,
  BANNER_REFUSE_KEY,
  BANNER_TITLE_KEY,
  categoryDescriptionKey,
  categoryTitleKey,
  consentKey,
  consentMessageKeys,
  EMPTY_DESCRIPTION_KEY,
  EMPTY_TITLE_KEY,
  FOOTER_LINK_KEY,
  PREFERENCES_DESCRIPTION_KEY,
  PREFERENCES_SAVE_KEY,
  PREFERENCES_TITLE_KEY,
  SCREEN_DESCRIPTION_KEY,
  SCREEN_TITLE_KEY,
  SETTINGS_ACTION_KEY,
  SETTINGS_DESCRIPTION_KEY,
  SETTINGS_TITLE_KEY,
  statusLabelKey,
} from './domain/message-keys'

export { isSameSiteSubmission, safeReturnPath } from './domain/request-guard'

export {
  createConsentUseCases,
  type ConsentDependencies,
  type ConsentUseCases,
  type RecordedConsent,
} from './application/consent-use-cases'

export {
  configureConsent,
  ConsentNotConfiguredError,
  provideConsent,
  requireConsentService,
  resetConsentService,
  type ConsentService,
} from './infrastructure/consent-runtime'

export { consentRoutePath } from './presentation/consent-routes'

export { CONSENT_SCREEN_PATH, CONSENT_SCREEN_SEGMENT } from './presentation/consent-paths'
