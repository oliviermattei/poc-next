import { authUser } from '@repo/module-auth'
import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * La table du module `admin` — **une, et pas une de plus** à cette tranche.
 *
 * Elle ne porte que le **rôle de plateforme** : qui administre le produit
 * lui-même. Ce que l'administration *fait* d'un compte — le bannissement — vit
 * dans le module `auth`, avec les comptes (ADR 058) : le chemin de connexion
 * appartient au socle et ne peut pas consulter un module qui peut être coupé.
 *
 * **La clé étrangère vers `auth_user` est permise** parce que ce module déclare
 * `auth` dans ses `requires` (ADR 018) : `resolveEnabledModules` refuse déjà
 * d'activer `admin` sans `auth`, donc la cible ne peut pas disparaître sous la
 * source. `pnpm db:generate` le vérifie, en nommant les deux modules si c'était
 * faux.
 *
 * **`onDelete: 'cascade'`** porte l'ordre de purge (ADR 018) : `purgeModules`
 * parcourt le graphe des requis, donc `auth` avant `admin`. Effacer un compte
 * emporte son rôle de plateforme, et la purge du module reste un no-op
 * idempotent.
 *
 * **Ce module est le seul fichier qui importe `@repo/module-auth`**, et
 * uniquement pour cette clé : c'est la borne qui garde les lectures de comptes
 * derrière le port injecté (`application/ports.ts`), donc derrière un
 * identifiant plutôt qu'une adresse (`docs/security.md` §7).
 */
export const adminPlatformRole = pgTable(
  'admin_platform_role',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    /** `superadmin`. Le nom vit dans le `domain`, jamais recopié dans une route. */
    role: text('role').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    /**
     * Le superadmin qui a promu, ou `null` pour la **désignation** — celle-ci
     * n'a pas d'acteur : elle vient de la configuration, sur une base vierge.
     *
     * Aucune clé étrangère : le compte qui a promu peut être effacé, et son
     * effacement ne doit ni emporter la promotion, ni la bloquer.
     */
    grantedBy: text('granted_by'),
  },
  (table) => [
    // Un compte ne porte un rôle qu'une fois : sans cette contrainte, deux
    // promotions simultanées doubleraient la ligne, et le décompte qui garde le
    // dernier superadmin compterait deux fois la même personne
    // (`docs/reliability.md` §1 : jamais une simple vérification préalable).
    uniqueIndex('admin_platform_role_unique').on(table.userId, table.role),
  ],
)

/** Les tables du module, telles que le contrat les déclare. */
export const adminSchema = { adminPlatformRole }
