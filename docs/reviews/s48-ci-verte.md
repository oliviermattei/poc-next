# Review — Story s48-ci-verte

> Fresh-context review. Each issue classified: critical / major / minor.
> Diff reviewed: `git diff dev...feature/s48-ci-verte` — HEAD `689dcce`, branch `feature/s48-ci-verte`, worktree `/Users/olivier/www/boilerplate/.worktrees/s48-ci-verte`, PostgreSQL on 5439.
> 13 files, +1272 / −39. No `.tsx`, no `packages/` file, no `app/` file: **confirmed no UI** — `docs/design-system.md` is not engaged.

## What I ran (not what was reported)

| Commande | Résultat mesuré ici |
|---|---|
| `pnpm test` ×8 | 7 vertes à **1960 passed / 8 skipped (1968)** ; 1 rouge, `tests/billing.test.ts:5628` (intermittent connu, hors périmètre — voir Régressions) |
| `pnpm test:socle` | **rouge** — et uniquement sur ce même intermittent, `tests/billing.test.ts:5628`, dans le clone. Tout le reste vert : **1954 passed / 13 skipped / 1 failed**. Dérivation : « 3 module(s) coupé(s) — marketing, organizations, i18n —, 7 activé(s) » |
| arbre après `test:socle` | `git status --porcelain` **identique avant/après**, y compris après l'échec (`TREE_IDENTICAL`) |
| `pnpm test:minimal-profile` | vert, 4 parcours navigateur, arbre propre |
| `pnpm typecheck` | 25/25, y compris **forcé sans cache** (`turbo run typecheck --force`) |
| `pnpm lint` | propre, `--max-warnings=0` |
| `pnpm build` | OK, y compris **forcé sans cache** |
| `pnpm run audit` | vert — « 1 avis remonté(s), aucun au seuil « élevé » qui ne soit couvert » |

Comptes par fichier, mesurés : `tests/minimal-profile.test.ts` **42** (38 sur `dev`, +4, **aucun supprimé**), `tests/socle.test.ts` **6**, `tests/audit-exceptions.test.ts` **27** (+4). Les 42 de `minimal-profile` s'exécutent sous **les deux** configurations (le fichier est vert dans le passage socle, aucun saut).

## Plan compliance
- [x] The code does what the plan specifies, nothing more — les huit tâches sont faites. Tâche 4 livre un **surensemble** du plan (`db:generate` et `db:migrate` en plus de typecheck/lint/test/build) parce que trois cas interrogent une vraie base : c'est l'ordre du job, pas de la dérive. Rien dans le diff n'échappe au plan ou aux sept déviations déclarées.
- [x] Run interdicts respected — chacun vérifié **mécaniquement** :
  - diff de `.github/workflows/ci.yml` **vide** — `git diff dev...feature/s48-ci-verte --name-only` ne contient aucun fichier sous `.github/` ;
  - aucun `it.skip` / `it.skipIf` / `describe.skip` / `return` anticipé dans `tests/minimal-profile.test.ts` (la seule occurrence de `it.skipIf` est dans un commentaire, `:300`) ; nombre de cas **en hausse** (38 → 42), et 42 sous les deux configurations ;
  - **aucun identifiant de module en dur** dans ce fichier ni dans `scripts/socle.ts` / `scripts/socle-rules.ts` — balayage sur les onze identifiants de l'annuaire : une seule occurrence, `demo-disabled` dans un **commentaire** (`:87`). `'auth'` n'apparaît que comme identifiant de l'**annuaire d'essai**, motif déjà présent sur `dev` ;
  - `config/features.ts` et `config/profiles.ts` **absents du diff** ;
  - `tests/billing.test.ts` **absent du diff** ;
  - **aucune entrée de navigation ajoutée** : aucun fichier de `packages/` n'est touché ;
  - arbre propre après la commande socle : vérifié après un passage **en échec**.

## Anti-hallucination
- [x] Aucun import, appel ou clé inventé. Chaque cible ouverte et vérifiée :
  - `readEnabledModules` → `packages/cli/src/features-file.ts:152`, réexporté par `packages/cli/src/index.ts` ;
  - `loadRootEnv` → `packages/config/src/dotenv.ts:76`, réexporté par `packages/config/src/server.ts:11` ;
  - `createDatabaseClient` → `packages/db/src/client.ts:31` ;
  - `humanDuration` → `e2e/support/steps.ts:78` (même import que `scripts/minimal-profile.ts:20` et `scripts/golden-path-regime.ts:3`) ;
  - `bootstrapEnvFile` / `freshDatabaseUrl` → `scripts/golden-path-regime.ts:261,287` ;
  - `assertProfileWasApplied` / `assertWorkingTreeUnchanged` / `cloneEnvironment` / `CLONE_STRIPPED_ENV_KEYS` → `scripts/minimal-profile-rules.ts:385,548,670,644`, signatures conformes aux appels ;
  - `create database` / `drop database … with (force)` par `withMaintenanceConnection` : motif **recopié** de `scripts/minimal-profile.ts:143,293,391` et `scripts/golden-path.ts:126,207,238`, pas inventé.
- [x] La dérivation lit ce qu'elle prétend lire : `STEP_START` referme la garde sur `      - name: Couper les modules optionnels` (`ci.yml:99`), `GUARD` mord sur `        if: matrix.modules == 'socle'` (`:100`), `TOGGLE` capture les trois identifiants de `:101`. Vérifié à l'exécution : la commande annonce exactement `marketing, organizations, i18n`.
- [x] **La correction de la prémisse est vraie, et je l'ai recalculée moi-même** sur l'annuaire réel, module par module, sur les **onze** modules qu'il déclare. Sous les six critères indépendants de la configuration : `marketing` **et** `demo-disabled` sont coupables ; sous les sept (activation comprise) : `marketing` seul. Le tableau de la recherche portait déjà la donnée — le « un seul candidat » de la recherche parlait du prédicat à sept critères. La déclaration était donc une **clarification exacte**, pas une contradiction.

