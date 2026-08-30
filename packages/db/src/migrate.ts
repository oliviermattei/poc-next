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

  let parsed: unknown

  try {
    parsed = JSON.parse(readFileSync(journal, 'utf8'))
  } catch (error) {
    // Un `SyntaxError` brut ne dit ni quel fichier ni quelle commande le
    // produit. Le journal est écrit par `drizzle-kit generate` : nommer le
    // fichier est la seule information qui mène à la réparation.
    throw new Error(`Journal de migrations illisible : ${journal}`, { cause: error })
  }

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

/**
 * Un module au regard des migrations : ce que le contrat en dit, et rien de
 * plus. Volontairement structurel — `@repo/db` reçoit des modules, il ne lit
 * pas `config/features.ts`.
 */
export interface MigratableModule {
  readonly id: string
  /** Dossier des migrations, relatif à la racine du dépôt, ou `null`. */
  readonly migrations: string | null
}

export interface ModuleMigrationStep {
  readonly moduleId: string
  readonly migrationsFolder: string
  readonly migrationsTable: string
  readonly migrationsSchema: string
}

/** Schéma qui héberge les journaux, un par module. Convention Drizzle. */
export const MIGRATIONS_SCHEMA = 'drizzle'

const MIGRATIONS_TABLE_PREFIX = '__drizzle_migrations_'

/** Limite d'un identifiant PostgreSQL : au-delà, la troncature est silencieuse. */
const POSTGRES_IDENTIFIER_LIMIT = 63

/**
 * Journal d'un module, dérivé de son identifiant de façon stable.
 *
 * Un journal par module, et non un journal commun : c'est ce qui fait qu'activer
 * un module applique **ses** migrations sans que Drizzle croie les autres déjà
 * jouées, et que désactiver un module ne perturbe pas le décompte de ceux qui
 * restent.
 */
export function migrationsTableFor(moduleId: string): string {
  const table = `${MIGRATIONS_TABLE_PREFIX}${moduleId.replaceAll('-', '_')}`

  if (table.length > POSTGRES_IDENTIFIER_LIMIT) {
    throw new Error(
      `Identifiant de module trop long : le journal « ${table} » dépasse la limite de ` +
        `${POSTGRES_IDENTIFIER_LIMIT} caractères de PostgreSQL, qui tronquerait sans le dire — ` +
        `deux modules partageraient alors le même journal.`,
    )
  }

  return table
}

export interface PlanModuleMigrationsOptions {
  /**
   * Les modules activés, **dans l'ordre du graphe des requis**. C'est l'ordre
   * que rend `buildRegistry` : le plan le conserve, il ne retrie pas. Un tri
   * alphabétique appliquerait les tables d'un dépendant avant celles de son
   * requis.
   */
  readonly modules: readonly MigratableModule[]
  readonly repoRoot: string
}

/** Ce qu'il y a à appliquer, module par module, dans l'ordre reçu. */
export function planModuleMigrations(
  options: PlanModuleMigrationsOptions,
): readonly ModuleMigrationStep[] {
  return options.modules
    .filter((module) => module.migrations !== null)
    .map((module) => ({
      moduleId: module.id,
      migrationsFolder: join(options.repoRoot, module.migrations as string),
      migrationsTable: migrationsTableFor(module.id),
      migrationsSchema: MIGRATIONS_SCHEMA,
    }))
}

export interface ModuleMigrationOutcome {
  readonly moduleId: string
  readonly applied: boolean
}

/**
 * Applique les migrations des modules, dans l'ordre du plan.
 *
 * Aucune notion de module désactivé ici : un module absent du plan n'a rien à
 * appliquer, et il n'y a donc rien à ignorer. C'est ce qui fait qu'une base
 * vierge ne porte aucune trace d'un module non activé — pas un `if`, une
 * absence.
 */
export async function runModuleMigrations(options: {
  readonly db: RunMigrationsOptions['db']
  readonly plan: readonly ModuleMigrationStep[]
}): Promise<readonly ModuleMigrationOutcome[]> {
  const outcomes: ModuleMigrationOutcome[] = []

  for (const step of options.plan) {
    const { applied } = await runMigrations({
      db: options.db,
      migrationsFolder: step.migrationsFolder,
      migrationsTable: step.migrationsTable,
      migrationsSchema: step.migrationsSchema,
    })

    outcomes.push({ moduleId: step.moduleId, applied })
  }

  return outcomes
}
