import type { Analytics } from '@repo/ports'

/**
 * **Doit échouer** : l'échec du port d'analytique traité comme s'il n'existait
 * pas.
 *
 * C'est le contrat commun des ports (`docs/architecture.md`), et le sixième
 * port (s39) en hérite comme les cinq précédents : aucune méthode ne lève,
 * l'échec est une **valeur discriminée**, et c'est le compilateur — pas la
 * relecture — qui force l'appelant à le traiter.
 *
 * La conséquence recherchée est propre à l'analytique : ce port **dégrade**
 * (`docs/reliability.md` §2), donc son échec est banal — et un échec banal est
 * exactement celui qu'on cesse de regarder. Un appelant qui lirait `result.id`
 * sans avoir écarté `ok: false` croirait avoir mesuré alors qu'aucun appel n'est
 * même parti, l'état livré du boilerplate étant précisément « aucune clé ».
 *
 * Remplacer `AnalyticsResult` par un type non discriminé fait compiler ce
 * fichier, et `tests/module-registry.test.ts` rougit.
 */
export const trackWithoutHandlingFailure = async (analytics: Analytics): Promise<string> => {
  const result = await analytics.track({
    name: 'auth.signed_up',
    distinctId: 'user-1',
    properties: {},
  })

  return result.id
}
