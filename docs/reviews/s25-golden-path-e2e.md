# Review — Story s25-golden-path-e2e

> Fresh-context review. Each issue classified: critical / major / minor.
> Diff reviewed: `git diff dev...feature/s25-golden-path-e2e` — 1 commit (`654ab36`), 26 fichiers, +3058/−161.
> ADR 048 est contraignante pour cette story et sert de référence tout au long.

## Commands run by the reviewer

| Commande | Résultat |
|---|---|
| `docker compose up -d` (worktree, port 5435) | conteneur `s25-golden-path-e2e-postgres-1` joignable |
| `pnpm test` | **1790 passed, 8 skipped, 56 fichiers** (exit 0) |
| `pnpm test` avec `DATABASE_URL` sur un port mort (5999) | **1457 passed, 339 skipped, 2 failed** — la suite verte exerce donc bien **331 cas adossés à la base** |
| `pnpm typecheck` | vert (racine + 24 packages) |
| `pnpm lint` | `ESLint: No issues found` |
| `pnpm test:e2e` | **86 passed, 8 skipped** — et **aucun** cas de `e2e/golden-path/` collecté |
| `pnpm test:golden-path` (sans régime) | refus nommé, exit 1 |
| `GOLDEN_PATH_PAYMENTS=recorded pnpm test:golden-path` | **échoue en nommant les trois natures manquantes**, avant tout clone, exit 1 |
| `GOLDEN_PATH_PAYMENTS=simulated pnpm test:golden-path` | **3 passed**, exit 0, deux fois de suite |
| `CI=true GOLDEN_PATH_PAYMENTS=simulated` | refusé, message ADR 048 |
| `GOLDEN_PATH_PAYMENTS=live` sans clés / `sk_live_` / en CI / mixé | refusés, quatre messages distincts et corrects |
| `psql \l` avant/après | aucune base `parcours_dore_*` résiduelle |

Preuve que l'amorçage est réel : `Packages: +552 … downloaded 0, added 552`. Le `pnpm install` du clone part de zéro (`node_modules` absent) et le « cache pnpm chaud » de la ligne de conditions est exact. La ligne d'overlay est honnête : arbre propre → « aucun fichier recopié ».

## Plan compliance

- [x] **Les dix tâches sont faites.**
- [x] **Les tâches 7 et 8 ne sont pas cochées en silence** : le plan porte sous chacune un état livré explicite. La Definition of Done l'exigeait ; c'est tenu.
- [ ] **Dérive** : six choses hors plan — le troisième régime `simulated` (F2), le job CI bloquant (F4), `PAYMENTS_RECORDED_EVENTS`, l'extraction de `checkout-events.ts`, le `testIgnore` et le déplacement du spec. Les quatre dernières sont des conséquences raisonnables.

### Interdits d'exécution — chacun vérifié

| Interdit | Vérifié comment | Verdict |
|---|---|---|
| Jamais de repli sur le simulateur | mutation aux deux sites + exécution | **tenu au sens strict, mais la couture n'est pas gardée** → F1 |
| Régimes jamais mélangés | quatre refus exécutés | tenu |
| Aucun échec sur les 30 minutes | balayage : deux occurrences, aucune comparaison, aucun seuil | tenu |
| Aucun identifiant réel versionné | `git ls-tree` → `README.md` seul | tenu |
| Parcours doré hors de `test:e2e` | 94 cas, aucun de `golden-path` | tenu |
| Quinze specs et préchauffage intacts | absents de la liste | tenu |
| Aucun secret journalisé | trois chemins vérifiés | tenu |
| `config/` intact | absent du diff | tenu |

## Anti-hallucination

