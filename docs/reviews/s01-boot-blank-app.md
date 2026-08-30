# Review — Story s01-boot-blank-app (2e passage, après le tour de correctifs)

> Revue anti-hallucination en contexte neuf du diff `45a204d..HEAD` (51 fichiers, 4 497 insertions), commits `f73f0d9` (implémentation), `3cae433` (correctifs de revue), `e4b29ee` (TypeScript 7, ADR 011), sur `dev` (règle worktree levée par le propriétaire). Contrat lu : `docs/plans/s01-boot-blank-app.md`, `docs/research/s01-boot-blank-app.md`, `docs/stories.md:47-54`, `AGENTS.md`, `docs/architecture.md`, `docs/decisions/001-011`. Je n'avais jamais vu ce code ; la revue précédente n'a été lue qu'après avoir reproduit F1 moi-même.

## 1. Commandes exécutées, pas rapportées

```
$ pnpm test
 Test Files  5 passed (5)
      Tests  26 passed | 3 skipped (29)
```

Avant le tour de correctifs : 15 tests. Aujourd'hui : 29. Ce sont **14 tests nouveaux**, pas 8 comme annoncé — l'écart est en faveur du diff, je le note pour la trace. Les 3 skips restent ceux attendus (`describe.skipIf(!databaseReachable)`), et `tests/fixtures/database.ts` ouvre toujours un vrai pool et exécute `select 1` avant de décider : le skip est honnête.

| Commande | Résultat |
|---|---|
| `pnpm exec tsc --noEmit` — racine, `packages/config`, `packages/db`, `apps/web` | 4/4, zéro diagnostic, **TypeScript 7.0.2** |
| `pnpm build` (`--force`, cache purgé) | ✓ compilé, 3 routes, `/api/health` en `ƒ (Dynamic)` |
| `pnpm build` **sans `.env` racine** | ✓ succès, aucun bruit dotenv |
| `pnpm build` **avec `.env` racine** | ✓ succès, `apps/web/.next/` ne contient **aucun** `.env`, aucune chaîne `postgres://…@localhost` |
| `pnpm install --frozen-lockfile` | `Lockfile is up to date` |
| `pnpm db:generate` / `db:migrate` / `db:seed` | OK ; `0 tables`, journal vide → « aucune migration à appliquer », aucune connexion ouverte |
| `pnpm exec tsc --noEmit` dans `apps/web` avec `.next/` supprimé | zéro diagnostic |

## 2. F1 est mort — vérifié trois fois, pas cru sur parole

**Reproduction du parcours réel.** `.env` racine (`DATABASE_URL=postgres://postgres:postgres@localhost:5432/app`), aucun Postgres, `pnpm dev`, `curl` :

```
GET / 200
GET /api/health 503
@repo/web:dev: Health check: database unreachable — Failed query: select 1
@repo/web:dev: params: — connect ECONNREFUSED ::1:5432 — connect ECONNREFUSED 127.0.0.1:5432
```

La variable **atteint le processus qui sert la route** : l'échec est une connexion refusée sur le port du fichier, plus une variable absente. C'est exactement le critère de correction fixé par la revue précédente.

**Variable exportée, deuxième cause.** `DATABASE_URL='postgres://probe:probe@127.0.0.1:1/probe' pnpm dev` → `ECONNREFUSED 127.0.0.1:1`. L'export l'emporte sur le fichier (`override: false`) et traverse Turborepo.

**`next start` aussi** (chemin production auto-hébergé, jamais éprouvé au premier passage) : `next.config.ts` s'exécute, `ECONNREFUSED …:5432`. Le correctif ne vaut pas que pour `dev`.

**Les deux causes sont indépendamment mortelles, et je l'ai prouvé en les ressuscitant une par une** (mutations restaurées, cf. §4) : retirer `loadRootEnv()` de `next.config.ts` ramène mot pour mot le symptôme de F1 ; retirer `DATABASE_URL` de la tâche `dev` de `turbo.json` fait filtrer la variable exportée par le mode strict de Turborepo 2. La déclaration `turbo.json` **n'est donc pas décorative**.

