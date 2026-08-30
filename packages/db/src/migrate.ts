import { existsSync, readFileSync } from 'node:fs'
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
 * Vrai dès qu'une migration est à appliquer.
 *
 * Le dossier peut être absent (aucun `drizzle-kit generate` n'a encore tourné)
 * *ou* contenir un journal sans entrée : `generate` en écrit un dès le premier
 * appel, même quand aucun module ne déclare de table. Les deux états disent la
 * même chose — il n'y a rien à appliquer, et donc aucune raison d'ouvrir une
 * connexion.
 */
function hasMigrations(migrationsFolder: string): boolean {
  const journal = join(migrationsFolder, 'meta', '_journal.json')

  if (!existsSync(journal)) {
    return false
  }

  const parsed: unknown = JSON.parse(readFileSync(journal, 'utf8'))
  const entries = (parsed as { entries?: unknown }).entries

  return Array.isArray(entries) && entries.length > 0
}

/**
 * Applique les migrations en attente. L'idempotence est celle de Drizzle : le
 * journal des migrations déjà appliquées vit dans la base, un second passage
 * n'exécute rien.
 */
export async function runMigrations(options: RunMigrationsOptions): Promise<MigrationsResult> {
  if (!hasMigrations(options.migrationsFolder)) {
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
