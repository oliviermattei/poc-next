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

/**
 * **Le plafond de membres que porte une offre**, ou `null` — s47, critère 1.
 *
 * Elle ne reçoit **que** `seatLimit`, et c'est la décision 2 du plan écrite
 * dans un type plutôt que dans un commentaire : cette règle ne peut pas voir
 * `perSeat` ni `mode`, donc elle ne peut pas être refermée dessus par
 * symétrie avec `offerSyncsSeats`. Cette symétrie serait fausse — la
 * synchronisation exclut l'achat unique parce qu'il n'a **aucun abonnement à
 * corriger**, tandis qu'un plafond se vend précisément au forfait (« jusqu'à
 * cinq membres », prix fixe), et c'est même son emploi le plus courant.
 *
 * Le champ est facultatif : absent et `null` disent la même chose, une offre
 * illimitée.
 */
export function offerSeatLimit(offer: Pick<BillingOffer, 'seatLimit'>): number | null {
  return offer.seatLimit ?? null
}

/**
 * **Cet effectif dépasse-t-il ce plafond ?** — la règle, réduite à deux nombres.
 *
 * `members` est l'effectif **après** l'écriture, jamais un delta : c'est la
 * même convention que `SeatSync` du module `organizations`, et c'est ce qui
 * rend la question rejouable. L'inégalité est donc stricte — un plafond de cinq
 * laisse passer le cinquième membre et refuse le sixième ; une inégalité large
 * plafonnerait l'offre à quatre.
 *
 * **Elle ne retire jamais personne** (critère 4). Un plafond abaissé sous
 * l'effectif — ici, ou par un changement d'offre — rend `true` sur le prochain
 * ajout et rien d'autre : cette fonction ne rend pas de liste de membres, et
 * aucune couche au-dessus n'en fabrique une. Le cimetière du PRD refuse toute
 * suppression de données hors d'un `eject` explicite.
 *
 * `null` est **l'absence de plafond**, pas un plafond de zéro : une offre qui
 * n'en déclare pas reste illimitée.
 */
export function exceedsSeatLimit(members: number, limit: number | null): boolean {
  return limit !== null && members > limit
}
