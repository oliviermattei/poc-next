# Review — Story s26-minimal-profile-check

> Fresh-context review. Each issue classified: critical / major / minor.
> Diff reviewed: `git diff dev...feature/s26-minimal-profile-check` (15 files, +2197 / −4, one commit `20b9394`).

## What I ran myself

| Commande | Résultat |
|---|---|
| `pnpm test` | **1838 passés, 8 sautés, 0 échec** (57 fichiers passés, 2 sautés) |
| `pnpm typecheck` | vert ; refait avec `turbo run typecheck --force` (24/24, 0 cache) pour ne pas juger sur un cache |
| `pnpm lint` | `ESLint: No issues found` |
| `STRIPE_SECRET_KEY= STRIPE_WEBHOOK_SECRET= pnpm test:e2e` | **86 passés, 8 sautés, 0 échec** ; aucune spec de `e2e/minimal-profile/` collectée |
| `pnpm test:minimal-profile` | **exit 0** — amorçage 16 s, suite 29 s, parcours 21 s |
| `docker run --rm rhysd/actionlint:latest` | **exit 0**, aucun diagnostic |

**Preuve que la suite a tourné contre une base** : même commande avec `DATABASE_URL` sur le port mort 5999 → **1505 passés, 339 sautés, 2 échecs**, contre 1838 / 8 / 0 avec le conteneur. L'écart de 333 cas établit que le vert est un vert de base joignable.

**Sortie mesurée de la recette** :

```
Profil « minimal » — ce qui a été balayé
  modules coupés   : 4 (billing, i18n, organizations, demo-disabled)
  modules activés  : 6 (auth, consent, marketing, mcp-server, storage, demo-enabled)
  routes attendues absentes      : 14
  entrées de navigation absentes : 4
  tables attendues absentes      : 12
  tables attendues présentes     : 11
Schéma réel de la base vierge : 11 table(s).
Suite complète sous le profil — comptes
  exécutés : 1835   sautés : 11   échecs : 0   collectés : 1846
4 passed (20.3s)   ← e2e/minimal-profile
```

`git status --porcelain` vide après la recette ; aucune base `profil_minimal_*` restante.

## Plan compliance

- [x] **The code does what the plan specifies, nothing more.** Les dix tâches sont livrées et retrouvées dans le diff.
- [x] **Un seul écart de localisation** : la dérivation vit dans `scripts/minimal-profile-rules.ts` et non dans `packages/core`. Le tableau du plan est annoncé « anticipé », `@repo/core` est un paquet livré qui n'a pas à porter du harnais, et la forme retenue est celle de `scripts/golden-path-regime.ts`. Justifié.

### Interdits d'exécution — chacun vérifié

| Interdit | Vérification | Verdict |
|---|---|---|
| Ne pas nommer de module dans le harnais | grep des dix identifiants sur les quatre fichiers de harnais → **3 occurrences, toutes en commentaire** ; sur `tests/minimal-profile.test.ts` → **1, en commentaire**. Les fixtures emploient `alpha`/`beta`/`gamma`. Seul `config/profiles.ts` nomme des modules, et c'est la configuration | **tenu** |
| Ne pas basculer le dépôt de travail | mutation D, plus `git status` vide après une exécution verte **et** après un échec provoqué | **tenu** |
| Ne pas réutiliser une base | `profil_minimal_${Date.now()}` puis `drop database … with (force)` en `finally` ; aucune base résiduelle après quatre exécutions | **tenu** |
| Un plancher, pas une égalité | 1835 exécutés contre 1803 mesurés par la recherche, recette verte — l'égalité aurait rougi | **tenu** |
| Pas de commande de nettoyage | aucun `drop table` ; le seul `drop` porte sur la base éphémère | **tenu** |
| Specs existantes et harnais de s25 intacts | aucun `.spec.ts` modifié ; les quatre fichiers de s25 intacts ; `playwright.config.ts` touché de façon strictement additive | **tenu** |
| Pas de `hashFiles` dans un `if:` de job | aucun `if:` de niveau job ; `actionlint` exit 0 | **tenu** |
| `config/features.ts` hors commit | absent de `git show --stat` | **tenu** |

## Anti-hallucination

