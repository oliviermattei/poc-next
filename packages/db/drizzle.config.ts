import { defineConfig } from 'drizzle-kit'

/**
 * Ce que `drizzle-kit` doit savoir, et **rien de plus** : le dialecte et la
 * casse. Ce fichier déclare, il n'orchestre pas — `src/scripts/generate.ts`
 * l'importe pour ces deux valeurs, puis appelle `drizzle-kit` une fois par
 * module en passant lui-même `--schema` et `--out`. Deux déclarations du
 * dialecte divergeraient, et une casse différente renommerait des colonnes.
 *
 * `schema` et `out` en sont **volontairement absents**, et c'est une garde, pas
 * une omission : il n'existe pas de dossier de migrations de l'application. Un
 * `out` unique ne saurait pas exprimer « un dossier et un journal par module »,
 * et un dossier commun réécrirait les migrations des autres modules à chaque
 * activation. Or `drizzle-kit` ne se plaint pas d'un `out` manquant — il se
 * rabat sur `./drizzle` relatif au répertoire courant. Tant que `schema`
 * restait ici, `drizzle-kit generate` lancé depuis `packages/db` produisait
 * donc en silence un dossier fusionnant les tables de tous les modules
 * activés : l'artefact exact que cette configuration prétend abolir. Sans
 * `schema`, la commande refuse (« Please provide required params ») et n'écrit
 * rien. Un test l'exige.
 *
 * Les migrations sont des fichiers SQL versionnés, jamais un `push` : ce
 * fichier n'a donc besoin d'aucun accès à la base. L'application des migrations
 * passe par `src/migrate.ts`, qui lit `DATABASE_URL` via le module de
 * configuration.
 *
 * Note d'outillage : `drizzle-kit generate` refuse `--config` en même temps que
 * toute autre option (« You can't use both --config and other cli options »).
 * La génération par module passe donc par des drapeaux, pas par ce fichier.
 */
export default defineConfig({
  dialect: 'postgresql',
  casing: 'snake_case',
})
