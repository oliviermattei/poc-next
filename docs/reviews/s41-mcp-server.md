# Revue anti-hallucination — s41-mcp-server

Branche `feature/s41-mcp-server`, commit unique `2bdd88e`, diff `git diff dev...feature/s41-mcp-server`.
Base `s41`. Revue menée dans le worktree, dépôt rendu propre après chaque mutation
(`git diff --exit-code`).

## Commandes exécutées

Les six commandes, dans les **deux** configurations de modules (`mcp-server` activé — l'état
livré — puis désactivé par `ks toggle mcp-server`, puis réactivé ; l'aller-retour rend le dépôt
identique octet pour octet, `git diff --exit-code` propre).

| Commande | Configuration activée | Configuration désactivée |
|---|---|---|
| `pnpm typecheck --force` | 24/24 (cache forcé à zéro) | 24/24 |
| `pnpm lint --max-warnings=0` | aucun problème | aucun problème |
| `pnpm test` | 1507 verts, 6 ignorés | 1507 verts, 6 ignorés |
| `E2E_PORT=3141 pnpm test:e2e` | 79 verts, 7 ignorés | non rejoué (aucune route web dans ce module) |
| `pnpm build --force` | succès | non rejoué |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert | — |

Au tout premier passage, `tests/rendered-text.test.ts` a expiré à 5 s ; relancé seul il passe,
et les deux passages complets suivants sont à 1507 verts. Flakiness de démarrage à froid,
antérieure à cette story.

Critère 7 vérifié sur le **vrai** dépôt, pas seulement en test : module désactivé,
`node packages/modules/mcp-server/bin/mcp-server.mjs` sort en code 1, `stdout` strictement vide,
`stderr` nomme le module et la commande d'activation.

Invariant « deux façades, un moteur » vérifié de bout en bout hors suite : un vrai client MCP en
`stdio` sur le dépôt réel rend pour `list_modules` exactement la chaîne de `ks list --json`
(comparaison JSON stricte, 10 modules).

## Table des mutations

Chaque mutation est posée **à l'endroit du défaut**, la suite ciblée est relancée, puis le
fichier est restauré et l'arbre prouvé propre.

| Site de la mutation | Neutralisation | Rouges |
|---|---|---|
| `packages/modules/mcp-server/src/server.ts` — `toggle_module` | appel à `assertRepositoryClean` retiré | 1 |
| `packages/modules/mcp-server/src/server.ts` — `scaffold_module` | appel à `assertRepositoryClean` retiré | 1 |
| `packages/cli/src/bin.ts` — branche `scaffold` | appel à `assertRepositoryClean` retiré | 1 |
| `packages/modules/mcp-server/src/bin.ts` | `if (!enabled.includes(MODULE_ID))` → `if (false)` | 1 |
| `packages/cli/src/scaffold.ts` | `KEBAB_CASE` → `/.*/s` | 1 |
| `packages/cli/src/apply-scaffold.ts` | retrait du `rm` de restauration | 1 |
| `packages/cli/src/apply-scaffold.ts` | garde « dossier déjà présent » → `if (false)` | 1 |
| `packages/modules/mcp-server/src/bin.ts` | `stdio: ['ignore','inherit','inherit']` → `'pipe'` | **0** |

La dernière ligne est le constat critique ci-dessous : le canal du protocole n'est tenu par
aucun test.

## Constats

### Critique

**C1 — la sortie de `pnpm db:generate` est écrite dans le canal du protocole MCP.**
`packages/modules/mcp-server/src/bin.ts` compose ses sous-processus ainsi :

```ts
const child = spawn(command, [...args], { cwd, stdio: ['ignore', 'inherit', 'inherit'] })
```

`inherit` sur le descripteur 1 donne à l'enfant le `stdout` du serveur — c'est-à-dire le flux
JSON-RPC de `StdioServerTransport`. Mesuré sur le dépôt réel, en pilotant le binaire par un
`stdio` brut et en classant chaque ligne reçue : un seul appel `toggle_module` a injecté **50
lignes non-JSON** entre la réponse d'`initialize` et la réponse de l'outil — bannière `turbo`,
chemin absolu du dépôt, inventaire complet des tables de tous les modules, `No schema changes,
nothing to migrate 😴`, le récapitulatif des tâches.

Le fichier contredit son propre commentaire, écrit huit lignes plus haut :

> Sur `stderr` : `stdout` est le canal du protocole MCP, il ne doit jamais porter de la prose.

