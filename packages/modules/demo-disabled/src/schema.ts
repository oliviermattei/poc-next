import { pgTable, text } from 'drizzle-orm/pg-core'

/**
 * La table du module non activé.
 *
 * Elle existe dans le dépôt et n'existera dans aucune base tant que le module
 * n'est pas activé : c'est exactement ce que s04 doit prouver en lisant le
 * schéma réel de la base.
 */
export const demoNotes = pgTable('demo_notes', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  body: text('body').notNull(),
})
