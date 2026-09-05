/**
 * Templates React Email et leur rendu.
 *
 * Ce package est le seul du couple port/adapters à connaître React : le rendu
 * est **injecté** dans les implémentations de `Mailer`, jamais hérité.
 */
export { EmailTemplateError, createEmailRenderer, qualifyEmailTemplateId } from './render'
export { TransactionalEmail, type TransactionalEmailProps } from './transactional-email'
export {
  createNotificationEmitter,
  createNotificationTypeRegistry,
  defineNotificationType,
  notificationTemplateId,
  NotificationTypeError,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TEMPLATE_NAMESPACE,
  type EmitNotificationError,
  type EmitNotificationErrorCode,
  type EmitNotificationInput,
  type EmitNotificationResult,
  type NotificationCentre,
  type NotificationChannel,
  type NotificationEmitter,
  type NotificationRecipient,
  type NotificationTypeDeclaration,
  type NotificationTypeRegistry,
  type RecordNotificationInput,
  type RecordNotificationResult,
} from './notifications'