- [x] **Aucun import, appel ou clé inventés.** Chacun ouvert : `MODULE_ROUTE_PREFIX`, `moduleRegistry`, `publicPath`/`urlOf`, `aSignedInAccount`, `humanDuration`, `writeEnabledModules`, `createDatabaseClient`/`listDatabaseTables`, `bootstrapEnvFile`, `freshDatabaseUrl` — signatures conformes. `ENV_KEYS` est bien dérivé de `envShape`.
- [x] **La lecture des tables n'est pas inventée** : `instanceof PgTable` + `getTableConfig(table).name`, la technique de `packages/db/src/references.ts`. Le nom **physique**, le seul qu'`information_schema` connaisse.
- [x] **La forme du rapport Vitest est réelle** — les quatre clés lues dans mes propres exécutions, relues sous Zod.
- [x] **Pas d'injection dans le SQL de maintenance** : le nom de base est un nombre.

## Rules compliance

- [x] **AGENTS.md** — la commande a sa ligne, et `tests/agents-md.test.ts:206` la dérive de `package.json`. Zod aux frontières. Aucun `process.env` hors configuration, sauf `MINIMAL_PROFILE_PORT`, même statut que `E2E_PORT`.
- [x] **ADR 041** — la recette n'écrit pas dans l'arbre du tout, et le **prouve** deux fois. `assertWorkingTreeUnchanged` compare la différence, non la propreté : une story en cours d'écriture peut lancer la recette.
- [x] **Cimetière du PRD** — aucune suppression de tables.

## Tests

- [x] Suite verte, prouvée adossée à une base.
- [x] **Aucune assertion décorative** dans les 521 lignes du test ni les 130 de la spec.
- [x] **Bite prouvée par neutralisation** — cinq mutations, chacune au site du défaut :

| # | Mutation | Site | Rouge |
|---|---|---|---|
| A | `cut`/`kept` dérivés d'un ensemble écrit en dur | `minimal-profile-rules.ts:229-231`, **dans `sweepProfile`** | **10** sur 1846, dont les deux du critère 8 |
| B | `if (swept > 0)` → `>= 0` | `:276`, `assertSweepIsNotEmpty` | **1** |
| C | migrate construit le registre depuis `availableModules` | `packages/db/src/scripts/migrate.ts:35`, **le vrai site du défaut** | **recette exit 1**, **12 tables** nommées |
| D | profil écrit dans `REPO_ROOT` au lieu du clone | `minimal-profile.ts:266` | **exit 1 en ~10 s**, nommant ` M config/features.ts` |
| E *(la mienne)* | `dispatchModuleRequest` rend 404 inconditionnellement | `packages/core/src/registry.ts:213` | **301** rouges, dont 134 survivant au profil |

  L'implémenteur annonçait 9 rouges sur A ; j'en mesure **10** avec ma forme. L'écart tient à la forme, pas au fond.
- [x] **`demo-disabled` est balayé sans que le profil le nomme** — vérifié deux fois, par dérivation hors test et par la recette elle-même.
- [x] **Les comptes sont des planchers** : 1835 contre 1803, recette verte.

## Regressions

- [x] `pnpm test:e2e` 86 verts, nouveau dossier non collecté.
- [x] `playwright.golden-path.config.ts` déclare son propre `testDir` : inatteint.
- [x] Le balayage des `if:` de s25 parcourt **tout** `ci.yml` — il couvre le nouveau job par construction. Vérifié en lisant `jobLevelConditions()`.
- [x] `config/profiles.ts` n'est importé par aucun fichier d'`apps/` ni de `packages/` : le profil ne peut pas atteindre l'application livrée.

## L'interaction du garde d'environnement avec `pnpm test:e2e` — hors périmètre

Le `.env` du worktree porte une clé Stripe réelle ; `webServerEnv()` pose `PAYMENTS_LOCAL_MODE=1` ; la règle croisée refuse les deux ensemble. **C'est le garde qui fait son travail**, il vient de s19, et le refuser serait la régression.

Point en faveur du diff : `pnpm test:minimal-profile` n'a eu besoin d'**aucun** contournement, parce que `cloneEnvironment` retire la clé de l'environnement du clone. La recette est immunisée contre la configuration de la machine là où `pnpm test:e2e` ne l'est pas.

## Findings

