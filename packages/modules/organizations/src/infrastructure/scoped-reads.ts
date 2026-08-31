import { authUser } from '@repo/module-auth'
import { and, asc, count, eq, gte, isNull } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type { MembershipRecord, OrganizationAccess } from '../application/organization-access'
import type { InvitationRecord, MemberIdentity } from '../application/ports'
import type { OrganizationRole } from '../domain/organization'
import {
  organization,
  organizationActiveSelection,
  organizationInvitation,
  organizationMember,
} from '../schema'

/**
 * **La porte unique par laquelle ce module lit ses tables.**
 *
 * Elle existe à cause d'une mesure, pas d'un principe. La revue de s15 a posé
 * un fichier neuf dans `infrastructure/` qui lisait `organization` par un
 * identifiant venu du corps de la requête, sans aucune condition
 * d'appartenance : `pnpm typecheck`, `pnpm lint` et les 811 tests étaient
 * verts. La marque de type d'`OrganizationAccess` garde les deux **écritures**
 * qui l'exigent ; les **lectures** — c'est-à-dire le chemin par lequel une
 * fuite se produit — n'étaient gardées par rien, et la story affirmait pourtant
 * à quatre endroits que « l'appartenance est relue à chaque requête ».
 *
 * Le levier est donc devenu une commande. `eslint.config.ts` refuse `select`,
 * `from` et `execute` dans **tout** le module, **sauf** dans ce fichier —
 * `tests/lint-rules.test.ts` rejoue la sonde de la revue et exige le refus.
 * Chaque fonction ci-dessous prend son propriétaire en **premier paramètre** :
 * l'omettre ne compile pas. Une lecture neuve n'a donc plus que deux issues :
 * passer par ici, ou faire échouer `pnpm lint`.
 *
 * **Ce que ce fichier ne garantit pas**, dit plutôt que sous-entendu : la règle
 * de lint ne lit pas le SQL. À l'intérieur d'ici, rien n'oblige un prédicat à
 * porter le compte — c'est `tests/organizations.test.ts` qui l'éprouve par
 * mutation. **Éprouvé jusqu'ici, sur ces sept prédicats** : `membershipOf`,
 * `activeOrganizationIdOf`, `memberIdentitiesOf`, `liveInvitationsOf`,
 * `invitationsIssuedSince` (le périmètre **et** la fenêtre du quota),
 * `invitationByDigest`, et les prédicats de renvoi et de retrait par les
 * écritures qui les emploient. `membershipsOf`, `membersOf` et
 * `invitationsAddressedTo` ne le sont pas à ce jour. Ce que la règle
 * garantit, c'est que la surface à relire tient dans ce fichier.
 *
 * **Pourquoi `auth_user` est lu ici** (s16). Un membre se nomme par son adresse,
 * et `organization_member` ne porte qu'un identifiant de compte. La jointure se
 * fait donc sur `auth_user`, table du module `auth` — permise parce que `auth`
 * est un requis déclaré (ADR 018), et déjà référencée par `schema.ts` pour les
 * clés étrangères. Deux bornes, et elles sont la raison pour laquelle cette
 * jointure est acceptable :
 *
 * 1. **elle part toujours d'un identifiant de compte**, jamais d'une adresse. Le
 *    module ne sait donc pas répondre à « existe-t-il un compte pour cette
 *    adresse ? », et l'absence d'énumération est structurelle plutôt que
 *    surveillée (`docs/security.md` §7) ;
 * 2. **elle ne sort pas de ce fichier** : la règle de lint borne la surface à
 *    relire, ici comme pour les tables du module.
 */

/** Ce dont une lecture a besoin, et rien de plus. */
export type ReadableDatabase = Pick<PgDatabase<PgQueryResultHKT>, 'select'>

/**
 * Le périmètre que la **plateforme** donne, jamais une requête.
 *
 * C'est la forme organisation de `ModuleScope` (ADR 007), reçue par `purge` et
 * `export`. Elle est recopiée ici plutôt qu'importée pour que la couche
 * `infrastructure` n'ait pas à connaître `@repo/core` pour une lecture ; le
 * point qui compte est ailleurs : cette valeur ne vient jamais d'un corps de
 * requête, elle vient du socle qui exécute la purge ou l'export.
 */
export interface PlatformOrganizationScope {
  readonly kind: 'organization'
  readonly organizationId: string
}

/** La même chose pour un compte : la forme compte de `ModuleScope` (ADR 007). */
export interface PlatformUserScope {
  readonly kind: 'user'
  readonly userId: string
}

/**
 * Les colonnes d'une appartenance, jointes à son organisation.
 *
 * Énumérées, jamais étalées : ce que le module rend d'une ligne se limite à ce
 * qu'un écran a le droit d'afficher (le précédent de `describeSessions`, s08).
 */
