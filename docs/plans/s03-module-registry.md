---
validated: yes
---
# Plan — Story s03-module-registry

Branch: `dev`
Research: `docs/research/s03-module-registry.md`
Validation : déléguée par le propriétaire, marquée validée sans checkpoint.

## Target story

Le registre de modules : contrat typé, configuration validée, module non activé sans route ni navigation, deux modules de démonstration prouvant les comportements. Huit critères repris de `docs/stories.md`.

Sections des socles couvertes : **`docs/security.md` §3 (autorisation)** — le contrat porte le niveau de protection de chaque route, sans quoi le §3 n'est vérifiable que par relecture. **`docs/reliability.md`** — aucune section directement, mais le registre conditionne l'idempotence des webhooks déclarés par module.

## Tasks (ordered)

1. [ ] **`packages/core` et son `AGENTS.md`** — package, configuration TypeScript, préfixe d'imports autorisés. Sans `AGENTS.md`, le test de s02 échoue.
2. [ ] **Le type `ModuleDefinition`** — `id`, `requires`, `schema`, `migrations`, `routes` (chacune avec son **niveau de protection** : publique, authentifiée, rôle requis), `navigation`, `messages`, `emails` (avec leurs locales), `webhooks`, `purge`, `export`, `retention` par catégorie de données. Toutes les clés obligatoires, vides autorisées.
3. [ ] **`config/features.ts` typée** — liste des modules activés. Un identifiant inconnu doit provoquer une **erreur de compilation**, pas une erreur d'exécution : c'est une exigence distincte de la validation des `requires`, ne pas dégrader l'une en l'autre.
4. [ ] **Validation du graphe `requires`** — module manquant nommé, cycle détecté, auto-référence refusée. Erreurs explicites citant les modules en cause.
5. [ ] **Construction du registre** — agrégation des routes, de la navigation, des traductions, des emails et des webhooks des seuls modules activés, dans un ordre dérivé du graphe et non de l'ordre de déclaration.
6. [ ] **Deux modules de démonstration** sous `packages/modules/`, respectant les quatre couches et portant chacun son `AGENTS.md`. L'un activé, l'autre non.
7. [ ] **Consommation dans `apps/web`** — la navigation se construit depuis le registre, les routes des modules activés sont montées, celles des modules absents ne sont **pas exposées** (pas simplement 404 par `notFound()`).
8. [ ] **Preuves** — 404 sur une URL de module non activé, absence d'entrée de navigation, `purge`/`export` non appelés, suite verte module activé puis non activé.

## Décision reportée de s02 : la pureté du `domain`

s02 a livré la règle de dépendance entre couches mais pas la pureté du `domain`, faute d'une liste de refus que le plan ne tranchait pas. Elle est tranchée ici, et s'applique dès le premier module.

**Interdits dans `domain/`**, par `boundaries/dependencies` avec un sélecteur `dependency` (`boundaries/external` est déprécié) :
- frameworks : `next`, `react`, `react-dom`
- ORM et pilotes : `drizzle-orm`, `drizzle-kit`, `pg`
- couche API : `hono`, `@orpc/*`
- authentification : `better-auth`, `@better-auth/*`
- SDK de services tiers : `stripe`, `resend`, `inngest`, `@aws-sdk/*`, `posthog-*`, `@sentry/*`
- packages d'infrastructure du dépôt : `@repo/db`, `@repo/ui`, `@repo/api`, `@repo/config`
- l'intégralité des modules natifs de Node (liste dérivée de `node:module`, comme la garde de surface client de s02)

**Explicitement autorisé : `zod`.** L'ADR 006 interdit au `domain` « framework, ORM ou SDK » — zod n'est aucun des trois. C'est une bibliothèque pure, sans entrée-sortie, et un type de valeur validé appartient au domaine. Le socle de sécurité impose Zod *aux frontières* ; il ne l'interdit pas au centre.