## Rules compliance
- [x] AGENTS.md : deux emplacements de test respectés (`tests/` racine), nommage `kebab-case`, commit unique impératif en français portant recherche et plan, ADR 052 en MADR avec ses options rejetées. La ligne `pnpm test:socle` du tableau des commandes est **obligatoire mécaniquement** : `tests/agents-md.test.ts:231-247` dérive la liste depuis `package.json` et exige `pnpm <script>` dans la section `## Commands` — la déviation 5 est donc forcée, pas choisie.
- [x] Aucun ADR contredit. ADR 021 (socle non désactivable) est **appliqué** par `cutModulesOfSocle`, qui refuse un identifiant du socle. ADR 041 est cité en justification du travail « dans une copie » : le raccourci est un peu large (l'ADR pose la garde sur les écritures **nouvelles** pilotées par agent et en exempte explicitement `ks toggle`), mais la conclusion est plus stricte que l'ADR et cohérente avec son « à surveiller ».
- [x] Socle de sécurité : **aucun contrôle retiré, désarmé ni rendu non bloquant**. La porte d'audit reste bloquante, une panne durable sort en **échec nommé** (jamais en vert par défaut), aucun `continue-on-error`, aucun job supprimé. Rien du diff ne touche CSP, cookies, autorisation, Zod, webhooks ou secrets. Le `.env` du clone est dérivé de `.env.example` et `cloneEnvironment` **retire** les clés d'application du poste : aucun secret ne descend dans la copie.
- [x] Socle de fiabilité §3 : recul exponentiel, dispersion « à moitié », plafond — présents et éprouvés. Deux écarts mineurs, voir Findings.

## Tests
- [x] Suite lancée par le relecteur, huit fois, plus le passage socle complet.
- [x] Les assertions épinglent les critères d'acceptation, pas de la décoration : aucune assertion sur une classe CSS, une structure DOM, un libellé statique ou un inventaire. Les cas socle éprouvent des **refus** (liste vide, bascule hors garde, module inconnu, module du socle), les cas audit éprouvent des **comptes d'appels** et des **codes de sortie**.
- [x] **Morsure prouvée par neutralisation — douze mutations, chacune posée à l'endroit du défaut**, restaurées une à une (`git diff --exit-code` propre après chacune) :

| # | Où (site du défaut) | Neutralisation | Rouges |
|---|---|---|---|
| 1a | `packages/modules/marketing/src/module.ts:67` | `navigation: []` sur le **seul** coupable activé | **0** |
| 1b | + `packages/modules/demo-disabled/src/module.ts:37` | `navigation: []` sur **les deux** coupables | **2** |
| 2 | `scripts/minimal-profile-rules.ts:231` | liste de coupure **écrite en dur** au lieu d'être dérivée d'`enabled` — le défaut même que le critère 8 existe pour attraper | **8** (dont le cas du critère 8) |
| 3a | `scripts/socle-rules.ts:74` | toute bascule comptée comme gardée | **1** |
| 3b | `scripts/socle-rules.ts:87` | refus de liste vide désarmé | **1** |
| 3c | `.github/workflows/ci.yml:101` | une bascule renommée en module inconnu | **1** |
| 4a | `scripts/audit-exceptions.ts:71` | `AUDIT_ATTEMPTS = 1` | **1** |
| 4b | `scripts/audit.ts:50` | un document d'avis levé en `AuditRunError` (les deux branches confondues) | **2** |
| 4c | `scripts/audit-exceptions.ts:92` | plafond retiré | **1** |
| 4d | `scripts/audit-exceptions.ts:95` | dispersion « à moitié » retirée | **1** |
| 5a | `tests/minimal-profile.test.ts:384` | verdict forcé sur `explication` | **2** |
| 5b | `tests/minimal-profile.test.ts:384` | verdict forcé sur `preuve` | **1** |

  Ce que ces mutations tranchent, point par point, contre les trois risques nommés par le plan :

  1. **L'invariant n'est pas tautologique** — 1b le rougit (2 cas), et le second plancher (`coupables.length < availableModules.length`) refuse un prédicat relâché jusqu'à tout accepter. **Mais 1a confirme la déclaration de l'implémenteur : retirer la navigation du seul coupable activé laisse la suite verte.** L'invariant dit « au moins un », il tient exactement ce qu'il annonce — c'est honnête, et l'ADR l'écrit au pluriel dans son « à surveiller ».
  2. **Les deux branches s'exécutent réellement à chaque passage** — 5a et 5b le prouvent sur l'annuaire d'essai, chacune ne rougissant que sa branche. Ce n'est pas un saut silencieux déguisé. 5a montre en outre que la branche « explication » **ne peut pas** être prise en silence alors qu'un candidat existe : le cas de l'annuaire réel rougit aussi (2 rouges).
  3. **La liste dérivée ne peut pas être vide** — 3b le prouve ; 3a prouve le refus d'une bascule hors garde ; 3c prouve que la dérivation **remarque** un workflow qui a changé ses bascules vers un identifiant que l'annuaire ignore.
  4. **La reprise ne rejoue jamais un avis** — 4b, la mutation qui compte : confondre les deux branches rougit *« ne rejoue jamais un document d'avis, qu'il bloque ou non »*. **Et la porte reste bloquante sur un avis élevé** — le cas exige `status !== 0` en **un seul** appel.

  Un point à ne pas laisser passer : la mutation 4a n'a rendu **qu'un** rouge. Le cas *« épuise ses tentatives »* dérive son attendu de `AUDIT_ATTEMPTS` et suit donc la constante ; c'est le cas *« rejoue une panne … quand elle cesse »* (2 pannes scriptées puis un succès, `appels === 3`) qui épingle réellement l'existence de la reprise. Le filet existe, il est juste porté par un seul des deux cas.
- [x] Aucun test supprimé : le cas du critère 8 est **réécrit sur place**, les autres sont des ajouts. Vérifié par comptage sur `dev` (38) contre la branche (42).

## Regressions
- [x] Chemins touchés rouverts : `scripts/audit.ts` (seul appelant de `runPnpmAudit`, `main` inchangé dans sa décision), `scripts/minimal-profile-rules.ts` (**non modifié** — seulement importé), `scripts/golden-path-regime.ts` (**non modifié**). `pnpm test:minimal-profile` est verte ici ; `pnpm test:golden-path` n'a pas été jouée (voir *Not verified*).
- **Intermittent de `tests/billing.test.ts`, hors périmètre — vérifié plutôt qu'accepté.** Le fichier est **absent du diff**. L'assertion qui tombe (`:5627-5628`) compare un **delta global** de `auth_session` sur la base partagée pendant que les autres fichiers tournent en parallèle : c'est une course inter-fichiers de la suite de s19, que rien dans ce diff ne peut provoquer (les trois fichiers ajoutés/modifiés n'ouvrent aucune session). L'interdit du plan est donc justifié. **Mais mon décompte est plus sombre que le sien** : 2 rouges sur **9 exécutions complètes** (8 `pnpm test` + le passage dans le clone socle), toujours au même endroit — contre « 1 sur 15 » au cumul d'avant. À ~10-20 %, ce seul cas peut rougir le run de CI qui doit constater le dernier critère d'acceptation de cette story. À porter en story propre, pas ici.

