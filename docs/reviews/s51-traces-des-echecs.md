# Revue — s51-traces-des-echecs

Diff jugé : `git diff dev...feature/s51-traces-des-echecs` — 4 fichiers.

## Ronde 1

| Commande | Résultat |
|---|---|
| `pnpm test` | **2242 passés / 8 sautés**, deux fois, la seconde après restauration de toutes les mutations |
| `pnpm lint` · `pnpm typecheck` | aucun problème · 28/28 |

### Le défaut, et pourquoi il est resté vert depuis toujours

`upload-artifact` qui ne trouve aucun fichier **n'échoue pas** : `if-no-files-found` vaut `warn` par défaut — le relecteur a récupéré `action.yml` au majeur épinglé pour le vérifier, plutôt que de le croire. L'étape archivait `playwright-report/` alors que Playwright écrit dans `test-results/`. Chaque échec de CI depuis le début a donc produit un artefact vide et une étape verte.

### Table de mutation

| # | Neutralisé | Rouge |
|---|---|---|
| M1 | `TRACES_OUTPUT_DIRECTORY` renommée, **workflow intact** | **1** — c'est elle qui prouve la dérivation et non la duplication |
| M2 | `path: playwright-report/` restauré | **1** |
| M3 | `if-no-files-found: error` retiré | **1** |
| M4 | la dérivation des étapes ne correspond plus à rien | **4**, plancher compris |
| M5 | nom d'artefact sans expansion de matrice | **1** |
| M6 | dérivation de l'étape des parcours seule cassée, balayage toujours à 3 | **3**, plancher vert — pas de vert silencieux |

### La preuve de la tâche 5, reproduite indépendamment

Le relecteur a rejoué le mécanisme **hors du dépôt** — configuration autonome, `trace: 'retain-on-failure'`, une spec qui échoue : Playwright écrit `test-results/…/trace.zip` et ne crée **aucun** `playwright-report/`. Conforme au rapport de l'implémenteur, convention de nommage comprise.

Ce que rien ne rend rejouable : la chaîne *parcours rouge → fichiers sous `test-results/` → artefact non vide* n'est assertée qu'au niveau des déclarations. `pnpm test` ne joue jamais Playwright, et la CI n'a jamais exécuté l'étape corrigée.

### Constats — six mineurs, tous réels

**Un que la story vient de créer.** `if: failure()` est vrai dès qu'une étape quelconque du job a échoué. Avec `if-no-files-found: error`, chaque exécution rouge pour cause de lint, typage, build ou audit gagnait un **second rouge trompeur** — après un e2e vert, `test-results/` ne contient que `.last-run.json`, caché, et `include-hidden-files` vaut `false`. Le test portait pourtant le nom « échoue quand elle n'archive rien, **alors qu'un parcours a rougi** » : il affirmait la sémantique étroite que le code n'avait pas.

**`\Z` dans une expression régulière JavaScript n'est pas une ancre** — c'est le caractère `Z` littéral. Le filet fonctionnait uniquement parce que le fichier ne contient aucun `Z` majuscule : le relecteur les a comptés (zéro).

**Le hachage de datation du plan était faux** : `69f2308` n'est pas sur `dev`. Le vrai socle est `71098e2`, et le décompte « 29 commits plus tôt » du plan correspond exactement. Transcription fautive de ma part, pas mauvaise re-vérification — mais la règle de datation existe pour qu'un lecteur puisse vérifier, et un hachage irrésoluble est pire que pas de hachage.

**Trois résidus documentés** : le nom d'artefact reste `playwright-report-*` (le relecteur note que la justification écrite — « renommer casse les liens des exécutions archivées » — est plus faible qu'elle n'en a l'air, puisque par la prémisse même de la story tous ces artefacts sont vides et que `retention-days: 7` les efface) ; les deux autres téléversements gardent `warn` ; le cas de matrice n'expanse que les clés que le nom cite.

## Ronde 2 — après correction

**Les quatre points corrigés, vérifiés à la source** : `id: parcours` (ci.yml:156), `if: failure() && steps.parcours.conclusion == 'failure'` (:212), `path: test-results/` (:216), `if-no-files-found: error` (:217), et la datation du plan portée à `71098e2`.

L'ancre `\Z` est remplacée par `$(?![\s\S])`, avec au commentaire ce sur quoi la recherche paresseuse se termine et pourquoi ni `\Z` ni `$` avec `m` ne l'expriment.

**La raison pour laquelle le parcours doré garde `warn` est désormais écrite à l'étape** : `keepFailureTraces` (`scripts/golden-path.ts`) sort tôt quand Playwright n'a écrit aucun sous-dossier de trace, donc le dossier peut légitimement manquer sur un échec réel et `error` produirait un faux rouge. Elle n'était consignée nulle part, et une story ultérieure aurait « fini le travail » en introduisant ces faux rouges.

### Ce que l'implémenteur a attrapé lui-même, et qui vaut d'être écrit

**Son premier test pour le bug de l'ancre était décoratif.** Il avait placé le `Z` majuscule *après* la ligne de matrice : le bloc paresseux le contenait encore, et la mutation restait **verte, 6 passés / 0 échec**. Il a réécrit le cas pour exercer les deux formes qui mordent — un job qui termine l'entrée sans aucun `Z`, et un `Z` situé *avant* la ligne de matrice. Rejeu de la même mutation après correction : **1 rouge**.

La position comptait. C'est exactement ce qui rend cette classe de défaut invisible : un test écrit pour attraper un bug précis peut être positionné de façon à ne pas l'attraper.

### Mutations de ronde 2

| Mutation | Rouge |
|---|---|
| condition élargie à `failure()` nu | **1** |
| `path` restauré à `playwright-report/` | **1** |
| `if-no-files-found` retiré | **1** |
| constante renommée, workflow intact | **1** |
| `$(?![\s\S])` → `\Z`, **après** correction du test | **1** (0 avant) |

`pnpm lint` propre · `pnpm typecheck` 28/28, rejoué avec `--force` pour ne pas conclure sur un verdict en cache · `pnpm test` **2244 passés, 8 sautés**.

### Non vérifié

**Aucune exécution de CI.** `if-no-files-found: error`, le téléversement lui-même, la nouvelle condition et la collision de noms de matrice n'ont jamais tourné sur GitHub. La condition est une expression de workflow : rien en local ne peut l'exécuter. Son premier exercice réel sera la première exécution rouge. `pnpm test:e2e` non joué (obstacle `.env`/`PAYMENTS_LOCAL_MODE`, troisième agent à le rencontrer) ; la moitié Playwright a été prouvée par une configuration autonome hors dépôt. `pnpm build`, `test:socle`, `test:golden-path`, `test:minimal-profile` non joués.

Max severity: minor
Ship allowed: yes
