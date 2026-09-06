---
story: s40-onboarding
validated: yes
---

# Plan — s40-onboarding

> Planifié contre `dev` au commit `92242ca`, qui porte la recherche de cette story. Elle est datée du commit précédent : rien à revérifier.

## Les trois décisions que ce plan prend

**1. Un module `onboarding`, avec sa table.** Le critère 4 impose une progression persistée, et aucune table du dépôt n'en porte. Une colonne sur le compte ferait d'`auth` le propriétaire d'une donnée appartenant à un module **optionnel** — exactement ce que l'ADR 018 et la borne d'import d'`admin` refusent. Donc un module, ses quinze clés, sa migration, et ses quatre clés RGPD remplies (`dataCategories`, `retention`, `purge`, `export`) : `s34` et `s35` ont fermé la classe « une table qui n'est ni purgée ni exportée », cette story ne la rouvre pas.

**2. `Stepper` n'est pas copié.** Le design system le déclare et `packages/ui` ne l'a pas. Mais un fil d'étapes est un titre, une position et un état — `Badge`, `Separator` et le texte suffisent. Copier une primitive générique pour **un** appelant serait la généralisation que le cimetière refuse, et `s46` vient de prendre la même décision sur `Form` pour la même raison. **Le manque est reporté dans `docs/design-system.md`**, il n'est pas comblé.

**3. Les étapes se dérivent au point de composition**, par `mounted ? … : …` — l'absence **par la valeur**, jamais par un `if (module activé)` dans le domaine. C'est la forme que `invitations/accept` applique déjà à `organizations.available`, et son docblock dit pourquoi.

## Ce qui rend cette story piégeuse

Le critère 2 fait dépendre **une partie d'étape** d'un module : sans `storage`, l'étape profil perd l'avatar et garde le nom. Les critères 3 et 8, eux, font disparaître des étapes **entières**. Une dérivation qui traite les deux pareil écrira un `if` quelque part — et c'est le seul endroit où la note de la story annonce que l'angle du PRD casserait.

## Tâches

- [x] **1. Le module et sa table.** Généré par l'API exportée `scaffoldFiles(moduleId)` (`npx ks scaffold` refuse un arbre sale, ADR 041). État minimal : quelle étape est en cours, lesquelles sont franchies. Inscrit dans `config/features.ts` et classé dans `config/profiles.ts`.
- [x] **2. Les quatre clés RGPD, remplies et non vides.** `purge` efface la progression, `export` la rend. Mutation : vider l'une des deux doit rougir — `s34` et `s35` ont laissé les commandes qui le mesurent.
- [x] **3. Les étapes, dérivées des modules activés.** Sans `organizations`, pas d'étape d'organisation ; sans `billing`, pas d'étape d'offre. **Aucun nom de module dans le domaine.** Mutation : écrire une liste en dur doit rougir.
- [x] **4. L'étape profil, et sa moitié conditionnelle.** Le nom toujours, l'avatar **seulement si `storage` est activé**. Réutiliser ce que `/account` édite déjà plutôt que d'en écrire une seconde version qui divergera. C'est le piège nommé ci-dessus : la mutation utile est « l'avatar est proposé sans `storage` ».
- [x] **5. La reprise.** Une interruption reprend à l'étape en cours à la reconnexion. Mesuré sur une **vraie** interruption — deux requêtes, pas un état recomposé en mémoire.
- [x] **6. La porte à sens unique.** Un parcours terminé n'est plus proposé ; l'utilisateur atteint le tableau de bord. La mutation qui compte est **« le parcours se re-propose »**, pas « il ne s'affiche jamais » : une erreur de ce côté enferme l'utilisateur dans une boucle.
- [x] **7. Facultatif et obligatoire.** Une étape facultative se passe, une obligatoire ne se passe pas. Une étape obligatoire qui se laisse passer est un défaut **silencieux** : rien ne casse, l'utilisateur arrive sans nom.
- [x] **8. L'invité saute l'étape de création.** Se branche sur `invitations/accept`, qui a déjà tranché le module coupé. **Écrire la décision** : l'étape est-elle *sautée* ou *marquée franchie* — la différence se voit quand l'utilisateur quitte ensuite l'organisation.
- [x] **9. Module coupé** : l'utilisateur atteint directement le tableau de bord après inscription. Dérivé, sans nommer le module ; `pnpm test:minimal-profile` le tient.

## Ce que la story ne fait pas

Elle ne réécrit pas l'édition de profil de `/account`. Elle ne livre pas de `Stepper` générique. Elle n'ajoute aucune étape que les critères ne nomment pas, et elle ne touche pas à la redirection d'après-inscription vers le second facteur : elle s'insère **après**.

## La question laissée ouverte par la recherche, et sa réponse

**Un module coupé après qu'un utilisateur a franchi son étape** : l'état cite une étape qui n'existe plus. **Ignorer l'inconnu**, ne pas refuser — l'utilisateur n'y peut rien, et une progression qui bloque sur une décision d'exploitant est pire que la même progression amputée. Écrire la décision là où l'état est lu.

## Sections de `docs/security.md` touchées

**La destination d'une redirection est une constante du code, jamais un paramètre d'URL** (§4) — la règle que le docblock de la racine porte déjà. Zod à la frontière de l'état lu. Aucune donnée d'un autre compte lisible : la progression appartient au compte, et la lire pour un autre répond **404**.