## Findings

- **major — `scripts/socle.ts:215-231` + la ligne `pnpm test:socle` d'`AGENTS.md` : la commande rejoue six des neuf étapes que la branche socle exécute réellement, et la liste des commandes n'est *pas* dérivée du workflow.** Le job `quality` de `.github/workflows/ci.yml` tourne sous les **deux** valeurs de matrice et enchaîne, après `build` : `pnpm exec playwright install` puis **`pnpm test:e2e`** (`:141-145`), la comparaison **« l'arbre reste propre après le build et les parcours »** (`:157-164`) et **`pnpm run audit`** (`:168-169`). `pnpm test:socle` s'arrête à `build`. Or `AGENTS.md` la décrit comme rejouant « **les commandes du job** dans l'ordre du workflow » et affirme « sans elle, la moitié rouge de la matrice ne se constate qu'après un push » ; le docstring de `scripts/socle.ts` répète « joue les commandes du job ». C'est faux pour trois étapes, dont celle qui casse le plus probablement sous une configuration à modules coupés : un parcours Playwright qui vise une route ou une entrée de navigation disparue. La recette symétrique `pnpm test:minimal-profile`, elle, **joue** un passage navigateur. Aggravant : la liste des **bascules** est dérivée du workflow — exemplaire —, mais la liste des **commandes** est écrite en dur dans le script, et **aucun test ne rougit** si le job gagne une septième étape (`tests/env-wiring.test.ts` ne lit que le bloc `env:`, `tests/socle.test.ts` ne lit que les bascules). C'est la règle du dépôt retournée contre lui : *quelle commande échoue si ça cesse d'être vrai ?* — aucune. Un vert de `pnpm test:socle` **n'établit pas** que la moitié socle de la CI est verte, ce qui est l'objet même de la story. Remède : dériver la liste des `run:` du job comme les bascules le sont, ou nommer explicitement les étapes exclues et pourquoi (dans le script, dans `AGENTS.md` et dans le journal de la commande, à côté du « ce que la mesure exclut »).

- **minor — `scripts/audit.ts:41` (déviation 7) : un échec de *lancement* de `pnpm` est rejoué.** `attemptAudit` lève `AuditRunError` sur `result.error !== undefined` — un `ENOENT`, un binaire absent, un `PATH` cassé. Ce n'est pas une erreur transitoire, et `docs/reliability.md` §3 réserve les reprises aux erreurs transitoires. **Acceptable en l'état** : le coût est borné (deux processus de plus, ~0,75 à 1,5 s), l'échec final reste bruyant et nomme le nombre de tentatives, et rien ne devient vert. L'implémenteur a eu raison de le déclarer plutôt que d'ajouter une distinction qu'il ne pouvait pas éprouver. À corriger au prochain cycle : distinguer `error.code === 'ENOENT'` (échec définitif, sortie immédiate) du reste.

- **minor — `scripts/audit.ts:34-37` : aucun délai d'attente explicite sur l'appel, alors que la story triple son pire cas.** `docs/reliability.md` §3, première puce : « Tout appel réseau sortant porte un délai d'attente explicite. Aucun appel sans délai. » `spawnSync('pnpm', ['audit','--json'], …)` n'en pose aucun ; la recherche a mesuré ~4 minutes avant qu'un `ERR_SOCKET_TIMEOUT` tombe. Avec trois tentatives, une panne durable coûte désormais ~12 minutes de job au lieu de ~4. Le manque préexiste à la story, mais c'est **cette** story qui écrit la puce de §3 sur **cet** appel et qui multiplie son coût. `spawnSync` accepte `timeout`.

- **minor — `docs/architecture.md:110-140` ne connaît pas `pnpm test:socle`.** La section liste les recettes de cette famille (`test:golden-path`, `test:minimal-profile`) ; la troisième n'y est pas. `AGENTS.md` l'a bien reçue — parce qu'un test l'y force. Ici rien ne force, donc rien n'a suivi : c'est exactement le cas de figure que la règle « docs ship with the code that changes them » vise.

- **minor — `docs/reliability.md:32` : « Elle rejoue trois fois ».** Le code fait au plus **trois tentatives**, donc deux rejeux ; `AGENTS.md`, le message d'échec et le test disent « trois tentatives ». Aligner la formulation, sinon un lecteur attendra quatre appels.

