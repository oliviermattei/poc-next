# Research — Story s68-recettes-paralleles

> Vérifiée contre la branche par défaut au commit `1a5ffa9`, en lecture seule. Rien n'a été exécuté ; les défauts sont ceux observés par les implémenteurs de s62a et s67, lancés en parallèle le 28/09.

## The five structuring facts
1. **Les chemins fixes viennent de la CI, pas des scripts** : `.github/workflows/ci.yml` écrit `git status --porcelain > /tmp/arbre-attendu.txt` (étape « Photographier l'arbre après configuration », ~l. 108) puis compare à `/tmp/arbre-constate.txt` (étape « L'arbre reste propre après le build et les parcours », ~l. 171-172). `pnpm test:socle` **rejoue** ces étapes `run:` telles qu'écrites (dérivées du workflow, s48) : deux exécutions simultanées sur le même poste partagent `/tmp`.
2. **La recopie de l'arbre de travail est dupliquée dans trois scripts** et manque ce qui est **indexé** : `scripts/socle.ts` (fonction `cloneRepository`, `ls-files --modified --others --exclude-standard` puis `ls-files --deleted`), et la même logique dans `scripts/minimal-profile.ts:126` et `scripts/golden-path.ts:102`. `--modified` compare l'arbre à l'**index**, pas à `HEAD` : un fichier ajouté ou renommé par `git mv`, ou une modification indexée identique à l'arbre, n'y paraît pas, alors que le clone part de `HEAD`.
3. **La bonne source est `HEAD` contre l'arbre** : `git diff --name-status --no-renames HEAD` (modifié, ajouté, supprimé, indexé ou non) plus `ls-files --others --exclude-standard` (non suivi). `--no-renames` transforme un renommage en suppression + ajout, ce que la recopie sait déjà faire.
4. **Le port des parcours** : `scripts/socle.ts` ne fixe pas de port ; le webServer de Playwright prend `E2E_PORT` (défaut 3100, `playwright.config.ts:23`). La copie de s67 a occupé 3100 pendant qu'une autre recette en avait besoin : une recette doit hériter d'`E2E_PORT` ou réserver un port libre, et l'écrire dans sa sortie.
5. **La dérivation des étapes est tenue** (s48) : toute étape `run:` du job est rejouée ou exclue avec une raison écrite ; changer le texte des deux étapes de photographie de l'arbre reste dérivé, à condition que la recette fournisse la variable utilisée (ex. `RUNNER_TEMP`) dans l'environnement du rejeu.

## Target story
Voir `docs/stories.md`, s68 : états de l'arbre écrits dans un dossier propre à l'exécution ; les trois recettes reproduisent un arbre avec renommages indexés, suppressions et non suivis ; dérivation des étapes intacte.

## Anchor points
- `.github/workflows/ci.yml` : `/tmp/arbre-*.txt` → `"$RUNNER_TEMP/arbre-*.txt"` (défini par GitHub Actions sur ses runners).
- `scripts/socle.ts` : fournir `RUNNER_TEMP` (un `mkdtempSync` propre à l'exécution) à l'environnement des étapes rejouées.
- Un module commun pour la recopie (ex. `scripts/working-tree.ts`) consommé par les trois recettes, à la place des trois copies.
- `scripts/socle-rules.ts` et ses tests : la dérivation et le refus d'une étape non classée.

## Traps & constraints
- **Ne pas recopier une liste d'étapes** (règle de s48) : seule la variable change dans le workflow, la dérivation reste.
- **Un test de recopie crée un vrai dépôt temporaire** (`git init`, un commit, puis `git mv`, suppression indexée, fichier non suivi) et compare l'arbre copié au sien ; il ne doit pas toucher le dépôt courant (les recettes refusent un arbre modifié).
- La CI tourne sous Ubuntu : `$RUNNER_TEMP` y existe ; en local, la recette doit la définir, sinon `"$RUNNER_TEMP/…"` devient `/arbre-…` à la racine.

## Open questions
Aucune qui bloque le plan.

## Real complexity
Cotée **2**, confirmée **2** : deux lignes de workflow, une variable fournie au rejeu, une fonction de recopie factorisée et testée.
