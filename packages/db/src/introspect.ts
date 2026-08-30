import { sql } from 'drizzle-orm'

import type { DatabaseConnection } from './client'

/**
 * Lecture du schéma **réel** de la base.
 *
 * « Aucune table d'un module non activé n'existe » ne se vérifie pas dans les
 * fichiers de migration : ceux-ci ne disent que ce qu'on a écrit. Une table
 * créée par un import transitif, une migration copiée à la main ou un schéma
 * monolithique oublié n'y laisse aucune trace, et se voit dans
 * `information_schema`. C'est la seule vérification qui attrape ces trois cas,
 * et la recette de modularité (s26) reprendra celle-ci telle quelle.
 *
 * Les tables de journal de Drizzle ne sont pas comptées : elles vivent dans le
 * schéma `drizzle`, pas dans le schéma applicatif interrogé ici.
 */
export interface ListDatabaseTablesOptions {
  readonly db: DatabaseConnection['db']
  /** Schéma applicatif inspecté. `public` par défaut. */
  readonly schemaName?: string
}

export async function listDatabaseTables(
  options: ListDatabaseTablesOptions,
): Promise<readonly string[]> {
  const result = await options.db.execute<{ table_name: string }>(sql`
    select table_name
    from information_schema.tables
    where table_schema = ${options.schemaName ?? 'public'}
      and table_type = 'BASE TABLE'
    order by table_name
  `)

  return result.rows.map((row) => row.table_name)
}
