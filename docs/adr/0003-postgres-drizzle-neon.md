# ADR 003 — PostgreSQL + Drizzle, provider interchangeable, Neon par défaut

- Status: accepted
- Date: 2026-08-30
- Scope: framing

## Context
Le PRD impose PostgreSQL et Drizzle et laisse le provider ouvert. Deux contraintes s'ajoutent : le boilerplate doit se déployer aussi bien sur Vercel (cible de référence) que sur un serveur Coolify, et l'accès à la base doit être traité comme un module pour qu'un autre provider puisse être branché.

## Decision
PostgreSQL, Drizzle ORM, migrations SQL versionnées (`drizzle-kit generate`), jamais `push` en production.

Le provider est une préoccupation d'infrastructure isolée dans `packages/db` : une seule variable (`DATABASE_URL`) et un point d'entrée unique construisent le client. Neon est l'implémentation par défaut ; un PostgreSQL conteneurisé sur Coolify est documenté et testé dès le départ, en développement local comme en production.

Aucune fonctionnalité propriétaire d'un provider n'est utilisée : le SQL produit doit tourner sur n'importe quel PostgreSQL 16+.

## Considered options
- Supabase comme base et plateforme — rejeté : c'est le couplage qui a privé MakerKit d'ORM. On n'utiliserait ni son auth (Better Auth est retenu), ni son realtime (cimetière), et le storage S3 se branche ailleurs. Le verrou serait payé sans contrepartie.
- Prisma — rejeté : le PRD nomme Drizzle, et la composition d'un schéma par module est nettement plus directe avec Drizzle, dont le schéma est du TypeScript ordinaire.
- Postgres auto-hébergé uniquement — rejeté comme défaut : prive des branches de base par prévisualisation et alourdit le déploiement Vercel de référence. Reste documenté et supporté.

## Consequences
Facilité : un projet généré peut migrer de Neon vers Coolify sans changer une ligne de code applicatif.
Difficulté : s'interdire les fonctionnalités propriétaires ferme quelques raccourcis (Neon branching en CI reste possible, mais ne doit jamais devenir une dépendance du code).
À surveiller : le pooling. Le mode serverless et le mode conteneur n'ont pas la même stratégie de connexions ; `packages/db` doit encapsuler ce détail.
