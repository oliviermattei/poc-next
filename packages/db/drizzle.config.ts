import { defineConfig } from 'drizzle-kit'

/**
 * Configuration de `drizzle-kit generate` uniquement : les migrations sont des
 * fichiers SQL versionnés, jamais un `push`. L'application des migrations passe
 * par `src/migrate.ts`, qui lit `DATABASE_URL` via le module de configuration —
 * cette configuration-ci n'a donc besoin d'aucun accès à la base.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
})
