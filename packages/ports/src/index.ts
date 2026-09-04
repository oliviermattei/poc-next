/**
 * Interfaces des dépendances externes (`docs/architecture.md`).
 *
 * Un fichier par capacité, et tous sur le même gabarit : `mailer` d'abord (s06),
 * `storage` ensuite (s18), `payments` (s19), `rate-limit` (s28) ; jobs,
 * analytique et monitoring suivront.
 */
export type {
  Checkout,
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
