# Revue — Story s05-cli-toggle-module

Diff jugé : `0262b01`. Contrat : `docs/plans/s05-cli-toggle-module.md` (9 tâches, interdits, « point qui décide de tout »), `docs/research/s05-cli-toggle-module.md`, `docs/stories.md` s05 (neuf critères), `docs/reliability.md` §1 et §2, `AGENTS.md` racine et `packages/cli/AGENTS.md`, ADR 011, 013, 016.

## Ce que j'ai exécuté moi-même

| Commande | État A `['demo-enabled']` | État B `[]` | État C les deux |
|---|---|---|---|
| `pnpm test` | 228 ✅ | 228 ✅ | 228 ✅ |
| `typecheck` / `lint` / `build --force` / `run audit` | ✅ | ✅ | ✅ |
| `pnpm test:e2e` | 6/6 ✅ | 6/6 ✅ | **5/6 ❌** |

La suite Vitest est bien agnostique dans les trois états. Le seul rouge est `e2e/modules.spec.ts:43`, **intouché par ce diff** et déjà consigné comme trou s03 à traiter avant s26. Conséquence factuelle : la *Definition of Done* du plan (« verts dans les trois états ») n'est pas atteinte, pour une cause antérieure à cette story.

Le CLI a été piloté de bout en bout sur une **copie** du dépôt, jamais contre le dépôt vif : `list`, `list --json`, activation avec requis manquant, `--with-requires`, désactivation d'un module dont un autre dépend, aller-retour, régénération en échec, cycle activation/désactivation/réactivation contre la base. Dépôt vif vérifié propre.

## Vérification anti-hallucination

Ouvert et confronté un par un : `resolveEnabledModules`, `ModuleConfigurationError`, `AnyModuleDefinition`, `defineModule`, `module.migrations: string | null`, `register` de `tsx/esm/api`, et de `ts-morph@28.0.0` : `IndentationText`, `QuoteKind`, `SyntaxKind.{AsExpression,SatisfiesExpression,ParenthesizedExpression,ArrayLiteralExpression,StringLiteral}`, `ArrayLiteralExpression.{getElements,removeElement,addElement}`. **Aucune API inventée.** `npx ks list`, `pnpm ks list` et l'exécution depuis `apps/web` fonctionnent ; hors dépôt, le refus est explicite.

## Preuve par neutralisation

| # | Invariant neutralisé | Rouges |
|---|---|---|
| M1 | boucle de **retrait** de `writeEnabledModules` rendue inerte | **4** |
| M2 | `manipulationSettings` entiers supprimés | **1** |
| M2a | `indentationText` seul | **1** |
| M2b | `quoteKind` seul | **0** |
| M2c | `useTrailingCommas` seul | **1** |
| M3 | `refusalOf` renvoie toujours `null` (plus de délégation à `@repo/core`) | **4** |
| M4 | restauration des dossiers d'artefacts retirée | **1** |
| M5 | `authorized` forcé à `true` (migrations toujours appliquées) | **1** |
| M6 | dossiers de migrations retirés de `generatedPaths` | **0 / 228** |
| M7 | `config/features.ts` non restauré après échec | **1** |

La revendication sur `useTrailingCommas` est **confirmée par mesure**, `indentationText` aussi ; `quoteKind` en revanche est inerte (`quoteOf` dérive déjà le guillemet du fichier). M1 et M6 sont les deux trous.

Les tests sont de la vraie couverture : aucun n'asserte une classe CSS, une structure DOM, un libellé statique ou un inventaire de props. `toggle.test.ts` fabrique son propre annuaire et éprouve un graphe que le dépôt ne contient pas, cycle compris.

## Findings

### F1 — critical — Le toggle inverse ne rend pas le fichier identique, et détruit le commentaire de l'entrée retirée

Critères 2 (« en préservant le formatage **et les commentaires** ») et 8 (« toggle puis toggle inverse laisse le fichier identique ») ne tiennent que si le module basculé est le **dernier** élément.

`writeEnabledModules` retire d'abord, ajoute ensuite — et `addElement` **appose en fin de liste**. La position d'origine n'est jamais restituée :

```
ORIG: "['demo-enabled', 'demo-disabled'] as const"
ONCE: "['demo-disabled'] as const"
BACK: "['demo-disabled', 'demo-enabled'] as const"
IDENTIQUE ? false
```

Sur une liste multiligne, le commentaire attaché à l'entrée retirée disparaît et le toggle inverse ne le ramène pas. C'est exactement ce que l'approche AST existe pour empêcher : le fichier « écrit pour être lu » perd silencieusement une ligne du propriétaire, sur le geste central du produit.

