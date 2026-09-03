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
plus l'**agrégat** `generated/schema/index.ts`, puis appelle `drizzle-kit` une
fois par module. Le baril n'est pas une commodité :
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
| Un module activé sans régénérer le baril ou l'agrégat | `pnpm test` (comparaison du dossier `generated/schema/` à sa régénération) |
| Un schéma modifié sans migration correspondante | `pnpm test` (régénération **à blanc** hors de l'arbre versionné : un fichier SQL de plus fait rougir) |
| Tout autre artefact d'outil laissé dans l'arbre | La CI seule, par « l'arbre reste propre » après `pnpm db:generate` |

La régénération à blanc recopie les migrations du module hors de l'arbre et y
rejoue le diff de `drizzle-kit` : elle ne touche jamais le dépôt. Un contrôle
local qui exigerait un `git status` propre rougirait sur tout travail en cours,
et serait donc désarmé le jour où il servirait.

L'ordre d'application vient du **graphe des requis**, rendu par `buildRegistry` :
un module requis migre avant son dépendant. Jamais l'ordre alphabétique, jamais
celui de `config/features.ts`.

### Le baril d'un module sans table, et l'artefact d'interop (s28)

`pnpm db:generate` écrit `export {}` pour un module qui ne déclare aucune table —
c'est le cas de `consent`, `i18n` et `mcp-server`. La forme que `composeSchema`
en reçoit **dépend du chargeur**, et c'est le piège :

- en ESM (l'application, `pnpm test`, `tsx`), `import * as consent` rend un
  espace de noms **vide** ;
- matérialisé en CommonJS — ce que fait le chargeur de `next.config.ts` —, il
  rend `{ default: …, __esModule: true }`.

**Mesuré le 3 septembre 2026** en instrumentant `composeSchema` pendant
`pnpm build` : `consent` et `i18n` arrivaient tous deux avec la seule clé
`default`. Prises pour des tables, ces clés produisaient deux fautes :

1. **deux** barils vides entraient en collision sur `default`, et le démarrage
   échouait en accusant deux modules qui ne déclarent rien ;
2. **un seul** baril vide n'échouait pas : `default` entrait dans `appSchema`
   comme une table et partait au constructeur de requêtes relationnelles de
   Drizzle, en silence.

Le défaut était **latent depuis le premier baril vide** : aucun chemin ne
chargeait `@repo/db` sous ce chargeur-là, si bien qu'aucune commande ne le
voyait. s28 en a ouvert un — `apps/web/lib/rate-limit.ts`, atteint par
`lib/startup.ts`, lui-même chargé par `next.config.ts` — et l'a fait sortir.

`composeSchema` ignore donc `default` et `__esModule`, **sauf** si la valeur est
une vraie table Drizzle : dans ce cas elle refuse en nommant le module, plutôt
que d'avaler une déclaration. Le générateur de barils n'écrit jamais d'export par
défaut.

| Ce qui est tenu | Ce qui échoue si on le viole |
|---|---|
| Un baril vide n'apporte aucune table, quel que soit le chargeur | `pnpm build`, et `tests/migrations.test.ts` |
| Deux barils vides n'entrent pas en collision | idem |
| Une table exportée par défaut est refusée, pas avalée | `tests/migrations.test.ts` |

## Imports autorisés

- `drizzle-orm` et `pg` — le pilote ne sort pas de ce package ;
- `@repo/config` pour l'environnement (jamais `process.env` directement) ;
- `@repo/core` pour le contrat de module et l'ordre du graphe des requis ;
- `drizzle-kit` et `tsx` pour l'outillage de migration et de seed ;
- `@repo/typescript-config` pour la configuration du compilateur.

`config/features.ts` n'est lu que dans `src/scripts/` — ce sont des **points de
composition**, pas la bibliothèque. Les fonctions de `src/` reçoivent des
modules ; sans cela, aucun test ne pourrait en composer d'autres.

Ce package ne dépend d'aucun package de module **directement** : il importe
`generated/schema/index.ts`, l'agrégat écrit par `pnpm db:generate` depuis
`config/features.ts`. C'est cet agrégat qui donne au client Drizzle son schéma
relationnel, donc `db.query.<table>` — vide jusqu'en s07, faute d'un module qui
persiste (résidu de s04, refermé par ADR 020).

La contrepartie est une règle, et elle a un sens unique : **un module n'importe
jamais `@repo/db`**. Il reçoit sa connexion de son point de composition, sous la
forme réduite des opérations qu'il utilise. La dépendance inverse fermerait le
cycle `@repo/db` → agrégat → module → `@repo/db`, dont la conséquence n'est pas
une erreur de compilation mais une table lue avant d'être initialisée, à
l'exécution.

La règle vit dans `eslint.config.ts` (`no-restricted-syntax`, portée
`packages/modules/**/*.{ts,tsx,mts,cts}` — les extensions que le `tsconfig` d'un
module compile) ; `tests/lint-rules.test.ts` prouve qu'elle mord, écriture par
écriture, et `tests/module-registry.test.ts` balaie le dépôt avec elle, sources
et manifestes. Ce que ce balayage couvre est exactement ce que la règle voit :
les deux portées se corrigent ensemble. Les écritures qu'elle ne voit **pas**
sont nommées dans le commentaire d'`eslint.config.ts` — un spécificateur
reconstruit (`'@repo/' + 'db'`, gabarit interpolé au milieu, `createRequire`
aliasé) ; c'est ce qui a été balayé, pas une liste close.

C'est aussi pourquoi les barils vivent à la racine du dépôt, seul endroit qui
déclare déjà les packages de modules.

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
