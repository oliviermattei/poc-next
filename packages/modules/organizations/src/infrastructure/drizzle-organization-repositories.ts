import { and, eq, gt, isNull, ne, or, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type { InvitationOutcome, OrganizationRepository, SlugOutcome } from '../application/ports'
import { FOUNDER_ROLE } from '../domain/organization'
import {
  organization,
  organizationActiveSelection,
  organizationInvitation,
  organizationMember,
} from '../schema'
import { createScopedReads } from './scoped-reads'
import { lockOrganizationMembership } from './transaction-locks'

/**
 * Les repositories du module, sur **ses** tables.
 *
 * La connexion est **injectée** : ce package ne dépend pas de `@repo/db`, et
 * c'est ce qui empêche le cycle `@repo/db` → agrégat généré → module (ADR 020).
 * Le type est réduit aux opérations utilisées, comme dans le module `auth` : un
 * `NodePgDatabase<TSchema>` complet porterait le schéma des autres modules dans
 * son type.
 */
/**
 * Ce que les transactions du module ont besoin de faire, et rien de plus.
 *
 * `update` s'y ajoute en s16 : la consommation d'une invitation est un ordre
 * conditionnel suivi d'une insertion idempotente, et les deux doivent tomber
 * ensemble. `delete` et `execute` s'y ajoutent au tour de correction : le
 * retrait d'un membre prend un verrou consultatif porté par la transaction
 * (`transaction-locks.ts`) avant son ordre conditionnel. `select` n'y est
 * **pas** — une lecture de transaction devrait passer par la porte de lecture,
 * et il n'y en a aucune ici.
 */
type TransactionalWriter = Pick<
  PgDatabase<PgQueryResultHKT>,
  'insert' | 'update' | 'delete' | 'execute'
>

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
const PENDING_INVITATION_CONSTRAINT = 'organization_invitation_pending_key'

/**
 * La **chaîne des causes** est parcourue, et ce n'est pas une précaution :
 * Drizzle enveloppe l'erreur du pilote dans un `DrizzleQueryError` dont le
 * `code` n'existe pas. Mesuré — la version qui lisait `error.code` directement
 * laissait remonter un 500 là où l'écran doit dire « cet identifiant n'est pas
 * disponible », et c'est `tests/organizations.test.ts` qui l'a trouvé.
 */
const violates = (error: unknown, constraint: string): boolean => {
  let candidate: unknown = error

  while (typeof candidate === 'object' && candidate !== null) {
    if (
      'code' in candidate &&
      candidate.code === UNIQUE_VIOLATION &&
      'constraint' in candidate &&
      candidate.constraint === constraint
    ) {
      return true
    }

    candidate = 'cause' in candidate ? candidate.cause : null
  }

  return false
}

const isSlugConflict = (error: unknown): boolean => violates(error, SLUG_CONSTRAINT)

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

    /* --------------------------------------------------------------------- *
     * s16 — les écritures d'invitation et de retrait.
     * --------------------------------------------------------------------- */

    listMemberIdentities: async (access) => await reads.memberIdentitiesOf(access),

    listLiveInvitations: async (access) => await reads.liveInvitationsOf(access),

    countInvitationsIssuedSince: async (access, since) =>
      await reads.invitationsIssuedSince(access, since),

    describeInvitation: async (tokenHash) => await reads.invitationByDigest(tokenHash),

    emailOf: async (userId) => await reads.emailOf(userId),

    listInvitationsAddressedTo: async (userId, email) =>
      await reads.invitationsAddressedTo({ kind: 'user', userId }, email),

    deleteInvitationsAddressedTo: async (email) => {
      // Rejouable : un second passage ne trouve plus rien et n'écrit rien
      // (`docs/reliability.md` §1).
      const deleted = await db
        .delete(organizationInvitation)
        .where(eq(organizationInvitation.email, email))
        .returning({ id: organizationInvitation.id })

      return deleted.length
    },

    createInvitation: async (access, invitation): Promise<InvitationOutcome> => {
      try {
        await db.insert(organizationInvitation).values({
          id: invitation.invitationId,
          // Le périmètre vient de l'**accès**, jamais du corps de la requête :
          // c'est la marque de type qui l'impose, et le compilateur qui la tient.
          organizationId: access.organizationId,
          email: invitation.email,
          role: invitation.role,
          tokenHash: invitation.tokenHash,
          expiresAt: invitation.expiresAt,
          invitedBy: invitation.invitedBy,
          // L'horloge du module, pas celle de la base : c'est elle que le quota
          // interroge, et deux horloges rendraient la fenêtre inobservable.
          createdAt: invitation.now,
          updatedAt: invitation.now,
        })

        return 'ok'
      } catch (error) {
        // L'unicité est celle de la **base** (`docs/reliability.md` §1) : deux
        // invitations simultanées à la même adresse passeraient toutes deux un
        // `select` préalable. La contrainte est nommée, pas seulement le code :
        // un vrai défaut se déguiserait sinon en refus poli.
        if (violates(error, PENDING_INVITATION_CONSTRAINT)) {
          return 'already_invited'
        }

        throw error
      }
    },

    reissueInvitation: async (access, reissue) => {
      return await db.transaction(async (transaction) => {
        // La ligne précédente est **éteinte** : révoquée, et son empreinte
        // remplacée par celle d'un jeton que personne n'a reçu. L'ancien lien
        // ne désigne donc plus rien — il meurt exactement comme lorsque le
        // renvoi tournait l'empreinte en place. Le prédicat porte
        // l'organisation autorisée : l'invitation d'une autre organisation
        // n'est jamais touchée (revue de s16, F3).
        const [superseded] = await transaction
          .update(organizationInvitation)
          .set({
            tokenHash: reissue.supersededTokenHash,
            revokedAt: reissue.now,
            updatedAt: reissue.now,
          })
          .where(
            and(
              eq(organizationInvitation.id, reissue.invitationId),
              eq(organizationInvitation.organizationId, access.organizationId),
              isNull(organizationInvitation.acceptedAt),
              isNull(organizationInvitation.revokedAt),
            ),
          )
          .returning({
            email: organizationInvitation.email,
            role: organizationInvitation.role,
          })

        if (superseded === undefined) {
          return null
        }

        // La ligne neuve porte le lien envoyé, et **son instant d'émission** :
        // c'est ce que le quota compte. L'index unique partiel l'accepte parce
        // que la précédente vient d'être révoquée, dans cette transaction.
        await transaction.insert(organizationInvitation).values({
          id: reissue.issuedInvitationId,
          organizationId: access.organizationId,
          email: superseded.email,
          role: superseded.role,
          tokenHash: reissue.tokenHash,
          expiresAt: reissue.expiresAt,
          invitedBy: reissue.invitedBy,
          createdAt: reissue.now,
          updatedAt: reissue.now,
        })

        return { email: superseded.email }
      })
    },

    revokeInvitation: async (access, invitation) => {
      const revoked = await db
        .update(organizationInvitation)
        .set({ revokedAt: invitation.now, updatedAt: invitation.now })
        .where(
          and(
            eq(organizationInvitation.id, invitation.invitationId),
            eq(organizationInvitation.organizationId, access.organizationId),
            isNull(organizationInvitation.acceptedAt),
            isNull(organizationInvitation.revokedAt),
          ),
        )
        .returning({ id: organizationInvitation.id })

      // Rejouable : une seconde révocation ne trouve plus rien, et rien de plus
      // n'est écrit (`docs/reliability.md` §1).
      return revoked.length > 0
    },

    consumeInvitation: async (consumption) => {
      return await db.transaction(async (transaction) => {
        // **Un seul ordre conditionnel**, et il porte tout : l'empreinte,
        // l'adresse du destinataire, et les trois conditions de vie. Un second
        // appel — concurrent ou rejoué — ne trouve plus rien. C'est ce qui rend
        // l'acceptation atomique sans aucune vérification préalable.
        const [consumed] = await transaction
          .update(organizationInvitation)
          .set({
            acceptedAt: consumption.now,
            acceptedBy: consumption.userId,
            updatedAt: consumption.now,
          })
          .where(
            and(
              eq(organizationInvitation.tokenHash, consumption.tokenHash),
              eq(organizationInvitation.email, consumption.email),
              isNull(organizationInvitation.acceptedAt),
              isNull(organizationInvitation.revokedAt),
              gt(organizationInvitation.expiresAt, consumption.now),
            ),
          )
          .returning({
            organizationId: organizationInvitation.organizationId,
            role: organizationInvitation.role,
          })

        if (consumed === undefined) {
          return null
        }

        // L'appartenance, **sans effet supplémentaire au rejeu** : la contrainte
        // `organization_member_unique` (posée par s15 précisément pour cette
        // story) décide, et un compte déjà membre reste membre une seule fois.
        await transaction
          .insert(organizationMember)
          .values({
            id: consumption.membershipId,
            organizationId: consumed.organizationId,
            userId: consumption.userId,
            role: consumed.role,
          })
          .onConflictDoNothing({
            target: [organizationMember.organizationId, organizationMember.userId],
          })

        return { organizationId: consumed.organizationId }
      })
    },

    removeMember: async (access, userId) => {
      // **C'est ce prédicat qui refuse**, et lui seul : la règle du `domain` ne
      // sert qu'à nommer le refus et à décider si l'écran propose l'action. Une
      // lecture des membres qui déciderait, suivie d'un `delete` qui obéit,
      // ferait deux vérités — et la première à diverger serait celle qui écrit.
      //
      // **Le prédicat seul ne suffisait pas**, et c'est mesuré : sous
      // l'isolation par défaut de PostgreSQL, deux retraits en vol évaluent
      // chacun la sous-requête sur l'état d'avant l'autre. Dix courses sur dix
      // laissaient l'organisation sans aucun membre, depuis une seule session
      // (revue de s16, F1). Le verrou consultatif sérialise les retraits de
      // **cette** organisation : le second réévalue son prédicat sur l'état
      // commis par le premier, et refuse. Aucune table n'est lue pour autant.
      return await db.transaction(async (transaction) => {
        await lockOrganizationMembership(transaction, access.organizationId)

        const removed = await transaction
          .delete(organizationMember)
          .where(
            and(
              eq(organizationMember.organizationId, access.organizationId),
              eq(organizationMember.userId, userId),
              or(
                ne(organizationMember.role, FOUNDER_ROLE),
                gt(
                  sql<number>`(select count(*) from ${organizationMember} as owners
                      where owners.organization_id = ${access.organizationId}
                        and owners.role = ${FOUNDER_ROLE})`,
                  1,
                ),
              ),
            ),
          )
          .returning({ id: organizationMember.id })

        return removed.length > 0
      })
    },
  }
}
