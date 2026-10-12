# ADR 040 — Le moteur de `packages/cli` s'expose par un second point d'entrée, plutôt que d'être extrait

- Status: accepted
- Date: 2026-09-02
- Scope: story s41-mcp-server

## Context

s05 a livré `packages/cli` (`ks list`, `ks toggle`) avec une règle explicite : « ce package
n'expose aucun point d'entrée importable ». Le moteur (validation du plan de bascule, lecture et
écriture AST-safe de `enabledModules`, transaction d'écriture) vit dans `src/`, mais seul
`bin.ts` — le composition root — l'orchestre ; rien n'était pensé pour être `import`é par un
autre paquet.

s41 exige une seconde façade : un serveur MCP qui expose les mêmes opérations (lister, basculer,
et désormais générer un squelette de module) à un agent. La règle du dépôt est explicite
(`AGENTS.md` racine) : « le serveur MCP réutilise la logique du CLI de s05, jamais une seconde
implémentation ». Il faut donc que le second facade importe le même code que `bin.ts` orchestre.

## Decision

`packages/cli` gagne un second point d'entrée : `src/index.ts`, déclaré dans `exports["."]` de
son `package.json`. Il réexporte le moteur — tout ce qui reçoit des modules et un environnement
en paramètres (`runList`, `runToggle`, `planToggle`, `missingRequirements`, `describeModules`,
`readEnabledModules`/`writeEnabledModules`, `applyToggle`, et les nouveautés de s41 :
`planScaffold`, `scaffoldFiles`, `applyScaffold`, `assertRepositoryClean`) — et rien du
composition root : ni `bin.ts`, ni un accès à `config/features.ts`, ni un sous-processus.
`packages/modules/mcp-server` consomme ce baril exactement comme `bin.ts` le fait, à parts
égales entre les deux façades.

## Considered options

- **Extraire un nouveau paquet `@repo/module-engine`**, en vidant `packages/cli` en pure
  façade — rejeté : ça déplace ~600 lignes déjà testées et documentées avec précision
  (`packages/cli/AGENTS.md` mesure 768 allers-retours sur `features-file.ts`), pour un gain
  presque entièrement cosmétique. Le risque de régression sur un code aussi finement mesuré
  dépasse le bénéfice d'un nom de paquet plus \* pur \*.
- **Dupliquer la logique de bascule et de scaffold dans `packages/modules/mcp-server`** —
  rejeté explicitement par le mandat de la story : deux implémentations divergeraient au premier
  cas limite, et l'historique du dépôt (validation du graphe des modules) a déjà tranché cette
  question une fois pour le CLI lui-même (`packages/cli/AGENTS.md` §3).
- **Second point d'entrée sur le paquet existant** — retenu : coût minimal, aucune ligne
  déplacée, la seule règle qui change est « ce package n'a pas de point d'entrée importable »,
  remplacée par « son point d'entrée est le moteur, jamais le composition root ».

## Consequences

- `packages/cli/AGENTS.md` documente la nouvelle règle : `src/index.ts` est la seule API
  publique, `bin.ts` reste l'unique composition root CLI.
- Toute future troisième façade (une UI web de configuration, par exemple) importera le même
  baril plutôt que de réinventer la validation.
- À surveiller : `src/index.ts` ne doit jamais réexporter une fonction qui lit
  `config/features.ts` ou lance un sous-processus — ce serait rouvrir la porte qu'ADR 007/013
  ont fermée (générer plutôt que deviner, composition root unique par façade).
