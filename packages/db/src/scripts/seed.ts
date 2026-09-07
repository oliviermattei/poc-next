import { loadRootEnv } from '@repo/config/server'
import { buildRegistry } from '@repo/core'

import { availableModules, enabledModules, requiredModules } from '../../../../config/features'
import { appLocales } from '../../../../config/i18n'
import { closeDatabase, getDatabase } from '../client'
import { planModuleSeeders, runSeeders } from '../seed'

/**
 * `pnpm db:seed` — les données de départ des modules **activés**, et d'eux
 * seuls.
 *
 * Point de composition, comme `migrate.ts` : la configuration est lue ici,
 * jamais dans la bibliothèque. Il n'y a aucun `if (module activé)` — un module
 * coupé n'est pas dans le registre, donc son seed n'existe pas, donc il ne
 * laisse aucune ligne.
 *
 * **Ce que cette commande ne fait plus** : réussir sans rien faire. Elle
 * imprimait « Aucun seed à exécuter » et sortait 0 sur une base dont toutes les
 * tables du schéma public étaient à zéro ligne (mesure de s58, datée dans la
 * recherche ; le nombre n'est pas recopié ici, la commande l'imprime). Les deux
 * planchers de `runSeeders` la font désormais échouer — aucun seed déclaré, ou
 * un seed déclaré qui n'écrit aucune ligne sur une base vide —, et elle **rend
 * le comptage** : l'idempotence se lit dans deux exécutions successives, pas
 * dans un commentaire.
 */

loadRootEnv()

const registry = buildRegistry({
  available: [...availableModules],
  enabled: [...enabledModules],
  required: [...requiredModules],
  locales: [...appLocales],
})

const connection = getDatabase()

try {
  const outcome = await runSeeders({
    db: connection.db,
    seeders: planModuleSeeders(registry.seeds),
  })

  console.info(
    `Seeds exécutés : ${outcome.executed.join(', ')}.\n` +
      `Lignes du schéma public : ${outcome.rowsBefore} avant, ${outcome.rowsAfter} après, ` +
      `sur ${outcome.tables} tables.`,
  )
} catch (error) {
  // Le message porte le motif — aucun seed déclaré, base déjà en service, ou
  // exécution qui n'a rien laissé. Une trace de pile n'apprendrait rien de plus
  // et noierait la phrase qui compte.
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await closeDatabase()
}
