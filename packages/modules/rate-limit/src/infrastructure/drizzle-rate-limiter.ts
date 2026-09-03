import { createHash } from 'node:crypto'

import type {
  ConsumeRateLimitInput,
  ConsumeRateLimitResult,
  RateLimitBucketState,
  RateLimiter,
  SweepRateLimitResult,
} from '@repo/ports'
import { lte, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { exceedsRateLimit, retryAfterSecondsOf, windowStartOf } from '../domain/rate-limit-rules'
import type { rateLimitSchema} from '../schema';
import { rateLimitWindow } from '../schema'

/**
 * **L'implémentation PostgreSQL du port `RateLimiter`** (s28, ADR 050) — la
 * seule, comme le veut la règle « une implémentation par port ».
 *
 * Le magasin est la base de l'application elle-même. C'est ce qui rend
 * défendable le choix de **refuser quand il est indisponible** (voir plus bas) :
 * il n'y a pas de tiers à dégrader, il y a la base sans laquelle rien d'autre ne
 * fonctionne.
 */

export type RateLimitDatabase = NodePgDatabase<typeof rateLimitSchema>

/**
 * La clé n'entre jamais en clair : elle porte une adresse IP ou une adresse
 * email, et le magasin n'a aucune raison de les conserver.
 */
const digestOf = (key: string): string => createHash('sha256').update(key).digest('hex')

/**
 * **Toute échéance est explicite** (`docs/reliability.md` §3).
 *
 * Sans elle, une base saturée ne rend pas une erreur : elle ne rend rien, et la
 * limitation — qui est sur le chemin de chaque requête publique — fait attendre
 * l'application entière. Deux secondes : au-delà, un compteur n'a plus de sens,
 * la requête qu'il protège a déjà expiré côté client.
 */
const DEFAULT_TIMEOUT_MS = 2_000

class RateLimitTimeout extends Error {}

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new RateLimitTimeout(`Le magasin n’a pas répondu en ${timeoutMs} ms.`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

/**
 * Le message porté au journal — **assaini** (`docs/security.md` §5).
 *
 * Le message d'un pilote de base cite volontiers la requête, donc la clé, donc
 * le condensat, et parfois la chaîne de connexion. Rien de tout cela ne sort
 * d'ici : seul le nom de la classe d'erreur, qui dit ce qui a cassé sans dire
 * sur quoi.
 */
const sanitisedCause = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : 'unknown'

export interface DrizzleRateLimiterOptions {
  readonly db: RateLimitDatabase
  readonly timeoutMs?: number
}

export function createDrizzleRateLimiter(options: DrizzleRateLimiterOptions): RateLimiter {
  const { db } = options
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    consume: async (input: ConsumeRateLimitInput): Promise<ConsumeRateLimitResult> => {
      if (input.buckets.length === 0) {
        return { ok: true, buckets: [] }
      }

      /**
       * Un seuil nul ou négatif, une fenêtre nulle : **définitif**, pas une
       * panne. Le rejouer ne le réparerait pas (`docs/reliability.md` §3), et
       * le laisser passer ferait d'une configuration fautive une absence
       * silencieuse de limitation.
       */
      const invalid = input.buckets.find(
        (bucket) =>
          !Number.isFinite(bucket.max) ||
          bucket.max < 1 ||
          !Number.isFinite(bucket.windowSeconds) ||
          bucket.windowSeconds < 1,
      )

      if (invalid !== undefined) {
        return {
          ok: false,
          error: {
            code: 'invalid_bucket',
            message:
              'Seau de limitation invalide : le seuil et la fenêtre doivent être des entiers ' +
              'positifs. Le seuil vient de config/security.ts.',
          },
        }
      }

      /**
       * **Dédoublonnage avant l'écriture.** PostgreSQL refuse qu'un même
       * `ON CONFLICT DO UPDATE` touche deux fois la même ligne dans une seule
       * instruction — deux seaux de clé identique feraient donc échouer la
       * requête entière, et l'échec d'un compteur est un refus (voir
       * `dispatchModuleRequest`). Ce cas n'est pas théorique : rien n'interdit
       * à un appelant de déclarer deux fois le même seau.
       */
      const requested = new Map(input.buckets.map((bucket) => [bucket.key, bucket]))

      const rows = [...requested.values()].map((bucket) => {
        const windowStart = windowStartOf(input.now, bucket.windowSeconds)

        return {
          key: bucket.key,
          digest: digestOf(bucket.key),
          windowStart,
          /**
           * **L'échéance est portée par la ligne**, pas déduite au balayage : le
           * magasin est partagé et les seaux n'ont pas la même durée (constat C1
           * de la revue). Sans cette valeur, un balayage ne peut pas distinguer
           * une fenêtre close d'une fenêtre longue encore ouverte.
           */
          expiresAt: new Date(windowStart.getTime() + bucket.windowSeconds * 1_000),
          max: bucket.max,
          windowSeconds: bucket.windowSeconds,
        }
      })

      try {
        /**
         * **Une seule instruction**, donc atomique et partagée entre instances
         * (`docs/security.md` §7).
         *
         * Lire puis écrire laisserait deux instances observer le même compte et
         * le dépasser toutes les deux ; c'est le mode d'échec que le socle de
         * fiabilité appelle « une simple vérification préalable ». Tous les
         * seaux de la requête avancent **ensemble** : s'arrêter au premier
         * dépassement laisserait le seau par compte visé immobile, et un
         * attaquant qui sature volontairement son propre seau d'appelant
         * rendrait le bourrage distribué invisible.
         *
         * Le `case` fait la bascule de fenêtre : même fenêtre, on incrémente ;
         * fenêtre différente, on repart à un.
         */
        const written = await withTimeout(
          db
            .insert(rateLimitWindow)
            .values(
              rows.map((row) => ({
                bucket: row.digest,
                windowStartedAt: row.windowStart,
                expiresAt: row.expiresAt,
                hits: 1,
              })),
            )
            .onConflictDoUpdate({
              target: rateLimitWindow.bucket,
              set: {
                hits: sql`case when ${rateLimitWindow.windowStartedAt} = excluded.window_started_at then ${rateLimitWindow.hits} + 1 else 1 end`,
                windowStartedAt: sql`excluded.window_started_at`,
                expiresAt: sql`excluded.expires_at`,
              },
            })
            .returning({ bucket: rateLimitWindow.bucket, hits: rateLimitWindow.hits }),
          timeoutMs,
        )

        const hitsByDigest = new Map(written.map((row) => [row.bucket, row.hits]))

        const states: RateLimitBucketState[] = rows.map((row) => {
          const hits = hitsByDigest.get(row.digest) ?? 1

          return {
            key: row.key,
            hits,
            max: row.max,
            exceeded: exceedsRateLimit(hits, row.max),
            retryAfterSeconds: retryAfterSecondsOf(input.now, row.windowStart, row.windowSeconds),
          }
        })

        return { ok: true, buckets: states }
      } catch (error) {
        /**
         * **Aucune méthode ne lève** : l'échec est une valeur, et le
         * compilateur oblige l'appelant à l'écarter. Ce qu'il en fait est écrit
         * ailleurs, et c'est une décision — le répartiteur **refuse** (ADR 050).
         */
        return {
          ok: false,
          error: {
            code: 'store_unavailable',
            message: `Le magasin de limitation n’a pas répondu (${sanitisedCause(error)}).`,
          },
        }
      }
    },

    sweep: async (now: Date): Promise<SweepRateLimitResult> => {
      try {
        /**
         * Une fenêtre close n'a plus de lecteur : `consume` ne consulte que la
         * fenêtre en cours, et repart à un dès qu'elle change. Ces lignes ne
         * servent donc plus à rien — les garder ne fait qu'entretenir un
         * condensat d'adresse pour l'éternité.
         *
         * **La comparaison porte sur l'échéance de chaque ligne**, indexée pour
         * cela, et non sur une borne que l'appelant choisirait. C'est ce qui
         * rend l'appel sûr depuis un module qui ne connaît que sa propre fenêtre
         * (constat C1 de la revue) : un seau de 3600 s survit au balayage
         * déclenché par une fenêtre de 600 s, parce que c'est **sa** fenêtre à
         * lui qui décide.
         */
        const removed = await withTimeout(
          db
            .delete(rateLimitWindow)
            .where(lte(rateLimitWindow.expiresAt, now))
            .returning({ bucket: rateLimitWindow.bucket }),
          timeoutMs,
        )

        return { ok: true, removed: removed.length }
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'store_unavailable',
            message: `Le balayage des fenêtres closes a échoué (${sanitisedCause(error)}).`,
          },
        }
      }
    },
  }
}
