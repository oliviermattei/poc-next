# ADR 056 — Le texte sur teinte a sa propre famille de jetons

- Status: accepted
- Date: 2026-09-05
- Scope: story s49-contraste-des-alertes

## Context

Un même jeton sémantique servait **deux métiers incompatibles** :

- **remplissage vif** — `packages/ui/src/components/badge.tsx` peint
  `bg-warning text-warning-foreground`, et `--warning-foreground` est un quasi
  noir. La lisibilité y vient du fond **clair** ;
- **texte sur teinte à 10 %** — `alertVariants` écrivait le texte avec la teinte
  elle-même (`text-warning`) sur `bg-warning/10`. La lisibilité y demande un
  texte **sombre**.

`--warning` vaut `oklch(0.79 …)` : à cette clarté il est un bon fond et un texte
illisible. Mesuré sur les jetons livrés, mode clair, texte sur teinte composée
au-dessus de la carte : `warning` **1,83 : 1**, `success` 3,03 : 1,
`info` 3,24 : 1, `destructive` 3,99 : 1 — les quatre sous le seuil AA de
4,5 : 1, et `warning` sous le seuil de 3 : 1 du grand texte lui-même. Le mode
sombre passait déjà partout (5,46 à 8,63 : 1).

Ce n'est pas une question d'esthétique : s28 venait de déplacer le refus de
limitation de débit vers la variante `warning`. La seule explication qu'un
utilisateur bloqué recevait était rendue dans la moins lisible des quatre.

Aucun réglage d'un jeton **unique** ne satisfait les deux métiers : c'est ce qui
force une décision de structure plutôt qu'un ajustement de valeur.

## Decision

**Une famille de jetons distincte pour le texte sur teinte :
`--<sémantique>-subtle-foreground`**, quatre en mode clair et quatre en mode
sombre, plus leurs quatre correspondances dans `@theme inline`.

- en **clair**, teinte et chroma du jeton sémantique sont **conservées**, seule
  la clarté descend jusqu'au seuil (4,84 / 4,84 / 4,85 / 4,88 : 1 mesurés) ;
- en **sombre**, ils **reprennent la valeur du jeton sémantique existant** : il
  passait déjà le seuil, et le changer serait une régression d'apparence sans
  bénéfice ;
- `Alert` les emploie **pour son texte seul**. Bordure et fond ne bougent pas, et
  **aucun de ses appelants ne change** — cela se vérifie au diff de la story, où
  aucun fichier appelant n'apparaît. Leur nombre ne s'écrit pas ici non plus :
  il se relève par `grep -rnE '<Alert([[:space:]]|>|$)'
  --include='*.tsx' apps packages`, et un `<Alert` nu répond deux de trop, parce
  qu'il compte `<AlertTitle>` et `<AlertDescription>` ;
- la règle est **exécutable** : `pnpm test:contrast` (`scripts/contrast.ts`)
  dérive les paires du composant et de la feuille de style, mesure **celles
  qu'elle a dérivées** — les quatre sémantiques, plus la variante `default`,
  qui est dérivée comme les autres et donc mesurée aussi —, et sort non-zéro en
  nommant la variante dès qu'une passe sous 4,5 : 1. Le compte se lit dans sa
  sortie, il ne s'écrit pas ici : « les huit » y était écrit et la commande en
  mesurait dix. Elle est câblée en CI à côté du typage et du lint.

## Considered options

- **Assombrir `--destructive`, `--success`, `--warning`, `--info`** — rejeté :
  ces jetons traversent tout le produit. `badge.tsx` peint `bg-warning` avec un
  `--warning-foreground` quasi noir par-dessus ; assombrir le fond **baisse** le
  contraste du badge. Un correctif d'accessibilité qui en casse un autre.
- **Employer `--<sem>-foreground` comme texte de l'`Alert`** — rejeté : il passe
  le seuil (quasi noir sur teinte claire), mais il efface le **codage par la
  couleur**, qui est exactement ce que la sémantique achète. Les quatre
  variantes deviendraient quatre rectangles au texte noir, distingués par leur
  seule bordure.
- **`text-foreground` pour toutes les variantes** — rejeté : même perte, et en
  plus la variante `default` cesse d'être distinguable des quatre autres.
- **Corriger les valeurs sans écrire la commande** — rejeté : un contraste que
  rien ne mesure est cassé en silence par le prochain ajustement de jeton.
  « Une règle qu'aucune commande ne vérifie est de la documentation, pas une
  règle » (`AGENTS.md`).

## Consequences

**Plus facile** — un composant qui écrit du texte sur une teinte a désormais le
jeton qu'il lui faut, sans toucher au remplissage. Et un changement de jeton
sémantique ne peut plus dégrader l'`Alert` sans que la CI le dise.

**Plus difficile** — le système porte quatre jetons de plus, donc quatre valeurs
à réviser quand un projet généré remplace une sémantique. La commande les
mesure : une valeur mal choisie rougit au lieu de passer.

**À surveiller** — `pnpm test:contrast` ne balaie que les variantes de
`alert.tsx`. Les bordures `border-<sem>/50` (seuil 3 : 1 des éléments non
textuels), les `Badge`, les icônes et les états de focus **ne sont pas
mesurés** : le prochain composant qui écrit du texte sur une teinte devra soit
employer cette famille, soit élargir la commande. Et le fond effectif est
**supposé** être `--card` — c'est une hypothèse vérifiée au rendu, pas une
mesure du calcul.
