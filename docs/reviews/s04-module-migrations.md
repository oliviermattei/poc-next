# Revue — s04-module-migrations

Contexte : `dev`, commit unique `396dc4f` (29 fichiers, +1241/−56). Revue en contexte frais. Toutes les commandes ont été exécutées par le relecteur.

## Ce qui a été exécuté

| Commande | Résultat |
|---|---|
| `pnpm typecheck` / `lint` / `build` / `run audit` | verts |
| `pnpm test` | 186 tests / 12 fichiers ; les 3 tests base réelle **s'exécutent**, ils ne se skippent pas |
| `pnpm test:e2e` | 6 verts |
| `pnpm db:generate` | `1 tables / demo_items`, arbre propre |
| `pnpm db:migrate` ×2 | 2ᵈ passage : journal toujours à 1 entrée, ligne insérée intacte |
| `db:migrate` sur base **neuve** (sans schéma `drizzle`) | `demo_items` + son journal, **rien d'autre** |
| Suite, deux modules activés | 4 rouges (3 dans `module-off.test.ts`, 1 = la garde de divergence qui mord) |
| Clé de cache Turborepo | hachage modifié après édition d'un baril : **couverte** |

## N3 est mort, et j'ai reproduit le symptôme

Vérifié dans le binaire installé : `prepareFromExports` fait `Object.values(exports).forEach(...)`, aucune descente dans un objet. Éprouvé sur la **même** table avec le **même** binaire :

- agrégat (`export const appSchema = { demoItems }`, la forme de `composeSchema`) → **`0 tables`** ;
- réexport à plat (la forme du baril) → **`1 tables`**, SQL produit.

`db:generate` annonce `1 tables`, exactement ce que `demo-enabled` déclare. **N3 est fermé, et le baril en est la cause.**

## Les quatre points durs

**1. Le baril ne peut pas mentir.** Versionné, `generated/**` en `globalDependencies` — éprouvé sur le calcul de hachage, pas sur le texte. Éditer `config/features.ts` sans régénérer fait rougir la suite. Réserve en F3.

**2. Isolation lue dans le schéma réel.** Sur une base créée vide — le cas que `virginDatabase()` ne couvre pas, puisqu'il recrée le schéma — `db:migrate` produit `public.demo_items` et rien de `demo-disabled`, **alors que ce module livre de vraies migrations sur disque**. C'est ce couple qui rend la preuve non vacante. `listDatabaseTables` est **réutilisable tel quel par s26**, avec une réserve en fin de revue.

**3. Idempotence et non-destruction.** Cycle complet à la main : activer `demo-disabled`, migrer, insérer une ligne, désactiver, régénérer, remigrer → table **et donnée** survivent. Aucun `DROP`/`TRUNCATE` dans le SQL versionné, garde mordante.

**4. La garde FK mord.** Référence réelle injectée → sortie 1 avant toute écriture, les deux modules et la table nommés.

## Mutations

| Neutralisation | Rouges |
|---|---|
| Ordre alphabétique au lieu du graphe | **4** |
| Garde FK court-circuitée | **1** |
| `DROP TABLE` ajouté à une migration livrée | **3** |
| Divergence du baril | **4** |
| Colonne ajoutée sans régénérer | **0** ← F3 |

Toutes restaurées, 8 empreintes d'artefacts identiques à la ligne de base.

## Findings

### F1 — major — La règle de clé étrangère contredit trois documents opposables, sans ADR

**Je suis d'accord avec la règle sur le fond. Le problème est qu'elle n'est écrite nulle part où elle fait autorité.**

Vérifié plutôt que lu : `resolveEnabledModules` refuse une configuration où un requis n'est pas activé, en le nommant. Donc si `A` porte une FK vers `B` et déclare `B` dans ses `requires`, `B` **ne peut pas** disparaître sous `A` : la contrainte ne peut pas pendre. L'ordre dérivé du graphe garantit que les tables de `B` existent avant celles de `A`. Et la règle est **dérivée des déclarations**, sans liste en dur — ce que la tâche 6 exigeait. Écrire `const SOCLE = ['auth']` aurait été la liste que le plan interdit, d'autant qu'`auth` n'existe pas et que le contrat ne porte aucun marqueur « socle ».

