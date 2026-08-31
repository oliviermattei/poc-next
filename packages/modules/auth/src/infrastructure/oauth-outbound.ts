import {
  classifyOutboundStatus,
  isTransientOutboundFailure,
  outboundBackoffMs,
  type OutboundFailure,
} from '../domain/outbound'

/**
 * **Les appels sortants du module, bornés** (`docs/reliability.md` §3).
 *
 * s12 ouvre les premiers appels sortants du module `auth` : trois par connexion
 * GitHub. Aucun n'était borné, et il n'y a **pas de défaut** — relevé dans le
 * paquet installé (`@better-fetch/fetch@1.3.1`, `getTimeout`) : le
 * `controller.abort()` n'est armé que `if (!options?.signal && options?.timeout)`,
 * et la bibliothèque d'authentification ne passe ni l'un ni l'autre. Un point de
 * terminaison de fournisseur qui pend tient donc la requête de rappel ouverte
 * sans borne applicative.
 *
 * Deux bornes, et il faut les deux :
 *
 * 1. **par appel**, ici : chaque requête que ce module émet porte un délai, et
 *    ses reprises reculent, dispersent et plafonnent ;
 * 2. **par requête entrante**, dans `better-auth-service.ts` : une échéance
 *    autour de `auth.handler` couvre ce que la bibliothèque appelle elle-même
 *    et que nous ne pouvons pas surcharger — l'échange de code de GitHub
 *    (`validateAuthorizationCode` ne lit aucun crochet d'options) et la
 *    vérification d'ID token de Google (JWKS, par `jose`).
 *
 * Ce que la borne 1 couvre, mesuré sur les fournisseurs déclarés par ce
 * module : les **deux** appels de profil de GitHub (`/user`, `/user/emails`),
 * par le crochet `options.getUserInfo` que `social-providers/github.mjs` lit
 * avant de faire quoi que ce soit. Elle ne couvre pas les deux appels nommés
 * ci-dessus, qui n'ont pas de crochet ; ceux-là n'ont que la borne 2.
 */

export interface OAuthOutboundPolicy {
  /** Délai d'un appel sortant. Au-delà, l'attente est abandonnée. */
  readonly timeoutMs?: number
  /**
   * Échéance de la requête de rappel entière.
   *
   * Elle borne ce que ce module ne peut pas borner appel par appel. Plus
   * généreuse que `timeoutMs` : elle doit laisser la place aux reprises.
   */
  readonly callbackDeadlineMs?: number
  readonly maxAttempts?: number
  readonly baseDelayMs?: number
  readonly maxDelayMs?: number
  /** Injectés : un recul et une dispersion non injectés ne sont pas testables. */
  readonly sleep?: (ms: number) => Promise<void>
  readonly random?: () => number
}

export const DEFAULT_OAUTH_TIMEOUT_MS = 10_000
export const DEFAULT_OAUTH_CALLBACK_DEADLINE_MS = 25_000
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 250
const DEFAULT_MAX_DELAY_MS = 2_000

/** Marqueur de course : distinct de toute valeur qu'un appel peut rendre. */
export const OUTBOUND_TIMED_OUT = Symbol('outbound-timed-out')

/**
 * Borne l'attente de l'appelant, quoi qu'il arrive en face.
 *
 * Le signal d'annulation ne suffit pas : il n'agit que sur un vrai `fetch`, et
 * ne dit rien d'une bibliothèque qui attend autre chose. La course, elle, rend
 * la main dans tous les cas. Contrepartie assumée, la même que celle de
 * l'adapter d'emails : la requête sous-jacente n'est pas **annulée**, elle est
 * **abandonnée** — ce que `docs/reliability.md` §3 exige est tenu (la requête
 * de l'appelant n'est jamais bloquée au-delà du délai), la socket vit sa vie
 * jusqu'à ce que Node la ferme.
 *
 * La promesse perdante est neutralisée : sans cela, un rejet arrivant après la
 * course remonterait en `unhandledRejection` et pourrait abattre le processus.
 */
export async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof OUTBOUND_TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const expiry = new Promise<typeof OUTBOUND_TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(OUTBOUND_TIMED_OUT), timeoutMs)
  })

  promise.catch(() => undefined)

  try {
    return await Promise.race([promise, expiry])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Un appel sortant borné et repris, ou `null` quand il a définitivement échoué.
 *
 * `null` plutôt qu'une exception : l'appelant est un crochet de la bibliothèque
 * dont le contrat rend déjà `null` pour « je n'ai pas pu lire ce profil », et
 * une exception y vaudrait refus de la même façon — mais sans laisser au module
 * le choix du message.
 */
export type BoundedFetch = (url: string, init?: RequestInit) => Promise<Response | null>

export function createBoundedOAuthFetch(policy: OAuthOutboundPolicy = {}): BoundedFetch {
  const timeoutMs = policy.timeoutMs ?? DEFAULT_OAUTH_TIMEOUT_MS
  const maxAttempts = policy.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const backoff = {
    baseMs: policy.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
    maxMs: policy.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
    random: policy.random,
  }
  const sleep =
    policy.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  const attemptOnce = async (
    url: string,
    init: RequestInit,
  ): Promise<Response | OutboundFailure> => {
    try {
      // Les deux moyens ensemble : le signal annule réellement la requête
      // quand `fetch` l'honore, la course garantit la borne quand il ne
      // l'honore pas.
      const outcome = await withDeadline(
        fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
        timeoutMs,
      )

      if (outcome === OUTBOUND_TIMED_OUT) {
        return 'timeout'
      }

      return outcome.ok ? outcome : classifyOutboundStatus(outcome.status)
    } catch (error) {
      return error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network'
    }
  }

  return async (url, init = {}) => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const outcome = await attemptOnce(url, init)

      if (outcome instanceof Response) {
        return outcome
      }

      // Un refus du fournisseur est **définitif** : le rejouer, c'est le faire
      // refuser trois fois et payer trois délais pour la même réponse.
      if (!isTransientOutboundFailure(outcome) || attempt === maxAttempts) {
        return null
      }

      await sleep(outboundBackoffMs(attempt, backoff))
    }

    return null
  }
}
