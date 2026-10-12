# ADR 041 — La garde de dépôt propre protège les écritures pilotées par un agent, pas `ks toggle`

- Status: accepted
- Date: 2026-09-02
- Scope: story s41-mcp-server

## Context

Le piège nommé par s41 : « refuser toute opération sur un dépôt aux modifications non commitées,
pour que le développeur puisse toujours annuler ». `ks toggle` (s05) n'a jamais posé cette garde
— l'utilisateur humain qui tape la commande a déjà le contrôle qu'il lui faut, et rien dans son
contrat ou ses tests ne prévoit un refus sur dépôt sale. Un agent piloté par MCP n'a pas cette
garde humaine : rien ne l'empêche d'enchaîner des opérations sans jamais relire l'état du dépôt
entre deux appels.

Il fallait décider **où** poser cette précondition : dans le moteur partagé (donc aussi pour
`ks toggle`), ou seulement aux points de composition qui écrivent pour le compte d'un agent.

## Decision

`assertRepositoryClean` (`packages/cli/src/git-guard.ts`) est une fonction du moteur partagé,
mais son **appel** est décidé par chaque composition root, pas imposé par le moteur :

- posée par `packages/cli/src/bin.ts` sur la nouvelle commande `ks scaffold` (elle n'existait pas
  avant s41, aucun usage établi à préserver) ;
- posée par `packages/modules/mcp-server/src/server.ts` sur les deux outils qui écrivent
  (`toggle_module`, `scaffold_module`), jamais sur `list_modules` qui ne modifie rien ;
- **non posée** par `ks toggle` (s05) : son contrat et ses tests ne changent pas avec cette
  story.

## Considered options

- **Injecter la garde dans `runToggle`/`planToggle`** (le moteur partagé) — rejeté : ça change
  le comportement d'une commande déjà livrée et testée (s05) pour un besoin qui ne la concerne
  pas. Un développeur qui tape `ks toggle billing` dans un dépôt avec un `git status` sale n'a
  jamais été refusé, et rien dans la story ne demande de le refuser maintenant.
- **Ne poser la garde que côté MCP, jamais côté CLI** — rejeté : `ks scaffold` est une commande
  aussi nouvelle que le serveur MCP, avec le même risque (une écriture non voulue qu'on ne peut
  plus distinguer du travail en cours). La distinction pertinente n'est pas « CLI contre MCP »,
  c'est « commande déjà livrée avec son contrat propre » contre « écriture nouvelle introduite
  par cette story ».
- **Poser la garde partout, y compris `ks toggle`** — rejeté pour la même raison que la première
  option : c'est un changement de comportement hors du périmètre de la story, sur une commande
  dont s05 a déjà fixé et testé le contrat.

## Consequences

- Un agent qui appelle `toggle_module` ou `scaffold_module` sur un dépôt avec du travail non
  commité reçoit un refus nommé, sans qu'aucun fichier n'ait bougé — prouvé par mutation
  (`packages/cli/src/git-guard.test.ts`, `packages/modules/mcp-server/src/server.test.ts`).
- `ks toggle` continue de se comporter exactement comme s05 l'a livré et testé : aucune
  régression sur son contrat.
- À surveiller : si une story future ajoute une autre commande CLI qui écrit, elle doit se poser
  la même question — « est-ce une commande nouvelle, sans usage établi à préserver ? » — avant de
  décider si la garde s'applique.