Aucun test ne l'attrape, et c'est la cinquième forme d'échec du dépôt à la lettre : le défaut
vit **au point de composition**, et les deux tests qui approchent ce point l'évitent chacun d'un
côté — `src/server.test.ts` injecte un `regenerate` factice qui n'ouvre aucun sous-processus,
`src/bin.test.ts` lance le vrai binaire mais n'appelle que `listTools`, jamais un outil qui
écrit. Mutation posée exactement là (`inherit` → `pipe`) : **0 rouge sur 18**.

Le contrat du transport `stdio` de MCP est que le serveur n'écrit sur `stdout` que des messages
valides. Le client du SDK a survécu à mon essai, mais rien ne garantit qu'un autre client le
fasse, et une ligne de bruit qui se trouverait être du JSON valide serait interprétée comme un
message. C'est l'opération d'écriture principale de la story qui corrompt son propre canal.

### Majeur

**M1 — critère 2 non tenu : `toggle_module` ne renvoie pas les migrations à jouer.**
Mesuré sur le dépôt réel en activant `demo-disabled`, qui déclare pourtant
`migrations: 'packages/modules/demo-disabled/migrations'`. Charge utile complète :

```json
{ "action": "enable", "moduleId": "demo-disabled", "enabled": [...], "alsoEnabled": [],
  "modifiedFiles": ["config/features.ts", "generated/schema/demo-disabled.ts",
                    "generated/schema/index.ts"] }
```

Aucun champ ne nomme les migrations, et rien ne dit qu'il en reste à appliquer. La façade CLI,
elle, l'imprime (`commands.ts` : « Migrations générées pour … », puis « Lancez « pnpm db:migrate »
quand votre base est prête »). L'agent, lui, n'a que trois chemins de fichiers dont aucun n'est
une migration.

**M2 — le générateur produit un paquet qui fait rougir la suite du dépôt.**
`ks scaffold probe-module` sur le dépôt réel : `tsc --noEmit` passe, `eslint --max-warnings=0`
passe, les quatre couches sont bien créées — mais `tests/agents-md.test.ts` rougit
immédiatement :

```
FAIL  packages/modules/probe-module nomme chacune des dépendances qu’il déclare
AssertionError: expected '# packages/modules/probe-module — règ…' to contain '@repo/typescript-config'
```

Le `package.json` généré déclare `@repo/typescript-config: workspace:*` en `devDependencies`,
et le gabarit d'`AGENTS.md` de `scaffold-files.ts` ne nomme que `@repo/core`. Un agent qui suit
la voie recommandée par `AGENTS.md` racine (« générer, ne pas deviner ») obtient donc un dépôt
dont `pnpm test` est rouge dès la génération. Le `AGENTS.md` écrit à la main pour `mcp-server`
lui-même, lui, nomme bien `@repo/typescript-config` : la règle était connue, le gabarit ne la
porte pas.

**M3 — `mcp-server` est le seul module du dépôt sans les quatre couches.**
`src/` est plat : `bin.ts`, `server.ts`, `file-changes.ts`, `client-config-schema.ts`,
`module.ts`. Les neuf autres modules ont tous au moins `domain/` et `application/`. Or la règle
de frontières (ADR 006) est câblée sur `**/packages/modules/*/src/{domain,application,
infrastructure,presentation}` (`tooling/eslint/boundaries.ts`) : sur ce module, elle ne matche
aucun fichier et **ne peut rien refuser**. C'est précisément le module qui mêle SDK, transport
`stdio`, `child_process` et `fs`. `AGENTS.md` racine §4 : « lives in `packages/modules/<name>`
with four layers ». Le générateur que la story livre, lui, crée bien les quatre couches.

**M4 — le baril du module tire le SDK MCP dans le bundle serveur de production.**
`packages/modules/mcp-server/src/index.ts` réexporte `createMcpServer` depuis `server.ts`.
`AGENTS.md` racine, ligne 153 : « The main barrel carries the contract, `domain` and
`application` ». Le seul consommateur du baril est `config/features.ts`, qui n'a besoin que de
`mcpServerModule` ; `bin.ts` et `server.test.ts` importent `./server` en relatif. Cette
réexportation n'a donc aucun consommateur — et un effet mesuré : après `pnpm build --force`,
`modelcontextprotocol` / `createMcpServer` / `StdioServerTransport` apparaissent dans quatre
chunks de `apps/web/.next/server/` (rien côté client). Le SDK pèse 5,9 Mo sur disque. La chaîne
est `apps/web/lib/module-registry.ts` → `config/features.ts` → `@repo/module-mcp-server` →
`./server` → SDK, et elle reste en place que le module soit activé ou non.

