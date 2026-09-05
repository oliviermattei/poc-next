import type { Jobs } from '@repo/ports'

/**
 * **Doit échouer** : l'échec du port de jobs traité comme s'il n'existait pas.
 *
 * C'est le contrat commun des ports (`docs/architecture.md`), et le cinquième
 * port (s33) en hérite comme les quatre précédents : aucune méthode ne lève,
 * l'échec est une **valeur discriminée**, et c'est le compilateur — pas la
 * relecture — qui force l'appelant à le traiter.
 *
 * La conséquence recherchée est propre aux jobs : une émission perdue ne se
 * voit **jamais** dans la requête qui l'a faite. Un appelant qui lirait
 * `result.id` sans avoir écarté la branche `ok: false` croirait avoir mis un
 * traitement en file quand rien n'a été mis en file.
 *
 * Remplacer `EmitJobResult` par un type non discriminé fait compiler ce
 * fichier, et `tests/module-registry.test.ts` rougit.
 */
export const emitWithoutHandlingFailure = async (jobs: Jobs): Promise<string> => {
  const result = await jobs.emit({
    job: 'rate-limit.sweep-closed-windows',
    key: 'sweep:2026-09-05T10:00',
    data: {},
  })

  return result.id
}
