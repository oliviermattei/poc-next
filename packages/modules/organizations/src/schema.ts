import { authUser } from '@repo/module-auth'
import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * Les tables du module `organizations` — **quatre, et pas une de plus**.
 *
 * Elles n'existent que lorsque le module est activé : `pnpm db:generate` ne
 * génère que pour les modules de `config/features.ts`, et sur une base vierge
 * dont la configuration ne nomme pas ce module, aucune des quatre n'est créée.
 * C'est exactement ce que la story reproche à MakerKit, qui garde
 * `organizations`, `members` et `invitations` en base même en mode solo.
 *
 * **Ce que Better Auth aurait fait, et pourquoi ce n'est pas fait.** Son plugin
 * `organization` déclare `session.fields.activeOrganizationId`
 * (`node_modules/better-auth/dist/plugins/organization/organization.mjs`, l.
 * 856-871) : il ajoute une colonne à `auth_session`, donc à une table du module
 * `auth`. La colonne survivrait à la coupure du module — le critère « tables
 * absentes d'une base vierge » tomberait —, et `packages/db/src/references.ts`
 * refuse déjà qu'une table appartienne à deux modules. L'organisation active
 * est donc **une table à nous**, et le cookie de session n'en sait rien.
 *
 * **Les clés étrangères vers `auth_user` sont permises** parce que ce module
 * déclare `auth` dans ses `requires` (ADR 018) : `resolveEnabledModules` refuse
 * déjà d'activer `organizations` sans `auth`, donc la cible ne peut pas
 * disparaître sous la source. `pnpm db:generate` le vérifie à la génération, en
 * nommant les deux modules si c'était faux.
 *
 * **`onDelete: 'cascade'` porte l'ordre de purge** que l'ADR 018 signale comme
 * son vrai coût : `purgeModules` parcourt le graphe des requis, donc `auth`
 * avant `organizations`, c'est-à-dire dans l'ordre qui violerait la contrainte.
 * La cascade rend cet ordre inoffensif — effacer un compte emporte ses
 * appartenances —, et la purge du module devient un no-op idempotent. s34 et
 * s35 devront reprendre la question pour les modules qui n'auront pas ce luxe.
 */

export const organization = pgTable(
  'organization',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** L'identifiant public. Normalisé par le `domain` avant d'arriver ici. */
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    // Unicité **en base**, jamais une vérification préalable : deux créations
    // simultanées du même identifiant passeraient toutes deux un `select`
    // (`docs/reliability.md` §1).
    uniqueIndex('organization_slug_key').on(table.slug),
  ],
)

export const organizationMember = pgTable(
  'organization_member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    /** `owner`, `admin` ou `member`. s15 n'attribue que le premier. */
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    // Un compte n'est membre qu'une fois d'une organisation : sans cette
    // contrainte, une invitation rejouée (s16) doublerait la ligne et le
    // décompte des sièges (s23) deviendrait faux.
    uniqueIndex('organization_member_unique').on(table.organizationId, table.userId),
    // C'est l'index de la question la plus fréquente du produit : « quelles
    // organisations ce compte voit-il ? ». Sans lui, chaque écran balaye la
    // table.
    index('organization_member_user_id_idx').on(table.userId),
  ],
)

/**
 * L'organisation courante d'un compte.
 *
 * **Par compte, pas par session** : le critère 2 de la story demande que
 * l'organisation courante persiste **entre deux sessions**. Une colonne sur la
 * session la perdrait à chaque reconnexion, et la mettre dans le cookie ferait
 * du client le propriétaire d'une décision d'autorisation.
 *
 * Conséquence assumée, et c'est elle qui répond à la question de la rotation de
 * session : **le jeton de session ne porte aucune autorité organisationnelle**.
 * Le jeu de droits attaché à un identifiant de session est identique avant et
 * après une bascule — l'appartenance est relue à chaque requête, dans le
 * prédicat de la lecture, **y compris par le chemin qui résout le propriétaire
 * d'une donnée** : `activeOrganizationIdOf` joint cette table à
 * `organization_member` sur le compte. Ce n'était pas le cas à la première
 * livraison de s15, et la revue l'a mesuré — une sélection survivait au retrait
 * du membre et `dataOwnerOf` rendait encore l'organisation quittée. Il n'y a
 * donc pas d'élévation de privilège à cet endroit (`docs/security.md` §2 ;
 * ADR 025 ; `docs/research/s15-organizations.md` §3).
 *
 * **Ce que cette table ne garantit pas** : la sélection a le compte pour clé
 * primaire, donc une seule organisation active par compte. Deux onglets sur
 * deux organisations du même compte convergent à la requête suivante, et une
 * écriture dérivée de `dataOwnerOf` peut atterrir dans celle de l'autre onglet.
 * Conséquence écrite dans l'ADR 025 et dans l'`AGENTS.md` du module.
 */
