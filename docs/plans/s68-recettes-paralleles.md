---
validated: yes
---
# Plan — Story s68-recettes-paralleles

Branch: `feature/s68-recettes-paralleles`
Research: `docs/research/s68-recettes-paralleles.md` — read it first; this plan does not repeat it.

## Target story
Pouvoir lancer `pnpm test:socle`, `pnpm test:minimal-profile` et `pnpm test:golden-path` depuis deux worktrees en même temps, sur un arbre non commité. Trois critères : `docs/stories.md`, s68. Pas d'écran, pas d'ADR (aucun choix structurant : une variable d'environnement standard et une fonction factorisée).

## Tasks (ordered)
1. [x] **Recopie de l'arbre, factorisée et juste** — nouveau module `scripts/working-tree.ts` : liste les chemins à recopier depuis `git diff --name-status --no-renames HEAD` (ajouté/modifié, indexé ou non) et `git ls-files --others --exclude-standard` (non suivi), et les chemins à supprimer (supprimés, y compris l'ancien nom d'un renommage) ; applique la liste sur une copie. **Test** (`tests/working-tree.test.ts`) : un dépôt temporaire (`git init`, un commit), puis `git mv` indexé, une suppression indexée, une modification indexée, une modification non indexée et un fichier non suivi ; la copie clonée depuis `HEAD` puis recouverte est **identique** à l'arbre (contenu et liste de fichiers). Rouge avec l'ancienne logique (`ls-files --modified --others`).
2. [x] **Les trois recettes l'utilisent** — `scripts/socle.ts` (`cloneRepository`), `scripts/minimal-profile.ts:126`, `scripts/golden-path.ts:102` remplacent leur copie locale par `scripts/working-tree.ts`. **Test** : un test source refuse `ls-files', '--modified'` dans `scripts/` hors du module commun ; `tests/socle.test.ts`, `tests/minimal-profile.test.ts` restent verts.
3. [x] **États de l'arbre propres à l'exécution** — `.github/workflows/ci.yml` : `/tmp/arbre-attendu.txt` et `/tmp/arbre-constate.txt` → `"$RUNNER_TEMP/arbre-attendu.txt"`, `"$RUNNER_TEMP/arbre-constate.txt"` ; `scripts/socle.ts` fournit `RUNNER_TEMP` (un `mkdtempSync` propre à l'exécution, supprimé à la fin) à l'environnement des étapes rejouées. **Tests** : `tests/socle.test.ts` — la dérivation classe toujours chaque étape `run:` (rejouée ou exclue) ; un cas refuse qu'une étape rejouée écrive dans un chemin `/tmp/` fixe (lecture du workflow) ; l'environnement du rejeu porte `RUNNER_TEMP` sur un dossier qui n'est pas `/tmp`.
4. [x] **Port des parcours** — chaque recette prend son port d'`E2E_PORT` s'il est fourni, sinon réserve un port libre (écoute sur `0`, relâché avant le lancement), le passe à Playwright et l'**écrit** dans sa sortie. **Test** : unitaire sur la fonction de choix du port (fourni → gardé ; absent → un port libre, jamais 3100 codé en dur).
5. [ ] **Preuve en parallèle** — lancer **deux** `pnpm test:socle` simultanés, depuis deux copies du dépôt (cette worktree et une copie temporaire créée par `git worktree add --detach` dans le scratchpad, supprimée ensuite, jamais une branche) ; les deux passent. **Vérification** : consignée dans le plan (commande, durées, ports utilisés).
   **Relevé (28/09, poste à 8 cœurs, non coché — critère non tenu sur ce poste)** : `E2E_PORT=3413 pnpm test:socle` dans cette worktree, `pnpm test:socle` sans `E2E_PORT` dans une worktree détachée temporaire du scratchpad (même arbre recopié), lancés ensemble, trois fois.
   - Ce qui est tenu, les trois fois : ports distincts imprimés (3413 fourni ; 55497, 57223, 65159 réservés), étape « Photographier l'arbre » passée sous `$RUNNER_TEMP` propre à chaque exécution, aucune écriture dans l'arbre de travail (« L'arbre de travail modifié » jamais levé), bases distinctes.
   - Ce qui échoue : essai 1 (6 min 15 s) — les deux rougissent aux tests unitaires, délais de 5 s dépassés, s62b lançant ses parcours au même moment (charge 162) ; essai 2 (11 min 5 s, s62b inactif) — tests unitaires 3051 verts des deux côtés, build vert, puis parcours 16 rouges / 103 verts de chaque côté, **sur des cas différents**, tous des délais de navigation ; essai 3 (3 min 43 s) — tests unitaires, 2 délais de 5 s de chaque côté, s62b actif pendant l'étape.
   - Témoin seul : `E2E_PORT=3413 pnpm test:socle` seul, exit 0, 5 min 10 s, 124 parcours verts.
   - Lecture : ce qui reste partagé entre deux exécutions est le processeur ; aucun échec ne porte sur un fichier, un port ou une base partagés.

6. [x] **Documentation** — `AGENTS.md` racine (lignes `test:socle`, `test:minimal-profile`, `test:golden-path` : recopie depuis `HEAD`, port choisi et imprimé, dossier d'exécution propre), `scripts/AGENTS.md` s'il existe ou `tooling/AGENTS.md`. **Vérification** : `tests/agents-md.test.ts`.

## Run interdicts
- Aucune liste d'étapes de CI recopiée : la dérivation depuis `ci.yml` reste la seule source (s48).
- Le dépôt courant n'est jamais modifié par un test : les tests de recopie travaillent dans un dépôt temporaire.
- Pas de `git stash`, pas de `git checkout` de branche ; la copie de la tâche 5 est une worktree **détachée** temporaire, supprimée après usage.
- Aucune étape de CI n'est ajoutée ou retirée.

## The point everything turns on
**« Identique à l'arbre » doit comparer à `HEAD` + arbre réel, pas à l'index.** Le défaut vient de `--modified` qui compare l'arbre à l'index ; le test de la tâche 1 doit donc contenir au moins une modification **indexée** sans reste dans l'arbre et un **renommage indexé**, sans quoi il passe aussi avec l'ancienne logique. À comparer : le test rougit avec l'ancienne fonction (mutation obligatoire en revue).

## Files touched
- `scripts/working-tree.ts` (nouveau), `scripts/{socle,minimal-profile,golden-path}.ts`, `scripts/socle-rules.ts` (si la dérivation en dépend)
- `.github/workflows/ci.yml` (deux lignes)
- `tests/working-tree.test.ts` (nouveau), `tests/{socle,minimal-profile}.test.ts`
- `AGENTS.md` (+ AGENTS.md des outils si présent)
- ce plan

## Test strategy
Unitaires sur un dépôt temporaire (recopie), sur la lecture du workflow (pas de `/tmp` fixe, dérivation intacte), sur le choix du port ; preuve d'exécution parallèle réelle consignée (tâche 5). **Mutations attendues en revue** : remettre `ls-files --modified --others` → `tests/working-tree.test.ts` rougit ; remettre `/tmp/arbre-attendu.txt` dans `ci.yml` → le test de lecture du workflow rougit ; coder le port 3100 → le test du port rougit.

## Definition of Done
- Une PR, un commit de story portant ce plan.
- Les trois critères tenus ; `pnpm typecheck`, `pnpm lint`, `pnpm test`, deux `pnpm test:socle` simultanés verts, `pnpm test:minimal-profile` vert.
- Revue passée ; CI verte sur `tous` et `socle` après merge (le job de CI utilise désormais `$RUNNER_TEMP`).
