// AUTORISÉ : l'ORM est chez lui dans infrastructure.
import { pgTable, text } from 'drizzle-orm/pg-core'

export const orderRows = pgTable('order_rows', { id: text('id') })