- **minor — la preuve du critère 8 ne tourne sous aucune configuration socle, et une option moins coûteuse n'a pas été pesée.** Sous socle, le cas du critère 8 se réduit à `expect(verdict.coupables).not.toEqual([])` (qui redit l'invariant d'annuaire) plus une assertion qui, la branche étant ce qu'elle est, est **vraie par construction** : si aucun coupable n'est activé, chaque module échoue nécessairement sur un critère ou sur l'activation. Ma mutation 5a montre qu'elle n'est pas morte pour autant — elle attrape un **mauvais choix de branche** —, mais c'est un filet étroit. ADR 052 le déclare honnêtement (« sous l'autre, c'est la capacité qui est affirmée, pas la généricité elle-même »), donc ce n'est pas un défaut caché. Il reste que `sweepProfile` est une fonction **pure** de l'annuaire : passer `enabled: [...enabledModules, coupable.id]` aurait fait tourner l'arithmétique des écarts sous **les deux** configurations, sans branche du tout. Cette option n'apparaît pas dans les « Considered options » de l'ADR. À consigner pour la prochaine story qui rouvre ce cas.

- **minor — `scripts/socle.ts:246-259` : une interruption laisse une base derrière elle.** Le nettoyage (`rmSync` + `drop database`) vit dans un `finally`, que SIGINT/SIGKILL ne joue pas ; chaque exécution interrompue laisse une base `socle_<horodatage>` sur le serveur du poste. Aucun script de `scripts/` n'installe de gestionnaire de signal, donc c'est le motif existant et non une nouveauté de cette story — mais la recherche signale déjà sept volumes orphelins de la même famille, et la promesse « après une interruption » de la commande ne porte que sur l'**arbre**, ce qui est vrai et incomplet.

**Ce que cette liste est** : sept constats trouvés en balayant les 13 fichiers du diff, les onze modules de l'annuaire, les neuf étapes du job `quality`, les trois docs touchées et les douze sites de mutation nommés plus haut. Elle ne prétend pas être ce qui existe.

## Jugement des sept déviations déclarées

1. **Deux modules capables, pas un** — correcte, recalculée ici sur les onze modules de l'annuaire (`marketing`, `demo-disabled`). La déclarer était **juste** : elle change ce que la mutation du plan pouvait prouver, et le taire aurait laissé croire à un filet plus serré qu'il n'est. **Acceptée.**
2. **Verdict discriminé au lieu d'un tableau pluriel** — **meilleure** que le plan : elle fait de la branche une valeur qu'on peut asserter, ce qui est précisément ce qui permet aux mutations 5a/5b de prouver que les deux branches s'exécutent. **Acceptée.**
3. **Constantes d'audit dans `audit-exceptions.ts`** — juste : c'est le fichier pur, importé par le script **et** par le test ; les laisser dans `audit.ts` aurait rendu la forme du recul inéprouvable sans lancer un processus. **Acceptée.**
4. **Deux fichiers de script** — juste, et conforme au motif `minimal-profile.ts` / `minimal-profile-rules.ts` déjà en place ; c'est ce qui rend la dérivation testable par six cas au lieu de zéro. **Acceptée.**
5. **Ligne d'`AGENTS.md` écrite à la tâche 4** — **forcée**, pas choisie : vérifié dans `tests/agents-md.test.ts:231-247`, qui dérive la liste des commandes de `package.json`. **Acceptée.**
6. **Cas supplémentaire sur la forme du recul** — justifié : `docs/reliability.md` §3 l'exige et rien d'autre ne le couvrait ; mes mutations 4c (plafond) et 4d (dispersion) le rougissent chacune. **Acceptée.**
7. **Un échec de lancement de `pnpm` est rejoué** — **acceptable tel que livré, en minor** (voir Findings). Le libellé du plan le couvre, la lettre de §3 non ; mais rien ne devient silencieux, rien ne devient vert, et le coût est borné. La bonne décision était de le déclarer plutôt que d'inventer une distinction non éprouvée.

## Not verified

- **`pnpm test:e2e` sous la configuration socle** — jamais joué, ni par la CI localement, ni par `pnpm test:socle` qui s'arrête à `build` (c'est le finding major). **Geste humain** : sur le clone socle, lancer `pnpm exec playwright install --with-deps chromium` puis `pnpm test:e2e`, et regarder les parcours qui visent une route ou une entrée de navigation de `marketing` / `organizations` / `i18n`.
- **La comparaison « l'arbre reste propre après le build et les parcours » sous socle** — la commande contrôle l'arbre de l'**hôte**, jamais celui du clone après `build` + `e2e`. Le commentaire du workflow (`:150-156`) dit que c'est `next dev`, démarré par Playwright, qui réécrit `apps/web/AGENTS.md` et `next-env.d.ts` : cette classe d'échec est hors de portée de `pnpm test:socle` par construction.
- **Une vraie panne de registre npm** — le double remplace le **réseau** (un `pnpm` posé sur le `PATH`), ce qui est la bonne frontière, mais aucun `ERR_SOCKET_TIMEOUT` réel n'a été provoqué ici. Le comportement observé de `pnpm run audit` est le chemin nominal (vert, 1 avis non bloquant).
- **`pnpm test:golden-path`, `pnpm test:e2e` sous « tous », `pnpm db:seed`, `pnpm billing:reconcile`, le scan de secrets `gitleaks`** — non joués : hors du périmètre du diff et sans rapport avec les chemins touchés.
- **Aucune vérification navigateur** — et il n'en fallait pas : le diff ne contient aucun `.tsx`, aucun fichier de `packages/` ou d'`apps/`, ce que j'ai constaté sur la liste des noms de fichiers plutôt que supposé.
- **Le dernier critère d'acceptation ne peut pas être constaté avant le ship.** « La CI de la branche par défaut est verte sur un run réel, l'état lu **par événement** (`push` **et** `pull_request`), jamais au rollup » ne s'observe qu'après la fusion. **Geste humain, après le merge** : `gh run list --branch dev` puis, pour le run retenu, vérifier les deux événements séparément et les **deux** valeurs de matrice (`modules: tous` et `modules: socle`), plus le job de scan de secrets — c'est précisément le piège documenté (un job homonyme vert masquant un rouge). Et compte tenu de l'intermittent de `tests/billing.test.ts` mesuré ici à 2 rouges sur 9 exécutions, prévoir qu'un premier run puisse rougir sans que cette story y soit pour quelque chose : le relire, ne pas le lui attribuer, et ouvrir la story qui traite ce delta global sur `auth_session`.

