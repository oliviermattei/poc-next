# ADR 010 — Dernières majeures stables, verrouillées par le lockfile

- Status: accepted
- Date: 2026-08-30

Démarrer un projet sur une majeure déjà dépassée, c'est livrer une dette le premier jour ; courir après les préversions rend le dépôt instable. Le dépôt vise donc les dernières majeures stables de ses dépendances, jamais les versions candidates ni les canaries. Les versions exactes sont figées par le lockfile, jamais recopiées dans un document — une version écrite dans la doc dérive du lockfile en quelques semaines.

Le principe vaut aussi quand il coûte : TypeScript 7 est adopté pour compiler tout le dépôt (`pnpm typecheck`). Seule la chaîne de lint reste sur TypeScript 6, dans le seul package `tooling/eslint`, parce que `typescript-eslint` refuse de démarrer sur TypeScript 7 ; la raison et la condition de sortie sont dans `tooling/eslint/AGENTS.md`. Une divergence entre les deux se règle en alignant l'outillage, jamais en bridant le code.

## Considered options

- Rester sur la majeure précédente tant que tout l'écosystème n'a pas annoncé sa compatibilité — rejeté : c'est une attente sans échéance, et le coût d'une migration ne fait que croître avec le dépôt.

## Consequences

- Tailwind v4 se configure en CSS, pas en JavaScript : pas de `tailwind.config.js`, les jetons vivent dans la directive `@theme` de `packages/ui/src/styles.css`. Une recette trouvée en ligne pour la v3 se traduit, elle ne se copie pas.
- Monter les majeures est un travail de maintenance récurrent.
