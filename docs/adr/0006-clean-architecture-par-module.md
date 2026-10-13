# ADR 006 — Clean architecture, appliquée à l'intérieur de chaque module

- Status: accepted
- Date: 2026-08-30

Chaque module doit pouvoir changer de fournisseur (base, mail, stockage, paiement) sans que sa logique métier bouge, et rester lisible par le propriétaire du projet. Un module a donc quatre couches, dépendant vers le centre : `domain/` (règles pures, sans framework, ORM ni SDK) ; `application/` (cas d'usage et ports, ne dépend que de `domain`) ; `infrastructure/` (repositories Drizzle, appels aux adapters) et `presentation/` (déclarations `ModuleRoute`, ADR 085, et composants React), qui dépendent de `application` et `domain` et ne se connaissent pas. La règle est tenue par le lint (`tooling/eslint/boundaries.ts`, prouvé par `tests/lint-rules.test.ts`), pas par la relecture : sans lui, l'architecture n'est qu'une intention.

## Considered options

- Découpage technique global (`components/`, `services/`, `lib/`) — rejeté : le module serait dispersé dans des dossiers partagés, donc inséparable.
- Hexagonal complet avec inversion de dépendances systématique — rejeté : la cérémonie ne se justifie pas pour un CRUD, et un boilerplate illisible ne vaut rien.

## Consequences

- Plus de fichiers pour une fonctionnalité simple ; la tentation de court-circuiter les couches sur un CRUD trivial est réelle, et c'est le lint qui la refuse.
- Un module à composants expose `presentation` par un second point d'entrée (ADR 024) ; un module-processus sans couches en est exempté au prix d'une garde de remplacement (ADR 042).
