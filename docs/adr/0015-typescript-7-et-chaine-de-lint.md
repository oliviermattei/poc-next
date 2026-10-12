# ADR 015 — TypeScript 7 pour compiler, TypeScript 6 pour la chaîne de lint

- Status: accepted
- Date: 2026-08-30
- Scope: framing
- Complète l'ADR 011, qu'il ne renverse pas.

## Context
L'ADR 011 a retenu TypeScript 7 et prévoyait un critère de retour arrière : « si `tsc --noEmit` échoue sur du code correct à cause d'une dépendance et non du dépôt, on revient à `^5.9` par un ADR successeur, en nommant le paquet fautif ».

L'implémentation de s02 a rencontré un cas que ce critère n'anticipait pas. `tsc` fonctionne parfaitement en TypeScript 7 sur l'intégralité du dépôt. C'est le **linter** qui refuse de démarrer : `typescript-eslint@8.68` lève `Error: typescript-eslint does not support TS 7.0` et renvoie à sa note officielle recommandant une exécution côte à côte avec TypeScript 6. Sans parser TypeScript, ni la règle de frontières de couches (ADR 006) ni le lint typé n'existent — deux critères de s02 disparaissent.

Le critère de l'ADR 011 visait la compilation. Le blocage est ailleurs : dans l'outillage.

## Decision
Deux versions de TypeScript coexistent, chacune dans son rôle :

- **TypeScript 7** compile le dépôt. `pnpm typecheck` couvre la racine, `tests/`, `scripts/`, `e2e/` et chaque package. L'ADR 011 reste en vigueur, entier.
- **TypeScript 6** est déclaré **dans le seul package `tooling/eslint`**, pour que `typescript-eslint` démarre. Aucun code applicatif n'est compilé avec.

La sortie de ce régime est nommée : `typescript-eslint#10940`. Dès que `typescript-eslint` supporte TypeScript 7, la dépendance de `tooling/eslint` est alignée et cet ADR devient sans objet.

## Considered options
- **Redescendre tout le dépôt en TypeScript 6** — rejeté : le compilateur ne pose aucun problème, et l'ADR 011 est explicite sur le coût de naître une majeure en retard. Sacrifier la compilation pour satisfaire le linter, c'est laisser l'outillage dicter la stack.
- **Renoncer au lint typé** — rejeté : c'est renoncer à la règle de frontières de couches, c'est-à-dire à ce qui sépare l'architecture d'une intention (ADR 006). Le PRD en fait le risque principal du projet.
- **Attendre le support amont avant de livrer s02** — rejeté : bloquerait quarante-trois stories sur un calendrier qu'on ne contrôle pas.
- **Épingler TypeScript 6 à la racine et surcharger par package** — rejeté : inverse la hiérarchie. La version du dépôt doit être celle qui compile le code, pas celle qui arrange un outil.

## Consequences
Facilité : le lint typé fonctionne, la règle de frontières est réellement enforcée, et le dépôt continue de compiler avec la dernière majeure.
Difficulté : deux versions de TypeScript dans le lockfile, et une divergence possible entre ce que le compilateur accepte et ce que le parser du linter comprend. Une syntaxe propre à TypeScript 7 pourrait faire échouer le lint sur du code valide.
À surveiller : cette divergence est le vrai risque. Si elle se manifeste, la réponse est d'aligner l'outillage, jamais de brider la syntaxe du code applicatif. Documenté dans `tooling/eslint/AGENTS.md`.
