import { mergeConfig } from 'vitest/config'

import base from './vitest.config'

/**
 * **La configuration du régime sans `.env`** (s55) : celle de `pnpm test`, plus
 * un préambule.
 *
 * Elle dérive de `vitest.config.ts` au lieu de la recopier — greffon MDX, alias,
 * motifs d'inclusion, environnement — parce qu'une seconde configuration écrite
 * à côté ne jouerait plus la même suite au premier réglage ajouté, et que le
 * régime existe justement pour jouer **la même** suite autrement.
 *
 * Le préambule est un fichier de `setupFiles` parce que Vitest exécute les
 * fichiers de test dans des processus séparés : un `globalSetup`, qui tourne
 * dans le processus principal, n'atteindrait aucun d'eux.
 */
export default mergeConfig(base, {
  test: { setupFiles: ['./scripts/sans-env-setup.ts'] },
})
