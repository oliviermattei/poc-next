# ADR 001 — Stack de base : Next.js, TypeScript, Tailwind, shadcn/ui

- Status: accepted
- Date: 2026-08-30

Le PRD impose Next.js (App Router) et TypeScript, et le produit doit être immédiatement reconnaissable par qui le reprend. Nous retenons Next.js (App Router, React Server Components), TypeScript en mode strict, Tailwind CSS et shadcn/ui. shadcn/ui n'est pas une dépendance : ses composants sont copiés dans `packages/ui`, posés sur Radix (ADR 022), et modifiables sans fork.

## Considered options

- Une bibliothèque de composants packagée (MUI, Mantine, Chakra) — rejetée : le code n'appartient pas au projet, la personnalisation passe par des thèmes, et le design system deviendrait un jeu de surcharges au lieu d'un ensemble de composants possédés.

## Consequences

- Les composants étant copiés, leurs mises à jour amont sont manuelles : `docs/design-system.md` fait foi, pas la version amont de shadcn/ui.
- Les Server Components obligent à tracer explicitement la frontière serveur/client dans chaque module.
