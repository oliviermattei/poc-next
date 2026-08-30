# Review — Story s01-boot-blank-app

> Revue anti-hallucination en contexte neuf du diff `45a204d..HEAD` (46 fichiers, 3 634 insertions), commit d'implémentation `f73f0d9`, sur `dev` (règle worktree levée par le propriétaire). Contrat lu : `docs/plans/s01-boot-blank-app.md`, `docs/research/s01-boot-blank-app.md`, `docs/stories.md:47-54`, `AGENTS.md`, `docs/architecture.md`, `docs/decisions/001-010`.

## 1. Suite de tests — exécutée, pas rapportée

```
$ pnpm test
 RUN  v4.1.11 /Users/olivier/www/boilerplate
 Test Files  4 passed (4)
      Tests  12 passed | 3 skipped (15)
   Duration  554ms
```

Les 3 skips sont ceux attendus : `describe.skipIf(!databaseReachable)` dans `tests/health.test.ts` (1) et `tests/migrations.test.ts` (2). Aucun faux vert : `tests/fixtures/database.ts` ouvre réellement un pool et exécute `select 1` avant de décider, il ne consulte pas seulement la présence de la variable. **Le skip est honnête, c'est exactement ce que le plan demandait.**

Vérifications supplémentaires exécutées :

| Commande | Résultat |
|---|---|
| `pnpm exec tsc --noEmit` (racine, `packages/config`, `packages/db`, `apps/web`) | 4/4 sans diagnostic |
| `pnpm --filter @repo/web run build` | ✓ compilé, 3 pages, `/api/health` marquée `ƒ (Dynamic)`, **sans `DATABASE_URL`** |
| `pnpm db:generate` | `0 tables` → `No schema changes, nothing to migrate`, aucun fichier créé |
| `pnpm db:migrate` (sans base) | échoue en nommant `DATABASE_URL`, résolution des imports OK |
| `pnpm install --frozen-lockfile` | `Lockfile is up to date` |
| `tsc --noEmit` dans `apps/web` avec `.next/` supprimé | aucun diagnostic (`skipLibCheck` couvre `next-env.d.ts`) |

## 2. Vérification des API réellement installées

Le piège n°3 de la recherche (`drizzle.config.ts` écrit de mémoire) était le risque d'hallucination le plus probable. Il a été évité, et je l'ai vérifié dans le paquet installé, pas dans la documentation :

| Élément du diff | Vérification | Verdict |
|---|---|---|
| `defineConfig({ dialect: 'postgresql', schema, out, casing: 'snake_case' })` | `drizzle-kit@0.31.10/index.d.mts:112-145` — `Config` a bien `dialect`, `out?`, `schema?`, `casing?: 'camelCase' \| 'snake_case'`, et la branche `{}` de l'union rend `dbCredentials` facultatif pour `generate` | ✓ forme actuelle, aucune trace de `driver: 'pg'` |
| `import { migrate } from 'drizzle-orm/node-postgres/migrator'` | fichier présent ; `migrate<TSchema>(db, config: MigrationConfig)` | ✓ |
| `migrationsTable` / `migrationsSchema` (déviation n°6) | `drizzle-orm/migrator.d.ts` : `MigrationConfig { migrationsFolder: string; migrationsTable?: string; migrationsSchema?: string }` | ✓ **API réelle, pas inventée** |
| `drizzle(pool, { schema, casing })` | `node-postgres/driver.d.ts` + `utils.d.ts:47-52` : `DrizzleConfig` expose `schema?`, `casing?: Casing` | ✓ |
| `NEXT_PHASE === 'phase-production-build'` | `next@16.3.3/dist/build/index.js:1212` pose `process.env.NEXT_PHASE = PHASE_PRODUCTION_BUILD` ; `constants.js:337` : `'phase-production-build'` | ✓ valeur exacte |
| `envSchema.shape`, `safeParse`, `error.issues` | zod 4.5.4 | ✓ |
| `describe.skipIf`, `vi.stubEnv`, `vi.resetModules` | vitest 4.1.11 | ✓ |

