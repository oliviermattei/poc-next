# packages/config — règles locales

Point d'accès **unique** à l'environnement. Tout ce qui lit une variable passe
par ici ; aucun autre module du dépôt ne touche `process.env`.

Deux surfaces, et la distinction est structurante :

| Entrée | Contenu | Qui l'importe |
|---|---|---|
| `@repo/config` | schéma Zod, validation, `getEnv`, `assertStartupEnv` | n'importe qui, y compris un composant client |
| `@repo/config/server` | chargement du `.env` racine (`node:fs`, `node:path`) | ce qui s'exécute côté serveur, uniquement |

## Imports autorisés

- `zod` pour la validation ;
- `dotenv` pour le chargement de fichier — **dans `src/dotenv.ts` seulement** ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

Aucun module Node (`node:fs`, `fs`, `node:path`…) hors de `src/dotenv.ts` et
`src/server.ts`. La règle n'est pas documentaire : `eslint.config.ts` la fait
échouer, y compris en `require` et en import dynamique, et
`tests/lint-rules.test.ts` le prouve. Ce package hébergera les variables
`NEXT_PUBLIC_*` : le premier composant client qui l'importe traînerait sinon
`node:fs` dans le graphe client.

## Ne doit jamais contenir

- de valeur par défaut de complaisance pour une variable requise : une variable
  absente ou malformée doit faire échouer le démarrage en se nommant ;
- de secret, ni de valeur propre à un environnement — `.env.example` ne porte
  que des valeurs de développement local ;
- d'import d'un autre package du dépôt : c'est la feuille du graphe, tout le
  monde en dépend et il ne dépend de personne.

## Tests

`src/**/*.test.ts`, à côté du code qu'ils couvrent (`pnpm test`). Ce qui
concerne le **câblage** de l'environnement vers l'application (turbo,
`next.config.ts`) vit dans `tests/` à la racine : ça traverse plusieurs
packages.
