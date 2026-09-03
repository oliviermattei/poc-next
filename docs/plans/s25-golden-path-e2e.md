---
story: s25-golden-path-e2e
validated: yes
---
# Plan — Story s25-golden-path-e2e

Branch: `feature/s25-golden-path-e2e`
Research: `docs/research/s25-golden-path-e2e.md` — **à lire d'abord** : elle établit qu'aucun enregistrement Stripe n'existe, et que le critère 6 ne peut pas être satisfait par le simulateur.
Décision: `docs/decisions/048-un-enregistrement-absent-fait-echouer-la-ci-jamais-de-repli-sur-le-simulateur.md`.
Pas de design : story de harnais, aucun écran.

## Story visée

« Vérifier le parcours clone → premier paiement ». Complexité mesurée **4**.
Porte le **critère de succès n°1 du PRD**.

Huit critères. Deux commandent tout le reste : le régime CI par **rejeu
enregistré** (6) et le régime hors CI sur **clés de test réelles** (7), qui
produit les enregistrements du premier.

## Les deux décisions que ce plan prend

**1. La mesure d'amorçage se fait dans un répertoire temporaire, depuis un
`git clone` local, avec `node_modules` absent et le cache pnpm chaud.**

La recherche a montré que chronométrer l'amorçage depuis l'arbre courant produit
un nombre flatteur et faux : `pnpm install` sur un `node_modules` chaud rend en
secondes ce qui prend des minutes sur un clone neuf — précisément la partie que
le boilerplate promet de raccourcir.

Le cache pnpm est laissé **chaud** délibérément : c'est la situation réelle d'un
acheteur qui a déjà utilisé pnpm, et un cache froid mesurerait sa bande passante,
pas notre boilerplate. **Ce que la mesure exclut est écrit dans le journal**, en
toutes lettres, à côté du chiffre — un nombre sans ses conditions est une
publicité, pas une mesure.

**2. Le parcours doré n'entre pas dans `pnpm test:e2e`, mais la CI l'exécute.**

Le critère 8 demande une commande unique, `pnpm test:golden-path`. L'y laisser
hors de `test:e2e` évite que chaque story paie l'amorçage complet, tout en
gardant l'intention de la story — « vérifié à chaque story et non une seule
fois » — puisque la CI le lance.

## Tâches (ordonnées)

1. [x] **Le scénario applicatif**, `e2e/golden-path.spec.ts` : inscription →
   vérification d'email → création d'organisation → souscription → accès à une
   fonctionnalité réservée. Réemployer `e2e/support/account.ts`,
   `interaction.ts`, `locale.ts` plutôt que réécrire des gestes.
   *Test* : le scénario **est** le test. Il doit échouer si une étape ne mène
   pas à la suivante — vérifier par mutation qu'un droit non accordé le fait
   rougir, et non passer à l'étape d'après.

2. [x] **Un délai par étape** (critère 8), qui nomme l'étape dépassée. Ce n'est
   pas le délai global de `playwright.config.ts:135` : un parcours bloqué doit
   dire *où*, pas expirer au bout de deux minutes sans rien apprendre.
   *Test* : une étape volontairement retardée fait échouer en nommant l'étape.

3. [x] **Base vierge par exécution** (critère 2) : migration et seed sur une base
   dédiée, sans état résiduel. Le seed est déjà rejouable (socle fiabilité) ; ce
   qu'il faut ajouter est l'**isolation**, pas l'idempotence.
   *Test* : deux exécutions consécutives donnent le même résultat ; la seconde ne
   voit rien de la première.

4. [x] **Les deux variantes** (critère 3) : achat unique, et guest checkout. Le
   parcours invité passe par `/pricing` sans session, comme s24 l'a livré.
   *Test* : les trois chemins (abonnement, achat unique, invité) atteignent
   chacun leur droit d'accès.

5. [x] **L'amorçage mesuré** (critère 4), selon la décision 1 : répertoire
   temporaire, `git clone` local, `.env` depuis `.env.example`, `pnpm install`,
   `pnpm db:migrate`, `pnpm db:seed`. Le répertoire est nettoyé après.
   *Test* : l'amorçage échoue si `.env.example` ne suffit pas à démarrer — c'est
   la promesse du boilerplate, et elle doit rougir quand elle cesse d'être vraie.

6. [x] **Les trois durées journalisées** (critère 5) : amorçage, parcours, total.
   Avec, sur la même sortie, **ce que la mesure exclut** (cache pnpm chaud, pas
   de téléchargement de navigateur). Aucun secret dans le journal.
   *Test* : la sortie contient les trois durées et la ligne de conditions.

