import { fileURLToPath } from 'node:url'

import { defineConfig } from 'drizzle-kit'

/**
 * Configuration de `drizzle-kit generate` uniquement : les migrations sont des
 * fichiers SQL versionnés, jamais un `push`. L'application des migrations passe
 * par `src/migrate.ts`, qui lit `DATABASE_URL` via le module de configuration —
 * cette configuration-ci n'a donc besoin d'aucun accès à la base.
 *
 * `schema` désigne le dossier des **barils générés**, plus `src/schema.ts`. La
 * raison est mesurée sur le binaire installé : `prepareFromExports` n'inspecte
 * que les exports de premier niveau et ne descend dans aucun objet. Le schéma
 * composé à l'exécution par `composeSchema` lui est donc invisible — `generate`
 * répond « 0 tables » — là où les barils, qui réexportent les tables à plat,
 * lui font voir celles des modules activés. C'est le finding N3, ouvert depuis
 * s01.
 *
 * Ce fichier **déclare**, il n'orchestre pas : `src/scripts/generate.ts`
 * l'importe pour en tirer le dialecte, la casse et la vue agrégée, puis appelle
 * `drizzle-kit` une fois par module en surchargeant `--schema` et `--out`. Un
 * `out` unique ne saurait pas exprimer « un dossier et un journal par module »,
 * et un dossier commun réécrirait les migrations des autres modules à chaque
 * activation. `out` est donc délibérément absent : il n'existe pas de dossier
 * de migrations de l'application.
 *
 * Note d'outillage : `drizzle-kit generate` refuse `--config` en même temps que
 * toute autre option (« You can't use both --config and other cli options »).
 * La génération par module passe donc par des drapeaux, pas par ce fichier.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: fileURLToPath(new URL('../../generated/schema', import.meta.url)),
  casing: 'snake_case',
})
