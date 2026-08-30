import { defineConfig } from 'drizzle-kit'

/**
 * Configuration du schéma de test. Chemins relatifs à la racine du dépôt :
 * `pnpm exec drizzle-kit generate --config tests/fixtures/drizzle.config.ts`.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './tests/fixtures/schema.ts',
  out: './tests/fixtures/migrations',
  casing: 'snake_case',
})
