import type { RateLimiter } from '@repo/ports'

/**
 * **Doit échouer** : l'échec du port de limitation traité comme s'il n'existait
 * pas.
 *
 * C'est le contrat commun des ports (`docs/architecture.md`) : aucune méthode ne
 * lève, l'échec est une **valeur discriminée**, et c'est le compilateur — pas la
 * relecture — qui force l'appelant à le traiter. Un appelant qui lit
 * `result.buckets` sans avoir écarté la branche `ok: false` ne compile pas.
 *
 * La conséquence est celle que la story s28 cherche : quand le magasin est
 * indisponible, personne ne peut « oublier » le cas et laisser passer la
 * requête par distraction. Le refus est une décision écrite (ADR 050), pas un
 * chemin par défaut.
 *
 * Remplacer `ConsumeRateLimitResult` par un type non discriminé fait compiler ce
 * fichier, et `tests/module-registry.test.ts` rougit.
 */
export const countWithoutHandlingFailure = async (limiter: RateLimiter): Promise<number> => {
  const result = await limiter.consume({
    buckets: [{ key: 'sign-in:client:1.2.3.4', max: 5, windowSeconds: 60 }],
    now: new Date(),
  })

  return result.buckets.length
}
