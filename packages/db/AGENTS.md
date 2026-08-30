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
désigne, un schéma composé à l'exécution lui est invisible (« 0 tables »).

`packages/db/drizzle.config.ts` ne déclare que le **dialecte** et la **casse** —
ce que `generate.ts` en consomme. Ni `schema`, ni `out` : sans `schema`,
`drizzle-kit generate` invoqué seul refuse au lieu de se rabattre sur `./drizzle`
et de produire en silence un dossier fusionnant les tables de tous les modules.
Il n'existe pas de dossier de migrations de l'application.

### Ce que chaque garde attrape, et ce qu'elle n'attrape pas

Les barils **et** le SQL des migrations sont versionnés, sans quoi un clone neuf
ne pourrait rien générer. Deux gardes distinctes les empêchent de mentir, et il
faut savoir laquelle répond à quoi :

| Divergence | Attrapée par |
|---|---|
| Un module activé sans régénérer le baril | `pnpm test` (comparaison du dossier `generated/schema/` à sa régénération) |
| Un schéma modifié sans migration correspondante | `pnpm test` (régénération **à blanc** hors de l'arbre versionné : un fichier SQL de plus fait rougir) |
| Tout autre artefact d'outil laissé dans l'arbre | La CI seule, par « l'arbre reste propre » après `pnpm db:generate` |

La régénération à blanc recopie les migrations du module hors de l'arbre et y
rejoue le diff de `drizzle-kit` : elle ne touche jamais le dépôt. Un contrôle
local qui exigerait un `git status` propre rougirait sur tout travail en cours,
et serait donc désarmé le jour où il servirait.

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
`infrastructure/` d'un module dépendra de lui pour sa connexion, et la
dépendance inverse fermerait alors un cycle. Aucun module ne dépend de
`@repo/db` aujourd'hui — leurs repositories sont en mémoire — donc le cycle est
**prospectif**, mais il est certain dès le premier module qui persiste. C'est
pourquoi les barils vivent dès maintenant à la racine du dépôt, seul endroit qui
déclare déjà les packages de modules : les y déplacer plus tard voudrait dire
les y déplacer sous la contrainte.

## Ne doit jamais contenir

- de règle métier : ce package sait persister, pas décider ;
- de table applicative — chaque table appartient au module qui la déclare, et
  `composeSchema` les assemble ;
- de clé étrangère vers un module qu'un module ne déclare pas dans ses requis :
  elle rendrait ce module silencieusement non désactivable.
  `assertNoForbiddenModuleReferences` la refuse **à la génération**, en nommant
  les deux modules ; la liste des modules référençables n'est écrite nulle part,
  elle se déduit des `requires` déclarés (ADR 018). La même garde refuse deux
  modules qui déclarent la **même table physique** : `composeSchema` n'attrape
  que les collisions de nom d'export, et un propriétaire mal attribué ferait
  juger une clé étrangère sur les requis du mauvais module ;
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
