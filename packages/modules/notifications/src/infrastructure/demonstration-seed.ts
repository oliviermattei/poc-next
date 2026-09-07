import type { ModuleSeed, ModuleSeedContext } from '@repo/core'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import { notification } from '../schema'

/**
 * **Le centre de notifications, non vide** (s58).
 *
 * Les types employés sont ceux que ce module **traduit déjà** dans
 * `src/messages/` : une notification d'un type sans libellé s'afficherait comme
 * une clé de traduction, c'est-à-dire comme un défaut. Ce module ne lit pas
 * `config/notifications.ts` — il ne l'a jamais fait, le catalogue lui est
 * transmis — et le seed ne l'y fait pas déroger.
 *
 * **`organizationId` reste `null`**, et c'est une décision de configuration :
 * une notification de compte est visible que le module `organizations` soit
 * activé ou non, alors qu'une notification d'organisation disparaîtrait de
 * l'écran dans la configuration où ce module est coupé — des lignes en base que
 * personne ne peut voir.
 */
export type NotificationsSeedDatabase = Pick<PgDatabase<PgQueryResultHKT>, 'insert'>

/** Une ligne de démonstration, telle que la table l'attend. */
interface DemonstrationNotification {
  readonly suffix: string
  readonly type: string
  readonly payload: Record<string, string | number>
  readonly read: boolean
}

/** Une date de démonstration lisible, proche mais pas d'aujourd'hui. */
const inDays = (days: number): string =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)

export const notificationsDemonstrationSeed: ModuleSeed = {
  id: 'notifications',
  run: async ({ database, demonstration }: ModuleSeedContext<NotificationsSeedDatabase>) => {
    const recipients = demonstration
      .filter((scope) => scope.kind === 'user')
      .map((scope) => scope.userId)

    for (const [index, recipientId] of recipients.entries()) {
      const others = recipients.filter((candidate) => candidate !== recipientId)

      const rows: readonly DemonstrationNotification[] = [
        {
          suffix: 'securite',
          type: 'account.security-alert',
          payload: { summary: 'connexion depuis un appareil inconnu (démonstration)' },
          read: false,
        },
        {
          suffix: 'essai',
          type: 'billing.trial-ending',
          payload: { offer: 'Pro (démonstration)', date: inDays(7) },
          // Lue : une liste dont **tout** est non lu ne montre pas la
          // distinction que l'écran porte, ni le compteur du badge.
          read: true,
        },
        // Le premier compte est celui que la découverte ouvre : lui seul reçoit
        // l'arrivée d'un collègue, et seulement s'il y a un collègue.
        ...(index === 0 && others[0] !== undefined
          ? [
              {
                suffix: 'arrivee',
                type: 'organization.member-joined',
                // `member` porte l'**identifiant** du compte arrivé, jamais son
                // adresse : le nom affiché est résolu à la lecture.
                payload: { member: others[0], organization: 'l’organisation de démonstration' },
                read: false,
              },
            ]
          : []),
      ]

      for (const row of rows) {
        await database
          .insert(notification)
          .values({
            id: `demo-notification-${recipientId}-${row.suffix}`,
            recipientId,
            organizationId: null,
            type: row.type,
            payload: row.payload,
            readAt: row.read ? new Date() : null,
          })
          .onConflictDoNothing()
      }
    }
  },
}
