# ADR 013 — Dépôt orienté agents

- Status: accepted
- Date: 2026-08-30
- Scope: framing

## Context
ShipSaaS vend « 50+ conventions qui cadrent ton IA » et MakerKit livre des règles LLM pré-configurées pour Cursor, Claude Code et Windsurf. C'est de la parité attendue sur ce marché. Mais l'enjeu réel dépasse l'argument commercial : ce boilerplate sera majoritairement modifié par des agents, et un agent qui ne trouve pas ses marques invente — il crée un composant hors design system, contourne une couche, réécrit une convention.

Le contrat de module (ADR 007) et la règle de dépendance des couches (ADR 006) ne servent à rien si rien ne les rappelle à l'endroit où le code s'écrit.

## Decision
Le dépôt est structuré pour qu'un agent soit **cadré par construction**, à trois niveaux :

1. **Règles localisées.** Un `AGENTS.md` à la racine pour les règles globales, et un `AGENTS.md` par package pour ce qui lui est propre : ce que ce package a le droit d'importer, ce qu'il ne doit jamais contenir, où vont ses tests.
2. **Contraintes exécutables plutôt que documentaires.** Chaque règle importante est doublée d'une vérification automatique — lint de frontières pour les couches, validation de configuration pour les modules requis, tests de câblage pour l'environnement. Une règle qu'aucune commande ne vérifie finit contournée.
3. **Surfaces d'outillage.** Le CLI (s05) et le serveur MCP (s41) exposent les mêmes opérations : lister les modules, en activer un, générer un squelette conforme au contrat. Un agent n'a jamais à deviner la structure d'un module — il la génère.

La documentation destinée aux agents est maintenue **au même commit que le code qu'elle décrit**. Une story qui change une convention et ne met pas à jour la règle correspondante est incomplète.

## Considered options
- **Un seul `AGENTS.md` racine, exhaustif** — rejeté : il devient illisible, et un agent qui travaille dans `packages/modules/billing` n'a pas besoin des règles du site marketing. La proximité fait la pertinence.
- **De la documentation seule, sans vérification** — rejeté : c'est le mode d'échec observé partout. Une convention non vérifiée dure trois stories.
- **Des règles spécifiques à un outil** (`.cursorrules`, fichiers propriétaires) — rejeté : `AGENTS.md` est lisible par tous les agents et par les humains. Pas de duplication par outil.

## Consequences
Facilité : un agent trouve la règle là où il édite ; le générateur de module rend le chemin conforme plus court que le chemin improvisé.
Difficulté : maintenir des règles à plusieurs endroits crée un risque de divergence. Un test vérifie que chaque package possède son `AGENTS.md` et que celui-ci nomme ses dépendances autorisées.
À surveiller : la tentation d'écrire des règles que rien ne vérifie. Toute règle ajoutée doit répondre à la question « quelle commande échoue si on la viole ? ».