Aucune API inventée dans le diff.

## 3. Preuve de morsure des tests (mutations, restaurées)

| # | Fichier | Mutation | Rouges |
|---|---|---|---|
| A | `apps/web/app/api/health/route.ts` | `if (!status.connected)` → `if (false)` | **2** |
| B | `packages/config/src/env.ts` | `if (!result.success)` → `if (false)` + retour de `source` | **2** |
| C | `packages/db/src/schema.ts` | garde de collision `if (owner !== undefined)` → `if (false)` | **1** |
| D | `packages/db/src/migrate.ts` | `if (!existsSync(journal))` → `if (false)` | **1** |
| E | `.env.example` | `DATABASE_URL=` commenté | **1** |

Les cinq invariants centraux de la story mordent. Restauration prouvée : `git diff --exit-code` → 0 et `git status --porcelain` vide après chaque mutation et à la fin de la revue.

Deux tests ne mordent sur rien et survivent trivialement aux mutations correspondantes — ils ne sont pas décoratifs au sens du barème (ils gardent une invariante de sécurité), mais ils n'ajoutent pas de couverture : `tests/env-example.test.ts` « ne contient aucune valeur secrète » (heuristique par regex) et `tests/health.test.ts` « répond 503 sans divulguer la chaîne de connexion » (le corps est un JSON à deux clés constantes).

---

## Findings

### CRITICAL — F1. `pnpm dev` ne transmet jamais `DATABASE_URL` à l'application : `/api/health` ne peut structurellement pas renvoyer 200

