# packages/cli — règles locales

Le CLI `ks` : le geste central du produit rendu exécutable. Deux commandes,
`ks list` et `ks toggle <module>`, et une seule écriture — la liste
`enabledModules` de `config/features.ts`.

Trois choses à savoir avant d'y toucher.

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

Le CLI est utilisable par un agent autant que par un humain (ADR 013) : `--json`
rend une sortie lisible par une machine, et hors terminal interactif il ne pose
aucune question — il refuse en nommant le drapeau qui aurait autorisé l'action.
Une commande qui attend une réponse sur `stdin` est inutilisable depuis la CI.

## Imports autorisés

- `@repo/core` pour la validation du graphe des modules — jamais réécrite ici ;
- `ts-morph` pour l'édition de `config/features.ts`. La seule dépendance ajoutée
  par cette story, et elle est justifiée (`docs/security.md` §6) : le fichier
  porte les commentaires du propriétaire, une réécriture par expression
  régulière les détruit, et le compilateur du dépôt (TypeScript 7, ADR 011)
  n'expose plus d'API JavaScript qui permettrait de s'en passer ;
- `tsx` pour exécuter l'entrée TypeScript depuis `bin/ks.mjs` — ce package n'a
  pas d'étape de build, comme les autres packages du dépôt ;
- les modules de Node (`node:fs/promises`, `node:readline/promises`,
  `node:child_process`) : ce package **est** un outil en ligne de commande ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

Pas de bibliothèque d'analyse d'arguments ni d'invites interactives : l'analyse
tient en une fonction pure, et `node:readline/promises` pose les questions. Une
dépendance de plus se justifie par une story, pas par une commodité.

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
