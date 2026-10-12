# ADR 006 — Clean architecture, appliquée à l'intérieur de chaque module

- Status: accepted
- Date: 2026-08-30
- Scope: framing

## Context
Le boilerplate doit rester compréhensible et modifiable par son propriétaire, et chaque module doit pouvoir changer de provider (base, mail, storage, paiement) sans que la logique métier bouge. ShipSaaS revendique une architecture en trois couches ; le PRD en fait un point de départ.

## Decision
Quatre couches à l'intérieur de chaque module, avec une règle de dépendance orientée vers le centre :

- `domain/` — entités et règles métier pures. Aucune importation de framework, d'ORM ni de SDK.
- `application/` — cas d'usage et **ports** (interfaces des dépendances externes). Dépend de `domain` uniquement.
- `infrastructure/` — implémentations des ports : repositories Drizzle, appels aux adapters (mail, storage, paiement). Dépend de `application` et `domain`.
- `presentation/` — routes Hono, contrats oRPC, composants React, entrées de navigation. Dépend de `application` et `domain`.

`infrastructure` et `presentation` ne se connaissent pas. La règle est vérifiée mécaniquement par une règle de lint sur les frontières d'import, exécutée en CI (s02).

## Considered options
- Découpage technique global (`components/`, `services/`, `lib/`) — rejeté : c'est le découpage par défaut de Next, et il rend un module inséparable puisque ses morceaux sont dispersés dans quatre dossiers partagés.
- Architecture hexagonale complète avec inversion de dépendances systématique — rejeté : le surcoût de cérémonie n'est pas justifié pour un CRUD, et un boilerplate illisible ne vaut rien.
- Aucune règle imposée — rejeté : la première story qui triche fait s'écrouler l'angle n°1, et le PRD identifie ce risque comme le principal du projet.

## Consequences
Facilité : changer de provider revient à écrire une implémentation de port ; la logique métier est testable sans base ni réseau.
Difficulté : plus de fichiers pour une fonctionnalité simple ; la tentation de court-circuiter les couches sur un CRUD trivial est réelle.
À surveiller : le lint de frontières est ce qui fait la différence entre une architecture et une intention. S'il est désactivé, la règle disparaît en quelques stories.
