# tooling/typescript — règles locales

Configurations `tsconfig` partagées : `base.json` pour les packages,
`nextjs.json` pour les applications. Aucun code, aucune dépendance.

## Imports autorisés

Aucun. Ce package ne contient que du JSON ; il n'importe rien et rien ne
l'importe autrement que par `extends`.

## Ne doit jamais contenir

- de configuration propre à un package : un besoin local s'exprime dans le
  `tsconfig.json` du package, par surcharge ;
- d'assouplissement des vérifications strictes. `strict`,
  `noUncheckedIndexedAccess`, `noUnusedLocals` et `verbatimModuleSyntax` sont
  le contrat du dépôt — les désactiver rendrait `pnpm typecheck` décoratif.

## Tests

Aucun test propre. Ces fichiers sont éprouvés par `pnpm typecheck`, qui compile
la racine, `tests/` et chaque package avec eux.
