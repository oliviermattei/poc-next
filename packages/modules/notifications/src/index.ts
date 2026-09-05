/**
 * Le baril du module : **le contrat, `domain` et `application`**, jamais un
 * `.tsx` (ADR 024).
 *
 * `config/features.ts` importe ce fichier, et il est lu par `pnpm db:generate`
 * comme par `pnpm ks`, dont les compilateurs ne connaissent pas le JSX.
 * L'écran passe par le second point d'entrée,
 * `@repo/module-notifications/presentation`.
 */
export { notificationsModule } from './module'
/**
 * Les tables, **réexportées à plat** : c'est la seule forme que
 * `drizzle-kit generate` sait lire depuis le baril généré (`generated/schema/`).
 */
export { notification, notificationPreference, notificationsSchema } from './schema'
export {
  allowedChannels,
  isVisibleTo,
  pageOf,
  resolveActorReferences,
  NOTIFICATIONS_MODULE_ID,
  NOTIFICATIONS_SCREEN_PATH,
  NOTIFICATION_PAGE_SIZE,
  type ChannelPreference,
  type NotificationAddress,
  type NotificationChannel,
  type NotificationPage,
  type NotificationScope,
  type ResolvedPayload,
} from './domain/notification'
export {
  createNotificationUseCases,
  EMPTY_NOTIFICATIONS_VIEW,
  type ChannelSetting,
  type MarkReadOutcome,
  type NotificationUseCases,
  type NotificationView,
  type NotificationsView,
  type NotificationTypeSummary,
  type RecordOutcome,
  type SetPreferenceOutcome,
  type TypePreferenceView,
} from './application/notification-use-cases'
export type {
  NotificationRecord,
  NotificationRepository,
  PreferenceRecord,
  PreferenceRepository,
} from './application/ports'
export {
  configureNotifications,
  provideNotifications,
  requireNotificationsService,
  resetNotificationsService,
  NotificationsNotConfiguredError,
  type ConfigureNotificationsOptions,
  type NotificationsService,
} from './infrastructure/notifications-runtime'
export type { NotificationsDatabase } from './infrastructure/drizzle-notification-repositories'
export {
  channelLabelKey,
  notificationsFixedKeys,
  notificationsKey,
  typeBodyKey,
  typeLabelKey,
  NOTIFICATIONS_KEYS,
} from './domain/message-keys'
export {
  createNotificationRoutes,
  notificationRoutePath,
  notificationsNavigation,
  type NotificationRouteService,
} from './presentation/notification-routes'
