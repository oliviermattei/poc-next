# Revue — s33-background-jobs

La plus grosse story du projet : complexité 4, 89 fichiers, cinq nouveaux paquets, un cinquième port, une dépendance externe neuve. **Deux rondes de revue, trois rondes de correction.**

## Le contexte qui a façonné la revue

La recherche avait établi que **la clé `jobs` du contrat était agrégée depuis toujours sans consommateur** : `registry.ts` construisait le tableau, rien ne le lisait. Un module sur treize déclarait un job — `sweepClosedWindows` de `rate-limit` — et il n'avait jamais tourné, d'où une table `rate_limit_window` sans borne, celle-là même que le préambule e2e doit vider.

La question de la revue n'était donc pas « est-ce que le code marche » mais **« est-ce que quelque chose s'exécute vraiment, et le saurait-on si ça cessait »**.

## Ronde 1 — six majeurs

| Commande | Résultat |
|---|---|
| `pnpm test` | 2407 passés / 10 sautés |
| `pnpm typecheck --force` | 32/32, **0 en cache** (l'exécution de l'implémenteur était entièrement mise en cache) |
| `pnpm test:minimal-profile` | 9 modules coupés dont `jobs`, 27 routes et 7 entrées balayées |

Le relecteur a vérifié la surface tierce contre `inngest@4.20.0` **installé**, pas de mémoire, et a récupéré **en direct** la documentation d'Inngest pour contrôler la fenêtre de déduplication de 24 h sur laquelle repose tout le raisonnement de rétention. Elle est exacte — et la **même page** a produit F6.

**F1 — tout le câblage était supprimable avec une suite verte.** Trois mutations, chacune à son point de composition, chacune **0 rouge sur 2407** : `prepareJobs(); startLocalJobScheduler()`, `prepareJobs()`, `assertJobsConfiguration(env)`. Dans la configuration livrée, ce `setInterval` est **la seule chose** qui déclenche une tâche planifiée. C'est l'état d'avant la story, un cran plus haut.

**F2 — la cadence n'était pas tenue.** `*/10 * * * *` → annuel : vert. Un balayage annuel restaure exactement le défaut que la story ferme.

**F3 — une affirmation d'exhaustivité fausse, écrite en trois endroits.** Ajouter un code à `JobsErrorCode` laissait le typage vert : `isTransientJobsError` était une chaîne de `===`, pas un `switch` exhaustif. Tout code futur serait tombé silencieusement dans « définitif » et **jamais réessayé**.

**F4 — le registre pouvait lever sans journaliser**, contredisant trois documents qui affirmaient le contraire.

**F5 — la borne de coût du repli n'était pas testée.** Trois tentatives et 30 s de recul **dans la requête de l'appelant** laissaient la suite verte, alors que le test s'appelle « sans reprise ».

**F6 — l'identifiant de déduplication du fournisseur n'était pas qualifié par la tâche.** La documentation d'Inngest dit explicitement de combiner l'identifiant avec le type. Le registre du dépôt le faisait déjà (`sha256(job + ':' + key)`) : **les deux ceintures étaient en désaccord, et celle du fournisseur était la plus lâche.**

## Ronde 2 — les six fermés, un septième trouvé

Toutes les mutations re-posées mordent. Le témoin de F1 appelle le vrai `register()` sous horloge simulée et vérifie que **le balayage a tourné**, pas que `setInterval` a été appelé.

**Le relecteur a réglé l'incident du `git checkout` par ses propres mutations**, pas par le rapport : F3 ne fait échouer le typage que si les deux `switch` sont exhaustifs *dans cet arbre*, F4 ne rougit que si les deux `try` y sont. Un arbre amputé aurait donné zéro rouge.

