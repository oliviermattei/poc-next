# packages/modules/mcp-server — règles locales

Le serveur MCP (s41) : une **seconde façade** sur le moteur de `packages/cli`, jamais une
seconde implémentation (voir `packages/cli/AGENTS.md`, ADR 040). Il n'expose aucune route web —
c'est un process à part, lancé en `stdio` par le client qui le pilote — donc son contrat de
module (`src/module.ts`) déclare les 13 clés d'ADR 007 vides à l'exception de `id`.

## Ce qui décide ce package

- **Aucune règle métier ici.** `src/server.ts` appelle `planToggle`, `planScaffold`,
  `runList`, `applyToggle`, `applyScaffold` de `@repo/cli` — jamais une réimplémentation. Le
  test `src/server.test.ts` en fait un invariant direct : `list_modules` doit rendre exactement
  ce que `runList` rend sur la même configuration.
- **La garde de dépôt propre est systématique sur les deux outils qui écrivent**
  (`toggle_module`, `scaffold_module`), jamais sur `list_modules`, qui ne modifie rien.
  `assertRepositoryClean` (`@repo/cli`, ADR 041) refuse **avant** toute lecture de
  `config/features.ts` par le toggle ou tout calcul de plan par le scaffold.
- **Aucun chemin arbitraire.** Le serveur ne reçoit jamais de chemin de fichier depuis son
  appelant : `toggle_module` prend un `moduleId`, `scaffold_module` aussi — c'est
  `packages/cli` qui calcule `packages/modules/<id>` à partir d'un identifiant validé en
  kebab-case. Un outil qui accepterait un chemin serait une porte hors du dépôt.
- **Aucun secret dans une réponse ni un journal.** Les trois outils ne renvoient que des
  identifiants de module, des chemins de fichiers relatifs au dépôt, et les messages de refus
  du moteur — jamais le contenu de `.env`.
- **`src/bin.ts` est le seul point de composition** : le seul fichier qui lit
  `config/features.ts`, lance `pnpm db:generate` / `pnpm db:migrate`, ou construit un
  transport. Refuse de démarrer si `mcp-server` n'est pas dans `enabledModules`, **avant** de
  construire quoi que ce soit (critère 7). Ce n'est pas qu'une intention : `src/` étant plat,
  la règle de frontières d'ADR 006 ne classe aucun de ces fichiers et ne peut rien leur
  refuser — ADR 042 acte l'exemption et la remplace par une garde exécutable
  (`tests/lint-rules.test.ts`), qui refuse `node:child_process`, un transport `stdio` et
  l'`import()` dynamique partout ailleurs dans `src/`.
- **Un sous-processus n'écrit jamais sur `stdout`.** `stdout` est le canal JSON-RPC du
  transport `stdio` : la sortie de `pnpm db:generate` part sur `stderr` (descripteur `2` du
  parent), sans être supprimée. `src/bin.test.ts` pilote le binaire en `stdio` brut, appelle un
  outil qui écrit, et refuse la moindre ligne non-JSON sur le canal.
- **Le baril (`src/index.ts`) n'exporte que le contrat.** `config/features.ts` l'importe, et
  `apps/web` importe `config/features.ts` : tout ce qui sort du baril entre dans le bundle
  serveur de l'application. Réexporter `createMcpServer` y tirait le SDK MCP (5,9 Mo),
  module activé comme désactivé, sans consommateur.

## Imports autorisés

- `@repo/cli` (exports le moteur depuis s41, `src/index.ts`) — jamais `@repo/cli/bin` ou un
  accès direct à `config/features.ts` depuis ailleurs que `src/bin.ts` ;
- `@repo/core` pour le contrat de module ;
- `@modelcontextprotocol/sdk` (serveur, transport stdio, client — ce dernier seulement dans les
  tests) ;
- `zod` pour valider les entrées des outils et l'exemple de configuration client ;
- `@repo/typescript-config` pour la configuration du compilateur.

## Ne doit jamais contenir

- de réimplémentation de `planToggle`, `missingRequirements`, `resolveEnabledModules` ou de la
  génération du squelette — c'est exactement ce que `@repo/cli` centralise ;
- de commande de nettoyage des tables d'un module désactivé (ADR 016, cimetière du PRD) ;
- de route Hono, de composant React ou d'entrée de navigation : ce module n'en a pas.

## Tests

`src/**/*.test.ts`. `src/server.test.ts` relie un vrai client MCP au serveur par un transport en
mémoire (le SDK n'est jamais doublé, seul le réseau l'est). `src/bin.test.ts` lance le vrai
exécutable sur un dépôt temporaire, désactivé puis activé, en parlant `stdio` à un vrai client —
et une fois en `stdio` brut, pour classer chaque ligne reçue sur le canal du protocole.
La frontière du module-processus (ADR 042), elle, se vérifie depuis `tests/lint-rules.test.ts`,
à côté des cas qui prouvent ADR 006 : elle porte sur l'arborescence, pas sur ce package seul.
