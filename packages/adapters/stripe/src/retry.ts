import type { PaymentsErrorCode } from '@repo/ports'

/**
 * Classement des erreurs, politique de reprise et assainissement des messages —
 * isolés du transport parce qu'ils sont **purs**. Classer une erreur, calculer
 * une attente et retirer un secret d'une chaîne ne demandent ni réseau, ni
 * horloge : leurs cas s'énumèrent ici, une fois, plutôt que de se rejouer à
 * travers le SDK.
 */

/**
 * Ce que l'adaptateur lit d'une erreur du SDK.
 *
 * Volontairement structurel et tout optionnel : `stripe@22.6.0` lève une
 * dizaine de classes, et une montée de version en ajoutera. Un champ absent ne
 * doit pas casser la compilation ; il doit faire retomber sur le suivant.
 */
export interface StripeErrorShape {
  /** Le type rendu par l'API (`invalid_request_error`, `rate_limit_error`, …). */
  readonly rawType?: string
  /** Le **nom de classe** du SDK (`StripeRateLimitError`). Ce n'est pas `rawType`. */
  readonly type?: string
  readonly statusCode?: number
  /**
   * L'erreur sous-jacente, quand le SDK n'a pas eu de réponse.
   *
   * C'est le seul endroit où un délai dépassé se distingue d'une panne réseau :
   * les deux rendent `StripeConnectionError`, sans `rawType` ni `statusCode`.
   *
   * **Le marqueur est `detail.code`, pas `detail.name`**, et la nuance a coûté
   * un rouge : `HttpClient.makeTimeoutError()` fabrique un `TypeError` dont le
   * `name` reste « TypeError » et dont `code` **et** `message` valent
   * `ETIMEDOUT` (relevé dans `esm/net/HttpClient.js`, l. 19-21). Lire `name`
   * n'aurait jamais correspondu, en silence, et tout délai dépassé se serait
   * journalisé comme une panne de fournisseur.
   */
  readonly detail?: unknown
}

/** Le code que le SDK pose sur son erreur de délai dépassé. */
const TIMEOUT_CODE = 'ETIMEDOUT'

/** Le type rendu par l'API du fournisseur, quand il y en a un. */
const BY_RAW_TYPE: Readonly<Record<string, PaymentsErrorCode>> = {
  invalid_request_error: 'invalid_request',
  card_error: 'invalid_request',
  idempotency_error: 'invalid_request',
  invalid_request: 'invalid_request',
  authentication_error: 'unauthorized',
  rate_limit_error: 'rate_limited',
  rate_limit: 'rate_limited',
  api_error: 'provider_unavailable',
  temporary_session_expired: 'provider_unavailable',
}

/** Le nom de classe, quand le SDK a fabriqué l'erreur sans réponse de l'API. */
const BY_CLASS: Readonly<Record<string, PaymentsErrorCode>> = {
  StripeInvalidRequestError: 'invalid_request',
  StripeCardError: 'invalid_request',
  StripeIdempotencyError: 'invalid_request',
  StripeAuthenticationError: 'unauthorized',
  StripePermissionError: 'unauthorized',
  StripeSignatureVerificationError: 'invalid_signature',
  StripeRateLimitError: 'rate_limited',
  RateLimitError: 'rate_limited',
  StripeAPIError: 'provider_unavailable',
  StripeConnectionError: 'provider_unavailable',
  TemporarySessionExpiredError: 'provider_unavailable',
}

/**
 * Repli sur le code HTTP quand ni le type ni la classe ne sont connus.
 *
 * Une panne inconnue retombe sur `provider_unavailable`, **jamais** sur
 * « définitif » : traiter l'inconnu comme définitif supprimerait la reprise
 * exactement quand elle sert.
 */
const fromStatus = (statusCode: number | undefined): PaymentsErrorCode => {
  if (statusCode === undefined || statusCode >= 500) {
    return 'provider_unavailable'
  }

  if (statusCode === 429) {
    return 'rate_limited'
  }

  if (statusCode === 401 || statusCode === 403) {
    return 'unauthorized'
  }

  return statusCode === 404 ? 'not_found' : 'invalid_request'
}

