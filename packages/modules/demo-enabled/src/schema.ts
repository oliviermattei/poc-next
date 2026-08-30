import { pgTable, text } from 'drizzle-orm/pg-core'

/**
 * Les tables du module, déclarées par le module — jamais dans un schéma
 * monolithique. Le contrat les **déclare** ; les composer et jouer leurs
 * migrations est le sujet de s04, et tant que c'est fait la table ci-dessous
 * n'existe dans aucune base.
 *
 * Nommage `snake_case` pour les tables et les colonnes, `camelCase` pour les
 * propriétés TypeScript.
 */
export const demoItems = pgTable('demo_items', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
})