## 3. Vérification des API contre les paquets installés (pas la doc)

Les quatre `tsc --noEmit` passent en TypeScript 7 strict, `skipLibCheck` n'occulte pas un export manquant : c'est déjà une preuve forte que tous les imports du diff existent. Vérifications ciblées en plus, dans `node_modules` :

| Élément | Vérification | Verdict |
|---|---|---|
| `dotenv.config({ path, processEnv, override, quiet })` | `dotenv@17.4.2/lib/main.d.ts` déclare les quatre | ✓ API réelle |
| `prepareFromExports` (justification du commentaire de `schema.ts`) | `drizzle-kit@0.31.10/bin.cjs:16727` : `Object.values(exports2).forEach(...)`, aucune descente récursive | ✓ **le commentaire dit vrai** |
| `vi.doMock` / `vi.doUnmock` | `vitest@4.1.11/dist/index.d.ts:450,458` | ✓ |
| `migrate`, `migrationsTable`, `migrationsSchema`, `drizzle(pool, {schema, casing})`, `defineConfig({dialect,schema,out,casing})` | déjà vérifiés au 1er passage, inchangés | ✓ |
| `AggregateError` / `error.errors` | intégré ES2021, couvert par `lib: ES2022` | ✓ |
| Options de `tooling/typescript/*.json` sous TS 7 | sonde isolée : `tsc` échoue en TS5023 sur une option retirée. Le dépôt ne produit aucun TS5023 | ✓ **aucune option supprimée n'est utilisée** |
| Sévérité réelle de `base.json` sous TS 7 | sonde isolée : `noUnusedLocals` (TS6133) et `noUncheckedIndexedAccess` (TS2322) mordent | ✓ config non creuse |
| Lockfile | une seule version de TypeScript, `7.0.2`, dans les 4 projets | ✓ ADR 011 respecté |

Aucune API inventée dans le diff.

## 4. Morsure des tests (mutations, toutes restaurées)

