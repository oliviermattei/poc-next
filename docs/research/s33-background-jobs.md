# Research — Story s33-background-jobs

> Vérifiée contre `dev` au commit `71098e2`, en lecture seule. Aucune base, aucun conteneur, aucun worktree — une recherche ne se connecte à rien.

## Les cinq faits structurants

1. **La clé `jobs` du contrat est agrégée et jamais consommée. Aucun job n'a jamais tourné.** `packages/core/src/registry.ts:169` construit `jobs: modules.flatMap(…)` — et **rien ne lit ce tableau**. Balayage de `\.jobs\b` sur `packages/core/src`, `apps/web` et `scripts/` : une seule occurrence, celle qui le construit. Il n'existe ni ordonnanceur, ni point d'entrée, ni commande qui l'exécute.

2. **Le seul job déclaré du dépôt nettoie la table qui a cassé la suite e2e.** Un module sur treize déclare un job : `rate-limit`, avec `sweepClosedWindows` (`packages/modules/rate-limit/src/module.ts:44`). Il n'est appelé nulle part ailleurs que dans sa propre déclaration. Donc `rate_limit_window` **n'a jamais été purgée**, et croît sans borne — c'est exactement la table que le préambule `e2e/support/warm-up.ts` doit vider pour que le troisième passage horaire de la suite ne rougisse pas (proposition P13 du retour d'expérience). Le symptôme a été traité ; sa cause est cette story.

3. **Il n'y a pas de port `jobs`.** `packages/ports/src/` contient `mailer`, `payments`, `rate-limit`, `storage` — quatre. `AGENTS.md` annonce pourtant « jobs Inngest » dans sa liste « une implémentation par port », et aucune dépendance Inngest n'existe dans aucun `package.json`. La story crée donc **le cinquième port**, et c'est sa décision structurelle principale.

4. **Le repli synchrone est déjà une règle écrite, et il a déjà un précédent exécuté.** La base de fiabilité dit : « No jobs → purge and export run synchronously ». `purgeModules` et `exportModules` (`registry.ts:401` et `:413`) sont **déjà** synchrones et déjà appelés directement. Le critère 8 — « module non activé : l'émission d'un job l'exécute de façon synchrone dans la requête appelante » — ne demande donc pas un mécanisme neuf, mais d'étendre au port ce que le socle fait déjà pour ces deux-là.

5. **Le critère 7 dépend d'un état qui existe, mais d'aucune relance qui existe.** `trialEnd` est présent partout où il faut — schéma (`billing/src/schema.ts:122`), ports, cas d'usage. Ce qui manque, c'est le déclencheur : rien ne lit `trialEnd` pour agir en fin de période. La story doit livrer ce job, pas le modèle de données.

## Target story

Neuf critères. Une interface typée unique pour émettre un événement et déclarer un job · une doublure d'enregistrement en CI · un test réel contre Inngest hors CI, sur commande explicite · une tâche planifiée qui s'exécute selon son cron, journalisée · une politique de reprise configurable, puis un échec définitif journalisé · l'idempotence, prouvée par le rejeu · la relance d'essai livrée comme job réel · le repli synchrone module coupé · un mode local documenté et couvert par un test de démarrage sans service externe.

Dépendances déclarées : `s21-trials-and-gating` (fusionnée), `s32-notifications-inapp` (**en attente de fusion, PR 22**).

## Points d'ancrage

- `packages/core/src/registry.ts:169` — l'agrégation qui n'a jamais eu de consommateur.
- `packages/modules/rate-limit/src/module.ts:44` — `sweepClosedWindows`, le job orphelin, et la preuve que le contrat était prêt avant l'exécution.
- `packages/ports/src/rate-limit.ts` — **le port le plus récent (s28, ADR 050)** : c'est le modèle de forme à suivre, y compris sa décision de refuser plutôt que dégrader.
- `packages/core/src/registry.ts:401,413` — `purgeModules` et `exportModules`, le précédent du repli synchrone.
- `e2e/support/warm-up.ts` — le symptôme du fait 2, à relire quand le job tournera : le préambule pourrait devenir inutile, et c'est une mesure à faire, pas une supposition.

## Pièges & contraintes

- **Un port qui n'a pas de mode local sans clé viole la règle du dépôt.** « Every port must be usable locally with no provider key — through an **explicit** local mode, never inferred from `NODE_ENV`. » Le critère 9 le redit. Inngest a un serveur de développement local : la question est de savoir si le mode local du port l'exige, ou s'il exécute en mémoire — et les deux réponses ont des conséquences opposées sur le critère 3.
- **L'idempotence ne s'affirme pas, elle se joue deux fois.** `docs/reliability.md` : « "Idempotent" is proven by running it twice and observing one effect, never asserted in a comment. » Le critère 6 est donc un test à deux exécutions, pas une clé de déduplication qu'on déclare.
- **La reprise ne doit pas réessayer une erreur de validation.** Même document : « transient errors only — retrying a validation error is a defect. » La politique configurable du critère 5 doit distinguer, et le test doit le montrer.
- **Le contrat porte déjà `schedule` en chaîne libre.** `ModuleJob` vaut `{ id, schedule, run }`. Rien ne valide l'expression cron aujourd'hui, puisque rien ne la lit — une expression fausse est actuellement silencieuse.
- **Le repli synchrone change la latence d'une requête.** La revue de s32 a relevé (R3) que sa boucle d'émission est synchrone et non bornée sur un chemin de requête, et l'a désignée comme candidate naturelle au repli asynchrone que cette story livre. Attention à ne pas rendre le repli *plus* coûteux que ce qu'il remplace.

## Questions ouvertes

- **Le port exécute-t-il, ou délègue-t-il ?** Un port qui « émet un événement » et un port qui « exécute un job » n'ont pas la même forme. Le critère 1 demande une interface unique pour les deux, ce qui est une contrainte forte sur la signature.
- **Où vit l'ordonnanceur des tâches planifiées ?** Inngest les tient côté fournisseur ; le mode local doit les tenir autrement, ou ne pas les tenir — et le critère 8 dit explicitement que module coupé, « les tâches planifiées ne s'exécutent pas et le démarrage le journalise ».
- **Le job de `rate-limit` doit-il être branché par cette story ?** Il existe, il est orphelin, et le brancher serait la preuve de bout en bout la moins artificielle. Mais c'est le job d'un autre module, et le brancher change le comportement de `rate-limit` en production. À trancher au plan.
- **Le préambule e2e devient-il inutile ?** À mesurer une fois le job branché, jamais à supposer.

## Complexité réelle

Notée **4** dans `docs/stories.md`. **Ma note : 4** — confirmée. Neuf critères, un cinquième port à créer avec son adaptateur et son mode local, un ordonnanceur, une politique de reprise, l'idempotence, et un repli synchrone. La note d'agent dit « dépendance à une infrastructure externe, difficile à tester » : c'est juste, et c'est le critère 3 qui porte tout le risque.

**Pas de proposition de découpe, mais une réserve.** Les neuf critères partagent le port : le séparer produirait une story qui ne close rien. Si le plan dépasse une dizaine de tâches, la ligne de coupe la moins mauvaise serait *le port et son repli* d'un côté, *les tâches planifiées et la relance d'essai* de l'autre — la seconde ne close seule que si la première a livré.
