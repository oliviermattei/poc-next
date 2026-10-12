# ADR 042 — Un module-processus est exempté des quatre couches, et le paie par une garde de remplacement

- Status: accepted
- Date: 2026-09-02
- Scope: story s41-mcp-server

## Context

`packages/modules/mcp-server` n'a pas de couches : son `src/` est plat (`bin.ts`, `server.ts`,
`file-changes.ts`, `client-config-schema.ts`, `module.ts`, `index.ts`). Ce n'est pas un oubli
d'écriture, c'est ce qu'est ce module — un processus lancé en `stdio` par un client, qui ne sert
aucune route, n'a aucun schéma, aucune règle métier, et dont tout le travail consiste à traduire
un appel d'outil en appel du moteur de `@repo/cli`.

Le problème n'est pas l'absence de couches en soi : c'est que la règle de frontières (ADR 006)
est câblée sur `packages/modules/<module>/src/{domain,application,infrastructure,presentation}`.
Un fichier hors de ces dossiers n'est classé par aucun motif, donc **rien ne peut lui être
refusé**. La règle reste verte quoi qu'on écrive dans ce module, et c'est précisément celui qui
mêle SDK, transport `stdio`, `child_process` et système de fichiers. « La règle existe » y était
vrai en apparence et faux en fait — exactement la forme d'échec que `AGENTS.md` racine nomme.

## Decision

Un module dont des fichiers vivent hors des quatre couches est un **module-processus**. Il en est
dispensé, et il paie cette dispense par une frontière de remplacement, exécutable, qui porte sur
ce que les couches auraient tenu ici :

1. son unique point de composition est `src/bin.ts` ;
2. aucun autre fichier de `src/` n'importe `node:child_process` ni un transport du SDK
   (`…/server/stdio.js`), et aucun n'utilise d'`import()` dynamique — la seule façon de charger
   `config/features.ts` à un chemin calculé.

Les deux points sont vérifiés par `tests/lint-rules.test.ts`, à côté des cas qui prouvent la
règle ADR 006 elle-même : le premier dérive la liste des modules et de leurs fichiers hors
couches (aucune liste recopiée, un module nouveau y entre tout seul), le second n'examine que les
modules effectivement sans couches. `pnpm test` échoue quand l'une des deux cesse d'être vraie.

## Considered options

- **Ranger `mcp-server` dans les quatre couches** — rejeté. Il n'y a ici ni règle métier
  (`domain`), ni cas d'usage indépendant d'un framework (`application`) : tout le contenu serait
  arbitrairement réparti entre `infrastructure` et `presentation`, et le premier import de
  `trackFileChanges` (`infrastructure`, il lit le disque) depuis l'enregistrement des outils
  (`presentation`) violerait la règle même qu'on prétendait faire respecter. Une structure posée
  pour satisfaire un motif de chemin, sans la séparation qu'elle est censée décrire, apprend au
  prochain agent que les couches sont décoratives.
- **Laisser la règle inerte et le dire dans `AGENTS.md`** — rejeté : une exemption écrite en
  prose n'est pas opposable. Le fichier affirmait déjà que `src/bin.ts` est le seul point de
  composition, et rien ne le vérifiait ; la revue de s41 a mesuré que la sortie des
  sous-processus partait dans le canal du protocole sans qu'un seul test rougisse.
- **Interdire tout module sans les quatre couches** — rejeté : la règle serait fausse pour un
  module qui n'a légitimement pas les quatre dossiers (`i18n` n'a que `domain` et
  `application`), et forcerait des dossiers vides dont personne ne lit le contenu. Ce n'est pas
  la présence des dossiers qui compte, c'est qu'aucun fichier ne vive hors de portée de la
  règle.

## Consequences

- `mcp-server` reste plat, et sa frontière est vérifiée par une commande — `pnpm test`.
- Un module nouveau qui poserait des fichiers hors des couches sans point de composition
  `src/bin.ts` fait échouer la suite, en nommant les fichiers en cause : l'exemption ne s'obtient
  pas par inadvertance.
- Le gabarit de `ks scaffold`, lui, continue de créer les quatre couches : la forme par défaut
  d'un module reste celle d'ADR 006, l'exemption est un cas nommé, pas une facilité.
- À surveiller : la garde de remplacement nomme trois mécanismes (`node:child_process`, le
  transport `stdio` du SDK, l'`import()` dynamique) — ceux que ce module utilise aujourd'hui.
  Un module-processus qui atteindrait le monde autrement (socket brut, `node:worker_threads`)
  passerait entre les mailles ; la liste est à étendre au premier cas rencontré, et elle ne
  prétend pas être complète.
