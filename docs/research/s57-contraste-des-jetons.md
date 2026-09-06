# Research — Story s57-contraste-des-jetons

> Vérifiée contre la branche par défaut au commit `18658fe`, en lecture seule. Aucune base, aucun conteneur créé.

## Les six faits structurants

1. **La commande est verte parce qu'elle regarde peu.** `pnpm test:contrast` mesure **10 paires** : `packages/ui/src/components/alert.tsx` × `packages/ui/src/styles.css`, cinq variantes × deux thèmes, seuil **4,50 : 1**. Rien d'autre. Ni champ, ni bouton, ni libellé, ni lien, ni **indicateur de focus**.

2. **Les marges de l'`Alert` en thème clair sont minces** : quatre des cinq variantes sont entre **4,84** et **4,88** contre un plancher de 4,50. Tout élargissement qui toucherait à ces jetons rougira vite — c'est une contrainte de la story, pas un détail.

3. **Les deux défauts sont localisés, et ils sont d'espèces différentes.**
   - `--ring: oklch(0.708 0 0)` (`styles.css:86`) sur `--background` en clair : **2,59 : 1**, contre les **3 : 1** d'un indicateur **non textuel**. Il est utilisé par **sept composants** (`accordion`, `breadcrumb`, `button`, `checkbox`, `input`, `sheet`, `textarea`) : c'est donc tout le focus clavier du produit.
   - `--destructive-foreground` sur `--destructive` en **sombre** (`styles.css:108-109`) : **2,77 : 1**, contre 4,5 : 1 de **texte normal**. En clair, 4,56 — tout juste.

4. **Deux seuils, et c'est le cœur du critère 3.** Un texte demande 4,5 : 1 ; un indicateur non textuel, 3 : 1. `CONTRAST_THRESHOLD` est aujourd'hui une **constante unique** à 4,5. Une mesure élargie qui garderait un seuil unique serait fausse dans les deux sens : trop sévère pour le focus, ou trop laxiste si on la baissait.

5. **`scripts/contrast-rules.ts` est un module pur, importable, et il a été appelé pour le vérifier.** Aucun point d'entrée CLI, aucune auto-exécution. Il expose `parseColor`, `composite`, `contrastRatio`, `contrastPairs`, `contrastReport` — donc **la story peut mesurer un jeton qu'aucun composant ne rend**, ce qui est exactement le cas de `--ring`. Vérifié en calculant une paire arbitraire hors de l'arbre : 2,78 : 1.

6. **Deux constantes de ce fichier sont des gardes, et l'une est un piège.** `MINIMUM_ALERT_VARIANTS = 4` fait échouer une dérivation vide ou rétrécie plutôt que de la laisser verte — à conserver, sous une forme généralisée. Mais **`SURFACE_TOKEN` est figé à `--card`** : la commande **suppose** le fond au lieu de le mesurer. Or `--ring` n'est jamais peint sur une carte : il entoure des champs et des boutons, sur `--background` ou sur `--input`. Une mesure élargie qui garderait cette hypothèse mesurerait une composition qui n'existe pas.

## Ce que le dépôt a déjà et qui répond au fait 6

`e2e/support/painted.ts` (extrait par `s46`) **mesure le fond réellement peint** : il empile les fonds de la racine jusqu'à l'élément dans un canevas d'un pixel et relit le pixel, donc Chromium résout `oklch()` et `color-mix()`. Une couleur qu'il ne sait pas repeindre **interrompt** la mesure au lieu d'en rendre une fausse.

C'est la seconde moitié de la réponse : la mesure de jeton (arithmétique, hors navigateur) dit ce que **devrait** donner une paire ; la mesure peinte dit ce que le navigateur **donne**. Les deux ne se remplacent pas.

## Points d'ancrage

- `packages/ui/src/styles.css:53-54, 86, 108-109, 132` — les quatre jetons en cause, dans les deux thèmes.
- `scripts/contrast-rules.ts` — `CONTRAST_THRESHOLD`, `SURFACE_TOKEN`, `MINIMUM_ALERT_VARIANTS`, `contrastPairs`, `contrastReport`.
- `e2e/support/painted.ts` — la mesure peinte, et son refus d'une couleur non repeinte.
- `e2e/alert-contrast.spec.ts` — le précédent navigateur, trois cas, sur des écrans qui rendent déjà les variantes.
- Les **sept** composants qui portent `focus-visible:ring`.

## Pièges & contraintes

- **Changer `--ring` change l'apparence de sept composants.** Le critère 6 l'encadre : les écrans doivent rester reconnaissables. Un jeton plus sombre est le geste minimal ; élargir l'anneau ou lui ajouter un décalage serait une décision de design, pas de contraste.
- **`--ring` a deux thèmes**, et le clair est le fautif (2,59). Le sombre (`oklch(0.556 0 0)`) est à vérifier sur son propre fond, pas supposé bon.
- **Le fond du focus n'est pas unique** : un champ pose l'anneau sur `--background`, un bouton primaire sur sa propre couleur. Le seuil de 3 : 1 s'apprécie **contre les fonds adjacents**, ce qui est plus subtil que « texte sur fond ».
- **Ne pas toucher aux variantes de l'`Alert`** : elles passent à 4,84 en clair, et `s49` a déjà arbitré leur composition.
- **La commande doit dire ce qu'elle ne mesure pas, dans sa sortie** (critère 4) — le dépôt s'est déjà fait prendre à laisser une commande verte suggérer une couverture qu'elle n'a pas.

## Questions ouvertes

- **Le seuil de 3 : 1 s'applique-t-il à `--ring` contre *tous* ses fonds adjacents, ou contre le fond dominant ?** La WCAG parle des couleurs adjacentes ; le dépôt doit choisir une règle et l'écrire.
- **Faut-il un ADR ?** `docs/decisions/056` a fixé la portée des jetons sémantiques. Si la correction déborde (par exemple un `--ring` par thème *et* par surface), elle demande un ADR qui le supersède.
- **Que devient `SURFACE_TOKEN` ?** Le supprimer au profit d'une surface déclarée par paire est le geste propre ; le garder pour l'`Alert` et en ajouter d'autres est le geste minimal.

## Complexité réelle

Notée **2** dans `docs/stories.md`. **Ma note : 3.** Deux jetons à corriger est un travail de dix minutes ; ce qui coûte, c'est le critère 3 — une mesure **dérivée** des jetons livrés, à deux seuils, sur des surfaces qui ne sont plus une constante. C'est une réécriture de `contrast-rules.ts`, pas un ajout de lignes. Elle reste une seule story parce que corriger les jetons sans élargir la mesure ne retient rien, et l'inverse rougit sans corriger.
