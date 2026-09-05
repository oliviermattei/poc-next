# packages/modules/jobs — règles locales

Le module qui **fait tourner les tâches des autres** (s33). Il n'apporte aucune
fonctionnalité de produit : il apporte le registre d'exécutions (`job_run`) et la
route par laquelle le fournisseur rappelle. Il est un module — et non du socle —
parce que le dépôt n'a **qu'un** mécanisme pour qu'une table ait un
propriétaire, une migration et un journal de migration : le contrat de module
(ADR 007). C'est le raisonnement de `rate-limit` (s28), repris.

## Ce qui vit ici, et ce qui vit dans `@repo/core`

La distinction n'est pas cosmétique : elle est ce qui fait exister le critère 8.

| | Où | Pourquoi |
|---|---|---|
| trouver la tâche déclarée, dédupliquer, reprendre, journaliser | `@repo/core` (`dispatchModuleJob`) | la règle doit répondre **quand ce module-ci est coupé** — c'est ce qui rend l'émission synchrone possible. Même raison que `resolveDataOwner` et `allowsFeature` |
| la table `job_run`, son accès et son balayage | ici | une table a besoin d'un propriétaire, d'une migration — et d'une purge, sans quoi elle croît sans borne |
| la route de rappel | ici | coupé, elle n'est dans aucune table de routage : 404 sans qu'aucun `if` ne le décide. **Montée sans fournisseur derrière, elle répond 503**, pas 404 — l'endroit existe, c'est le fournisseur qui manque, et `e2e/modules.spec.ts` refuse un 404 sur la route publique d'un module activé |
| choisir entre le fournisseur et l'exécuteur local | `apps/web/lib/jobs-config.ts` | c'est de la configuration, et le module ne lit aucune variable |

**Il déclare exactement une tâche : le balayage de son propre registre**
(`jobs.sweep-job-runs`, quotidienne à 03:25 UTC, rétention de sept jours). Il
exécute celles des autres modules, il n'en possède qu'une — et celle-là n'est pas
facultative : sans elle, `job_run` croîtrait sans borne, c'est-à-dire que cette
story rejouerait sur une table neuve le défaut qu'elle corrige sur
`rate_limit_window`.

**La rétention se déduit de ce que la table sert**, et le raisonnement vit à côté
de la constante (`infrastructure/drizzle-job-ledger.ts`) : le registre n'existe
que pour dédupliquer, donc sa fenêtre n'a qu'à survivre au plus long rejeu contre
lequel il protège — les 24 heures sur lesquelles le fournisseur déduplique
lui-même par identifiant d'événement, et le rejeu opérationnel d'un incident,
qu'on répare dans la semaine.

**Ce que le plancher de l'ordonnanceur ne tient pas** : `assertJobsAreRunnable`
exige « au moins une tâche », pas « ce module-ci en déclare une ». Mesuré —
ramener ce module à `jobs: []` laisse le plancher vert, parce que `rate-limit` et
`billing` le satisfont. Ce sont deux cas **nommés** de `tests/jobs.test.ts` qui
rougissent alors.

**`run` est un condensat** (`schema.ts`), comme la clé de seau de
`rate_limit_window` et pour la même raison : la clé d'idempotence est construite
par l'appelant, et rien ne garantit qu'elle ne porte pas un identifiant de compte
ou une adresse. Condensée, cette table ne détient aucune donnée personnelle —
c'est ce qui lui permet de ne déclarer aucune catégorie au contrat.

**Une panne du magasin refuse la réservation, elle ne l'accorde pas.** Accorder
ferait exécuter deux fois, ce que la story existe pour empêcher ; refuser reporte
l'exécution à la prochaine échéance, et le répartiteur la journalise.

Cette dernière moitié a été **fausse pendant une revue** (constat F4) : le
magasin rejette sur son délai comme sur toute erreur du pilote, et
`dispatchModuleJob` levait **avant** d'atteindre son journal. Ce qui la rend
vraie aujourd'hui est un `try` autour de `claim` et de `release`, et le cas
« rend un échec journalisé quand le registre d'exécutions est en panne » de
`packages/core/src/jobs.test.ts` — qui fait rejeter un registre pour de bon.

## Imports autorisés

- `@repo/core` pour le contrat de module, le type du registre d'exécutions et la
  déclaration de route ;
- `drizzle-orm` pour le schéma et la seule instruction atomique qui réserve ;
- `@repo/typescript-config` pour la configuration du compilateur (`tsconfig.json`).

## Ne doit jamais contenir

- **la règle de reprise, de déduplication ou de lecture d'une expression cron** :
  elles vivent dans `@repo/core`, parce qu'elles doivent répondre quand ce module
  est coupé ;
- de connaissance d'Inngest : le gestionnaire de rappel est **reçu** du point de
  composition de l'application (`provideJobs`), jamais construit ici ;
- de lecture de `process.env` ni de `config/` ;
- de règle métier hors de `domain/` ;
- d'import d'un autre module : la seule dépendance inter-modules déclarée est
  `requires`.

## Tests

`src/**/*.test.ts` pour ce qui appartient au module ; le câblage complet — le
plancher du registre, le repli synchrone, la déduplication contre une vraie base
— vit dans `tests/jobs.test.ts`, parce qu'il traverse les packages.
