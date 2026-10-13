# ADR 007 — Le module comme unité de composition

- Status: accepted
- Date: 2026-08-30

Retirer une fonctionnalité doit retirer ses routes, sa navigation et ses tables, pas seulement la masquer. Un module est donc un package qui déclare un contrat typé unique (`defineModule`, `packages/core/src/module.ts`) : `id`, `requires`, `schema`, `migrations`, `routes` (des `ModuleRoute`, ADR 085), `navigation`, `publicUrls` (ADR 054), `messages`, `emails`, `webhooks`, `jobs`, `dataCategories`, `retention`, `purge`, `export`. `config/features.ts` liste les modules activés ; un identifiant inconnu ne compile pas, et un module activé sans ses `requires` est refusé à la validation. Un module jamais activé n'a jamais joué ses migrations ; un module activé puis désactivé garde ses tables et ses données — les supprimer serait `eject`, au graveyard du PRD.

Toutes les clés sont obligatoires dès le premier module, quitte à être vides : ajouter `purge`, `export` ou `retention` après vingt modules obligerait à rouvrir les vingt. Une seule est facultative, `seeds` (ADR 069), parce que l'omettre ne laisse que du silence, là où omettre une clé obligatoire laisse un défaut sans propriétaire.

## Considered options

- Booléens d'environnement — rejetés : masquent l'interface et laissent code et tables.
- Un générateur qui retire le code à la création (à la create-t3-app) — rejeté : choix irréversible, et deux codebases à maintenir.
- Un contrat minimal étendu au fil des besoins — rejeté pour la raison ci-dessus.

## Consequences

- Une clé étrangère vers un module que l'on peut couper le rendrait non désactivable : la règle est l'ADR 018.
- Le contrat est large, donc coûteux pour un module trivial ; `pnpm ks scaffold` absorbe ce coût.
