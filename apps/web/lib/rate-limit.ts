import { getDatabase } from '@repo/db'
import {
  assertCaptchaIsServable,
  assertPoliciesCoverRoutes,
  createDrizzleRateLimiter,
  createRouteRateLimitGuard,
  parseRateLimitPolicies,
  type RateLimitPolicies,
} from '@repo/module-rate-limit'
import type { RateLimiter, RateLimitLogRecord } from '@repo/ports'
import type { RouteRateLimitGuard } from '@repo/core'

import {
  captcha as declaredCaptcha,
  contentSecurityPolicySources,
  rateLimitPolicies as declaredPolicies,
} from '../../../config/security'
import { moduleRegistry } from './module-registry'

/**
 * **Le point de composition de la limitation de débit** (s28, ADR 050) — le
 * seul fichier de l'application qui connaisse `@repo/module-rate-limit`.
 *
 * Il fait trois choses, et pas une de plus :
 *
 * 1. il **valide** les seuils de `config/security.ts` au démarrage, comme
 *    `lib/feature-gates.ts` valide les fonctionnalités réservées ;
 * 2. il **construit** le garde que `dispatchModuleRequest` appelle sur chaque
 *    route limitée ;
 * 3. il **journalise** les dépassements.
 *
 * **Il n'existe aucun moyen de l'éteindre.** Ni drapeau, ni variable
 * d'environnement, ni valeur sentinelle : un seuil nul est refusé au démarrage
 * plutôt qu'interprété comme « aucune limite » (critère 8). La seule
 * neutralisation est l'**injection**, et elle n'est possible que dans un test,
 * qui construit son propre garde. C'est la leçon que ce dépôt a payée deux fois
 * — `SKIP_ENV_VALIDATION` traversant un clone (s26), puis manquant de traverser
 * une image (s27) : une variable qui éteint une protection **est** une porte.
 */

let policies: RateLimitPolicies | null = null

/**
 * Les seuils validés. Mémorisés : c'est du code, ils ne changent pas d'un appel
 * à l'autre, et la limitation est sur le chemin de **chaque** requête publique.
 */
export function rateLimitPolicies(): RateLimitPolicies {
  policies ??= parseRateLimitPolicies(declaredPolicies)

  return policies
}

/**
 * La garde de démarrage, **trois moitiés** — comme celle des fonctionnalités
 * réservées, appelée par `lib/startup.ts` :
 *
 * - les seuils ont une forme valide et `default` existe ;
 * - aucune route du registre ne nomme une politique inconnue, ce qui la
 *   laisserait servie **sans limite** ;
 * - le captcha, s'il est activé, a son origine déclarée dans la politique de
 *   sécurité du contenu — sans quoi le navigateur bloquerait le widget et le
 *   formulaire se fermerait sans un mot.
 */
export function assertRateLimitConfiguration(): void {
  const parsed = rateLimitPolicies()

  assertPoliciesCoverRoutes({ policies: parsed, routes: moduleRegistry.routes })
  assertCaptchaIsServable(declaredCaptcha, [
    ...contentSecurityPolicySources.frame,
    ...contentSecurityPolicySources.script,
  ])
}

/**
 * Le journal d'un dépassement (critère 6) : **l'IP et la route**, en clair.
 *
 * Le magasin condense, le journal non — les deux règles diffèrent sciemment, et
 * `packages/modules/rate-limit/AGENTS.md` le dit. La forme du message est fermée
 * par le type `RateLimitLogRecord` : il n'y a aucun champ où mettre un corps de
 * requête, un mot de passe, un jeton ou le compte visé.
 */
const logRateLimit = (record: RateLimitLogRecord): void => {
  console.warn(
    `[${record.event}] ${record.method} ${record.route} client=${record.client} ` +
      `bucket=${record.bucket ?? 'n/a'} retry_after=${record.retryAfterSeconds}s`,
  )
}

let limiter: RateLimiter | null = null
let guard: RouteRateLimitGuard | null = null

/**
 * Le compteur lui-même, pour les modules qui gardent une **règle** à eux — le
 * site public et sa dégradation, le checkout invité et la sienne. Ils comptent
 * désormais ici, et n'écrivent plus dans leur propre table (ADR 050).
 */
export function appRateLimiter(): RateLimiter {
  limiter ??= createDrizzleRateLimiter({ db: getDatabase().db })

  return limiter
}

/**
 * **Le compteur, ouvert au premier comptage et pas avant.**
 *
 * Le fichier de route appelle `rateLimitGuard()` sur **chaque** requête, y
 * compris celles qu'aucune route ne satisfait. Ouvrir la base à ce moment-là
 * ferait ouvrir une connexion pour répondre 404 sur un chemin inconnu — c'est
 * la propriété que `tests/module-off.test.ts` et `tests/organizations.test.ts`
 * mesurent depuis s15, et cette indirection est ce qui la préserve. Le
 * répartiteur, lui, n'appelle le garde qu'après avoir apparié une route.
 */
const deferredLimiter: RateLimiter = {
  consume: async (input) => await appRateLimiter().consume(input),
  sweep: async (before) => await appRateLimiter().sweep(before),
}

/**
 * Le garde branché au répartiteur.
 *
 * Il ne lit ni la base ni l'environnement tant qu'aucune route limitée n'est
 * atteinte : construire à l'import ouvrirait la base pendant `pnpm build`, qui
 * n'a ni `DATABASE_URL` ni raison d'en avoir une.
 */
export function rateLimitGuard(): RouteRateLimitGuard {
  guard ??= createRouteRateLimitGuard({
    limiter: deferredLimiter,
    policies: rateLimitPolicies(),
    now: () => new Date(),
    log: logRateLimit,
  })

  return guard
}
