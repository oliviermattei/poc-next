# ADR 060 — Le migrateur rejoue la création concurrente, et elle seule

- Status: accepted
- Date: 2026-09-05

L'idempotence de `runMigrations` (`packages/db/src/migrate.ts`) est celle de Drizzle : le journal des migrations appliquées vit dans la base, un second passage n'exécute rien. Ce n'est pas de la concurrence : deux migrateurs qui démarrent ensemble sur une base vierge lisent un journal vide, émettent le même `CREATE TABLE`, et le perdant échoue sur le catalogue de PostgreSQL (`42P07`, `42710`, ou `23505` sur `pg_type_typname_nsp_index`). Les suites de tests parallèles le provoquaient ; deux conteneurs de migration lancés ensemble le provoquent en production.

`runMigrations` **rejoue un pas de migration perdu contre un créateur concurrent, et lui seul** : au plus cinq tentatives, avec un recul croissant, uniquement quand l'erreur porte l'un de ces codes ; toute autre erreur sort à la première tentative. Le classement est une fonction pure exportée, `isConcurrentCreationError`, qui remonte la chaîne des `cause` : Drizzle enveloppe l'erreur du pilote et range celle qui porte le code PostgreSQL dans `cause`.

## Considered options

- **Sérialiser les suites de tests** — rejeté : cela répare le symptôme et laisse le contrat de `@repo/db` faux pour la production.
- **Rejouer dans chaque fichier de test appelant** — rejeté : rejouer d'un seul côté déplace l'échec sur l'autre appelant. La convergence doit être une propriété du migrateur.
- **Un verrou consultatif autour de la migration** — rejeté : `options.db` est un pool, et un verrou de session pris sur une connexion serait relâché sur une autre.
- **Rejouer toute erreur** — rejeté : une migration réellement fautive échouerait de même, après cinq tentatives, dans le conteneur qui précède la bascule du trafic.
- **`create table if not exists`** — rejeté : les fichiers SQL sont générés par `drizzle-kit`, et `generate` est la seule voie.

## Consequences

- Une migration réellement en échec échoue toujours et empêche toujours le démarrage.
- Un second migrateur concurrent ne se signale plus par un plantage : le rejeu est silencieux.
- `tests/migrations.test.ts` tient le classement ; `pnpm test:minimal-profile` exerce la concurrence réelle.
