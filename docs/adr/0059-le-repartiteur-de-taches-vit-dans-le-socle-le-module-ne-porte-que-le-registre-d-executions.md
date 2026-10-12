# ADR 059 — Le répartiteur de tâches vit dans le socle ; le module `jobs` ne porte que le registre d'exécutions et le rappel

- Status: accepted
- Date: 2026-09-05
- Scope: story s33-background-jobs

## Context

La clé `jobs` du contrat de module (ADR 007) est **agrégée depuis le premier
module écrit** — `registry.ts` construit le tableau — et **n'a jamais eu de
consommateur** : un balayage de `\.jobs\b` sur `packages/core/src`, `apps/web` et
`scripts/` ne trouvait qu'une occurrence, celle qui le construit. Il n'existait
ni ordonnanceur, ni point d'entrée, ni commande capable d'exécuter une tâche.

Ce n'est pas une capacité manquante sans conséquence. **Un module sur treize
déclarait une tâche** — `rate-limit`, avec `sweepClosedWindows` (s28) — et son
corps était vide, avec écrit à côté « c'est donc l'application qui remplacera ce
corps quand l'ordonnanceur existera ». Résultat mesurable :
`rate_limit_window` n'a jamais été purgée et croît sans borne, ce qui a obligé
`e2e/support/warm-up.ts` à vider la table avant chaque suite de parcours — le
troisième passage d'une même heure échouait sinon.

s33 devait donc **brancher un contrat déjà écrit et déjà employé**, et non poser
une capacité neuve. Trois forces s'y opposaient :

1. le PRD impose **Inngest comme seule implémentation**, et Inngest exécute une
   tâche en **rappelant** l'application par HTTP : la boucle ne se ferme pas sans
   un point d'entrée ;
2. le critère 8 exige que, **module de tâches coupé**, l'émission s'exécute de
   façon synchrone dans la requête appelante — parce que la suppression de compte
   (s34) et l'export (s35) sont des obligations légales du socle qui orchestrent
   leurs traitements par tâche ;
3. l'idempotence et la limitation du rejeu demandent un **magasin partagé entre
   instances**, donc une table, donc — dans ce dépôt — un module.

## Decision

**La règle d'exécution vit dans `@repo/core` ; le module `jobs` ne porte que ce
qui ne peut pas vivre ailleurs : la table `job_run` et les trois routes de
rappel.**

Concrètement, quatre choix qui tiennent ensemble :

1. **`packages/core/src/jobs.ts` est le répartiteur** — trouver la tâche
   déclarée par un module **activé**, dédupliquer l'exécution, reprendre selon la
   politique, journaliser. Il vit à côté de `dispatchModuleRequest`, et pour la
   même raison : c'est le registre qui sait quels modules sont activés. Surtout,
   **il doit répondre quand le module `jobs` est coupé** — c'est ce qui rend le
   repli synchrone possible, et c'est le raisonnement qui a déjà mis
   `resolveDataOwner` (ADR 025) et `allowsFeature` (ADR 043) dans le socle.
2. **Le port `Jobs` ne porte que l'émission** (`packages/ports/src/jobs.ts`). La
   déclaration reste la clé `jobs` du contrat ; la « interface typée unique » que
   le critère 1 demande est la **paire** port + contrat, réunie par le
   répartiteur. Chaque code d'erreur du port dit de quel côté il tombe,
   transitoire ou définitif, et la politique de reprise **lit** ce classement au
   lieu de l'inventer (`docs/reliability.md` §3, même forme qu'ADR 050).

   **Une fois par côté de la frontière, pas une fois dans le dépôt** — et la
   nuance a été relevée en revue (constat F8). `isTransientJobsError` vit dans
   `@repo/core` ; l'adaptateur en tient une copie, parce qu'un adaptateur ne
   dépend pas du socle de modules. Ce qui empêche les deux de diverger n'est
   donc pas l'unicité, c'est le **compilateur** : les deux sont des `switch`
   exhaustifs terminés par `const unhandled: never = code`, si bien qu'un code
   ajouté à `JobsErrorCode` fait échouer `pnpm typecheck` **des deux côtés**.
   La version livrée en revue affirmait cette garantie sans la tenir : une
   chaîne de `===` laissait 32 paquets verts et faisait retomber le code neuf du
   côté définitif, donc jamais réessayé.

   **Et le compilateur ne suffisait toujours pas** : il force chacun à *traiter*
   tous les codes, jamais à *dire la même chose*. `JobsErrorCode` est donc
   dérivée d'une liste (`JOBS_ERROR_CODES`), ce qui la rend énumérable à
   l'exécution, et `tests/jobs.test.ts` confronte les deux classements sur cette
   liste. Deux commandes, et il faut les deux : `pnpm typecheck` pour
   l'exhaustivité, `pnpm test` pour l'accord.
