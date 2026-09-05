import { and, eq, gt, isNull, ne, notInArray, or, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import {
  SeatSyncRefusedError,
  type InvitationOutcome,
  type OrganizationRepository,
  type SeatSync,
  type SlugOutcome,
} from '../application/ports'
import { FOUNDER_ROLE, SUCCEEDED_OWNER_ROLE } from '../domain/organization'
import {
  organization,
  organizationActiveSelection,
  organizationInvitation,
  organizationMember,
} from '../schema'
import { countMembersOf, createScopedReads } from './scoped-reads'
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
 * (`transaction-locks.ts`) avant son ordre conditionnel.
 *
 * **`select` s'y ajoute en s23**, et c'est la seule lecture de transaction du
 * module : la quantité facturée est le nombre de membres **après** l'écriture,
 * et il n'y a qu'un endroit d'où ce nombre soit exact — à l'intérieur de la
 * transaction qui vient de l'écrire. Le lire après validation le lirait après
 * qu'une autre écriture a pu passer.
 */
type TransactionalWriter = Pick<
  PgDatabase<PgQueryResultHKT>,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
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
  /**
   * Ce que la nouvelle taille de l'organisation doit traverser **avant** que
   * l'écriture soit validée (s23, ADR 046). Reçu, jamais construit : ce module
   * ne sait pas qu'il existe une facturation.
   */
  seatSync: SeatSync,
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

  /**
   * Le nombre de membres **tel que la transaction en cours le voit** (s23).
   *
   * Il compte `organization_member`, et rien d'autre : une invitation en
   * attente vit dans `organization_invitation` et n'occupe aucun siège
   * (critère 4). Ajouter cette table ici facturerait des personnes qui n'ont
   * pas encore cliqué.
   *
   * La lecture elle-même vit dans `scoped-reads.ts`, la porte unique du module :
   * `pnpm lint` refuse `select` et `from` dans ce fichier-ci, et c'est cette
   * règle qui garde la surface de lecture du module à un seul endroit.
   */
  const seatsInTransaction = async (
    transaction: TransactionalWriter,
    organizationId: string,
  ): Promise<number> => await countMembersOf({ kind: 'organization', organizationId }, transaction)

  /**
   * **L'ordre des deux écritures** (ADR 046), écrit une fois pour les deux
   * appelants qui changent la taille d'une organisation.
   *
   * La séquence est : la transaction a déjà écrit, elle n'est **pas** validée ;
   * on compte ce qu'elle a produit ; on porte ce nombre chez le fournisseur ; un
   * refus lève, ce qui annule tout.
   *
   * **Ce que cet ordre coûte, et à qui.** Un échec du fournisseur n'ajoute ni ne
   * retire personne — c'est le critère 6. En revanche, si la **validation
   * locale** échoue après un succès distant, le fournisseur compte un siège que
   * la base ne porte pas : le client est surfacturé d'un siège. Ce résidu est
   * assumé et borné (ADR 046) ; il se détecte et se corrige par
   * `pnpm billing:reconcile`, qui ramène la quantité au nombre de membres. Le
   * `commit` qui suit ce commentaire est donc l'endroit exact où la décision se
   * paie, et l'ordre inverse — valider puis synchroniser — contredirait le
   * critère mot pour mot.
   *
   * **Ce que cette transaction tient ouvert, chiffré** — l'ADR parle d'« un
   * aller-retour HTTP », la séquence livrée en tient davantage :
   *
   * - **deux** appels sortants, pas un : l'écriture de la quantité relit
   *   l'abonnement avant de l'écrire (la quantité vit sur sa **ligne**, dont
   *   l'identifiant n'est connu que par lecture). Chacun porte son propre budget
   *   de reprise — deux essais de 4 s séparés d'un recul d'au plus 300 ms
   *   (`apps/web/lib/billing.ts`) —, soit ~8,3 s par appel et **~16,6 s pour les
   *   deux**, transaction ouverte pendant tout ce temps ;
   * - une **seconde connexion du même pool** : la synchronisation lit le client
   *   et ses abonnements pendant que cette transaction en retient une
   *   (`packages/db/src/client.ts` : `max: 10`, `connectionTimeoutMillis:
   *   5_000`). La concurrence utile des écritures d'appartenance tombe à cinq,
   *   la sixième attend 5 s puis échoue ;
   * - au **retrait** — pas à l'acceptation —, le verrou consultatif de
   *   l'organisation est tenu pendant toute cette attente.
   *
   * Le pire cas dépasse donc les dix secondes de fonction serverless que
   * `apps/web/lib/billing.ts` invoque pour dimensionner ce budget. La
   * dégradation reste saine : l'épuisement du pool lève une exception qui n'est
   * pas un `SeatSyncRefusedError`, elle remonte et annule — rien n'est corrompu,
   * personne n'est surfacturé. Ce coût est **raisonné, pas observé** : aucune
   * mesure de concurrence n'a été faite.
   */
  const syncSeatsBeforeCommit = async (
    transaction: TransactionalWriter,
    organizationId: string,
    /**
     * **Cette écriture ajoute-t-elle un membre ?** (s47)
     *
     * Transmis à l'extérieur, qui seul sait s'il plafonne. Un retrait ne peut
     * pas franchir un plafond par le haut ; le lui opposer enfermerait une
     * organisation au-dessus de son plafond, sans aucun geste pour redescendre.
     */
    adds: boolean,
  ): Promise<void> => {
    const verdict = await seatSync({
      organizationId,
      seats: await seatsInTransaction(transaction, organizationId),
      adds,
    })

    if (!verdict.ok) {
      // Lever **est** l'annulation : rien de ce que cette transaction a écrit
      // ne sera validé. Le cas d'usage ramène l'exception à un refus nommé, et
      // c'est le motif porté ici qu'il rend — jamais un motif reconstitué.
      throw new SeatSyncRefusedError(verdict.refusal)
    }
  }

  return {
    findMembership: async ({ userId, organizationId }) =>
      await reads.membershipOf(userId, organizationId),

    listMemberships: async (userId) => await reads.membershipsOf(userId),

    soleOwnerships: async (userId) => await reads.soleOwnershipsOf(userId),

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
      /**
       * **La règle du dernier propriétaire, sur le chemin de la purge** (s34,
       * critique de la seconde revue).
       *
       * `removeMember` la tient depuis s16, avec son prédicat et son verrou ;
       * ce chemin-ci l'ignorait, et c'est par lui qu'un compte devenu dernier
       * propriétaire **après** sa demande de suppression laissait une
       * organisation sans personne pour l'administrer — plus aucun rôle à
       * nommer, aucune invitation, aucune suppression.
       *
       * Tout tient dans **une transaction** : la lecture des organisations
       * possédées, leurs verrous, le décompte sous verrou, puis le retrait. Une
       * vérification faite au-dessus laisserait la fenêtre où deux
       * copropriétaires partent ensemble, chacun voyant l'autre — la variante
       * que la revue a nommée.
       *
       * Les lectures passent par la **porte unique** du module
       * (`scoped-reads.ts`), construite ici sur la transaction : `pnpm lint`
       * refuse `select` et `from` partout ailleurs, y compris dans ce fichier.
       */
      return await db.transaction(async (transaction) => {
        const scoped = createScopedReads(transaction)
        const owned = (await scoped.membershipsOf(userId))
          .filter((membership) => membership.role === FOUNDER_ROLE)
          // Un ordre **total et stable** : deux purges qui touchent les mêmes
          // organisations prennent leurs verrous dans le même ordre, donc ne
          // peuvent pas s'interbloquer.
          .map((membership) => membership.organizationId)
          .sort()

        for (const organizationId of owned) {
          await lockOrganizationMembership(transaction, organizationId)
        }

        // **Le décompte se fait sous les verrous**, pas avant : c'est là que la
        // course entre deux départs simultanés se résout.
        const blocking = await scoped.soleOwnershipsOf(userId)

        // **Le refus est total, jamais partiel** : retirer les appartenances
        // qui ne bloquent pas laisserait un compte à moitié effacé, et le rejeu
        // ne saurait plus ce qu'il doit reprendre.
        if (blocking.length > 0) {
          return blocking
        }

        await transaction
          .delete(organizationActiveSelection)
          .where(eq(organizationActiveSelection.userId, userId))
        await transaction
          .delete(organizationMember)
          .where(eq(organizationMember.userId, userId))

        return []
      })
    },

    deleteOrganization: async (organizationId) => {
      // Les appartenances et les sélections suivent par cascade : la contrainte
      // de la base est ce qui garantit qu'aucun reste n'échappe à la purge, là
      // où une suppression table par table oublie celle qu'on ajoute ensuite.
      await db.delete(organization).where(eq(organization.id, organizationId))
    },

    countMembersOf: async (organizationId) =>
      await countMembersOf({ kind: 'organization', organizationId }, db),

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

        // **La quantité part avant que l'adhésion soit validée** (ADR 046) : un
        // refus du fournisseur lève ici, et l'invitation redevient consommable.
        //
        // **Le seul ajout de membre à une organisation qui existe déjà** — donc
        // le seul endroit où un plafond peut mordre (s47). La formule était
        // « le seul ajout de membre du module », et elle était fausse :
        // `createOrganization` insère aussi une ligne
        // `organization_member`, celle du fondateur. Elle ne synchronise rien,
        // et rien n'y plafonne — l'organisation naît dans cette
        // transaction-là, elle n'a donc encore aucun client de facturation d'où
        // tirer une offre. La conclusion tenait, la prémisse non ; le prochain
        // lecteur aurait cherché un second site et n'aurait pas trouvé.
        await syncSeatsBeforeCommit(transaction, consumed.organizationId, true)

        return { organizationId: consumed.organizationId }
      })
    },

    removeMember: async (access, removal) => {
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
              eq(organizationMember.userId, removal.userId),
              or(
                ne(organizationMember.role, FOUNDER_ROLE),
                gt(
                  sql<number>`(select count(*) from ${organizationMember} as owners
                      where owners.organization_id = ${access.organizationId}
                        and owners.role = ${FOUNDER_ROLE})`,
                  1,
                ),
              ),
              // **La borne de rôle de s17, dans le même prédicat** : un `admin`
              // ne retire pas un `owner`. Décidée par le `domain`, appliquée
              // ici — la lire avant l'ordre laisserait la fenêtre où la cible
              // devient propriétaire entre les deux.
              removal.unremovableRoles.length === 0
                ? undefined
                : notInArray(organizationMember.role, [...removal.unremovableRoles]),
            ),
          )
          .returning({ id: organizationMember.id })

        if (removed.length === 0) {
          // Rien n'a été retiré : la taille n'a pas changé, il n'y a rien à
          // porter chez le fournisseur. Appeler quand même ferait un appel
          // sortant par refus.
          return false
        }

        // **Le même ordre qu'à l'acceptation**, et pour la même raison : un
        // fournisseur muet ne doit pas retirer un membre en silence. Le résidu
        // s'inverse ici — une validation locale en échec après un succès
        // distant sous-facture d'un siège au lieu de surfacturer —, et c'est le
        // sens le moins coûteux pour le client.
        //
        // **Un retrait n'ajoute rien** : aucun plafond ne s'y oppose (s47,
        // critère 4). L'inverse enfermerait une organisation au-dessus d'un
        // plafond abaissé, en lui interdisant le seul geste qui l'en
        // rapprocherait.
        await syncSeatsBeforeCommit(transaction, access.organizationId, false)

        return true
      })
    },

    setMemberRole: async (access, change) => {
      // **Le même verrou, la même clé que le retrait** (s16, F1), et ce n'est
      // pas une précaution de plus : s17 ouvre une **seconde** voie vers
      // « une organisation sans propriétaire » — la rétrogradation. Deux
      // rétrogradations concurrentes des deux seuls propriétaires évalueraient
      // chacune la sous-requête sur l'état d'avant l'autre. La clé étant
      // l'organisation, une rétrogradation est aussi sérialisée contre un
      // retrait : les deux voies ne peuvent pas se croiser.
      return await db.transaction(async (transaction) => {
        await lockOrganizationMembership(transaction, access.organizationId)

        if (change.transfersOwnership) {
          // **Le transfert** (critère 4) : la cible devient propriétaire et
          // l'appelant administrateur, dans la **même** transaction. Le nombre
          // de propriétaires ne descend donc jamais sous un, et il n'y a aucun
          // prédicat de comptage à écrire — l'invariant tient par construction.
          const [promoted] = await transaction
            .update(organizationMember)
            .set({ role: change.role })
            .where(
              and(
                eq(organizationMember.organizationId, access.organizationId),
                eq(organizationMember.userId, change.userId),
              ),
            )
            .returning({ id: organizationMember.id })

          if (promoted === undefined) {
            return false
          }

          await transaction
            .update(organizationMember)
            .set({ role: SUCCEEDED_OWNER_ROLE })
            .where(
              and(
                eq(organizationMember.organizationId, access.organizationId),
                eq(organizationMember.userId, access.userId),
              ),
            )

          return true
        }

        // Hors transfert, **le prédicat porte la règle du dernier
        // propriétaire** : rétrograder un propriétaire n'est permis que s'il en
        // reste un autre. Une lecture qui déciderait avant ferait deux vérités,
        // et laisserait la fenêtre entre les deux.
        const changed = await transaction
          .update(organizationMember)
          .set({ role: change.role })
          .where(
            and(
              eq(organizationMember.organizationId, access.organizationId),
              eq(organizationMember.userId, change.userId),
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

        return changed.length > 0
      })
    },
  }
}
