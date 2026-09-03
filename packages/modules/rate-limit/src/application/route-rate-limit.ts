import type { RouteRateLimitGuard, RouteRateLimitVerdict } from '@repo/core'
import type { RateLimitBucketRequest, RateLimiter, RateLimitLogger } from '@repo/ports'

import type { RateLimitPolicies } from '../domain/rate-limit-config'
import {
  callerBucketKey,
  clientIdentifierOf,
  subjectBucketKey,
  subjectOfBody,
  subjectOfCookies,
} from '../domain/rate-limit-rules'

/**
 * **Le garde de limitation branché au répartiteur** (s28, ADR 050).
 *
 * Il tient la **double limitation** du critère 1 : un seau par appelant, un seau
 * par compte visé. C'est le second qui compte.
 *
 * Un seuil par IP seule est facile à écrire, il passe tous les tests évidents,
 * et il ne protège pas de l'attaque réelle : le bourrage d'identifiants
 * **distribué**. Dix mille adresses, un essai chacune, sur le même compte —
 * chaque IP reste sous son seuil et le compte tombe. `x-forwarded-for` étant un
 * en-tête que l'appelant écrit lui-même, le seau par IP est une gêne, pas une
 * barrière. Le seau par compte, lui, ne dépend de rien que l'attaquant contrôle.
 *
 * **Les deux seaux avancent ensemble**, en une seule consommation. S'arrêter au
 * premier dépassement laisserait le seau du compte immobile, et un attaquant qui
 * sature volontairement son propre seau d'appelant rendrait le bourrage
 * distribué invisible au compteur.
 */

/**
 * Ce que le magasin indisponible produit : **un refus**, et il faut dire
 * pourquoi c'est une exception au socle de fiabilité.
 *
 * `docs/reliability.md` dit qu'un tiers absent dégrade et ne casse pas. Mais ce
 * magasin n'est pas un tiers : c'est la base de l'application. Si elle est
 * absente, la connexion ne fonctionne pas davantage — les sessions y vivent.
 * Refuser ne coûte donc **aucune disponibilité réelle**, alors que laisser
 * passer ferait disparaître la protection exactement au moment où l'application
 * est fragile, c'est-à-dire au moment où quelqu'un a le plus de raisons
 * d'essayer. C'est écrit ici, et dans l'ADR 050, parce que c'est une exception
 * à un socle : l'appliquer par réflexe aurait donné l'inverse.
 */
const RETRY_AFTER_WHEN_STORE_IS_DOWN = 30

/**
 * **À quelle fréquence le garde récupère les fenêtres closes.**
 *
 * Le balayage vivait uniquement dans `marketing` et `billing` — deux modules
 * **optionnels**. Les couper, ce que la configuration autorise, laissait
 * `rate_limit_window` grandir sans borne, alors que la clé d'une ligne dérive
 * d'un en-tête que l'appelant écrit lui-même : n'importe quel anonyme y insérait
 * un nombre illimité de lignes permanentes (constat M1 de la revue, et constat
 * F1 de celle de s11 réintroduit sur 31 points d'entrée).
 *
 * Le garde est sur le chemin de **toute** route limitée : il n'existe donc plus
 * de configuration où personne ne récupère. Dix minutes, et pas à chaque
 * requête : la suppression est indexée, mais la payer à chaque passage public
 * coûterait une instruction de plus pour ne rien trouver.
 */
const SWEEP_INTERVAL_SECONDS = 600

export interface RouteRateLimitGuardOptions {
  readonly limiter: RateLimiter
  readonly policies: RateLimitPolicies
  /** L'instant de référence. Injecté : le domaine aligne les fenêtres dessus. */
  readonly now: () => Date
  readonly log: RateLimitLogger
  /** Voir `SWEEP_INTERVAL_SECONDS`. Injectable pour que le rythme soit éprouvable. */
  readonly sweepIntervalSeconds?: number
}

/**
 * Lit le corps **sans le consommer**.
 *
 * `Request` ne se lit qu'une fois : sans le clone, le gestionnaire de la route
 * recevrait un corps déjà vidé, et chaque connexion échouerait pour une raison
 * qui n'a rien à voir avec la limitation. Un corps illisible vaut `null`, que le
 * gestionnaire refusera de toute façon.
 */
const submittedBody = async (request: Request): Promise<unknown> => {
  const contentType = request.headers.get('content-type') ?? ''

  try {
    const copy = request.clone()

    if (contentType.includes('application/x-www-form-urlencoded')) {
      return Object.fromEntries((await copy.formData()).entries())
    }

    return await copy.json()
  } catch {
    return null
  }
}

