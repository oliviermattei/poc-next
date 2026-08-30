import { loadRootEnv } from '@repo/config'

import { closeDatabase, getDatabase } from '../client'
import { runSeeders } from '../seed'

loadRootEnv()

const connection = getDatabase()

try {
  const executed = await runSeeders({ db: connection.db })

  console.info(
    executed.length > 0
      ? `Seeds exécutés : ${executed.join(', ')}.`
      : 'Aucun seed à exécuter : aucun module ne déclare de données de départ.',
  )
} finally {
  await closeDatabase()
}