## Verdict

Aucun `critical` : aucun contrôle n'a été retiré, désarmé ni rendu non bloquant ; la porte d'audit rougit toujours sur un avis élevé, en un seul appel, et une panne durable sort en échec **nommé** plutôt qu'en vert. Le cœur de la story — un invariant qui remplace une précondition non tenue, deux branches réellement jouées, une dérivation qui refuse le balayage vide — tient sous la mutation, aux douze sites où je l'ai posée. Le `major` porte sur ce que la commande socle **promet** et ne couvre pas : il se ferme par une phrase honnête ou par une dérivation de plus, pas par un correctif risqué.

> Verdict du round 1 — **dépassé par le round 2 ci-dessous** :
> Max severity: major · Ship allowed: yes

---

# Revue — Round 2 (passe ciblée sur le delta `689dcce..bb1fb50`)

> Contexte fixe : branche `feature/s48-ci-verte`, HEAD **`bb1fb50`**, worktree `/Users/olivier/www/boilerplate/.worktrees/s48-ci-verte`, PostgreSQL sur 5439, branche par défaut `dev`.
> **Périmètre de cette passe** : le seul delta `git diff 689dcce..bb1fb50` — 11 fichiers, +687 / −33 — plus la re-confirmation des preuves du round 1 qui pouvaient bouger.
> Le round 1 s'est conclu sur `Max severity: major` / `Ship allowed: yes` ; cette passe existe parce que le `major` était une **promesse plus large que sa couverture**, le mode d'échec que ce dépôt nomme.

## Ce que je n'ai **pas** rouvert (le round 1 le couvre, et le delta n'y touche pas)

Vérifié par empreinte, fichier par fichier, entre `689dcce` et `bb1fb50` : `tests/minimal-profile.test.ts`, `scripts/minimal-profile-rules.ts`, `scripts/minimal-profile.ts`, `config/features.ts`, `config/profiles.ts`, `package.json` et `docs/decisions/052-…md` sont **identiques au bit près**. Je n'ai donc rejoué aucune des mutations 1a/1b/2/5a/5b du round 1 : leurs sites sont inchangés, et les deux branches du verdict du critère 8 tournent toujours chacune sous exactement une configuration — la propriété est portée par des fichiers que ce delta n'a pas ouverts. Je n'ai pas non plus rouvert la dérivation des **bascules** (`cutModulesOfSocle`), la forme du recul de l'audit (plafond, dispersion), ni le jugement des sept déviations initiales.

## Ce que j'ai lancé moi-même