12. [ ] **Implémenter cette liste** dans `tooling/eslint/boundaries.ts`, et la prouver sur l'arborescence de fixtures de s02 : un `domain` important `drizzle-orm` échoue, un `domain` important `zod` passe. Sans preuve par violation réelle, la règle est inerte — c'est la leçon mesurée de s02.

**Conséquence héritée de s02, à connaître** : l'exception de lint pour les tests reste **étroite** (`packages/*/src/`). Les tests d'un module sont donc soumis à ses règles de couches : un test de `domain` ne peut pas importer `infrastructure`, même pour se fabriquer une doublure. Si le premier module réel rend cette contrainte intenable, elle se lève par ADR — pas en élargissant discrètement un glob.

## Run interdicts

- **Ne pas anticiper s04** : ni composition des migrations, ni fichier baril, ni `drizzle.config.ts` modifié. Le contrat déclare `schema` et `migrations` ; il ne les assemble pas.
- **Ne pas anticiper s05** : ce code **lit** `config/features.ts`, il ne l'édite jamais.
- **Aucune commande de nettoyage de tables**, sous aucun nom — ce serait `eject`, au cimetière du PRD.
- **Pas de Hono ni d'oRPC** : le montage des routes se fait avec ce qui existe à ce stade ; la couche API a sa story.
- **Aucun module applicatif réel** (auth, billing…) : seulement les deux modules de démonstration.
- **Ne pas régresser** : les tests de s01 et s02 restent verts, la règle de frontières s'applique aux modules de démonstration.
- Ne pas modifier `docs/` hors les cases de ce plan. Ne pas toucher au remote git.

## The point everything turns on

**La forme du contrat, et le fait que la contrainte soit portée par le compilateur.**

Quarante-deux stories viendront s'y conformer. Deux erreurs coûteuses, et où les vérifier :

- **Un champ manquant.** Comparer la liste des clés avec `docs/architecture.md` (section « Le contrat de module ») **et** avec les besoins déjà connus : `purge` et `export` pour s34/s35, `retention` pour s34, `emails` avec leurs locales pour s09, `requires` pour s37 et les plugins. Un champ ajouté plus tard oblige à rouvrir chaque module écrit entre-temps — l'erreur que le PRD a déjà payée trois fois.
- **Une contrainte dégradée en vérification d'exécution.** Le critère dit « erreur de compilation » pour un identifiant inconnu. Si `config/features.ts` finit typée `string[]`, la promesse est perdue sans que rien n'échoue. Comparer le comportement réel : introduire un identifiant inexistant doit faire échouer `pnpm typecheck`, pas seulement le démarrage.
- **La protection des routes oubliée.** Sans elle, chaque module réinventera sa garde et le §3 du socle de sécurité deviendra invérifiable. Comparer avec `docs/security.md` §3.

## Files touched

```
packages/core/{package.json,AGENTS.md,tsconfig.json}
packages/core/src/{module.ts,registry.ts,validate.ts,index.ts}
packages/modules/demo-enabled/**  (quatre couches + AGENTS.md)
packages/modules/demo-disabled/** (idem)
config/features.ts
apps/web/** (navigation et montage des routes)
tests/module-registry.test.ts, tests/module-off.test.ts
```

## Test strategy

- **Unitaire** : validation de configuration (identifiant inconnu, requis manquant, cycle, auto-référence), construction du registre, ordre dérivé du graphe.
- **Typage** : un identifiant inexistant dans `config/features.ts` fait échouer `pnpm typecheck` — vérifié par mutation, puisque `expectTypeOf` seul ne suffit pas.
- **Intégration** : URL d'un module non activé → 404 ; navigation rendue ne contenant pas son entrée ; `purge`/`export` non appelés.
- **Double exécution de la suite** : une fois avec le module de démonstration activé, une fois sans, les deux vertes.

## Definition of Done

- Les huit critères satisfaits, chacun couvert par un test.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` passent ; `pnpm test:e2e` passe.
- §3 de `docs/security.md` couverte par la déclaration de protection des routes.
- Aucun interdit violé.
- Un commit sur `dev`, message impératif en français.
- Revue en contexte frais passée.
