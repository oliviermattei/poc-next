import type { BillingOffer } from './offer'

/**
 * **La facturation au siège, réduite à ses deux décisions** (s23, ADR 046).
 *
 * Du `domain` : aucune base, aucun framework, aucun SDK (ADR 006). Ce qui est
 * ici n'est pas de la plomberie mais deux règles qui coûtent cher à inverser —
 * la première fait payer une offre qui n'a pas d'abonnement, la seconde fait
 * *baisser* une facture sur une lecture qui n'a rien dit.
 */

/**
 * Cette offre fait-elle suivre sa quantité au nombre de membres ?
 *
 * **Deux conditions, et la seconde n'est pas redondante.** `perSeat` est un
 * booléen indépendant du mode, et `config/billing.ts` n'interdit pas de le
 * poser sur un achat unique (question ouverte de la recherche de s23). Un achat
 * unique n'a pourtant aucun abonnement à corriger : il est encaissé une fois et
 * n'expire jamais (ADR 038). La règle le tranche ici, plutôt qu'en ajoutant un
 * champ que le propriétaire du projet devrait comprendre.
 */
export function offerSyncsSeats(offer: Pick<BillingOffer, 'perSeat' | 'mode'>): boolean {
  return offer.perSeat && offer.mode === 'subscription'
}

/**
 * La quantité à facturer pour un nombre de membres **lu**, ou `null` quand
 * cette lecture n'autorise aucune écriture.
 *
 * C'est la garde contre le seul défaut vraiment coûteux de cette story : faire
 * baisser une facture sur un silence. Trois lectures ne sont pas « zéro
 * membre » —
 *
 * - `null` : il n'y a pas de nombre (périmètre compte, module `organizations`
 *   coupé) ;
 * - `0` : aucune organisation n'a zéro membre — `createOrganization` écrit
 *   l'organisation **et** l'appartenance de son créateur dans la même
 *   transaction. Un zéro est donc une lecture partielle, jamais un état ;
 * - un négatif : une impossibilité, traitée comme telle plutôt que propagée.
 *
 * Dans les trois cas la réponse est la même : on ne touche pas à la quantité.
 * `AGENTS.md` le dit de la réconciliation — « un silence du tiers ne doit pas
 * couper un client qui paie » —, et le silence de **notre** base ne doit pas
 * davantage réduire ce qu'il paie.
 */
export function billableSeats(members: number | null): number | null {
  return members === null || members < 1 ? null : members
}
