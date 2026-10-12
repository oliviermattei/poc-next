# ADR 007 — Le module comme unité de composition

- Status: accepted
- Date: 2026-08-30
- Scope: framing

## Context
C'est l'angle n°1 du PRD : aucun des quatre concurrents ne sait retirer une feature. MakerKit masque avec treize booléens d'environnement en laissant les tables en base ; Supastarter configure sans découper. Le boilerplate doit produire un projet où un module non activé n'a laissé aucune trace.

## Decision
Un module est un package déclarant un contrat typé unique :

`id`, `requires` (modules requis), `schema` (tables Drizzle), `migrations`, `routes` (sous-routeur Hono), `navigation`, `messages` (traductions), `emails` (templates et leurs locales), `webhooks`, `purge`, `export`, `retention` (par catégorie de données : effacer ou anonymiser).

`config/features.ts` liste les modules activés. La configuration est typée et validée : un identifiant inconnu ne compile pas, un module activé sans ses `requires` échoue à la validation.

Sémantique de désactivation : un module **jamais activé** n'a jamais joué ses migrations, ses tables n'existent pas. Un module **activé puis désactivé** conserve ses tables et ses données — les supprimer serait `eject`, explicitement au cimetière du PRD.

## Considered options
- Booléens d'environnement (choix MakerKit) — rejeté : masque l'interface mais laisse le code et les tables. C'est exactement ce que le PRD reproche au marché.
- Fichiers `config.ts` par application (choix Supastarter) — rejeté : configure des comportements, ne découpe rien.
- Générateur de scaffolding retirant le code à la création (create-t3-app) — rejeté : choix irréversible, et deux codebases à maintenir (le générateur et le template).
- Contrat minimal étendu au fil des besoins — rejeté : ajouter `purge`, `export` ou `retention` après vingt modules obligerait à tous les rouvrir. Le contrat est complet dès le premier module, quitte à ce que certaines déclarations soient vides.

## Consequences
Facilité : la modularité est vérifiable (routes 404, navigation, tables absentes, suite de tests verte dans les deux états) ; les recettes s25 et s26 la prouvent en continu.
Difficulté : le contrat est large, donc coûteux à remplir pour un module trivial. Le générateur de squelette (s41) et le CLI (s05) existent pour absorber ce coût.
À surveiller : une clé étrangère d'un module vers un module optionnel le rend silencieusement non désactivable. s04 la refuse à la génération.