Le critère 7 (« `/api/health` répond 200 avec l'état de la connexion ») et la prémisse même du critère 1 (« une application qui démarre, **connectée à Postgres** ») sont inatteignables par le parcours documenté. Deux causes se cumulent, chacune vérifiée séparément et empiriquement, **sans base de données** :

**Cause 1 — Next lit `.env` dans `apps/web/`, pas à la racine du dépôt.**
`.env.example` vit à la racine et dit en tête « Copiez ce fichier en `.env` ». `packages/db/src/scripts/{migrate,seed}.ts` chargent explicitement ce `.env` racine via dotenv, donc `pnpm db:migrate` fonctionne. `apps/web`, lui, ne le voit pas.

```
# .env à la racine, pnpm exec next dev dans apps/web
Health check: database unreachable — Invalid environment variables:
  - DATABASE_URL: Invalid input: expected string, received undefined

# le même fichier déplacé dans apps/web/.env
- Environments: .env
Health check: database unreachable — Failed query: select 1
params:  — connect ECONNREFUSED 127.0.0.1:1        ← la variable est enfin lue
```

**Cause 2 — `turbo.json` ne déclare pas `DATABASE_URL` sur la tâche `dev`, et Turborepo 2 filtre en mode strict.**
La tâche `dev` de `turbo.json` n'a que `cache: false` et `persistent: true`, contrairement à `build`, `db:migrate` et `db:seed` qui déclarent `env: ["DATABASE_URL"]`. Conséquence mesurée : même le contournement par variable exportée échoue.

```
$ DATABASE_URL='postgres://probe:probe@127.0.0.1:1/probe' pnpm dev
@repo/web:dev: Health check: database unreachable — Invalid environment variables:
@repo/web:dev:   - DATABASE_URL: Invalid input: expected string, received undefined

$ cd apps/web && DATABASE_URL='postgres://probe:probe@127.0.0.1:1/probe' pnpm exec next dev
Health check: database unreachable — Failed query: select 1 — connect ECONNREFUSED 127.0.0.1:1
```

Le parcours réel d'un Dev qui suit le dépôt (`cp .env.example .env` → `docker compose up -d` → `pnpm db:migrate` → `pnpm dev` → `curl /api/health`) donne donc : migrations appliquées, puis **503 pour toujours**. L'absence de Docker sur cette machine ne masque rien ici : le défaut est en amont de la connexion, la variable n'atteint jamais le processus.

À noter, ce n'est pas un défaut de test mais un trou de dispositif : `tests/health.test.ts` importe directement la fonction `GET` depuis `apps/web/app/api/health/route.ts` avec `vi.stubEnv`, donc il ne traverse ni le runtime Next ni la résolution d'environnement de Next ou de Turbo. Aucun test de la story ne pouvait attraper F1.

Directions de correction (au choix, décision de l'auteur) : déclarer `env: ["DATABASE_URL"]` sur la tâche `dev` de `turbo.json` **et** faire lire le `.env` racine par `apps/web` (chargement explicite dans `next.config.ts`, ou lien/`.env` dédié à l'app avec `.env.example` correspondant). Le correctif n'est complet que si les deux causes sont traitées : chacune seule laisse le 503.

---

### MAJOR — F2. `composeSchema` est invisible pour `drizzle-kit generate` et efface le typage : le pari désigné par le plan tient à moitié

Le plan nomme lui-même ce point comme « celui sur lequel tout repose » et fixe le test : *« Si la fonction écrite ici ne sert pas telle quelle en s04, elle est du décor. »* Vérification faite dans le paquet installé, elle ne servira pas telle quelle.

1. **drizzle-kit ne descend pas dans un objet.** `drizzle-kit@0.31.10/bin.cjs`, `prepareFromExports` : `Object.values(exports).forEach(t => { if (is(t, PgTable)) tables.push(t) })`. Il n'inspecte que les exports de premier niveau et ne traverse aucun objet imbriqué. Or `packages/db/drizzle.config.ts` pointe `schema: './src/schema.ts'`, dont le seul agrégat de tables sera `export const appSchema = composeSchema(enabledModuleSchemas)` — un objet. En s04, les tables des modules composées par cette fonction seront **ignorées par `generate`**. Aujourd'hui la liste est vide, donc `0 tables` est correct et rien ne casse ; l'échec est différé, pas absent.
2. **Le typage est détruit à la composition.** `ModuleSchema.schema: Record<string, unknown>` et `composeSchema(...): Record<string, unknown>` donnent `AppSchema = Record<string, unknown>`, donc `NodePgDatabase<Record<string, unknown>>`. L'API relationnelle `db.query.<table>` sera inutilisable et non typée quel que soit le module ajouté. Une signature générique (`composeSchema<T extends readonly ModuleSchema[]>`) est ce qu'il faudrait pour que la fonction survive à s04.

Ce qui, en revanche, est bien s04-compatible et mérite d'être noté au crédit du diff : `runMigrations` accepte `migrationsFolder` + `migrationsTable` + `migrationsSchema`, ce qui permet exactement « n'appliquer que les migrations des modules activés », un dossier et un journal par module. La moitié « exécution » du pari tient ; c'est la moitié « composition » qui est du décor.

Non bloquant pour s01 (aucun module, aucune table), mais à rouvrir **avant** s04 sous peine de le découvrir table par table.

---

### MINOR

**F3 — Critère 5 littéralement non satisfait.** `pnpm db:seed` ne peuple rien : `seeders: readonly Seeder[] = []`. Le critère dit « peuple la base de développement avec un jeu de données minimal ». Le plan (frontmatter `validated: yes`) a assumé cette reformulation et la justifie — inventer une table de production aurait violé un interdit sanctionné trois fois par la revue des stories. Je l'enregistre donc comme décision de plan, pas comme dérive, mais le critère reste à repasser quand le premier module livre un seed.

**F4 — `turbo.json` déclare une tâche `test` qu'aucun package n'implémente.** Le script racine est `"test": "vitest run"`, il ne passe pas par Turbo. Configuration morte (déviation n°9, confirmée).

**F5 — Le journal vide committé rend une garde inatteignable.** `packages/db/drizzle/meta/_journal.json` est committé avec `"entries":[]`, donc `existsSync(journal)` est toujours vrai sur le chemin réel : le retour `{ applied: false }` et le message « Aucune migration à appliquer : aucun module ne déclare de schéma. » ne peuvent jamais se produire en usage normal. La branche n'est atteinte que par le test à dossier inexistant. Code et message trompeurs.

**F6 — Deux variables lues par le module de configuration échappent au test d'alignement.** `SKIP_ENV_VALIDATION` et `NEXT_PHASE` sont lues par `isBuildPhase` mais absentes du schéma Zod, donc de `ENV_KEYS`, donc de `.env.example`, alors que `docs/architecture.md` pose « `.env.example` est exhaustif et vérifié par un test ». `SKIP_ENV_VALIDATION=1` désactive toute validation à l'exécution et fait retourner `process.env` brut casté en `Env` : `new Pool({ connectionString: undefined })` se rabat alors silencieusement sur les défauts libpq au lieu d'échouer. Trappe volontaire et courante, mais non documentée et non testée.
Le sens unique du test (déviation n°10) n'est en revanche **pas** un défaut : le critère 3 demande littéralement « un test échoue si une variable du schéma en est absente », et les 4 clés `POSTGRES_*` sont explicitement commentées comme lues par Docker Compose seul.

**F7 — Lecture directe de `process.env` hors du module de configuration.** `tests/fixtures/database.ts:9` : `process.env.DATABASE_URL ?? ''`. Règle transverse de `docs/architecture.md`. Périmètre test, donc mineur, mais c'est le premier précédent dans un dépôt dont la règle est un argument de vente.

**F8 — Le harnais de test contourne les frontières de packages.** `vitest.config.ts` alias `@repo/config` et `@repo/db` vers `./packages/*/src/index.ts`, et `tests/health.test.ts` importe `../apps/web/app/api/health/route`. L'ADR 002 pose que « un import non déclaré dans `package.json` échoue » : dans les tests, plus rien n'échoue. À arbitrer en s02 quand le harnais devient officiel.

**F9 — Un `pg.Pool` est construit même quand le bloc d'intégration est skippé.** `describe.skipIf(...)` évalue quand même le corps du describe, donc `createDatabaseClient({ connectionString: '' })` s'exécute et le `afterAll` qui devait le fermer est skippé. Sans effet observé (la suite se termine en 554 ms), mais le pool est orphelin.

**F10 — TypeScript épinglé `^5.9` alors que `npm view typescript version` renvoie `7.0.2`.** Conforme à la lettre de l'ADR 010 (« TypeScript 5.9+ ») mais en tension avec son principe (« dernières majeures stables », « démarrer une majeure en retard, c'est naître obsolète »). L'ADR étant immuable, l'écart demande un arbitrage explicite (ADR successeur ou montée), pas un `^5.9` silencieux.

