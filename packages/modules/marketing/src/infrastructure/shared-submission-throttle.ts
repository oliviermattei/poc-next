import type { RateLimiter } from '@repo/ports'

import type { SubmissionThrottle } from '../application/ports'

/**
 * **Le compteur de ce module, branché sur le port partagé** (s28).
 *
 * Il remplace `createDrizzleSubmissionThrottle`, qui écrivait dans
 * `public_form_throttle`. Cette table **n'est plus écrite** ; elle reste en
 * place, inerte, parce que le socle de fiabilité impose de cesser d'écrire avant
 * de supprimer et que la version encore en ligne l'écrit toujours pendant un
 * basculement. Sa suppression est une story ultérieure (ADR 050).
 *
 * **Ce que ce module garde, et pourquoi.** Sa règle à lui : deux seaux qui ne
 * disent pas la même chose — celui de l'appelant refuse, celui du formulaire
 * entier **dégrade** (il suspend l'envoi sortant sans refuser la soumission,
 * constat F2 de la revue de s11). Le répartiteur ne sait pas exprimer une
 * dégradation ; il ne connaît que « autorisé » et « 429 ». La règle reste donc
 * ici, et seul le **compteur** a convergé.
 *
 * **Un magasin muet refuse** : `hit` rend un compte supérieur à tout seuil, donc
 * la soumission est refusée. C'est la même décision qu'au répartiteur (ADR 050),
 * et pour la même raison — le magasin est la base de l'application, sans
 * laquelle il n'y a rien à protéger.
 */
const REFUSE_WHEN_STORE_IS_DOWN = Number.MAX_SAFE_INTEGER

export function createSharedSubmissionThrottle(input: {
  readonly limiter: RateLimiter
  readonly windowSeconds: number
}): SubmissionThrottle {
  return {
    hit: async ({ bucket, windowStart }) => {
      /**
       * `windowStart` est **déjà aligné** par le domaine du module, sur la même
       * durée que celle passée ici : le port en dérive donc exactement la même
       * fenêtre. Les deux alignements ne peuvent pas diverger tant que la durée
       * est la même valeur.
       */
      const result = await input.limiter.consume({
        buckets: [
          { key: bucket.key, max: bucket.max, windowSeconds: input.windowSeconds },
        ],
        now: windowStart,
      })

      return result.ok ? (result.buckets[0]?.hits ?? 1) : REFUSE_WHEN_STORE_IS_DOWN
    },

    sweep: async (instant) => {
      /**
       * **Ce module ne décide plus de ce qui est clos**, et c'est le correctif
       * du constat C1 de la revue : le magasin est partagé, ses seaux n'ont pas
       * la même durée, et chaque ligne porte sa propre échéance. Cet instant ne
       * dit que « quand on regarde ». Le module passe le début de sa fenêtre,
       * qui est nécessairement passé : la récupération est donc au pire
       * retardée, jamais un seau ouvert effacé.
       */
      const result = await input.limiter.sweep(instant)

      return result.ok ? result.removed : 0
    },
  }
}
