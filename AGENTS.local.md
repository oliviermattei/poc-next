# killer-boilerplate — settings and conventions

**This file is yours. `install.sh` never overwrites it, and `/ks-setup` is its only creator.**
`AGENTS.md` belongs to the method and is rebuilt on every update — write nothing there.

Every value below is read by the pipeline commands. One setting per line, `Name: value`, nothing
else on the line: a command reads the value as everything after the colon, trimmed. Change any of
them at any time.

**After changing anything here, rerun `install.sh`** — it reassembles `AGENTS.md` from the method's
rules plus this file, and `AGENTS.md` is what an agent loads automatically. Settings are also read
straight from here, so those take effect immediately; the conventions at the bottom only reach an
agent through `AGENTS.md`, and stay stale until you reinstall.

## Pipeline settings

```
Merge mode:        pr
Target branch:     dev
Plan validation:   human
Ship confirmation: automatic
Story track:       auto
Flow threshold:    2
Design source:     internal
Design skill:      —
Design tool:       —
Test budget:       25
Verification mode: record
Full suite:        execute-end
E2E stage:         ship
E2E scope:         nominal
E2E browsers:      —
Build stage:       ship-if-route
Issue tracker:     github
Worktree root:     .worktrees/
```

| Setting | Accepted values |
| --- | --- |
| Merge mode | `local` (squash-merged locally, no review platform) · `pr` (a pull request against the target branch) |
| Plan validation | `human` (a checkpoint blocks until you validate) · `autonomous` (the agent validates its own plan) |
| Ship confirmation | `human` (asked before any merge) · `automatic` |
| Design source | `internal` (the agent draws, using `Design skill`) · `external` (a brief goes to `Design tool`) |
| Story track | `auto` (the story's complexity picks the lane) · `full` (always the six-phase pipeline) · `flow` (always `/ks-flow`) |
| Flow threshold | complexity at or below which `auto` picks `/ks-flow` |
| Test budget | tests per story — a plan wanting more says why |
| Verification mode | `record` (the implementer records what it ran; the reviewer checks the record instead of re-running) · `rerun` (the reviewer runs everything itself) |
| Full suite | when the whole unit suite runs: `execute-end` · `ship` · `both` |
| E2E stage | when the end-to-end suite runs: `execute-end` · `ship` · `ci` · `—` |
| E2E scope | how far the end-to-end suite goes; `nominal` is one happy path |
| E2E browsers | browsers for the story cycle, e.g. `chromium`; `—` means the project's own default. Ship always runs them all |
| Build stage | when the production build runs: `ship-if-route` (only when a route or manifest moved) · `ship` · `review` · `ci` · `—` |

## Project commands

```
Package manager:   pnpm
Test:              pnpm test
Typecheck:         pnpm typecheck
E2E:               pnpm test:e2e
Build:             pnpm build
```

A command left at `—` is one the agents cannot run: they say so rather than guess one.

## Project conventions

> Reportées fidèlement depuis les règles de projet de l'ancien `AGENTS.md` (état de `dev` à `3c82d89`, après s68), après la réinstallation de la méthode. La source d'autorité reste le code, `docs/architecture.md` et les ADR de `docs/decisions/`.

### Start here (agents)

You are in a **SaaS boilerplate** built by the killer-saas pipeline. Before touching anything, know these five things:

1. **Nothing is coded outside the pipeline.** A feature needs a validated plan in `docs/plans/<story-id>.md` before a line is written, and a passed review before it ships. The only exception is an explicitly announced Quick Fix.
2. **Read in this order**: `docs/prd.md` (what and why, plus the graveyard of what we deliberately do NOT build) → `docs/stories.md` (every story and its acceptance criteria — the file is the count, never a number written here) → `docs/architecture.md` (stack, layout, module contract) → `docs/decisions/` (one ADR per structural decision, each with the options rejected and why).
3. **The three baselines below are not optional** and are checked in review: security (`docs/security.md`), reliability (`docs/reliability.md`), agent-oriented repo. A breach ranks with a functional regression.
4. **A module is the unit of composition.** It declares one typed contract and lives in `packages/modules/<name>` with four layers. Never scaffold one by hand — generate it (`npx ks`, or the MCP server). Never add a feature outside a module.
5. **The graveyard is binding.** `eject`, an in-app AI module, non-Stripe payment providers, usage-based billing, realtime notifications, an audit-log table, customer API keys, multi-ORM — all deliberately excluded in `docs/prd.md`. Re-introducing one is a scope breach, not an improvement.

Where things are: `apps/web` (Next, mounts the API) · `config/` (what the project owner edits) · `packages/core` (module contract and registry) · `packages/db` · `packages/api` · `packages/ui` · `packages/ports` + `packages/adapters` (one implementation each) · `packages/modules/*` · `tooling/` · `docs/` · `Dockerfile` + `docker-compose.prod.yml` (production image and stack, s27 — the guide is `docs/deployment.md`).

When a rule and this file disagree with the code, the code is the bug — unless an ADR says otherwise. When you need a rule that does not exist, ask: *which command fails if someone breaks it?* If there is no answer, it is documentation, not a rule.



### Technical conventions

Full detail in `docs/architecture.md`; each structural decision has an ADR in `docs/decisions/`.

**Stack** — always the latest stable majors (ADR 010): Next 16, React 19, Tailwind v4 (CSS-first config, no `tailwind.config.js`), TypeScript 5.9+ strict, pnpm 10+, Node 20.10+. shadcn/ui on **Radix UI**, copied into `packages/ui` (ADR 022 — Base UI has never shipped a stable release), Turborepo + pnpm, PostgreSQL 16+ with Drizzle, Better Auth, **module routes dispatched by `dispatchModuleRequest` from `@repo/core`** — ADR 005 chose Hono with oRPC contracts and ADR 017 called `ModuleRoute` a transitional form, but **neither ever shipped**: measured on this tree, zero `@orpc/*` imports, zero `hono` imports, zero declared dependency on either. Write `ModuleRoute` + Zod, never oRPC, Vitest + Playwright, GitHub Actions.

**Repo layout** — `apps/web` (Next, mounts the module dispatcher at `app/api/[[...route]]`; its screens are grouped by zone in four route folders — `(site)`, `(auth)`, `(app)`, `(console)` — which never appear in a URL, ADR 071, each rendering its own template, s61; `/` always serves the public site and `/app` is the application's dashboard, the default destination after any sign-in (`DEFAULT_SIGNED_IN_PATH`); the site header renders the navigation surface `site` (home, blog, docs, pricing) plus one template button written by hand, ADR 073 — the only hand-written entry found so far in the site header; the brand links and the AppShell account menu are also hand-written links, and no command enforces the count; the superadmin back-office is the **console**, served under `/console`, its navigation surface is `console`, and it answers 404 to anyone who is not a superadmin, anonymous included, ADR 070; account, organization and billing live in the **settings zone** `/app/settings/*`, whose sub-navigation renders the surface `settings` — the application sidebar renders `app` only, the product's own pages, s62a; a moved screen's old path answers **308** through the single table `apps/web/lib/legacy-paths.ts`, read by `apps/web/proxy.ts` on the internal path, never `redirects()` in `next.config.ts`, ADR 075), `config/` (features, billing, gating, marketing — edited by the project owner), `packages/core` (module contract and registry), `packages/db`, `packages/api`, `packages/ui`, `packages/ports`, `packages/adapters`, `packages/modules/<module>`, `tooling/`.

**A module is a package** declaring one typed contract: `id`, `requires`, `schema`, `migrations`, `routes` (**each with its protection level**: public, authenticated, role-gated, entitlement-gated — reserved for a paid offer, ADR 043), `navigation` (same), `messages`, `emails` (with their locales), `webhooks`, `jobs` (scheduled tasks, id + cron schedule), `dataCategories`, `retention` (one policy per declared category), `purge`, `export`. Every key is mandatory from the first module, empty if need be — adding one later means reopening every module already written. **One key is optional, and that is a decision with an ADR**: `seeds` (s58, demonstration data, **ADR 069**), added the way `NavigationEntry.surface` was (ADR 066/067) — the registry derives it for the modules that declare it, and the fifteen that do not were not reopened. ADR 069 carries the criterion, not the precedent: a key is mandatory when omitting it leaves a defect with no owner (unpurged data, an unprotected route, uncrawled content); it may be optional when omitting it leaves only silence.

**Four layers inside each module**: `domain/` (pure business rules, no framework, no ORM, no SDK) → `application/` (use cases and ports) → `infrastructure/` (Drizzle repositories, adapter calls) and `presentation/` (`ModuleRoute` declarations, React components). `infrastructure` and `presentation` never import each other. **The boundary rule is enforced by lint in CI, not by review.**

**A module with components exposes them through a second entry point** — `@repo/module-<name>/presentation` (ADR 024). The main barrel carries the contract, `domain` and `application`, and **never re-exports a `.tsx`**: `config/features.ts` is read by `pnpm db:generate`, `pnpm ks` and the `@repo/db` typecheck, none of which compile JSX. Break it and `pnpm typecheck` fails with `error TS6142 … '--jsx' is not set` — on `@repo/db`, not on the module.

**A disabled module leaves no trace**: no route (404), no navigation entry, no migration applied on a fresh database. A module enabled then disabled keeps its tables and data — deleting them would be `eject`, which is in the PRD graveyard. No cleanup command exists; never introduce one.

**A port never throws** — it returns a discriminated result (`{ok:true,…} | {ok:false,error}`), so the compiler forces the caller to handle failure instead of defaulting to a 500. Shape set in s06, binding for storage, payments, jobs, analytics and monitoring. Test doubles replace the **network**, never the SDK.

**One implementation per port.** Mail Resend, storage S3/R2, payments Stripe, rate limiting PostgreSQL (s28, ADR 050 — the fourth port; its store is the app's own database, so an unavailable store **refuses** instead of degrading, and it has no keyless local mode because it has no key), jobs Inngest (s33, ADR 059 — the fifth port, and the only one whose surface is **split in two**: the port carries emission, the module contract's `jobs` key carries declaration, and `dispatchModuleJob` in `@repo/core` joins them. Its `ok:true` means "queued", never "done". The execution rule lives in the **core**, not in the optional `jobs` module, because it must answer when that module is cut — that is what makes the synchronous fallback possible), analytics PostHog and errors Sentry (s39, the **sixth and seventh** ports, shipped together and **both degrading**: `docs/reliability.md` §2, "no analytics → the app runs". With them the general rule is a majority among ports again, and `rate-limit` remains its only exception. "No key" is a **value** there — `not_configured` — never a silent `ok: true`, and the criterion is measured on **outbound calls**: with no key, none is emitted. Sensitive-field redaction lives **inside each adapter**, at the last point before the network, because a rule placed higher up is bypassable by whoever holds the adapter. The browser half is **not** the provider's loader: it is a script served by the module's own public route, carrying `posthog.init(key, …)` — the s39 review measured a declared loader that initialised nothing, hence measured nothing). Test doubles are tools, not providers: they never justify a second adapter. Every port must be usable locally with no provider key — through an **explicit** local mode, never inferred from `NODE_ENV`. Explicit means the developer opts in (e.g. `EMAIL_LOCAL_CAPTURE=1`) and a process with neither a key nor the flag refuses to start, naming the variable. A port that silently falls back to a local stand-in cannot tell a real send from a captured one, in production included.

**Naming** — files `kebab-case`, types and components `PascalCase`, functions and variables `camelCase`, tables and columns `snake_case`.

**Deployment** — `docs/deployment.md`. Two facts bind the rest of the repo: the app has **two startup points** — `next.config.ts` and `apps/web/instrumentation.ts` — both calling the single guard `apps/web/lib/startup.ts`, because `output: 'standalone'` serialises the Next config into `server.js` and stops executing `next.config.ts` at server start; and **the runtime stage never inherits the build stage's permissiveness** — the validation escape hatch (`NEXT_PHASE`, `SKIP_ENV_VALIDATION`) is carried by the build command, never by an `ENV` of a stage, or the image boots in production without checking its configuration. Migrations run in their own container before traffic switches; a failed one keeps the app from starting.

**Rules that bite** — every `<form>` declares `method` as a written literal (a React form without it falls back to a browser GET before hydration and puts secrets in the URL — measured in s08); Zod at every boundary (env, routes, webhooks, config); no direct `process.env` outside the config module; `drizzle-kit generate` only, never `push` in production; migrations backward-compatible with the version still online; a foreign key toward another module only if that module is a declared `requires` (ADR 018); 404 rather than 403 on another organization's resource; identical error message for unknown account and wrong password; permissions checked server-side.

**Third-party integrations, two regimes, never mixed** — in CI: recording doubles for outbound calls, replay of recorded webhook events for inbound ones, both blocking. Outside CI, on an explicit command: real test keys, run before every ship.

**Commits** — one commit per story, imperative message in French, carrying that story's research, design and plan.

### Commands

Le harnais de qualité (s02). Chacune de ces commandes échoue pour une raison
précise — une règle qu'aucune commande ne vérifie est de la documentation, pas
une règle. **Ce que la CI joue se lit dans `.github/workflows/ci.yml`, jamais
dans ce tableau** : une liste recopiée ici vieillirait à côté du workflow, et
elle a déjà vieilli une fois — la phrase promettait « chacune est exécutée par
la CI » alors que sept ne l'étaient pas. Quand l'absence d'une commande de la CI
est un **choix** plutôt qu'une évidence, sa ligne le dit et donne sa raison.

| Commande | Ce qu'elle vérifie | Ce qui la fait échouer |
|---|---|---|
| `pnpm dev` | l'application démarre | une variable d'environnement absente ou malformée, nommée |
| `pnpm build` | l'application compile | une erreur de compilation ; le build n'a pas besoin des variables d'exécution |
| `pnpm typecheck` | racine, `tests/` **et** chaque package | une erreur de type, y compris dans un test |
| `pnpm lint` | règles ESLint, frontières de couches (ADR 006), surface client de `@repo/config` | un import qui traverse une couche interdite, une règle de style |
| `pnpm lint:fix` | idem, en réparant ce qui est réparable | rien : c'est la commande de correction |
| `pnpm test` | tests unitaires et de câblage (Vitest) | une régression de comportement |
| `pnpm test:e2e` | parcours navigateur (Playwright) | l'application ne démarre pas, ou ne sert pas la page. **Troisième mode depuis s28** : la suite tire toutes ses requêtes d'une seule adresse et consommait 41 des 120 inscriptions horaires par appelant, si bien que le **troisième** passage d'une même heure échouait contre une base persistante — sur un locator qui expire, sans jamais nommer la limitation. Le préambule (`e2e/support/warm-up.ts`) vide donc `rate_limit_window` avant les parcours ; `e2e/rate-limiting.spec.ts` remplit et mesure ses propres seaux, il ne dépend pas de cet état |
| `pnpm test:golden-path` | le parcours **clone → premier paiement** (s25) : clone local, `.env` depuis l'exemple, `pnpm install`, migration et seed sur une **base créée pour l'exécution**, puis inscription → vérification → **parcours d'intégration** → organisation → souscription → **dernière étape du parcours** → fonctionnalité réservée, plus les variantes achat unique et paiement invité. **Les deux étapes d'intégration ne sont jouées que si le module `onboarding` est activé** (s40) : le fondateur traverse alors le parcours pour de vrai — le refermer par une écriture ferait mesurer au premier critère du PRD un chemin que plus personne n'emprunte —, et module coupé chaque étape va droit à son écran, l'atterrissage étant dérivé et non écrit en dur. Les deux variantes de paiement, dont le sujet est la forme du paiement, ne traversent dans aucun des deux cas. Elle journalise trois durées, **lequel des deux régimes d'intégration elle a mesuré** — parcours traversé ou module coupé — **et ce que la mesure exclut**. **Le clone reproduit l'arbre de travail comparé à `HEAD`** (s68, `scripts/working-tree.ts`, commun aux trois recettes) — renommages, suppressions et modifications **indexés** compris, non suivis recopiés, ignorés jamais —, et **le port des parcours** est celui d'`E2E_PORT`, sinon un port libre que la recette réserve ; il est **imprimé** dans sa sortie, et un `E2E_PORT` illisible est refusé en le nommant | un régime de paiement non choisi (`GOLDEN_PATH_PAYMENTS` est obligatoire : `recorded \| simulated \| live`), un **enregistrement d'événement manquant** sous `recorded` — nommé, jamais remplacé par le simulateur (ADR 048) —, `simulated` demandé en CI, `live` sans `STRIPE_SECRET_KEY` et `STRIPE_LIVE_PRICE_ID`, une étape qui dépasse son budget, nommée, ou des **événements traités qui ne portent pas la marque du régime demandé** — le serveur aurait alors joué une autre source que celle annoncée. **Elle ne rougit jamais sur les 30 minutes du PRD** : le harnais mesure, le seuil est une recette humaine. Elle n'est pas dans `pnpm test:e2e` — chaque story paierait l'amorçage complet. **Le régime `recorded` n'a jamais tourné sur des formes Stripe réelles** : `tests/fixtures/stripe-events/` ne porte aucun enregistrement (son README y vit seul), le job de CI ne s'arme qu'à la première capture versionnée — un job sonde y cherche un fichier, le parcours dépend de sa réponse —, et une CI verte ne prouve donc rien de la fidélité au fournisseur |
| `pnpm test:minimal-profile` | la **promesse de modularité** (s26), symétrique du parcours doré : un clone où le profil de `config/profiles.ts` coupe des modules, une **base créée pour l'exécution**, puis six vérifications — aucune route d'un module coupé ne répond (404), aucune entrée de navigation orpheline n'est rendue, aucune table d'un module coupé n'existe dans le **schéma réel** (`information_schema`, jamais les fichiers de migration), la suite complète passe **avec ses comptes journalisés** (exécutés et sautés), et l'inscription puis la connexion fonctionnent de bout en bout. **Rien n'y nomme un module** : tout est dérivé du contrat des modules non activés, donc couper un module de plus est une ligne dans `config/profiles.ts` et rien d'autre. **Le clone reproduit l'arbre de travail comparé à `HEAD`** (s68, `scripts/working-tree.ts`, commun aux trois recettes) — renommages, suppressions et modifications **indexés** compris, non suivis recopiés, ignorés jamais —, et **le port des parcours** est celui d'`E2E_PORT`, sinon un port libre que la recette réserve ; il est **imprimé** dans sa sortie, et un `E2E_PORT` illisible est refusé en le nommant | un module inconnu ou du socle dans le profil, un **balayage vide** — des modules coupés qui ne déclarent ni route, ni entrée, ni table rendraient les vérifications vertes sans rien vérifier —, une table d'un module coupé présente, une table d'un module **activé** absente (la base n'a pas migré, l'absence des autres ne prouve alors rien), un cas en échec, un effondrement du nombre de cas exécutés ou une part de cas sautés au-delà de 5 %, et **l'arbre de travail modifié** : la recette travaille dans une copie, elle ne bascule jamais le dépôt |
| `pnpm test:socle` | la **seconde branche de la matrice de CI** (s48) : la configuration où tout ce qui est optionnel est coupé, rejouée dans une **copie** du dépôt — clone, `.env` dérivé de `.env.example`, base créée pour l'exécution, puis les bascules du CLI et les étapes du job. **Deux listes sont dérivées de `.github/workflows/ci.yml`**, aucune n'est recopiée : les modules coupés — `config/profiles.ts` en coupe un autre ensemble — **l'écart se lit dans la sortie des deux recettes, jamais ici** : un nombre écrit à côté du code vieillit, et celui-ci a vieilli deux fois (« deux modules » écrit en s48, quatre mesurés en s32), et une commande locale qui jouerait autre chose que la CI serait un vert qui ne dit rien — et **les étapes `run:` du job gardé**, dont chacune est soit rejouée, soit **exclue avec sa raison écrite** ; la commande **journalise ce qu'elle a exclu et pourquoi**, à côté de ses durées. **Ce qu'elle ne rejoue pas se lit dans sa sortie, jamais ici** : une liste recopiée dans ce tableau vieillirait à côté du code, ce qui est exactement le défaut relevé en revue de s48 — la ligne promettait alors « les commandes du job » en n'en rejouant qu'une partie, parcours navigateur et audit exclus sans que rien ne le dise. Et ce qu'elle ne prouve pas, quoi qu'il arrive : elle tourne sur le poste, pas sur un runner Ubuntu, et elle ne provisionne pas le navigateur des parcours. **Le clone reproduit l'arbre de travail comparé à `HEAD`** (s68, `scripts/working-tree.ts`, commun aux trois recettes) — renommages, suppressions et modifications **indexés** compris, non suivis recopiés, ignorés jamais —, et **le port des parcours** est celui d'`E2E_PORT`, sinon un port libre que la recette réserve ; il est **imprimé** dans sa sortie, et un `E2E_PORT` illisible est refusé en le nommant. Les deux étapes qui photographient l'arbre écrivent sous `$RUNNER_TEMP`, que GitHub définit par job et que la commande fournit **par exécution**, un dossier de son répertoire de travail. Ce que deux exécutions simultanées partagent encore : **le processeur** — mesuré en s68 sur un poste à 8 cœurs, trois essais de deux exécutions lancées ensemble ont tous deux échoué sur des **délais d'attente** — aux tests unitaires ou aux parcours selon l'essai, sur des cas différents d'une exécution à l'autre —, là où une exécution seule passe ; le relevé est dans `docs/plans/s68-recettes-paralleles.md` | une étape gardée par `matrix.modules == 'socle'` qui ne coupe aucun module, une bascule posée **hors** de cette étape (elle s'appliquerait aux deux branches et la dérivation la manquerait), un identifiant que l'annuaire ne connaît pas ou qui appartient au socle, un module resté activé dans la copie, **une étape `run:` du job que la répartition ne classe ni rejouée ni exclue** — le job qui gagne une étape force une décision au lieu d'hériter du silence —, une exclusion sans raison écrite, une décision qui ne correspond à aucune étape, **une étape rejouée qui écrit dans un chemin fixe de `/tmp`** (s68 : deux exécutions simultanées s'y écrasaient), l'une des étapes rejouées en échec, et **l'arbre de travail modifié** : elle travaille dans une copie, elle ne bascule jamais le dépôt |
| `pnpm test:contrast` | le **contraste des jetons livrés** (s49, élargie par s57), mesuré sur les fichiers livrés : chaque chaîne de classes des composants de `packages/ui/src/components` qui peint **au repos** un fond et un texte, dans les deux thèmes, plus l'**anneau de focus** contre les surfaces sur lesquelles il tombe. **Deux espèces, donc deux seuils** — 4,5 : 1 pour du texte, 3 : 1 pour un indicateur non textuel (SC 1.4.11) : un seuil unique serait trop sévère pour l'anneau, ou trop laxiste pour le texte si on le baissait. **Tout y est dérivé** : les fichiers viennent du dossier, les paires de leurs classes, les valeurs de `packages/ui/src/styles.css`, les surfaces des fonds **opaques peints hors d'une variante** — un `bg-primary` de `Button` est un remplissage, pas une surface —, et les composants qui portent l'anneau de leur propre classe — **la commande imprime lesquels, et combien** ; le nombre n'est pas écrit ici, un nombre écrit à côté du code qui le dérive a déjà vieilli deux fois dans ce tableau. Ce n'est d'ailleurs pas un total : d'autres fichiers portent `focus-visible:ring-ring` **hors** du dossier balayé — écrans de `apps/web`, `packages/ui/src/composed`, modules —, que `grep -rl focus-visible:ring-ring --include='*.tsx' apps packages` compte et que la mesure ne voit pas. Une table recopiée resterait verte après un changement de jeton. **Ce qu'elle ne mesure pas, elle l'imprime elle-même**, en partie dérivé de ce qu'elle a rencontré et écarté (textes qui héritent de leur surface, couleurs d'état, bordures, rendu réel) : le recopier ici le ferait vieillir à côté du code, et c'est le reproche que le dépôt s'est déjà fait deux fois. Ce que seul un rendu confirme reste dehors : `e2e/alert-contrast.spec.ts` et `e2e/focus-contrast.spec.ts` mesurent la surface **peinte**, pas la surface déclarée | une paire sous **son** seuil — l'échec **nomme la source, la variante, le mode, le rapport et le seuil** —, une couleur illisible, un jeton absent de la feuille de style, une chaîne qui déclare deux fonds au repos (le contrôle refuse plutôt que d'en choisir un), une **source teintée qui peint aussi du texte et dont aucune surface n'est déclarée** — le jour où un second composant teinté arrive, la décision est forcée au lieu d'hériter du `--card` d'hier ; **le refus ne porte que là où une paire existe**, un fond teinté sans texte au repos (un voile) n'a pas de surface à connaître et est **nommé** dans la sortie plutôt que refusé —, aucun composant portant `focus-visible:ring-ring`, et l'un des **planchers** anti-balayage-vide franchi, chacun sur sa propre dérivation : trop peu de fichiers lus dans le dossier, de paires teintées par mode, de fichiers porteurs d'une paire (la commande d'avant s57 n'en mesurait qu'un), ou de surfaces dérivées — leurs valeurs se lisent dans `scripts/contrast-rules.ts` |
| `pnpm test:sans-env` | la suite unitaire rejouée **avec l'environnement du job de CI, et rien d'autre** (s55) : le `.env` de la racine est retiré des lectures du processus — désarmer les variables du shell ne reproduirait rien, `loadRootEnv()` relisant le fichier sur le disque (P25bis) —, et les variables fournies sont **dérivées du bloc `env:` du job qui joue `pnpm test`**, jamais recopiées. Elle attrape ce qui a rougi en intégration trois stories de suite : un fichier de test qui lit `AUTH_SECRET` et `APP_URL` sans les déclarer, vert sur un poste dont le `.env` complète le reste. **La CI ne la joue pas, et c'est écrit ici parce que c'est un choix** : la CI *est* ce régime — son job ne pose aucun `.env` —, donc l'y ajouter rejouerait la suite entière pour mesurer ce que l'étape d'à côté mesure déjà. Ce qu'elle **ne** mesure **pas** : un sous-processus lancé par un cas (`pnpm ks`, ESLint, `drizzle-kit`) relit le `.env` du disque avec son propre `node:fs` ; et elle tourne sur ce poste, pas sur un runner Ubuntu | un fichier de test qui lit une variable qu'il ne déclare pas — l'échec **nomme le fichier et les variables** —, un workflow dont aucun job ou plusieurs jouent `pnpm test`, un job qui la joue **sans déclarer aucune variable** (reproduire l'absence *totale* ferait rougir des fichiers corrects, et une porte qui rougit à tort finit désarmée), un **balayage vide** — aucun fichier de test trouvé —, et un rapport de suite illisible |
| `pnpm clean` | vide les artefacts régénérables : cache Turbo, `.next`, `dist`, rapports de test | rien : c'est la commande de nettoyage. Turbo ne purge jamais son cache tout seul — laissé libre il atteint plusieurs dizaines de Go et sature le disque, ce qui fait échouer *toutes* les autres commandes |
| `pnpm run audit` | vulnérabilités au seuil « élevé », exceptions datées de `.audit-exceptions.json`. Elle **reprend sur la panne et jamais sur un avis** (s48) : trois tentatives, recul exponentiel avec dispersion et plafond, sur la seule branche « l'audit n'a pas eu lieu » — un `ERR_SOCKET_TIMEOUT` du registre la faisait rougir du premier coup, et une porte qui rougit pour une panne réseau finit par s'ignorer. Un document d'avis lu correctement sort au premier essai, qu'il bloque ou non. L'appel porte un **délai d'attente explicite** (`AUDIT_TIMEOUT_MS`, 60 s pour un audit nominal mesuré à ~1,4 s) : un registre qui accepte la connexion sans répondre est coupé et compté comme une panne, au lieu de tenir le job ~4 minutes | une vulnérabilité non exceptée, ou une exception sans date d'expiration ; une panne de registre qui dure — l'échec **nomme alors le nombre de tentatives**, et ne se confond jamais avec « aucune vulnérabilité ». Une valeur illisible de `AUDIT_TIMEOUT_MS` est **refusée en la nommant**, jamais lue comme « aucun délai ». **`pnpm run`** est obligatoire : `pnpm audit` seul appelle la commande interne de pnpm, qui ignore les exceptions |
| `pnpm sourcemaps:release` | les **cartes source** du build sont **envoyées** au fournisseur d'erreurs, sous le nom de version des événements, **puis** élaguées du dossier servi publiquement (s39). L'ordre est imposé : élaguer d'abord enverrait un ensemble amputé. Le dossier lu est celui du dépôt, ou celui que `SOURCEMAPS_NEXT_DIR` désigne : **l'image rejoue son propre `pnpm build`** (`.dockerignore` exclut `.next`), si bien qu'envoyer les cartes du poste publierait des empreintes de chunks qui ne sont pas celles qui sont servies — la recette d'extraction est dans `docs/deployment.md`, et `tests/analytics.test.ts` refuse qu'elle désigne une étape du `Dockerfile` ayant déjà élagué. Elle **refuse** sans `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` et `SENTRY_RELEASE`, en nommant ce qui manque — sauter l'envoi en silence livrerait des traces minifiées sans que rien ne le dise. Ce qu'elle ne prouve pas : qu'une trace soit effectivement lisible **chez** le fournisseur, ce qu'aucune commande locale ne peut voir | aucune carte trouvée (« un envoi qui n'envoie rien est un vert qui ne prouve rien »), un identifiant absent, un artefact refusé par le fournisseur. Un artefact **déjà présent** (409) n'est pas un échec : le rejeu ne produit aucun effet supplémentaire |
| `pnpm sourcemaps:prune` | la même règle, **sans envoi ni secret** : elle retire les cartes du dossier servi publiquement et laisse les cartes serveur, qui ne le sont jamais. C'est ce que le `Dockerfile` appelle après le build — un jeton passé à un build d'image resterait dans une couche —, si bien qu'une image ne peut pas embarquer le code source du produit, que quelqu'un ait pensé à l'envoi ou non | aucune carte trouvée : le build n'a pas eu lieu, ou `productionBrowserSourceMaps` est éteint |
| `pnpm db:generate` | génère les migrations SQL depuis le schéma | jamais `push` : la génération est la seule voie |
| `pnpm db:migrate` | applique les migrations, deux fois de suite sans effet supplémentaire | une migration en échec |
| `pnpm db:seed` | les **données de démonstration des modules activés** (s58, ADR 069), dérivées du registre par la clé facultative `seeds` du contrat : il n'y a nulle part un « si le module est activé », et `pnpm test:minimal-profile` joue la commande dans une copie où des modules sont coupés. Ce qu'aucune commande ne tient, et que la revue seule peut voir : qu'aucun nom de module ne soit **écrit** dans le chemin du seed — un `if` sur un identifiant de module coupé ne ferait rougir personne. Elle **rend le comptage** (lignes du schéma public avant et après), et l'idempotence se lit dans deux exécutions successives, jamais dans un commentaire | un seed non idempotent ; **aucun seed déclaré** par la configuration ; **un seed déclaré qui n'écrit aucune ligne** sur une base vide — nommé, et les lignes des autres seeds ne comptent pas pour lui : le plancher global de la première version de s58 s'en satisfaisait, si bien qu'un module qui déclare `seeds` et n'écrit rien sortait vert ; **il ne s'arme que sur une première exécution**, un rejeu n'écrivant rien par construction ; et une base **déjà en service**, le seed refusant dès qu'elle porte un compte qu'il n'a pas créé lui-même. La garde se dérive de ce **fait**, jamais de `NODE_ENV`, et tous les seeds tournent dans une seule transaction : un refus n'écrit rien **quel que soit l'ordre du graphe**, ce qu'un cas de `tests/seed.test.ts` mesure en faisant écrire un seed avant le refus |
| `pnpm billing:reconcile` | réconcilie l'état d'abonnement avec le fournisseur de paiement, et le rejeu ne réécrit rien (`docs/reliability.md` §5). Elle réconcilie **dans les deux sens selon le champ** (ADR 046) : le statut vient du fournisseur, la **quantité de sièges** va vers lui, le nombre de membres faisant foi | une lecture du fournisseur en échec — la commande **n'efface jamais** : un silence du tiers ne doit pas couper un client qui paie. Une lecture des **membres** en échec l'interrompt, plutôt que de baisser une quantité. Module `billing` coupé, elle le dit et sort |
| `pnpm ks` | le CLI de modules : `list` et `toggle` (aussi `npx ks`) | un module inconnu, un requis manquant, un dépendant encore activé, ou une régénération en échec — la configuration est alors restaurée |

Le scan de secrets n'a pas de script npm : il tourne en CI par l'action
officielle (le paquet npm `gitleaks` est un homonyme qui ne scanne rien), et en
local par `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest git /repo`.

Deux emplacements de test, et deux seulement : `tests/` à la racine pour ce qui
traverse les packages, `src/**/*.test.ts` dans un package pour ce qui lui
appartient. Les parcours Playwright vivent dans `e2e/`.

### Security baseline (non-negotiable)

Full reference: `docs/security.md` (ADR 012). It applies to **every** story, not to a security story. A breach of it is a **critical** review finding, ranked with a functional regression.

Every control there names the command that fails when it is violated. Do not add a control nobody can check, and do not weaken one to make something work:

- **CSP** `default-src 'self'`, no `unsafe-inline`, no `unsafe-eval` in production; nonce per request. Adding a source requires a written justification in the story.
- **Cookies** `HttpOnly`, `Secure`, `SameSite`; session id rotated on every privilege elevation; revocation enforced server-side.
- **Authorization** checked server-side; another organization's resource returns **404**, never 403; unknown account and wrong password are indistinguishable, in message and in timing.
- **Zod at every boundary** — env, route params, body, webhooks, config. Parameterized queries only.
- **Webhooks**: signature verified before any side effect, idempotent by event id.
- **Secrets** never in the repo, in a build artifact, in a log, in an error response or in telemetry. Env validated at startup, naming the faulty variable.
- **Supply chain**: lockfile committed, `--frozen-lockfile` in CI, vulnerability audit and secret scan blocking.
- **Rate limiting** on every public entry point **served by the module dispatcher**, shared across instances — applied by `dispatchModuleRequest`, **derived from the registry** (every `public` route, plus every route declaring a `rateLimit`), **fail-closed**, and neutralisable **by injection only**: no environment variable turns it off, and a zero threshold is refused at startup rather than read as "no limit". **What "every public entry point" means here**: every route *served by the module dispatcher*. Five Next route files sit outside it (`find apps/web/app/api -name route.ts`, minus the dispatcher itself) and are **not** limited: `/api/health` (a liveness probe a limiter could refuse would report an outage it caused itself), `/api/csp-report` (a browser-driven report sink), and three that answer 404 in production — `/api/i18n-probe`, `/api/consent-probe/[script]`, `/api/billing-local-checkout`. A test asserts that count, so a sixth forces the decision instead of inheriting silence. Anti-automation on public forms; the captcha is declared and guarded but **no provider ships**.

A story's plan names the sections of `docs/security.md` it touches. The review mutates the code and checks the test goes red — it does not take conformity on trust.

### Reliability baseline (non-negotiable)

Full reference: `docs/reliability.md` (ADR 014). Same standing as the security baseline; a breach is a **critical** review finding.

- **Anything triggered from outside is replayable with no extra effect** — webhooks (logged by event id), jobs, migrations, seed. "Idempotent" is proven by running it twice and observing one effect, never asserted in a comment.
- **A missing third party degrades, it does not break.** No analytics → the app runs. No jobs → purge and export run synchronously. Every port works locally with no API key.
- **Every outbound call has an explicit timeout.** Retries use exponential backoff with jitter and a cap; transient errors only — retrying a validation error is a defect.
- **Migrations are backward-compatible with the version still serving traffic**: add before reading, stop writing before dropping. Never destructive outside an explicit eject, which is in the graveyard.
- **The health probe checks the real dependency**, and any state that can diverge from an external system has a reconciliation command.

### Agent-oriented repo

This codebase is mostly edited by agents (ADR 013). An agent that cannot find the rule invents one, so rules live where the code is written and are backed by a command:

- **`AGENTS.md` per package**, on top of this root file: what the package may import, what it must never contain, where its tests live. A test checks every package has one.
- **Never claim exhaustiveness.** A measured list says *what was swept*, never *what exists*. This repo has been caught three times: a package `AGENTS.md` calling three known cases "the only ones", a review's own finding list missing a fourth position, a measurement table omitting a case that works. The next agent reads such a claim as verified and stops looking. Write "found so far, over these N cases", and name the cases.
- **A green mutation means the test is wrong, not that the code is right.** When you neutralise an invariant and nothing goes red, fix the test — it has happened repeatedly here, and each time the production code was fine while its net was narrower than its name. **The count is not written here on purpose**: it said five when it was seven, and seven when it was eight, in a file whose neighbouring bullet forbids exactly that. The dated occurrences are in the journal of `docs/killer-saas-feedback.md`.
- **A rule must be executable.** Layer boundaries → lint. Required modules → config validation. Environment wiring → test. Ask of any new rule: *which command fails if I break it?* If none, it is documentation, not a rule.
- **Generate, don't guess.** `npx ks` (s05) and the MCP server (s41) expose the same operations — list modules, toggle one, scaffold a compliant module. Producing a module skeleton by hand is a smell.
- **Docs ship with the code that changes them.** A story that alters a convention and leaves its rule stale is incomplete.

### Agent skills

Per-repo configuration for the mattpocock engineering skills. It tells them where
issues, labels and domain docs live — it does **not** create a second pipeline:
the Absolute rule above still holds, and a GitHub issue never replaces a story,
a plan or a review.

#### Issue tracker

GitHub Issues on `oliviermattei/poc-next`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

#### Triage labels

The five canonical roles, each label string equal to its name (`needs-triage`,
`needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

#### Domain docs

Single-context: one root `CONTEXT.md` (created lazily) and ADRs in
**`docs/decisions/`**, not `docs/adr/`. See `docs/agents/domain.md`.