**F11 — Un remote git `origin` existe, alors que le plan interdit « ne pas ajouter de remote git ».** `git remote -v` → `git@github.com:oliviermattei/boilerplate.git`. La configuration git n'étant pas versionnée, l'ajout n'est **pas attribuable au diff** et peut être le fait du propriétaire ; `git branch -r` est vide, donc rien n'a été poussé. Consigné pour la trace, pas imputé.

**F12 — Imports intra-package sans extension** (déviation n°3). Vérifié fonctionnel sous tsx (`pnpm db:migrate` résout correctement), Next/Turbopack, Vitest et `tsc` en `moduleResolution: bundler`. Mais `packages/db` déclare `"type": "module"` et `"exports": { ".": "./src/index.ts" }` : sous un Node ESM nu, sans transpileur, la résolution échouerait. Contrainte latente à documenter plutôt qu'un défaut actuel.

---

## Interdits du plan — vérification ligne à ligne

| Interdit | Vérification | Verdict |
|---|---|---|
| Aucun package hors `config` et `db` | `ls packages/` → `config`, `db`. `tooling/typescript` est la tâche 2 du plan | ✓ |
| Aucune table de production | seule table du diff : `fixture_item` dans `tests/fixtures/schema.ts` | ✓ |
| Jamais `drizzle-kit push` | aucune occurrence dans les scripts ni les configs (le seul « push » du dépôt est un commentaire qui l'interdit) | ✓ |
| Pas d'ESLint, Playwright, `.github/` | `.github/` absent, aucune de ces dépendances dans les 5 `package.json` | ✓ |
| Pas de Tailwind, shadcn, Base UI, Hono, oRPC | aucune occurrence | ✓ |
| `docs/` non modifié hors plan/recherche | `git diff --stat -- docs` = `docs/plans/s01-boot-blank-app.md`, 10 lignes, **uniquement des `[ ]` → `[x]`** | ✓ |
| Pas de remote git | voir F11 | ⚠ non attribuable |
| Aucun secret, identifiant personnel ou nom de projet en dur | `.env.example` ne contient que `postgres/postgres/app` en local ; `layout.tsx` et `page.tsx` disent « Application » ; `package.json` racine se nomme `boilerplate` | ✓ |

## Plan, tâche par tâche

Les 10 tâches sont livrées et cochées. Dérive de fichiers (déviation n°4) : `tooling/typescript/{nextjs.json,package.json}`, les `tsconfig.json` par package, le `tsconfig.json` racine, `tests/fixtures/*`, `apps/web/next-env.d.ts`, `packages/db/drizzle/meta/_journal.json`, les ajouts au `.gitignore`. Tous porteurs (les tsconfig sont nécessaires à la tâche 2, les fixtures à la tâche 10), aucun n'ouvre de périmètre. La section « Files touched » du plan est indicative, pas exhaustive : pas de finding.

Déviations annoncées par l'implémenteur, jugées une à une :

1. **Vitest à la tâche 1 au lieu de la 9** — la tâche 9 autorisait explicitement l'installation de Vitest à la racine ; seul l'ordre change, imposé par le TDD. Acceptable, pas de finding.
2. **Scripts séparés de la bibliothèque** — vérifié : `next build` passe (`✓ Compiled successfully`), les chemins `new URL('../../../../.env', import.meta.url)` et `new URL('../../drizzle', import.meta.url)` depuis `packages/db/src/scripts/` résolvent bien vers `<racine>/.env` et `packages/db/drizzle`, et `pnpm db:migrate` va jusqu'à la validation d'environnement. Design **meilleur** que la liste du plan (bibliothèque pure, entrypoints séparés). Acceptable.
3. Voir F12. 4. Voir ci-dessus. 5. **devDeps racine** (`drizzle-kit`, `drizzle-orm`, `@types/node`) — requis par `tests/fixtures/{drizzle.config,schema}.ts` et `tests/migrations.test.ts`. Acceptable.
6. **`migrationsTable`/`migrationsSchema`** — API réelle vérifiée dans `drizzle-orm/migrator.d.ts`, et c'est précisément ce qui rendra les journaux par module possibles en s04. Acceptable, plutôt un point fort.
7. **`apps/web/{AGENTS,CLAUDE}.md` gitignorés** — cohérent avec « le dépôt n'a qu'un seul fichier de règles ». Acceptable. 8. Voir F10. 9. Voir F4. 10. Voir F6.

## ADRs

ADR 001 ✓ (Next 16.3.3 App Router, React 19.2.8, TS strict ; Tailwind/shadcn différés par interdit de plan, pas contredits). ADR 002 ✓ pour la structure, ⚠ F8 pour les frontières dans les tests. ADR 003 ✓ sur `DATABASE_URL` unique et point d'entrée unique ; le pilote par défaut est `node-postgres`, pas `@neondatabase/serverless`, ce qui reste compatible avec « Neon par défaut » puisque Neon parle le protocole standard via son pooler et que la route est `runtime = 'nodejs'` — mais le « à surveiller : le pooling » de l'ADR n'est traité qu'à moitié : `getDatabase()` fige `max: 10` sans réglage par environnement, ce qui est le bon endroit pour le corriger (c'est bien encapsulé) mais reste à faire en s27. ADR 010 ✓ sauf F10.

---

## Ce que je n'ai PAS pu vérifier

Cette machine n'a ni Docker, ni Colima, ni Postgres local — contrainte déjà consignée dans le plan. En conséquence, **et il faut le lire comme « non prouvé », pas comme « satisfait »** :

- **Critère 4 (idempotence de `db:migrate`)** — jamais exécuté. Le test existe et est correct à la lecture, il est skippé.
- **Critère 5 (rejouabilité de `db:seed`)** — jamais exécuté, et littéralement sans objet aujourd'hui (F3).
- **Critère 6 (`docker compose up`)** — `docker-compose.yml` n'a jamais tourné. L'image `postgres:16-alpine`, le `healthcheck pg_isready`, le volume nommé et l'interpolation `${POSTGRES_PORT:-5432}` sont lus, pas éprouvés.
- **Critère 7, branche 200** — jamais obtenue. Et d'après F1, elle est aujourd'hui inatteignable par les commandes de la story.
- **`drop table if exists drizzle.fixture_migrations` quand le schéma `drizzle` n'existe pas encore** (premier passage de `resetDatabase`) — je crois que PostgreSQL émet un NOTICE et non une erreur, mais je ne l'ai pas exécuté. Si je me trompe, `beforeAll` casse les deux tests d'intégration au premier lancement sur base vierge.
- **Chemin Neon** — jamais exercé. La portabilité promise par l'ADR 003 n'est affirmée que par un commentaire dans `packages/db/src/client.ts`.
- **`pnpm install` sur un clone réellement neuf** — je n'ai validé que `--frozen-lockfile` sur l'arbre existant, pas un `git clone` dans un répertoire vide.
- **Rendu navigateur** — j'ai fait des `curl` (HTTP 200 sur `/`, 503 sur `/api/health`), je n'ai jamais ouvert la page. Elle est volontairement sans style, donc l'enjeu est nul, mais je ne l'ai pas vue.
- **`next start` en production avec une vraie base** — seul `next build` a été exécuté.

**Gestes qu'un humain doit faire, dans cet ordre :**
1. Démarrer Docker/Colima, `cp .env.example .env`, `docker compose up -d`, vérifier que le healthcheck passe.
2. `pnpm db:migrate` deux fois, `pnpm db:seed` deux fois, puis `pnpm test` : **les 3 tests skippés doivent devenir verts**, et le compte doit passer à 15 passed / 0 skipped. Tant que ce chiffre n'est pas constaté, les critères 4, 5 et 6 restent non prouvés.
3. `pnpm dev` puis `curl -i localhost:3000/api/health` en attendant 200 — c'est le geste qui échoue aujourd'hui (F1) et celui qui validera le correctif.
4. `git clone` dans un répertoire vierge, `pnpm install && pnpm dev`, page servie sans erreur : critère 1, recette manuelle assumée par le plan.
5. `next build && next start` avec un `DATABASE_URL` réel, pour éprouver la garde de build hors du chemin `dev`.

---

## Verdict

Le diff est propre, honnête et remarquablement peu hallucinatoire : les cinq invariants centraux mordent sous mutation, aucune API n'est inventée, le piège n°3 de la recherche (`drizzle.config.ts`) est évité et vérifié contre la version installée, les tests d'intégration se skippent au lieu de simuler, et tous les interdits du plan tiennent. C'est du bon travail de plomberie.

Il livre néanmoins un défaut qui vide de sa substance la promesse de la story : « une application qui démarre, **connectée à Postgres** ». `pnpm dev` ne transmet pas `DATABASE_URL` à `apps/web`, pour deux raisons indépendantes et cumulées, l'une dans le placement du `.env`, l'autre dans `turbo.json`. Le 200 de `/api/health` n'est pas « non prouvé faute de Docker » : il est inatteignable, et je l'ai démontré sans base de données. Aucun test de la story ne pouvait l'attraper, parce que le test de santé importe la fonction `GET` directement et court-circuite Next et Turbo.

F1 corrigé, et vérifié par le geste n°3 ci-dessus, la story est bonne à embarquer avec F2 ouvert pour s04.

Max severity: critical
Ship allowed: no
