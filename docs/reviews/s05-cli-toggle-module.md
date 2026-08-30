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

**Verdict de la première passe : sévérité maximale « critical », ship refusé.** (Les
deux lignes machine de cette passe ont été transformées en prose par la troisième :
le fichier ne doit porter qu'un seul verdict lisible par la porte, celui de la fin.)

---

# Troisième passe — diff `67a87e9..64264c2`

Périmètre : le second commit de correction seul (F9, F10, F11, F13, F14 + application
d'ADR 019). Les passes une et deux ne sont pas rejouées. Contrat relu : ADR 019,
ADR 016, `docs/stories.md` critère 8 dans sa **nouvelle** rédaction,
`packages/cli/AGENTS.md`, `docs/plans/s05-cli-toggle-module.md`,
`docs/research/s05-cli-toggle-module.md`.

Note de forme : la **deuxième** passe n'a jamais été écrite dans ce fichier
(`git log -- docs/reviews/s05-cli-toggle-module.md` ne rend que `18d32dd`). Ses
findings F9 à F14 ne sont connus que par le message de tâche et par les commits.
Le dossier de revue de la story a donc un trou entre la première et la troisième
passe.

## Ce que j'ai exécuté moi-même

| Commande | État A `['demo-enabled']` | État B `[]` | État C les deux |
|---|---|---|---|
| `pnpm test` | **253 ✅** | 253 ✅ | 253 ✅ |
| `typecheck` (turbo `--force`) / `lint` / `build --force` / `run audit` | ✅ | ✅ | ✅ |
| `pnpm test:e2e` | 6/6 ✅ | 6/6 ✅ | **5/6 ❌** |

Les états B et C ont été produits **par le CLI lui-même**, sur une copie complète du
dépôt (`/private/tmp/.../scratchpad/repo`), jamais sur le dépôt vif. Le seul rouge est
`e2e/modules.spec.ts:43` dans l'état « les deux activés » : c'est le trou s03 déjà
consigné, intouché par ce diff. Dépôt vif vérifié propre (`git diff --exit-code`, code 0)
avant écriture de ce rapport.

Anti-hallucination sur les paquets installés : `ts-morph@28.0.0` confronté au binaire
présent — `Project`, `SyntaxKind`, `ArrayLiteralExpression`, `Node`, `SourceFile`, et
sur le nœud rendu par `getInitializer()` : `getStart`, `getEnd`, `getFullStart`,
`getElements`, `getText`, `asKind` existent et rendent les positions attendues.
`IndentationText` et `QuoteKind` ne sont plus importés **et** plus référencés nulle part
(`git grep`). `Array.prototype.at(-1)` est disponible sur le Node exigé (`>=20.10`).
`NEWLINE` n'est pas globale : ni `exec` ni `test` ne traînent de `lastIndex`.
Aucune API inventée. Le seul consommateur de `writeEnabledModules` est `applyToggle`,
et `EnabledModulesEdit` remonte jusqu'à `ToggleOutcome` : la signature changée n'a
laissé aucun appelant en arrière (`packages/cli/src/index.ts`, sans consommateur, a
disparu au premier tour).

## Preuve par neutralisation

Mutations appliquées une par une sur le dépôt vif, suite `packages/cli` (60 tests)
relancée à chaque fois, puis `git checkout --` et `git diff --exit-code` vérifié
propre après **chacune**.

| # | Invariant neutralisé | Rouges |
|---|---|---|
| M8 | virgule finale traitée comme propriété de la dernière **entrée** (`comma = last ? '' : ','`) | **10** |
| M9 | `canonicalOrder` rendue inerte (l'ordre du fichier l'emporte) | **4** |
| M10 | `reordered` toujours vide | **2** |
| M11 | `droppedComments` toujours vide | **2** |
| M12 | `ENOENT` d'un **fichier** relu comme absence du dossier (comportement d'avant F10) | **1** |
| M13 | `tail` vidé : le commentaire de fin de ligne n'appartient plus à son entrée | **1** |
| M14 | `\r\n` du rendu ramenés à `\n` | **1** |

Les cibles de M2/M2a/M2c de la première passe ont disparu avec
`manipulationSettings` : elles sont remplacées par M8, M13 et M14, qui mordent. Aucun
trou du type M1 (le retrait ne peut plus passer par l'accident du no-op : M8 le prouve
dans les deux sens, et le retrait d'une entrée non finale est asserté à l'octet).

## Vérification des findings de la deuxième passe

**F9 — clos.** L'écriture n'est plus une manipulation d'AST mais un découpage du texte
d'origine. Vérifié aux deux sens, sur liste multiligne avec et sans virgule finale :
retirer la dernière entrée d'une liste à virgule finale laisse la virgule finale ;
retirer la dernière d'une liste sans virgule finale n'en ajoute pas ; réinsérer rend
l'octet d'origine. M8 = 10 rouges.

**F10 — clos, reproduit.** `existed: false` ne peut plus venir que du `readdir` de
premier niveau ; tout le reste passe par `unreadable`, et `applyToggle` prend ses
photographies **avant** le premier `writeFile`. Reproduit avec le vrai CLI sur la copie :
lien symbolique cassé déposé dans `generated/schema`, `ks toggle demo-disabled` refuse
(code 1, « Impossible de lire … / Aucun module n'a été basculé »), `config/features.ts`
et les barils intacts. M12 = 1 rouge.

**F11 — clos pour les commentaires de ligne.** `ownedStart` coupe après le premier
retour à la ligne : ce qui reste sur la ligne de la virgule est le `tail` de l'entrée
**précédente**. Vérifié : `'facturation', // coupable en démo` part avec facturation,
`'socle'` ne récupère rien. M13 = 1 rouge. Voir F16 pour ce qui reste dehors.

**F13 — clos.** Balayage complet en CRLF : 64 allers-retours identiques à l'octet, zéro
ligne mêlée. M14 = 1 rouge.

**F14 — clos.** La limite est écrite dans `packages/cli/src/features-file.ts` (deux
sections d'en-tête), dans `packages/cli/AGENTS.md` (§4), figée par un test qui porte sur
une entrée **qui porte** un commentaire (`droppedComments` vaut `['roadmap']`, et la
réactivation ne rend pas le texte), et dite par le CLI. Mesuré de bout en bout sur la
copie : `ks toggle demo-disabled --json` rend sur **stdout** un JSON analysable qui
contient `"droppedComments": ["demo-disabled"]`, et sur **stderr** la phrase qui nomme
le fichier et dit que la réactivation ne rétablira rien.

## ADR 019 — implémentation

Ordre canonique appliqué dans les **deux** sens : `planToggle` passe par
`canonicalOrder` à l'activation comme à la désactivation (M9 = 4 rouges, dont le test
de normalisation en désactivation). `reordered` est calculé contre le **fichier
d'origine** — `keptBefore` vient de `layout.slots`, `keptAfter` de `next` filtré sur ce
que le fichier contenait — et non contre la demande, qui porte déjà la normalisation.
Vérifié aussi qu'un ajout intercalé qui ne change pas l'ordre **relatif** des entrées
conservées n'annonce rien : c'est correct, il n'y a pas eu de normalisation.
L'annonce est imprimée (`announce`, appelée dans les deux branches de `runToggle`),
nomme `config/features.ts`, la raison et l'ADR, et les deux champs voyagent dans
`--json` via `ToggleOutcome`. Un identifiant inconnu de l'annuaire est renvoyé en fin de
liste plutôt qu'écarté, et c'est bien `resolveEnabledModules` qui le refuse ensuite.

Le critère 8 réécrit est tenu : sur un fichier canonique et sans commentaire, tous mes
allers-retours sont identiques à l'octet.

## Mon propre balayage exhaustif

4 modules, 16 sous-ensembles, 7 mises en forme (une ligne ; multiligne à virgule
finale ; multiligne sans virgule finale ; commentaires de tête ; commentaires de fin de
ligne ; guillemets doubles ; CRLF), les 4 bascules pour chaque état = **448
allers-retours**. Chaque texte intermédiaire est repassé par l'analyseur et compté
invalide au moindre diagnostic de syntaxe.

Résultat : **376 identiques à l'octet, 72 non identiques, 0 syntaxiquement cassé.**
Les 72 se décomposent exactement comme l'implémenteur l'annonce : **64** par la perte
du commentaire de l'entrée retirée (toutes annoncées dans `droppedComments` : le
sous-ensemble « différent sans commentaire perdu annoncé » vaut exactement 8), et **8**
par le passage à l'état vide d'une liste d'une seule entrée (virgule finale et
guillemets réappliqués à la convention du dépôt). Ces 72 sont acceptables au regard
d'ADR 019 et des critères 2 et 8 : la seule non-identité non annoncée est la
réapplication de convention sur une liste vidée, dont le fichier ne porte plus la trace.
Aucune ne bloque.