- **minor** — `.github/workflows/ci.yml` : `EMAIL_LOCAL_CAPTURE: '1'` posée au niveau du job **n'atteint aucun processus** — elle figure dans `ENV_KEYS`, donc `cloneEnvironment` la retire. Le drapeau qui fait fonctionner le critère 6 vient de `.env.example` et de `webServerEnv()`. Le commentaire affirme pourtant le contraire : configuration morte **plus** justification fausse.
- **minor** — `minimal-profile-rules.ts:567-587` : le retrait est dérivé d'`ENV_KEYS`, mais `@repo/config` lit aussi `BUILD_ENV_KEYS` — `NEXT_PHASE` et `SKIP_ENV_VALIDATION` — **qui désactivent la validation d'environnement**. Un poste exportant `SKIP_ENV_VALIDATION=1` verrait le clone démarrer sans valider, en silence. `appKeys: [...ENV_KEYS, ...BUILD_ENV_KEYS]` ferme le trou sans écrire une variable à la main.
- **minor** — `scripts/minimal-profile.ts` : la recette ne confronte jamais l'état réel du clone à la liste `nextEnabled` calculée. Un module qui ne déclare **rien** — `i18n` exactement — pourrait rester activé sans qu'aucune vérification ne bronche. Théorique aujourd'hui, mais rien ne le tient.
- **minor** — `e2e/minimal-profile/minimal-profile.spec.ts:81-98` : quatorze absences assenées **sans contrôle positif au même endroit**. Un montage entièrement mort rendrait 404 partout et le cas resterait vert. Atténué — ma mutation E rend 301 rouges — mais attrapé par une autre vérification que celle qui prétend le couvrir.
- **minor** — `minimal-profile-rules.ts:423` : `EXECUTED_FLOOR = 1_500` est présenté comme la garde contre l'effondrement. Or l'effondrement le plus probable — recette sans base — rend **1505** cas : c'est la part de sautés qui l'attrape, pas le plancher. Marge de cinq cas.
- **minor** — `minimal-profile-rules.ts:474` : le repère « 1 803 / 11 … 1 806 / 8 » est imprimé en dur. Mesuré aujourd'hui : 1835 / 11 et 1838 / 8 — déjà décalé de trente-deux cas, et rien ne le tiendra à jour.
- **minor, non imputable** — `tests/billing.test.ts:5607` : `expect(cancelled.sessions).toBe(0)` repose sur un delta de `count(*)` global sur `auth_session`, donc sur une course avec tout fichier parallèle. Préexistant (dernier commit `44fa757`, s24). Conséquence à connaître : la recette échoue dur sur `failed > 0`, donc ce flake peut rougir un job de CI de plus.

## Not verified

- **Le job de CI n'a jamais tourné sur un runner.** `actionlint` valide le fichier, mais rien n'atteste que le service PostgreSQL démarre, que `playwright install` suffit au clone, ni que l'artefact est téléversé. **Geste attendu** : pousser, ouvrir le job, puis provoquer un échec et vérifier que `traces-profil-minimal` est réellement téléversé et non vide — le constat F8 de s25 n'est fermé ici que par un test de chaîne.
- **Le temps de la recette en CI est inconnu** : 16 s d'amorçage ici avec cache chaud, navigateur installé et PostgreSQL démarré. Sur un runner froid, l'installation domine.
- **Une seule configuration de profil éprouvée.** La généricité est prouvée par dérivation et par mutation, mais **aucune exécution réelle avec un quatrième module coupé**. **Geste attendu** : ajouter `storage` ou `consent` à `config/profiles.ts`, lancer la recette, vérifier qu'elle reste verte sans qu'une ligne de harnais bouge. C'est une commande, et c'est la seule preuve manquante de la promesse centrale.
- **Aucun tiers réel appelé** — le profil coupe `billing`, le reste tourne en local.
- **`pnpm build`, `pnpm run audit` et le scan de secrets non exécutés.** Le diff n'ajoute aucune dépendance et `config/profiles.ts` n'est importé par aucun code d'application.

## Verdict

Le cœur de la story tient. La généricité n'est pas affirmée, elle est prouvée : aucun identifiant de module dans le harnais hors commentaire, `demo-disabled` balayé sans que le profil le nomme, et une mutation au site même de la dérivation rend dix cas rouges dont les deux du critère 8. Les trois autres mutations du plan sont reproduites à l'identique, la recette laisse le dépôt propre y compris après un échec provoqué, et le critère 5 lit bien `information_schema`.

Les six constats sont mineurs et aucun ne rend le harnais faux. Ils se corrigent au cycle suivant, chacun en quelques lignes.

