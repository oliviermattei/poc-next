# ADR 059 — Le répartiteur de tâches vit dans le socle ; le module `jobs` ne porte que le registre d'exécutions et le rappel

- Status: accepted
- Date: 2026-09-05

La clé `jobs` du contrat de module était agrégée sans que rien ne l'exécute. Trois forces décident de la forme : Inngest, seule implémentation, exécute une tâche en **rappelant** l'application par HTTP ; module de tâches coupé, l'émission doit s'exécuter de façon synchrone dans la requête appelante, parce que la suppression de compte et l'export — obligations légales du socle — orchestrent leurs traitements par tâche ; et l'idempotence demande un magasin partagé entre instances, donc une table, donc un module.

**La règle d'exécution vit dans `@repo/core`** (`packages/core/src/jobs.ts`) : trouver la tâche déclarée par un module activé, dédupliquer, reprendre selon la politique, journaliser. Elle vit à côté de `dispatchModuleRequest` pour la même raison — c'est le registre qui sait quels modules sont activés — et elle répond quand le module `jobs` est coupé. **Le port `Jobs` ne porte que l'émission** (`packages/ports/src/jobs.ts`) ; la déclaration reste la clé `jobs` du contrat, et `ModuleJob.run` reçoit `{ key, data, attempt, now }`. Chaque code d'erreur du port est classé transitoire ou définitif : `isTransientJobsError` (`@repo/core`) et sa copie dans l'adaptateur sont des `switch` exhaustifs, et `JOBS_ERROR_CODES` permet à `tests/jobs.test.ts` de vérifier que les deux disent la même chose.

**Le module `jobs` est optionnel** et ne porte que la table `job_run`, la route de rappel (`JOBS_CALLBACK_PATH`, en `GET`, `POST` et `PUT`, politique de débit `webhook`) et une tâche : le balayage de son propre registre, rétention de sept jours. Coupé, sa route n'est dans aucune table de routage, l'émission s'exécute dans la requête sans reprise ni attente, et les tâches planifiées ne s'exécutent pas. Le mode local (`JOBS_LOCAL_RUNNER=1`) exécute en mémoire, sans clé : opt-in explicite, et un processus sans clé ni drapeau refuse de démarrer en nommant les variables.

## Considered options

- **Un ordonnanceur dans le module `jobs`** — rejeté : couper le module ferait disparaître la règle d'exécution, et la suppression de compte et l'export avec elle.
- **Répondre 404 sur la route de rappel sans fournisseur** — rejeté : la route est déclarée par un module activé et montée ; ce qui manque est le fournisseur. Elle répond **503** `jobs_provider_not_configured`, et 404 seulement module coupé. La règle des 404 protège l'existence de la ressource d'autrui, pas celle d'un point d'intégration déclaré en clair.
- **Un fichier de route Next dédié au rappel** — rejeté : une route déclarée par le module hérite de la limitation de débit dérivée du registre et disparaît avec lui.
- **`client.send()` du SDK** — rejeté : aucun délai d'attente, une reprise interne, et un échec qu'on ne classe que par sous-chaîne de message. L'émission est un POST documenté ; seul le `serve` vient du SDK.
- **Laisser Inngest tenir la reprise** — rejeté : deux politiques superposées multiplient les tentatives. `retries: 0` chez le fournisseur, la politique chez nous.

## Consequences

- Le mode local ne survit pas au processus et n'est pas partagé entre instances : `docs/deployment.md` le réserve à un déploiement à une instance. Il n'est pas encore refusé en production (issue #204).
- `assertJobsAreRunnable` exige « au moins une tâche », pas « chaque module qui devrait en déclarer une le fait » : un module qui possède une table qui croît doit gagner son propre cas de test qui nomme sa tâche de balayage. Un prédicat dérivé (« une table sans catégorie de données doit être balayée ») a été écarté : il désigne aussi `admin_platform_role`, bornée par le nombre d'humains et non par le trafic.
- La doublure `createRecordingJobs` (`@repo/jobs-testing`) capture les événements émis ; `tests/account-deletion.test.ts` l'emploie.
- Les tâches planifiées n'ont pas de déclencheur à la demande (issue #137).
