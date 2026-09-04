import type { RateLimiter } from '@repo/ports'

import type { CheckoutThrottle } from '../application/ports'

/**
 * **Le compteur de ce module, branché sur le port partagé** (s28).
 *
 * Il remplace `createDrizzleCheckoutThrottle`, qui écrivait dans
 * `billing_checkout_throttle`. Cette table **n'est plus écrite** ; elle reste en
 * place, inerte. L'en-tête de son `pgTable` porte la consigne d'origine et dit
 * pourquoi elle n'a pas été suivie — en deux mots : `docs/reliability.md` impose
 * de cesser d'écrire **avant** de retirer une table, et s27 a mesuré que le
 * basculement d'un déploiement n'est pas instantané, si bien que la version
 * encore en ligne l'écrit pendant la bascule. C'est une story ultérieure
 * (ADR 050).
 *
 * **Ce que ce module garde** : sa règle des deux seaux, dont le seau global qui
 * **dégrade** — au-delà du seuil, le tunnel anonyme n'est plus ouvert et le
 * visiteur repart par la connexion (constat F3 de la revue de s24). Le
 * répartiteur ne connaît que « autorisé » et « 429 » ; il ne sait pas exprimer
 * cette dégradation. Seul le **compteur** a convergé.
 *
 * **Un magasin muet refuse** : `hit` rend un compte supérieur à tout seuil.
 * Même décision qu'au répartiteur, et même raison (ADR 050).
 */
const REFUSE_WHEN_STORE_IS_DOWN = Number.MAX_SAFE_INTEGER

export function createSharedCheckoutThrottle(input: {
  readonly limiter: RateLimiter
  readonly windowSeconds: number
}): CheckoutThrottle {
  return {
    // `max` vient du **seau**, pas de la construction : les deux seaux de cette
    // route n'ont pas le même seuil (constat m5 de la re-revue).
    hit: async ({ bucket, max, windowStart }) => {
      const result = await input.limiter.consume({
        buckets: [{ key: bucket, max, windowSeconds: input.windowSeconds }],
        // `windowStart` est déjà aligné par le domaine du module, sur la même
        // durée : le port en dérive exactement la même fenêtre.
        now: windowStart,
      })

      return result.ok ? (result.buckets[0]?.hits ?? 1) : REFUSE_WHEN_STORE_IS_DOWN
    },

    sweep: async (instant) => {
      /**
       * **Ce module ne décide plus de ce qui est clos** (constat C1 de la
       * revue) : chaque ligne du magasin partagé porte sa propre échéance, et
       * cet instant ne dit que quand on regarde. Un instant passé retarde la
       * récupération ; il n'efface jamais un seau ouvert.
       */
      const result = await input.limiter.sweep(instant)

      return result.ok ? result.removed : 0
    },
  }
}
