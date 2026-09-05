---
story: s51-traces-des-echecs
validated: yes
---

# Plan — s51-traces-des-echecs

> Planifié contre `dev` au commit `71098e2`. La recherche est datée de `ffd8640`, **29 commits plus tôt** : ses trois prémisses portantes ont été re-vérifiées et **tiennent** — `.github/workflows/ci.yml:184` porte toujours `path: playwright-report/`, **aucun `if-no-files-found` n'existe dans le fichier**, et le motif du parcours doré vit bien aux lignes 311-315 avec sa constante dans `scripts/golden-path-regime.ts:311`.

## Le défaut, et pourquoi il est resté vert

`upload-artifact` qui ne trouve aucun fichier **n'échoue pas** : son `if-no-files-found` vaut `warn` par défaut. L'étape d'archivage du job principal pointe `playwright-report/`, alors que Playwright écrit ses traces dans `test-results/` (`outputDir` par défaut, `trace: 'retain-on-failure'`). Elle est donc verte à chaque échec, en n'archivant rien, depuis que la CI existe.

**Le dépôt a déjà appris cette leçon** — 130 lignes plus bas, pour le parcours doré, avec la raison écrite dans le commentaire. Elle n'a jamais été appliquée au job principal.

## Ce que la story ne recopie pas

Le parcours doré travaille dans un **clone qu'il détruit** : il doit *recopier* ses traces avant la suppression, d'où un dossier distinct et une constante propre. Le job principal tourne dans l'arbre : il n'a rien à recopier, seulement à pointer le bon dossier. **Les deux correctifs ne sont pas le même**, et dupliquer le mécanisme du doré serait une complication sans objet.

## Tâches

- [x] **1. Le chemin est dérivé, jamais recopié.** `playwright.config.ts` déclare son `outputDir` explicitement — aujourd'hui implicite — sous une constante exportée. Un test lit **cette constante** et le `path:` de l'étape d'archivage dans `.github/workflows/ci.yml`, et exige qu'ils coïncident. C'est le motif de `tests/golden-path.test.ts:529-530`, à reproduire et non à inventer. Sans lui, la première story qui change l'`outputDir` rouvre exactement la même dérive.
- [x] **2. L'étape échoue si elle n'archive rien.** `if-no-files-found: error` sur l'étape d'archivage des parcours. C'est un **réglage de l'action**, pas une condition écrite à la main — vérifier sa valeur par défaut (`warn`) et le fait qu'`error` existe, plutôt que de l'affirmer.
- [x] **3. Le plancher : le test refuse une étape sans ce réglage.** Un `path:` juste et un `if-no-files-found` absent redonneraient une étape verte qui n'archive rien. Le test de la tâche 1 doit donc **aussi** exiger le réglage, et rougir s'il disparaît.
- [x] **4. Les deux branches de la matrice.** Le job est gardé par `matrix.modules`, et la garantie vaut pour `socle` comme pour `tous`. Le test dérive les étapes d'archivage du workflow et refuse d'en trouver **moins de deux** — un balayage vide rendrait la vérification verte en ne vérifiant rien, le défaut trouvé en s26 puis en s48.
- [x] **5. La preuve sur un échec réel.** Faire rougir un parcours volontairement, en local, et constater qu'une trace atterrit dans le dossier archivé. Puis restaurer. Le critère demande « vérifié sur un échec réel ou provoqué » : c'est la seule tâche que le test ne peut pas remplacer, parce qu'elle mesure ce que Playwright écrit, pas ce que le workflow déclare.
- [x] **6. Mutation, à l'endroit du défaut.** Remettre `path: playwright-report/` doit faire rougir le test de la tâche 1. Retirer `if-no-files-found: error` doit le faire rougir aussi. Si l'un des deux reste vert, le filet est plus étroit que son nom.

## Ce que la story ne fait pas

Elle ne touche pas au parcours doré, dont l'archivage fonctionne et porte déjà sa dérivation. Elle n'ajoute pas de rapport HTML, ni de publication de trace ailleurs que dans les artefacts de la CI.

## Sections de `docs/security.md` touchées

Aucune. Une trace de parcours peut contenir des jetons de session de comptes de test ; elle reste dans les artefacts privés du dépôt et n'est pas publiée. Rien de nouveau : c'est déjà le régime du parcours doré.
