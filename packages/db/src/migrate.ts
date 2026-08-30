import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { migrate } from 'drizzle-orm/node-postgres/migrator'

import type { DatabaseConnection } from './client'

export interface RunMigrationsOptions {
  readonly db: DatabaseConnection['db']
  readonly migrationsFolder: string
  /** Journal des migrations appliquées. Défaut Drizzle : `drizzle.__drizzle_migrations`. */
  readonly migrationsTable?: string
  readonly migrationsSchema?: string
}

export interface MigrationsResult {
  /** Faux quand aucune migration n'existe encore : la base n'est pas touchée. */
  readonly applied: boolean
}

/**
 * Applique les migrations en attente. L'idempotence est celle de Drizzle : le
 * journal des migrations déjà appliquées vit dans la base, un second passage
 * n'exécute rien.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<MigrationsResult> {
  const journal = join(options.migrationsFolder, 'meta', '_journal.json')

  if (!existsSync(journal)) {
    return { applied: false }
  }

  await migrate(options.db, {
    migrationsFolder: options.migrationsFolder,
    ...(options.migrationsTable === undefined ? {} : { migrationsTable: options.migrationsTable }),
    ...(options.migrationsSchema === undefined
      ? {}
      : { migrationsSchema: options.migrationsSchema }),
  })

  return { applied: true }
}