export function createRouteRateLimitGuard(
  options: RouteRateLimitGuardOptions,
): RouteRateLimitGuard {
  const { limiter, policies, now, log } = options
  const sweepIntervalMs = (options.sweepIntervalSeconds ?? SWEEP_INTERVAL_SECONDS) * 1_000

  /**
   * Le dernier balayage **de ce processus**. Ce n'est pas un compteur : rien de
   * correct n'en dépend, il ne fait qu'espacer les suppressions. Deux instances
   * qui balaient toutes deux ne se gênent pas — la suppression est idempotente,
   * et une fenêtre close le reste.
   */
  let lastSweptAt: number | null = null

  const sweepIfDue = (instant: Date): void => {
    if (lastSweptAt !== null && instant.getTime() - lastSweptAt < sweepIntervalMs) {
      return
    }

    lastSweptAt = instant.getTime()

    // Pas attendu : la récupération ne doit pas retarder la requête qui la
    // déclenche. Le port ne lève jamais, il n'y a donc rien à rattraper — et
    // son échec est déjà journalisé par l'implémentation.
    void limiter.sweep(instant)
  }

  return async ({ route, request }): Promise<RouteRateLimitVerdict> => {
    const policyName = route.rateLimit?.policy ?? 'default'
    const policy = policies[policyName] ?? policies['default']

    /**
     * Une politique absente **et** pas de `default` : la configuration n'a pas
     * été validée. Refuser plutôt que laisser passer — c'est la même règle que
     * pour le magasin absent, et `parseRateLimitPolicies` l'a normalement déjà
     * refusée au démarrage.
     */
    if (policy === undefined) {
      return { allowed: false, retryAfterSeconds: RETRY_AFTER_WHEN_STORE_IS_DOWN }
    }

    const client = clientIdentifierOf(request.headers)
    const buckets: RateLimitBucketRequest[] = [
      {
        key: callerBucketKey(route.path, client),
        max: policy.maxPerClient,
        windowSeconds: policy.windowSeconds,
      },
    ]

    const subjectField = route.rateLimit?.subjectField
    const subjectCookies = route.rateLimit?.subjectCookies
    let subjectBucket: string | null = null

    if (
      policy.maxPerSubject !== null &&
      (subjectField !== undefined || subjectCookies !== undefined)
    ) {
      /**
       * **Le cookie prime sur le corps**, quand la route déclare les deux : il
       * est posé et signé par le serveur, là où le corps vient de l'appelant.
       * Une route ne déclare de toute façon qu'un des deux aujourd'hui.
       */
      if (subjectCookies !== undefined) {
        const found = subjectOfCookies(request.headers.get('cookie'), subjectCookies)

        /**
         * **Plusieurs cookies déclarés présents : on refuse, on ne devine pas.**
         *
         * La bibliothèque n'en lira qu'un, et lequel dépend de sa configuration.
         * Choisir rouvrirait le contournement par leurre que la re-revue a
         * mesuré. Un navigateur légitime n'envoie jamais les deux : ce refus ne
         * coûte rien à personne, et il coûte tout à l'attaquant.
         */
        if (found.kind === 'ambiguous') {
          log({
            event: 'rate_limit.exceeded',
            route: route.path,
            method: request.method,
            client,
            bucket: 'subject',
            retryAfterSeconds: policy.windowSeconds,
          })

          return { allowed: false, retryAfterSeconds: policy.windowSeconds }
        }

        if (found.kind === 'found') {
          subjectBucket = subjectBucketKey(route.path, found.value)
        }
      } else {
        const subject = subjectOfBody(await submittedBody(request), subjectField as string)

        if (subject !== null) {
          subjectBucket = subjectBucketKey(route.path, subject)
        }
      }

      if (subjectBucket !== null) {
        buckets.push({
          key: subjectBucket,
          max: policy.maxPerSubject,
          windowSeconds: policy.windowSeconds,
        })
      }
    }

    const instant = now()

    sweepIfDue(instant)

    const result = await limiter.consume({ buckets, now: instant })

    if (!result.ok) {
      log({
        event: 'rate_limit.store_unavailable',
        route: route.path,
        method: request.method,
        client,
        bucket: null,
        retryAfterSeconds: RETRY_AFTER_WHEN_STORE_IS_DOWN,
      })

      return { allowed: false, retryAfterSeconds: RETRY_AFTER_WHEN_STORE_IS_DOWN }
    }

    const exceeded = result.buckets.find((bucket) => bucket.exceeded)

    if (exceeded === undefined) {
      return { allowed: true, retryAfterSeconds: 0 }
    }

    /**
     * **Le dépassement est journalisé avec l'IP et la route** (critère 6).
     *
     * Le magasin condense, le journal non : les deux règles diffèrent, et c'est
     * assumé. Une ligne de compteur survit à l'incident et n'a aucune raison de
     * porter une adresse ; une ligne de journal existe pour l'expliquer, et sans
     * l'IP ni la route elle n'explique rien. Le compte visé, lui, n'y figure
     * pas : `bucket` dit **lequel** des deux seaux a refusé, jamais sa valeur.
     */
    log({
      event: 'rate_limit.exceeded',
      route: route.path,
      method: request.method,
      client,
      bucket: exceeded.key === subjectBucket ? 'subject' : 'client',
      retryAfterSeconds: exceeded.retryAfterSeconds,
    })

    return { allowed: false, retryAfterSeconds: exceeded.retryAfterSeconds }
  }
}
