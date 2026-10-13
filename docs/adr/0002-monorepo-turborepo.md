# ADR 002 — Monorepo Turborepo + pnpm

- Status: accepted
- Date: 2026-08-30

Un module doit être une unité réellement séparable (schéma, routes, navigation, traductions, emails, purge, export) et pouvoir être absent sans laisser de trace. Dans une application Next.js unique, cette frontière est déclarative — on peut toujours importer un fichier voisin — donc invérifiable. Le dépôt est donc un monorepo Turborepo sous pnpm, où chaque module est un package : un import non déclaré dans `package.json` échoue. `apps/` porte les applications, `packages/` le cœur, les ports et adapters, l'UI et les modules, `tooling/` les configurations partagées.

## Considered options

- Une application Next.js avec un dossier par module — rejetée : la frontière n'est pas vérifiable mécaniquement, la modularité reposerait sur la discipline.
- Nx — rejeté : plus puissant mais nettement plus lourd à s'approprier pour le propriétaire du projet.
- Bun workspaces — rejetés : l'écosystème Next.js et Vercel documente pnpm, et le dépôt doit fonctionner sans friction sur la cible de déploiement de référence.

## Consequences

- Un package par module multiplie les `package.json` et les configurations : le générateur `pnpm ks scaffold` (`packages/cli/AGENTS.md`) est ce qui rend ce coût supportable.
- Un package « shared » fourre-tout recréerait le couplage que le monorepo empêche ; il n'en existe pas.
