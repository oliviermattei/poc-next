---
validated: yes
---
# Plan — Story s02-quality-harness

Branch: `dev` (règle worktree levée par le propriétaire)
Research: `docs/research/s02-quality-harness.md` — à lire en premier ; ce plan ne le répète pas.
Validation : le propriétaire a explicitement délégué la validation des plans. Marqué validé sans checkpoint.

## Target story

Un harnais de qualité et une CI qui tournent dès le premier commit, plus les garde-fous transverses ajoutés par les ADR 012 (sécurité) et 013 (dépôt orienté agents). Douze critères, repris de `docs/stories.md`.

Sections de `docs/security.md` couvertes par cette story : **§6 dépendances et chaîne d'approvisionnement** en totalité (lockfile figé, audit bloquant, scan de secrets), et les moyens de vérification des autres sections — sans le harnais, aucun contrôle du socle n'est opposable.

## Tasks (ordered)

1. [ ] **`pnpm typecheck` réel** — script racine couvrant la racine, `tests/` et chaque package, plus la tâche turbo. Ferme le finding N4 de s01 : une erreur de type introduite dans `tests/migrations.test.ts` doit faire échouer la commande.
2. [ ] **ESLint 10 en configuration plate** — `eslint.config.ts` racine, presets dans `tooling/eslint/` (base TypeScript, preset React/Next pour `apps/web`, preset bibliothèque pour les packages). Scripts `lint` et `lint:fix`, tâche turbo. Vérifiable : une violation volontaire échoue, `lint:fix` la répare.
3. [ ] **Règle de frontières des couches** (ADR 006) — `eslint-plugin-boundaries` : `domain` n'importe rien, `application` n'importe que `domain`, `infrastructure` et `presentation` n'importent que `application` et `domain` et jamais l'un l'autre. **Prouvée sur une arborescence de test** (`tests/fixtures/layers/`), puisqu'aucun module réel n'existe encore. Les tests échappent à la règle par une **exception nommée**, jamais par omission (ferme F8 en le documentant).
4. [ ] **`AGENTS.md` par package** — `packages/config`, `packages/db`, `apps/web` : ce que le package peut importer, ce qu'il ne doit jamais contenir, où vivent ses tests. Plus un test qui échoue si un package du workspace en est dépourvu ou si le fichier ne nomme pas ses imports autorisés.
5. [ ] **Playwright** — `playwright.config.ts`, un test end-to-end de démonstration qui échoue si l'application ne démarre pas, script `test:e2e`. Les tests unitaires restent sur Vitest ; les deux ne se recouvrent pas.
6. [ ] **Vitest : deux emplacements autorisés** — `tests/` à la racine pour le transverse, `src/**/*.test.ts` dans chaque package pour ce qui lui appartient. Prépare s03 sans déplacer le harnais plus tard.
7. [ ] **Arbitrage `next-env.d.ts`** (N5) — le fichier bascule selon `dev` ou `build` et empêche le critère 12. Trancher, implémenter, et documenter l'effet sur un clone vierge dans `apps/web/AGENTS.md`.
8. [ ] **Audit de dépendances** — `pnpm audit` au seuil « élevé », bloquant, avec un mécanisme d'exception **daté et justifié** dans un fichier versionné ; une exception sans date d'expiration fait échouer la commande.
9. [ ] **Scan de secrets** — via l'action GitHub officielle, jamais par le paquet npm homonyme qui n'est pas le scanner de référence (piège n°5 de la recherche). Vérifiable : un faux secret introduit dans un commit de test est détecté.
10. [ ] **Workflow CI** — `.github/workflows/ci.yml` : `--frozen-lockfile`, typecheck, lint, tests unitaires, service Postgres + migrations, end-to-end, audit, scan de secrets, build. Échoue si l'un échoue.
11. [ ] **`AGENTS.md` racine du template** — vérifier que les sections obligatoires (architecture en couches, règles de module, commandes) sont présentes, et que le test qui le contrôle échoue si l'une disparaît.

## Run interdicts

