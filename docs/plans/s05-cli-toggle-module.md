---
validated: yes
---
# Plan — Story s05-cli-toggle-module

Branch: `dev`. Research: `docs/research/s05-cli-toggle-module.md`. Validation déléguée par le propriétaire.

## Target story

Le CLI qui industrialise le geste central du produit : activer ou désactiver un module. Neuf critères repris de `docs/stories.md`.

Socles couverts : **`docs/reliability.md` §1** (le toggle est idempotent : deux fois la même commande laisse un seul effet) et **§2** (une commande qui échoue laisse le dépôt dans son état d'origine, jamais entre deux).

## Tasks (ordered)

1. [ ] **`packages/cli`** — package, `AGENTS.md` (ce qu'il peut importer, ce qu'il ne doit jamais contenir), configuration TypeScript, script racine `ks`.
2. [ ] **Édition AST** de `enabledModules` par `ts-morph`, préservant commentaires et formatage. Prouvé par le test « toggle puis toggle inverse rend le fichier **octet pour octet** identique ».
3. [ ] **`ks list`** — modules disponibles, état, requis. Sortie lisible par un humain et par un agent (mode `--json`).
4. [ ] **Validation déléguée** — le CLI appelle `resolveEnabledModules` et traduit son erreur. Aucune réimplémentation : deux vérités divergeraient.
5. [ ] **Activation** — si un requis manque, proposer de l'activer aussi (mode interactif) ou refuser en le nommant (mode non interactif). Puis **régénérer les barils**, sinon la garde de divergence de s04 rend le dépôt rouge.
6. [ ] **Désactivation** — refusée si un module activé en dépend, le dépendant nommé. Informer que **tables et données sont conservées** ; ne proposer aucune commande de nettoyage, sous aucun nom.
7. [ ] **Génération et proposition** — l'activation génère les migrations et **propose** de les appliquer. Ne jamais les appliquer d'office : une commande de configuration ne touche pas une base sans le dire.
8. [ ] **Atomicité** — si la régénération échoue, la configuration est restaurée. Le dépôt n'est jamais laissé entre deux états. Prouvé par un test qui fait échouer la régénération.
9. [ ] **Tests sur dépôt temporaire** — les commandes s'exécutent contre une copie, jamais contre le dépôt courant.

## Run interdicts

- **Aucune commande de nettoyage, de purge de tables ou de suppression de code**, sous aucun nom — ce serait `eject`, au cimetière du PRD (ADR 016).
- **Ne pas réimplémenter la validation du graphe** : `resolveEnabledModules` fait autorité.
- **Ne pas toucher à l'annuaire `availableModules`** : le CLI n'édite que `enabledModules`.
- **Ne pas appliquer de migration sans confirmation explicite.**
- **Ne pas modifier le contrat de module** (s03), ni la génération de barils (s04) — les consommer.
- Pas de Hono, pas d'oRPC, aucun module applicatif réel. `docs/` intouché hors cases de ce plan. Remote git intouché.

## The point everything turns on

**L'atomicité du toggle.** La commande touche trois choses : `config/features.ts`, les barils générés, et éventuellement la base. Si elle en fait deux sur trois puis échoue, elle livre un dépôt que la CI rejette — et l'utilisateur ne saura pas quoi restaurer.

Trois endroits où le vérifier :
- **La régénération échoue** (module au schéma invalide) : la configuration doit être restaurée, et le test doit le constater sur le contenu du fichier.
- **Le toggle est interrompu** entre l'écriture et la régénération : que reste-t-il ? Comparer avec ce que la garde de divergence de s04 exige.
- **Deux exécutions successives** de la même commande : la seconde doit être un refus explicite ou un no-op, jamais un second effet (§1 du socle de fiabilité).

## Test strategy

Tests sur dépôt temporaire (copie de `config/features.ts` et des barils), jamais contre le dépôt courant. Le test d'identité octet pour octet est le seul qui prouve la préservation du formatage. Un test fait échouer la régénération pour prouver la restauration.

## Definition of Done

Les neuf critères satisfaits, chacun couvert par un test. `pnpm typecheck && lint && test && test:e2e && build && run audit` verts, dans les trois états de configuration. Aucun interdit violé. Un commit sur `dev`. Revue en contexte frais passée.
