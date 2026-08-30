# ADR 010 — Dernières majeures stables, verrouillées par le lockfile

- Status: accepted
- Date: 2026-08-30
- Scope: framing

## Context
Un boilerplate se juge en partie sur sa fraîcheur : démarrer un projet en 2026 sur Tailwind v3 ou React 18 revient à livrer une dette le premier jour. À l'inverse, courir après chaque version rend le dépôt instable et les mises à jour ingérables pour un acheteur.

## Decision
Le boilerplate vise les **dernières majeures stables** de ses dépendances, jamais les versions candidates ni les canaries. Les majeures retenues au moment du cadrage :

Next.js 16 (App Router, Turbopack) · React 19 · **Tailwind CSS v4** · TypeScript 5.9+ · pnpm 10+ · Node 20.10+ · Drizzle · Better Auth · Hono · oRPC · TanStack Query · next-intl · Zod · Vitest · Playwright · Turborepo.

Les versions exactes sont figées par le lockfile lors de l'exécution de s01, jamais écrites à la main dans un document. Ce fichier nomme des majeures, pas des numéros de correctif.

Conséquence directe pour Tailwind v4 : **la configuration est en CSS, pas en JavaScript.** Pas de `tailwind.config.js` ; les tokens vivent dans une directive `@theme` du fichier CSS racine, et le point d'entrée est `@import "tailwindcss"`.

## Considered options
- Épingler des versions dans la documentation — rejeté : la doc dérive du lockfile en quelques semaines et devient un piège pour l'implémenteur.
- Suivre les versions candidates pour être « en avance » — rejeté : un boilerplate doit être ennuyeux à installer. Les régressions amont se paieraient sur chaque projet dérivé.
- Rester sur les majeures précédentes (Tailwind v3, React 18) pour la stabilité — rejeté : MakerKit tourne déjà en Next 16 / React 19 / Tailwind 4. Démarrer une majeure en retard, c'est naître obsolète.

## Consequences
Facilité : projets dérivés modernes, alignés avec la documentation amont la plus récente.
Difficulté : Tailwind v4 change la configuration (CSS au lieu de JavaScript) et une partie des exemples en ligne sont encore en v3. Les recettes trouvées doivent être traduites, pas copiées.
À surveiller : la mise à jour des majeures est un travail de maintenance récurrent, sans propriétaire déclaré tant que le boilerplate n'est pas vendu.
