import { and, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type {
  NotificationRecord,
  NotificationRepository,
  PreferenceRecord,
  PreferenceRepository,
} from '../application/ports'
import type { NotificationChannel, NotificationScope } from '../domain/notification'
import { notification, notificationPreference } from '../schema'

/**
 * Les repositories du module, sur **ses** deux tables.
 *
 * La connexion est **injectée** : ce package ne dépend pas de `@repo/db`, et
 * c'est ce qui empêche le cycle `@repo/db` → agrégat généré → module (ADR 020).
 * Le type est réduit aux opérations employées, comme dans `auth`,
 * `organizations` et `storage` : un `NodePgDatabase<TSchema>` complet porterait
 * le schéma des autres modules dans son type, et une connexion construite avec
 * plusieurs modules ne lui serait pas assignable.
 *
 * **Toutes les requêtes sont paramétrées** : Drizzle lie les valeurs, aucune
 * n'est concaténée dans du SQL (`docs/security.md` §4).
 */

export type NotificationsDatabase = Pick<
  PgDatabase<PgQueryResultHKT>,
  'select' | 'insert' | 'update' | 'delete'
>

/**
 * **Le filtre de périmètre — la seule porte de lecture** (critère 5).
 *
 * Il traduit `isVisibleTo` en SQL, et il est écrit **une fois** : chaque
 * méthode du repository part de lui, si bien qu'une lecture qui l'omettrait
 * n'existe pas. Le destinataire d'abord — une notification est adressée —,
 * puis le périmètre : une notification de compte (`organization_id IS NULL`) ou
 * une notification d'une organisation dont l'appelant est **encore** membre.
 *
 * `organizationIds` vide — mode mono-utilisateur, ou compte sans organisation —
 * réduit la condition aux seules notifications de compte : `inArray` sur une
 * liste vide ne rend jamais de ligne, ce qui est exactement la règle.
 */
const visibleTo = (scope: NotificationScope) =>
  and(
    eq(notification.recipientId, scope.userId),
    or(
      isNull(notification.organizationId),
      scope.organizationIds.length === 0
        ? sql`false`
        : inArray(notification.organizationId, [...scope.organizationIds]),
    ),
  )

const toRecord = (row: {
  id: string
  recipientId: string
  organizationId: string | null
  type: string
  payload: Record<string, string | number>
  createdAt: Date
  readAt: Date | null
}): NotificationRecord => ({
  id: row.id,
  recipientId: row.recipientId,
  organizationId: row.organizationId,
  type: row.type,
  payload: row.payload,
  createdAt: row.createdAt,
  readAt: row.readAt,
})

export function createDrizzleNotificationRepository(
  db: NotificationsDatabase,
): NotificationRepository {
  const rowsWhere = async (where: ReturnType<typeof visibleTo>) =>
    await db.select().from(notification).where(where).orderBy(desc(notification.createdAt))

  return {
    create: async (input) => {
      await db.insert(notification).values({
        id: input.id,
        recipientId: input.recipientId,
        organizationId: input.organizationId,
        type: input.type,
        payload: input.payload,
        createdAt: input.at,
      })
    },

    listVisible: async (scope, page) => {
      const rows = await db
        .select()
        .from(notification)
        .where(visibleTo(scope))
        // **Les plus récentes en premier** (critère 1). L'identifiant départage
        // deux lignes de même horodatage : sans lui, deux pages successives
        // pourraient montrer deux fois la même ligne, et en omettre une autre.
        .orderBy(desc(notification.createdAt), desc(notification.id))
        .limit(page.limit)
        .offset(page.offset)

      return rows.map(toRecord)
    },

    countVisible: async (scope) => {
      const [row] = await db
        .select({ total: count() })
        .from(notification)
        .where(visibleTo(scope))

      return row?.total ?? 0
    },

    countUnread: async (scope) => {
      const [row] = await db
        .select({ total: count() })
        .from(notification)
        .where(and(visibleTo(scope), isNull(notification.readAt)))

      return row?.total ?? 0
    },

    markRead: async (scope, id, at) => {
      // **Le périmètre est dans le `where`, jamais vérifié après coup.** Une
      // lecture préalable suivie d'une écriture laisserait une fenêtre, et
      // surtout permettrait de distinguer « inconnue » de « pas à vous » —
      // c'est cette distinction que `docs/security.md` §3 refuse.
      const updated = await db
        .update(notification)
        .set({ readAt: at })
        .where(and(visibleTo(scope), eq(notification.id, id)))
        .returning({ id: notification.id })

      return updated.length > 0
    },

    markAllRead: async (scope, at) => {
      const updated = await db
        .update(notification)
        .set({ readAt: at })
        .where(and(visibleTo(scope), isNull(notification.readAt)))
        .returning({ id: notification.id })

      return updated.length
    },

    deleteForUser: async (userId) => {
      await db.delete(notification).where(eq(notification.recipientId, userId))
    },

    deleteForOrganization: async (organizationId) => {
      await db.delete(notification).where(eq(notification.organizationId, organizationId))
    },

    listForUser: async (userId) =>
      (await rowsWhere(eq(notification.recipientId, userId))).map(toRecord),

    listForOrganization: async (organizationId) =>
      (await rowsWhere(eq(notification.organizationId, organizationId))).map(toRecord),
  }
}

const toPreference = (row: {
  type: string
  channel: string
  enabled: boolean
}): PreferenceRecord => ({
  type: row.type,
  channel: row.channel as NotificationChannel,
  enabled: row.enabled,
})

export function createDrizzlePreferenceRepository(
  db: NotificationsDatabase,
): PreferenceRepository {
  return {
    listForUser: async (userId) =>
      (
        await db
          .select()
          .from(notificationPreference)
          .where(eq(notificationPreference.userId, userId))
      ).map(toPreference),

    listForType: async (userId, type) =>
      (
        await db
          .select()
          .from(notificationPreference)
          .where(
            and(
              eq(notificationPreference.userId, userId),
              eq(notificationPreference.type, type),
            ),
          )
      ).map(toPreference),

    set: async (input) => {
      // **Une écriture, pas une lecture suivie d'un choix.** L'index unique
      // porte la règle ; rejouée, l'écriture ne crée pas une seconde ligne
      // (`docs/reliability.md` §1).
      await db
        .insert(notificationPreference)
        .values({
          id: input.id,
          userId: input.userId,
          type: input.type,
          channel: input.channel,
          enabled: input.enabled,
          updatedAt: input.at,
        })
        .onConflictDoUpdate({
          target: [
            notificationPreference.userId,
            notificationPreference.type,
            notificationPreference.channel,
          ],
          set: { enabled: input.enabled, updatedAt: input.at },
        })
    },

    deleteForUser: async (userId) => {
      await db.delete(notificationPreference).where(eq(notificationPreference.userId, userId))
    },
  }
}
