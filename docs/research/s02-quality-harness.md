# Research — Story s02-quality-harness

## The five structuring facts

1. **s01 a laissé trois scripts `typecheck` orphelins** (`packages/config`, `packages/db`, `apps/web`) : aucun script racine, aucune tâche turbo, et surtout aucune couverture de `tests/`. C'est le finding N4 de la revue de s01 : la garantie de typage ajoutée par le correctif (`expectTypeOf` sur `composeSchema`) n'est vérifiée par **aucune** commande de la Definition of Done — `pnpm test` reste vert quand on la casse.
2. **`apps/web/next-env.d.ts` est versionné et réécrit par Next selon la commande** (`./.next/dev/types/…` après `dev`, `./.next/types/…` après `build`). Le nouveau critère « après `pnpm build`, `git status` reste propre » est donc **en conflit direct** avec l'état actuel du dépôt : c'est N5, et s02 est la story qui doit le trancher.
3. **Le harnais de test actuel contourne les frontières de packages** (F8) : `vitest.config.ts` alias `@repo/config` et `@repo/db` vers les sources, et `tests/health.test.ts` importe `../apps/web/app/api/health/route`. L'ADR 002 pose qu'« un import non déclaré échoue » — dans les tests, plus rien n'échoue. s02 installe le lint de frontières : il doit décider si les tests y échappent, et le dire.
4. **ESLint 10 n'a plus de `.eslintrc`.** La configuration est un fichier plat (`eslint.config.ts`), et `typescript-eslint` 8 s'y branche par `tseslint.config()`. Toute recette trouvée en ligne antérieure à ESLint 9 est inapplicable — même piège que Tailwind v4 signalé dans l'ADR 010.
5. **Le paquet npm `gitleaks` (1.0.0) n'est pas l'outil de référence.** Le scanner de secrets réel est un binaire Go distribué par action GitHub. Installer le paquet npm homonyme donnerait un scan qui ne scanne rien — hallucination de dépendance typique, à éviter explicitement.

## Target story

`s02-quality-harness` — complexité annoncée 2, dépend de s01 (livrée). Critères, après amendement au titre du socle de sécurité (ADR 012) et du dépôt orienté agents (ADR 013) :

1. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` s'exécutent et passent
2. `pnpm typecheck` couvre racine, `tests/` et chaque package ; une erreur de type dans un test le fait échouer
3. `pnpm lint` échoue sur une violation volontaire, la correction automatique la répare
4. Le lint fait respecter la règle de dépendance des couches (ADR 006)
5. `pnpm audit` bloque au seuil « élevé » ; un scan de secrets sur le diff bloque aussi
6. Chaque package a un `AGENTS.md` nommant ses imports autorisés ; un test échoue sinon
7. Un test unitaire et un test end-to-end de démonstration existent et échouent si l'application ne démarre pas
8. `AGENTS.md` du template décrit architecture, règles de module et commandes ; test de présence des sections
9. La CI exécute tout cela sur chaque push et échoue si l'un échoue
10. Installation en `--frozen-lockfile`, échec si le lockfile diverge
11. La CI démarre un Postgres de test et joue les migrations avant les tests
12. Après `pnpm build`, `git status` reste propre

## Current state of the code

Livré par s01 (commits `f73f0d9`, `3cae433`, `6bb1c10`) :

| Chemin | État |
|---|---|
| `package.json` racine | scripts `dev`, `build`, `test`, `db:generate`, `db:migrate`, `db:seed`. **Pas de `typecheck`, ni `lint`, ni `test:e2e`** |
| `turbo.json` | tâches `dev`, `build`, `db:*` ; `globalDependencies: ['.env']`. La tâche `test` a été retirée en réponse à F4 |
| `tests/` | 4 fichiers, 36 tests, tous à la racine du dépôt |
| `packages/config/src` | `env.ts`, `dotenv.ts`, `server.ts` (entrée serveur séparée, N8), `index.ts` |
| `packages/db/src` | `client.ts`, `schema.ts`, `migrate.ts`, `seed.ts`, `scripts/` |
| `apps/web/app` | `layout.tsx`, `page.tsx`, `api/health/route.ts` |
| devDeps racine | `typescript` 7.0.2, `vitest` 4.1.11, `drizzle-kit`, `drizzle-orm`, `turbo`, `@types/node` |

Aucun ESLint, aucun Playwright, aucun `.github/`, aucune configuration de couverture.

## Anchor points

| À créer | Rôle |
|---|---|
| `eslint.config.ts` (racine) | Configuration plate, partagée ; `tooling/eslint/` pour les presets par type de package |
| `playwright.config.ts` | Tests end-to-end contre l'application démarrée |
| `.github/workflows/ci.yml` | typecheck, lint, tests, e2e, audit, scan de secrets |
| `tooling/eslint/` | presets : base, react/next, package de bibliothèque |
| Scripts racine | `typecheck`, `lint`, `lint:fix`, `test:e2e` ; tâches turbo correspondantes |
| `AGENTS.md` par package | `packages/config`, `packages/db`, `apps/web`, plus le test qui en vérifie la présence |

## Verified APIs / functions

Versions relevées sur le registre npm au moment de la recherche (les versions exactes seront figées par le lockfile, ADR 010) :

| Paquet | Dernière version | Note |
|---|---|---|
| `eslint` | 10.9.1 | configuration plate obligatoire |
| `@eslint/js` | 10.0.1 | presets recommandés |
| `typescript-eslint` | 8.68.0 | paquet unifié, `tseslint.config()` |
| `eslint-config-next` | 16.3.3 | aligné sur Next 16 |
| `eslint-plugin-boundaries` | 7.2.0 | règle de frontières par catégories d'éléments |
| `dependency-cruiser` | 18.2.0 | alternative, hors ESLint, graphe de dépendances |
| `@playwright/test` | 1.62.1 | téléchargement de navigateurs requis |
| `@vitest/coverage-v8` | 4.1.11 | aligné sur Vitest 4 |

**Piège vérifié** : `gitleaks` sur npm est en version 1.0.0 et n'est pas le scanner de référence. Le scan de secrets passe par l'action GitHub officielle, pas par une dépendance npm.

## Traps & constraints

- **Le critère 12 (`git status` propre après build) est aujourd'hui faux** à cause de `next-env.d.ts` (N5). Trois issues possibles : l'ignorer dans git (mais `tsc` en a besoin sur un clone neuf avant tout build), le committer et normaliser après build, ou exclure ce chemin de la vérification. À trancher au plan, en nommant l'effet sur un clone vierge.
- **Le lint de frontières est le cœur de la story, pas ESLint en général.** L'ADR 006 dit que c'est ce qui sépare une architecture d'une intention. Aujourd'hui il n'y a aucun module, donc aucune couche `domain`/`application`/`infrastructure` à contraindre : la règle doit être écrite et **prouvée sur une arborescence de test**, sinon elle sera écrite « à blanc » et fausse dès s03.
- **Playwright en CI exige un navigateur, un serveur et une base.** Le workflow doit démarrer Postgres (service), jouer les migrations, construire, puis servir l'application. C'est la partie la plus longue et la plus fragile du workflow.
- **`pnpm audit` est bruyant.** Un seuil « élevé » bloquant sur un dépôt à cinq packages est tenable ; le devient moins avec quarante. Prévoir un mécanisme d'exception daté et justifié, sinon la CI sera contournée au premier faux positif.
- **La couverture n'est pas un critère de la story.** Ne pas l'imposer comme seuil bloquant : un seuil de couverture arbitraire pousse à écrire des tests décoratifs, ce que les revues de ce dépôt sanctionnent déjà.
- **Interdits hérités** : pas de Tailwind, shadcn, Base UI, Hono, oRPC (ils appartiennent à leurs stories) ; aucune table de production ; jamais `drizzle-kit push`.

## Open questions

1. **`eslint-plugin-boundaries` ou `dependency-cruiser` ?** Le premier vit dans ESLint et échoue dans l'éditeur, au plus près de l'agent qui écrit — cohérent avec l'ADR 013. Le second produit un graphe et gère mieux les règles inter-packages. Recommandation : le plugin ESLint pour la règle de couches, le graphe restant hors périmètre.
2. **Les tests échappent-ils au lint de frontières ?** F8 est ouvert depuis s01. Recommandation : oui, mais explicitement, par une exception nommée dans la configuration — pas par omission.
3. **`next-env.d.ts`** : voir le premier piège.
4. **Où vivent les tests ?** Racine aujourd'hui. Les garder groupés simplifie le harnais mais contredit la modularité (un module doit embarquer ses tests). Recommandation : autoriser les deux dès maintenant (`tests/` racine pour le transverse, `src/**/*.test.ts` par package), pour que s03 n'ait pas à déplacer le harnais.
5. **Exceptions d'audit** : format et durée de vie.

## Real complexity

**Verdict : 3**, contre 2 annoncé dans `docs/stories.md`.

Le score de 2 datait d'avant l'amendement du socle de sécurité : la story portait alors quatre commandes et un workflow. Elle porte désormais douze critères, dont trois qui ne sont pas de la configuration mais de la conception — la règle de frontières à écrire et à prouver sans qu'aucune couche n'existe encore, l'arbitrage `next-env.d.ts` qui touche l'expérience d'un clone neuf, et le premier workflow de CI complet avec base de données et navigateur.

Pas de découpage proposé : le verdict n'est pas 5, et découper le harnais laisserait le dépôt à moitié protégé pendant plusieurs stories, ce qui est précisément ce que s02 doit empêcher.
