import { fileURLToPath } from 'node:url'

import { loadRootEnv } from '@repo/config/server'
import { buildRegistry } from '@repo/core'

import { availableModules, enabledModules } from '../../../../config/features'
import { closeDatabase, getDatabase } from '../client'
import { planModuleMigrations, runModuleMigrations } from '../migrate'

/**
 * `pnpm db:migrate` — les migrations des modules **activés**, et d'eux seuls.
 *
 * Point de composition, comme `generate.ts` : c'est ici que la configuration
 * est lue, jamais dans la bibliothèque. L'ordre d'application est celui du
 * graphe des requis, fourni par le registre — un module requis voit ses tables
 * créées avant celles de son dépendant.
 *
 * Il n'y a aucun `if (module activé)` : un module non activé n'est pas dans le
 * registre, donc pas dans le plan, donc rien de lui n'atteint la base. Et rien
 * n'est jamais supprimé : un module activé puis désactivé conserve ses tables
 * et ses données — les effacer serait `eject`, au cimetière du PRD.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

loadRootEnv()

const registry = buildRegistry({
  available: [...availableModules],
  enabled: [...enabledModules],
})

const plan = planModuleMigrations({ modules: registry.modules, repoRoot: REPO_ROOT })

const connection = getDatabase()

try {
  const outcomes = await runModuleMigrations({ db: connection.db, plan })
  const applied = outcomes.filter((outcome) => outcome.applied).map((outcome) => outcome.moduleId)

  console.info(
    applied.length > 0
      ? `Migrations appliquées, dans l’ordre du graphe : ${applied.join(', ')}.`
      : 'Aucune migration à appliquer : aucun module activé n’en déclare.',
  )
} finally {
  await closeDatabase()
}
