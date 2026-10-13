# tooling/eslint — règles locales

Presets ESLint partagés, en **configuration plate** (ESLint 10 a supprimé
`.eslintrc` : toute recette antérieure à ESLint 9 est inapplicable). Un seul
fichier de configuration existe dans le dépôt, `eslint.config.ts` à la racine ;
ce package lui fournit ses briques.

| Fichier | Rôle |
|---|---|
| `base.ts` | règles communes, exclusions globales |
| `boundaries.ts` | règle de dépendance des couches (ADR 006) |
| `library.ts` | packages de bibliothèque : ne jamais dépendre d'une application |
| `next.ts` | règles Next et React Hooks, restreintes à `apps/web` |

## Imports autorisés

`@eslint/js`, `eslint`, `typescript-eslint`, `eslint-plugin-boundaries`,
`@next/eslint-plugin-next`, `eslint-plugin-react-hooks`, `globals`,
`typescript`. Rien du dépôt : ce package est chargé avant tout le reste.

**`typescript` y est en version 6, et c'est voulu.** `typescript-eslint` refuse
de démarrer sur TypeScript 7 (« typescript-eslint does not support TS 7.0 ») ;
Microsoft documente le fonctionnement côte à côte, les outils qui ont besoin de
l'API restant en 6.0. Ce package est le **seul** endroit du dépôt où TypeScript
6 apparaît : `pnpm typecheck` compile tout le code avec TypeScript 7 (ADR 010).
Aucun code applicatif n'est compilé avec TypeScript 6.

Pourquoi deux versions plutôt qu'une : sans parser TypeScript, ni la règle de
frontières de couches (ADR 006) ni le lint n'existent, et redescendre tout le
dépôt en TypeScript 6 laisserait un outil dicter la version qui compile le
code. Le risque de ce régime est une divergence entre ce que le compilateur
accepte et ce que le parser de lint comprend : si une syntaxe propre à
TypeScript 7 fait échouer le lint sur du code valide, la réponse est d'aligner
l'outillage, jamais de brider la syntaxe du code applicatif.

Ne pas propager cette version ailleurs, ni l'épingler à la racine. La lever —
aligner `typescript` de ce package sur celui de la racine — dès que
`typescript-eslint` supporte TypeScript 7 (issue typescript-eslint#10940).

## Ne doit jamais contenir

- de règle qui ne peut échouer sur rien de réel. Une règle est prouvée par un
  cas qu'on a vu passer au rouge, sinon elle n'existe pas ;
- de désactivation globale d'une règle de frontière : une exception se nomme,
  se borne et s'écrit — jamais par omission ;
- d'analyse typée (`projectService`) : elle exigerait que chaque fichier linté
  appartienne à un `tsconfig`, ce qui exclurait l'arborescence de fixtures qui
  prouve la règle de frontières.

## Tests

`tests/lint-rules.test.ts` à la racine : il exécute ces presets sur
`tests/fixtures/layers/`, où chaque arête interdite est réellement violée.