7. [x] **Le régime enregistré** (critère 6, ADR 048). Rejeu depuis des
   enregistrements versionnés, **aucun appel sortant**, et **échec nommé** si un
   événement attendu n'a pas d'enregistrement — jamais de repli sur le
   simulateur.
   *Test* : retirer un enregistrement fait échouer en le nommant. C'est la
   mutation centrale de cette story ; si elle est verte, l'ADR 048 n'est pas
   tenu.

   **État livré** : le mécanisme est complet et éprouvé de bout en bout — avec
   des enregistrements en place, les trois parcours passent par eux et sont
   verts ; l'un retiré, la commande le nomme et s'arrête. **Aucun
   enregistrement authentique n'est versionné**, parce qu'en produire exige une
   exécution contre les clés de test réelles (critère 7), c'est-à-dire un geste
   humain avec des secrets que le harnais n'a pas.
   `GOLDEN_PATH_PAYMENTS=recorded pnpm test:golden-path` **échoue donc
   aujourd'hui, en nommant les trois natures manquantes** — c'est la conséquence
   écrite dans ADR 048 (« La CI ne peut pas passer sans enregistrements »), pas
   un défaut de câblage.

8. [x] **Le régime réel** (critère 7), sur le modèle de
   `packages/adapters/stripe/src/stripe-live.test.ts` : variables explicites,
   jamais actif par défaut. C'est lui qui **produit** les enregistrements, et
   c'est le geste qui demande vos clés — il ne peut pas être exécuté par le
   harnais seul.
   *Test* : sans les variables, le régime ne s'exécute pas et le dit.

   **État livré** : le mécanisme existe, il est refusé sans ses variables — les
   deux que la recette **lit réellement**, `STRIPE_SECRET_KEY` et
   `STRIPE_LIVE_PRICE_ID` (corrigé en reprise, constat F3) —, il refuse une clé
   qui n'est pas `sk_test_…` et il est refusé en CI. **Il n'a jamais été
   exécuté** : personne ici n'a de clé Stripe.

   **Et l'écart au critère est plus large que « il ne manque que les clés » :
   le régime `live` livré n'exécute pas le scénario.** `captureAgainstRealKeys()`
   éprouve les clés (recette de s19) puis capture les formes ; il ne clone rien,
   ne crée aucune base, n'ouvre aucun navigateur. Le critère 7 demande que « le
   **même scénario** s'exécute contre les clés de test » : ce qui est livré est
   conforme à **ce plan**, pas à la **story**. S'y ajoute un obstacle nommé : la
   variante invité fabrique une adresse `…@guest.local`, qu'un vrai fournisseur
   refusera. Écrit ici, dans `tests/fixtures/stripe-events/README.md`, dans
   `docs/architecture.md` et dans le message de refus d'`expectedEventIdPrefix`,
   pour qu'aucun lecteur ne prenne le mécanisme pour le critère.

9. [x] **`pnpm test:golden-path`** (critère 8), commande unique enchaînant
   amorçage puis parcours, et rendant les trois durées.

10. [x] **Documentation.** Le tableau des commandes d'`AGENTS.md` racine gagne
    `pnpm test:golden-path` (un test le vérifie déjà — il rougira sans).
    `docs/architecture.md` pour les deux régimes. Et **la date des
    enregistrements**, écrite à côté d'eux (ADR 048 : un enregistrement fige la
    forme du jour où il a été pris).

## Interdits d'exécution

- **Ne jamais retomber sur le simulateur** quand un enregistrement manque
  (ADR 048). C'est l'interdit central.
- **Ne pas mélanger les deux régimes** — la story le nomme comme « la source
  d'échecs intermittents la plus classique sur ce type de harnais ».
- **Ne pas faire échouer le parcours sur le seuil de 30 minutes.** Le harnais
  **mesure** ; le seuil est une recette humaine. Un test qui rougit à 31 minutes
  transformerait une promesse commerciale en régression de CI, sur une machine
  dont on ne contrôle pas la charge.
- **Ne pas versionner d'identifiants réels** dans les enregistrements : formes
  assainies, valeurs inertes (ADR 048).
- **Ne pas ajouter le parcours doré à `pnpm test:e2e`** (décision 2).
- **Ne pas modifier les quinze specs existantes** ni leur préchauffage partagé.
- **Ne pas journaliser de secret**, y compris dans les traces d'échec.
- **Ne pas toucher `config/`.**

## Le point sur lequel tout repose