**Aucun test ne le voit, et c'est structurel** : les trois aller-retours du diff ne basculent que l'élément **final** ou l'unique élément. Le fichier réel n'ayant qu'un module activé, la suite est verte — et le restera jusqu'au deuxième module activé du premier projet client.

Corroboration du piège annoncé par la recherche : le test « sur une liste multiligne à virgule finale » **passe encore avec la boucle de retrait neutralisée** (M1). Retrait no-op suivi d'ajout no-op = fichier d'origine. Le test voisin n'asserte qu'un `toContain` sur le commentaire, jamais que l'élément a été retiré. Le retrait multiligne n'est prouvé par rien ; vérifié à la main, il fonctionne — mais la virgule finale saute quand c'est le dernier élément qu'on retire.

Ce qu'il faut : insérer à la position d'origine plutôt qu'appendre, et un test d'aller-retour sur un élément **non final** d'une liste multiligne **commentée** — le seul cas qui distingue une préservation d'une coïncidence.

### F2 — major — `ks toggle --json` produit une sortie que rien ne peut analyser

`arguments.ts` promet « sortie lisible par une machine », `packages/cli/AGENTS.md` le répète, ADR 013 en fait la raison d'être du mode non interactif. Mesuré :

```
$ ks toggle demo-disabled --json 2>/dev/null | node -e "…JSON.parse…"
PARSE ECHOUE: Unexpected token '>', "
```

En `--json`, `environment.print` reste `console.log` et le sous-processus est lancé en `stdio: 'inherit'` : la sortie de `pnpm db:generate` puis trois lignes de prose française précèdent le JSON sur **stdout**. `ks list --json` est propre — c'est le seul cas testé. `ks toggle --json` ne l'est pas, et c'est la commande que l'agent appelle pour **agir**.

### F3 — major — `src/bin.ts` n'est couvert par aucun test

M6 : j'ai supprimé de `generatedPaths` la totalité des dossiers de migrations — donc la moitié de la promesse d'atomicité que le message de commit met en avant — et lancé la suite complète : **228 passed, zéro rouge.**

Le mécanisme fonctionne, je l'ai prouvé à la main, mais rien ne le protège. `bin.ts` (analyse, détection TTY, remontée jusqu'à la racine, câblage de `generatedPaths`, `spawn`, traduction des codes de sortie) est le seul fichier du package sans une ligne de test — alors que c'est lui qui décide de ce sur quoi la transaction porte. « Point de composition » explique pourquoi il n'est pas *unitaire* ; pas pourquoi il n'a aucun test d'intégration sur dépôt temporaire.

### F4 — minor — Une interruption entre l'écriture et la régénération laisse un état intermédiaire sans consigne

Le plan nomme ce point. `applyToggle` n'a ni gestionnaire de signal ni journal sur disque : la photographie ne vit qu'en mémoire.

Bonne nouvelle mesurée : la garde de divergence de s04 **mord vraiment** — configuration avancée sans régénération, `tests/module-migrations.test.ts` passe au rouge. L'état intermédiaire est donc bruyant. Il n'est simplement pas *explicite* au sens du §2 : rien ne dit quoi rejouer. Une ligne d'aide suffirait.

### F5 — minor — Critère 7 vrai mais non prouvé mécaniquement

Le test le plus proche s'arrête à la désactivation ; le troisième temps — réactiver et retrouver la donnée — n'est couvert nulle part.

**Recette manuelle exécutée** via le CLI : activer avec migrations, insérer une ligne, désactiver (table et donnée conservées), réactiver → la donnée est là. Le critère est **vrai**, il n'est pas **prouvé**. Automatisable avec l'infrastructure de s04.

### F6 — minor — Le refus de désactivation affirme une cause qu'il n'a pas vérifiée

Le refus est systématiquement préfixé par « un module activé en dépend », quelle que soit la raison réelle. Et la phrase déléguée est contre-factuelle à la lettre : « `demo-enabled` … n'est pas activé dans config/features.ts » alors qu'il l'est au moment où le message s'affiche — le message décrit la configuration **candidate**, pas le fichier.

### F7 — minor — `snapshotDirectory` confond « dossier absent » et « lecture en échec »

Tout `catch` renvoie `{ existed: false }`, et la restauration traite alors le cas comme un `rm -rf` définitif. Une erreur de lecture transitoire sur un dossier `migrations` existant transformerait la restauration en **suppression du SQL versionné** d'un module — ce qu'ADR 016 interdit. Probabilité faible, conséquence maximale ; distinguer `ENOENT` coûte une ligne.

