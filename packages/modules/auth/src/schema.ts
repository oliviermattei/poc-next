import { boolean, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * Les tables du module `auth` — **déclarées ici, générées par le baril de
 * s04**, jamais dans un schéma à la racine.
 *
 * C'est le point de frontière n°2 de la story : une bibliothèque
 * d'authentification veut posséder son schéma. Ici, c'est le module qui le
 * possède ; Better Auth reçoit ces tables et n'en crée aucune. La preuve n'est
 * pas cette phrase — `tests/auth.test.ts` confronte ces déclarations à ce que
 * `getAuthTables()` de la bibliothèque attend (nom de modèle et champ par
 * champ), puis aux tables **réellement créées** sur une base vierge.
 *
 * Quatre choix, et leurs raisons :
 *
 * 1. **Le préfixe `auth_`.** Les modèles de Better Auth s'appellent `user`,
 *    `session`, `account`, `verification` — quatre noms qu'un autre module
 *    voudra un jour, et `user` est en plus un mot réservé de PostgreSQL. Le
 *    préfixe rend le propriétaire lisible en base et rend `composeSchema`
 *    inoffensif.
 * 2. **Les clés TypeScript sont celles de la bibliothèque** (`emailVerified`,
 *    `userId`…), les colonnes sont en `snake_case`. L'adapter Drizzle résout
 *    une colonne par le **nom de propriété** de l'objet Drizzle : renommer
 *    `emailVerified` en `verified` casserait l'adapter sans casser la
 *    compilation.
 * 3. **Les clés étrangères restent internes au module** (`auth_session` et
 *    `auth_account` vers `auth_user`) : une référence sortante rendrait le
 *    module référencé silencieusement non désactivable, et `pnpm db:generate`
 *    la refuse (ADR 018).
 * 4. **`auth_verification` porte les jetons à usage unique**, les nôtres comme
 *    ceux de Better Auth. Un seul magasin, donc une seule règle de
 *    consommation et d'invalidation des frères (`docs/security.md` §2).
 */

export const authUser = pgTable(
  'auth_user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    // Unicité **en base**, pas seulement dans le code : deux inscriptions
    // simultanées sur la même adresse passeraient toutes deux une vérification
    // préalable (`docs/reliability.md` §1 : « jamais une simple vérification
    // préalable, elle laisse une fenêtre de concurrence »).
    uniqueIndex('auth_user_email_key').on(table.email),
  ],
)

export const authSession = pgTable(
  'auth_session',
  {
    id: text('id').primaryKey(),
    // Le jeton de session : opaque, jamais lisible par le JavaScript client, et
    // c'est lui que la révocation efface — côté serveur, pas dans une liste.
    token: text('token').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('auth_session_token_key').on(table.token),
    index('auth_session_user_id_idx').on(table.userId),
  ],
)

export const authAccount = pgTable(
  'auth_account',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    issuer: text('issuer').notNull(),
    /** Empreinte du mot de passe. Jamais le mot de passe, jamais journalisée. */
    password: text('password'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    scope: text('scope'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [index('auth_account_user_id_idx').on(table.userId)],
)

export const authVerification = pgTable(
  'auth_verification',
  {
    id: text('id').primaryKey(),
    /** `<usage>:<empreinte du jeton>` — jamais le jeton en clair. */
    identifier: text('identifier').notNull(),
    /** Le sujet du jeton : un identifiant de compte, ou ce que la bibliothèque y met. */
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    // La consommation atomique cherche par identifiant : sans index, chaque
    // clic sur un lien balaye la table.
    index('auth_verification_identifier_idx').on(table.identifier),
    index('auth_verification_value_idx').on(table.value),
  ],
)

/** Les tables du module, telles que le contrat les déclare. */
export const authSchema = {
  authUser,
  authSession,
  authAccount,
  authVerification,
} as const
