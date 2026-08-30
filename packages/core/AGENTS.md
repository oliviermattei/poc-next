# packages/core — règles locales

Le **contrat de module** (ADR 007) et le registre qui le lit. C'est le point le
plus structurant du dépôt : chaque module applicatif s'y conforme, et un champ
ajouté après coup oblige à rouvrir tous les modules déjà écrits. Le contrat est
donc complet dès le premier module, quitte à ce que des déclarations soient
vides.

Trois garanties vivent ici, et elles ne sont pas de même nature :

| Garantie | Où elle est tenue | Ce qui échoue si on la viole |
|---|---|---|
| Un identifiant de module inconnu est refusé | le **compilateur** (`config/features.ts` est typée depuis l'annuaire) | `pnpm typecheck` |
| Une catégorie de données sans politique de rétention est refusée | le **compilateur** (`retention` est indexée par `dataCategories`) | `pnpm typecheck` |
| Requis manquant, cycle, auto-référence, template d'email incomplet, collision de route | `validateModuleConfiguration`, à la construction du registre | `pnpm test`, et le démarrage de l'application |

Les deux premières sont du typage et ne doivent **jamais** être dégradées en
vérification d'exécution : une contrainte portée par le compilateur ne se
contourne pas, une validation au démarrage se découvre en production.

## Imports autorisés

- rien à l'exécution : ce package est une feuille du graphe, sans dépendance de
  production. Il ne connaît ni Drizzle, ni Next, ni la base de données ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

Le contrat décrit le schéma d'un module comme un simple
`Record<string, unknown>` — la structure exacte des tables appartient au module
et à `@repo/db`. C'est ce qui permet à `composeSchema` de consommer un module
sans que `@repo/core` dépende de l'ORM.

## Ne doit jamais contenir

- de règle métier : les règles vivent dans le `domain/` d'un module ;
- d'accès à la base, au réseau ou au système de fichiers : le registre est une
  structure de données, pas un service ;
- de connaissance d'un module particulier — aucun `if (moduleId === 'billing')`.
  Ce qui varie par module se déclare au contrat ;
- **de commande de nettoyage** : un module désactivé conserve ses tables et ses
  données. Les supprimer serait `eject`, au cimetière du PRD ;
- de dépendance vers `config/features.ts` : le registre **reçoit** la
  configuration, il ne la lit pas lui-même. Sans quoi il devient impossible d'en
  construire un autre dans un test.

## Tests

Ce qui traverse le dépôt — contrat, validation, registre, modules de
démonstration, montage dans `apps/web` — vit dans `tests/` à la racine
(`tests/module-registry.test.ts`, `tests/module-off.test.ts`). Un test propre à
ce package irait dans `src/**/*.test.ts`.

Les deux contraintes portées par le compilateur ne se prouvent pas avec
`expectTypeOf` : elles se prouvent en compilant réellement des fichiers qui
doivent échouer (`tests/fixtures/typing/`). Une contrainte de typage qu'aucune
commande n'a vue échouer n'existe pas.