3. **`ModuleJob.run` reçoit un contexte** — `{ key, data, attempt, now }` — au
   lieu de ne rien recevoir. Le critère 2 demande qu'une doublure asserte « le
   nom **et la charge utile** » d'un événement émis ; sans destinataire, la charge
   utile n'aurait eu aucun sens. Le changement est **rétro-compatible** : une
   tâche qui n'en fait rien s'écrit toujours `run: async () => {}`, et aucun
   module n'a eu à être rouvert.
4. **Le module `jobs` est optionnel et déclare exactement une tâche : le
   balayage de son propre registre d'exécutions.** Il permet celles des autres
   modules, il n'en possède qu'une — et celle-là n'est pas facultative : sans
   elle, `job_run` croîtrait sans borne, c'est-à-dire que cette story rejouerait
   sur une table neuve le défaut qu'elle corrige sur `rate_limit_window`. Sa
   fenêtre de rétention est **sept jours**, dérivée du plus long rejeu contre
   lequel le registre protège réellement (le fournisseur déduplique lui-même par
   identifiant d'événement sur 24 heures ; au-delà, notre registre reste seul, et
   un rejeu opérationnel se fait dans la semaine). Coupé, le module emporte tout :
   ses trois chemins de rappel ne sont dans aucune table de routage (404 sans
   qu'aucun `if` ne le décide), sa table n'existe pas — donc il n'y a rien à
   balayer —, l'émission s'exécute dans la requête appelante **sans reprise ni
   attente**, les tâches planifiées ne s'exécutent pas, et le démarrage le
   journalise.

Le mode local (`JOBS_LOCAL_RUNNER=1`) exécute **en mémoire, sans clé et sans
service** : opt-in explicite, jamais déduit de `NODE_ENV`, et un processus qui
n'a ni clé ni drapeau **refuse de démarrer en nommant les trois variables** —
même forme que le mailer (s06), le stockage (s18) et le paiement (s19).

## Considered options

- **Un ordonnanceur dans le module `jobs`, qui lirait le registre** — rejeté :
  couper le module ferait disparaître la règle d'exécution avec lui, donc le
  repli synchrone du critère 8 n'aurait plus rien pour s'exécuter. La
  suppression de compte et l'export perdraient un droit légal en coupant un
  module optionnel.
- **Répondre 404 sur la route de rappel quand aucun fournisseur n'est
  configuré** — rejeté, après que la CI de la PR 27 l'eut fait rougir.
  `e2e/modules.spec.ts` balaie toute route **publique d'un module activé** et
  exige qu'elle ne réponde pas 404 ; en CI il n'y a ni `INNGEST_EVENT_KEY` ni
  `INNGEST_SIGNING_KEY`, l'exécuteur local est monté, et la route répondait
  « cet endroit n'existe pas » — ce qui est faux : elle est déclarée par un
  module activé et montée par le répartiteur. Ce qui manque est le fournisseur
  derrière, et c'est une autre phrase.

  **Ce qu'un appelant obtient, dans les trois états** — et les trois ne doivent
  pas être confondus :

  | État | Réponse | Ce qu'elle dit |
  |---|---|---|
  | module `jobs` **coupé** | **404** `not_found`, rendu par le répartiteur | l'endroit n'existe pas : la route n'est dans aucune table de routage |
  | module activé, **exécuteur local** (`JOBS_LOCAL_RUNNER=1`) | **503** `jobs_provider_not_configured` | l'endroit existe, aucun fournisseur n'est derrière |
  | module activé, **fournisseur configuré** | ce que le SDK répond (synchronisation, introspection, exécution) | le rappel fonctionne |

  Le motif de sécurité invoqué à la livraison — « une erreur serveur annoncerait
  qu'un ordonnanceur vit ici » — était une mauvaise lecture de
  `docs/security.md` §7 : la règle des 404 protège l'existence de la ressource
  **d'autrui**, pas celle d'un point d'entrée d'intégration qu'un contrat de
  module open source déclare en clair. Le webhook de paiement, public lui aussi,
  répond 400 sur une signature fausse. Le corps ne nomme aucune variable : un
  code stable, comme `{"error":"rate_limited"}`.

- **Ne pas déclarer la route tant qu'aucun fournisseur n'est configuré** —
  rejeté : `routes` dépendrait de l'environnement, ce qu'aucun module de ce
  dépôt ne fait, et la route deviendrait invisible au balayage qui a
  précisément trouvé le défaut.

- **Un sixième fichier de route Next pour le rappel d'Inngest** — rejeté :
  `docs/security.md` §7 compte **cinq** fichiers de route hors du répartiteur, et
  un test épingle ce compte précisément pour qu'un sixième force une décision au
  lieu d'hériter du silence. Une route déclarée par le module hérite en outre de
  la limitation de débit dérivée du registre (politique `webhook`, la plus large,
  pour la raison écrite dans `config/security.ts` : un fournisseur qui rejoue en
  rafale ne doit jamais être le premier refusé), et **disparaît** avec le module.
- **Émettre par `client.send()` du SDK** — rejeté après mesure sur
  `inngest@4.20.0` : `send` ne porte **aucun délai d'attente** — que
  `docs/reliability.md` §3 exige explicite —, il **reprend lui-même** ce que
  notre politique doit décider, et son échec est un `Error` nu dont le seul
  indice est la chaîne « Inngest API Error: 503 … ». Classer une reprise sur une
  sous-chaîne de message est exactement le piège que le code HTTP évite. L'API
  d'événements est **un POST documenté** ; le `serve`, lui, reste celui du SDK,
  parce que le protocole d'appel de fonction n'en est pas un.
- **Laisser Inngest tenir la reprise** (`retries` par défaut) — rejeté : deux
  politiques superposées multiplient les tentatives et rendent faux le plafond
  configuré. `retries: 0` chez le fournisseur, la politique chez nous, une seule
  fois, avec sa règle « jamais une erreur de validation ».
- **Une colonne « déjà relancé » pour la relance d'essai** — rejeté : la règle
  « l'essai se termine **exactement** le jour visé » tient la non-répétition par
  un calcul, sans migration. Le registre d'exécutions reste la seconde ceinture.
- **Ne pas brancher `sweepClosedWindows`** au motif que c'est le job d'un autre
  module — rejeté : c'est la preuve de bout en bout la moins artificielle, elle a
  un effet mesurable, et son absence a un coût connu. **La conséquence est dite,
  pas glissée** : le comportement de `rate-limit` change en production.

## Consequences

**Ce qui devient plus facile.** Une story qui a besoin d'un traitement différé
déclare une tâche au contrat de son module et appelle `Jobs.emit` : elle n'écrit
ni ordonnanceur, ni reprise, ni déduplication, et son code est identique que le
module `jobs` soit activé ou non. s34 et s35 héritent du repli sans le
redemander.

**Ce qui change en production, et c'est à dire plutôt qu'à glisser.**
`rate-limit` **balaie désormais ses fenêtres closes toutes les dix minutes**,
application au repos comprise. C'est l'objet de la story, et c'est un changement
de comportement d'un module que s33 ne possède pas. Le préambule
`e2e/support/warm-up.ts` **n'est pas supprimé** : savoir s'il devient inutile est
une mesure à faire une fois la tâche en service, pas une suppression à décider
ici.

**Ce qui devient plus difficile.** Le dépôt gagne une dépendance lourde
(`inngest`, 189 paquets installés, dont l'instrumentation OpenTelemetry) pour une
moitié seulement de l'adaptateur. `pnpm run audit` passe au jour de l'écriture ;
c'est une surface à surveiller.

**Ce que rien ne garantit, et qu'il faut savoir.** Le mode local **ne survit pas
au processus** et **n'est pas partagé entre instances** : sa file est perdue au
redémarrage, et deux instances exécuteraient chacune la même échéance.
`docs/deployment.md` le réserve donc à un déploiement à une seule instance.

**Le fil de la relance d'essai est mesuré de bout en bout** — contrat,
répartiteur, service, requête SQL, règle, livraison de l'application — par
`tests/billing.test.ts` (« relance l'essai qui se termine, du contrat jusqu'à la
livraison »), contre un vrai PostgreSQL et au **point de composition de
l'application**. Il ne l'était pas à la livraison : vider le corps de la tâche ou
retirer `remindTrialEnding` du point de composition laissaient tous deux la suite
entière verte (constat majeur de la seconde revue), et `trialsEndingBetween`
n'était exécutée par aucun test — elle a désormais le sien, à côté des autres
lectures Drizzle éprouvées contre une vraie base. `remindTrialEnding` est en
outre **obligatoire** dans `ConfigureBillingOptions`, comme `notify` l'est devenu
pour `organizations` en s32 : le compilateur tient une moitié du fil, le cas
tient l'autre.

La
relance d'essai, elle, ne vise que les abonnements d'un périmètre **de compte** :
résoudre le destinataire d'un abonnement d'organisation demanderait une lecture
inter-modules qu'aucune surface de `organizations` n'expose — le cas est
journalisé et sauté, et c'est une limite connue de s33.

**La doublure d'enregistrement est livrée avant son premier appelant, et il faut
le dire** (constat c de la seconde revue). `createRecordingJobs`
(`@repo/jobs-testing`) tient le critère 2 — « en CI, une doublure
d'enregistrement capture les événements émis » — et n'est aujourd'hui importée
que par son propre test unitaire, parce qu'**aucun chemin de requête n'émet
encore de tâche** : les trois tâches livrées sont déclenchées par l'échéance, pas
par une émission. Son premier appelant en CI sera **s34** (suppression de
compte), la première story qui orchestre un traitement par `Jobs.emit` — s35
(export) suivra. Écrit ici parce que la thèse de cette story est justement
qu'une chose déclarée sans consommateur est le défaut : celle-ci en est un cas
connu et daté, pas un oubli, et son existence ne doit pas se lire comme la preuve
que le régime de CI l'emploie déjà.

**À surveiller — et ce qui l'est déjà.** `job_run` croît d'une ligne par
exécution ; le module déclare donc sa propre tâche de balayage
(`jobs.sweep-job-runs`, quotidienne, rétention de sept jours), et
`tests/jobs.test.ts` l'exécute contre un vrai PostgreSQL : les réservations hors
fenêtre disparaissent, celles de la fenêtre restent. Ce qui reste à surveiller
est **le plancher lui-même** : `assertJobsAreRunnable` exige « au moins une
tâche », pas « chaque module qui devrait en déclarer une le fait ». Mesuré le
5 septembre 2026 — avec `rate-limit` et `billing` déjà déclarants, ramener le
module `jobs` à `jobs: []` **ne fait pas rougir le plancher** ; ce sont deux cas
qui nomment la tâche (`tests/jobs.test.ts`) qui l'attrapent. Un module futur qui
possède une table qui croît doit donc gagner **son** cas nommé : le plancher ne
le couvrira pas.

**Un prédicat dérivé a été proposé en revue, et mesuré plutôt qu'adopté** : « un
module qui déclare une table de schéma sans aucune `dataCategories` possède une
table que personne ne purge ni n'exporte, donc il doit déclarer une tâche de
balayage ». Il aurait attrapé le cas `jobs: []` sans nommer de module, ce qui est
strictement mieux qu'un cas nommé par auteur. Passé sur l'annuaire réel, il rend
**trois** modules et non deux : `rate-limit` (`rate_limit_window`), `jobs`
(`job_run`) et **`admin` (`admin_platform_role`)**. Le troisième est un faux
positif, et il n'est pas anecdotique : cette table porte les rôles de
superadmin, une ligne par personne désignée, effacée à la révocation — elle est
bornée par le nombre d'humains, pas par le trafic. Le prédicat confond « ce n'est
pas une donnée personnelle » avec « ça croît sans borne », qui sont deux
questions différentes. Il n'est donc **pas** implémenté : une garde qui refuse
une configuration valide se fait désarmer, et c'est le motif que ce dépôt a déjà
payé. La limite documentée reste, et le prédicat exact — s'il en existe un —
serait sur la **croissance** (« cette table gagne une ligne par requête ou par
exécution »), que rien dans le contrat ne déclare aujourd'hui.
