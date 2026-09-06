/**
 * Interfaces des dépendances externes (`docs/architecture.md`).
 *
 * Un fichier par capacité, et tous sur le même gabarit : `mailer` d'abord (s06),
 * `storage` ensuite (s18), `payments` (s19), `rate-limit` (s28), `jobs` (s33),
 * `analytics` et `monitoring` (s39).
 */
export { ANALYTICS_ERROR_CODES } from './analytics'
export type {
  Analytics,
  AnalyticsError,
  AnalyticsErrorCode,
  AnalyticsEvent,
  AnalyticsLogger,
  AnalyticsLogRecord,
  AnalyticsPageView,
  AnalyticsProperties,
  AnalyticsPropertyValue,
  AnalyticsResult,
} from './analytics'
export { MONITORING_ERROR_CODES, MONITORING_ORIGINS } from './monitoring'
export type {
  CaptureResult,
  Monitoring,
  MonitoringError,
  MonitoringErrorCode,
  MonitoringEvent,
  MonitoringLogger,
  MonitoringLogRecord,
  MonitoringOrigin,
} from './monitoring'
export { JOBS_ERROR_CODES } from './jobs'
export type {
  EmitJobResult,
  JobEmission,
  Jobs,
  JobsError,
  JobsErrorCode,
  JobsLogger,
  JobsLogRecord,
} from './jobs'
export type {
  Checkout,
  CancelSubscriptionInput,
  CancelSubscriptionResult,
  CheckoutMode,
  CreateCheckoutInput,
  CreateCheckoutResult,
  CreatePortalSessionInput,
  CreatePortalSessionResult,
  ListPurchasesInput,
  ListPurchasesResult,
  ListSubscriptionsInput,
  ListSubscriptionsResult,
  PaymentEvent,
  PaymentPurchase,
  Payments,
  PaymentsError,
  PaymentsErrorCode,
  PaymentsLogRecord,
  PaymentsLogger,
  PaymentsOperation,
  PaymentStatus,
  PaymentSubscription,
  PortalSession,
  UpdateSubscriptionQuantityInput,
  UpdateSubscriptionQuantityResult,
  VerifyWebhookInput,
  VerifyWebhookResult,
} from './payments'
export type {
  EmailData,
  EmailRenderer,
  Mailer,
  MailerError,
  MailerErrorCode,
  MailerLogRecord,
  MailerLogger,
  RenderedEmail,
  SendEmailInput,
  SendEmailResult,
} from './mailer'

export type {
  ConsumeRateLimitInput,
  ConsumeRateLimitResult,
  RateLimitBucketRequest,
  RateLimitBucketState,
  RateLimiter,
  RateLimitError,
  RateLimitErrorCode,
  RateLimitLogger,
  RateLimitLogRecord,
  SweepRateLimitResult,
} from './rate-limit'

export type {
  PresignUploadInput,
  PresignUploadResult,
  PresignedUpload,
  ReadObjectResult,
  RemoveObjectResult,
  Storage,
  StorageError,
  StorageErrorCode,
  StorageLogRecord,
  StorageLogger,
  StoredObject,
  WriteObjectInput,
  WriteObjectResult,
} from './storage'
