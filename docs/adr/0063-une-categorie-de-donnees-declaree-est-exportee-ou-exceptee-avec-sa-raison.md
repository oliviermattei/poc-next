# ADR 063 — Une catégorie de données déclarée est exportée, ou exceptée avec sa raison

- Status: accepted
- Date: 2026-09-06

Le contrat de module porte trois clés qui parlent des mêmes données : `dataCategories` liste ce que le module détient, `purge` l'efface, `export` le restitue. Rien ne vérifiait leur accord : un module pouvait déclarer une catégorie, poser une rétention, purger pour de bon et rendre un export vide, et le compilateur comme le registre l'acceptaient.

**Chaque catégorie déclarée par un module activé est soit produite par l'export, soit nommée dans une table d'exceptions avec une raison écrite.** Le garde est `auditDataCategoryCoverage` (`@repo/core`), et `pnpm test` échoue en nommant le module et la catégorie (`tests/data-export.test.ts`). Il rend trois constats : `not-exported` (des catégories non exceptées et un export sans aucune clé), `unexplained-exception` (une raison vide) et `stale-exception` (une exception qui ne correspond plus à aucune catégorie déclarée).

La table d'exceptions, `DATA_CATEGORY_EXCEPTIONS`, vit dans `tests/data-export.test.ts`. Elle porte `admin` / `grant-authorship` : la catégorie désigne `admin_platform_role.granted_by`, l'empreinte de l'auteur d'une promotion portée par la ligne d'un tiers. L'exporter à l'auteur lui remettrait des identifiants de comptes qui ne sont pas les siens ; l'exporter au bénéficiaire ne lui apprendrait rien de lui-même.

## Considered options

- **Une clé de contrat `exportedCategories`** — rejeté : toutes les clés du contrat sont obligatoires, chaque module devrait déclarer une valeur vide, et la question « pourquoi cette donnée ne sort-elle pas ? » n'a de réponse qu'en prose.
- **La table dans `config/`** — rejeté : ce n'est pas un réglage du propriétaire du projet, c'est une propriété du module.
- **La table dans `@repo/core`** — rejeté : le cœur ne connaît aucun module par son nom ; le garde reçoit la table.
- **Une correspondance catégorie → clés d'export écrite à la main** — rejeté : juste le jour où on l'écrit, fausse ensuite sans que rien ne le dise. Comparer les noms ne marche pas non plus (`billing` déclare `subscription` et rend `subscriptions`).

## Consequences

- Le garde travaille **par module** : un module qui rend une clé et en oublie trois passe. Un module aux catégories vraiment hétérogènes devra être scindé, ou cette décision rouverte.
- Il ne voit que les catégories déclarées : le rôle de superadmin part par cascade, n'a pas de catégorie, et n'apparaît pas dans l'export (issue #136).
- Toute nouvelle catégorie force une décision au moment de l'écrire, y compris « rien à exporter ».