Ce que mon balayage ajoute, et qui n'est pas dans le sien : deux mises en forme
adverses (crochet fermant collé à la dernière entrée) donnent **11 fichiers invalides
sur 64** chacune. Voir F15.

## Findings

### F15 — major — Une entrée à commentaire de fin de ligne rendue en dernier avale le crochet fermant

Condition : le crochet fermant n'est pas sur sa propre ligne (`'demo-disabled'] as const`,
mise en forme légale et qu'un humain écrit), et une entrée porte un commentaire `//` de
fin de ligne. Le cas le plus court est une **simple désactivation**, sans le moindre
réordonnancement :

```
export const enabledModules = [
  'a', // note a
  'b'] as const
```
donne
```
export const enabledModules = [
  'a' // note a] as const
```

`render` ne garantit pas qu'un `tail` soit suivi d'un retour à la ligne : la virgule
disparaît (l'entrée devient la dernière d'une liste sans virgule finale) et le
commentaire court jusqu'à la fin du fichier. `] as const satisfies …` est commenté, le
fichier ne compile plus.

Le garde-fou que le module revendique — « l'écriture est relue avant d'être rendue » —
**ne voit rien** : la récupération d'erreur de TypeScript rend quand même une liste de
deux éléments, `readEnabledModules` est content, et `writeEnabledModules` rend ce texte.
Mesuré : 11 fichiers invalides sur 64 sur cette mise en forme, et autant sur sa variante.