| Commande | Résultat mesuré ici |
|---|---|
| `pnpm test:socle` | **verte, sortie 0.** `3 module(s) coupé(s) — marketing, organizations, i18n —, 7 activé(s), 10 étape(s) du job rejouée(s), 3 exclue(s)` · clone : `1965 passed / 13 skipped (1978)` · **parcours navigateur rejoués** : `78 passed / 22 skipped` en 1 min 30 s · amorçage 33 s, étapes du job **2 min 43 s** |
| arbre après `test:socle` | `git status --porcelain` **identique avant/après** |
| `pnpm test` ×5 (4 sur l'hôte + le clone socle) | `1970 passed / 8 skipped (1978)` sur l'hôte, `1965 / 13` dans le clone. **Zéro rouge**, y compris sur `tests/billing.test.ts` |
| `pnpm typecheck` | 25/25, **forcé sans cache** (`turbo run typecheck --force`, 25 cached → 0) |
| `pnpm lint` | propre, `--max-warnings=0` |
| `pnpm build` | OK, **forcé sans cache** |
| `pnpm run audit` | vert — « 1 avis remonté(s), aucun au seuil « élevé » qui ne soit couvert », **1,69 s** mesuré (le commentaire dit ~1,4 s : même ordre de grandeur, la marge de 60 s tient) |
| `pnpm test:minimal-profile` | verte, 4 parcours navigateur, arbre propre |
| `pnpm exec playwright test e2e/rate-limiting.spec.ts` sous « tous » | **impossible sur ce poste** — voir *Non vérifié* |

## Le compte de 13 étapes : l'implémenteur a raison, le round 1 avait tort

Recompté à la main sur `.github/workflows/ci.yml`, job `quality`, une ligne `run:` à la fois : `:94`, `:101`, `:108`, `:111`, `:114`, `:129`, `:133`, `:136`, `:139`, `:142`, `:145`, `:158`, `:169` — **13**. Les quatre autres entrées du job sont des `uses:` (`checkout`, `action-setup`, `setup-node`, `upload-artifact`) et ne portent pas de `run:`. Le « neuf » du round 1 était faux ; la commande annonce elle-même `10 rejouée(s), 3 exclue(s)` et journalise `3 étape(s) sur 13`, chiffres **dérivés**, jamais écrits. Constat corrigé.

## Le major est fermé, et je l'ai éprouvé par neutralisation

Huit mutations sur ce delta, chacune posée **au site du défaut**, restaurée une à une (`git diff --exit-code` propre après chacune) :

| # | Où (site du défaut) | Neutralisation | Rouges |
|---|---|---|---|
| M1 | `.github/workflows/ci.yml` | **une 14ᵉ étape `run:` ajoutée au job gardé** (`Une étape de demain`) | **1**, nommant l'étape ; et `pnpm test:socle` échoue **avant le clone** (`socle.ts:182`) |
| M2 | `scripts/socle-rules.ts:344` | refus des étapes non classées désarmé, la 14ᵉ étape toujours présente | **1** (le cas synthétique `:191`) — et le cas du fichier réel redevient vert, ce qui montre exactement qui porte le filet |
| M3 | `scripts/socle-rules.ts:372` | exclusion sans raison acceptée | **1** |
| M4 | `scripts/socle-rules.ts:383` | décision périmée acceptée | **1** |
| M5 | `scripts/socle-rules.ts:391` | répartition qui n'exécute rien acceptée | **1** |
| M6 | `scripts/audit.ts:41` | `timeout: timeoutMs` retiré de `spawnSync` | **1** |
| M7 | `scripts/audit-exceptions.ts:104` | valeur illisible de `AUDIT_TIMEOUT_MS` lue comme le défaut | **1** |
| M8 | `scripts/audit.ts:156` | **porte d'audit rendue non bloquante** (`blocking.length === 0` → `true`) | **1** |
| M9 | `e2e/rate-limiting.spec.ts:142` | attendu ramené au littéral d'avant le correctif (`[200,400,429]` dans les deux branches), puis **`pnpm test:socle` complet** | **1**, exactement à `e2e/rate-limiting.spec.ts:106`, `Expected value: 404` — et `test:socle` sort en 1 |

M1 tranche la question posée : **oui, une 14ᵉ étape rougit**, en la nommant, et la commande refuse de cloner. M8 tranche la question de sécurité : la porte d'audit reste bloquante, et le délai d'attente ne convertit aucun échec en silence — un dépassement lève `AuditRunError`, est rejoué, puis sort en **échec nommé** (M6 le prouve : sans le délai, une seule tentative au lieu de trois).

## Déviation 1 (`e2e/rate-limiting.spec.ts`) — les trois affirmations sont vraies

C'est celle qui touche s28, fraîchement livrée. Je l'ai éprouvée plutôt que lue :

1. **Le cas n'est sauté sous aucune configuration.** Aucun `test.skip` / `skipIf` n'a été ajouté ; le fichier passe de 6 cas à 6 cas. Sous socle, la sortie de `test:e2e` liste **les six** cas de `e2e/rate-limiting.spec.ts` comme `✓`, dont `:106` en 268 ms. Balayage de tous les `test.skip` d'`e2e/` : **34 sites, tous préexistants**, dans `billing`, `i18n`, `marketing`, `organizations`, `public-forms`, `storage` — la story ne touche qu'`e2e/rate-limiting.spec.ts` (+16/−1), donc les 22 sauts navigateur du passage socle ne cachent rien de cette story.
2. **Rien n'a été affaibli en une assertion qui ne peut pas échouer.** Sous « tous », `servesPublicPages` vaut `true` et le ternaire se réduit **au tableau d'origine, à l'identique** : la configuration livrée ne perd pas un octet d'assertion, et le `critical` de s28 n'est pas entamé. Sous socle, `[404]` est une assertion qui mord — M9 la neutralise et le cas rougit. La propriété finale (`expect((await reset(98)).status()).toBe(429)`) est hors du ternaire et s'exécute dans les deux.
3. **C'est une vraie correction, pas un test plié.** Le statut réellement reçu sous socle est **404**, mesuré (M9), déterministe, et il vient du répartiteur de modules : le module `marketing` coupé ne sert plus le formulaire. Et le geste choisi — **dériver l'absence** de `marketingSite.sections` plutôt que sauter — est littéralement la règle qu'ADR 052 pose dans cette même story : « une recette dont la précondition dépend de la configuration dérive l'absence de sa précondition, elle ne la saute pas ». Le prédicat est celui qu'utilise déjà `e2e/public-forms.spec.ts:33` (`marketingSite.sections.length > 0`), vérifié sur place ; `MarketingSite.sections` existe bien (`packages/modules/marketing/src/application/marketing-site.ts:21`) et `EMPTY_MARKETING_SITE` (`:36`) le laisse vide module coupé.

Modification hors plan et hors liste de constats, oui — mais **déclarée**, et c'était le prix à payer pour que la promesse « rejoue le job » cesse d'être fausse. **Acceptée.**

## Les trois exclusions, jugées une par une

Aucune n'est une plainte de coût ; chacune dit *pourquoi l'étape ne prouverait rien ici*.

- **« Installer les dépendances »** — l'amorçage lance `pnpm install --frozen-lockfile` dans la copie (`scripts/socle.ts:239`), **la même commande littérale** que `ci.yml:94`. Raison légitime : l'étape est jouée, pas sautée. ✔
- **« Couper les modules optionnels »** — l'amorçage joue les mêmes bascules, **dérivées de cette étape-là**, une par une (`socle.ts:244-246`), puis relit `config/features.ts` sur le disque de la copie (`assertProfileWasApplied`, `:253-257`) — ce que la CI ne fait pas. L'exclusion est **strictement plus forte** que l'étape exclue. ✔
- **« Installer le navigateur »** — `pnpm exec playwright install --with-deps chromium` provisionne des paquets système en root ; ce n'est pas un contrôle. Raison légitime, et la conséquence est **écrite là où on la lira** : `AGENTS.md` et `docs/architecture.md` disent tous deux « elle ne provisionne pas le navigateur des parcours ». La contrepartie non écrite : la commande dépend du cache Playwright du poste, dont la version peut dériver de celle du clone — l'échec serait alors celui de Playwright, qui nomme le binaire manquant. Acceptable. ✔

## La liste vit-elle en un seul endroit ?

Oui, vérifié. `SOCLE_STEP_DISPOSITION` (`scripts/socle-rules.ts:283-323`) est la seule énumération. `AGENTS.md` dit explicitement « Ce qu'elle ne rejoue pas se lit dans sa sortie, jamais ici » ; `docs/architecture.md` ne recopie rien ; le docstring de `scripts/socle.ts` écrit « Aucune liste n'est recopiée dans ce commentaire ». La sortie de la commande énumère exclusions **et** raisons, dérivées de la même répartition qui décide de l'exécution — donc l'une ne peut pas mentir sur l'autre. Les noms d'étapes en dur dans la répartition ne sont pas un identifiant de module recopié : une étape renommée en CI est refusée (M4).

## Interdits — chacun revérifié mécaniquement à `bb1fb50`

- diff de `.github/workflows/ci.yml` : **vide** (`git diff dev...feature/s48-ci-verte -- .github/` ne rend rien) ;
- aucun `it.skip` / `it.skipIf` / `describe.skip` ajouté dans `tests/*`, aucun cas Playwright sauté ajouté ; nombres de cas : `tests/socle.test.ts` 6 → **12**, `tests/audit-exceptions.test.ts` 27 → **31**, `tests/minimal-profile.test.ts` **42 → 42**, `e2e/rate-limiting.spec.ts` **6 → 6**. **Aucun test supprimé** ;
- aucun identifiant de module en dur dans `tests/minimal-profile.test.ts`, `scripts/socle.ts`, `scripts/socle-rules.ts` — balayage sur les onze identifiants de l'annuaire : `auth` n'apparaît que comme identifiant de l'**annuaire d'essai**, `demo-disabled` dans un commentaire ;
- `config/features.ts`, `config/profiles.ts`, `tests/billing.test.ts` : **absents du diff de story**, empreintes identiques ;
- arbre propre après la commande socle, **y compris après le passage en échec** de M9 : la seule différence constatée était ma propre mutation, restaurée.

## Socles de sécurité et de fiabilité

**Aucun contrôle retiré, désarmé ni rendu non bloquant.** La porte d'audit rougit toujours sur un avis élevé (M8, mutation posée à la décision même). `AUDIT_TIMEOUT_MS` n'est pas une échappatoire : une valeur courte transforme un audit lent en **panne nommée** puis en échec, jamais en vert ; une valeur illisible est refusée en nommant la variable (M7) ; aucune valeur ne rend la commande verte sur un avis. Fiabilité §3 : le délai d'attente manquant relevé au round 1 est posé, et la formulation « trois tentatives au plus, donc deux rejeux » corrige la précédente. `docs/architecture.md` connaît désormais la troisième recette de la famille. Rien du delta ne touche CSP, cookies, autorisation, Zod applicatif, webhooks ou secrets.

## Findings de ce round

- **minor — `scripts/socle-rules.ts:331` : le compte faux du round 1 a survécu dans le correctif qui existe pour l'éliminer.** Le docstring de `socleJobPlan` écrit encore « la commande promettait alors « les commandes du job » en en rejouant **six sur neuf** », alors que `scripts/socle.ts:65` et `tests/socle.test.ts:134-135` disent « six sur les **treize** ». La déviation 5 affirme que les comptes du round 1 ont été remplacés par des comptes mesurés ; il en reste un, et il est dans la fonction dont le métier est justement d'empêcher un compte de vieillir. Aucune commande ne rougit quand il est faux. Remède : la phrase se passe très bien du chiffre.

- **minor — déviation 2 : la collision `/tmp` est déclarée et rien ne la borne.** Deux `pnpm test:socle` simultanés sur la même machine partagent `/tmp/arbre-attendu.txt` et `/tmp/arbre-constate.txt` — et, plus largement, le clone lance `pnpm test:e2e`, donc le même port que ferait un `pnpm test:e2e` de l'hôte. Impact réel borné : les deux exécutions configurent la copie de la même façon, donc la comparaison reste comparable et le résultat probable est un rouge déroutant, pas un vert faux. Mais c'est déclaré dans un docstring, et *aucune commande n'échoue si quelqu'un l'ignore*. Un chemin par exécution (le `mkdtemp` existe déjà) fermerait la question sans discussion.

- **minor — « `sh -e` reproduit le `bash -e` de GitHub » est une approximation, écrite comme une équivalence.** `scripts/socle.ts:104-118`. Les treize `run:` actuels sont POSIX, donc rien ne casse aujourd'hui. Mais sur un poste Linux où `/bin/sh` est `dash`, un futur `run:` avec `[[ ]]`, un tableau ou `set -o pipefail` passerait en CI et échouerait localement — l'échec serait bruyant, pas silencieux, ce qui limite la gravité. Le mot « reproduit » invite le prochain agent à ne pas y penser ; « approche » serait exact.

- **minor — le rejeu des parcours n'a pas de plancher de cas exécutés, alors que la recette sœur en a un.** `pnpm test:minimal-profile` refuse « un effondrement du nombre de cas exécutés ou une part de cas sautés au-delà de 5 % ». `pnpm test:socle` rejoue désormais 100 cas navigateur dont **22 sautés** (tous préexistants et justifiés par la configuration, vérifiés un par un) et ne compte rien : une story future qui ferait sauter un fichier entier sous socle laisserait la commande verte. Ce n'est **pas** une promesse trahie — `AGENTS.md` ne prétend rien sur les sauts pour cette commande —, mais c'est la même famille que le constat qu'on vient de fermer, et c'est le prochain endroit où elle réapparaîtra.

- **minor (observation, hors delta) — la phrase générale d'ADR 052 est plus large que ce que quoi que ce soit vérifie.** « Une recette dont la précondition dépend de la configuration dérive l'absence de sa précondition, elle ne la saute pas » : le delta en donne la première application hors de la recette elle-même (déviation 1, et c'est à son crédit), pendant que `e2e/` porte 34 `test.skip` conditionnés par la configuration que la phrase, lue au pied de la lettre, interdit. Ces fichiers sont hors périmètre et intouchés ; je le signale parce que la tension ne devient visible qu'à partir de ce commit, et qu'une règle qu'aucune commande ne vérifie est de la documentation.

**Ce que cette liste est** : cinq constats trouvés en balayant les 11 fichiers du delta, les 13 étapes `run:` du job `quality` recomptées à la main, les 34 sites de saut d'`e2e/`, les trois docs modifiées et les neuf sites de mutation nommés plus haut. Elle ne prétend pas être ce qui existe.

## Les trois `minor` du round 1 qui restent ouverts

La section « Correctifs de revue » du plan ferme le `major` et trois `minor` (délai d'audit, `docs/architecture.md`, formulation de `docs/reliability.md`). Restent, non traités et correctement différés : le rejeu d'un échec de **lancement** de `pnpm` (`ENOENT`), l'option moins coûteuse non pesée pour la preuve du critère 8, et la base `socle_<horodatage>` qu'une interruption laisse derrière elle. Aucun n'est aggravé par ce delta.

## L'intermittent de `tests/billing.test.ts`

**Il n'appartient pas à cette story.** Le fichier est absent du diff de story ; l'assertion qui tombe compare un delta global de `auth_session` sur la base partagée pendant que les autres fichiers tournent en parallèle — une course inter-fichiers de la suite de s19. Mon décompte : **0 rouge sur 7 exécutions complètes** cette session (4 `pnpm test` sur l'hôte, 3 passages de vitest dans les clones socle). Cumul honnête sur les trois sessions : round 1 → 2/9, implémenteur → 1/7, moi → 0/7, soit **3 rouges sur 23 exécutions (~13 %)**. C'est assez pour rougir le run de CI qui doit constater le dernier critère d'acceptation : le relire avant de l'imputer à s48, et lui ouvrir sa story.

## Non vérifié

- **`pnpm test:e2e` sous la configuration « tous », sur ce poste** — impossible : le `.env` du poste porte de vraies `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`, et `webServerEnv()` pose `PAYMENTS_LOCAL_MODE`, ce que le schéma d'environnement refuse (« cannot be enabled while STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is set »). Condition du **poste**, préexistante, sans rapport avec le diff — et c'est précisément parce que `cloneEnvironment` retire ces clés que le passage socle, lui, a pu tourner. **Geste humain** : sur une machine sans clés Stripe, ou après avoir écarté ces deux variables, lancer `pnpm test:e2e` et regarder les six cas de `e2e/rate-limiting.spec.ts`. Ce que je peux affirmer sans l'avoir joué : sous « tous », l'expression se réduit au tableau d'origine, donc aucun changement de comportement n'est possible dans cette configuration.
- **Une vraie panne du registre npm** — le double remplace le **réseau** (un `pnpm` posé sur le `PATH` qui dort 30 s), ce qui est la bonne frontière ; aucun `ERR_SOCKET_TIMEOUT` réel n'a été provoqué. La valeur de 60 s reste un pari raisonné sur une mesure de ~1,4–1,7 s, pas une observation en panne.
- **Le comportement de `sh -e -c` sur un `/bin/sh` non-bash** — non joué : ce poste est macOS, où `/bin/sh` est bash en mode POSIX. C'est ce qui rend le finding correspondant théorique aujourd'hui.
- **Deux `pnpm test:socle` simultanés** — non provoqués (finding déclaré, non éprouvé).
- **`pnpm test:golden-path`, `pnpm db:seed`, `pnpm billing:reconcile`, le scan `gitleaks`** — non joués : hors du périmètre du delta et sans rapport avec les chemins touchés.
- **Aucune vérification navigateur au sens « écran »** — et il n'en fallait pas : le delta ne contient aucun `.tsx`, aucun fichier de `packages/` ou d'`apps/`, constaté sur la liste des noms de fichiers. Le seul fichier navigateur touché est un parcours d'API (`request.post`), sans rendu.
- **Le dernier critère d'acceptation ne se constate qu'après le ship.** « La CI de la branche par défaut est verte sur un run réel, l'état lu **par événement** (`push` **et** `pull_request`), jamais au rollup » : rien ici ne peut l'établir. **Geste humain, après le merge** : `gh run list --branch dev`, puis, pour le run retenu, vérifier séparément les deux événements **et** les deux valeurs de matrice (`modules: tous`, `modules: socle`), plus le job `secrets` — c'est le piège déjà documenté d'un job homonyme vert masquant un rouge. Et prévoir qu'un premier run puisse rougir sur l'intermittent de `tests/billing.test.ts` sans que s48 y soit pour quelque chose.

## Verdict du round 2

Le `major` du round 1 est **fermé, et fermé par une dérivation, pas par une phrase** : les étapes `run:` du job gardé sont lues dans le workflow, chacune est rejouée ou exclue avec sa raison écrite, quatre refus gardent la répartition, et une 14ᵉ étape rougit en se nommant — mesuré (M1), y compris au niveau de la commande, qui refuse avant de cloner. Les parcours navigateur, l'audit et la comparaison d'arbre tournent désormais sous la configuration socle, ce que rien ne faisait ailleurs qu'un runner : trois des « non vérifié » du round 1 tombent. Le compte contesté est tranché en faveur de l'implémenteur : **13 étapes, 10 rejouées, 3 exclues**, recompté à la main.

La déviation la plus risquée — la retouche d'un parcours de s28 — est une **vraie correction** : 404 déterministe mesuré, expectation neutralisée puis rougie à l'endroit exact, aucun saut, aucune assertion perdue, et sous la configuration livrée l'assertion est celle d'avant, à l'identique. Les quatre autres déviations sont proportionnées et déclarées.

Reste cinq `minor`, dont un compte faux à corriger d'un trait de plume et deux limitations honnêtement écrites mais qu'aucune commande ne borne. Rien qui ships un défaut, rien qui affaiblisse un socle.

Max severity: minor
Ship allowed: yes