- **Aucun module applicatif, aucun package nouveau** hors `tooling/eslint`. `packages/core`, `ports`, `adapters`, `ui`, `modules` appartiennent à leurs stories.
- **Aucune table de production**, jamais `drizzle-kit push`.
- **Pas de Tailwind, shadcn, Base UI, Hono, oRPC.**
- **Aucun seuil de couverture bloquant** : un seuil arbitraire produit des tests décoratifs, que les revues de ce dépôt sanctionnent déjà.
- **Ne pas relâcher un contrôle pour faire passer la CI.** Si l'audit bloque, l'exception est datée et justifiée ; elle n'est jamais globale.
- **Ne pas installer le paquet npm `gitleaks`.**
- **Ne pas modifier `docs/`** hors les cases à cocher de ce plan.
- **Ne pas toucher au remote git, ne rien pousser.**
- **Ne pas régresser s01** : les 36 tests existants restent verts, `/api/health` continue de répondre 200 base démarrée et 503 base arrêtée.

## The point everything turns on

**La règle de frontières écrite alors qu'aucune couche n'existe.**

C'est le seul livrable de cette story qui ne peut pas être validé par l'usage : il n'y a ni `domain/`, ni `application/`, ni `infrastructure/` dans le dépôt aujourd'hui. Écrite « à blanc », la règle sera fausse dès que s03 créera le premier module, et personne ne s'en apercevra avant que la violation soit partout.

Trois endroits où ce plan peut se tromper :
- **La forme des catégories.** Comparer la configuration écrite avec la structure exacte annoncée par `docs/architecture.md` (`packages/modules/<module>/src/{domain,application,infrastructure,presentation}`). Un motif de chemin approximatif ne matchera aucun fichier réel et la règle sera silencieusement inerte.
- **La preuve.** L'arborescence de test doit contenir des violations **réelles** de chaque arête interdite, et le test doit constater que le lint les rejette. Une règle qu'on ne voit jamais échouer n'existe pas.
- **L'exception pour les tests.** Trop large, elle vide la règle ; trop étroite, elle bloque le harnais lui-même. Comparer avec ce que `vitest.config.ts` alias aujourd'hui.

## Files touched

```
package.json, turbo.json, eslint.config.ts, playwright.config.ts, vitest.config.ts
tooling/eslint/{package.json,base.ts,next.ts,library.ts}
.github/workflows/ci.yml
.audit-exceptions.json (ou équivalent versionné et daté)
packages/config/AGENTS.md, packages/db/AGENTS.md, apps/web/AGENTS.md, tooling/eslint/AGENTS.md
tests/agents-md.test.ts, tests/layer-boundaries.test.ts, tests/fixtures/layers/**
e2e/health.spec.ts
apps/web/.gitignore ou next-env.d.ts (selon l'arbitrage de la tâche 7)
```

## Test strategy

- **Unitaire (Vitest)** : présence et forme des `AGENTS.md` ; sections obligatoires du `AGENTS.md` racine ; format et expiration des exceptions d'audit.
- **Lint comme test** : la règle de frontières est vérifiée en exécutant ESLint sur `tests/fixtures/layers/` et en asseyant que chaque arête interdite produit une erreur, chaque arête autorisée aucune.
- **End-to-end (Playwright)** : l'application démarre et sert `/` ; le test échoue si le serveur ne monte pas.
- **CI comme preuve** : le workflow doit échouer sur une violation introduite volontairement (type, lint, secret) — à démontrer localement en exécutant les mêmes commandes que le workflow, faute de pouvoir déclencher GitHub Actions depuis ce poste.
- **Non-régression s01** : `pnpm test` reste vert, 36 tests au minimum.

## Definition of Done

- Les douze critères de `docs/stories.md` (s02) sont satisfaits, chacun couvert par un test ou une recette manuelle tracée.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` passent, et `pnpm test:e2e` passe avec Postgres démarré.
- §6 de `docs/security.md` intégralement couverte.
- Aucun interdit violé — le diff en fait foi.
- Un commit sur `dev`, message impératif en français.
- Revue en contexte frais passée (`Ship allowed: yes`).
