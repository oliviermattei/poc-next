# ADR 024 — Un module à composants expose sa présentation par un second point d'entrée

- Status: accepted
- Date: 2026-08-31

Le barril d'un module (`src/index.ts`) est lu par deux publics : l'application, qui compile du JSX, et les outils du dépôt — `pnpm db:generate`, `pnpm ks`, le `typecheck` de `@repo/db`, qui remonte jusqu'à `config/features.ts` par l'agrégat de schémas (ADR 020). Réexporter du `.tsx` depuis le barril obligerait chacun de ces outils à compiler du JSX (erreur TS6142 sur `@repo/db`), aujourd'hui et pour chaque module ajouté.

Un module qui livre des composants les expose donc par un second point d'entrée, `@repo/module-<nom>/presentation`, déclaré dans les `exports` de son `package.json`. Le barril principal porte le contrat, le domaine et l'application, et n'exporte jamais de `.tsx`, ni directement ni par réexport. Seule `apps/web` importe le second. `pnpm typecheck` échoue — sur `@repo/db`, pas sur le module fautif — dès qu'un barril réexporte du JSX.

## Considered options

- **Activer `jsx` dans le `tsconfig` de `@repo/db` et des outils** — rejeté : entérine le couplage au lieu de le supprimer, et se refait à chaque outil ajouté.
- **Sortir les composants vers `packages/ui` ou `apps/web`** — rejeté : un module coupé doit emporter ses écrans (ADR 006, 007), et `packages/ui` est le design system, pas un dépôt d'écrans métier.
- **Compiler chaque module vers un `dist/`** — rejeté : une étape de build par module et une divergence possible entre code lu et code exécuté, dans un dépôt qui consomme ses paquets par les sources.

## Consequences

Un type partagé entre domaine et présentation vit dans le barril principal (un type ne porte pas de JSX) et est réexporté par le second — jamais l'inverse.
