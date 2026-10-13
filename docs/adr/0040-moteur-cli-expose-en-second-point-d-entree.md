# ADR 040 — Le moteur de `packages/cli` s'expose par un second point d'entrée, plutôt que d'être extrait

- Status: accepted
- Date: 2026-09-02

Le serveur MCP (`packages/modules/mcp-server`) expose à un agent les mêmes opérations que le CLI `ks` — lister, basculer, générer un squelette de module — et doit réutiliser sa logique, jamais une seconde implémentation (`packages/cli/AGENTS.md`). Or `packages/cli` n'exposait que sa commande.

`packages/cli` gagne un second point d'entrée, `src/index.ts`, déclaré dans `exports["."]` de son `package.json`. Il réexporte le moteur — tout ce qui reçoit des modules et un environnement en paramètres (bascule, squelette, lecture et écriture de `enabledModules`, `assertRepositoryClean`…) — et rien du point de composition : ni `bin.ts`, ni un accès à `config/features.ts`, ni un sous-processus. `bin.ts` et `mcp-server` consomment ce barril à parts égales, chacun étant le point de composition de sa façade.

## Considered options

- **Extraire un paquet `@repo/module-engine`** — rejeté : déplace quelque 600 lignes finement testées pour un gain surtout cosmétique ; le risque de régression dépasse le bénéfice d'un nom plus pur.
- **Dupliquer la logique dans `mcp-server`** — rejeté : deux implémentations divergeraient au premier cas limite.

## Consequences

`src/index.ts` ne doit jamais réexporter une fonction qui lit `config/features.ts` ou lance un sous-processus : ce serait un second point de composition caché. Une future troisième façade importera le même barril.
