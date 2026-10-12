# ADR 001 — Stack de base : Next.js, TypeScript, Tailwind, shadcn/ui

- Status: accepted
- Date: 2026-08-30
- Scope: framing

## Context
Le PRD impose Next.js (App Router) et TypeScript. Le produit est un boilerplate destiné à être revendable : la stack doit être celle que le marché attend, sous peine de rendre le travail inexploitable pour un acheteur. Les quatre cibles (Supastarter, MakerKit, ShipFast, ShipSaaS) sont toutes en Next.js ; MakerKit et Supastarter sont en shadcn/ui + Tailwind.

## Decision
Next.js (App Router, React Server Components), TypeScript en mode strict, Tailwind CSS et shadcn/ui comme couche de composants.

shadcn/ui n'est pas une dépendance mais un ensemble de composants copiés dans le dépôt : ils vivent dans `packages/ui` et sont modifiables sans fork.

## Considered options
- Nuxt 4 / Vue — rejeté : le PRD nomme Next.js, et l'écosystème SaaS (exemples, intégrations, acheteurs potentiels) est massivement React.
- Remix / React Router 7 — rejeté : aucune des cibles ne l'utilise, et l'avantage technique ne compense pas la perte de familiarité pour un produit dont la valeur est d'être immédiatement reconnaissable.
- Une bibliothèque de composants packagée (MUI, Mantine, Chakra) — rejeté : le code n'appartient pas au projet, la personnalisation passe par des thèmes, et le design system de `/ks-design-system` deviendrait un jeu de surcharges plutôt qu'un ensemble de composants possédés.

## Consequences
Facilité : écosystème le plus fourni, composants modifiables, alignement avec les quatre cibles.
Difficulté : les Server Components imposent de tracer explicitement la frontière serveur/client dans chaque module.
À surveiller : shadcn/ui étant copié, ses mises à jour amont sont manuelles. Le design system (`docs/design-system.md`) fait foi, pas la version amont.
