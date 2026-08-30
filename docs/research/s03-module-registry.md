# Research — Story s03-module-registry

## The five structuring facts

1. **C'est la story dont dépendent les quarante-deux suivantes.** Le PRD en fait son angle n°1, l'ADR 007 en fixe le contrat, et la revue des stories a écrit trois fois que ce qui est transverse se déclare au contrat, jamais vingt stories plus tard. Le contrat inclut donc dès maintenant : `id`, `requires`, `schema`, `migrations`, `routes`, `navigation`, `messages`, `emails`, `webhooks`, `purge`, `export`, `retention`.
2. **La moitié « composition de schéma » livrée par s01 est du décor et le sait.** `composeSchema` préserve désormais le typage (correctif N3 de la revue de s01), mais `drizzle-kit` ne voit pas les tables qu'elle compose : `prepareFromExports` n'inspecte que les exports de premier niveau et ne descend dans aucun objet — vérifié dans `drizzle-kit@0.31.10/bin.cjs:16727`. **Un fichier baril réexportant les tables à plat est le chaînon manquant, et c'est s04 qui le doit**, pas s03.
3. **Le registre doit refuser une configuration incohérente à la compilation, pas à l'exécution.** C'est la contrepartie de la déclaration `requires` : activer la roadmap sans le back-office doit échouer en nommant le module manquant. Sans cela, la promesse « une combinaison incohérente est refusée » retombe sur la discipline, exactement ce que le PRD reproche à MakerKit.
4. **Deux modules de démonstration sont un livrable, pas un artifice de test.** Le seul moyen de prouver qu'un module non activé ne laisse ni route, ni navigation, ni table est d'en avoir un activé et un autre non. Ils servent ensuite de gabarit au générateur de squelette (s41) et de fixture permanente à la recette de modularité (s26).
5. **La sémantique de désactivation est déjà tranchée et ne se rediscute pas** : un module jamais activé n'a jamais joué ses migrations, ses tables n'existent pas ; un module activé puis désactivé conserve tables et données, parce que les supprimer serait `eject`, au cimetière du PRD. Aucune commande de nettoyage ne doit apparaître.

## Target story

`s03-module-registry` — complexité annoncée 4, dépend de s02. Huit critères : contrat typé complet, `config/features.ts` typée avec identifiant inconnu refusé à la compilation, `requires` validés, module non activé sans route (404) ni entrée de navigation, `purge`/`export` non appelés pour un module absent, deux modules de démonstration prouvant chaque comportement, suite verte dans les deux états.

## Current state of the code

Après s01 et s02, le dépôt possède : `packages/config` (environnement, entrée serveur séparée), `packages/db` (client, `composeSchema` générique, `runMigrations` acceptant `migrationsTable`/`migrationsSchema`), `apps/web` (App Router, `/api/health`), un harnais Vitest + Playwright, un lint de frontières de couches, une CI.

**Ce qui manque entièrement** : `packages/core` (le registre lui-même), `config/features.ts`, toute notion de module.

Deux acquis de s01 sont directement réutilisables et ne doivent pas être réécrits :
- `composeSchema<T>` accepte déjà une liste de schémas de modules et en préserve le type.
- `runMigrations({ migrationsFolder, migrationsTable, migrationsSchema })` permet un dossier et un journal **par module** — c'est exactement ce dont s04 aura besoin.

## Anchor points

| À créer | Rôle |
|---|---|
| `packages/core/src/module.ts` | Le type `ModuleDefinition` et ses types satellites (`ModuleId`, `DataCategory`, `RetentionPolicy`) |
| `packages/core/src/registry.ts` | Construction du registre depuis la configuration : résolution des `requires`, agrégation des routes, de la navigation, des traductions, des emails, des webhooks |
| `packages/core/src/validate.ts` | Validation de la configuration, erreurs nommant le module fautif |
| `config/features.ts` | Liste des modules activés, éditée par le propriétaire du projet |
| `packages/modules/demo-enabled/`, `demo-disabled/` | Les deux modules de démonstration |
| `apps/web` | Consommation du registre pour la navigation et le montage des routes |

