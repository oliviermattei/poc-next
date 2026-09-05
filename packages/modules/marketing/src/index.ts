/**
 * Le module du site public — **optionnel**, et c'est tout son intérêt.
 *
 * Trois surfaces sortent d'ici, et elles n'ont pas le même public :
 *
 * - le **contrat** (`marketingModule`), lu par `config/features.ts` ;
 * - la **règle** (`resolveMarketingSite` et le domaine), appelée par le point de
 *   composition de l'application, qui possède `config/marketing.ts` ;
 * - la **présentation**, composée depuis `@repo/ui` et rendue par les écrans —
 *   sur un **second point d'entrée**, `@repo/module-marketing/presentation`.
 *
 * Ce second point d'entrée n'est pas une élégance : `config/features.ts`
 * importe le contrat, et ce fichier est lu par `pnpm db:generate` comme par
 * `pnpm ks`, dont les compilateurs ne connaissent pas le JSX. Réexporter un
 * `.tsx` d'ici faisait échouer le `typecheck` de `@repo/db` sur
 * « `--jsx` is not set » — mesuré. Un module à composants n'a pas à obliger
 * chaque outil du dépôt à savoir compiler du JSX.
 */
export { marketingModule } from './module'
/**
 * Les tables, réexportées **à plat** : c'est la seule forme que
 * `drizzle-kit generate` sait lire dans le baril généré (`generated/schema/`),
 * qui n'accepte que des exports de premier niveau.
 */
export { contactMessage, marketingSchema, publicFormThrottle, publicSubscription } from './schema'
export {
  CONTACT_PATH,
  EMPTY_MARKETING_SITE,
  legalDocumentOf,
  legalPath,
  resolveMarketingSite,
  type MarketingSite,
} from './application/marketing-site'
export {
  MARKETING_MODULE_ID,
  MarketingConfigurationError,
  SECTION_KINDS,
  parseMarketingConfiguration,
  type MarketingAction,
  type MarketingConfiguration,
  type MarketingConfigurationInput,
  type MarketingForms,
  type MarketingLegalDocument,
  type MarketingRateLimit,
  type MarketingSection,
  type MarketingSectionKind,
} from './domain/marketing-config'
export {
  CONTACT_FORM,
  NEWSLETTER_FORM,
  PUBLIC_FORM_IDS,
  TRAP_FIELD,
  normaliseEmail,
  parseContactSubmission,
  parseNewsletterSubmission,
  type ContactSubmission,
  type NewsletterSubmission,
  type PublicFormId,
  type PublicFormRefusal,
} from './domain/public-forms'
export {
  UNKNOWN_CLIENT,
  clientIdentifierOf,
  exceedsRateLimit,
  rateLimitBuckets,
  windowStartOf,
  type RateLimitBucket,
  type RateLimitBuckets,
  type RateLimitPolicy,
  type RateLimitVerdict,
} from './domain/rate-limit'
export {
  MARKETING_EMAIL_TEMPLATES,
  createPublicFormsUseCases,
  type PublicFormOutcome,
  type PublicFormSubmission,
  type PublicFormsUseCases,
} from './application/public-forms'
export type {
  ContactMessageRecord,
  ContactMessageRepository,
  PublicFormsDependencies,
  PublicSubscriptionRecord,
  PublicSubscriptionRepository,
  ScopeEmailResolver,
  SubmissionThrottle,
} from './application/ports'
export {
  createDrizzleContactMessages,
  createDrizzlePublicSubscriptions,
  type MarketingDatabase,
} from './infrastructure/drizzle-public-forms'
export { createSharedSubmissionThrottle } from './infrastructure/shared-submission-throttle'
export {
  createPublicFormRoutes,
  marketingRoutePath,
} from './presentation/public-form-routes'
export {
  MarketingNotConfiguredError,
  configureMarketing,
  provideMarketing,
  requireMarketingService,
  resetMarketingService,
  type ConfigureMarketingOptions,
  type MarketingService,
} from './infrastructure/marketing-runtime'
export {
  CONTACT_DESCRIPTION_KEY,
  CONTACT_FORM_KEYS,
  CONTACT_TITLE_KEY,
  FORM_NOSCRIPT_KEY,
  HOME_DESCRIPTION_KEY,
  HOME_TITLE_KEY,
  NEWSLETTER_FORM_KEYS,
  legalDescriptionKey,
  legalTitleKey,
  marketingKey,
  marketingMessageKeys,
} from './domain/message-keys'
export {
  marketingPublicUrls,
  provideMarketingContent,
  resetMarketingContent,
  MarketingContentNotProvidedError,
} from './infrastructure/marketing-content'
