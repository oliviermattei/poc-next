/**
 * La politique d'appel sortant du module (`docs/reliability.md` §3).
 *
 * Pure, et elle l'est pour la même raison que celle de l'adapter d'emails :
 * classer un échec et calculer une attente ne demandent ni réseau ni horloge.
 * Les cas s'énumèrent donc **ici, une fois**, au lieu d'être rejoués à travers
 * un fournisseur.
 *
 * Duplication assumée avec `packages/adapters/resend/src/retry.ts` : un module
 * n'importe pas un adapter (ADR 006), et le seul moyen de partager ces deux
 * fonctions serait de les faire entrer dans `@repo/ports`, qui décrit des
 * contrats et non des politiques. Le jour où un troisième appelant en a besoin,
 * c'est cette extraction-là qu'il faut faire — pas une troisième copie.
 */

/**
 * Ce qui a fait échouer un appel sortant, réduit à ce qui décide de la reprise.
 *
 * `network` couvre l'exception jetée par `fetch` — DNS, connexion refusée,
 * socket coupée — que la couche transport ne distingue pas plus finement.
 */
export type OutboundFailure = 'timeout' | 'network' | 'server' | 'rate_limited' | 'refused'

/**
 * Le classement d'une réponse HTTP du fournisseur.
 *
 * Écrit en positif sur les transitoires : ce qui n'est ni 5xx ni 429 est un
 * refus, et un refus est **définitif**. Le repli par défaut est donc « ne
 * rejoue pas » — l'inverse du repli de l'adapter d'emails, et la différence est
 * délibérée : ici la requête porte un code d'autorisation ou un jeton d'accès,
 * et un fournisseur qui les refuse ne changera pas d'avis au troisième essai.
 */
export function classifyOutboundStatus(status: number): OutboundFailure {
  if (status >= 500) {
    return 'server'
  }

  return status === 429 ? 'rate_limited' : 'refused'
}

/**
 * Ce qui se rejoue, et rien d'autre.
 *
 * « Les reprises ne s'appliquent qu'aux erreurs transitoires. Rejouer une
 * erreur de validation est un défaut, pas une précaution »
 * (`docs/reliability.md` §3).
 */
export function isTransientOutboundFailure(failure: OutboundFailure): boolean {
  return failure !== 'refused'
}

export interface OutboundBackoff {
  readonly baseMs: number
  readonly maxMs: number
  /** Injecté : une attente aléatoire non injectée est une attente non testable. */
  readonly random?: () => number
}

/**
 * Recul exponentiel **avec dispersion**, plafonné.
 *
 * La dispersion évite que toutes les instances qui échouent sur la même panne
 * rejouent à la même milliseconde. La forme retenue est la dispersion « à
 * moitié » — l'attente tirée est entre la moitié et la totalité du recul — et
 * non la dispersion totale, qui autorise une reprise immédiate et vide le recul
 * de son sens dès le premier essai.
 *
 * Le plafond n'est pas décoratif : ces attentes se paient **dans le temps de
 * réponse du rappel**, une requête que le visiteur attend devant un écran
 * blanc.
 *
 * `attempt` vaut 1 pour la première reprise.
 */
export function outboundBackoffMs(attempt: number, backoff: OutboundBackoff): number {
  const exponential = Math.min(backoff.maxMs, backoff.baseMs * 2 ** (attempt - 1))
  const random = backoff.random ?? Math.random

  return Math.round(exponential / 2 + random() * (exponential / 2))
}
