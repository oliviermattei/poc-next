# packages/cli — règles locales

Le CLI `ks` : le geste central du produit rendu exécutable. Deux commandes,
`ks list` et `ks toggle <module>`, et une seule écriture — la liste
`enabledModules` de `config/features.ts`.

Quatre choses à savoir avant d'y toucher.

**1. Le toggle est atomique du point de vue du dépôt.** Il touche la
configuration, les barils générés, et éventuellement la base. En faire deux sur
trois puis échouer livre un dépôt que la CI rejette, sans que personne sache
quoi restaurer. `applyToggle` écrit, régénère, et **restaure la configuration
d'origine** si la régénération échoue (`docs/reliability.md` §2).

**2. Le CLI régénère toujours.** La garde de divergence de s04 compare le baril
versionné à `config/features.ts` : basculer un module sans régénérer rend la
suite rouge à chaque usage de la commande la plus courante du produit.

**3. La validation du graphe n'est pas ici.** `resolveEnabledModules`
(`@repo/core`) refuse déjà un requis non activé, un cycle, une auto-référence et
un identifiant inconnu, **en nommant** les modules. Le CLI lui soumet la
configuration candidate, attrape son refus et le traduit. Une seconde
implémentation divergerait au premier cas limite, et c'est la validation qui
perdrait.

Le socle non désactivable (ADR 021) suit le même chemin : `bin.ts` lit
`requiredModules` dans `config/features.ts` et le transmet — à `planToggle`, qui
soumet la configuration candidate et refuse **avant toute écriture**, et à
`runList`, qui l'**affiche** (`socle : non désactivable`, et `required` en
`--json`). Les deux, pas l'un des deux : une règle qu'on ne découvre qu'en se
faisant refuser n'est pas lisible pour l'humain qui configure ni pour l'agent qui
lit la sortie machine (ADR 013).

**4. L'ordre de `enabledModules` est canonique, et une chose ne revient pas.**
ADR 019 : le CLI écrit toujours la liste dans l'ordre de l'annuaire. Un
aller-retour, ce sont deux invocations séparées — à la seconde, la position
d'origine du module retiré n'existe nulle part, donc seul un ordre dérivé rend
le fichier identique. Conséquence : une liste ordonnée à la main est réordonnée
à la première bascule, **et le CLI l'annonce**, en nommant le fichier et la
raison. Ne jamais rendre cette normalisation silencieuse.

La limite, elle, est réelle et assumée : **le commentaire d'une entrée retirée
part avec elle et ne revient pas.** Il lui appartient — où qu'il soit écrit :
au-dessus, devant l'entrée sur sa ligne, entre elle et sa virgule, ou derrière en
fin de ligne. Le laisser en place le réattribuerait au module voisin, et le
fichier documenterait le mauvais module. Une réactivation ne peut pas le
deviner : le texte n'est plus nulle part. `writeEnabledModules` le rend dans
`droppedComments`, `runToggle` le dit à l'utilisateur, `src/features-file.test.ts`
le fige. Deux autres, plus étroites : une liste qui passe par l'état vide perd la
virgule finale et les guillemets que portait sa dernière entrée (la convention du
dépôt est réappliquée) ; et un crochet fermant collé à la dernière entrée passe à
la ligne quand une entrée à commentaire de fin de ligne se retrouve en dernier —
sans cette coupure le `//` avalerait le `]`.

Ce sont les non-identités **connues à ce jour**, pas une liste close : elles sont
mesurées par un balayage de 768 allers-retours (quatre modules, les seize
sous-ensembles, douze mises en forme — une ligne ; multiligne avec et sans
virgule finale ; commentaires de tête ; de fin de ligne ; de bloc devant
l'entrée, collés à sa virgule, sur liste multiligne ; guillemets doubles ; CRLF ;
crochet fermant collé à la dernière entrée, avec et sans commentaires — et les
quatre bascules par état), dont **564 identiques à l'octet** et 204 écarts
répartis en 177 + 16 + 11. Une mise en forme qu'il ne couvre pas peut en révéler
une quatrième ; ce qu'aucune ne peut produire, en revanche, c'est un fichier
invalide ou un commentaire déplacé en silence : le rendu est confronté aux
**diagnostics de syntaxe** de TypeScript avant d'être enregistré — relire la
liste ne suffit pas, la récupération d'erreur la rend intacte sur un fichier
cassé — et tout commentaire perdu passe par `droppedComments`.

**5. `ks scaffold <id>` (s41) génère un paquet, il ne l'installe pas.** Il
écrit `packages/modules/<id>` avec le contrat à 13 clés déjà rempli (ADR 007),
et rien d'autre : il **n'édite jamais** `availableModules` dans
`config/features.ts` — cette ligne reste, comme documenté plus bas, le geste
de l'installation, pas du scaffolding. L'identifiant est validé en
`kebab-case` avant tout calcul de chemin : c'est ce qui empêche un
identifiant du type `../../etc` d'atteindre un chemin de fichier hors de
`packages/modules/`. Et parce qu'un agent n'a pas la garde qu'a un humain qui
relit avant de valider, `ks scaffold` refuse sur un dépôt aux modifications
non commitées (`src/git-guard.ts`, ADR 041) — refus que `ks toggle` (s05) ne
porte **pas** : son contrat et ses tests ne changent pas avec cette story.

Le CLI est utilisable par un agent autant que par un humain (ADR 013) : `--json`
rend une sortie lisible par une machine, et hors terminal interactif il ne pose
aucune question — il refuse en nommant le drapeau qui aurait autorisé l'action.
Une commande qui attend une réponse sur `stdin` est inutilisable depuis la CI.

