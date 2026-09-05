import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

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
    // s13. Colonne **ajoutée avec un défaut** : la version encore en ligne ne
    // la lit pas et continue d'écrire sans elle (`docs/reliability.md` §4).
    // C'est le greffon `two-factor` qui la bascule, jamais une route — elle
    // porte `input: false` du côté de la bibliothèque.
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    /**
     * **Le compte est-il banni** (s37a) ?
     *
     * Trois colonnes, et elles sont **ici, dans le socle**, alors que la
     * surface qui les écrit vit dans le module `admin` (ADR 058). « Banni »
     * n'est pas une fonctionnalité d'administration : c'est un état du compte,
     * et `auth` possède déjà les comptes et la décision de laisser entrer. Les
     * mettre dans le module optionnel obligerait le chemin de connexion —
     * socle — à consulter un module qui peut ne pas être là.
     *
     * Conséquence assumée : module `admin` coupé, plus personne ne peut bannir,
     * et un compte **déjà banni reste banni**. Le débannir serait un nettoyage,
     * et le nettoyage est au cimetière du PRD.
     *
     * Ajoutées **avec un défaut**, comme `two_factor_enabled` : la version
     * encore en ligne ne les lit pas et continue d'écrire sans elles
     * (`docs/reliability.md` §4).
     */
    banned: boolean('banned').notNull().default(false),
    bannedAt: timestamp('banned_at', { withTimezone: true, mode: 'date' }),
    /**
     * Le motif, **lisible d'un superadmin et de personne d'autre**.
     *
     * Il ne sort jamais dans une réponse de connexion : un compte banni reçoit
     * le refus d'un identifiant invalide, sans quoi le message devient un
     * oracle d'énumération (`docs/security.md` §7).
     */
    bannedReason: text('banned_reason'),
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

/**
 * Le second facteur d'un compte (s13).
 *
 * Une ligne par compte, créée à l'enrôlement et **supprimée** à la
 * désactivation — c'est ce qui emporte les codes de secours avec elle.
 *
 * Trois colonnes méritent qu'on dise ce qu'elles contiennent, parce que leur
 * nom ne suffit pas :
 *
 * - `secret` est le secret TOTP **chiffré** (`symmetricEncrypt` de la
 *   bibliothèque, clé = secret de l'application). Chiffré et non haché, et
 *   c'est structurel : vérifier un code exige de le regénérer, donc de relire
 *   le secret. `docs/decisions/028-…` porte l'arbitrage ;
 * - `backupCodes` est le JSON d'un tableau d'**empreintes**
 *   (`domain/backup-code.ts`), jamais des codes. C'est la moitié du socle §2
 *   qui, elle, est applicable ;
 * - `failedVerificationCount` et `lockedUntil` portent le verrouillage par
 *   compte de la bibliothèque : dix échecs consécutifs, quinze minutes. Ils
 *   sont écrits par elle seule, atomiquement.
 *
 * La clé étrangère reste **interne au module** (ADR 018), et la cascade fait
 * qu'un compte effacé emporte son second facteur — `retention: account: erase`.
 */
export const authTwoFactor = pgTable(
  'auth_two_factor',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    // Faux tant que le premier code n'a pas été confirmé : c'est ce qui rend
    // vrai le critère « exige un code valide pour être confirmée ». Le défaut
    // de la bibliothèque est `true` ; il n'est jamais employé, la ligne étant
    // toujours créée avec une valeur explicite.
    verified: boolean('verified').notNull().default(false),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'date' }),
    // **Le dernier compteur TOTP consommé** — la garde de rejeu (revue s13,
    // C3). La bibliothèque ne mémorise rien : un code accepté reste valable
    // jusqu'à quatre-vingt-dix secondes, donc rejouable sur un défi neuf par
    // qui l'a vu une fois. La colonne n'appartient à aucun modèle de la
    // bibliothèque — elle est **à nous**, comme la règle qu'elle porte.
    // Nullable et sans défaut : additive, la version encore en ligne ne la lit
    // ni ne l'écrit (`docs/reliability.md` §4).
    lastTotpStep: integer('last_totp_step'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    // Un seul second facteur par compte, **en base** : la bibliothèque cherche
    // par `userId` et met à jour la première ligne trouvée. Deux enrôlements
    // simultanés laisseraient deux secrets, dont un seul serait jamais lu.
    uniqueIndex('auth_two_factor_user_id_key').on(table.userId),
  ],
)

/**
 * Une passkey d'un compte (s14).
 *
 * Une ligne par justificatif WebAuthn enregistré. Les noms de propriété sont
 * ceux que le greffon attend — `credentialID` et non `credential_id` du côté
 * TypeScript —, les colonnes sont en `snake_case`, et `tests/auth.test.ts`
 * confronte les deux à `getAuthTables` : un champ renommé ne casse pas la
 * compilation, il casse la requête, en production.
 *
 * Trois choses méritent d'être dites, parce que leur nom ne suffit pas :
 *
 * - `publicKey` est la clé publique du justificatif, encodée en base64. Ce
 *   n'est pas un secret — c'est la moitié publique d'une paire dont la privée
 *   n'a jamais quitté l'appareil — mais elle ne sort jamais vers un écran :
 *   `describePasskeys` recopie champ par champ (`domain/passkey.ts`) ;
 * - `counter` est le **compteur de signature** rendu par l'authentificateur.
 *   `@simplewebauthn/server` refuse une assertion dont le compteur n'a pas
 *   progressé — donc un rejeu, ou un clone resté en arrière — **à condition
 *   que l'un des deux compteurs soit non nul**. Un authentificateur qui rend
 *   toujours zéro, ce qui est le cas des passkeys synchronisées, n'est pas
 *   protégé par cette garde, et aucune ligne de ce dépôt ne peut y changer
 *   quelque chose ;
 * - `aaguid` identifie un **modèle** d'authentificateur, jamais un appareil ni
 *   une personne. Les plateformes soucieuses de vie privée y mettent zéro.
 *
 * **Pas d'`updatedAt`** : le greffon n'en déclare pas (`getAuthTables` le
 * confirme, recherche §2.2), donc rien ne l'écrirait — une colonne que
 * personne ne met à jour ment sur ce qu'elle promet.
 *
 * La clé étrangère reste **interne au module** (ADR 018), en cascade : un
 * compte effacé emporte ses passkeys, ce qui est ce que
 * `retention: account: erase` promet.
 */