### Mineur

**m1 — `AGENTS.md` racine est resté en arrière.** Ligne 189, le tableau des commandes décrit
encore `pnpm ks` comme « le CLI de modules : `list` et `toggle` », et sa colonne « ce qui la
fait échouer » ignore les deux nouveaux refus (identifiant mal formé ou déjà pris, dépôt sale).
La story ajoute une troisième commande et laisse sa règle périmée.

**m2 — `toggle_module` ré-orchestre au lieu d'appeler `runToggle`.** Il enchaîne
`readEnabledModules` / `planToggle` / `applyToggle` lui-même. Conséquence : l'annonce du
réordonnancement canonique (ADR 019) et l'avertissement sur le commentaire supprimé — que
`commands.ts` qualifie de « la seule chance qu'a l'utilisateur de le récupérer » — ne parviennent
jamais à un agent. Atténué par la garde de dépôt propre, qui rend la perte visible dans
`git diff`. Autre écart de la même origine : `applyMigrations: true` lance `pnpm db:migrate`
même quand aucun module activé ne déclare de migration.

**m3 — l'invariant « deux façades » n'est tenu par une commande que pour `list_modules`.**
`server.test.ts` compare `list_modules` à `runList`. Rien ne compare `toggle_module` à
`runToggle` ni `scaffold_module` à `ks scaffold` — et c'est justement sur le toggle que les deux
chemins divergent déjà (M1, m2).

## Ce que j'ai éprouvé et qui tient

- **Sortie du dépôt : refusée partout où j'ai poussé.** Par le vrai serveur, sur un dépôt
  temporaire : `scaffold_module` avec `../../../escape`, `/etc/evil`, `a/b`, `..`, `a/../../b`,
  `a\b`, `.git`, `Roadmap` — huit refus nommés, `git status` du dépôt cible vide après coup.
  `toggle_module` avec `../../../escape` et `a/b` : refusés comme modules inconnus. Aucun outil
  n'accepte de chemin de son appelant ; `planScaffold` valide le kebab-case **avant** tout calcul
  de chemin, et `applyScaffold` ne reçoit que le `packagePath` calculé.
- **Aucun secret ne sort.** Dépôt de test avec un `.env` contenant `sk_live_TOPSECRET42` modifié
  et un `secret-notes.txt` non suivi : le refus nomme `« M .env »` et `« ?? secret-notes.txt »`,
  jamais leur contenu. `list_modules` sur le dépôt réel : aucune occurrence de `sk_`, `SECRET`,
  `DATABASE_URL` ou `password`.
