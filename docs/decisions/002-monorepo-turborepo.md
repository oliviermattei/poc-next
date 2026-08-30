# ADR 002 — Monorepo Turborepo + pnpm

- Status: accepted
- Date: 2026-08-30
- Scope: framing

## Context
L'angle n°1 du PRD exige qu'un module soit une unité réellement séparable : schéma, routes, navigation, traductions, emails, purge, export. Un module doit pouvoir être absent sans laisser de trace. Une application Next.js monolithique rend cette frontière déclarative — on peut toujours importer un fichier voisin — donc invérifiable.

## Decision
Monorepo Turborepo, gestionnaire pnpm. Chaque module applicatif est un package. Les frontières entre packages sont réelles : un import non déclaré dans `package.json` échoue.

Découpage : `apps/` pour les applications déployables, `packages/` pour le noyau, les adapters, l'UI et les modules, `tooling/` pour les configurations partagées.

## Considered options
- Application Next.js unique avec des dossiers par module — rejeté : la frontière n'est pas vérifiable mécaniquement, donc l'angle n°1 repose sur la discipline. C'est exactement le défaut de MakerKit, dont les tables `organizations` restent en base module coupé.
- Nx — rejeté : plus puissant mais nettement plus lourd à comprendre pour un acheteur qui doit s'approprier le dépôt en une heure. Turborepo est le choix de MakerKit.
- Bun workspaces — rejeté ici malgré son usage sur d'autres projets : l'écosystème Next.js et Vercel documente pnpm, et le boilerplate doit fonctionner sans friction sur la cible de déploiement de référence.

## Consequences
Facilité : la modularité devient vérifiable par le graphe de dépendances, pas par la relecture ; le cache Turborepo accélère la CI.
Difficulté : un package par module multiplie les `package.json` et les configurations ; le générateur de squelette de module (s41) devient indispensable plutôt que confortable.
À surveiller : la tentation d'un package « shared » fourre-tout, qui recréerait le couplage que le monorepo doit empêcher.
