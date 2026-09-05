import { qualifyMessageKey } from '@repo/core'

import { NOTIFICATIONS_MODULE_ID, type NotificationChannel } from './notification'

/**
 * **Toutes** les clés de traduction du module, dérivées ici et nulle part
 * ailleurs — la discipline posée par `organizations` (revue de s15), pour les
 * deux mêmes raisons :
 *
 * 1. `tests/i18n.test.ts` balaie les fichiers **rendus** (`.tsx`) et exige que
 *    chaque clé citée existe dans le catalogue. Une clé écrite dans un `.tsx` y
 *    est vue **non qualifiée** (`screen.title`) alors que le catalogue la porte
 *    qualifiée (`notifications.screen.title`) : citée depuis l'écran, elle
 *    passerait pour manquante ;
 * 2. deux d'entre elles dépendent d'une **valeur** — l'identifiant du type, le
 *    canal. Elles sont invisibles à tout balayage statique, et un gabarit écrit
 *    dans un `.tsx` se lit comme un morceau de phrase concaténé. Les composants
 *    appellent donc des **fonctions nommées**.
 */

/** Une clé du module, qualifiée comme le registre le fera. */
export const notificationsKey = (key: string): string =>
  qualifyMessageKey(NOTIFICATIONS_MODULE_ID, key)

/**
 * Le libellé d'un type de notification.
 *
 * Le catalogue de types vit dans le socle (`config/notifications.ts`, ADR 057)
 * et le **texte** de son libellé dans ce module : le premier survit à la
 * coupure du module, le second disparaît avec l'écran qui l'affichait. La règle
 * qui les relie est exécutable — `tests/notifications.test.ts` confronte les
 * types déclarés aux catalogues, dans chaque locale du projet, et un type
 * ajouté sans son libellé fait rougir `pnpm test` au lieu de faire un écran
 * en 500.
 */
export const typeLabelKey = (typeId: string): string =>
  notificationsKey(`type.${typeId}.label`)

/** Le texte d'une notification, interpolé avec sa charge utile. */
export const typeBodyKey = (typeId: string): string => notificationsKey(`type.${typeId}.body`)

/** Le libellé d'un canal. */
export const channelLabelKey = (channel: NotificationChannel): string =>
  notificationsKey(`channel.${channel}`)

/** Les clés fixes de l'écran, qualifiées une fois pour toutes. */
export const NOTIFICATIONS_KEYS = {
  navigation: notificationsKey('navigation.notifications'),
  screenTitle: notificationsKey('screen.title'),
  screenDescription: notificationsKey('screen.description'),
  unread: notificationsKey('screen.unread'),
  badgeLabel: notificationsKey('screen.badgeLabel'),
  markAll: notificationsKey('screen.markAll'),
  markOneFor: notificationsKey('screen.markOneFor'),
  unreadOne: notificationsKey('screen.unreadOne'),
  /**
   * Le nom d'un compte **effacé**, mis à la place d'une référence que la
   * lecture n'a pas su résoudre (revue s32, R1). La ligne de celui qui reste
   * doit rester lisible quand la personne qu'elle nomme n'est plus là.
   */
  deletedActor: notificationsKey('screen.deletedActor'),
  read: notificationsKey('screen.read'),
  emptyTitle: notificationsKey('screen.empty.title'),
  emptyDescription: notificationsKey('screen.empty.description'),
  emptyAction: notificationsKey('screen.empty.action'),
  paginationLabel: notificationsKey('screen.pagination.label'),
  paginationPrevious: notificationsKey('screen.pagination.previous'),
  paginationNext: notificationsKey('screen.pagination.next'),
  paginationPage: notificationsKey('screen.pagination.page'),
  preferencesTitle: notificationsKey('preferences.title'),
  preferencesDescription: notificationsKey('preferences.description'),
  preferencesOn: notificationsKey('preferences.on'),
  preferencesOff: notificationsKey('preferences.off'),
  preferencesEnableFor: notificationsKey('preferences.enableFor'),
  preferencesDisableFor: notificationsKey('preferences.disableFor'),
} as const

/**
 * Les clés **fixes** du module, pour la garde de catalogue.
 *
 * Dérivée de l'objet ci-dessus, jamais recopiée : une clé ajoutée y entre sans
 * que personne y pense. Les clés à valeur (`type.*`, `channel.*`) sont dérivées
 * ailleurs, du catalogue de types et de la liste des canaux.
 */
export const notificationsFixedKeys = (): readonly string[] =>
  Object.values(NOTIFICATIONS_KEYS)
