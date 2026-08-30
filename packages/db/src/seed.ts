import type { DatabaseConnection } from './client'

/**
 * Un seed est rejouable par construction : identifiants déterministes et
 * écritures tolérantes au conflit. Un seed à identifiants aléatoires passe une
 * fois puis duplique.
 */
export interface Seeder {
  readonly id: string
  readonly run: (db: DatabaseConnection['db']) => Promise<void>
}

/** Seeds des modules activés. Vide tant qu'aucun module n'est livré. */
export const seeders: readonly Seeder[] = []

export interface RunSeedersOptions {
  readonly db: DatabaseConnection['db']
  readonly seeders?: readonly Seeder[]
}

/** Exécute les seeds dans l'ordre et renvoie les identifiants exécutés. */
export async function runSeeders(options: RunSeedersOptions): Promise<string[]> {
  const executed: string[] = []

  for (const seeder of options.seeders ?? seeders) {
    await seeder.run(options.db)
    executed.push(seeder.id)
  }

  return executed
}
