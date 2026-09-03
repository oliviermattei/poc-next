import {
  dispatchModuleRequest,
  type DispatchOptions,
  type ModuleRegistry,
  type RouteRateLimitGuard,
} from '@repo/core'
import type {
  ConsumeRateLimitInput,
  ConsumeRateLimitResult,
  RateLimiter,
  RateLimitLogRecord,
} from '@repo/ports'
import { exceedsRateLimit, retryAfterSecondsOf, windowStartOf } from '@repo/module-rate-limit'

/**
 * **La neutralisation de la limitation, par injection et par elle seule**
 * (critère 8 de s28).
 *
 * Ces doubles vivent dans `tests/fixtures/`, pas dans un paquet publié, et
 * c'est le point : aucun point de composition de l'application ne peut les
 * atteindre. Il n'existe donc **aucune variable d'environnement** capable
 * d'éteindre la limitation en production, et `tests/rate-limiting.test.ts` le
 * vérifie plutôt que de l'affirmer : le chemin de la limitation est **dérivé du
 * disque** et n'y lit aucun environnement, et le nom d'un interrupteur est
 * cherché dans **toutes** les sources de production.
 */

/**
 * Un garde qui laisse tout passer.
 *
 * C'est ce que branchent les suites qui n'éprouvent pas la limitation : le
 * répartiteur est fail-closed, donc sans garde toute route publique répondrait
 * 429 et chaque suite mesurerait la limitation au lieu de son sujet.
 */
export const allowAllRateLimit: RouteRateLimitGuard = async () => ({
  allowed: true,
  retryAfterSeconds: 0,
})

/** Un garde qui refuse tout, pour éprouver le refus chez un appelant. */
export const refuseAllRateLimit: RouteRateLimitGuard = async () => ({
  allowed: false,
  retryAfterSeconds: 42,
})

/**
 * Un compteur en mémoire — **un vrai compteur**, pas un double qui dit oui.
 *
 * Il applique la même règle de fenêtre et de seuil que l'implémentation
 * PostgreSQL, ce qui permet d'éprouver la double limitation au répartiteur sans
 * payer dix mille allers-retours en base. Ce qu'il ne peut pas prouver — le
 * partage entre instances — est prouvé contre un vrai PostgreSQL, avec deux
 * connexions distinctes.
 */
export function createMemoryRateLimiter(): RateLimiter {
  const windows = new Map<string, { start: number; hits: number }>()

  return {
    consume: async (input: ConsumeRateLimitInput): Promise<ConsumeRateLimitResult> => ({
      ok: true,
      buckets: input.buckets.map((bucket) => {
        const start = windowStartOf(input.now, bucket.windowSeconds)
        const previous = windows.get(bucket.key)
        const hits =
          previous !== undefined && previous.start === start.getTime() ? previous.hits + 1 : 1

        windows.set(bucket.key, { start: start.getTime(), hits })

        return {
          key: bucket.key,
          hits,
          max: bucket.max,
          exceeded: exceedsRateLimit(hits, bucket.max),
          retryAfterSeconds: retryAfterSecondsOf(input.now, start, bucket.windowSeconds),
        }
      }),
    }),
    sweep: async () => ({ ok: true, removed: 0 }),
  }
}

/** Un magasin qui ne répond pas — pour éprouver le refus, jamais le passage. */
export const unavailableRateLimiter: RateLimiter = {
  consume: async () => ({
    ok: false,
    error: { code: 'store_unavailable', message: 'magasin injoignable' },
  }),
  sweep: async () => ({
    ok: false,
    error: { code: 'store_unavailable', message: 'magasin injoignable' },
  }),
}

/** Un journal qui garde ce qu'on lui écrit, pour l'assertionner. */
export function recordingRateLimitLog(): {
  readonly records: RateLimitLogRecord[]
  readonly log: (record: RateLimitLogRecord) => void
} {
  const records: RateLimitLogRecord[] = []

  return { records, log: (record) => records.push(record) }
}

/**
 * **Le répartiteur, avec la limitation neutralisée** — pour les suites qui
 * mesurent autre chose.
 *
 * `dispatchModuleRequest` est **fail-closed** sur la limitation : sans garde,
 * toute route publique répond 429. C'est ce qui rend un oubli de câblage
 * immédiatement visible en production. La contrepartie est ici : une suite qui
 * éprouve la connexion, le site public ou le checkout doit dire qu'elle ne
 * mesure pas la limitation, et elle le dit en **injectant** un garde permissif.
 *
 * C'est la seule neutralisation qui existe dans ce dépôt (critère 8 de s28), et
 * elle n'est atteignable que d'ici. La limitation elle-même est éprouvée dans
 * `tests/rate-limiting.test.ts`, avec le vrai répartiteur et un vrai compteur.
 */
export const dispatchAllowingRateLimit = async (
  registry: ModuleRegistry,
  request: Request,
  options: DispatchOptions = {},
): Promise<Response> =>
  await dispatchModuleRequest(registry, request, {
    ...options,
    rateLimit: options.rateLimit ?? allowAllRateLimit,
  })
