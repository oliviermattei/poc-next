import { randomUUID } from 'node:crypto'

import {
  createNotificationUseCases,
  type NotificationTypeSummary,
  type NotificationUseCases,
} from '../application/notification-use-cases'
import type { NotificationScope } from '../domain/notification'
import {
  createDrizzleNotificationRepository,
  createDrizzlePreferenceRepository,
  type NotificationsDatabase,
} from './drizzle-notification-repositories'

/**
 * Le service du module, **construit à la première requête**, pas à l'import.
 *
 * `config/features.ts` charge le contrat du module, et ce fichier est lu par
 * `pnpm ks list` comme par `pnpm db:generate`, qui n'ont pas de base. Les
 * routes reçoivent donc un accès **différé** au service, posé par le point de
 * composition de l'application (`apps/web/lib/notifications.ts`). C'est le
 * patron de `auth`, `organizations`, `marketing` et `storage`, repris à
 * l'identique.
 */

export interface ConfigureNotificationsOptions {
  /** Connexion Drizzle, fournie par le point de composition (jamais lue ici). */
  readonly db: NotificationsDatabase
  /**
   * Le catalogue de types, **reçu** du socle.
   *
   * Le module ne lit pas `config/notifications.ts` : le catalogue survit à sa
   * coupure, donc il ne lui appartient pas (ADR 057).
   */
  readonly types: readonly NotificationTypeSummary[]
  /**
   * Le périmètre de lecture d'un compte — son identifiant et **ses**
   * organisations.
   *
   * Le module ne connaît ni `auth` ni `organizations`, et n'a pas le droit de
   * lire leurs tables : l'appartenance lui est **donnée**, exactement comme
   * `readableScopes` l'est à `storage`. C'est ce qui tient le critère 5 sans
   * qu'aucune clé étrangère ne lie les deux modules.
   */
  readonly scopeOf: (userId: string) => Promise<NotificationScope>
  /**
   * Les noms affichables de comptes, **donnés** au module (revue s32, R1).
   *
   * Même raison que `scopeOf` : le module stocke des références de compte —
   * une ligne survit aux gens qu'elle nomme — et ne connaît pas la forme d'un
   * compte. Un identifiant absent de la réponse est un compte effacé.
   *
   * **Obligatoire** : un repli sur l'identifiant afficherait une donnée
   * technique à l'écran, et un repli sur rien casserait l'interpolation.
   */
  readonly displayNamesOf: (userIds: readonly string[]) => Promise<ReadonlyMap<string, string>>
  readonly generateId?: () => string
  readonly now?: () => Date
}

export interface NotificationsService {
  readonly useCases: NotificationUseCases
  readonly scopeOf: (userId: string) => Promise<NotificationScope>
}

export class NotificationsNotConfiguredError extends Error {
  constructor() {
    super(
      'Le module « notifications » n’est pas configuré : le point de composition ' +
        'de l’application doit appeler provideNotifications() avant de servir une requête.',
    )
    this.name = 'NotificationsNotConfiguredError'
  }
}

let service: NotificationsService | null = null
let provider: (() => ConfigureNotificationsOptions) | null = null

const build = (options: ConfigureNotificationsOptions): NotificationsService => ({
  useCases: createNotificationUseCases({
    notifications: createDrizzleNotificationRepository(options.db),
    preferences: createDrizzlePreferenceRepository(options.db),
    types: options.types,
    displayNamesOf: options.displayNamesOf,
    newId: options.generateId ?? (() => `ntf_${randomUUID()}`),
    now: options.now ?? (() => new Date()),
  }),
  scopeOf: options.scopeOf,
})

/** Construit le service **maintenant**. C'est la forme qu'une suite de tests emploie. */
export function configureNotifications(
  options: ConfigureNotificationsOptions,
): NotificationsService {
  service = build(options)

  return service
}

/**
 * Dit **comment** construire le service, sans le construire.
 *
 * Le répartiteur de modules prépare les services à **chaque** requête, y compris
 * celles qu'aucune route ne satisfait : construire aussitôt ouvrirait une
 * connexion à la base pour répondre 404 sur un chemin inconnu.
 */
export function provideNotifications(factory: () => ConfigureNotificationsOptions): void {
  provider = factory
}

export function requireNotificationsService(): NotificationsService {
  if (service !== null) {
    return service
  }

  if (provider === null) {
    throw new NotificationsNotConfiguredError()
  }

  service = build(provider())

  return service
}

/** Remet le module à son état non configuré. Réservé aux suites de tests. */
export function resetNotificationsService(): void {
  service = null
  provider = null
}
