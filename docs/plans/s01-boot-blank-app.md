---
validated: yes
---
# Plan — Story s01-boot-blank-app

Branch: `feature/s01-boot-blank-app`
Research: `docs/research/s01-boot-blank-app.md` — à lire en premier ; ce plan ne le répète pas.

## Target story

Démarrer une application vide qui tourne, connectée à Postgres. Sept critères d'acceptation, repris de `docs/stories.md:47-54` : démarrage, validation d'environnement, `.env.example` aligné, migrations idempotentes, seed rejouable, Postgres par Docker Compose, route `/api/health`.

**Reformulation assumée des critères 4 et 5.** Aucun module n'existe encore, donc aucune table de production n'a de raison d'être créée : les premières arrivent avec l'authentification (s07). L'idempotence des migrations et la rejouabilité du seed sont donc prouvées **sur un schéma de test**, pas sur des tables inventées pour l'occasion. Inventer une table `app_setting` ou équivalente serait du périmètre créé par le plan, ce que la revue des stories a déjà sanctionné trois fois.

## Tasks (ordered)

1. [ ] **Racine du monorepo** — `package.json` (privé, `packageManager` pnpm), `pnpm-workspace.yaml` (`apps/*`, `packages/*`, `tooling/*`), `turbo.json` avec les tâches `dev`, `build`, `test`, `.nvmrc`. Vérifiable : `pnpm install` réussit sur un clone neuf.
2. [ ] **`tooling/typescript`** — configuration TypeScript stricte partagée, étendue par chaque package. Vérifiable : `tsc --noEmit` passe sur un package vide qui l'étend.
3. [ ] **`packages/config`** — schéma Zod d'environnement dont les clés sont **énumérables** (le critère 3 en dépend), export typé, et garde de build : la validation ne s'exécute pas pendant `next build`. Vérifiable : une variable manquante lève une erreur nommant la variable ; `NODE_ENV=production` en phase de build n'échoue pas.
4. [ ] **`.env.example`** — toutes les clés du schéma, commentées, sans aucune valeur secrète. Vérifiable par le test de la tâche 9.
5. [ ] **`docker-compose.yml`** — Postgres 16, volume nommé, port configurable, `healthcheck` `pg_isready`. Vérifiable : `docker compose up -d` puis connexion réussie sans Postgres installé sur la machine.
6. [ ] **`packages/db`** — point d'entrée unique construisant le client Drizzle depuis `DATABASE_URL` (le choix du pilote y est encapsulé), et **fonction de composition acceptant une liste de schémas de modules**, vide aujourd'hui. `drizzle.config.ts` écrit d'après la version réellement installée, pas de mémoire (piège n°3 de la recherche). Vérifiable : `pnpm db:generate` produit un fichier SQL sur un schéma de test.
7. [ ] **`apps/web`** — application Next.js App Router, TypeScript strict, page d'accueil minimale sans style. Vérifiable : `pnpm dev` sert la page sans erreur ni avertissement bloquant.
8. [ ] **`/api/health`** — route handler `GET` exécutant une requête réelle via `packages/db` et renvoyant 200 avec l'état de la connexion, ou 503 si la base est injoignable. Vérifiable : 200 base démarrée, 503 base arrêtée.
9. [ ] **Vitest minimal + les tests exigés par les critères** — installation de Vitest à la racine, sans lint, sans Playwright, sans CI (ils appartiennent à s02). Trois tests : variable d'environnement manquante ou malformée, `.env.example` aligné sur les clés du schéma, `/api/health` dans ses deux états.
10. [ ] **Scripts et pipeline de tâches** — `dev`, `build`, `db:generate`, `db:migrate`, `db:seed`, `test` à la racine, câblés dans `turbo.json`. `db:migrate` utilise `migrate()` de `drizzle-orm/node-postgres/migrator`. Test d'intégration : `db:migrate` deux fois de suite sur une base vierge, puis `db:seed` deux fois, sur le schéma de test.

## Run interdicts

