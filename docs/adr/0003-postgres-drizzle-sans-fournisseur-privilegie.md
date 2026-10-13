# ADR 003 — PostgreSQL + Drizzle, sans fournisseur privilégié

- Status: accepted
- Date: 2026-08-30

Le PRD impose PostgreSQL et Drizzle et laisse le fournisseur ouvert ; le dépôt doit se déployer aussi bien sur Vercel que sur un serveur Coolify. Nous retenons PostgreSQL 16+, Drizzle ORM et des migrations SQL versionnées (`pnpm db:generate`, `pnpm db:migrate`), jamais `push`. Le fournisseur est isolé dans `packages/db` : une seule variable, `DATABASE_URL`, et un point d'entrée unique (`createDatabaseClient`) sur le pilote standard `node-postgres`. Aucune fonctionnalité propriétaire d'un fournisseur n'est utilisée, si bien que passer d'un PostgreSQL conteneurisé à un service managé (Neon, Supabase, RDS) ne change que la chaîne de connexion.

## Considered options

- Supabase comme base et plateforme — rejeté : on n'utiliserait ni son auth (ADR 004), ni son realtime (graveyard du PRD) ; le verrou serait payé sans contrepartie.
- Prisma — rejeté : le PRD nomme Drizzle, et composer un schéma par module est plus direct avec un schéma en TypeScript ordinaire.

## Consequences

- Les raccourcis propres à un fournisseur (branches de base Neon, par exemple) restent possibles en CI mais ne deviennent jamais une dépendance du code.
- Le mode serverless et le mode conteneur n'ont pas la même stratégie de connexions ; elle est encapsulée dans `packages/db`, et rendre la taille du pool configurable est ouvert (#147).
