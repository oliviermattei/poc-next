import type { ModuleExportPayload, ModuleScope } from '@repo/core'
import { z } from 'zod'

import {
  FOUNDER_ROLE,
  parseOrganizationDraft,
  type OrganizationRefusal,
  type OrganizationRole,
} from '../domain/organization'
import { authorizeOrganization, type OrganizationAccess } from './organization-access'
import type { OrganizationsDependencies } from './ports'

/**
 * Les cas d'usage du module : créer, basculer, renommer, décrire, purger,
 * exporter.
 *
 * Deux invariants traversent ce fichier, et ils ne sont pas décoratifs :
 *
 * 1. **Aucune écriture ne reçoit un identifiant d'organisation nu.** Elles
 *    exigent un `OrganizationAccess`, que seule la lecture conjointe produit
 *    (`organization-access.ts`). Le compilateur refuse le contraire.
 * 2. **L'autorisation vient avant la validation.** Un non-membre reçoit
 *    `not_found`, quel que soit son corps de requête — sinon un formulaire mal
 *    rempli distinguerait « l'organisation existe et je n'y suis pas » de
 *    « elle n'existe pas » (`docs/security.md` §7).
 */

/** Une organisation telle qu'un écran la voit. Ni identifiant technique caché, ni jeton. */
export interface OrganizationSummary {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly role: OrganizationRole
}

/**
 * Ce que l'écran des organisations affiche.
 *
 * **La forme est la même quand le module est coupé** — deux champs, une liste
 * vide et un `null`. C'est ce qui évite à l'écran de porter une branche « si le
 * module existe » (le patron de `EMPTY_MARKETING_SITE`, s10).
 */
export interface OrganizationsView {
  readonly current: OrganizationSummary | null
  readonly memberships: readonly OrganizationSummary[]
}

export const EMPTY_ORGANIZATIONS_VIEW: OrganizationsView = { current: null, memberships: [] }

export type OrganizationOutcome =
  | { readonly status: 'ok'; readonly organizationId: string }
  | { readonly status: 'not_found' }
  | { readonly status: 'refused'; readonly refusal: OrganizationRefusal }

/**
 * L'identifiant d'organisation reçu d'un corps de requête.
 *
 * Zod à **chaque** frontière (`docs/security.md` §4), y compris pour un champ
 * qui « ne peut être qu'une chaîne » : ce qui arrive ici vient de nulle part.
 */
const ORGANIZATION_ID = z.object({ organizationId: z.string().trim().min(1).max(64) })

const summaryOf = (membership: {
  organizationId: string
  name: string
  slug: string
  role: OrganizationRole
}): OrganizationSummary => ({
  id: membership.organizationId,
  name: membership.name,
  slug: membership.slug,
  role: membership.role,
})

export interface OrganizationsUseCases {
  createOrganization(input: {
    readonly userId: string
    readonly body: unknown
  }): Promise<OrganizationOutcome>
  switchOrganization(input: {
    readonly userId: string
    readonly body: unknown
  }): Promise<OrganizationOutcome>
  renameOrganization(input: {
    readonly userId: string
    readonly body: unknown
  }): Promise<OrganizationOutcome>
  viewOrganizations(userId: string): Promise<OrganizationsView>
  activeOrganizationId(userId: string): Promise<string | null>
  purge(scope: ModuleScope): Promise<void>
  export(scope: ModuleScope): Promise<ModuleExportPayload>
}

