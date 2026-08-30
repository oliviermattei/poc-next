---
validated: yes
---
# Plan — Story s04-module-migrations

Branch: `dev`
Research: `docs/research/s04-module-migrations.md`
Validation : déléguée par le propriétaire.

## Target story

Chaque module possède ses migrations ; un projet sans le module n'a aucune trace de lui en base. Sept critères repris de `docs/stories.md`. Ferme le finding N3, ouvert depuis s01 et documenté avec exactitude dans `packages/db/src/schema.ts`.

Sections des socles couvertes : **`docs/reliability.md` §4 (migrations et compatibilité)** en totalité — rétrocompatibilité, aucune migration destructive, fichiers SQL versionnés, échec de migration interrompant le déploiement.

## Tasks (ordered)

1. [ ] **Générateur de baril** — produit, depuis `config/features.ts`, un fichier réexportant **à plat** les tables des modules activés. C'est le chaînon manquant : `drizzle-kit` n'inspecte que les exports de premier niveau (`prepareFromExports`, vérifié dans le binaire), donc un agrégat construit à l'exécution lui est invisible.
2. [ ] **Baril committé + garde de divergence** — le fichier est versionné pour qu'un clone neuf puisse générer, et la CI le régénère puis compare : toute divergence échoue. C'est la seule combinaison qui tienne dans les deux sens.
3. [ ] **`drizzle.config.ts` pointe sur le baril**, plus sur `schema.ts`.
4. [ ] **Migrations par module** — un dossier et un journal par module, nom de journal dérivé de l'identifiant de façon stable. Réutiliser `runMigrations({ migrationsFolder, migrationsTable, migrationsSchema })`, livré par s01 et validé en revue comme prévu pour cet usage.
5. [ ] **Ordre d'application dérivé du graphe `requires`** de s03 — jamais l'ordre alphabétique, jamais l'ordre de déclaration. Un module requis voit ses tables créées avant celles de son dépendant.
6. [ ] **Garde de clé étrangère inter-modules** — une référence vers un module optionnel est refusée **à la génération**, en nommant les deux modules. Une référence vers un module du socle (`auth`) est autorisée, et la liste du socle est dérivée de la déclaration, pas écrite en dur.
7. [ ] **Vérification par le schéma réel** — après migration sur base vierge, aucune table d'un module non activé n'existe ; la vérification lit `information_schema`, pas les fichiers de migration. Ce mécanisme sera réutilisé tel quel par s26.
8. [ ] **Non-destruction** — un module activé puis désactivé conserve tables et données ; aucune migration destructive n'est jamais produite.

## Run interdicts

- **Aucune migration destructive, sous aucun prétexte.** Supprimer les tables d'un module désactivé est `eject`, au cimetière du PRD. Ne pas l'implémenter, ne pas l'amorcer, ne nommer aucune commande qui y ressemble.
- **Jamais `drizzle-kit push`.**
- **Ne pas modifier le contrat de module** livré par s03 : cette story le consomme.
- **Ne pas toucher `config/features.ts`** autrement qu'en lecture — l'édition appartient à s05.
- **Aucun module applicatif réel** : les deux modules de démonstration de s03 suffisent aux preuves.
- Ne pas régresser s01–s03. Ne pas modifier `docs/` hors les cases de ce plan. Ne pas toucher au remote git.

## The point everything turns on

**Le baril généré : un artefact qui peut mentir en silence.**

S'il est committé sans garde, il diverge dès qu'un module est activé et personne ne le voit — les migrations d'un module actif ne sont plus générées, et on ne s'en aperçoit qu'en production, table manquante. S'il n'est pas committé, `drizzle-kit generate` ne trouve rien sur un clone neuf.

Trois vérifications :
- **La garde de CI fonctionne-t-elle vraiment ?** Modifier `config/features.ts` sans régénérer doit faire échouer la CI. À prouver en exécutant la commande, pas en la lisant.
- **`drizzle-kit` voit-il réellement les tables du baril ?** Comparer le nombre de tables annoncé par `db:generate` avec le nombre déclaré par les modules activés. Un `0 tables` silencieux est le symptôme exact de N3.
- **La garde de clé étrangère attrape-t-elle le cas réel ?** L'éprouver en écrivant délibérément une référence d'un module de démonstration vers l'autre, et constater le refus avec les deux noms.

## Files touched

```
packages/db/{drizzle.config.ts,src/migrate.ts,src/schema.ts}
packages/db/src/barrel/ (généré) + son script de génération
packages/core/src/ (lecture du graphe requires, si exposition nécessaire)
.github/workflows/ci.yml (garde de divergence)
tests/module-migrations.test.ts, tests/schema-isolation.test.ts
```

## Test strategy

- **Intégration avec base** : migration sur base vierge avec un module activé et l'autre non ; lecture d'`information_schema` ; second passage sans effet ; activation puis désactivation conservant les données.
- **Génération** : `db:generate` produit bien les tables des modules activés ; divergence du baril détectée.
- **Garde de clé étrangère** : référence interdite refusée avec les deux modules nommés ; référence vers le socle acceptée.
- **Ordre** : un module requis migré avant son dépendant, vérifié sur un graphe à trois modules de test.

## Definition of Done

- Les sept critères satisfaits, chacun couvert par un test exécuté contre une base réelle.
- N3 fermé : `db:generate` voit les tables des modules activés.
- §4 de `docs/reliability.md` couverte.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` passent.
- Aucun interdit violé. Un commit sur `dev`. Revue en contexte frais passée.