const MEMBERSHIP_COLUMNS = {
  organizationId: organization.id,
  userId: organizationMember.userId,
  role: organizationMember.role,
  name: organization.name,
  slug: organization.slug,
}

const toMembership = (row: {
  organizationId: string
  userId: string
  role: string
  name: string
  slug: string
}): MembershipRecord => ({
  organizationId: row.organizationId,
  userId: row.userId,
  role: row.role as OrganizationRole,
  name: row.name,
  slug: row.slug,
})

export interface ScopedReads {
  /**
   * L'appartenance de **ce** compte à **cette** organisation, ou `null`.
   *
   * En **un seul ordre**, portant les deux conditions. Le compte fait partie du
   * prédicat, il n'est pas vérifié avant : une vérification préalable suivie
   * d'une lecture laisse la fenêtre où l'on sert la donnée d'autrui
   * (`docs/security.md` §3). Le `null` ne distingue pas « pas membre » de
   * « n'existe pas » — la requête elle-même ne les distingue pas.
   */
  membershipOf(userId: string, organizationId: string): Promise<MembershipRecord | null>

  /** Les appartenances du compte, par nom d'organisation. */
  membershipsOf(userId: string): Promise<readonly MembershipRecord[]>

  /**
   * L'organisation courante du compte — **si le compte en est encore membre**.
   *
   * La ligne de sélection survit au retrait d'un membre (s16), et rien ne doit
   * la nettoyer : c'est la lecture qui porte l'appartenance, comme les trois
   * routes du module. Sans la jointure, `resolveDataOwner` rendait le périmètre
   * d'une organisation quittée — constat F1 de la revue de s15.
   */
  activeOrganizationIdOf(userId: string): Promise<string | null>

  /** Les membres d'une organisation, pour l'export du périmètre plateforme. */
  membersOf(scope: PlatformOrganizationScope): Promise<readonly MembershipRecord[]>

  /* ----------------------------------------------------------------------- *
   * s16. Chacune prend son propriétaire en **premier** paramètre, et pour les
   * quatre premières ce propriétaire est un `OrganizationAccess` : l'omettre ne
   * compile pas, et le fabriquer non plus (marque de type non exportée).
   * ----------------------------------------------------------------------- */

  /** Les membres, avec l'adresse qui les nomme à l'écran. */
  memberIdentitiesOf(access: OrganizationAccess): Promise<readonly MemberIdentity[]>

  /** Les invitations ni acceptées ni révoquées de **cette** organisation. */
  liveInvitationsOf(access: OrganizationAccess): Promise<readonly InvitationRecord[]>

  /** Le nombre d'invitations émises par **cette** organisation depuis cet instant. */
  invitationsIssuedSince(access: OrganizationAccess, since: Date): Promise<number>

  /**
   * L'invitation que cette empreinte désigne, ou `null`.
   *
   * **Le propriétaire est ici le jeton**, et c'est la seule lecture du module
   * dans ce cas : l'invité n'est pas encore membre, donc aucun
   * `OrganizationAccess` ne peut exister pour lui. Le secret **est**
   * l'autorisation, et il est comparé sous sa forme hachée.
   */
  invitationByDigest(tokenHash: string): Promise<InvitationRecord | null>

  /**
   * L'adresse d'un compte. Le propriétaire est le compte lui-même.
   *
   * Lue **par identifiant**, jamais par adresse : c'est ce qui empêche cette
   * porte de devenir un test d'existence de compte.
   */
  emailOf(userId: string): Promise<string | null>

  /**
   * Les invitations adressées à **ce compte**, quel que soit leur état.
   *
   * Le propriétaire est le compte, et l'adresse ne vient pas d'une requête :
   * elle est lue sur le compte lui-même (`emailOf`), par le socle qui exécute
   * l'export ou la purge. La lecture est bien par adresse, mais **l'adresse est
   * celle du propriétaire** — ce n'est donc pas la lecture par adresse que
   * l'`AGENTS.md` du module interdit, laquelle rendrait l'existence d'un compte
   * observable depuis une requête (`docs/security.md` §7).
   */
  invitationsAddressedTo(
    scope: PlatformUserScope,
    email: string,
  ): Promise<readonly InvitationRecord[]>
}

