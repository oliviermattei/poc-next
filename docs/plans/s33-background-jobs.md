---
story: s33-background-jobs
validated: yes
---

# Plan — s33-background-jobs

> Planifié contre `dev` au commit `6466ccf`. Recherche datée du même jour, `69f2308` — vérifiée fraîche.

## Le point de départ, et il change la nature de la story

La recherche a établi que **la clé `jobs` du contrat est agrégée depuis toujours et n'a jamais eu de consommateur**. `registry.ts:169` construit le tableau ; rien ne le lit. Un seul module sur treize déclare un job — `rate-limit`, avec `sweepClosedWindows` — et il n'a **jamais tourné**.

Cette story ne pose donc pas une capacité neuve sur un socle vierge : elle **branche un contrat déjà écrit et déjà employé**, dont l'absence d'exécution a une conséquence mesurable — `rate_limit_window` croît sans borne, et c'est la table que le préambule e2e doit vider pour que le troisième passage horaire ne rougisse pas.

## Les trois décisions structurelles

### 1. Le port porte l'émission ; le contrat garde la déclaration

Le critère 1 demande « une interface typée [qui] expose l'émission d'un événement **et** la déclaration d'un job ». La déclaration existe déjà : `ModuleJob { id, schedule, run }`. En créer une seconde ferait deux vérités pour une même chose.

**Lecture retenue** : la surface unique est la paire *port d'émission + clé `jobs` du contrat*, et c'est le **répartiteur** qui les réunit. Le code métier n'appelle que le port ; il ne construit jamais un job à la main.

### 2. Le cinquième port suit la forme du quatrième

`packages/ports/src/rate-limit.ts` (s28, ADR 050) est le modèle : résultat discriminé, jamais d'exception, et **chaque code d'erreur annote s'il est transitoire ou définitif**. Le critère 5 en dépend directement — « un job en échec est réessayé selon une politique configurable » — puisque `docs/reliability.md` interdit de réessayer une erreur de validation. La distinction ne s'invente pas au niveau de la politique : elle est portée par le code d'erreur.

Différence assumée avec `rate-limit` : celui-ci **refuse** quand son magasin est absent (son magasin est la base de l'application). Les jobs, eux, **dégradent** — c'est le critère 8, et c'est la règle générale du dépôt.

### 3. Le mode local n'exige aucun service externe

`AGENTS.md` : « Every port must be usable locally with no provider key — through an **explicit** local mode. » Le mode local exécute **en mémoire**, activé par une variable explicite, jamais déduite de `NODE_ENV`. Le critère 3 — un test réel contre Inngest — reste **hors CI, sur commande explicite**, comme le régime `live` du parcours doré.

## Tâches

- [x] **1. Le port et ses codes d'erreur.** `packages/ports/src/jobs.ts` : émettre un événement, et la forme du résultat. Codes discriminés, chacun annoté transitoire ou définitif. Tests d'abord sur la forme, pas sur un adaptateur.
- [x] **2. Le répartiteur lit `registry.jobs` — et le plancher qui empêche le retour du défaut.** C'est le cœur : la fonction qui, pour un événement ou une échéance, trouve le job déclaré et l'exécute. **Test de plancher : le registre livré déclare au moins un job**, et le répartiteur refuse un balayage vide. Sans lui, on relivre exactement l'état d'aujourd'hui — un tableau agrégé que rien ne consomme — avec des tests verts.
- [x] **3. L'adaptateur local, en mémoire, et son mode explicite.** Aucune clé, aucun service. Une variable explicite l'active ; un processus sans variable **et** sans clé refuse de démarrer en la nommant (règle du dépôt). Test de démarrage sans service externe — critère 9.
- [x] **4. L'idempotence, jouée deux fois.** `docs/reliability.md` : « proven by running it twice and observing one effect, never asserted in a comment. » Le test exécute, rejoue, et compte **un** effet. Mutation : retirer la déduplication doit rougir.
- [x] **5. La politique de reprise, et ce qu'elle ne réessaie pas.** Reculs exponentiels avec dispersion et plafond, seuil configurable, puis échec définitif **journalisé**. Deux tests : une erreur transitoire est réessayée jusqu'au plafond ; **une erreur définitive ne l'est pas** — réessayer une validation est un défaut, pas une prudence.
- [x] **6. Les tâches planifiées, et la validation de leur expression.** Le contrat porte `schedule` en chaîne libre et **rien ne la valide aujourd'hui**, puisque rien ne la lit : une expression fausse est actuellement silencieuse. Le répartiteur la refuse au démarrage en la nommant. Chaque exécution est journalisée — critère 4.
- [x] **7. Brancher `sweepClosedWindows`.** Le job orphelin de `rate-limit` devient la preuve de bout en bout la moins artificielle : il existe, il a un effet mesurable, et son absence a un coût connu. **C'est un changement de comportement de `rate-limit` en production** — la story doit le dire, pas le glisser. Test : après exécution, les fenêtres closes ont disparu.
- [x] **8. Module coupé — les trois garanties.** L'émission s'exécute **de façon synchrone dans la requête appelante** ; les tâches planifiées ne s'exécutent pas ; le démarrage le journalise. Le précédent existe : `purgeModules` et `exportModules` sont déjà synchrones. Attention à ne pas rendre le repli **plus coûteux** que ce qu'il remplace — la revue de s32 a relevé que sa boucle d'émission est synchrone et non bornée sur un chemin de requête.
- [x] **9. La relance d'essai, livrée comme job réel.** `trialEnd` existe partout — schéma, ports, cas d'usage ; ce qui manque est le déclencheur. Critère 7.
- [x] **10. Le régime réel, hors CI, sur commande explicite.** Un test contre l'environnement de développement Inngest exécute un job de démonstration. Sur commande, jamais en CI — le modèle est le régime `live` du parcours doré, y compris son refus de se substituer silencieusement.

## Ce que la story ne fait pas

Elle ne rend pas asynchrone la boucle d'émission de `s32` — c'est un candidat identifié, pas ce périmètre. Elle ne remplace pas le préambule e2e : une fois `sweepClosedWindows` branché, savoir si le préambule devient inutile est une **mesure à faire**, pas une suppression à décider ici.

## Si le plan déborde

Dix tâches, c'est la limite. Si l'exécution montre qu'il faut davantage, la ligne de coupe est : *le port, son adaptateur local et le repli* d'un côté — qui close « le socle sait exécuter un job » —, *les tâches planifiées, la relance d'essai et le régime réel* de l'autre. La seconde ne close seule que si la première a livré.

## Sections de `docs/security.md` touchées

Aucune frontière nouvelle. Le journal d'un job ne doit porter **ni secret ni donnée personnelle** — la charge utile d'un événement est un candidat direct, et la revue de s32 vient d'établir la règle : ce qui est écrit et relu ne porte que des références.