Ce qui sauve le dépôt est **accidentel mais fiable** : `pnpm db:generate` importe
`config/features.ts`, esbuild refuse (« Expected "]" but found end of file »),
`applyToggle` restaure. Piloté de bout en bout sur la copie : code 1, `config/features.ts`
rendu à l'octet, `git status` propre. La tâche `db:generate` est en `cache: false` dans
`turbo.json` : ce chemin est donc toujours emprunté, il n'existe pas de variante muette.
D'où **major** et non critical : rien n'est perdu, rien n'est laissé entre deux états.

Reste réel : sur un tel fichier, `ks toggle` est **définitivement impossible**, et le
message accuse la régénération au lieu de dire que c'est le CLI qui a produit un fichier
invalide. Direction de correction : garantir qu'un `tail` non vide est suivi d'un retour
à la ligne (ou refuser en le disant), et relire le rendu avec les **diagnostics de
syntaxe**, pas seulement avec la liste relue.

### F16 — major — Le commentaire de bloc sur la même ligne n'appartient pas à son entrée, et le CLI n'en dit rien

`ownedStart` ne rend une entrée propriétaire que de ce qui suit un retour à la ligne.
Tout ce qui est écrit sur la même ligne qu'une entrée, **avant** elle, tombe dans `open`
ou dans `between`, qui sont des propriétés de **position**. Trois mesures :

- `[/* le pilote */ 'alpha', 'beta']`, on retire `alpha` → `[/* le pilote */ 'beta']`.
  Le commentaire du propriétaire décrit désormais **le mauvais module**, en silence :
  `droppedComments` est vide. C'est exactement ce qu'ADR 019, l'en-tête de
  `features-file.ts` et le §4 de `packages/cli/AGENTS.md` désignent comme la chose à ne
  jamais faire.
- `['alpha', /* le pilote */ 'beta']`, on retire `alpha` → `['beta']` : le commentaire est
  **supprimé** sans figurer dans `droppedComments`.
- `'alpha' /* pilote */,` : le commentaire part bien avec son entrée (il est dans
  `preComma`), mais `carriesComment` n'inspecte que `lead` et `tail` — la perte n'est pas
  annoncée non plus.

Le cas courant (commentaire de ligne, au-dessus ou en fin de ligne) est, lui, correct.
Mais `packages/cli/AGENTS.md` affirme « Ces trois points sont les seules non-identités
connues d'un aller-retour » : l'affirmation est fausse, et c'est elle qui rend le défaut
gênant — le prochain agent lira une exhaustivité qui n'existe pas. Soit ces commentaires
deviennent la propriété de l'entrée qui les suit, soit ils sont comptés dans
`droppedComments`, soit la limite est écrite.

### F17 — minor — Le chiffre « 576 allers-retours » ne ferme pas

`features-file.ts` et `packages/cli/AGENTS.md` annoncent « 576 allers-retours (quatre
modules, tous les sous-ensembles, sept mises en forme) : 504 identiques, 64 …, 8 … ».
Quatre modules × seize sous-ensembles × sept mises en forme = **448**, pas 576. Mon
balayage indépendant rend 448 avec **exactement** la même décomposition des écarts
(64 + 8 = 72) : la mesure qualitative est juste, le total écrit dans le code ne l'est
pas — probablement neuf mises en forme comptées et sept écrites. Un chiffre dans un
commentaire n'est vérifiable que s'il est juste.