- [x] **Aucun import ou symbole inventé.** Ouverts un à un : `MODULE_ROUTE_PREFIX`, `PRICING_SCREEN_PATH`, `demoEnabledModule`, la route `entitlement`, `signUp`/`signIn`/`linkSentTo`, `publicPath`/`urlOf`, `loadRootEnv`, `createDatabaseClient`. Les chaînes affichées existent (`apps/web/messages/fr.json:65,67`).
- [x] **Le chemin du webhook du README est le bon** : `MODULE_ROUTE_PREFIX` + `PATHS.webhook`. Vérifié, pas supposé.
- [ ] **Une logique plausible mais fausse** → F3. **Une procédure documentée qui ne marche pas** → F5.

## Rules compliance

- [x] Deux emplacements de test seulement. Conforme.
- [x] `pnpm test:golden-path` documenté dans `AGENTS.md`, **et la règle est exécutable** : ligne retirée → `tests/agents-md.test.ts` 1 rouge sur 91.
- [x] `docs/architecture.md` gagne le tableau des trois régimes.
- [x] Aucun ADR contredit. ADR 048 cohérente avec ADR 008, ADR 034 et la doctrine « mode local explicite ».
- [ ] **Deux claims d'exhaustivité laissés faux** → F6, F7.

## Tests

