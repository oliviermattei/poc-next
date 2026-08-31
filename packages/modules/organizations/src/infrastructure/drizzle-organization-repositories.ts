import { eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type { OrganizationRepository, SlugOutcome } from '../application/ports'
import { organization, organizationActiveSelection, organizationMember } from '../schema'
import { createScopedReads } from './scoped-reads'

/**
 * Les repositories du module, sur **ses** tables.
 *
 * La connexion est **injectée** : ce package ne dépend pas de `@repo/db`, et
 * c'est ce qui empêche le cycle `@repo/db` → agrégat généré → module (ADR 020).
 * Le type est réduit aux opérations utilisées, comme dans le module `auth` : un
 * `NodePgDatabase<TSchema>` complet porterait le schéma des autres modules dans
 * son type.
 */
/** Ce que la transaction de création a besoin de faire, et rien de plus. */
type TransactionalWriter = Pick<PgDatabase<PgQueryResultHKT>, 'insert'>

export type OrganizationsDatabase = Pick<
  PgDatabase<PgQueryResultHKT>,
  'select' | 'insert' | 'update' | 'delete'
> & {
  /**
   * La transaction, **réduite à ce qu'on en fait**.
   *
   * Reprendre la signature de `PgDatabase` rendrait le type invariant sur le
   * schéma : une connexion construite avec les tables de trois modules n'est
   * pas assignable à une connexion typée sans schéma — mesuré, `pnpm typecheck`
   * l'a refusée. Un module n'a pas à connaître les tables des autres pour
   * recevoir une connexion.
   */
  transaction<T>(run: (writer: TransactionalWriter) => Promise<T>): Promise<T>
}

/**
 * Violation d'unicité PostgreSQL, **et sur cette contrainte-là**.
 *
 * Le code seul ne suffirait pas : il couvre aussi la clé primaire et l'unicité
 * d'une appartenance, si bien qu'un vrai défaut se déguiserait en « identifiant
 * déjà pris » et l'appelant verrait un refus poli là où il faut une erreur.
 * Le nom de la contrainte vient du schéma, où il est écrit une fois.
 */
const UNIQUE_VIOLATION = '23505'
const SLUG_CONSTRAINT = 'organization_slug_key'

/**
 * La **chaîne des causes** est parcourue, et ce n'est pas une précaution :
 * Drizzle enveloppe l'erreur du pilote dans un `DrizzleQueryError` dont le
 * `code` n'existe pas. Mesuré — la version qui lisait `error.code` directement
 * laissait remonter un 500 là où l'écran doit dire « cet identifiant n'est pas
 * disponible », et c'est `tests/organizations.test.ts` qui l'a trouvé.
 */
const isSlugConflict = (error: unknown): boolean => {
  let candidate: unknown = error

  while (typeof candidate === 'object' && candidate !== null) {
    if (
      'code' in candidate &&
      candidate.code === UNIQUE_VIOLATION &&
      'constraint' in candidate &&
      candidate.constraint === SLUG_CONSTRAINT
    ) {
      return true
    }

    candidate = 'cause' in candidate ? candidate.cause : null
  }

  return false
}

export function createDrizzleOrganizationRepository(
  db: OrganizationsDatabase,
): OrganizationRepository {
  /**
   * **Les lectures ne sont pas écrites ici**, et `pnpm lint` l'impose.
   *
   * `select`, `from` et `execute` sont refusés dans tout le module hors de
   * `scoped-reads.ts` : ce fichier ne peut plus lire une table, il ne peut que
   * déléguer à une porte dont chaque fonction exige le propriétaire. C'est le
   * constat F2 de la revue de s15 — une garde qu'aucune commande ne tenait.
   */
  const reads = createScopedReads(db)

  return {
    findMembership: async ({ userId, organizationId }) =>
      await reads.membershipOf(userId, organizationId),

    listMemberships: async (userId) => await reads.membershipsOf(userId),

    createOrganization: async (input): Promise<SlugOutcome> => {
      try {
        // Les deux lignes dans **une** transaction : une organisation écrite
        // sans son membre serait une ressource que plus personne n'atteint.
        await db.transaction(async (transaction) => {
          await transaction.insert(organization).values({
            id: input.organizationId,
            name: input.name,
            slug: input.slug,
          })
          await transaction.insert(organizationMember).values({
            id: input.membershipId,
            organizationId: input.organizationId,
            userId: input.userId,
            role: input.role,
          })
        })

        return 'ok'
      } catch (error) {
        // L'unicité est celle de la **base**. Une vérification préalable
        // laisserait passer deux créations simultanées du même identifiant
        // (`docs/reliability.md` §1).
        if (isSlugConflict(error)) {
          return 'slug_unavailable'
        }

        throw error
      }
    },

    renameOrganization: async (access, draft): Promise<SlugOutcome> => {
      try {
        await db
          .update(organization)
          .set({ name: draft.name, slug: draft.slug, updatedAt: new Date() })
          .where(eq(organization.id, access.organizationId))

        return 'ok'
      } catch (error) {
        if (isSlugConflict(error)) {
          return 'slug_unavailable'
        }

        throw error
      }
    },

    findActiveOrganizationId: async (userId) => await reads.activeOrganizationIdOf(userId),

    setActiveOrganization: async (access) => {
      // Rejouable sans effet supplémentaire : la clé primaire est le compte,
      // donc une seconde bascule vers la même organisation réécrit la même
      // ligne (`docs/reliability.md` §1).
      await db
        .insert(organizationActiveSelection)
        .values({
          userId: access.userId,
          organizationId: access.organizationId,
        })
        .onConflictDoUpdate({
          target: organizationActiveSelection.userId,
          set: { organizationId: access.organizationId, updatedAt: new Date() },
        })
    },

    deleteMembershipsOf: async (userId) => {
      await db
        .delete(organizationActiveSelection)
        .where(eq(organizationActiveSelection.userId, userId))
      await db.delete(organizationMember).where(eq(organizationMember.userId, userId))
    },

    deleteOrganization: async (organizationId) => {
      // Les appartenances et les sélections suivent par cascade : la contrainte
      // de la base est ce qui garantit qu'aucun reste n'échappe à la purge, là
      // où une suppression table par table oublie celle qu'on ajoute ensuite.
      await db.delete(organization).where(eq(organization.id, organizationId))
    },

    listMembersOf: async (organizationId) =>
      await reads.membersOf({ kind: 'organization', organizationId }),
  }
}
