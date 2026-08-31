import { and, asc, eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type { MembershipRecord } from '../application/organization-access'
import type { OrganizationRole } from '../domain/organization'
import { organization, organizationActiveSelection, organizationMember } from '../schema'

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
 * mutation, sur les quatre lectures qui existent aujourd'hui. Ce que la règle
 * garantit, c'est que la surface à relire tient dans ce fichier.
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
  }
}