**Nouveau majeur — le critère 7 était supprimable en entier.** Retirer `remindTrialEnding` du point de composition : **0 rouge**. Vider le corps du job : **0 rouge**. Et `trialsEndingBetween` — la requête avec sa jointure, son filtre et sa fenêtre — n'était exercée par **aucun** test. Le critère était couvert comme « un job est déclaré » plus « une règle pure filtre », sans rien qui relie déclaration → service → dépôt → livraison. La story avait appliqué son propre standard aux deux balayages et pas à sa fonctionnalité neuve.

**Le prédicat dérivé, mesuré et refusé.** Proposé en ronde 1 pour tenir la limite du plancher : « un module qui déclare une table sans `dataCategories` ». Mesuré contre le registre réel : **trois** modules, pas deux — `admin`/`admin_platform_role` est un faux positif, ses lignes étant bornées par le nombre d'humains et non par le trafic. Le prédicat confond « pas de donnée personnelle » et « croît sans borne ». Refusé, et la mesure consignée dans l'ADR : **un garde qui refuse une configuration valide finit désarmé.**

## Ce qui est fermé, et à quel prix

| Mutation | Avant | Après |
|---|---|---|
| câblage de l'ordonnanceur retiré | **0** | 1 à 2 |
| cadence rendue annuelle (trois tâches) | **0** | 1 à 2 |
| code d'erreur ajouté (exhaustivité) | **typage vert** | **échec des deux côtés** |
| `try` retiré autour du registre | **0** | 1 |
| repli rendu coûteux (trois tentatives) | **0** | 1 |
| identifiant de déduplication dé-qualifié | **0** | 2 |
| `remindTrialEnding` retiré du composition | **0** | 1 **+ erreur de compilation** |
| corps du job de relance vidé | **0** | 1 |
| `trialsEndingBetween` perd sa borne / son filtre | **non testé** | 1 chacun |

## Un défaut trouvé par une recette, pas par une relecture

En posant le témoin du mineur (a), l'implémenteur a découvert qu'avec `jobs` **coupé**, `assertJobsConfiguration()` sortait **avant** toute validation d'expression cron : la validation ne tournait donc que dans une configuration sur deux. `assertJobSchedulesAreValid` (doublons et cron, **toujours**) est désormais séparée de `assertJobsAreRunnable` (plus le plancher, seulement si monté). **La branche socle de la CI gagne un garde qu'elle n'avait jamais eu.**

## Changement de comportement assumé

`rate-limit` balaie désormais en production. Le relecteur a vérifié que le balayage ne peut pas manger de données vivantes — il ne supprime que `expiresAt <= now`, donc un seau d'une heure survit à un balayage déclenché par une fenêtre de dix minutes — et que les seaux de `e2e/rate-limiting.spec.ts` sont à l'abri alors que `playwright.config.ts` active l'ordonnanceur pendant toute la suite.

## Non vérifié — trois choses qui demandent un humain

- **`pnpm test:e2e` deux fois dans la même heure.** C'est la seule commande dont ce diff change le comportement sans témoin : l'ordonnanceur tourne maintenant pendant toute la suite.
- **Le régime Inngest réel.** L'implémenteur l'a joué contre `inngest-cli@1.44.0` — événement réel, rappel réel, exécution réelle, et une mutation du nom d'événement rouge **contre le serveur** ; aucun relecteur ne l'a rejoué. Il tourne en `isDev: true` **sans clé de signature** : le chemin de production, avec vérification de signature sur la route publique, n'est exercé par rien.
- **Un démarrage de l'image de production avec de vraies clés**, et l'enregistrement du rappel dans le tableau de bord Inngest. Une clé de signature qui ne correspond pas est **invisible pour toutes les commandes du dépôt**.

Restent ouverts et documentés : la mesure du préambule e2e (délibérément non tranchée — le balayage ne retire que les seaux dont la fenêtre est close, donc trois passages dans la même heure épuisent le même seau ; à mesurer, pas à conclure), et le fait que rien ne force les deux classificateurs à **s'accorder** — désormais tenu par un test qui les confronte sur une liste dérivée.

Max severity: major
Ship allowed: yes