Ce qui ne va pas : trois documents acceptés disent autre chose.

- `AGENTS.md` racine — « **no foreign key toward an optional module** ». Littéralement : aucune, jamais.
- `docs/architecture.md` § Data model — « les références inter-modules passent par l'identifiant et un port ».
- ADR 007 § Consequences — « une clé étrangère vers un module optionnel le rend **silencieusement** non désactivable ».
- `packages/db/AGENTS.md` — réécrit par ce commit avec la règle permissive.

Le dépôt porte deux règles opposables contradictoires, et la plus permissive est celle d'un `AGENTS.md` de package. Le mot qui sauve la règle livrée est **« silencieusement »** : avec `requires`, le couplage est déclaré et opposé par un message.

**À faire** : un ADR supersédant la clause FK de l'ADR 007, avec l'option stricte explicitement rejetée, et l'alignement d'`AGENTS.md` et du § Data model dans le même commit. Aucun changement de code demandé.

**Risque résiduel que l'argument ne couvre pas** : une FK inter-modules impose un **ordre de purge**. Purger les lignes de `B` avant celles de `A` violera la contrainte. `requires` ne dit rien de cet ordre, et s34/s35 hériteront du problème que la règle stricte évitait.

### F2 — minor — `drizzle.config.ts` est un piège vivant

`out` a été retiré à raison, mais `drizzle-kit` **ne s'en plaint pas** : il se rabat sur `./drizzle` relatif au répertoire courant. Exécuté depuis la racine, la commande la plus naturelle produit un dossier `drizzle/` fusionnant les tables de tous les modules — exactement l'artefact que le critère 1 supprime. La CI l'attrape (dossier non suivi), donc rien de faux ne part ; mais l'outil n'avertit de rien.

Second point : le commentaire affirme que `generate.ts` importe le fichier pour « le dialecte, la casse **et la vue agrégée** ». Seuls `dialect` et `casing` sont lus. La clé `schema` ne sert qu'à cette invocation-piège.

### F3 — minor — Le message de commit surestime la garde

Il affirme que « la suite de tests et la CI » échouent sur toute divergence. Mesuré : une colonne ajoutée à un schéma de module sans régénérer laisse `pnpm test` **186/186 vert** ; seul `db:generate` (donc la CI) l'attrape. La garde de la suite porte sur le **baril**, pas sur le **SQL**. Conséquence pratique : une suite verte en local **n'est pas** un signal que les migrations sont à jour.

### F4 — minor — `db:migrate` annonce « appliquées » quand rien ne l'a été

Second passage : « Migrations appliquées, dans l'ordre du graphe : demo-enabled » alors que le journal reste à 1 entrée. Sémantique héritée de s01, mais s04 en fait la ligne de rapport de déploiement module par module — et c'est là qu'un « appliquées » faux masque le seul événement qu'on cherche. `db:generate`, lui, dit correctement « nothing to migrate ».

### F5 — minor — La garde FK indexe par nom physique de table, dernier écrivain gagnant

`ownerOfTable.set(getTableConfig(table).name, module.id)` sans refus de doublon, et rien n'interdit à deux modules de déclarer la même table physique — `composeSchema` détecte les collisions de **nom d'export**, pas de nom de table. Conséquences : attribution de propriétaire fausse (donc une FK interdite qui passe), et deux `CREATE TABLE` dont le second échoue au déploiement. Correctif d'une ligne : échouer quand `ownerOfTable` porte déjà le nom.

### F6 — minor — La garde FK n'est jamais exercée sur les modules réels

Elle n'est appelée que depuis `generate.ts`. La suite l'éprouve sur des modules synthétiques, jamais sur `availableModules`. Une FK interdite dans un vrai module laisse `pnpm test` vert. Un `it` d'une ligne déplacerait le signal avant le push.