**Le repli silencieux.** Toute cette story ne vaut que si l'absence
d'enregistrement fait échouer bruyamment. Un repli sur le simulateur laisserait
la CI verte en ayant cessé de vérifier ce qu'elle prétend vérifier — et cette
session a déjà mesuré ce que coûte ce mode de défaillance : 288 tests qui se
sautaient en silence, et deux stories dont le câblage entier pouvait disparaître
sans qu'un seul test rougisse.

Trois endroits où ce plan peut être faux :

1. **La mesure d'amorçage peut mesurer autre chose que ce qu'elle annonce.** À
   comparer avec sa propre ligne de conditions : si le journal dit « cache chaud »
   et que le cache était froid, le chiffre ment dans le bon sens.
2. **L'isolation de la base peut fuir.** Si le parcours doré et `test:e2e`
   partagent une base, le critère 2 est faux sans que rien ne le dise.
3. **Le régime réel peut n'avoir jamais été exécuté.** C'est le seul critère que
   le harnais ne peut pas prouver seul : il demande des clés. Le plan doit livrer
   le mécanisme **et** dire clairement qu'il n'a pas été exercé.

## Fichiers touchés (anticipé)

| Fichier | Nature |
|---|---|
| `e2e/golden-path.spec.ts` | le scénario et ses deux variantes |
| `e2e/support/…` | délai par étape, mesure |
| `scripts/golden-path.ts` (ou équivalent) | amorçage mesuré, commande unique |
| `tests/fixtures/stripe-events/` (+ leur date) | enregistrements assainis |
| `packages/payments-testing/…` | régime enregistré, sans repli |
| `package.json` | `test:golden-path` |
| `playwright.config.ts` | projet ou configuration séparée |
| `AGENTS.md`, `docs/architecture.md` | docs |

## Stratégie de test

| Niveau | Ce qu'il couvre |
|---|---|
| `e2e/golden-path.spec.ts` | les trois chemins jusqu'au droit d'accès |
| mutation | **quatre** : enregistrement retiré (doit nommer) ; repli sur le simulateur (doit être impossible) ; droit non accordé (doit rougir) ; base partagée (doit rougir) |
| commande | `pnpm test:golden-path` deux fois de suite, même résultat |
| `tests/agents-md.test.ts` | la commande neuve doit être documentée — il rougira sinon |

## Definition of Done