## Verified APIs / functions

À vérifier **dans les paquets installés** au moment de l'implémentation, jamais depuis la documentation en ligne — c'est le piège qui a failli coûter s01 :

- `composeSchema` et `runMigrations` : signatures actuelles dans `packages/db/src/`.
- Le typage `const` des génériques TypeScript 7 pour préserver les littéraux de `config/features.ts` (`<const T extends readonly ModuleId[]>`).
- Le mécanisme de 404 d'App Router pour une route non montée : `notFound()` contre absence de fichier — **ce ne sont pas la même chose**. Le critère demande qu'aucune route ne soit exposée, ce qui est plus fort qu'une route qui répond 404.

## Traps & constraints

- **La contrainte à la compilation est le point dur.** « Un identifiant inconnu provoque une erreur de compilation » et « activer un module sans ses requis fait échouer la validation » ne sont pas la même exigence : la première est du typage, la seconde peut être une validation au démarrage. Ne pas confondre, et ne pas dégrader la première en seconde par facilité.
- **`requires` crée un graphe.** Il faut détecter les cycles et refuser un module qui se requiert lui-même, sinon la construction du registre boucle.
- **Ne pas anticiper s04.** La composition des migrations par module et le fichier baril appartiennent à s04. s03 déclare `schema` et `migrations` au contrat ; il ne les assemble pas.
- **Ne pas anticiper s05.** Le CLI de bascule est une story distincte ; s03 n'édite pas `config/features.ts`, il la lit.
- **La règle de frontières de s02 s'applique aux modules de démonstration** : ils doivent respecter les quatre couches, sinon ils enseigneront le mauvais modèle au générateur et aux agents.
- **`AGENTS.md` par package** (ADR 013) : `packages/core` et chaque module de démonstration doivent porter le leur, sous peine de faire échouer le test de s02.
- **Socle de sécurité** : une route montée par un module est une route publique tant qu'elle n'est pas protégée. Le registre doit rendre explicite, dès le contrat, si une route exige une session — sinon chaque module réinventera sa protection et le §3 de `docs/security.md` sera invérifiable.

## Open questions

1. **Le contrat porte-t-il la protection des routes ?** Recommandation : oui, un module déclare pour chaque route si elle est publique, authentifiée ou réservée à un rôle. Cela rend le §3 du socle de sécurité vérifiable par le registre plutôt que par relecture.
2. **`config/features.ts` liste-t-elle des identifiants ou importe-t-elle les modules ?** Une liste d'identifiants est plus lisible mais exige un annuaire ; des imports directs sont plus sûrs mais couplent la configuration au disque. À trancher au plan.
3. **Où vivent les modules de démonstration à terme ?** Sous `packages/modules/` comme les vrais, ou sous `tests/fixtures/` ? Recommandation : sous `packages/modules/`, parce qu'ils doivent être exercés par la CI comme de vrais modules et servir de gabarit au générateur.
4. **La navigation agrégée est-elle typée par module ?** Impacte s08, déjà livré à ce stade.

## Real complexity

**Verdict : 4**, conforme au score annoncé, avec un risque supérieur à la moyenne des 4.

La difficulté n'est pas la quantité de code — le registre tient en quelques centaines de lignes — mais le fait que chaque décision prise ici devient irréversible en pratique : quarante-deux stories viendront s'y conformer. Les trois endroits où une erreur coûte le plus : la forme du contrat (un champ oublié se paie en rouvrant tous les modules), la contrainte à la compilation (dégradée en validation d'exécution, elle perd sa force), et la déclaration de protection des routes (absente, elle rend le socle de sécurité invérifiable).

Pas de découpage : le verdict n'est pas 5, et le découpage naturel — registre d'un côté, migrations par module de l'autre — a déjà été appliqué en séparant s03 de s04.