**En `--json`, `stdout` ne porte que le JSON.** La prose française part sur
`stderr`, et la sortie des sous-processus (`pnpm db:generate`, `pnpm db:migrate`)
aussi — sans quoi la bannière de `pnpm` précède l'objet et plus rien ne
l'analyse. Rien n'est perdu pour autant : le bruit est dérouté, jamais supprimé.
`src/bin.test.ts` lance le binaire pour de vrai et **analyse** sa sortie.

## Imports autorisés

- `@repo/core` pour la validation du graphe des modules — jamais réécrite ici ;
- `ts-morph` pour **lire** `config/features.ts`, justifié
  (`docs/security.md` §6) : le fichier porte les commentaires du propriétaire,
  une réécriture par expression régulière les détruit, et le compilateur du
  dépôt (TypeScript 7, ADR 011) n'expose plus d'API JavaScript qui permettrait
  de s'en passer. **À savoir** : `ts-morph@28` embarque son propre analyseur,
  **TypeScript 6.0.2** (`@ts-morph/common`), alors que le dépôt compile en
  7.0.2. Sans effet aujourd'hui — `enabledModules` est une liste de chaînes,
  relue puis revérifiée par `pnpm typecheck` — mais une syntaxe propre à
  TypeScript 7 dans `config/features.ts` serait lue par une majeure antérieure.
  Conséquence de cet écart, désormais : un `config/features.ts` que l'analyseur
  de `ts-morph` ne sait pas lire fait **refuser** l'écriture en nommant l'erreur,
  au lieu d'être réécrit à l'aveugle.
  **Aucune API de manipulation de `ts-morph` n'est appelée** : `addElement`
  emporte la virgule finale avec la dernière entrée, `insertElement` détruit le
  commentaire de l'entrée suivante, et toutes reformatent selon leurs propres
  réglages. L'écriture est un découpage du texte d'origine, calculé sur les
  positions de l'AST (voir `src/features-file.ts`) ;
- `tsx` pour exécuter l'entrée TypeScript depuis `bin/ks.mjs` — ce package n'a
  pas d'étape de build, comme les autres packages du dépôt ;
- les modules de Node (`node:fs/promises`, `node:readline/promises`,
  `node:child_process`) : ce package **est** un outil en ligne de commande ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

Pas de bibliothèque d'analyse d'arguments ni d'invites interactives : l'analyse
tient en une fonction pure, et `node:readline/promises` pose les questions. Une
dépendance de plus se justifie par une story, pas par une commodité.

**Depuis s41, ce package a un second point d'entrée : `src/index.ts`.** Avant,
il n'exposait aucun `import` — seulement sa commande. La story du serveur MCP
exige que la seconde façade « réutilise la logique du CLI de s05, jamais une
seconde implémentation » ; extraire un nouveau paquet aurait déplacé ~600
lignes déjà couvertes (dont les 768 allers-retours mesurés sur
`features-file.ts`) pour un gain surtout cosmétique (ADR 040). `src/index.ts`
exporte donc le moteur — tout ce qui reçoit des modules et de l'environnement
en paramètre — et rien d'autre : ni `bin.ts`, ni un accès à
`config/features.ts`. `bin.ts` reste le **seul** point de composition CLI, et
`packages/modules/mcp-server` en est le second, tous deux à parts égales
consommateurs de `src/index.ts`.

`config/features.ts` n'est lu que dans `src/bin.ts` — c'est le **point de
composition**. Les fonctions de `src/` reçoivent des modules et du texte ; sans
cela, aucun test ne pourrait en composer d'autres, et les tests devraient
s'exécuter contre le dépôt courant.

Ce package ne dépend pas de `@repo/db` : la régénération et les migrations
passent par `pnpm db:generate` et `pnpm db:migrate`, les commandes documentées.
Les importer figerait ici un chemin interne de `@repo/db`.

## Ne doit jamais contenir

- **de commande de nettoyage**, sous aucun nom : un module désactivé conserve
  ses tables et ses données (ADR 016). Les supprimer serait `eject`, au
  cimetière du PRD. Le CLI **informe** de cette conservation ;
- **de migration appliquée sans autorisation explicite** : l'activation génère
  et **propose**. Une commande de configuration ne touche pas une base parce
  qu'on a tapé `toggle` ;
- de réimplémentation de la validation du graphe des modules ;
- d'édition de l'annuaire `availableModules` : y ajouter une ligne est ce que
  fait l'installation d'un module, pas un toggle ;
- de règle métier, ni de connaissance d'un module particulier — aucun
  `if (moduleId === 'billing')` ;
- d'écriture partielle laissée derrière un échec.

## Tests

`src/**/*.test.ts`, à côté du code qu'ils couvrent (`pnpm test`). Ce qui écrit
sur disque s'exécute sur un **dépôt temporaire** — une copie de
`config/features.ts` et du dossier des barils dans un répertoire jetable —
jamais contre le dépôt courant : un test qui régénère le dépôt qui l'exécute
rend la suite destructrice.

`src/bin.ts` n'est pas unitaire, ce n'est pas une raison pour le laisser sans
test : `src/bin.test.ts` lance `bin/ks.mjs` sur un dépôt temporaire et éprouve ce
qu'aucune fonction ne porte seule — la remontée jusqu'à la racine, la pureté de
`stdout` en `--json`, les codes de sortie, et **la portée de la transaction**
(les dossiers de migrations câblés dans `generatedPaths`).