- **Dépôt sans git : échec fermé.** L'erreur brute de `git` remonte (`fatal: not a git
  repository`), `messageOf` relaie, et surtout aucun fichier n'est créé.
- **Le scaffold est bien transactionnel** — trois mutations rouges (restauration, garde de
  dossier existant, refus d'identifiant), et l'échec en cours de route est provoqué par un vrai
  conflit de système de fichiers, pas par un mock.
- **La garde de dépôt propre mord pour de vrai** : elle m'a refusé une manipulation parce qu'un
  fichier temporaire à moi traînait dans le worktree.
- **Le SDK n'est jamais doublé** : seul le transport l'est (`InMemoryTransport`), et
  `bin.test.ts` lance le vrai exécutable. Conforme à « les doublures remplacent le réseau,
  jamais le SDK ».

## Les deux déviations, jugées

- **Moteur exposé par `src/index.ts` plutôt qu'extrait (ADR 040) — acceptée.** L'option rejetée
  est nommée avec son coût, la règle qu'elle remplace est réécrite dans
  `packages/cli/AGENTS.md`, `src/index.ts` n'exporte ni `bin.ts` ni un accès à
  `config/features.ts`, et l'égalité des deux sorties est mesurée. Pas un constat.
- **`ks scaffold` ajouté hors critères — acceptée.** `AGENTS.md` racine ligne 234 mandate que
  les deux façades exposent les mêmes opérations, scaffold compris. Générer par une seule façade
  aurait laissé la seconde deviner. Pas un constat.
- **Asymétrie de la garde (ADR 041) — acceptée.** Toutes les écritures atteignables *par MCP*
  sont gardées : les deux appels sont prouvés par mutation à leur propre site. Un agent qui
  appelle `toggle_module` sur un dépôt sale ne peut rien écraser. Reste qu'un agent disposant
  d'un shell contourne la garde par `pnpm ks toggle` — hors surface MCP, et le contrat de s05
  était explicitement hors périmètre. Défendable ; mériterait une ligne dans le « à surveiller »
  de l'ADR.

## Conformité au plan

Les dix tâches sont faites. `docs/architecture.md` n'a pas été touché : la tâche 10 le
conditionnait à l'existence d'une liste de modules, et il n'y en a pas (une seule occurrence de
`packages/modules/`, générique). Rien dans le diff que le plan n'ait demandé, hormis les deux
déviations déjà actées en recherche et en ADR.

## Non vérifié

- **Aucun client MCP réel.** Le serveur n'a jamais été piloté par Claude Desktop, Claude Code ou
  un autre client de production — seulement par le `Client` du SDK et par un `stdio` brut de ma
  main. La conséquence exacte de C1 chez un vrai client (tolérance silencieuse, journal d'erreur,
  ou déconnexion) reste à mesurer. Geste humain : brancher `mcp-client.example.json` dans un
  client réel et appeler `toggle_module`.
- **`mcp-client.example.json` n'a jamais servi.** Son `args` est un chemin relatif
  (`./packages/modules/mcp-server/bin/mcp-server.mjs`) : il ne fonctionne que si le client lance
  la commande depuis la racine du dépôt. Jamais testé depuis un autre répertoire de travail. Le
  test du critère 6 valide la forme du document, pas son fonctionnement.
- **`applyMigrations: true` jamais exercé contre une vraie base par MCP.** Le double de test est
  une fonction vide ; le chemin `pnpm db:migrate` déclenché depuis un outil n'a été observé nulle
  part.
- **Le squelette généré n'a pas été éprouvé après un vrai `pnpm install`.** Son `tsc` et son
  `eslint` passent grâce aux liens hoistés de `node_modules/@repo` à la racine. Le chemin
  « clone frais, install, typecheck » n'est pas mesuré.
- **Windows.** Tous les identifiants et jointures de chemins ont été éprouvés en POSIX
  uniquement ; `a\b` est refusé, mais la sémantique de `join` sous Windows n'est pas testée.
- **Pas d'écran**, donc pas de preuve navigateur attendue ; `pnpm build --force` et les 79
  parcours Playwright confirment seulement l'absence de régression.
- **Liste non exhaustive.** Ce qui précède est ce que ces passages ont balayé — les huit
  mutations listées, les huit identifiants de sortie de dépôt essayés, les deux configurations de
  modules. Je ne prétends pas avoir couvert tous les cas.


## Clôture — tour de correction de l'implémenteur

Correctifs apportés sur la branche, un seul commit de plus. Chaque correction a été écrite
test d'abord, la mutation posée **à l'endroit du défaut**, restaurée aussitôt.

| Constat | Correctif | Mutation posée | Rouges |
|---|---|---|---|
| C1 | `src/bin.ts` : `stdio: ['ignore', 2, 'inherit']` — le `stdout` de l'enfant est le `stderr` du parent, même geste que `packages/cli/src/bin.ts` en mode `--json`. Filet : `src/bin.test.ts` pilote le binaire réel en `stdio` brut, appelle `toggle_module` (dont le `db:generate` du dépôt temporaire imprime deux lignes), et refuse toute ligne non-JSON sur le canal | retour à `'inherit'` sur le descripteur 1 | 1 / 3 |
| M1 | `toggle_module` délègue à `runToggle` au lieu de ré-orchestrer ; `ToggleOutcome` porte `migrations` (identifiant + chemin), et la réponse MCP porte en plus `notices`, les lignes que la façade terminale imprimait pour l'œil seul | `migrations` calculé → `[]` dans `commands.ts` | 5 / 111 |
| M2 | le gabarit d'`AGENTS.md` de `ks scaffold` nomme `@repo/typescript-config` ; la garde est **dans le tour** : `tests/agents-md.test.ts` applique au squelette généré la règle même qu'il applique aux packages du dépôt (`declaredDependencies`, partagé) | retrait de la ligne du gabarit | 1 / 91 |
| M3 | ADR 042 : le module-processus est exempté des quatre couches, et paie l'exemption par une garde exécutable dans `tests/lint-rules.test.ts` — aucun fichier de module hors portée d'ADR 006 sans point de composition `src/bin.ts`, et pour ceux-là ni `node:child_process`, ni transport `stdio`, ni `import()` dynamique hors de ce point | `import { spawn } from 'node:child_process'` ajouté en tête de `src/server.ts` | 1 / 202 |
| M4 | `src/index.ts` ne réexporte plus `createMcpServer` ; garde ajoutée : le baril d'un module-processus n'importe que `./module` | réexport de `./server` remis dans le baril | 1 / 202 |

Deux corrections ont fait rougir la garde M3 pour de vraies raisons pendant leur écriture, ce
qui a corrigé la règle elle-même : exiger les quatre dossiers était faux (`i18n` n'a que
`domain` et `application`, `auth` porte `emails/`), et une recherche textuelle attrapait des
commentaires et une description d'outil. La règle porte donc sur les **fichiers hors de portée**
de la règle de couches, et sur les spécificateurs d'import, pas sur la prose.

Effets de bord assumés du correctif M1 : les mineurs **m2** (le toggle MCP ré-orchestrait ;
`applyMigrations: true` lançait `db:migrate` sans migration à jouer) et une partie de **m3**
(rien ne comparait `toggle_module` à `runToggle`) tombent avec lui — le toggle passe désormais
par le moteur, et trois cas le vérifient, dont « aucune migration déclarée → aucune base
touchée ». Le mineur **m1** (le tableau des commandes d'`AGENTS.md` racine décrit encore `ks`
comme « `list` et `toggle` ») **reste ouvert** : l'implémenteur ne touche pas au fichier de
règles du dépôt.

### Mesure du bundle (M4)

`pnpm build --force` de part et d'autre du correctif, comptage des fichiers de
`apps/web/.next/server` nommant `modelcontextprotocol`, `StdioServerTransport` ou
`createMcpServer` : **8 avant, 0 après**, puis 0 de nouveau après reconstruction. (Les occurrences
restantes du dépôt sont dans `apps/web/.next/dev/` et `.next/cache/turbopack/`, artefacts d'un
serveur de développement antérieur, pas la sortie de production.)

### Les six commandes, dans les deux configurations

| Commande | Activé | Désactivé |
|---|---|---|
| `pnpm typecheck` | 24/24 | 24/24 |
| `pnpm lint --max-warnings=0` | aucun problème | aucun problème |
| `pnpm test` | 1516 verts, 6 ignorés | 1516 verts, 6 ignorés |
| `E2E_PORT=3141 pnpm test:e2e` | 79 verts, 7 ignorés | 79 verts, 7 ignorés |
| `pnpm build --force` | succès, 0 fichier du bundle serveur nommant le SDK | succès, 0 également |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert | 1 avis, idem |

Neuf tests ajoutés (1507 → 1516), aucun supprimé, aucun nouveau fichier de test : les cas sont
tombés dans `src/bin.test.ts`, `src/server.test.ts`, `packages/cli/src/toggle.test.ts`,
`tests/agents-md.test.ts` et `tests/lint-rules.test.ts`. Critère 7 revérifié sur le dépôt réel
en configuration désactivée : code 1, `stdout` vide, `stderr` nommant le module. Aller-retour
`ks toggle mcp-server` deux fois : `config/features.ts` et `generated/` identiques octet pour
octet.

### Reste ouvert

- **m1**, décrit ci-dessus.
- Ce qui figurait en « non vérifié » plus haut n'a pas changé de statut, à une exception près :
  la conséquence de C1 chez un vrai client n'a plus lieu d'être mesurée, puisque le canal ne
  porte plus que du JSON-RPC — mais **aucun client MCP de production** n'a toujours piloté ce
  serveur, et `mcp-client.example.json` n'a toujours jamais servi.
- La liste des mécanismes que la garde d'ADR 042 confine (trois : `child_process`, transport
  `stdio`, `import()` dynamique) est celle des mécanismes que ce module utilise aujourd'hui ;
  l'ADR le dit et ne prétend pas à l'exhaustivité.

Verdict laissé au relecteur : le tour a corrigé un critique et quatre majeurs, dont un par un
changement du moteur partagé (`ToggleOutcome`) et un par une décision structurelle nouvelle
(ADR 042). Ces deux-là méritent d'être jugés par la revue, pas par celui qui les a écrits — la
porte reste donc fermée jusqu'à une seconde revue.


## Seconde revue — le delta `2bdd88e..e9cf39a`

Revue ciblée sur le tour de correction. Ce que la première revue a validé n'est pas refait.
Worktree `.claude/worktrees/agent-a6a005746d34a9f11`, branche `feature/s41-mcp-server`, base
`s41`. Arbre prouvé propre (`git diff --exit-code`) après chaque mutation, et avant d'écrire
cette section ; le dépôt de base est resté intact.

### Les six commandes, remesurées dans les deux configurations

| Commande | `mcp-server` activé | `mcp-server` désactivé |
|---|---|---|
| `pnpm typecheck --force` | 24/24, cache forcé à zéro | 24/24 |
| `pnpm lint --max-warnings=0` | aucun problème | aucun problème |
| `pnpm test` | 1516 verts, 6 ignorés | 1516 verts, 6 ignorés |
| `E2E_PORT=3141 pnpm test:e2e` | 79 verts, 7 ignorés | 79 verts, 7 ignorés |
| `pnpm build --force` | succès, **0** fichier de `.next/server` nommant le SDK | succès, **0** également |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert | idem |

Bascule faite par `node packages/cli/bin/ks.mjs toggle mcp-server`, aller-retour : `git status`
vide après réactivation. La garde d'ADR 042 rend le même verdict dans les deux configurations —
elle lit l'arborescence, pas `config/features.ts`, donc elle ne dépend pas de l'état des modules.

### Table des mutations de cette seconde revue

Chaque mutation est posée **à l'endroit du défaut** et restaurée dans la commande qui la pose.

| Site de la mutation | Neutralisation | Rouges |
|---|---|---|
| `packages/modules/mcp-server/src/bin.ts` | `stdio: ['ignore', 2, 'inherit']` → `['ignore', 'inherit', 'inherit']` | 1 / 22 (4 lignes non-JSON constatées sur le canal) |
| `packages/cli/src/commands.ts` | `migrations` calculé → `[]` | 5 (les deux façades) |
| `packages/cli/src/scaffold-files.ts` | ligne `@repo/typescript-config` retirée du gabarit | 1 / 91 |
| `packages/modules/mcp-server/src/index.ts` | réexport `./server` remis dans le baril | 1 / 202, **et 8 fichiers** de `.next/server` nomment de nouveau le SDK |
| `packages/modules/mcp-server/src/server.ts` | `import { spawn } from 'node:child_process'` en tête | 1 / 202 |
| `packages/modules/i18n/src/sonde.ts` (fichier plat ajouté) | un module sans `src/bin.ts` acquiert un fichier hors couches | 2 / 202 |

Les cinq chiffres annoncés par l'implémenteur sont donc reproduits, y compris le « 8 avant / 0
après » du bundle : la mesure est causale, pas corrélée — remettre le réexport ramène exactement
huit fichiers.

### C1 — le canal du protocole

Tenu. Au-delà du test livré (qui n'exerce que `db:generate`), j'ai piloté le **vrai binaire** en
`stdio` brut sur cinq dépôts temporaires et classé chaque ligne de `stdout` :

| Chemin | Lignes non-JSON-RPC sur `stdout` | Où part la sortie |
|---|---|---|
| régénération volumineuse (20 000 lignes) | 0 | 629 ko sur `stderr` |
| régénération en échec (code 3) | 0 | `stderr`, refus nommé dans la réponse d'outil |
| `db:migrate` lancé (`applyMigrations: true`) | 0 | `stderr` |
| `db:migrate` en échec (code 4) | 0 | `stderr`, message d'erreur rendu par le SDK |
| échec de `spawn` (`PATH` sans `pnpm`) | 0 | refus `spawn pnpm ENOENT`, restauration annoncée |

Aucun de ces cinq chemins ne bloque, ne fait sortir le processus prématurément, ni ne laisse
tomber le message d'erreur. Le `2` du tableau `stdio` est bien un descripteur du parent, pas un
mode : la sortie n'est pas supprimée, elle est déplacée.

Le filet est unique — `src/bin.test.ts`, au point de composition — mais il est **au bon endroit**
et il mord (1 rouge sur mutation). Le reste de `src/` est tenu par la garde d'ADR 042.

### M1 — l'interface partagée, jugée

Le changement de `ToggleOutcome` est **purement additif** : un champ `migrations` en plus,
aucun champ retiré, renommé, ni dont la sémantique change. Mesuré sur deux dépôts temporaires
identiques, `ks toggle facturation --json` d'un côté, `toggle_module` de l'autre :

- les neuf clés communes (`action`, `moduleId`, `nextEnabled`, `alsoEnabled`, `enabled`,
  `reordered`, `droppedComments`, `migrations`, `migrationsApplied`) sont **identiques octet pour
  octet**, `migrations` comprise ;
- la façade MCP ajoute `modifiedFiles` et `notices`, par conception (un agent n'a pas la sortie
  terminal sous les yeux).

Un consommateur de `ks toggle --json` qui lit les clés existantes ne voit rien changer. Aucune
documentation ne fige la forme de cette sortie (aucune occurrence de `migrationsApplied` dans
`docs/` ni dans les `AGENTS.md`), donc rien n'est rendu faux par l'ajout. Changement d'interface
acceptable.

### M2 — le générateur, éprouvé de bout en bout

`ks scaffold sonde-revue` sur le dépôt réel, puis `pnpm install` (le lien de workspace, que la
première revue n'avait pas fait), puis les six commandes :

| Commande | Résultat avec le module généré |
|---|---|
| `pnpm typecheck --force` | 25/25 |
| `pnpm lint --max-warnings=0` | aucun problème |
| `pnpm test` | 1520 verts (les 4 cas que le nouveau package ajoute), 6 ignorés |
| `pnpm build --force` | succès |
| `E2E_PORT=3141 pnpm test:e2e` | 79 verts, 7 ignorés |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert |

Le squelette généré passe la suite. Module retiré, `pnpm-lock.yaml` restauré,
`pnpm install --frozen-lockfile` rejoué, arbre propre.

### ADR 042 — la décision, jugée

**Bonne décision.** Son argument porteur est vérifié dans le code, pas seulement plausible :
`tooling/eslint/boundaries.ts` n'autorise `presentation` qu'à importer `application` et
`domain`. Ranger `server.ts` en `presentation` et `file-changes.ts` (qui lit le disque) en
`infrastructure` produirait donc, dès le premier import, une violation de la règle même qu'on
prétendait faire appliquer. Les trois options rejetées sont nommées avec leur coût, et la
troisième (« interdire tout module sans les quatre couches ») est rejetée sur un fait exact.

**La garde de remplacement mord**, aux trois endroits, mesuré ci-dessus : fichier plat ajouté
dans un module sans `src/bin.ts` (2 rouges), `child_process` importé hors du point de
composition (1 rouge), baril réexportant autre chose que le contrat (1 rouge). Elle **dérive**
la liste des modules et de leurs fichiers au lieu de la recopier : un module nouveau y entre
seul. L'ADR nomme lui-même sa limite (trois mécanismes, pas une liste exhaustive), ce qui est
la forme demandée par `AGENTS.md` racine.

Deux angles morts que l'ADR ne nomme pas, tous deux mineurs et notés ci-dessous : l'extension
`.tsx` et l'exemption en bloc de `emails/`.

### La correction de fait apportée par l'implémenteur — **exacte**

La première revue écrivait, en M3, que « `mcp-server` est le seul module du dépôt sans les
quatre couches ». C'est **inexact**, et l'implémenteur a raison de le relever. Relevé sur les dix
modules de `packages/modules/` :

- `i18n/src/` ne contient que `domain/`, `application/` et `messages/` — ni `infrastructure/`,
  ni `presentation/` ;
- `auth`, `demo-enabled`, `marketing` et `organizations` portent un dossier `emails/` hors des
  quatre couches, contenant du `.ts` (`auth/src/emails/magic-link.ts`, etc.) — donc, eux aussi,
  des fichiers qu'aucun motif d'ADR 006 ne classe ;
- les dix modules portent un `messages/`, sans `.ts`, hors couches également.

Ce que la première revue aurait dû écrire : *aucun module n'a la totalité de ses fichiers `.ts`
sous les quatre couches ; `mcp-server` est le seul dont le code exécutable vit intégralement
hors d'elles*. La correction a fait écrire la bonne règle — celle des fichiers hors de portée,
pas celle des dossiers présents. Une revue qui affirme faux fait corriger la mauvaise chose :
acté ici pour que la prochaine ne reparte pas de l'affirmation d'origine.

### Constats de cette seconde revue

Aucun critique, aucun majeur.

#### Mineur

**m1 (reporté de la première revue, toujours ouvert).** `AGENTS.md` racine ligne 189 décrit
encore `pnpm ks` comme « le CLI de modules : `list` et `toggle` », sans `scaffold` ni le refus
sur dépôt sale. La règle du dépôt est pourtant explicite : « Docs ship with the code that
changes them. » Le tour de correction ne l'a pas repris.

**m4 — `AGENTS.md` racine §4 dit encore qu'un module « lives in `packages/modules/<name>` with
four layers », sans nommer l'exception qu'ADR 042 vient de créer.** Le fichier racine défère aux
ADR (« unless an ADR says otherwise »), donc rien n'est faux ; mais l'agent qui lit la ligne 10
avant l'ADR 042 conclura que `mcp-server` est en infraction. Une incise suffirait.

**m5 — la garde d'ADR 042 ne regarde que les `.ts`.** `sourceFiles` filtre sur
`.endsWith('.ts')` : un `packages/modules/<m>/src/quelquechose.tsx` posé à plat n'est classé ni
par le lint d'ADR 006 (motifs de dossier) ni par la garde. L'angle mort est celui-là même que
l'ADR entend fermer, sur une extension que ce dépôt utilise partout ailleurs.

**m6 — `CONTRACT_DIRECTORIES = ['emails']` exempte en bloc, sans ADR.** Les `.ts` de
`auth/src/emails/` restent hors de portée d'ADR 006 *et* de la garde. L'exemption est
raisonnable (ce sont des gabarits déclarés par le contrat), mais elle est décidée dans un
tableau de test, pas dans l'ADR qui traite justement des fichiers hors couches.

**m7 — le nouveau `describe` de `tests/agents-md.test.ts` n'a pas de plancher.** Le bloc voisin
en a deux, explicitement, « sans quoi un motif qui ne matche plus rien rendrait toutes les
assertions vertes sur zéro package ». Le cas « nomme chacune des dépendances que son
`package.json` déclare » boucle sur `declaredDependencies(...)` sans vérifier que la liste n'est
pas vide : un gabarit qui cesserait de déclarer des dépendances rendrait le test vert.

**m8 — le commentaire d'en-tête de `src/server.ts` surestime son filet.** Il affirme que
« `tests/*` prouve l'invariant en comparant les deux sorties sur la même configuration ». Mesuré :
aucun fichier de `tests/` ne mentionne ce module, et la seule comparaison des deux façades vit
dans `src/server.test.ts`, pour `list_modules` seulement. La délégation à `runToggle` rend
désormais la divergence structurellement impossible sur le toggle — le filet n'est plus
nécessaire, mais la phrase reste une affirmation mesurable et fausse, la cinquième forme d'échec
du dépôt. (Antérieure au delta ; relevée ici parce que le delta la rend plus visible.)

**m9 — la charge utile de `toggle_module` porte `nextEnabled` **et** `enabled`, deux clés de
valeur identique**, `nextEnabled` n'étant même pas déclarée par `ToggleOutcome` (elle vient du
spread de `plan`). Antérieur au delta côté `ks --json` ; nouveau côté MCP, où le spread de
l'`outcome` complet l'expose à un agent. Du bruit, pas un défaut.

### Non vérifié

- **Aucun client MCP de production.** Le serveur n'a été piloté que par le `Client` du SDK et
  par mon `stdio` brut. Geste humain : brancher `mcp-client.example.json` dans Claude Code ou
  Claude Desktop, appeler `list_modules` puis `toggle_module`, et vérifier qu'aucun avertissement
  de protocole n'apparaît dans le journal du client.
- **`mcp-client.example.json` n'a toujours jamais servi** ; son `args` relatif suppose que le
  client démarre à la racine du dépôt. Geste humain : le lancer depuis un autre répertoire de
  travail.
- **`applyMigrations: true` contre une vraie base par MCP.** Mes cinq chemins de sous-processus
  utilisent des scripts `node -e` dans un dépôt temporaire : j'ai mesuré le canal et les codes de
  retour, pas l'effet sur PostgreSQL. Geste humain : `toggle_module` avec `applyMigrations: true`
  sur un module à migrations, base de développement branchée, puis `pnpm db:migrate` une seconde
  fois pour vérifier l'idempotence.
- **Pas de clone frais.** Le squelette généré a été éprouvé par `pnpm install` dans le worktree
  existant, pas depuis un clone vierge.
- **Windows** : rien n'a été exécuté hors POSIX. Le descripteur `2` passé à `spawn` n'a pas été
  éprouvé sous Windows.
- **Aucun écran** dans cette story : pas de preuve navigateur attendue. Les 79 parcours
  Playwright ne prouvent que l'absence de régression.
- **Liste non exhaustive.** Ce qui précède est ce que ce passage a balayé : les six mutations du
  tableau, les cinq chemins de sous-processus, les deux configurations de modules, les six
  commandes dans chacune, plus les six commandes sur un module généré. Je ne prétends pas avoir
  couvert tous les cas.

### Verdict de la seconde revue

Le critique C1 est corrigé au bon endroit et son filet mord. Les quatre majeurs sont fermés,
chacun mesuré et non lu. Le changement du moteur partagé est additif et les deux façades rendent
la même chose. ADR 042 est une décision défendable, dont la prémisse est vérifiée dans le code
et dont la garde de remplacement mord aux trois endroits. Restent neuf mineurs, dont deux
angles morts nommés de la nouvelle garde et une documentation racine en arrière d'une commande
et d'une exception.

Max severity: minor
Ship allowed: yes
