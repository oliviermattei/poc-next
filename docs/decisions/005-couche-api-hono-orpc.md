# ADR 005 — Couche API : Hono monté dans Next, contrats oRPC

- Status: accepted
- Date: 2026-08-30
- Scope: framing

## Context
Chaque module doit exposer ses propres routes, et les monter ou non selon `config/features.ts`. Il faut par ailleurs de vrais endpoints HTTP pour les webhooks Stripe (s19, s20) et Inngest (s33), un typage de bout en bout entre le front et le back, et la possibilité de sortir l'API de Next si un projet le demande.

## Decision
Un serveur Hono unique, monté dans l'application Next par un route handler attrape-tout (`apps/web/app/api/[[...route]]/route.ts`). Le serveur vit dans `packages/api` ; chaque module fournit un sous-routeur Hono que le registre monte selon la configuration.

oRPC fournit les contrats typés entre le client et le serveur, avec TanStack Query côté client.

Un seul déploiement en pratique : l'API n'est pas un service séparé. Le découpage en package rend l'extraction ultérieure possible sans réécrire les routes.

## Considered options
- Server actions Next (choix MakerKit) — rejeté : indissociables du runtime Next, et « faire disparaître » un module revient à jouer sur la présence de fichiers dans `app/`, ce qui est bien plus subtil que ne pas monter un routeur. Les webhooks exigent de toute façon des route handlers.
- Hono en application séparée (choix Supastarter) — rejeté pour la v1 : impose deux déploiements, du CORS et une session partagée entre deux origines. Le gain de portabilité ne justifie pas cette plomberie dans un boilerplate.
- tRPC — rejeté : aucune des quatre cibles ne l'utilise plus, et pas d'OpenAPI générée.
- Route handlers Next nus — rejeté : ni contrats typés, ni middlewares composables, ni montage conditionnel simple.

## Consequences
Facilité : activer un module, c'est monter son routeur ; le désactiver, ne pas le monter. L'angle n°1 devient une propriété du code, pas une discipline.
Difficulté : une couche supplémentaire à connaître, et le typage front-back passe par oRPC au lieu d'être offert par Next.
À surveiller : ne pas laisser réapparaître des server actions en parallèle du serveur Hono — deux chemins d'écriture concurrents ruineraient la lisibilité et le montage conditionnel.
