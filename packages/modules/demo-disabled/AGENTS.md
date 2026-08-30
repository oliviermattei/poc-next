# packages/modules/demo-disabled — règles locales

Module de démonstration **non activé**, et c'est tout son intérêt : il est le
témoin permanent de la promesse n°1 du produit — un module absent de
`config/features.ts` n'expose ni route, ni entrée de navigation, et ses
fonctions de purge et d'export ne sont jamais appelées.

Il est écrit exactement comme un module réel : quatre couches, contrat complet,
routes protégées, traductions. Rien en lui ne sait qu'il est désactivé — aucun
drapeau, aucun `if`. Ce qui le rend invisible est ailleurs : le registre
n'agrège que les modules nommés par la configuration.

Il déclare `requires: ['demo-enabled']`, ce qui en fait aussi le cas de test de
la validation du graphe : l'activer sans son requis échoue en nommant le module
manquant.

**Ne pas l'activer** : deux tests perdraient leur objet. La suite doit passer
dans les deux états, mais l'état de référence du dépôt est celui-ci.

## Imports autorisés

- `@repo/core` pour le contrat de module ;
- `zod` pour la validation, y compris dans `domain/` ;
- `drizzle-orm` pour la déclaration des tables, dans `src/schema.ts` et dans
  `infrastructure/` uniquement ;
- `@repo/typescript-config` pour la configuration du compilateur.

## Ne doit jamais contenir

- de règle métier hors de `domain/` ;
- de framework, d'ORM, de SDK ni de module Node dans `domain/` ;
- d'import d'un autre module de démonstration : la dépendance se déclare par
  `requires`, jamais par un import — sinon désactiver l'un casserait l'autre à
  la compilation, ce que ce module existe précisément pour interdire ;
- de code qui teste son propre état d'activation.

## Tests

Depuis `tests/` à la racine, `tests/module-off.test.ts` en particulier : ce
module ne se prouve que par l'absence, et l'absence s'observe depuis
l'application, pas depuis le module.