const timedOut = (detail: unknown): boolean => {
  if (typeof detail !== 'object' || detail === null) {
    return false
  }

  const { code, message } = detail as { code?: unknown; message?: unknown }

  return code === TIMEOUT_CODE || message === TIMEOUT_CODE
}

export function classifyStripeError(error: StripeErrorShape): PaymentsErrorCode {
  if (timedOut(error.detail)) {
    return 'timeout'
  }

  const byRawType = error.rawType === undefined ? undefined : BY_RAW_TYPE[error.rawType]

  if (byRawType !== undefined) {
    return byRawType
  }

  const byClass = error.type === undefined ? undefined : BY_CLASS[error.type]

  return byClass ?? fromStatus(error.statusCode)
}

/**
 * Ce qui se rejoue, et rien d'autre (`docs/reliability.md` §3).
 *
 * Écrit en positif : ajouter un code oblige à dire de quel côté il tombe, et
 * l'exhaustivité de `PaymentsErrorCode` le rappelle au compilateur.
 */
export function isTransientPaymentsError(code: PaymentsErrorCode): boolean {
  return code === 'timeout' || code === 'provider_unavailable' || code === 'rate_limited'
}

export interface BackoffPolicy {
  readonly baseMs: number
  readonly maxMs: number
  /** Injecté : une attente aléatoire non injectée est une attente non testable. */
  readonly random: () => number
}

/**
 * Recul exponentiel **avec dispersion**, plafonné — la même forme que
 * `@repo/adapter-resend`, et pour la même raison : sans dispersion, mille
 * instances qui échouent sur la même panne rejouent à la même milliseconde et
 * achèvent le fournisseur au moment où il se relève.
 *
 * `attempt` vaut 1 pour la première reprise.
 */
export function backoffDelayMs(attempt: number, policy: BackoffPolicy): number {
  const exponential = Math.min(policy.maxMs, policy.baseMs * 2 ** (attempt - 1))

  return Math.round(exponential / 2 + policy.random() * (exponential / 2))
}

/**
 * Ce qu'un message de fournisseur a le droit de laisser passer
 * (`docs/security.md` §5).
 *
 * Mesuré : sur une réponse 400 réelle, le SDK rend
 * « No such price: price_x (key sk_test_… used, customer cus_9, url
 * https://checkout.stripe.com/c/pay/cs_test_secret) ». Trois fuites dans une
 * seule phrase — une clé, un identifiant de client, une URL de session signée.
 *
 * **Ce qui est retiré**, et c'est la liste de ce qui a été balayé sur ce
 * message-là et sur les formes que le fournisseur documente : les clés
 * (`sk_`, `rk_`, `pk_`, `whsec_`), les URL, et les identifiants d'objets qui
 * désignent une personne ou une session (`cus_`, `sub_`, `cs_`, `si_`, `pi_`,
 * `in_`, `ch_`, `re_`, `seti_`, `bps_`). Ce qui **reste** : les identifiants de
 * catalogue (`price_`, `prod_`), qui ne désignent personne et sans lesquels le
 * message ne diagnostique plus rien.
 */
const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:sk|rk|pk|whsec)_[A-Za-z0-9_-]+/g, '[clé]'],
  [/https?:\/\/\S+/g, '[url]'],
  [/\b(?:cus|sub|cs|si|pi|in|ch|re|seti|bps)_[A-Za-z0-9]+/g, '[id]'],
]

/** Un message plus long que ça ne diagnostique plus rien : il remplit un journal. */
const MAX_MESSAGE_LENGTH = 300

export function sanitize(message: string): string {
  const redacted = REDACTIONS.reduce(
    (current, [pattern, replacement]) => current.replaceAll(pattern, replacement),
    message,
  )

  return redacted.length <= MAX_MESSAGE_LENGTH
    ? redacted
    : `${redacted.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
}
