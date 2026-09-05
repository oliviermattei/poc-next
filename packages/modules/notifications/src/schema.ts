import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * Les tables du module `notifications` — **deux, et pas une de plus**.
 *
 * Elles n'existent que lorsque le module est activé : `pnpm db:generate` ne
 * génère que pour les modules de `config/features.ts`, et sur une base vierge
 * dont la configuration ne nomme pas ce module, aucune des deux n'est créée.
 * C'est le critère 7 de la story, et `pnpm test:minimal-profile` le mesure sur
 * le **schéma réel** (`information_schema`), jamais sur les fichiers de
 * migration.
 *
 * **Aucune clé étrangère, et c'est une décision** — la même que celle de
 * `storage`, pour les deux mêmes raisons :
 *
 * 1. vers `organization` : elle obligerait ce module à déclarer `organizations`
 *    dans ses requis (ADR 018), donc rendrait les notifications indisponibles en
 *    mode mono-utilisateur. Le périmètre d'une notification est une **donnée**,
 *    résolue par le point de composition, pas une contrainte de schéma ;
 * 2. vers `auth_user` : elle serait permise (`auth` est un requis déclaré), et
 *    elle est volontairement absente. Une cascade effacerait les lignes sans
 *    passer par `purge`, et le module perdrait la seule porte où l'effacement
 *    est observable — `docs/reliability.md` §1 veut la purge **rejouable et
 *    mesurée**, pas déléguée à une contrainte.
 *
 * Conséquence assumée, et il faut la lire : une ligne de `auth_user` effacée
 * **hors** de `purgeModules` laisserait des notifications sans destinataire.
 * C'est le même arbitrage que `storage_file`, et la même réponse : la
 * suppression de compte passe par `purgeModules` (ADR 029), qui exécute ce
 * module **avant** `auth`.
 */

export const notification = pgTable(
  'notification',
  {
    id: text('id').primaryKey(),
    /** Le compte à qui elle est **adressée**. Une notification n'est jamais collective. */
    recipientId: text('recipient_id').notNull(),
    /**
     * Le périmètre organisation de l'événement, ou `null` pour une notification
     * de compte. C'est lui que la lecture confronte aux organisations de
     * l'appelant (critère 5).
     */
    organizationId: text('organization_id'),
    /** L'identifiant du type, tel que `config/notifications.ts` le déclare. */
    type: text('type').notNull(),
    /** Les données interpolées dans le libellé. Plates et scalaires, comme `EmailData`. */
    payload: jsonb('payload').$type<Record<string, string | number>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    /** `null` tant qu'elle n'est pas lue. C'est ce que le badge compte. */
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    // La question de l'écran : « les notifications de ce compte, les plus
    // récentes en premier ». Sans lui, chaque affichage balaie la table.
    index('notification_recipient_created_idx').on(table.recipientId, table.createdAt),
    // La question du badge : « combien de non-lues ? ». Elle ne se dérive pas
    // d'une page — une page compte vingt lignes, pas l'ensemble.
    index('notification_recipient_read_idx').on(table.recipientId, table.readAt),
    // La question de la purge d'organisation : « qu'est-ce qui appartient à ce
    // périmètre ? ».
    index('notification_organization_idx').on(table.organizationId),
  ],
)

export const notificationPreference = pgTable(
  'notification_preference',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    type: text('type').notNull(),
    /** `in_app` ou `email` — la valeur du canal, écrite par le module. */
    channel: text('channel').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // **Une seule préférence par compte, type et canal**, et c'est la base qui
    // le tient : deux écritures simultanées passeraient toutes deux un `select`
    // préalable (`docs/reliability.md` §1). C'est aussi ce qui rend l'écriture
    // idempotente — un `onConflictDoUpdate`, pas un « lire puis choisir ».
    uniqueIndex('notification_preference_key').on(table.userId, table.type, table.channel),
  ],
)

/** Les tables du module, telles que le contrat les déclare. */
export const notificationsSchema = { notification, notificationPreference } as const