- **Ne créer aucun autre package** : `packages/core`, `ports`, `adapters`, `ui`, `modules` appartiennent aux stories qui les justifient. Diff attendu vide sous `packages/` hors `config` et `db`.
- **Aucune table de production.** Le seul schéma introduit est un schéma de test, sous le dossier de tests.
- **Jamais `drizzle-kit push`** — migrations en fichiers SQL versionnés uniquement (`AGENTS.md`, `docs/stories.md:63`).
- **Pas d'ESLint, pas de Playwright, pas de workflow GitHub Actions** : c'est s02. Diff attendu vide sous `.github/`.
- **Pas de Tailwind, pas de shadcn, pas de Base UI, pas de Hono, pas d'oRPC** : aucune de ces briques n'est dans les critères de s01.
- **Ne pas modifier `docs/` hors `docs/research/s01-boot-blank-app.md` et `docs/plans/s01-boot-blank-app.md`.** Le PRD, les stories, l'architecture et le design system sont des documents de cadrage figés sur `dev`.
- **Ne pas ajouter de remote git ni tenter de pousser.**
- Aucune valeur secrète, aucun identifiant personnel, aucun nom de projet en dur — contrainte de revente du PRD.

## The point everything turns on

**La forme de `packages/db`.** Ce plan fait le pari qu'il faut, dès aujourd'hui, un point d'entrée qui *compose* une liste de schémas de modules — alors que cette liste est vide et le restera jusqu'à s03.

Trois endroits où ce pari peut être faux :
- **Si la composition est prématurée** : comparer avec ce que s04 exige réellement (`docs/stories.md`, story s04 : « chaque module déclare son schéma dans son propre dossier », « n'applique que les migrations des modules activés »). Si la fonction écrite ici ne sert pas telle quelle en s04, elle est du décor.
- **Si l'encapsulation du pilote est illusoire** : comparer le chemin Neon serverless et le chemin `node-postgres` conteneurisé. S'ils divergent au-delà d'une chaîne de connexion (pooling, `fetch` vs socket), l'ADR 003 promet une portabilité que le code ne tient pas.
- **Si `drizzle.config.ts` est écrit d'après la documentation en ligne** plutôt que d'après la version installée : comparer avec le `README` ou les types du paquet réellement présent dans `node_modules`. La forme `driver: 'pg'` est obsolète et échoue avec un message peu parlant.

## Files touched

```
package.json, pnpm-workspace.yaml, turbo.json, .nvmrc, .env.example, docker-compose.yml
tooling/typescript/base.json
packages/config/{package.json,src/env.ts,src/index.ts}
packages/db/{package.json,drizzle.config.ts,src/client.ts,src/schema.ts,src/migrate.ts,src/seed.ts}
apps/web/{package.json,next.config.ts,tsconfig.json,app/layout.tsx,app/page.tsx,app/api/health/route.ts}
vitest.config.ts
tests/{env.test.ts,env-example.test.ts,health.test.ts,migrations.test.ts}
tests/fixtures/schema.ts
```

## Test strategy

- **Unitaire (Vitest, sans base)** : schéma d'environnement — variable manquante, variable malformée, cas nominal ; alignement `.env.example` ↔ clés du schéma.
- **Intégration (Vitest + Postgres du compose)** : `db:migrate` exécuté deux fois sur une base vierge, aucune erreur, aucun effet au second passage ; `db:seed` exécuté deux fois, aucun doublon ; `/api/health` en 200 base démarrée et en 503 base arrêtée.
- **Contrainte d'environnement (constatée au lancement)** : cette machine n'a ni Docker, ni Colima, ni Postgres local. Les tests d'intégration sont **écrits** mais se skippent proprement en l'absence de `DATABASE_URL` joignable. Les critères 4, 5, 6 et la moitié du 7 (`/api/health` en 200) restent donc **non prouvés au ship** et devront être repassés dès qu'une base est disponible. À consigner tel quel dans la revue : ne pas les déclarer satisfaits.
- **Hors tests** : `pnpm install && pnpm dev` sur un clone neuf reste une vérification humaine — c'est le critère 1, et il n'a pas de sens automatisé avant la CI de s02. À tracer dans la revue.

## Definition of Done

- Les sept critères de `docs/stories.md:47-54` sont satisfaits, chacun couvert par un test ou par une trace de vérification manuelle consignée dans la revue.
- Aucun interdit de la section « Run interdicts » n'est violé — le diff en fait foi.
- `pnpm test` passe. Pas de lint, pas de CI : s02.
- Un commit unique sur `feature/s01-boot-blank-app`, portant la recherche, le plan et le code, message impératif en français.
- Revue passée (`docs/reviews/s01-boot-blank-app.md` avec `Ship allowed: yes`) avant tout ship.
