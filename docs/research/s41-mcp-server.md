# Research — s41-mcp-server

## Ce qui existe déjà (s05)

`packages/cli` livre `ks list` et `ks toggle <module>` :

- **Moteur** (fonctions pures ou à environnement injecté) : `src/toggle.ts` (`planToggle`,
  `missingRequirements`), `src/modules.ts` (`describeModules`, `renderModuleList`),
  `src/features-file.ts` (lecture/écriture AST-safe de `enabledModules`), `src/apply.ts`
  (`applyToggle`, transactionnel : photographie avant écriture, restauration au premier échec),
  `src/commands.ts` (`runList`, `runToggle`, orchestration au-dessus des précédents).
- **Composition root** : `src/bin.ts` — seul fichier qui lit `config/features.ts` et lance des
  sous-processus (`pnpm db:generate`, `pnpm db:migrate`). Trouve la racine du dépôt en remontant
  depuis `process.cwd()` jusqu'à trouver `config/features.ts`.
- **Aucune écriture hors** `config/features.ts`, `generated/schema/`, et les dossiers
  `migrations/` déclarés par les modules.
- La validation du graphe (requis manquant, cycle, auto-référence, identifiant inconnu, socle
  non désactivable ADR 021) vit dans `@repo/core` (`resolveEnabledModules`) : le CLI la **reçoit**,
  ne la réimplémente jamais.
- `package.json` du CLI n'a **pas** de champ `exports` : `packages/cli/AGENTS.md` l'interdit
  explicitement (« Ce package n'expose aucun point d'entrée importable »). Le moteur n'est donc
  **pas encore séparé de la façade CLI** au sens où un autre paquet pourrait l'importer.
- Pas de commande `scaffold` : rien dans le dépôt ne génère un squelette de module. Le module
  `demo-enabled` (`packages/modules/demo-enabled/AGENTS.md`) se présente lui-même comme le
  gabarit que s41 doit suivre.
- Pas de vérification de dépôt propre (git) nulle part dans le CLI.

## Le contrat de module (s03, `packages/core/src/module.ts`)

13 clés obligatoires (ADR 007) : `id`, `requires`, `schema`, `migrations`, `routes`,
`navigation`, `messages`, `emails`, `webhooks`, `jobs`, `dataCategories`, `retention`, `purge`,
`export`. Un module sans données ni route déclare les collections vides — c'est le cas visé pour
`mcp-server` lui-même, qui n'a besoin d'aucune des cinq premières.

`defineModule` (fonction, pas juste un type) est la seule façon recommandée de déclarer un
module : elle préserve les littéraux (ADR — voir commentaire du fichier).

## SDK MCP installé (vérifié dans le paquet, pas de mémoire)

`@modelcontextprotocol/sdk@1.30.0`. Exports pertinents :

- `@modelcontextprotocol/sdk/server/mcp.js` → `McpServer` (API haut niveau), méthode
  `registerTool(name, { title?, description?, inputSchema?: ZodRawShape, outputSchema? }, cb)`
  où `cb(args, extra)` rend `{ content: [...] }` (et `structuredContent` si `outputSchema`
  déclaré).
- `@modelcontextprotocol/sdk/server/stdio.js` → `StdioServerTransport`, le transport nominal pour
  un serveur lancé par un client (Claude Desktop, etc.) via une commande locale.
- `@modelcontextprotocol/sdk/inMemory.js` → `InMemoryTransport.createLinkedPair()`, et
  `@modelcontextprotocol/sdk/client/index.js` → `Client`. Permet un test de bout en bout **sans
  sous-processus** : un vrai client MCP parle au vrai serveur, seul le transport est doublé — ce
  qui respecte « les doublures de test remplacent le réseau, jamais le SDK ».

## Piège nommé par la story

> Refuser toute opération sur un dépôt aux modifications non commitées, pour que le développeur
> puisse toujours annuler.

Rien dans `s05` ne fait ça — l'utilisateur humain du CLI valide interactivement, ou tape
`--json` en toute connaissance de cause. Un agent piloté par MCP n'a pas cette garde humaine :
c'est donc une précondition **propre à cette story**, pas une régression à apporter au CLI de s05.
Décision : ce garde-fou est posé au point de composition du serveur MCP (et, par cohérence, sur
la nouvelle commande `ks scaffold` qui n'existait pas non plus avant s41), jamais réinjecté dans
`ks toggle`, dont le contrat et les tests de s05 ne bougent pas.

## « Le moteur n'est pas séparé de la façade CLI » — déviation nécessaire

Le mandat de la story (`AGENTS.md` racine) dit noir sur blanc : *« npx ks (s05) and the MCP
server (s41) expose the same operations […]. Producing a module skeleton by hand is a smell. »*
— autrement dit le CLI **doit aussi** gagner `scaffold`, et les deux façades appellent le même
code.

Or `packages/cli` n'expose aucun point d'entrée importable par contrat. Deux options :

1. Extraire un nouveau paquet `@repo/module-engine` et vider `packages/cli` en pure façade —
   le refactor le plus propre, mais il déplace ~600 lignes déjà testées et couvertes par un
   `AGENTS.md` qui documente des mesures fines (768 allers-retours sur `features-file.ts`) :
   risque de régression élevé pour un gain principalement cosmétique.
2. Garder le moteur dans `packages/cli`, ajouter un **second point d'entrée**
   (`exports["."]` pointant vers un nouveau `src/index.ts`), et documenter que ce paquet est
   maintenant importable par la seconde façade — en gardant `bin.ts` comme unique composition
   root CLI.

Choix : **option 2**, actée ci-dessous comme déviation documentée. Le paquet reste
`packages/cli`, mais `packages/cli/AGENTS.md` est mis à jour : l'interdiction d'un point d'entrée
importable est levée, remplacée par la règle inverse — le baril `src/index.ts` est la **seule**
API publique du moteur, `bin.ts` reste le seul point de composition qui lit `config/features.ts`
et lance des sous-processus.

## Le module MCP lui-même

Le critère 7 (« Module non activé : le serveur n'est pas démarrable ») implique que
`mcp-server` est un module comme un autre dans `config/features.ts`, avec toutes les clés du
contrat vides (pas de schéma, pas de routes web — c'est un process à part, lancé en `stdio`, pas
monté dans Hono). Son `bin` vérifie l'activation exactement comme `ks` vérifie
`requiredModules` : composition root dédiée, refus nommé, code de sortie non nul, **avant**
toute construction de transport.
