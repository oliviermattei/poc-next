# ADR 013 — Dépôt orienté agents

- Status: accepted
- Date: 2026-08-30

Ce dépôt est majoritairement modifié par des agents, et un agent qui ne trouve pas ses repères invente : un composant hors design system, une couche contournée, une convention réécrite. Le contrat de module (ADR 007) et la règle des couches (ADR 006) ne servent à rien si rien ne les rappelle là où le code s'écrit. Le dépôt cadre donc les agents par construction :

1. **Règles localisées** — un `AGENTS.md` racine pour le global, et un `AGENTS.md` par package : ce qu'il peut importer, ce qu'il ne doit jamais contenir, où vont ses tests. Ils changent dans le même commit que le code qu'ils décrivent.
2. **Règles exécutables** — chaque règle importante est doublée d'une commande qui échoue si on la viole (lint de frontières, validation de configuration, tests de câblage). Une règle qu'aucune commande ne vérifie finit contournée.
3. **Générer plutôt que deviner** — `pnpm ks` (lister, activer, `scaffold`) et le serveur MCP du module `mcp-server` exposent les mêmes opérations ; un agent ne devine jamais la structure d'un module, il la génère.

## Considered options

- Un seul `AGENTS.md` racine exhaustif — rejeté : illisible, et un agent dans un module n'a pas besoin des règles du site. La proximité fait la pertinence.
- Des fichiers propres à un outil (`.cursorrules`…) — rejetés : `AGENTS.md` se lit par tous les agents et par les humains, sans duplication.

## Consequences

- Des règles à plusieurs endroits peuvent diverger : `tests/agents-md.test.ts` vérifie que chaque package a son `AGENTS.md` et que celui-ci nomme ses dépendances.
- Toute règle ajoutée répond à la question « quelle commande échoue si on la viole ? ».
