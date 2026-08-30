# packages/core — règles locales

Le **contrat de module** (ADR 007) et le registre qui le lit. C'est le point le
plus structurant du dépôt : chaque module applicatif s'y conforme, et un champ
ajouté après coup oblige à rouvrir tous les modules déjà écrits. Le contrat est
donc complet dès le premier module, quitte à ce que des déclarations soient
vides.

Les garanties qui vivent ici ne sont pas de même nature. Les deux premières sont
tenues par le compilateur, les suivantes à la construction du registre :

| Garantie | Où elle est tenue | Ce qui échoue si on la viole |
|---|---|---|
| Un identifiant de module inconnu est refusé | le **compilateur** (`config/features.ts` est typée depuis l'annuaire) | `pnpm typecheck` |
| Une catégorie de données sans politique de rétention est refusée | le **compilateur** (`retention` est indexée par `dataCategories`) | `pnpm typecheck` |
| Un template d'email sans version dans une locale livrée est refusé | le **compilateur** (`emails[].locales` est indexé par les locales de `messages`) | `pnpm typecheck` |
| Requis manquant, cycle, auto-référence, identifiant en double | `resolveEnabledModules`, à la construction du registre | `pnpm test`, et le démarrage de l'application |
| Template d'email incomplet, clé de navigation sans traduction, collision de route entre deux modules | `assertDeclarationsAreComplete`, à la construction du registre | `pnpm test`, et le démarrage de l'application |

Les garanties de typage ne doivent **jamais** être dégradées en vérification
d'exécution : une contrainte portée par le compilateur ne se contourne pas, une
validation au démarrage se découvre en production. Les deux dernières lignes ne
sont pas du typage par choix mais par nécessité — le graphe des requis et les
collisions entre modules ne sont connus qu'une fois l'annuaire assemblé.

`requires` est typée `readonly string[]` et non `readonly ModuleId[]` : l'union
des identifiants vient de l'annuaire de `config/features.ts`, qui importe les
modules. La typer depuis cette union fermerait le cycle. Une faute de frappe
dans un requis est donc attrapée à la construction du registre, pas à la
compilation — asymétrie assumée avec `enabledModules`, écrite dans le contrat.

Le contrat porte aussi la **protection** des routes **et** des entrées de
navigation, et les deux sont lues : `dispatchModuleRequest` refuse une route non
satisfaite, `visibleNavigation` retire l'entrée correspondante. La règle
elle-même (`satisfiesProtection`) est écrite une seule fois, dans
`src/protection.ts` — deux implémentations divergeraient au premier rôle ajouté.

La clé `jobs` déclare les tâches planifiées d'un module. Elle est **déclarative**
comme `routes` et `webhooks` : l'ordonnanceur de s33 se branchera sur le
registre, jamais sur un enregistrement à l'import — une tâche qui s'enregistre
en se chargeant s'exécuterait pour un module que la configuration n'active pas.

## Imports autorisés

- rien à l'exécution : ce package est une feuille du graphe, sans dépendance de
  production. Il ne connaît ni Drizzle, ni Next, ni la base de données ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

Le contrat décrit le schéma d'un module comme un simple
`Record<string, unknown>` — la structure exacte des tables appartient au module
et à `@repo/db`. C'est ce qui permettra à la composition de schémas de
s04 de consommer un module sans que `@repo/core` dépende de l'ORM.

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
ce package vit dans `src/**/*.test.ts` : c'est le cas de
`src/protection.test.ts`, qui énumère la règle d'accès là où elle est écrite.
Ses appelants — la navigation de `apps/web`, le répartiteur — prouvent qu'ils
l'appellent ; ils ne rejouent pas la matrice.

Les contraintes portées par le compilateur ne se prouvent pas avec
`expectTypeOf` : elles se prouvent en compilant réellement des fichiers qui
doivent échouer (`tests/fixtures/typing/`). Une contrainte de typage qu'aucune
commande n'a vue échouer n'existe pas.