- Les huit critères vérifiés, sauf le régime réel (critère 7) dont le mécanisme
  est livré et testé **à vide** — son exécution demande des clés que le harnais
  n'a pas. **Le dire explicitement dans le rapport, ne pas le cocher en silence.**
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` verts.
- `pnpm test:golden-path` vert, ses trois durées et sa ligne de conditions
  journalisées.
- Les quatre mutations vérifiées rouges.
- Un seul commit, message impératif en français, portant recherche, plan et ADR 048.

## Reprise après revue (fix)

`docs/reviews/s25-golden-path-e2e.md` a refusé le ship : `Max severity: critical`.
Ce qui a été repris, dans l'ordre du rapport.

- [x] **F1 (critical) — la garantie centrale n'était vérifiée par aucune
  commande.** Le constat est juste, sa cause ne l'était pas, et la mesure a
  trouvé pire. **Playwright ne remplace pas l'environnement du serveur, il le
  fusionne** — `{ ...process.env, ...webServer.env }`, vérifié dans
  `playwright/lib/runner/index.js`. Retirer `...recordedEventsEnv()` ne privait
  donc pas le serveur du dossier : l'exécution rejouait réellement, et le vert
  mesuré par la revue était un vrai vert, non un repli silencieux (prouvé : sous
  cette mutation, les événements traités portaient tous `evt_rec_…`).
  **Ce que cette fusion crée en revanche est une vraie fuite** : un
  `PAYMENTS_RECORDED_EVENTS` resté dans un shell était hérité par le serveur, et
  une exécution annonçant `simulated` rejouait des enregistrements — mesuré,
  cinq événements `evt_rec_…` sous un régime `simulated`. La configuration
  dérive désormais le dossier du **régime demandé** (`recordedEventsDirectoryFor`)
  et le pose toujours, vide au besoin : la commande décide, l'ambiance ne décide
  plus.
  Le rejeu et le simulateur marquent désormais leurs identifiants d'événement
  (`evt_rec_…` / `evt_local_…`, `SIMULATED_EVENT_ID_PREFIX` et
  `RECORDED_EVENT_ID_PREFIX`, employés par les deux producteurs), et le parcours
  doré **exige** de retrouver la marque du régime demandé dans le journal
  d'idempotence écrit par la vraie route de webhook — un signal **positif**,
  jamais la confiance. La règle est pure (`verifyEventIdMark`), éprouvée sans
  navigateur ; le parcours lui apporte l'observation.

- [x] **F4 (major) — le job de CI est armé sur une donnée, pas sur un drapeau** :
  un job sonde cherche un enregistrement versionné, le parcours dépend de sa
  réponse (la forme `if: hashFiles(…)` écrite ici d'abord était invalide — voir
  la seconde reprise ci-dessous). Il ne s'exécute pas tant qu'il n'y a rien à
  rejouer, et devient bloquant à la première capture
  versionnée — ni `continue-on-error`, ni régime de repli. Le fait que **ce
  dépôt n'ait jamais été éprouvé contre les formes réelles de Stripe** est écrit
  à côté du job, dans le README des enregistrements et dans `AGENTS.md`.

- [x] **F3 (major)** — le régime `live` exige désormais l'ensemble qu'il emploie.
- [x] **F5 (major)** — `GOLDEN_PATH_CAPTURE_FROM` accepte le NDJSON de
  `stripe listen --print-json` comme un dossier, et refuse un chemin absent en le
  nommant.
- [x] **F6, F7, F8, F9 (minor)** — lecture du bloc `env:` ancrée sur le job
  `quality` ; compte d'exhaustivité remplacé par le nom du fichier ; traces
  recopiées hors du clone avant sa destruction ; route réservée absente refusée
  en le disant, et les deux modules exigés par le parcours affirmés **une fois**
  pour les trois parcours (plus de saut silencieux).

- [ ] **F2 (minor) — non repris, assumé** : le régime `simulated` reste hors du
  plan validé. Il n'est jamais choisi implicitement, il est refusé en CI, et
  c'est lui qui rend la story exerçable en attendant les enregistrements.

## Seconde reprise après revue (fix)

La re-revue a vérifié la contestation du F1 précédent à la source de Playwright
et l'a confirmée (`runner/index.js` fusionne `process.env`), puis a refusé le
ship pour une faute introduite par le premier correctif.

- [x] **F1 (critical) — `hashFiles` est interdit dans un `if:` de job**, et
  l'y écrire ne se contente pas de ne jamais s'armer : GitHub rejette le
  **fichier entier**. Ce dépôt n'a qu'un workflow — rejeté, il emporte
  `quality` (typage, lint, `pnpm test`, `pnpm test:e2e`, audit) **et** le scan
  de secrets, c'est-à-dire tout ce que le socle de sécurité exige de bloquant.
  La cause est structurelle : un `if:` de job est évalué avant qu'une machine
  soit allouée et avant tout `checkout`. L'armement passe donc par un **job
  sonde** (`enregistrements`) qui pose une sortie depuis une **étape**, seul
  niveau où GitHub autorise la fonction ; `parcours-dore` en dépend par `needs`.
  L'intention est intacte : armé par la donnée, jamais par un drapeau.
  **Vérifié mécaniquement par `actionlint`** (image `rhysd/actionlint`, aucune
  dépendance ajoutée au dépôt) : la version fautive était nommée à la ligne du
  `if:`, la nouvelle rend « 0 errors ». Et la règle est désormais exécutable
  hors de GitHub — `tests/golden-path.test.ts` refuse, dans `pnpm test`, tout
  `if:` de job employant autre chose que `github`, `needs`, `vars`, `inputs` et
  les fonctions générales.

- [x] **F2 (minor) — la même fuite d'ambiance restait ouverte pour
  `pnpm test:e2e`** : `webServerEnv()` ne neutralisait pas
  `PAYMENTS_RECORDED_EVENTS`, et la suite principale héritait donc du dossier
  laissé dans un shell ou dans le `.env` du poste. Une ligne —
  `PAYMENTS_RECORDED_EVENTS: ''` — et « les deux régimes ne se mélangent
  jamais » devient vrai partout, pas à un seul endroit.

- [x] **F3 (minor)** — les traces conservées quittent `test-results/`, que
  Playwright efface au démarrage de `pnpm test:e2e`, pour
  `test-results-parcours-dore/`. Le chemin est déclaré une fois
  (`FAILURE_TRACES_DIRECTORY`) et comparé au workflow par un test : deux
  écritures divergentes redonneraient le défaut F8.

- [x] **F4 (minor)** — `AGENTS.md` ne dit plus que le dossier des
  enregistrements « est vide » : il ne porte aucun enregistrement, son README y
  vit. Les quatre documents qui décrivaient l'armement (`ci.yml`, le README des
  enregistrements, `AGENTS.md`, `docs/architecture.md`) décrivent le mécanisme
  réel.

- [ ] **F5 — non repris, accepté par la revue** : le régime `simulated` reste
  hors du plan validé.