export const authPasskey = pgTable(
  'auth_passkey',
  {
    id: text('id').primaryKey(),
    /** Le nom donné par la personne. `null` tant qu'elle n'en a pas donné. */
    name: text('name'),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    publicKey: text('public_key').notNull(),
    counter: integer('counter').notNull().default(0),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull().default(false),
    transports: text('transports'),
    aaguid: text('aaguid'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('auth_passkey_user_id_idx').on(table.userId),
    // **Un justificatif, une ligne**, et c'est une garantie de la base et non
    // du code : la bibliothèque résout une connexion par
    // `findOne({ credentialID })`, et deux lignes portant le même identifiant
    // rendraient cette résolution arbitraire. L'attestation `none` que le
    // greffon demande n'empêche personne de présenter l'identifiant d'un
    // autre : c'est ici que ça se ferme.
    uniqueIndex('auth_passkey_credential_id_key').on(table.credentialID),
  ],
)

/**
 * **Les demandes d'export de données** (s35).
 *
 * Une ligne par demande, et c'est elle qui porte les trois garanties du
 * critère 7 et du critère 4 :
 *
 * 1. **une demande en cours empêche la suivante** — la revendication lit
 *    `status = 'pending'` pour le périmètre, sous verrou consultatif, dans la
 *    même transaction que l'insertion. Deux clics simultanés ne peuvent pas
 *    produire deux demandes (`docs/reliability.md` §1) ;
 * 2. **l'archive vit ici, dans la base de l'application**, et nulle part
 *    ailleurs. C'est une décision (s35, tâche 6) : une donnée personnelle en
 *    transit posée dans un seau d'objets survivrait à l'effacement du compte —
 *    le seau n'a pas de clé étrangère —, et il a fallu trois trous de cette
 *    forme exacte pour l'apprendre. Ici, la cascade de `requested_by` **et** la
 *    purge par périmètre l'emportent, et la promesse est tenue par la base plutôt
 *    que par une consigne. Elle est en JSON parce que l'archive l'est : le seul
 *    module qui possède des octets, `storage`, n'en rend qu'un manifeste ;
 * 3. **l'échéance est écrite côté serveur** (`expires_at`), jamais lue du lien.
 *    Le lien ne porte que l'identifiant de la demande et sa signature.
 *
 * `token_digest` est l'**empreinte** du jeton, jamais le jeton : un vol de ces
 * lignes ne rend aucun lien utilisable (`docs/security.md` §2), même règle que
 * `auth_verification`.
 *
 * La clé étrangère reste **interne au module** (ADR 018). `scope_id` n'en porte
 * aucune : un périmètre d'organisation appartient à un module que `auth` ne
 * requiert pas, et une référence sortante rendrait ce module silencieusement non
 * désactivable.
 */
export const authDataExportRequest = pgTable(
  'auth_data_export_request',
  {
    id: text('id').primaryKey(),
    /** `user` ou `organization` — la forme du contrat (`ModuleScope`). */
    scopeKind: text('scope_kind').notNull(),
    scopeId: text('scope_id').notNull(),
    /** Le compte qui a demandé. Effacé, il emporte ses demandes. */
    requestedBy: text('requested_by')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    /** `pending`, `ready` ou `failed`. */
    status: text('status').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'date' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    /** L'échéance du lien, **décidée par le serveur**. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    tokenDigest: text('token_digest'),
    /** L'archive elle-même, en JSON. Effacée à l'expiration comme à la purge. */
    archive: jsonb('archive'),
    /** Le module qui a refusé, quand la construction a échoué. */
    failedModuleId: text('failed_module_id'),
  },
  (table) => [
    // La revendication cherche les demandes en cours d'un périmètre : sans
    // index, chaque demande balaye la table.
    index('auth_data_export_request_scope_idx').on(table.scopeKind, table.scopeId, table.status),
    /**
     * **Les deux autres lectures de cette table, et elles sont périodiques.**
     *
     * `forgetExpiredArchives` cherche les archives échues à **chaque demande
     * d'export** (l'oubli ne peut pas dépendre du module `jobs`, ADR 062), et
     * `listPending` cherche les demandes restées en cours à chaque balayage.
     * Ni l'une ni l'autre n'a de périmètre : l'index de la revendication ne les
     * sert pas, et elles balayaient la table.
     *
     * Sans conséquence à la taille d'aujourd'hui — une ligne par demande
     * d'export, un geste rare —, et c'est bien pour cela que l'index est posé
     * maintenant : le jour où elle grossit, personne ne fera le lien entre une
     * requête lente et un balayage séquentiel que rien ne signale.
     */
    index('auth_data_export_request_expiry_idx').on(table.expiresAt),
    index('auth_data_export_request_pending_idx').on(table.status, table.requestedAt),
  ],
)

/** Les tables du module, telles que le contrat les déclare. */
export const authSchema = {
  authUser,
  authSession,
  authAccount,
  authVerification,
  authTwoFactor,
  authPasskey,
  authDataExportRequest,
} as const
