import { authUser } from '@repo/module-auth'
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * Les tables du module `organizations` — **trois, et pas une de plus**.
 *
 * Elles n'existent que lorsque le module est activé : `pnpm db:generate` ne
 * génère que pour les modules de `config/features.ts`, et sur une base vierge
 * dont la configuration ne nomme pas ce module, aucune des trois n'est créée.
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

/** Les tables du module, telles que le contrat les déclare. */
export const organizationsSchema = {
  organization,
  organizationMember,
  organizationActiveSelection,
} as const
