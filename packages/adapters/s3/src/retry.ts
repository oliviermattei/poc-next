import type { StorageErrorCode } from '@repo/ports'

/**
 * La politique de reprise, isolée du transport parce qu'elle est **pure** :
 * classer un échec et calculer une attente ne demandent ni réseau, ni horloge.
 *
 * Duplication assumée avec `packages/adapters/resend/src/retry.ts` : les deux
 * adapters n'ont pas le droit de se connaître, et le seul moyen de partager ces
 * fonctions serait de les faire entrer dans `@repo/ports`, qui décrit des
 * contrats et non des politiques. C'est la même conclusion que celle écrite
 * dans `packages/modules/auth/src/domain/outbound.ts`, pour la même raison.
 */

/**
 * Le classement d'un échec, **par code HTTP d'abord**.
 *
 * S3 et ses compatibles (R2, MinIO, Spaces) portent chacun leur vocabulaire de
 * `<Code>` : `NoSuchKey`, `NoSuchBucket`, `AccessDenied`, `SlowDown`,
 * `InternalError`… Le code HTTP, lui, est commun aux quatre, et c'est le seul
 * signal sur lequel un adapter « API compatible S3 » peut s'appuyer sans
 * privilégier un fournisseur.
 *
 * Écrit en positif sur les transitoires : ce qui n'est ni 5xx ni 429 ni 408
 * est **définitif**. Un refus d'accès ne changera pas d'avis au troisième
 * essai, et une clé absente ne réapparaîtra pas (`docs/reliability.md` §3).
 */
export function classifyStorageStatus(status: number | undefined): StorageErrorCode {
  if (status === undefined) {
    // Aucun statut : la requête n'a pas abouti — DNS, connexion refusée,
    // socket coupée. Transitoire, comme la panne de fournisseur qu'elle est.
    return 'provider_unavailable'
  }

  if (status >= 500) {
    return 'provider_unavailable'
  }

  if (status === 429 || status === 408) {
    return 'rate_limited'
  }

  if (status === 401 || status === 403) {
    return 'unauthorized'
  }

  if (status === 404) {
    return 'not_found'
  }

  return 'invalid_request'
}

/**
 * Ce qui se rejoue, et rien d'autre.
 *
 * La liste est écrite en positif : ajouter un code à `StorageErrorCode` oblige
 * à dire de quel côté il tombe, et le compilateur le rappelle par
 * l'exhaustivité de l'union.
 */
export function isTransientStorageError(code: StorageErrorCode): boolean {
  return code === 'timeout' || code === 'provider_unavailable' || code === 'rate_limited'
}

export interface BackoffPolicy {
  readonly baseMs: number
  readonly maxMs: number
  /** Injecté : une attente aléatoire non injectée est une attente non testable. */
  readonly random: () => number
}

/**
 * Recul exponentiel **avec dispersion**, plafonné.
 *
 * Dispersion « à moitié » — l'attente tirée est entre la moitié et la totalité
 * du recul — plutôt que dispersion totale, qui autorise une reprise immédiate
 * et vide le recul de son sens dès le premier essai. Sans dispersion, mille
 * instances qui échouent sur la même panne rejouent à la même milliseconde et
 * achèvent le fournisseur au moment où il se relève.
 *
 * `attempt` vaut 1 pour la première reprise.
 */
export function backoffDelayMs(attempt: number, policy: BackoffPolicy): number {
  const exponential = Math.min(policy.maxMs, policy.baseMs * 2 ** (attempt - 1))

  return Math.round(exponential / 2 + policy.random() * (exponential / 2))
}