export const organizationActiveSelection = pgTable('organization_active_selection', {
  userId: text('user_id')
    .primaryKey()
    .references(() => authUser.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})

/**
 * Une invitation à rejoindre une organisation (s16).
 *
 * **Le jeton n'est pas ici.** La colonne `token_hash` porte l'empreinte SHA-256
 * du secret, jamais le secret : une copie de cette table ne rend aucun lien
 * utilisable. C'est la propriété que `packages/modules/auth/src/infrastructure/token-factory.ts`
 * documente, et dont il nomme aussi la **limite** — le lien de réinitialisation
 * de Better Auth, lui, est écrit en clair dans `auth_verification`. s16 émet son
 * propre jeton, elle n'hérite pas de cette limite.
 *
 * **La ligne est son propre journal de cycle de vie.** `accepted_at`,
 * `revoked_at` et `expires_at` ne sont pas trois drapeaux redondants : ce sont
 * les trois motifs de refus que le critère 3 exige de distinguer (« expirée,
 * déjà acceptée ou révoquée affiche une erreur **explicite** »). Effacer
 * l'empreinte à la consommation rendrait les trois indiscernables ; le prédicat
 * de l'ordre de consommation suffit à interdire le rejeu.
 *
 * **L'unicité est celle de la base**, jamais une vérification préalable
 * (`docs/reliability.md` §1) : un index unique **partiel** interdit deux
 * invitations vivantes pour la même adresse dans la même organisation. Le
 * prédicat ne peut pas porter `now()` — un prédicat d'index PostgreSQL doit être
 * immuable —, donc il couvre « ni acceptée ni révoquée », **expirées
 * comprises**. Conséquence assumée et voulue : une invitation échue se
 * **renvoie** (le renvoi tourne le jeton et repousse l'échéance) plutôt que de
 * se dupliquer.
 *
 * Les deux clés étrangères vers `auth_user` sont permises parce que `auth` est
 * un requis déclaré (ADR 018). Elles sont en `set null` et non en cascade : la
 * suppression du compte qui a invité ne doit pas emporter l'invitation d'un
 * tiers, et l'organisation, elle, cascade déjà.
 */
export const organizationInvitation = pgTable(
  'organization_invitation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** L'adresse invitée, **normalisée** par le `domain` avant d'arriver ici. */
    email: text('email').notNull(),
    /** `member` aujourd'hui : choisir le rôle est une permission, donc s17. */
    role: text('role').notNull(),
    /** L'empreinte SHA-256 du jeton, en base64url. Jamais le jeton. */
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    invitedBy: text('invited_by').references(() => authUser.id, { onDelete: 'set null' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
    acceptedBy: text('accepted_by').references(() => authUser.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    // Une seule invitation vivante par adresse et par organisation. C'est la
    // base qui décide, et sa violation qui est traduite en refus nommé — comme
    // `organization_slug_key` l'est en `slug_unavailable`.
    // Le prédicat est écrit en `sql` et non en `and(isNull(…), isNull(…))` :
    // `and` rend `SQL | undefined`, que `.where` d'un index refuse.
    uniqueIndex('organization_invitation_pending_key')
      .on(table.organizationId, table.email)
      .where(sql`${table.acceptedAt} is null and ${table.revokedAt} is null`),
    // Le jeton désigne **une** invitation : sans cette unicité, une collision
    // d'empreinte (ou une insertion fautive) rendrait la consommation
    // ambiguë.
    uniqueIndex('organization_invitation_token_key').on(table.tokenHash),
    // La question de l'écran : « quelles invitations cette organisation a-t-elle
    // en attente ? ». Sans lui, chaque affichage balaye la table.
    index('organization_invitation_organization_id_idx').on(table.organizationId),
  ],
)

/** Les tables du module, telles que le contrat les déclare. */
export const organizationsSchema = {
  organization,
  organizationMember,
  organizationActiveSelection,
  organizationInvitation,
} as const