export function createOrganizationsUseCases(
  dependencies: OrganizationsDependencies,
): OrganizationsUseCases {
  const { repository, reservedSlugs, generateId } = dependencies

  /** La lecture conjointe, enveloppée : le port garde son receveur. */
  const findMembership = (input: {
    readonly userId: string
    readonly organizationId: string
  }) => repository.findMembership(input)

  /** L'accès demandé par un corps de requête, ou le refus qui ne dit rien. */
  const accessFrom = async (
    userId: string,
    body: unknown,
  ): Promise<OrganizationAccess | null> => {
    const parsed = ORGANIZATION_ID.safeParse(body)

    if (!parsed.success) {
      // Un identifiant malformé et une organisation d'autrui rendent la même
      // chose : rien. Distinguer les deux rendrait la forme des identifiants
      // observable, et avec elle l'existence des organisations.
      return null
    }

    return await authorizeOrganization(findMembership, {
      userId,
      organizationId: parsed.data.organizationId,
    })
  }

  return {
    createOrganization: async ({ userId, body }) => {
      const draft = parseOrganizationDraft(body, reservedSlugs)

      if (!draft.ok) {
        return { status: 'refused', refusal: draft.refusal }
      }

      const organizationId = generateId('org')
      const written = await repository.createOrganization({
        organizationId,
        membershipId: generateId('mbr'),
        name: draft.value.name,
        slug: draft.value.slug,
        userId,
        // Le créateur en est **propriétaire** (critère 4). C'est le `domain` qui
        // le dit, pas cette ligne.
        role: FOUNDER_ROLE,
      })

      if (written === 'slug_unavailable') {
        return { status: 'refused', refusal: 'slug_unavailable' }
      }

      // L'appartenance qu'on vient d'écrire est **relue** par la lecture
      // conjointe : c'est ce qui fait qu'un accès a toujours la même origine.
      const access = await authorizeOrganization(findMembership, { userId, organizationId })

      if (access === null) {
        return { status: 'not_found' }
      }

      await repository.setActiveOrganization(access)

      return { status: 'ok', organizationId: access.organizationId }
    },

    switchOrganization: async ({ userId, body }) => {
      const access = await accessFrom(userId, body)

      if (access === null) {
        return { status: 'not_found' }
      }

      await repository.setActiveOrganization(access)

      return { status: 'ok', organizationId: access.organizationId }
    },

    renameOrganization: async ({ userId, body }) => {
      // L'autorisation d'abord : un non-membre n'apprend rien de son corps de
      // requête, pas même qu'il était mal formé.
      const access = await accessFrom(userId, body)

      if (access === null) {
        return { status: 'not_found' }
      }

      const draft = parseOrganizationDraft(body, reservedSlugs)

      if (!draft.ok) {
        return { status: 'refused', refusal: draft.refusal }
      }

      const written = await repository.renameOrganization(access, {
        name: draft.value.name,
        slug: draft.value.slug,
      })

      return written === 'slug_unavailable'
        ? { status: 'refused', refusal: 'slug_unavailable' }
        : { status: 'ok', organizationId: access.organizationId }
    },

    viewOrganizations: async (userId) => {
      const [memberships, activeId] = await Promise.all([
        repository.listMemberships(userId),
        repository.findActiveOrganizationId(userId),
      ])

      const summaries = memberships.map(summaryOf)

      return {
        // L'organisation courante est cherchée **dans les appartenances** :
        // une sélection qui aurait survécu au retrait du membre (s16) ne
        // ressort donc pas, sans qu'aucune ligne n'ait à être nettoyée.
        current: summaries.find((summary) => summary.id === activeId) ?? null,
        memberships: summaries,
      }
    },

    activeOrganizationId: async (userId) => await repository.findActiveOrganizationId(userId),

    purge: async (scope) => {
      // Rejouable : les deux effacements sont des `delete` conditionnels, donc
      // un second passage ne trouve rien et n'ajoute rien
      // (`docs/reliability.md` §1).
      if (scope.kind === 'user') {
        await repository.deleteMembershipsOf(scope.userId)

        return
      }

      await repository.deleteOrganization(scope.organizationId)
    },

    export: async (scope) => {
      if (scope.kind === 'user') {
        const [memberships, activeOrganizationId] = await Promise.all([
          repository.listMemberships(scope.userId),
          repository.findActiveOrganizationId(scope.userId),
        ])

        return { memberships: memberships.map(summaryOf), activeOrganizationId }
      }

      const members = await repository.listMembersOf(scope.organizationId)

      return {
        organizationId: scope.organizationId,
        members: members.map((member) => ({ userId: member.userId, role: member.role })),
      }
    },
  }
}
