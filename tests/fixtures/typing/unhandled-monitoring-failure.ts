import type { Monitoring } from '@repo/ports'

/**
 * **Doit échouer** : l'échec du port de monitoring traité comme s'il n'existait
 * pas.
 *
 * Septième port, même contrat (s39). La conséquence recherchée lui est propre :
 * ce port est appelé **depuis un gestionnaire d'erreur**. Lever y remplacerait
 * l'erreur d'origine par la nôtre, et lire le succès sans écarter l'échec ferait
 * croire qu'une erreur a été remontée alors qu'elle a disparu deux fois.
 *
 * Remplacer `CaptureResult` par un type non discriminé fait compiler ce fichier,
 * et `tests/module-registry.test.ts` rougit.
 */
export const captureWithoutHandlingFailure = async (monitoring: Monitoring): Promise<string> => {
  const result = await monitoring.capture({
    message: 'boom',
    type: 'Error',
    stack: null,
    origin: 'server',
    release: null,
    context: {},
  })

  return result.id
}
