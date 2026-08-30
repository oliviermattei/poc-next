import { fileURLToPath } from 'node:url'

import { loadRootEnv } from '@repo/config/server'

import { closeDatabase, getDatabase } from '../client'
import { runMigrations } from '../migrate'

/** Migrations de l'application, générées par `drizzle-kit generate`. */
const APP_MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url))

loadRootEnv()

const connection = getDatabase()

try {
  const result = await runMigrations({
    db: connection.db,
    migrationsFolder: APP_MIGRATIONS_FOLDER,
  })

  console.info(
    result.applied
      ? 'Migrations appliquées.'
      : 'Aucune migration à appliquer : aucun module ne déclare de schéma.',
  )
} finally {
  await closeDatabase()
}