- [x] Suite verte, prouvée adossée à une vraie base (331 cas s'effondrent sur un port mort).
- [x] Le spec vérifie le mur **des deux côtés** (écran *et* route de module, 403 avant / 200 après) et dérive `PREMIUM_ROUTE` du contrat au lieu de le recopier.
- [x] **Les deux tests réécrits mordent réellement**, vérifié et non cru.
- [x] Balayage du diff pour la forme `toThrow()` sans motif : aucune autre occurrence.

| # | Mutation | Site | Rouges |
|---|---|---|---|
| M1 | repli sur le simulateur quand un enregistrement manque | `recorded-events.ts` | **3 / 18** |
| M2 | garde de pré-vol neutralisée | `scripts/golden-path.ts:147` | 0 en unitaire, **3 parcours rouges** à l'exécution |
| M3 | `...recordedEventsEnv()` retiré du `webServer.env` | `playwright.golden-path.config.ts:79` | **0 / 1798, et exit 0** → **F1** |
| M4 | droit jamais accordé | `apps/web/lib/entitlements.ts` | **3 / 3 parcours** |
| M5 | base fixe partagée | `scripts/golden-path.ts` | 2ᵉ exécution **2 / 3 rouges** |
| M6 | ligne retirée d'`AGENTS.md` | `AGENTS.md` | **1 / 91** |

Restauration prouvée après chacune ; enregistrements temporaires supprimés ; base de M5 détruite.

## Regressions

- [x] `local-payments.ts` refactoré : formes comparées ligne à ligne — identifiants, horodatages, objet mémorisé, présence conditionnelle de `customer_details` : **rien n'a changé**.
- [x] `playwright.config.ts` : même jeu de clés, plus `testIgnore`. Les 86 parcours passent.
- [x] Aucune migration, aucun schéma, aucune donnée touchés.

## Findings

**F1 — critical — `playwright.golden-path.config.ts` + `apps/web/lib/billing.ts` : rien ne vérifie que le serveur a réellement rejoué un enregistrement, si bien qu'une exécution annoncée `recorded` peut être verte en ayant tourné sur le simulateur.**

C'est le seul chemin de vert silencieux trouvé, et il est au centre de la story.

La chaîne est : `resolveGoldenPathRegime` → `PAYMENTS_RECORDED_EVENTS` dans `webServer.env` → `resolveBillingConfig` → `createRecordedCheckoutEvents`. Le dernier maillon mord (M1). Mais **le serveur ne sait pas ce que la commande a demandé** : sans la variable, `createLocalPayments` retombe sur `simulatedCheckoutEvents` par défaut, et personne ne le voit.

Mesuré, enregistrements en place : ligne 79 retirée → sortie « régime de paiement : recorded. », **3 passed, exit 0**, trois durées journalisées, `pnpm test` **1790 passed, 0 rouge**.

Une CI verte sur des formes que nous avons écrites nous-mêmes, en affirmant rejouer des formes capturées. C'est la règle que le socle applique aux ports : « un port qui retombe silencieusement sur un remplaçant local ne peut plus distinguer un envoi réel d'un envoi capturé ». La question d'`AGENTS.md` — *quelle commande échoue si je casse cette règle ?* — n'a pas de réponse.

Deux précisions d'honnêteté. **Un** : sur l'arbre livré, ce vert n'est pas atteignable, aucun enregistrement n'étant versionné et la garde de pré-vol arrêtant la commande. Le faux vert devient atteignable **le jour où les enregistrements arrivent**, c'est-à-dire au moment précis où le mécanisme commence à être cru. **Deux** : le code livré est correct — c'est le filet qui manque. Classé critical parce que la story ne livre rien d'autre que cette garantie, que le job CI ajouté en sera l'unique consommateur, et que le dépôt a déjà payé cinq fois ce mode de défaillance.

Le correctif est court et le signal existe déjà : le rejeu émet `evt_rec_…` là où le simulateur émet `evt_local_…`. Il suffit qu'une exécution `recorded` exige un signal positif de ce genre, plutôt que de faire confiance à un `...spread` que personne ne garde.

**F2 — minor — le troisième régime `simulated` est légitime, mais hors plan validé.**
Les deux affirmations de l'implémenteur tiennent, exercées : jamais choisi implicitement (aucune valeur par défaut), refusé en CI. Ce n'est donc pas le repli qu'ADR 048 interdit — c'est un choix écrit, dans la forme que le dépôt impose aux modes locaux. Il rend la story exerçable en attendant les enregistrements. Le reproche est étroit : il n'était pas au plan, et c'est lui qui crée la couture de F1.

**F3 — major — `scripts/golden-path-regime.ts` : le régime `live` exige les mauvaises variables.**
Il refuse `live` sans `STRIPE_SECRET_KEY` **et** `STRIPE_WEBHOOK_SECRET`, au motif que « sans elles, l'échec viendrait du fournisseur ». Puis il lance `stripe-live.test.ts`, qui lit `STRIPE_SECRET_KEY` et **`STRIPE_LIVE_PRICE_ID`** (lignes 36-37) et code en dur `whsec_unused_in_this_recipe`.

Mesuré, sans appel réseau : poser exactement les deux variables réclamées échoue plus loin sur une troisième jamais demandée — précisément le mode de défaillance que le message prétend éviter. C'est l'explication la plus probable du fait que le critère 7 n'ait jamais été exercé.

**F4 — major — `.github/workflows/ci.yml` : un job bloquant écrit pour être rouge, dont l'unique procédure de déblocage est fausse (F5).**
Le job `parcours-dore` est ajouté sans `continue-on-error` ni condition, et son commentaire annonce lui-même qu'il est rouge tant qu'aucun enregistrement n'est capturé. Le raisonnement est cohérent, mais le résultat est une CI rouge **sur chaque PR**, pour une raison étrangère au code de la PR. Un check requis rouge par construction enseigne à ignorer la CI, et le premier réflexe du prochain agent sera de le rendre non bloquant ou de le passer en `simulated` — rouvrant la porte que la story vient de fermer.

**Recommandation.** Trois options, par préférence : (1) capturer avant de fusionner — ce qu'ADR 048 appelle un prérequis ; (2) armer le job sur une **donnée** : `if: ${{ hashFiles('tests/fixtures/stripe-events/*.json') != '' }}` — il ne s'exécute pas tant qu'il n'y a rien à rejouer, et devient bloquant à la seconde où un enregistrement est versionné ; (3) sortir le job de cette PR. Déconseillé : le laisser rouge en comptant sur la mémoire de l'équipe.

**F5 — major — la procédure de capture ne fonctionne pas telle qu'elle est écrite.**
`stripe listen --print-json > /tmp/evenements.ndjson` produit **un fichier** de lignes JSON ; `GOLDEN_PATH_CAPTURE_FROM=/tmp/evenements` attend **un dossier** de fichiers `.json`, que `readdirSync` lit sans garde — un chemin inexistant lève `ENOENT` non rattrapé, pas un refus nommé. Le passage de l'un à l'autre n'est écrit nulle part. C'est la seule procédure documentée pour rendre le critère 6 vrai.

**F6 — minor — `tests/env-wiring.test.ts` : sa description devient fausse.**
Il dit lire « le **seul** bloc `env:` posé au niveau d'un job » ; le diff en ajoute un second. La lecture par `indexOf` tombe encore sur le bon, mais sur **le premier**, pas sur `quality` par construction : réordonner les jobs ferait mesurer le mauvais, en silence.

**F7 — minor — `packages/payments-testing/AGENTS.md` : « sur les 18 cas de la suite » est faux.**
Le fichier compte **21** cas (déjà 21 sur `dev`), et la suite en compte **39** sur deux fichiers. Le diff réécrit le paragraphe juste au-dessus et laisse le compte.

**F8 — minor — l'étape « Traces du parcours doré en échec » ne téléversera jamais rien.**
Elle pointe `playwright-report/` à la racine, or le config déclare `reporter: 'list'` et les traces sont écrites dans le clone temporaire, détruit par le `finally`.

**F9 — minor — `golden-path.spec.ts` : deux incohérences.**
`PREMIUM_ROUTE` retombe sur `''` si aucune route `entitlement` n'est déclarée — le parcours rougit, mais sur un message qui ne dit pas la cause. Et le premier parcours **affirme** `billing.available` là où les deux autres **sautent** : `billing` coupé, la commande rougit sur un parcours et en saute deux.

## Not verified

- **Le régime enregistré sur de vrais enregistrements.** Les trois utilisés pour M3 ont été **fabriqués par le relecteur**. Ils prouvent la mécanique aller-retour, **rien** sur la fidélité au fournisseur — qui est la raison d'être du régime.
- **Le critère 7, sous deux angles.** Jamais exécuté, faute de clé. Et surtout : **le régime `live` livré n'exécute pas le scénario** — `captureAgainstRealKeys()` lance la recette de s19 puis rend la main, sans cloner, sans base, sans navigateur. Le critère demande que « le **même scénario** s'exécute contre les clés de test ». L'implémentation est conforme au **plan**, pas à la **story**. Reste ouvert : la variante invité fabrique `…@guest.local`, et un vrai Stripe exigera une adresse réelle.
- **La configuration modules coupés** n'a pas été exercée (voir F9).
- **La CI elle-même** n'a pas été exécutée ; le job est jugé sur lecture.
- **La durée réelle sur un runner** : mesurée à 11-12 s sur un Mac au cache chaud. Sur un runner à deux cœurs ce sera d'un autre ordre — c'est ce chiffre-là qu'il faudra lire, pas le mien.

## Verdict

Le harnais est du bon travail, et il faut le dire avant le refus : la base vierge est réelle et sa garde mord, le budget par étape a nommé une étape bloquée dans une vraie exécution, le refus d'un enregistrement absent mord aux deux sites, les quatre refus du régime réel sont corrects, la mesure d'amorçage est honnête jusqu'à sa ligne de conditions, et les deux tests décoratifs ont été réécrits de sorte qu'ils mordent — vérifié, pas cru.

Ce qui bloque tient en une phrase : **la seule chose que cette story existe pour garantir n'est vérifiée par aucune commande.** Une exécution qui annonce `recorded` peut être verte en ayant tourné sur le simulateur, et rien ne le dit. S'y ajoute un job de CI bloquant écrit pour être rouge, dont les deux chemins de déblocage sont cassés.

## Seconde reprise (même branche, commit amendé `fa0ffc6`)

Le `critical` de la re-revue portait sur **une recommandation du contexte
principal**, pas sur le travail de l'implémenteur : armer le job de CI avec
`if: ${{ hashFiles(...) != '' }}` au niveau du job. GitHub rejette le fichier
entier, et ce dépôt n'a qu'un workflow — typecheck, lint, tests, parcours **et
le scan de secrets** seraient tombés à chaque push. Un correctif de sécurité qui
désactivait la sécurité.

| Constat | Ce qui a été fait |
|---|---|
| **F1 (critical)** | Job sonde `enregistrements` (checkout + une **étape** qui transforme `hashFiles(...)` en sortie `presents`), puis `parcours-dore: needs: enregistrements` avec `if: needs.enregistrements.outputs.presents == 'true'`. L'intention est préservée — armé par une **donnée**, pas par un drapeau — et la forme est celle que GitHub autorise. |
| **F2** | `PAYMENTS_RECORDED_EVENTS: ''` dans `webServerEnv()`. La règle « les deux régimes ne se mélangent jamais » devient vraie **partout**, pas à un seul endroit. |
| **F3** | Traces conservées dans `test-results-parcours-dore/`, chemin déclaré une fois et **comparé au workflow par un test**, pour que le défaut F8 ne puisse pas revenir en silence. |
| **F4** | « ne porte aucun enregistrement (son README y vit seul) ». Les quatre documents décrivent désormais le mécanisme réel. |

### La règle est devenue exécutable, et c'est le vrai gain

Ce défaut était invisible à **toutes** les commandes locales : `pnpm lint`,
`pnpm test`, `pnpm build` restaient verts. Il ne se manifestait que dans l'onglet
Actions de GitHub. C'est exactement ce que le `AGENTS.md` racine interdit — une
règle qu'aucune commande ne vérifie est de la documentation, pas une règle.

Deux filets ont été posés, et **les deux ont été vérifiés par le contexte
principal**, pas sur parole :

- `actionlint` (conteneur, aucune dépendance ajoutée au dépôt) : sur la forme
  fautive, `calling function "hashFiles" is not allowed here` en nommant les huit
  positions autorisées, toutes des **étapes** ; sur la forme livrée,
  **0 erreur** ;
- `tests/golden-path.test.ts` balaie tout `if:` de niveau job et refuse ce que
  GitHub n'y rend pas disponible. Mutation reposée à la main : **2 rouges**.

### Contre-vérification indépendante (contexte principal)

`actionlint` rejoué : 0 erreur sur le fichier livré, erreur nommée sur la
mutation. `pnpm test` sur la mutation : 2 rouges, aux deux gardes. Arbre restauré
et `git diff --exit-code` propre. Puis `pnpm typecheck` vert, `pnpm lint` sans
anomalie, `pnpm test` **1806 passés / 8 sautés**. Un seul commit ;
`tests/fixtures/stripe-events/` ne contient que son `README.md`.

### Ce que la capture Stripe réelle a apporté entre-temps

Le propriétaire a fourni une clé de test. Trois prix réels ont été créés, et
**deux charges utiles authentiques** ont été capturées hors dépôt :
`customer.subscription.created` et un vrai `checkout.session.completed` en mode
abonnement, obtenu par un paiement réellement complété au navigateur.

Deux constats en découlent, qu'aucun simulateur ne pouvait produire :

1. **La page hébergée de Stripe collecte bien une adresse**, et
   `customer_details.email` est renseigné. C'était la question laissée ouverte
   par la revue de s24 : sans adresse, aucun compte invité n'aurait été créé,
   avec un parcours vert ici et cassé en production. **Le chemin tient.**
2. **Les webhooks arrivent dans la version d'API du compte** (`2023-10-16`), pas
   dans celle que l'adaptateur épingle pour ses appels sortants
   (`2026-08-26.dahlia`). Le code lit `current_period_end` **sur les lignes**
   d'abonnement, et la charge réelle le porte bien à cet endroit : la
   normalisation fonctionne contre une vraie forme, vérifié pour la première fois
   dans ce projet.

Le troisième enregistrement — `checkout.session.completed` en mode paiement
unique — n'est pas capturé. Le dossier reste donc vide, le job de CI reste
dormant, et `GOLDEN_PATH_PAYMENTS=recorded` continue d'échouer en nommant les
trois natures manquantes, comme l'ADR 048 l'exige.

Max severity: major
Ship allowed: yes
