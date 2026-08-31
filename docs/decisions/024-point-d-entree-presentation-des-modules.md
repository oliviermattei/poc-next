# ADR 024 — Un module à composants expose sa présentation par un second point d'entrée

- Status: accepted
- Date: 2026-08-31
- Scope: story s10-marketing-site

## Context

L'ADR 006 pose quatre couches par module, dont `presentation/`. L'ADR 007 pose
un contrat de module unique, importé par `config/features.ts` — le fichier que
lit l'annuaire des modules (ADR 016). `marketing` est le **premier module qui
livre des composants React** ; les suivants (facturation, organisations,
notifications) le seront aussi.

Le barril d'un module (`src/index.ts`) est donc lu par deux publics qui n'ont
rien en commun :

- l'**application**, qui compile du JSX et rend les écrans ;
- les **outils du dépôt** — `pnpm db:generate`, `pnpm ks`, et le `typecheck` de
  `@repo/db`, qui remonte jusqu'à `config/features.ts` par l'agrégat de schémas
  généré (ADR 020). Aucun d'eux ne compile de JSX, et aucun n'a de raison de le
  faire : ils lisent un contrat, pas une interface.

La contrainte a été **mesurée deux fois**, à l'implémentation puis à la revue, et
une troisième fois en écrivant cet ADR. En ajoutant
`export { MarketingHome } from './presentation/marketing-home'` au barril,
`pnpm exec turbo run typecheck --force` donne :

```
@repo/db:typecheck: ../modules/marketing/src/index.ts(55,31): error TS6142:
Module './presentation/marketing-home' was resolved to '…/marketing-home.tsx',
but '--jsx' is not set.
```

Ce n'est pas une gêne de compilation isolée : c'est un **couplage**. Réexporter
du `.tsx` depuis le barril oblige chaque outil qui lit le contrat d'un module à
savoir compiler du JSX, aujourd'hui et à chaque module ajouté ensuite.

## Decision

Un module qui livre des composants les expose par un **second point d'entrée**,
`@repo/module-<nom>/presentation`, déclaré dans les `exports` de son
`package.json`. Le barril principal n'exporte **jamais** de `.tsx`, ni
directement ni par réexport.

Le barril principal porte le contrat, le domaine et l'application ; le second
point d'entrée porte la couche `presentation`. Seule `apps/web` importe le
second.

La règle est exécutable : `pnpm typecheck` échoue — sur `@repo/db`, pas sur le
module fautif — dès qu'un barril de module réexporte du JSX.

## Considered options

- **Activer `jsx` dans le `tsconfig.json` de `@repo/db`** (et de tout outil qui
  remonte jusqu'à `config/features.ts`) — rejeté : fait payer à la couche base
  de données une contrainte d'interface, et il faudrait le refaire pour chaque
  outil ajouté. C'est le couplage lui-même qu'on entérinerait, au lieu de le
  supprimer.
- **Sortir les composants du module, vers `packages/ui` ou vers `apps/web`** —
  rejeté : contredit l'ADR 006, qui veut la `presentation` **dans** le module, et
  l'ADR 007, dont tout l'intérêt est qu'un module coupé emporte ses écrans avec
  lui. `packages/ui` est le design system, pas un dépotoir d'écrans métier.
- **Compiler le module vers du JavaScript avant de l'exposer** (un `dist/` par
  module) — rejeté : introduit une étape de build par module, un artefact à
  garder à jour et une source de divergence entre le code lu et le code exécuté,
  pour un dépôt qui consomme ses paquets par les sources.
- **Un point d'entrée par composant** (`…/presentation/marketing-home`) —
  rejeté : multiplie les entrées de `exports` à maintenir sans rien apporter ; le
  public de la couche `presentation` est unique et la sépare déjà du contrat.

## Consequences

Facilité : les outils du dépôt restent ignorants du JSX ; un module coupé emporte
ses écrans ; l'application ne peut pas atteindre la `presentation` d'un module par
mégarde depuis un chemin qui n'en a pas besoin.

Difficulté : deux barils à maintenir par module à composants, et un `exports` à
écrire correctement dans son `package.json`. Un générateur de module (`npx ks`,
ADR 013 « générer, ne pas deviner ») doit poser les deux dès le squelette, sans
quoi chaque module recommencera la découverte par l'erreur TS6142.

À surveiller : le jour où un module aura besoin d'exposer un type partagé entre
son domaine et sa présentation, il devra vivre dans le barril principal (un type
ne porte pas de JSX) et être réexporté par le second — jamais l'inverse.