export function createScopedReads(db: ReadableDatabase): ScopedReads {
  /** La jointure de base : une appartenance et l'organisation qu'elle désigne. */
  const membershipQuery = () =>
    db
      .select(MEMBERSHIP_COLUMNS)
      .from(organizationMember)
      .innerJoin(organization, eq(organization.id, organizationMember.organizationId))

  return {
    membershipOf: async (userId, organizationId) => {
      const [row] = await membershipQuery()
        .where(and(eq(organization.id, organizationId), eq(organizationMember.userId, userId)))
        .limit(1)

      return row === undefined ? null : toMembership(row)
    },

    membershipsOf: async (userId) => {
      const rows = await membershipQuery()
        .where(eq(organizationMember.userId, userId))
        .orderBy(asc(organization.name), asc(organization.id))

      return rows.map(toMembership)
    },

    activeOrganizationIdOf: async (userId) => {
      const [row] = await db
        .select({ organizationId: organizationActiveSelection.organizationId })
        .from(organizationActiveSelection)
        .innerJoin(
          organizationMember,
          and(
            eq(organizationMember.organizationId, organizationActiveSelection.organizationId),
            eq(organizationMember.userId, organizationActiveSelection.userId),
          ),
        )
        .where(eq(organizationActiveSelection.userId, userId))
        .limit(1)

      return row?.organizationId ?? null
    },

    membersOf: async (scope) => {
      const rows = await membershipQuery()
        .where(eq(organization.id, scope.organizationId))
        .orderBy(asc(organizationMember.userId))

      return rows.map(toMembership)
    },

    memberIdentitiesOf: async (access) => {
      const rows = await db
        .select({
          userId: organizationMember.userId,
          role: organizationMember.role,
          email: authUser.email,
        })
        .from(organizationMember)
        .innerJoin(authUser, eq(authUser.id, organizationMember.userId))
        // Le périmètre, et rien d'autre : l'organisation à laquelle l'appelant a
        // été autorisé.
        .where(eq(organizationMember.organizationId, access.organizationId))
        // Un ordre stable, sinon la liste danse d'un rendu à l'autre.
        .orderBy(asc(authUser.email))

      return rows.map((row) => ({
        userId: row.userId,
        email: row.email,
        role: row.role as OrganizationRole,
      }))
    },

    liveInvitationsOf: async (access) => {
      const rows = await invitationQuery(db)
        .where(
          and(
            eq(organizationInvitation.organizationId, access.organizationId),
            isNull(organizationInvitation.acceptedAt),
            isNull(organizationInvitation.revokedAt),
          ),
        )
        .orderBy(asc(organizationInvitation.email))

      return rows.map(toInvitation)
    },

    invitationsIssuedSince: async (access, since) => {
      const [row] = await db
        .select({ issued: count() })
        .from(organizationInvitation)
        .where(
          and(
            eq(organizationInvitation.organizationId, access.organizationId),
            // `created_at` ne bouge pas ; `updated_at` bougerait au renvoi, et
            // un renvoi n'est pas une émission de plus.
            gte(organizationInvitation.createdAt, since),
          ),
        )

      return row?.issued ?? 0
    },

    invitationByDigest: async (tokenHash) => {
      const [row] = await invitationQuery(db)
        .where(eq(organizationInvitation.tokenHash, tokenHash))
        .limit(1)

      return row === undefined ? null : toInvitation(row)
    },

    emailOf: async (userId) => {
      const [row] = await db
        .select({ email: authUser.email })
        .from(authUser)
        .where(eq(authUser.id, userId))
        .limit(1)

      return row?.email ?? null
    },

    invitationsAddressedTo: async (_scope, email) => {
      const rows = await invitationQuery(db)
        .where(eq(organizationInvitation.email, email))
        .orderBy(asc(organizationInvitation.createdAt), asc(organizationInvitation.id))

      return rows.map(toInvitation)
    },
  }
}

/**
 * Les colonnes d'une invitation, jointes à son organisation.
 *
 * `token_hash` **n'y est pas** : rien de ce qui sort de cette porte ne porte
 * l'empreinte du secret. Une lecture qui la rendrait la ferait circuler dans la
 * couche `application`, puis dans une vue, puis un jour dans un rendu.
 */
const invitationQuery = (db: ReadableDatabase) =>
  db
    .select({
      id: organizationInvitation.id,
      organizationId: organizationInvitation.organizationId,
      organizationName: organization.name,
      email: organizationInvitation.email,
      role: organizationInvitation.role,
      expiresAt: organizationInvitation.expiresAt,
      acceptedAt: organizationInvitation.acceptedAt,
      revokedAt: organizationInvitation.revokedAt,
    })
    .from(organizationInvitation)
    .innerJoin(organization, eq(organization.id, organizationInvitation.organizationId))

const toInvitation = (row: {
  id: string
  organizationId: string
  organizationName: string
  email: string
  role: string
  expiresAt: Date
  acceptedAt: Date | null
  revokedAt: Date | null
}): InvitationRecord => ({
  id: row.id,
  organizationId: row.organizationId,
  organizationName: row.organizationName,
  email: row.email,
  role: row.role as OrganizationRole,
  expiresAt: row.expiresAt,
  acceptedAt: row.acceptedAt,
  revokedAt: row.revokedAt,
})