| # | Cible | Mutation | Rouges |
|---|---|---|---|
| M1 | `apps/web/next.config.ts` | `loadRootEnv()` commenté | **1** (+ F1 reproduit à l'exécution) |
| M2 | `turbo.json` | `DATABASE_URL` retiré de la tâche `dev` | **1** (+ variable exportée filtrée) |
| M3 | `packages/db/src/schema.ts` | retour de `composeSchema` remis à `Record<string, unknown>` | **0 au runtime**, 1 erreur `tsc` — voir N3 |
| M4 | `packages/db/src/migrate.ts` | `entries.length > 0` → `true` | **1** |
| M5 | `packages/db/src/client.ts` | garde chaîne vide → `if (false)` | **1** |
| M6 | `packages/db/src/client.ts` | déballage `AggregateError` supprimé | **1** |
| M7 | `packages/config/src/env.ts` | `console.warn` de `SKIP_ENV_VALIDATION` supprimé | **1** |
| M8 | `.env.example` | `SKIP_ENV_VALIDATION` renommé | **1** |

Restauration prouvée après chaque mutation : `git status --porcelain` vide, `git diff --exit-code` → 0.

`tests/env-wiring.test.ts` est le seul test de la story qui garde un câblage plutôt qu'une fonction. M1 et M2 prouvent qu'il fait son travail. Sa limite : il constate que `next.config.ts` **appelle** `loadRootEnv`, pas que Next exécute `next.config.ts` dans le processus qui sert la route. Cette seconde moitié n'est couverte par aucun test automatisé.

---

## Findings

### MAJOR — N1. Critère 2 à moitié satisfait : une variable manquante ou malformée ne fait pas échouer le démarrage

Le critère dit : « Une variable d'environnement manquante ou malformée **fait échouer le démarrage** avec un message nommant la variable fautive ». Mesuré sur le code livré, sans mutation :

```
$ DATABASE_URL='mysql://oops@localhost/x' pnpm dev
@repo/web:dev: ✓ Ready in 331ms
@repo/web:dev:  GET / 200 in 912ms
@repo/web:dev: Health check: database unreachable — Invalid environment variables:
@repo/web:dev:   - DATABASE_URL: must be a PostgreSQL connection string (postgres://…)
@repo/web:dev:  GET /api/health 503
```

L'application **démarre**, sert `/` en 200, et ne signale la variable fautive qu'au premier appel de la sonde, dans les journaux serveur. La moitié « message nommant la variable fautive » est parfaitement tenue ; la moitié « fait échouer le démarrage » ne l'est pas. Un Dev qui se trompe de chaîne de connexion voit une application qui a l'air de marcher.

C'est la conséquence de la validation paresseuse, choisie pour la bonne raison — la recherche pose « la validation ne doit pas casser le build » — mais la garde de build existe précisément pour permettre une validation **au démarrage du serveur** sans casser `next build`. Les deux ne s'excluent pas. `pnpm db:migrate` et `pnpm db:seed`, eux, échouent bien immédiatement.

Ni le plan ni la revue précédente ne l'avaient relevé. Non bloquant (le diagnostic existe et nomme la variable), mais le critère 2 doit être marqué « partiellement satisfait », pas coché.

### MAJOR — N2. La justification écrite dans `packages/config/src/dotenv.ts` n'est pas reproductible

Le commentaire est la raison d'être du mécanisme de résolution à l'exécution, et il est formulé comme un fait mesuré : les bundlers analyseraient statiquement `new URL('../../..', import.meta.url)`, Turbopack copierait le `.env` dans les artefacts de build et ferait échouer la compilation quand le fichier n'existe pas.

J'ai implémenté la forme rejetée dans `apps/web/next.config.ts` (à la profondeur correcte) et mesuré, cache purgé :

- `next build` avec `.env` présent : **succès**. `find apps/web/.next -name "*.env*"` → vide. `grep -rl "postgres:postgres@localhost" apps/web/.next` → vide. **Aucune fuite.**
- `next build` avec `.env` absent : **succès**. **Aucun build cassé.**

Le mécanisme invoqué est réel *dans le code applicatif bundlé*, mais `next.config.ts` est compilé par le chargeur de configuration de Next, pas par le bundler d'application : il ne s'applique pas là où le commentaire dit qu'il s'applique. Accessoirement, le chemin cité dans le rapport de correctifs (`'../../../.env'` depuis `apps/web/next.config.ts`) pointe **au-dessus** de la racine du dépôt et n'a donc jamais été une alternative fonctionnelle.

**Le code livré reste le meilleur des deux** — résolution depuis n'importe quel répertoire courant, `undefined` hors du dépôt, dégradation propre en déploiement — et je ne demande pas de le changer. Ce qui est en cause est le commentaire : un « on a rejeté X parce que Y » où Y est faux devient, dans six mois, la raison pour laquelle personne n'ose simplifier. À réécrire en ce qu'elle est vraiment : un choix de robustesse, pas un contournement d'une régression mesurée.

### MAJOR — N3 (report). `composeSchema` reste invisible pour `drizzle-kit generate` : la moitié « génération » de F2

La moitié « typage » est réellement corrigée : `composeSchema<const TModules>` + `ComposedSchema` préservent le type, et `expectTypeOf` échoue sous `tsc` dès qu'on rétablit `Record<string, unknown>` (M3). `AppSchema` vaut `Record<string, never>` pour une liste vide, ce qui est correct.

La moitié « génération » reste ouverte, **délibérément et honnêtement** : le commentaire de `packages/db/src/schema.ts` décrit exactement ce que fait `prepareFromExports`, vérifié ligne par ligne dans `drizzle-kit@0.31.10/bin.cjs:16727`. Il nomme le chaînon manquant (fichier baril réexportant à plat) et le renvoie à s04. Aucune table aujourd'hui, donc aucun risque en s01. Finding maintenu ouvert au niveau major pour qu'il ne se perde pas : il ne bloque pas ce ship, il bloque s04.

### MINOR

**N4 — La garantie de typage n'est vérifiée par aucune commande de la Definition of Done.** `expectTypeOf` est un no-op à l'exécution : sous mutation M3, `pnpm test` reste vert et `pnpm build` passe ; seul `tsc --noEmit` **à la racine** échoue. Or il n'existe ni script `typecheck` racine, ni tâche `typecheck` dans `turbo.json` — les trois scripts par package sont orphelins et ne couvriraient pas `tests/`. La DoD dit « `pnpm test` passe » ; elle ne protège pas ce que le correctif vient d'ajouter. s02 livre `pnpm typecheck` : c'est là que ça se règle.

**N5 — `apps/web/next-env.d.ts` est versionné alors que Next le réécrit selon la commande.** La version committée est la variante `dev` ; un `pnpm build` la réécrit et salit l'arbre. Antérieur au tour de correctifs, manqué par la revue précédente. Conséquence : toute vérification `git diff --exit-code` dans la CI de s02 échouera après un build.

**N6 — Le `.env` racine ne fait pas partie de la clé de cache de la tâche `build`.** Mesuré : modifier `DATABASE_URL` puis relancer `pnpm build` → `FULL TURBO`. Turborepo hache la variable du processus, pas le fichier, et `turbo.json` n'a ni `globalDependencies` ni `inputs`. Sans effet aujourd'hui, mais dès la première variable `NEXT_PUBLIC_*`, le cache servira un artefact construit avec l'ancienne valeur. Correctif d'une ligne : `"globalDependencies": [".env"]`.

**N7 — `findRootEnvPath` boucle indéfiniment sur un `from` relatif.** `parse('a/b').root === ''` et `dirname('.') === '.'`, donc la condition d'arrêt n'est jamais atteinte. Reproduit hors dépôt. Non atteignable par un appelant actuel, mais la fonction est **exportée dans le barrel public de `@repo/config`**. Corrigeable par `let current = resolve(from)`.

**N8 — Le barrel de `@repo/config` tire désormais des modules Node.** `src/index.ts` réexporte `./dotenv`, qui importe `node:fs` et `node:path`. `@repo/config` est le point d'accès unique à l'environnement et hébergera les `NEXT_PUBLIC_*` : le premier composant client qui l'importera traînera `node:fs` dans le graphe client. Séparer l'export serveur coûte peu maintenant.

**N9 — `hasMigrations` fait `JSON.parse` sans garde.** Un `_journal.json` malformé remonte un `SyntaxError` brut au lieu d'une erreur nommant le fichier.

**N10 — Dérive documentaire après ADR 011.** `docs/architecture.md` affiche toujours « TypeScript 5.9+ » en citant l'ADR 010, superseded sur ce point. Le plan interdisait à l'implémenteur de toucher `architecture.md` : ce n'est pas une dérive d'exécution, c'est une mise à jour de cadrage due sur la branche par défaut. De même, les tâches 1 et 10 du plan décrivent un `turbo.json` portant une tâche `test`, cochées, alors que le correctif l'a retirée en réponse à F4.

### Findings de la revue précédente — état

| # | Objet | État vérifié |
|---|---|---|
| F1 | `DATABASE_URL` n'atteint pas `apps/web` | **Corrigé**, reproduit et remuté deux fois |
| F2 | `composeSchema` : typage + génération | Typage **corrigé** ; génération **ouverte, documentée avec exactitude** (N3) |
| F3 | Critère 5 sans objet | Inchangé, décision de plan assumée |
| F4 | Tâche `test` morte | **Corrigée** (retirée) — cf. N10 |
| F5 | Garde de journal inatteignable | **Corrigée** (M4) |
| F6 | `SKIP_ENV_VALIDATION` / `NEXT_PHASE` | **Corrigé** : documenté, testé (M8), trappe bruyante (M7), garde chaîne vide (M5) |
| F7 | `process.env` hors module de config | **Corrigé** |
| F8 | Harnais franchissant les frontières de packages | Inchangé. À arbitrer en s02 |
| F9 | Pool orphelin | **Corrigé** |
| F10 | TypeScript `^5.9` | **Corrigé** : ADR 011, `7.0.2` partout |
| F11 | Remote git `origin` | Inchangé, non attribuable au diff |
| F12 | Imports intra-package sans extension | Inchangé, contrainte latente |
| — | Pooling `max: 10` figé (ADR 003) | Inchangé, s27 |

`describeError` déballe désormais `AggregateError` — hors liste demandée, mais justifié et prouvé (M6) : sans lui, sur un hôte double pile, le journal était muet. Ajout accepté.

## Interdits du plan — revérifiés sur le diff complet

| Interdit | Vérification | Verdict |
|---|---|---|
| Aucun package hors `config` et `db` | `ls packages/` → `config`, `db` | ✓ |
| Aucune table de production | seule table : `fixture_item` sous `tests/fixtures/` | ✓ |
| Jamais `drizzle-kit push` | aucune occurrence hors commentaire l'interdisant | ✓ |
| Pas d'ESLint, Playwright, `.github/` | absents | ✓ |
| Pas de Tailwind, shadcn, Base UI, Hono, oRPC | aucune occurrence | ✓ |
| `docs/` non modifié hors plan/recherche | plan (cases cochées), revue précédente, **ADR 011 (nouveau)** | ⚠ voir ci-dessous |
| Pas de remote git ajouté | inchangé | ⚠ non attribuable |
| Aucun secret ni identifiant personnel | ✓ | ✓ |

Sur ADR 011 : formellement un ajout sous `docs/` hors périmètre du plan. Mais `AGENTS.md` **exige** un ADR pour une décision structurelle, la décision est celle du propriétaire, l'ADR est bien formé (MADR, options rejetées, critère de retour arrière nommé) et ne réécrit aucun document figé. Déviation justifiée, pas un finding — sa seule conséquence à traiter est N10.

## ADRs

ADR 001 ✓. ADR 002 ✓ pour la structure ; ⚠ F8 pour les tests. ADR 003 ✓ ; « à surveiller : le pooling » toujours à moitié traité. ADR 010 ✓. **ADR 011 ✓ vérifié dans le paquet installé** : `typescript@7.0.2` (compilateur natif), une seule version au lockfile, aucune option supprimée utilisée, vérifications strictes actives, `next build`, `drizzle-kit` et `vitest` fonctionnels. Le critère de retour arrière de l'ADR n'est pas déclenché.

---

## Ce que je n'ai PAS pu vérifier

Ni Docker, ni Colima, ni Postgres sur cette machine. **À lire comme « non prouvé », jamais comme « satisfait ».**

- **Critère 4 — idempotence de `db:migrate`** : jamais exécuté contre une base. Aujourd'hui la commande ne touche même pas la base (journal vide).
- **Critère 5 — rejouabilité de `db:seed`** : jamais exécuté, et sans objet (`seeders = []`).
- **Critère 6 — `docker compose up`** : jamais exécuté. Image, healthcheck, volume, interpolation de port sont lus, pas éprouvés.
- **Critère 7, branche 200** : jamais obtenue. **Elle n'est plus démontrée inatteignable** — c'est le changement majeur de ce passage — mais elle reste non prouvée.
- **`drop table` sur base vierge** : neutralisé par un `create schema if not exists` préalable. Toujours pas exécuté.
- **`db.query.<table>` réellement utilisable** : M3 prouve que le *type* survit, pas que l'API relationnelle est peuplée à l'exécution (elle exige aussi une configuration de relations). Problème de s04.
- **Chemin Neon** : jamais exercé.
- **`pnpm install` sur un clone réellement neuf** : seul `--frozen-lockfile` validé. Critère 1 = recette manuelle.
- **Rendu navigateur** : `curl` uniquement.
- **Déploiement serverless** : `next.config.ts` n'est pas exécuté à la requête sur Vercel, donc `loadRootEnv()` non plus — cohérent sur le papier (les variables viennent de la plateforme), jamais déployé.

**Gestes qu'un humain doit faire, dans cet ordre :**
1. Démarrer Docker/Colima, `cp .env.example .env`, `docker compose up -d`, attendre le healthcheck.
2. `pnpm db:migrate` deux fois, `pnpm db:seed` deux fois, puis `pnpm test` : **les 3 skips doivent devenir verts, 29 passed / 0 skipped**.
3. `pnpm dev` puis `curl -i localhost:3000/api/health` **en attendant 200** — le geste qui clôt le critère 7.
4. `DATABASE_URL='mysql://x' pnpm dev` : constater que le serveur démarre quand même (N1) avant de décider si l'on corrige maintenant ou en s02.
5. `git clone` vierge, `pnpm install && pnpm dev` : critère 1.
6. `pnpm build` puis `git status` : constater `next-env.d.ts` modifié (N5) avant d'écrire la CI de s02.

---

## État des sept critères

| # | Critère | État |
|---|---|---|
| 1 | `pnpm install && pnpm dev` sur clone neuf | **Partiellement prouvé** — `--frozen-lockfile` OK, `/` servi en 200 ; le clone vierge reste une recette manuelle |
| 2 | Variable manquante/malformée fait échouer le démarrage en la nommant | **Partiellement satisfait** — le message nomme la variable ; le démarrage n'échoue pas (N1) |
| 3 | `.env.example` aligné sur le schéma, testé | **Prouvé** — 3 tests, mordent sous mutation |
| 4 | `db:migrate` idempotent | **Non prouvé** — pas de Postgres ici |
| 5 | `db:seed` rejouable | **Non prouvé et sans objet** — aucun seed (décision de plan) |
| 6 | `docker compose up` fournit un Postgres utilisable | **Non prouvé** — jamais exécuté |
| 7 | `/api/health` répond 200 avec l'état de la connexion | **503 prouvé** ; **200 non prouvé, mais plus démontré impossible** — F1 est mort |

---

---

## Addendum de vérification post-revue — Postgres disponible

> Ajouté par l'orchestrateur après la revue, une fois Docker installé par le propriétaire. **Ce ne sont pas les mesures du reviewer** : ce sont les miennes, exécutées après le commit `6bb1c10` (second tour de correctifs : N1, N2, N7, N6, N8, N9). Les lignes « non prouvé » du tableau ci-dessus sont désormais périmées sur quatre points, et cette section fait foi.

Environnement : Docker Desktop 29.7.2, Compose v5.4.0, conteneur `boilerplate-postgres-1` (`postgres:16-alpine`) sain en 6 secondes, port 5432 publié, base `app` conforme à la `DATABASE_URL` du `.env`.

| Vérification | Commande | Résultat |
|---|---|---|
| **Critère 6** — Postgres par Compose | `docker compose up -d` | healthcheck `pg_isready` passé en 6 s, sans Postgres installé sur la machine |
| **Suite complète** | `pnpm test` | **36 passed, 0 skipped** — les 3 tests d'intégration cessent de se skipper et passent |
| **Critère 4** — idempotence | `pnpm db:migrate` deux fois | deux passages sans erreur |
| **Critère 5** — rejouabilité | `pnpm db:seed` deux fois | deux passages sans erreur (sur le schéma de test, aucun module ne déclarant de données) |
| **Critère 7 — branche 200** | `pnpm dev` + `curl -i /api/health` | `HTTP 200` — `{"status":"ok","database":"connected"}` |
| **N1 — échec au démarrage** | `DATABASE_URL='mysql://oops@localhost/x' pnpm dev` | processus mort, `exit=1`, `Failed to load next.config.ts` puis `EnvValidationError: - DATABASE_URL: must be a PostgreSQL connection string`. Rien n'est servi (`curl` → `000`) |

Nuance sur N1 : Next imprime `✓ Ready in 242ms` **avant** de charger `next.config.ts`, donc la bannière précède l'erreur d'une fraction de seconde. Cosmétiquement trompeur, sans conséquence — le processus sort en 1 et aucune requête n'est servie.

### Correction apportée par l'implémenteur au raisonnement de N1

La revue écrivait que « la garde de build existe précisément pour permettre une validation au démarrage sans casser `next build` ». C'est exact sur le principe mais insuffisant en pratique : `NEXT_PHASE` n'est **pas** encore dans l'environnement au moment où Next lit `next.config.ts` (il est posé plus loin dans le build, avant le lancement des workers). La garde par variable d'environnement seule aurait donc cassé `pnpm build` sans `.env`. Le correctif exporte une **fonction** de configuration et utilise l'argument `phase` que Next lui passe — le seul signal disponible à cet instant.

### État réel des sept critères après ce second tour

| # | Critère | État |
|---|---|---|
| 1 | `pnpm install && pnpm dev` sur clone neuf | Prouvé sur clone temporaire par l'implémenteur ; `--frozen-lockfile` revérifié |
| 2 | Variable invalide fait échouer le démarrage en la nommant | **Prouvé** — N1 corrigé et vérifié sur `dev` et `next start` |
| 3 | `.env.example` aligné sur le schéma | **Prouvé** |
| 4 | `db:migrate` idempotent | **Prouvé** |
| 5 | `db:seed` rejouable | **Prouvé** sur le schéma de test ; sans objet applicatif tant qu'aucun module ne déclare de données (décision de plan) |
| 6 | `docker compose up` fournit un Postgres utilisable | **Prouvé** |
| 7 | `/api/health` répond 200 avec l'état de la connexion | **Prouvé** dans les deux branches, 200 et 503 |

### Ce qui reste ouvert

N3 (baril à plat pour `drizzle-kit`) → bloque s04. N4 (`pnpm typecheck` absent de la Definition of Done), N5 (`next-env.d.ts` versionné et réécrit par `build`), F8 (frontières de packages contournées par le harnais) → s02. F12, pooling `max: 10` → s27.

Le code a changé après le verdict ci-dessous (commit `6bb1c10`) : `next.config.ts` exporte désormais une fonction, `@repo/config` a une entrée serveur séparée, les alias Vitest sont passés en expressions régulières exactes. Ces changements n'ont pas été soumis à une revue en contexte frais.


## Verdict

Le tour de correctifs fait ce qu'il annonce, et proprement. F1 est mort pour de bon : parcours du Dev reproduit, ECONNREFUSED obtenu sur le port du `.env` racine, variable exportée vérifiée comme prioritaire et traversant Turborepo, puis chacune des deux causes ressuscitée séparément pour constater le retour exact du symptôme d'origine. Le correctif tient aussi sur `next start`, chemin que la revue précédente n'avait pas éprouvé. Les six mineurs revendiqués mordent tous sous mutation, `process.env` a disparu hors du module de configuration, la moitié « typage » de F2 est réelle et sa moitié « génération » est documentée avec une exactitude vérifiée dans le binaire de drizzle-kit. La montée en TypeScript 7 est saine.

Restent trois choses à ne pas laisser filer. Un critère d'acceptation à moitié tenu que personne n'avait vu : l'application démarre avec une `DATABASE_URL` malformée, alors que le critère 2 demande le contraire. Un commentaire qui justifie le cœur du correctif par une régression que je n'ai pas pu reproduire — le code est bon, sa raison écrite ne l'est pas, et c'est le genre de fausse certitude qui se transmet. Une garantie de typage que la commande de la Definition of Done ne vérifie pas.

Rien de tout cela ne ships de bug ni ne casse l'existant. Les critères 4, 5, 6 et le 200 du critère 7 restent **non prouvés faute de Postgres** — non pas satisfaits, non prouvés — et doivent être repassés dès qu'une base est disponible, avant que s02 ne s'appuie dessus.

Max severity: major
Ship allowed: yes