### F18 — minor — La recherche et le plan décrivent encore une édition par ts-morph

`docs/research/s05-cli-toggle-module.md` §4 (« `ts-morph` manipule l'AST TypeScript en
conservant le reste du fichier intact ») et la tâche 2 du plan (« **Édition AST** de
`enabledModules` par `ts-morph` ») décrivent le mécanisme que ce commit **retire** :
aucune API de manipulation n'est plus appelée, la prémisse mesurée est même l'inverse.
La correction est consignée là où l'implémenteur travaille (en-tête du module, §4 de
`packages/cli/AGENTS.md`), pas là où la story est documentée. Le fait vérifié de la
recherche est désormais faux et nulle part corrigé.

## Jugement des écarts déclarés

**`manipulationSettings` retiré de `new Project()` : justifié.** Ces réglages ne
servaient que les API de manipulation, qui ne sont plus appelées ; aucun autre fichier
ne les référence. Les mutations M2/M2a/M2c de la première passe n'ont plus de cible
parce que la cible n'existe plus, pas parce qu'elle a cessé d'être protégée : M8, M13 et
M14 couvrent le même terrain et mordent.

**`writeEnabledModules` rendant un objet : justifié.** Ce que l'écriture a changé sans
qu'on le lui demande devait remonter jusqu'à l'utilisateur ; le rendre dans le type est
plus honnête qu'un canal parallèle. Les deux appelants et `ToggleOutcome` suivent, et
`--json` le porte.

**Un test supprimé, deux ajoutés : justifié.** « refuse de réordonner la liste plutôt que
d'en écrire une autre » assertait le contraire d'ADR 019 ; le garde-fou qu'il protégeait
(ne jamais écrire une liste autre que celle demandée) est repris par la relecture et par
le refus du doublon, tous deux testés.

**`docs/stories.md` critère 8 : modifié par le propriétaire** (commit `5197a3b`, avec
l'ADR), pas par l'implémenteur — l'interdit « `docs/` intouché » du plan n'est pas violé.

## État des critères touchés par cette passe

| # | Critère | Verdict |
|---|---|---|
| 2 | Préserve formatage **et** commentaires | **satisfait** pour les commentaires de ligne, avec la limite annoncée ; **F16** pour les commentaires de bloc sur la même ligne |
| 8 | Toggle + inverse ⇒ fichier identique (rédaction ADR 019) | **satisfait** — 376/448 identiques, 72 écarts tous expliqués et 64 annoncés |

## Ce que je n'ai pas pu vérifier

- **Le mode interactif réel.** `process.stdin.isTTY` reste faux depuis mon environnement.
  Rien de neuf sur ce point dans ce diff, mais l'annonce d'ADR 019 n'a donc jamais été
  **vue** dans un vrai terminal. **Geste humain** : sur une copie, mettre
  `enabledModules` dans un ordre inverse de l'annuaire avec trois modules, lancer
  `pnpm ks toggle <module>` dans un terminal et lire la phrase de normalisation.
- **La normalisation d'ordre de bout en bout sur le dépôt réel.** Impossible : avec deux
  modules à l'annuaire, l'ensemble des entrées conservées lors d'une bascule n'a jamais
  plus d'un élément, donc `reordered` y est structurellement toujours vide. Prouvé sur
  annuaire synthétique à trois modules (unitaire) seulement.
- **Les migrations contre la base.** La base `app` du conteneur est **vide** (aucune
  table, aucun journal de migration) : je n'ai appliqué aucune migration et n'ai donc
  pas rejoué le cycle activer / désactiver / réactiver → données retrouvées (F5 reste
  ouvert, par décision). **Geste humain** : `pnpm db:migrate` puis le cycle complet avec
  une ligne insérée entre les deux.
- **Windows.** Le CRLF est prouvé au niveau du texte, pas sur un vrai clone en
  `core.autocrlf` ni sur un système de fichiers Windows.
- **Le comportement au-delà de quatre modules et de sept mises en forme.** Mon balayage
  est exhaustif dans ses bornes, pas au-delà.
- **L'interruption franche entre l'écriture et la régénération** (F4, ouvert par
  décision) : non rejouée cette passe.

Max severity: major
Ship allowed: yes
