# ADR 020 — La connexion à la base est injectée aux modules, jamais importée par eux

- Status: accepted
- Date: 2026-08-31
- Scope: story s07-signup-signin

## Context
s04 a livré la génération des migrations par module et a laissé un résidu écrit dans son propre code : `enabledModuleSchemas = []`. Le client Drizzle se construisait donc avec un schéma relationnel vide, et `db.query.<table>` n'existait pour aucun module. Tant qu'aucun module ne persistait — les repositories de démonstration sont en mémoire — le résidu était sans conséquence. s07 est le premier module qui persiste réellement, et le plan lui confie la fermeture du résidu.

Le typage impose une contrainte que la documentation de s04 n'avait pas anticipée : pour que `db.query.<table>` soit **typé**, `@repo/db` doit connaître statiquement les schémas des modules activés. Une injection à l'exécution rendrait la table accessible mais non typée, ce qui ne referme pas le résidu.

Or `packages/db/AGENTS.md` annonçait l'inverse de ce qui devient nécessaire : « ce package ne dépend d'aucun package de module, et ne doit pas : l'`infrastructure/` d'un module dépendra de ce package pour sa connexion, et la dépendance inverse fermerait alors un cycle ». Les deux moitiés de la phrase ne peuvent pas tenir ensemble ; il faut choisir laquelle tombe.

## Decision
`@repo/db` importe l'**agrégat généré** (`generated/schema/index.ts`, écrit par `pnpm db:generate` depuis `config/features.ts`), et **un module n'importe jamais `@repo/db`** : il reçoit sa connexion de son point de composition, sous la forme réduite des opérations qu'il utilise.

Le sens de la dépendance est donc : `@repo/db` → agrégat généré → packages de modules. Jamais l'inverse.

La règle est exécutable, et pas seulement écrite : `tests/module-registry.test.ts` refuse tout import de `@repo/db` dans `packages/modules/*/src/**` et dans leurs manifestes. `pnpm test` échoue si on la viole.

## Considered options
- **Laisser le module importer `@repo/db` et injecter les schémas à l'exécution** — rejeté : `appSchema` perdrait son type, donc `db.query.<table>` resterait inutilisable. Le résidu serait déplacé, pas fermé. S'y ajoute un singleton mutable à poser avant la première requête, dont l'ordre d'initialisation ne se vérifie nulle part.
- **Laisser le module importer `@repo/db` *et* `@repo/db` importer l'agrégat** — rejeté : c'est le cycle. Il ne se manifeste pas à la compilation mais à l'exécution, quand l'agrégat lit une table d'un module encore en cours d'évaluation — une `ReferenceError` dans le module le plus sensible du socle, dépendante de l'ordre des imports, donc intermittente.
- **Faire construire le client typé par chaque point de composition** — rejeté : `apps/web` aurait alors un client typé et `@repo/db` un autre pour la sonde de santé, soit deux pools de connexions pour un même processus.
- **Ne rien changer et documenter le résidu une story de plus** — rejeté : le plan de s07 confie explicitement sa fermeture à cette story, et chaque module qui persiste ensuite hérite du contournement.

## Consequences
Facilité : `db.query.<table>` est disponible et typé pour tous les modules activés ; le sens de la dépendance est unique et vérifié par une commande ; un module reste testable sans base, puisqu'il reçoit une connexion au lieu d'aller la chercher.

Difficulté : un module qui persiste doit déclarer un port de persistance et le recevoir à sa composition — c'est une contrainte de plus pour le générateur de squelette (s41), et une ligne de plus dans le point de composition de l'application.

À surveiller : l'agrégat est un artefact **versionné**. Comme les barils, il ment s'il n'est pas comparé à sa régénération — `tests/module-migrations.test.ts` le compare. Et le jour où un module aura besoin d'une capacité de `@repo/db` qui n'est pas la connexion (une aide de migration, une introspection), c'est un port qu'il faudra, pas un import.
