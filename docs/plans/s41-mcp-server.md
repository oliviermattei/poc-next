---
validated: yes
---

# Plan — s41-mcp-server

Story complète (recherche → commit) exécutée par l'implémenteur, sans écran (skip `/ks-design`).
Voir `docs/research/s41-mcp-server.md` pour le contexte et la déviation actée (moteur exposé par
`packages/cli`, pas extrait dans un nouveau paquet).

Socle touché : `docs/security.md` §6 (dépendance nouvelle justifiée : `@modelcontextprotocol/sdk`,
`zod` déjà présent ailleurs) ; `docs/reliability.md` §2/§4 (transaction du scaffold, dégradation
propre si le dépôt est sale) ; agent-oriented repo (génération plutôt que geste manuel).

ADR à écrire (numéros réservés 040-041) :
- 040 — le moteur de `packages/cli` devient un second point d'entrée public, réutilisé par le
  module `mcp-server` (au lieu d'une extraction de paquet).
- 041 — la garde « dépôt propre » comme précondition posée aux points de composition qui
  écrivent pour le compte d'un agent (scaffold CLI, et les deux outils MCP qui écrivent),
  jamais réinjectée dans `ks toggle` de s05.

## Tâches

- [x] 1. `packages/cli` : garde de dépôt propre — `src/git-guard.ts`, `assertRepositoryClean`,
      refuse en nommant les fichiers modifiés si `git status --porcelain` n'est pas vide.
      Test : dépôt git temporaire propre passe, dépôt sale refuse en nommant un fichier.
- [x] 2. `packages/cli` : moteur de scaffold — `src/scaffold.ts` (`planScaffold`,
      refuse un identifiant mal formé ou déjà connu, en le nommant) et
      `src/scaffold-files.ts` (contenu du squelette : les quatre couches, `module.ts` conforme
      au contrat à 13 clés, `package.json`, `tsconfig.json`, `AGENTS.md`, messages `fr`/`en`
      vides). Test : plan refusé sur id connu/mal formé ; fichiers produits couvrent les clés du
      contrat.
- [x] 3. `packages/cli` : écriture transactionnelle du scaffold — `src/apply-scaffold.ts`
      (refuse si le dossier cible existe déjà ; écrit tout ; retire tout au premier échec).
      Test : écriture nominale, refus sur dossier existant, retrait complet sur échec simulé.
- [x] 4. `packages/cli` : `ks scaffold <id>` — `arguments.ts` (+USAGE), `bin.ts` (guard de dépôt
      propre puis `planScaffold`/`applyScaffold`, liste exacte des fichiers créés sur stdout/JSON).
      Test : bout en bout sur un dépôt temporaire (`bin.test.ts`).
- [x] 5. `packages/cli` : second point d'entrée — `src/index.ts` (baril du moteur), `exports` dans
      `package.json`, `AGENTS.md` mis à jour (déviation actée). Pas de test dédié : vérifié par
      l'usage qu'en fait le module `mcp-server` (tâche 7).
- [x] 6. Nouveau module `packages/modules/mcp-server` : contrat à 13 clés, toutes vides sauf
      `id`. `src/module.ts`, `src/index.ts`, `package.json`, `tsconfig.json`, `AGENTS.md`.
      Enregistré dans `config/features.ts` (annuaire + activé par défaut) ; `pnpm db:generate`
      rejoué.
- [x] 7. `src/server.ts` du module : `createMcpServer` avec les trois outils
      (`list_modules`, `toggle_module`, `scaffold_module`), tous appelés depuis le moteur de
      `packages/cli`. `toggle_module` et `scaffold_module` posent la garde de dépôt propre et
      renvoient la liste exacte des fichiers modifiés/créés (suivi de fichiers avant/après sur les
      chemins connus : `config/features.ts`, `generated/schema/`, dossiers de migrations
      concernés, et pour scaffold les fichiers créés). Un module inconnu, un requis manquant, un
      dépendant encore activé sont trois refus distincts, chacun nommant le module en cause.
      Test (`src/server.test.ts`, transport en mémoire + vrai client MCP) : les trois outils, les
      trois refus nommés, l'invariant « même sortie que le moteur CLI sur la même config », le
      refus sur dépôt sale sans écriture.
- [x] 8. `src/bin.ts` + `bin/mcp-server.mjs` : composition root du serveur — refuse de démarrer
      si `mcp-server` n'est pas dans `enabledModules` (nomme le module et la commande pour
      l'activer), sinon connecte `StdioServerTransport`. Test (`src/bin.test.ts`) : désactivé →
      sortie non nulle, rien sur stdout ; activé → répond à une requête `initialize`.
- [x] 9. Fichier d'exemple de configuration client (`packages/modules/mcp-server/mcp-client.example.json`)
      + schéma de validation (`src/client-config-schema.ts`, Zod) + test qui valide l'exemple et
      refuse une variante malformée.
- [x] 10. Documentation : `packages/cli/AGENTS.md`, `packages/modules/mcp-server/AGENTS.md`,
      `docs/architecture.md` (si la liste des modules doit citer `mcp-server`) mis à jour ; deux
      ADR (040, 041) écrites.

## Vérification finale (les deux configurations de modules)

`pnpm typecheck`, `pnpm lint --max-warnings=0`, `pnpm test`, `E2E_PORT=3141 pnpm test:e2e`,
`pnpm build --force`, `pnpm run audit` — une fois avec `mcp-server` activé (état livré), une fois
désactivé (`pnpm ks toggle mcp-server`) pour prouver le critère 7, puis réactivé avant le commit.

## Tour de correction (revue 1, `docs/reviews/s41-mcp-server.md`)

- [x] C1. `src/bin.ts` : la sortie des sous-processus part sur le descripteur `2` du parent,
      jamais sur le canal JSON-RPC. Test (`src/bin.test.ts`) : le binaire réel piloté en `stdio`
      brut, `toggle_module` appelé, chaque ligne de `stdout` classée — aucune non-JSON tolérée,
      et la bannière du sous-processus retrouvée sur `stderr`.
- [x] M1. `toggle_module` délègue à `runToggle` au lieu de ré-orchestrer, et rend les migrations
      à jouer. `ToggleOutcome` porte `migrations` (identifiant + chemin), que les deux façades
      exposent. Corrige du même coup m2 (annonces ADR 019 rendues à l'appelant par `notices`,
      plus de `db:migrate` quand aucun module activé ne déclare de migration) et une partie de
      m3 (le toggle passe par le moteur, il ne peut plus en diverger).
- [x] M2. Le gabarit d'`AGENTS.md` de `ks scaffold` nomme `@repo/typescript-config`. La garde est
      dans le tour : `tests/agents-md.test.ts` applique au squelette généré la règle même qu'il
      applique aux packages du dépôt.
- [x] M3. ADR 042 : `mcp-server` est un module-processus, exempté des quatre couches, avec la
      garde de remplacement dans `tests/lint-rules.test.ts` (aucun fichier de module hors portée
      de la règle sans point de composition `src/bin.ts` ; ni `child_process`, ni transport, ni
      `import()` dynamique hors de ce point ; baril réduit au contrat).
- [x] M4. `src/index.ts` n'exporte plus `createMcpServer` : le SDK MCP disparaît du bundle
      serveur de production (mesuré : 8 fichiers de `apps/web/.next/server` le nommaient, 0
      après, `pnpm build --force` de part et d'autre).
