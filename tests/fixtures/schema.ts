import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Schéma de test uniquement.
 *
 * s01 ne livre aucun module, donc aucune table de production : l'idempotence des
 * migrations et la rejouabilité du seed se prouvent sur cette table-ci, pas sur
 * une table inventée pour l'occasion.
 */
export const fixtureItem = pgTable('fixture_item', {
  id: text().primaryKey(),
  label: text().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
})
