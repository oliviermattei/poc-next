# packages/db — règles locales

Client Drizzle, composition des schémas de modules, exécution des migrations.
Le choix du pilote et la stratégie de connexion sont encapsulés ici : passer
d'un PostgreSQL conteneurisé à un provider managé ne change qu'une
`DATABASE_URL`, jamais une ligne de code applicatif.

## Imports autorisés

- `drizzle-orm` et `pg` — le pilote ne sort pas de ce package ;
- `@repo/config` pour l'environnement (jamais `process.env` directement) ;
- `drizzle-kit` et `tsx` pour l'outillage de migration et de seed ;
- `@repo/typescript-config` pour la configuration du compilateur.

## Ne doit jamais contenir

- de règle métier : ce package sait persister, pas décider ;
- de table applicative — chaque table appartient au module qui la déclare, et
  `composeSchema` les assemble ;
- de clé étrangère vers un module optionnel : elle rendrait ce module
  silencieusement non désactivable ;
- de migration destructive, ni d'appel à `drizzle-kit push`. Les migrations sont
  des fichiers SQL versionnés produits par `drizzle-kit generate`, et
  rétrocompatibles avec la version encore en ligne.

## Tests

Ce qui touche la base traverse le dépôt : les tests vivent dans `tests/` à la
racine, avec les fixtures de `tests/fixtures/` (schéma jetable, journal de
migrations). Un test qui a besoin d'une vraie base se skippe proprement quand
elle est absente, jamais silencieusement.

Un test propre à ce package irait dans `src/**/*.test.ts`.
