import type { ModuleScope } from '@repo/core'
import type { SeatSyncOutcome } from '@repo/module-billing'
import type { SeatSync } from '@repo/module-organizations'

/**
 * **Ce que la nouvelle taille d'une organisation doit traverser avant que
 * l'écriture qui l'a changée soit validée** (s23, ADR 046) — la règle qui
 * décide, isolée de ce qui la construit, comme `lib/billing-permission.ts`.
 *
 * Elle est ici, et pas dans le point de composition, pour la raison que la
 * revue de s19 a mesurée deux fois : une règle écrite dans
 * `lib/organizations.ts` ne peut être neutralisée par aucun test, parce que
 * rien ne peut la construire à côté. `canManage` ramené à `() => true` y
 * laissait 1 320 cas sur 1 320 au vert. Ici, `tests/billing.test.ts` la branche
 * sur une facturation absente **et** sur la vraie.
 *
 * Ce qu'elle décide tient en une ligne, et les deux sens coûtent cher :
 *
 * - `false` **annule** l'ajout ou le retrait du membre. C'est le critère 6 : un
 *   fournisseur en panne n'ajoute personne ;
 * - `true` laisse l'écriture se valider. **Ne rien avoir à faire en fait
 *   partie** : module de facturation coupé, périmètre sans client, offre au
 *   forfait. Confondre « rien à faire » avec « échec » rendrait les
 *   organisations inutilisables dans tout projet qui ne vend rien — c'est le
 *   critère 8.
 */

/** Ce que la règle a besoin de connaître de la facturation, et rien de plus. */
export interface SeatSyncBilling {
  readonly available: boolean
  readonly syncSeats: (input: {
    readonly scope: ModuleScope
    readonly seats: number
  }) => Promise<SeatSyncOutcome>
}

/**
 * `load` est une **fonction asynchrone**, et ce n'est pas une préférence de
 * style : `lib/billing.ts` importe `lib/organizations.ts`, si bien que le point
 * de composition des organisations ne peut charger la facturation qu'en
 * différé, sous peine de fermer le cycle et d'évaluer l'un des deux fichiers à
 * moitié. Le même motif que `emailOfScope` avec `lib/auth`.
 */
export function seatSyncOf(load: () => Promise<SeatSyncBilling>): SeatSync {
  return async ({ organizationId, seats }): Promise<boolean> => {
    const billing = await load()

    // Facturation coupée : **aucune question posée**, et aucune connexion
    // ouverte pour apprendre qu'il n'y a rien à faire.
    if (!billing.available) {
      return true
    }

    const outcome = await billing.syncSeats({
      scope: { kind: 'organization', organizationId },
      seats,
    })

    return outcome.status !== 'failed'
  }
}
