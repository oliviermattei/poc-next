import type { ModuleScope } from '@repo/core'
import type { SeatSyncOutcome } from '@repo/module-billing'
import type { SeatSync, SeatSyncVerdict } from '@repo/module-organizations'

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
 * - un refus **annule** l'ajout ou le retrait du membre. C'est le critère 6 de
 *   s23 : un fournisseur en panne n'ajoute personne ;
 * - l'accord laisse l'écriture se valider. **Ne rien avoir à faire en fait
 *   partie** : module de facturation coupé, périmètre sans client, offre au
 *   forfait. Confondre « rien à faire » avec « échec » rendrait les
 *   organisations inutilisables dans tout projet qui ne vend rien — c'est le
 *   critère 8.
 *
 * **Deux refus depuis s47, et ils ne se replient pas l'un sur l'autre.** Une
 * panne du fournisseur dit « réessayez » ; un plafond atteint dit « ce n'est
 * pas à vous de réessayer ». Les confondre ferait recharger indéfiniment un
 * écran qui ne changera pas d'avis — c'est exactement ce que s23 refusait déjà
 * en distinguant sa panne de « lien invalide ».
 */

/** Ce que la règle a besoin de connaître de la facturation, et rien de plus. */
export interface SeatSyncBilling {
  readonly available: boolean
  readonly syncSeats: (input: {
    readonly scope: ModuleScope
    readonly seats: number
    /** L'écriture ajoute-t-elle un membre ? Seul un ajout peut franchir un plafond (s47). */
    readonly adds?: boolean
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
  return async ({ organizationId, seats, adds }): Promise<SeatSyncVerdict> => {
    const billing = await load()

    // Facturation coupée : **aucune question posée**, et aucune connexion
    // ouverte pour apprendre qu'il n'y a rien à faire. **Aucun plafond non
    // plus** (s47, critère 5) — et par la valeur vide, pas par une condition
    // sur un nom de module : il n'y a rien ici qui nomme `billing`.
    if (!billing.available) {
      return { ok: true }
    }

    const outcome = await billing.syncSeats({
      scope: { kind: 'organization', organizationId },
      seats,
      adds,
    })

    if (outcome.status === 'failed') {
      return { ok: false, refusal: 'seat_sync_unavailable' }
    }

    // **Le plafond** (s47) : l'écriture est annulée comme sur une panne, mais
    // le motif est différent — et c'est lui qui décide de ce que l'invité lit,
    // donc de ce qu'il fera ensuite.
    if (outcome.status === 'over_limit') {
      return { ok: false, refusal: 'seat_limit_reached' }
    }

    return { ok: true }
  }
}