## Reprise après revue (même branche, commit amendé `a6167e1`)

Les **six mineurs** ont été refermés, bien que le portail autorisât déjà le ship.
Deux appartenaient aux classes que ce dépôt paie le plus cher.

| Constat | Ce qui a été fait | Morsure |
|---|---|---|
| Justification fausse en CI | `EMAIL_LOCAL_CAPTURE` retirée du job — elle n'atteignait aucun processus — et le commentaire remplacé par un qui dit vrai : aucune variable d'application n'a sa place là, `cloneEnvironment` retirant tout ce que le schéma déclare. | — |
| **Vert silencieux** | `CLONE_STRIPPED_ENV_KEYS = [...ENV_KEYS, ...BUILD_ENV_KEYS, ...LIVE_RECIPE_ENV_KEYS]`. `SKIP_ENV_VALIDATION` exporté par un poste ne peut plus faire démarrer le clone sans valider son environnement. | **1 rouge** au retour à `ENV_KEYS` seul, **1** au point de composition |
| Ancrage manquant | `assertProfileWasApplied` relit le `config/features.ts` du clone et le confronte à la liste calculée. Un module ne déclarant rien — `i18n` — ne peut plus rester activé en silence. | **2 rouges** |
| Absence sans contrôle positif | Chaque route GET du registre monté est appelée, au moins une doit répondre autre chose que 404. Mesuré : **14 routes de module activé répondent**. | voir ci-dessous |
| Plancher trompeur | Le commentaire dit désormais ce qui attrape réellement le cas sans base — la part de sautés, pas le plancher — et un cas épingle exactement cette répartition. | **2 rouges** |
| Repère périmé | Les chiffres en dur ont disparu ; la phrase garde sa forme et imprime les seuils dérivés des constantes. | — |

L'implémenteur signale honnêtement la nuance du contrôle positif : sa mutation du
point de montage laisse la suite de nœud **verte dans la configuration livrée**,
et c'est le contrôle positif neuf qui rougit. Le point aveugle que le constat
nommait est donc réel, et refermé à l'endroit exact où il vivait.

### Contre-vérification indépendante (contexte principal)

`actionlint` **0 erreur**. `pnpm typecheck` vert, `pnpm lint` sans anomalie,
`pnpm test` **1844 passés / 8 sautés**. `pnpm test:minimal-profile` **exit 0** —
4 modules coupés, 19 vérifications de routes, 12 tables absentes et 11 présentes,
1841 cas exécutés — et `git status` propre après exécution.

### La preuve manquante a été faite, et elle a trouvé quelque chose

La revue signalait que la généricité n'avait **jamais été exercée de bout en
bout** avec un module de plus. Fait : `storage` ajouté au profil, recette
relancée.

**Le harnais s'est adapté sans qu'une ligne bouge** — 5 modules coupés au lieu de
4, **19 routes** balayées au lieu de 14, **13 tables** absentes au lieu de 12,
10 présentes au lieu de 11. Le critère 8 est tenu pour ce qu'il nomme.

**Mais la recette échoue**, et pas pour une raison de harnais :

```
FAIL tests/env-wiring.test.ts > refuse de démarrer quand le module `storage`
     est activé sans stockage, en nommant les variables
AssertionError: expected [Function] to throw an error
```

Ce test **suppose `storage` activé** : il vérifie qu'un module de stockage sans
configuration refuse de démarrer. Coupez le module, il n'y a plus rien à refuser,
et l'assertion tombe.

La promesse du critère 8 tient donc pour le **harnais**, et pas pour la
**suite** : au moins un test existant est couplé à l'activation d'un module. Ce
n'est ni un défaut de cette story — le profil livré coupe trois modules et la
recette est verte — ni un défaut du test, qui vérifie une vraie règle de s18. Ce
sont deux vérités qui ne peuvent pas être simultanément exercées, et rien ne le
disait avant cette mesure.

**Suite à donner, hors périmètre** : ce cas doit se sauter quand `storage` est
coupé, comme les cas adossés à la base se sautent sans base. Tant que ce n'est
pas fait, ajouter un module au profil demande de traiter les tests que ce module
rend inapplicables — ce qui est une charge réelle, à connaître avant de promettre
que le profil s'étend gratuitement.

Le profil a été restauré, `git diff --exit-code` propre.

Max severity: minor
Ship allowed: yes
