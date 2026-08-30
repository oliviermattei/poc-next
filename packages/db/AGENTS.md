# packages/db — règles locales

Client Drizzle, composition des schémas de modules, génération et exécution des
migrations. Le choix du pilote et la stratégie de connexion sont encapsulés ici :
passer d'un PostgreSQL conteneurisé à un provider managé ne change qu'une
`DATABASE_URL`, jamais une ligne de code applicatif.

## Migrations : un dossier et un journal par module

Il n'existe **pas** de dossier de migrations de l'application. Chaque module
déclare le sien au contrat (`migrations`, chemin relatif à la racine du dépôt),
et son journal porte son nom : `drizzle.__drizzle_migrations_<module>`. C'est ce
qui fait qu'activer un module applique ses migrations sans que Drizzle croie les
autres déjà jouées.

`pnpm db:generate` (`src/scripts/generate.ts`) écrit les **barils** de
`generated/schema/` — un fichier par module activé, produit depuis
`config/features.ts`, qui réexporte à plat les tables déclarées au contrat —
puis appelle `drizzle-kit` une fois par module. Le baril n'est pas une commodité :
`drizzle-kit` n'inspecte que les exports de premier niveau du fichier qu'on lui
désigne, un schéma composé à l'exécution lui est invisible (« 0 tables »). Les
barils sont versionnés, et `pnpm test` compare le dossier à sa régénération :
une divergence échoue.

L'ordre d'application vient du **graphe des requis**, rendu par `buildRegistry` :
un module requis migre avant son dépendant. Jamais l'ordre alphabétique, jamais
celui de `config/features.ts`.

## Imports autorisés

- `drizzle-orm` et `pg` — le pilote ne sort pas de ce package ;
- `@repo/config` pour l'environnement (jamais `process.env` directement) ;
- `@repo/core` pour le contrat de module et l'ordre du graphe des requis ;
- `drizzle-kit` et `tsx` pour l'outillage de migration et de seed ;
- `@repo/typescript-config` pour la configuration du compilateur.

`config/features.ts` n'est lu que dans `src/scripts/` — ce sont des **points de
composition**, pas la bibliothèque. Les fonctions de `src/` reçoivent des
modules ; sans cela, aucun test ne pourrait en composer d'autres.

Ce package ne dépend d'**aucun** package de module, et ne doit pas : l'
`infrastructure/` d'un module dépendra de lui pour sa connexion, la dépendance
inverse fermerait un cycle. C'est pourquoi les barils vivent à la racine du
dépôt, seul endroit qui déclare déjà les packages de modules.

## Ne doit jamais contenir

- de règle métier : ce package sait persister, pas décider ;
- de table applicative — chaque table appartient au module qui la déclare, et
  `composeSchema` les assemble ;
- de clé étrangère vers un module qu'un module ne déclare pas dans ses requis :
  elle rendrait ce module silencieusement non désactivable.
  `assertNoForbiddenModuleReferences` la refuse **à la génération**, en nommant
  les deux modules ; la liste des modules référençables n'est écrite nulle part,
  elle se déduit des `requires` déclarés ;
- de commande de nettoyage : un module activé puis désactivé conserve ses tables
  et ses données. Les supprimer serait `eject`, au cimetière du PRD ;
- de migration destructive, ni d'appel à `drizzle-kit push`. Les migrations sont
  des fichiers SQL versionnés produits par `drizzle-kit generate`, et
  rétrocompatibles avec la version encore en ligne.

## Tests

Ce qui touche la base traverse le dépôt : les tests vivent dans `tests/` à la
racine, avec les fixtures de `tests/fixtures/` (schéma jetable, journal de
migrations). Un test qui a besoin d'une vraie base se skippe proprement quand
elle est absente, jamais silencieusement.

Un test propre à ce package irait dans `src/**/*.test.ts`.
