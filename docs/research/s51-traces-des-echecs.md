# Research — Story s51-traces-des-echecs

> Vérifiée contre la branche par défaut au commit `ffd8640`, en lecture seule.
> Aucune base, aucun conteneur, aucun worktree.

## Les cinq faits structurants

1. **Le remède existe déjà dans le même fichier, 130 lignes plus bas, avec sa raison écrite.** `.github/workflows/ci.yml:301-308`, pour le parcours doré : « **Pointer `playwright-report/` à la racine ne téléversait jamais rien.** Hors de `test-results/`, qui est l'`outputDir` de Playwright et que `pnpm test:e2e` efface au démarrage. Le chemin est déclaré une seule fois (`FAILURE_TRACES_DIRECTORY`) et `tests/golden-path.test.ts` vérifie qu'il vaut celui-ci. » Le dépôt a donc **déjà appris cette leçon** — et ne l'a appliquée qu'à un endroit.
2. **Le job principal des parcours ne l'a jamais reçue.** `ci.yml:171-177` téléverse toujours `path: playwright-report/`, alors que `playwright.config.ts` produit ses traces sous `test-results/` (`trace: 'retain-on-failure'`, `outputDir` par défaut). L'étape est verte à chaque échec : `upload-artifact` qui ne trouve rien **ne rougit pas**.
3. **Le coût s'est déjà payé, et il est chiffrable.** La tâche 1 du plan de s50 exigeait de lire la trace d'un parcours rouge avant d'y toucher ; elle n'existait pas, et la cause a dû être établie par **huit exécutions locales instrumentées**. Même chose en revue de s30. Chaque diagnostic d'échec de parcours en CI recommence donc par une reproduction locale, depuis que la CI existe.
4. **Le chemin ne doit pas être recopié, il doit être dérivé.** Le motif du parcours doré le fait déjà : une constante déclarée une fois, et **un test qui la confronte au workflow**. Recopier `test-results/` dans le job serait corriger le symptôme et rouvrir la même dérive à la première story qui change l'`outputDir`.
5. **La différence entre les deux étapes tient à ce que le parcours doré travaille dans un clone qu'il détruit** : il **recopie** ses traces avant de supprimer le clone, d'où un dossier distinct. Le job principal, lui, tourne dans l'arbre — il n'a rien à recopier, seulement à pointer le bon dossier. Les deux correctifs ne sont donc pas identiques, et la story doit le dire plutôt que de dupliquer le mécanisme du doré.

## Target story

Quatre critères : un parcours en échec laisse une trace **téléchargeable**, vérifié sur un échec réel ou provoqué · le chemin est **dérivé** de la configuration Playwright, jamais recopié · l'étape **échoue** si elle ne trouve rien alors qu'un parcours a rougi · la garantie vaut pour **les deux** configurations de la matrice.

Dépendance déclarée : `s02-quality-harness` — fusionnée.

## Points d'ancrage

- `.github/workflows/ci.yml:171-177` — l'étape fautive.
- `.github/workflows/ci.yml:301-315` — le motif qui marche, et son commentaire qui explique pourquoi.
- `scripts/golden-path-regime.ts:311` — `FAILURE_TRACES_DIRECTORY`, la constante déclarée une fois.
- `tests/golden-path.test.ts` — le test qui la confronte au workflow : **le modèle de la dérivation à reproduire**.
- `playwright.config.ts:171` — `trace: 'retain-on-failure'`, et l'`outputDir` par défaut.

## Pièges & contraintes

- **Le troisième critère est le cœur de la story, et il est contre-intuitif.** Faire échouer une étape d'archivage quand elle ne trouve rien demande de savoir qu'**un parcours a rougi** — `if: failure()` le donne, mais `upload-artifact` a son propre `if-no-files-found`, dont la valeur par défaut est `warn`. C'est un réglage, pas une invention : le vérifier plutôt que d'écrire une condition à la main.
- **La story touche `.github/`**, que **toutes** les stories récentes s'interdisaient. C'est ici que ce diff est légitime — et c'est la seule story qui puisse le porter.
- **Ne pas confondre les deux étapes** (fait 5) : le doré recopie hors d'un clone détruit, le job principal pointe un dossier vivant.
- **Vérifier sur un échec réel ou provoqué**, dit le critère. Un archivage qu'on n'a jamais vu produire un fichier est exactement le défaut qu'on ferme.
- **La CI est actuellement à l'arrêt au niveau du compte** (voir `docs/STATE.md`) : cette story ne peut pas être vérifiée tant qu'elle ne repart pas. C'est le seul cas du backlog où le blocage empêche la **vérification**, pas seulement le ship.

## Questions ouvertes

- **`if-no-files-found: error` suffit-il ?** Il ferait échouer l'étape quand rien n'est trouvé — mais l'étape ne s'exécute que sous `if: failure()`, donc uniquement quand un parcours a déjà rougi. C'est peut-être exactement le troisième critère, obtenu par un réglage. À vérifier dans la documentation de l'action plutôt qu'à supposer.
- **Comment dériver le chemin ?** Le doré le fait par une constante partagée entre le script et le test. Ici il n'y a pas de script : l'`outputDir` appartient à `playwright.config.ts`. Une constante exportée par ce fichier, confrontée au workflow par un test, est le motif le plus proche.
- **Le troisième critère vaut-il aussi pour l'étape du doré ?** Elle a le bon chemin mais probablement le même `if-no-files-found` par défaut. La story peut fermer les deux ou une seule ; le critère 4 parle des configurations de matrice, pas des deux étapes.
- **Que faire des artefacts déjà nommés `playwright-report-*` ?** Renommer casse les liens des runs archivés ; garder un nom qui ne correspond plus au contenu est le genre d'écart que ce dépôt paye ailleurs.

## Complexité réelle

Notée **1** dans `docs/stories.md`. **Ma note : 2.**

Le correctif de chemin est d'une ligne. Ce qui fait la story, ce sont les deux autres critères : **dériver** le chemin plutôt que le recopier — donc une constante et un test qui la confronte au workflow, sur le modèle du doré — et **faire échouer** un archivage vide, qui demande de vérifier un réglage de l'action plutôt que d'écrire une condition. Plus la vérification sur un échec provoqué, que la CI à l'arrêt rend impossible aujourd'hui.

Pas de proposition de découpe.
