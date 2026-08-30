import type { MailerErrorCode } from '@repo/ports'

/**
 * La politique de reprise, isolée du transport parce qu'elle est **pure** :
 * classer une erreur et calculer une attente ne demandent ni réseau, ni
 * horloge. C'est ce qui permet d'en énumérer les cas ici, une fois, plutôt que
 * de les rejouer à travers le SDK.
 */

/**
 * Forme de l'erreur rendue par le SDK Resend, relevée dans le paquet installé
 * (`resend@6.25.0`, `type ErrorResponse`).
 *
 * Le SDK **ne lève pas** : une erreur d'API comme une panne réseau reviennent
 * toutes deux en `{ data: null, error }`. Le `name` est une union fermée côté
 * SDK, élargie ici en `string` : une montée de version ajoute des codes, et un
 * code inconnu ne doit pas casser la compilation — il doit retomber sur le code
 * HTTP.
 */
export interface ResendErrorResponse {
  readonly name: string
  readonly message: string
  readonly statusCode: number | null
}

/**
 * Le tableau de classement, en un seul endroit.
 *
 * Chaque nom relevé dans `RESEND_ERROR_CODE_KEY` du SDK installé y figure : ce
 * qui n'y est pas retombe sur le code HTTP, jamais sur « définitif » par
 * défaut — traiter une panne inconnue comme définitive supprimerait la reprise
 * exactement quand elle sert.
 */
const BY_NAME: Readonly<Record<string, MailerErrorCode>> = {
  // Refus définitifs : la requête est fautive, la rejouer est un défaut.
  validation_error: 'invalid_request',
  missing_required_field: 'invalid_request',
  invalid_parameter: 'invalid_request',
  invalid_from_address: 'invalid_request',
  invalid_attachment: 'invalid_request',
  invalid_region: 'invalid_request',
  invalid_idempotency_key: 'invalid_request',
  invalid_idempotent_request: 'invalid_request',
  not_found: 'invalid_request',
  method_not_allowed: 'invalid_request',
  // Refus d'accès : rejouer ne rendra pas la clé valide.
  missing_api_key: 'unauthorized',
  invalid_api_key: 'unauthorized',
  restricted_api_key: 'unauthorized',
  invalid_access: 'unauthorized',
  security_error: 'unauthorized',
  // Transitoires.
  rate_limit_exceeded: 'rate_limited',
  concurrent_idempotent_requests: 'rate_limited',
  daily_quota_exceeded: 'rate_limited',
  monthly_quota_exceeded: 'rate_limited',
  application_error: 'provider_unavailable',
  internal_server_error: 'provider_unavailable',
}

/** Repli sur le code HTTP quand le nom n'est pas connu du SDK installé. */
const fromStatus = (statusCode: number | null): MailerErrorCode => {
  if (statusCode === null || statusCode >= 500) {
    return 'provider_unavailable'
  }

  if (statusCode === 429) {
    return 'rate_limited'
  }

  if (statusCode === 401 || statusCode === 403) {
    return 'unauthorized'
  }

  return 'invalid_request'
}

export function classifyResendError(error: ResendErrorResponse): MailerErrorCode {
  return BY_NAME[error.name] ?? fromStatus(error.statusCode)
}

/**
 * Ce qui se rejoue, et rien d'autre (`docs/reliability.md` §3).
 *
 * La liste est écrite en positif : ajouter un code d'erreur oblige à dire de
 * quel côté il tombe, et le compilateur le rappelle par l'exhaustivité de
 * `MailerErrorCode`.
 */
export function isTransient(code: MailerErrorCode): boolean {
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
 * La dispersion n'est pas cosmétique : sans elle, mille instances qui échouent
 * sur la même panne rejouent à la même milliseconde et achèvent le fournisseur
 * au moment où il se relève. La forme retenue est la dispersion « à moitié » —
 * l'attente tirée est entre la moitié et la totalité du recul — plutôt que la
 * dispersion totale, qui autorise une reprise immédiate et vide le recul de son
 * sens sur le premier essai.
 *
 * `attempt` vaut 1 pour la première reprise.
 */
export function backoffDelayMs(attempt: number, policy: BackoffPolicy): number {
  const exponential = Math.min(policy.maxMs, policy.baseMs * 2 ** (attempt - 1))

  return Math.round(exponential / 2 + policy.random() * (exponential / 2))
}
