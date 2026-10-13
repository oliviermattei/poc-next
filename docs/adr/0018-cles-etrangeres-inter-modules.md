# ADR 018 — Une clé étrangère inter-modules est permise si et seulement si la cible est un requis déclaré

- Status: accepted
- Date: 2026-08-30

Une clé étrangère d'un module vers un module que l'on peut couper rend le premier silencieusement non désactivable. Or `resolveEnabledModules` refuse déjà d'activer un module sans ses `requires`, en nommant les deux : une cible requise ne peut pas disparaître sous la référence. Une clé étrangère d'un module `A` vers une table d'un module `B` est donc permise si et seulement si `B` appartient à la clôture transitive des `requires` de `A` ; toute autre référence inter-modules est refusée à la génération (`assertNoForbiddenModuleReferences`, `packages/db/src/references.ts`, appelée par `pnpm db:generate`), en nommant les deux modules et la table. La règle est dérivée des déclarations, sans liste de modules en dur : un module qui référence `auth` déclare `auth` dans ses `requires`.

## Considered options

- Aucune clé étrangère inter-modules, jamais — rejeté : elle interdit un couplage que le registre rend déjà sûr, et pousse à référencer par identifiant nu, ce qui perd l'intégrité référentielle sans gagner en séparabilité.
- Une liste de modules du socle référençables — rejetée : une liste en dur à maintenir, alors que `requires` exprime déjà la dépendance.
- Pas de garde, confiance à la relecture — rejeté : une clé oubliée rend un module non désactivable sans qu'aucune commande n'échoue.

## Consequences

- Une clé étrangère inter-modules impose un ordre de purge que `requires` ne dit pas : la purge va du dépendant vers son requis (ADR 029).
- La garde attribue chaque table à un seul module : si deux modules déclaraient la même table physique, son attribution serait fausse.
