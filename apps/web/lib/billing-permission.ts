import type { ModuleScope } from '@repo/core'
import type { BillingPermission } from '@repo/module-billing'
import { ORGANIZATION_ACTION, type OrganizationsView } from '@repo/module-organizations'

/**
 * **Qui a le droit de gérer la facturation** (ADR 034) — la règle qui décide,
 * isolée de ce qui la construit, comme `lib/billing-config.ts` et
 * `lib/oauth-config.ts`.
 *
 * Elle est ici, et pas dans le point de composition, pour une raison mesurée :
 * neutralisée en `return true` — c'est-à-dire *tout membre d'une organisation
 * annule l'abonnement de son organisation* —, elle laissait la suite entière
 * verte (constat F3 de la revue). Une règle qu'aucune commande ne tient est de
 * la documentation. Ici, `tests/billing.test.ts` la branche sur la **vraie** vue
 * du module `organizations`, avec un rôle réel en base, et mesure le 403 à la
 * route — la forme que `docs/security.md` §3 exige et que s17 emploie déjà.
 *
 * **Elle ne compare aucun rôle.** La matrice appartient au module
 * `organizations` et s'écrit une fois
 * (`packages/modules/organizations/src/domain/permissions.ts`) : ce fichier pose
 * la question à celui qui possède la réponse. Module `organizations` coupé — ou
 * périmètre compte —, le compte est propriétaire de sa donnée et tout lui est
 * permis, sans qu'aucune question ne soit posée (critère 7 de s17).
 */

/**
 * Ce que la règle a besoin de connaître des organisations : **deux membres**,
 * exactement ceux que `lib/organizations.ts` expose.
 *
 * Réduit à cela pour que la règle soit éprouvable sans monter l'application, et
 * pour qu'elle ne puisse rien apprendre d'autre.
 */
export interface BillingOrganizations {
  readonly available: boolean
  readonly view: (userId: string) => Promise<OrganizationsView>
}

export function billingPermissionOf(organizations: BillingOrganizations): BillingPermission {
  return async (scope: ModuleScope, userId: string): Promise<boolean> => {
    if (scope.kind !== 'organization' || !organizations.available) {
      return true
    }

    const view = await organizations.view(userId)

    return view.permissions[ORGANIZATION_ACTION.manageBilling] === true
  }
}