### F8 — minor — Divers

`--help` et `-h` sont refusés comme options inconnues (code 1). Une erreur non classée fait imprimer l'`USAGE` complet, suggérant à tort une faute d'invocation. `packages/cli/src/index.ts` (33 lignes de réexports) n'a **aucun consommateur**. `ts-morph@28` embarque **TypeScript 6.0.2** alors que le dépôt compile en 7.0.2 : le fichier de configuration est relu par un analyseur d'une majeure antérieure — sans effet aujourd'hui, mais non consigné. Le message de commit dit « seule dépendance ajoutée » alors que `tsx` est aussi déclaré et que `ts-morph` amène trois transitives.

## Jugement des écarts au plan

**Les deux drapeaux non nommés (`--with-requires`, `--apply-migrations`) : justifiés, à conserver.** Hors terminal, une proposition sans canal de réponse n'est qu'un refus définitif : sans eux, un agent ne pourrait jamais activer un module à requis manquant, et le CLI raterait la moitié de son public (ADR 013). Opt-in, refusés par défaut, et M5 prouve que c'est le seul chemin non interactif qui autorise.

**Aucune bibliothèque de CLI : justifié.** Deux commandes et trois drapeaux ne justifient pas une dépendance (§6). Le risque réel d'un analyseur maison — absorber une faute de frappe — est fermé et testé.

**`tsx` en `dependencies` : acceptable.** Package privé, sans étape de build, exportant ses sources : `tsx` est une dépendance d'exécution réelle.

**Script racine `node bin/ks.mjs` : meilleur que ce que le plan suggérait** — le même fichier sert de `bin`, donc `npx ks` fonctionne.

**Restauration plus large que demandée : bon réflexe, non protégé.** J'ai cassé la régénération **après** l'écriture des barils **et** d'une vraie migration `0001`. Après le refus du CLI : `git status --porcelain` **vide**, aucun fichier non suivi. Restauration octet pour octet des trois surfaces, confirmée. Revers en F3 : aucun test ne la tient.

## Interdits

Aucun violé. Aucune commande de nettoyage sous aucun nom (l'unique mention est « Il n'existe aucune commande pour les retirer », et un test interdit le vocabulaire destructeur en sortie). Aucune réimplémentation du graphe (M3). L'annuaire n'est jamais édité. Aucune migration d'office (M5). Ni Hono, ni oRPC, ni module applicatif réel.

## État des neuf critères

| # | Critère | Verdict |
|---|---|---|
| 1 | `npx ks list` | **prouvé** |
| 2 | Préserve formatage **et commentaires** | **non satisfait** — F1 |
| 3 | Requis absent : propose ou refuse en nommant | **prouvé** |
| 4 | Désactivation refusée, dépendant nommé | **prouvé**, libellé perfectible (F6) |
| 5 | Génère et **propose** les migrations | **prouvé** |
| 6 | Informe de la conservation, ne supprime rien | **prouvé** |
| 7 | Activer / désactiver / réactiver retrouve les données | **vrai, non prouvé** — F5 |
| 8 | Toggle + inverse ⇒ fichier identique | **non satisfait** en général — F1 |
| 9 | Tests sur dépôt temporaire | **prouvé** |

## Ce que je n'ai pas pu vérifier

- **Le mode interactif réel.** `process.stdin.isTTY` n'est jamais vrai depuis mon environnement : les invites n'ont été exercées que par une doublure. **Geste humain** : `pnpm ks toggle demo-disabled` dans un vrai terminal, répondre « o », rejouer en répondant « n » et vérifier qu'un refus n'écrit rien ; puis Ctrl-C sur la question des migrations.
- **La coupure franche du processus.** Le `pnpm db:generate` lancé en `stdio: 'inherit'` **survit** à la mort du parent et termine la régénération. Le diagnostic de F4 vient donc de la lecture du code plus de la vérification que la garde s04 rougit, pas d'une coupure observée au bon instant.
- **Les migrations sur une autre base.** Jamais essayé sur base vierge ni distante ; `run()` n'a aucun délai d'attente — un `db:migrate` qui pend fera pendre `ks` indéfiniment.
- **Au-delà de trois modules.** F1 est démontré sur des chaînes, pas sur un dépôt à cinq modules activés — c'est pourtant là qu'il fera mal.
- **Windows et les fins de ligne.** Rien n'a été essayé avec des `\r\n` ; sur un clone en `core.autocrlf`, l'identité octet pour octet est une question ouverte.

Max severity: critical
Ship allowed: no
