# Research — Story s04-module-migrations

## The five structuring facts

1. **Le chaînon manquant est identifié et vérifié dans le binaire.** `drizzle-kit@0.31.10/bin.cjs`, fonction `prepareFromExports` : `Object.values(exports).forEach(t => { if (is(t, PgTable)) tables.push(t) })`. Elle n'inspecte que les **exports de premier niveau** et ne descend dans aucun objet. Un agrégat construit à l'exécution (`composeSchema`) est donc invisible à la génération. C'est le finding N3, ouvert depuis s01 et explicitement renvoyé à cette story.
2. **La solution est un fichier baril généré, pas écrit à la main.** Puisque `generate` lit des exports statiques, il faut un fichier qui réexporte à plat les tables des modules activés — et il doit être **produit** depuis `config/features.ts`, sinon il divergera au premier module ajouté. C'est exactement le genre de fichier qu'un agent oublierait de mettre à jour : il doit être généré et vérifié en CI.
3. **La moitié « exécution » est déjà livrée.** `runMigrations({ migrationsFolder, migrationsTable, migrationsSchema })` existe depuis s01 et a été validée en revue comme « précisément ce qui rendra les journaux par module possibles ». Un dossier et un journal par module sont donc atteignables sans réécrire l'exécution.
4. **La clé étrangère vers un module optionnel est le piège central.** C'est le moyen le plus courant de rendre un module non désactivable sans s'en apercevoir : le schéma compile, les migrations passent, et la promesse de modularité est morte. Le critère l'exige refusée **à la génération**, avec les deux modules nommés.
5. **La vérification doit lire la base, pas les fichiers.** Le critère « aucune table d'un module non activé après migration sur base vierge » se contrôle dans `information_schema` — c'est la seule vérification qui attrape une table créée par un import transitif. La recette de modularité (s26) reprendra le même mécanisme.

## Target story

`s04-module-migrations` — complexité annoncée 3, dépend de s03. Sept critères : schéma et migrations par module, `db:migrate` n'appliquant que les modules activés, aucune table d'un module absent sur base vierge (lu dans le schéma réel), clé étrangère inter-modules refusée à la génération, activation générant les migrations sans toucher aux autres, module activé puis désactivé conservant tables et données, comportements prouvés par les deux modules de démonstration de s03.

## Current state of the code (attendu à l'entrée de la story)

`packages/db` livré par s01 : `client.ts` (point d'entrée unique, pilote encapsulé), `schema.ts` (`composeSchema` générique + commentaire décrivant précisément la limite de `prepareFromExports`), `migrate.ts` (`runMigrations` paramétrable, garde sur journal vide), `seed.ts`, `scripts/`. `packages/core` livré par s03 : contrat de module, registre, validation de configuration.

## Anchor points

| À créer / modifier | Rôle |
|---|---|
| Générateur de baril | Produit le fichier réexportant à plat les tables des modules activés, depuis `config/features.ts` |
| `packages/db/drizzle.config.ts` | Pointe sur le baril généré plutôt que sur `schema.ts` |
| `packages/db/src/migrate.ts` | Itère sur les modules activés, un dossier et un journal chacun |
| Vérification de schéma | Lecture d'`information_schema`, réutilisée par s26 |
| Garde de clé étrangère | Analyse des références inter-modules à la génération |
| CI | Échec si le baril généré diverge de `config/features.ts` |

## Traps & constraints

- **Le baril généré est un artefact versionné qui peut mentir.** S'il est committé, il diverge ; s'il ne l'est pas, `drizzle-kit generate` ne trouve rien sur un clone neuf. Trancher au plan, et faire échouer la CI sur la divergence.
- **Un journal par module change la sémantique de `drizzle.__drizzle_migrations`.** Vérifier qu'un journal par module ne casse pas la détection des migrations déjà appliquées, et que le nom du journal est dérivé de l'identifiant du module de façon stable.
- **Ordre d'application inter-modules.** Un module qui en requiert un autre doit voir ses tables créées après celles du requis. Le graphe `requires` de s03 donne l'ordre ; ne pas se reposer sur l'ordre alphabétique ni sur l'ordre de `config/features.ts`.
- **Socle de fiabilité §4** : les migrations restent rétrocompatibles avec la version en ligne, et désactiver un module ne produit **jamais** de migration destructive — ce serait `eject`, au cimetière.
- **Ne pas anticiper s05** : cette story ne modifie pas `config/features.ts`, elle la lit.

## Open questions

1. **Baril committé ou généré au build ?** Recommandation : généré, committé, et vérifié en CI par régénération suivie d'une comparaison — c'est le seul schéma qui tienne à la fois sur un clone neuf et contre la divergence.
2. **Comment détecter une clé étrangère vers un module optionnel ?** Analyse statique des références du schéma, ou introspection des objets Drizzle à la génération. La seconde est plus fiable, la première plus rapide.
3. **Un module du socle peut-il être référencé par une clé étrangère ?** Recommandation : oui pour `auth` (non désactivable par définition), non pour tout module optionnel — et la règle doit être dérivée du socle déclaré dans `AGENTS.md`, pas écrite en dur.

## Real complexity

**Verdict : 4**, contre 3 annoncé.

Le score de 3 supposait « chaque module range ses migrations dans son dossier ». La réalité est plus dure : il faut un générateur d'artefact, une garde de cohérence en CI, un ordre d'application dérivé d'un graphe, une analyse de références inter-modules, et une vérification qui lit le schéma réel de la base. Aucune de ces cinq pièces n'est triviale, et l'échec de n'importe laquelle rend la promesse de modularité fausse sans le dire.

Pas de découpage : le verdict n'est pas 5, et séparer le générateur de l'exécution laisserait le dépôt dans un état où les migrations par module existent sans être générables — pire que les deux réunis.