### F7 — minor — `tests/module-off.test.ts` n'est pas agnostique, et son en-tête prétend le contraire

Avec les deux modules activés, 3 tests échouent. **Ce n'est pas une régression de s04** — le fichier vient de s03 et n'est pas touché. Mais son en-tête affirme mot pour mot que « toutes les assertions sont vraies **dans les deux états** », ce que l'exécution dément.

**Faut-il que la suite soit agnostique ? Oui, et ce fichier montre qu'il sait le faire** : ses deux derniers tests construisent leur propre registre au lieu d'observer le registre ambiant. Les trois qui échouent utilisent le registre de l'application. Les faire passer par un registre local est un changement de quelques lignes, sans perte : le module exclu resterait exclu **par construction du test**.

**Ce que ça coûte à s26** : la recette devra exécuter la suite sous plusieurs configurations. En l'état, s26 devra exclure ce fichier ou tolérer des rouges connus — c'est-à-dire introduire une liste d'exceptions dans la recette même qui prétend prouver la modularité. À traiter avant s26.

## Les déviations, jugées

**Baril à la racine — accepté, argument à corriger d'un mot.** Le cycle est **prospectif, pas actuel** : aucun module ne dépend aujourd'hui de `@repo/db`. Mais l'architecture planifie des repositories Drizzle dans `infrastructure/`, donc le cycle est certain dès le premier module qui persiste. L'emplacement est le bon ; la justification devrait dire « fermerait un cycle dès qu'un module persistera ».

**Un baril par module — accepté, exclusivité vérifiée.** Le refus est réel : `You can't use both --config and other cli options for generate command`. Et l'exclusivité tient indépendamment : un baril unique écrirait les tables de tous les modules dans le dossier d'un seul.

**`out` retiré, `packages/db/drizzle/` supprimé — accepté.** Le dossier ne contenait qu'un journal vide, aucun SQL.

**`migrations` en chaîne relative — accepté**, et pour une raison plus simple que celle avancée : une chaîne relative à la racine ne dépend ni du répertoire courant, ni du bundling, ni de la position du fichier.

**Le piège du `--out` absolu — réel**, reproduit : `ENOENT: .//Users/…/meta/0000_snapshot.json`. Première génération réussie, seconde en échec. La recherche l'avait bien manqué.

## Les sept critères

| # | Verdict |
|---|---|
| 1 Schéma et migrations par module | **prouvé** |
| 2 `db:migrate` n'applique que les activés | **prouvé** sur base réellement neuve |
| 3 Aucune table d'un module non activé | **prouvé** — `information_schema`, et `demo-disabled` a de vraies migrations, donc la preuve n'est pas vacante |
| 4 FK refusée à la génération | **prouvé** ; sémantique en F1 |
| 5 Activer un module ne touche pas les autres | **prouvé, mais par moi, pas par la suite** — empreintes inchangées. Aucun test ne l'asserte |
| 6 Activé puis désactivé conserve tables et données | **prouvé**, données en main |
| 7 Les démonstrateurs prouvent ces comportements | **prouvé avec réserve** — 5 et « `db:generate` voit N tables » ne sont assertés par aucun test |

`docs/reliability.md` §4 : **couverte**. Aucun interdit violé, `config/features.ts` intact dans le commit, `docs/` modifié seulement par les huit cases du plan.

## Ce que je n'ai pas pu vérifier

