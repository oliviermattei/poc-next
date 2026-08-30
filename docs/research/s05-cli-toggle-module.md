# Research — Story s05-cli-toggle-module

## The five structuring facts

1. **`config/features.ts` porte deux choses, et le CLI n'en édite qu'une.** Depuis s03 (ADR 016), le fichier contient l'**annuaire** (`availableModules`, qui importe chaque module) et la **liste des activés**. Le CLI ne touche jamais l'annuaire : il inverse une entrée dans `enabledModules`. C'est ce qui garde l'édition à une ligne et le fichier lisible à la main.
2. **Un toggle sans régénération casse la CI.** s04 a livré une garde de divergence : le baril versionné doit correspondre à `config/features.ts`. Basculer un module sans régénérer les barils rend la suite rouge. **`ks toggle` doit donc régénérer**, sinon il livre un dépôt cassé à chaque usage — et c'est le geste central du produit.
3. **La validation du graphe existe déjà et refuse en nommant.** `resolveEnabledModules` (`packages/core/src/validate.ts`) rejette un requis non activé, un cycle, une auto-référence, un identifiant inconnu. Le CLI ne réimplémente rien : il appelle, il attrape, il propose. Réimplémenter la validation dans le CLI créerait deux vérités.
4. **Préserver le formatage exige un AST, pas une expression régulière.** Le fichier porte des commentaires explicatifs destinés au propriétaire du projet. `ts-morph` (28.0.0) manipule l'AST TypeScript en conservant le reste du fichier intact. Une réécriture par expression régulière détruirait les commentaires au premier cas non prévu.
5. **La désactivation ne supprime rien, jamais.** Sémantique tranchée depuis s03 et rappelée par l'ADR 016 : un module activé puis désactivé conserve tables et données. Le CLI **informe** de cette conservation ; il ne propose aucune commande de nettoyage, sous aucun nom — ce serait `eject`, au cimetière du PRD.

## Target story

`s05-cli-toggle-module` — complexité 3, dépend de s04. Neuf critères : `ks list` avec état et requis ; `ks toggle` préservant formatage et commentaires ; activation proposant d'activer un requis manquant ou refusant en le nommant ; désactivation refusée si un module actif en dépend, le dépendant nommé ; activation générant et proposant d'appliquer les migrations ; désactivation informant de la conservation des données ; cycle activer/désactiver/réactiver retrouvant les données ; toggle + toggle inverse laissant le fichier identique ; tests sur un dépôt temporaire.

## Current state of the code

`packages/core` : contrat, registre, `resolveEnabledModules`, `assertDeclarationsAreComplete`, `satisfiesProtection`, `visibleNavigation`. `packages/db` : baril généré, `planModuleSchemaBarrels`, `assertNoForbiddenModuleReferences`, `runModuleMigrations`, `listDatabaseTables`. `config/features.ts` : annuaire + `enabledModules` typée, identifiant inconnu refusé à la compilation. Aucun CLI n'existe : pas de `bin`, pas de `packages/cli`.

## Anchor points

| À créer | Rôle |
|---|---|
| `packages/cli/` | Le CLI, son `bin`, son `AGENTS.md` (le test de s02 échoue sinon) |
| `packages/cli/src/edit-features.ts` | Édition AST de `enabledModules` |
| `packages/cli/src/commands/{list,toggle}.ts` | Les deux commandes |
| `package.json` racine | Exposition de `ks` |

## Traps & constraints

- **Le toggle doit être atomique du point de vue du dépôt.** Éditer la configuration puis échouer à régénérer laisse un dépôt incohérent que la CI rejettera. Écrire, régénérer, et restaurer en cas d'échec.
- **`ks toggle` ne doit pas appliquer les migrations sans le dire.** Le critère dit « génère et **propose** d'appliquer ». Appliquer d'office toucherait une base de production depuis une commande de configuration.
- **La sortie doit être lisible par un agent autant que par un humain** (ADR 013) : un mode non interactif est nécessaire, sinon le CLI est inutilisable depuis un agent ou depuis la CI.
- **Le test « toggle + toggle inverse = fichier identique »** est le seul qui prouve la préservation du formatage. Il doit comparer octet pour octet.
- **Ne pas dupliquer la validation** : appeler `resolveEnabledModules` et traduire son erreur.

## Open questions

1. **Quelle bibliothèque de CLI ?** `commander` (15.0.0) est le standard, `citty` (0.2.2) est plus léger, `@clack/prompts` (1.7.0) gère l'interactif. Recommandation : le minimum viable, sans dépendance interactive si le mode non interactif suffit — chaque dépendance doit être justifiée par une story (§6 du socle).
2. **Où vit `ks` ?** Script racine, ou `bin` d'un package publié plus tard. Recommandation : `packages/cli` avec un script racine qui l'appelle, pour que la commande fonctionne sans installation globale.
3. **Le CLI régénère-t-il aussi les migrations ?** Il génère (critère 5) ; appliquer reste une proposition.

## Real complexity

**Verdict : 3**, conforme. Le risque n'est pas dans le CLI mais dans l'atomicité : une commande qui laisse le dépôt entre deux états est pire que pas de commande. Deuxième risque : réimplémenter la validation du graphe et créer une seconde vérité qui divergera.
