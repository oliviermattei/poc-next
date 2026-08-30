import { fileURLToPath } from 'node:url'

import { config as loadDotenvFile } from 'dotenv'

import { closeDatabase, getDatabase } from '../client'
import { runMigrations } from '../migrate'

/** Migrations de l'application, générées par `drizzle-kit generate`. */
const APP_MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url))

loadDotenvFile({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true })

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