- **La CI n'a jamais tourné.** **Geste** : pousser, lire un run entier, vérifier spécifiquement que c'est l'étape « arbre propre » qui rougit quand `db:generate` produit quelque chose — seul filet contre F3.
- **Aucun clone neuf.** **Geste** : cloner dans `/tmp`, installer, générer, exiger un arbre propre.
- **Un seul PostgreSQL local.** Jamais éprouvé contre un provider managé, ni avec un `search_path` non-`public`, ni avec un rôle privé de `CREATE SCHEMA` — or Drizzle crée le schéma `drizzle`, et c'est la première chose qui casse sur une base verrouillée.
- **La concurrence.** Deux `db:migrate` simultanés non exercés, aucun verrou consultatif partagé entre journaux.
- **La réutilisation par s26** : `listDatabaseTables` est réutilisable, mais s26 aura besoin de **quel module possède quelle table** — cette carte n'existe que dans une variable locale non exportée. Même besoin que F5.
- **Résidu hors périmètre** : `enabledModuleSchemas = []`, donc `createDatabaseClient` construit Drizzle avec un schéma relationnel **vide** — `db.query.demoItems` est indisponible alors que la table existe. Assumé sur place, mais le premier module qui persistera rencontrera au **runtime** le cycle que le baril résout à la **génération**.

## Verdict

Le cœur est solide et éprouvé plutôt que lu : N3 fermé avec reproduction du symptôme sur le même binaire, isolation prouvée sur une base réellement neuve, idempotence et non-destruction constatées données en main, garde FK mordant sur une référence réelle, quatre invariants neutralisés un par un. Aucun bug ne part, aucune API inventée.

Ce qui reste est un problème de règles écrites, pas de code : la sémantique de clé étrangère livrée est meilleure que la règle littérale du dépôt, mais elle contredit `AGENTS.md`, `docs/architecture.md` et l'ADR 007 sans l'ADR qui la consacrerait.

---

## Addendum — tour de correctifs `364aacc`

> Suite portée à **190 tests**, verts dans les **trois** états : `['demo-enabled']`, `[]`, et les deux activés (ce dernier comptait 4 rouges).

- **F5 fermé** — la garde refuse deux modules déclarant la même table physique, avec un type d'erreur distinct (`DuplicateModuleTableError`) plutôt qu'une réutilisation de l'erreur de clé étrangère : un appelant qui attrape la seconde rapporterait « clé étrangère interdite » pour une faute de propriété.
- **F7 fermé** — les trois tests qui observaient le registre ambiant construisent désormais le leur. Les trois autres continuent d'observer celui de l'application **à dessein** : leurs assertions dérivent d'`enabledModules`, donc valent dans tous les états. En-tête réécrit pour dire ce qui est vrai, et pourquoi cela compte pour s26.
- **F6 fermé** — la garde est exercée sur `availableModules`, pas seulement sur des modules synthétiques.
- **F3 fermé autrement que suggéré, et mieux.** « Lancer `db:generate` et exiger un arbre propre » rougirait sur tout travail légitime en cours : la garde serait désarmée le jour où elle compte. Livré : une **régénération à blanc** dans un cache, comparant les listes de fichiers SQL, sans jamais toucher à l'arbre versionné. La mutation « colonne ajoutée sans régénérer » passe de **0 rouge à 1**.
- **F4 fermé** — `runMigrations` lit la longueur du journal en base avant et après, et rend `{ applied, count }`. Effet de bord révélateur : un test de s01 nommé « puis ne fait rien au second passage » assertait `{ applied: true }` **deux fois**. Il asserte maintenant `{ applied: false, count: 0 }`.
- **F2 fermé** — `drizzle.config.ts` ne déclare plus que `dialect` et `casing` ; invoqué seul, `drizzle-kit` refuse (`Please provide required params: [x] schema`) et n'écrit rien.

**Correction au rapport de revue** : le piège de F2 n'est pas atteignable « depuis la racine » — la commande y échoue faute de `drizzle.config.json`. Il l'est depuis `packages/db`, donc aussi via `pnpm --filter`. Le finding tient, son chemin de reproduction était faux.

**Reste ouvert** : la carte module → table dont s26 aura besoin (même racine que F5), l'ordre de purge imposé par les clés étrangères inter-modules (ADR 018, hérité par s34/s35), `enabledModuleSchemas = []` et `db.query` (premier module qui persiste). Et la liste « non vérifié » de la revue est inchangée : la CI n'a jamais tourné, aucun clone neuf, un seul PostgreSQL local, aucune migration concurrente.

Max severity: major
Ship allowed: yes
