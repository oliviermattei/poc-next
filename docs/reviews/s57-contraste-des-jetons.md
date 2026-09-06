# Review — s57-contraste-des-jetons

> Contexte neuf. Diff jugé : 1 commit `0965f4c`, 12 fichiers, +1628/−418. Arbre restauré et propre après chaque mutation.

## Ce que la revue a joué elle-même

`pnpm test` 2925 verts · **`pnpm test:contrast` 44 paires**, exit 0 · `E2E_PORT=3157 pnpm test:e2e` 124 verts · `typecheck` 37/37 · `lint` propre · `test:sans-env` 2925 verts, 102 fichiers · `pnpm build` vert.

## L'arbitrage demandé — la réponse

**C'est une correction de contraste, dans la portée de l'ADR 056. Aucun ADR superseder n'est nécessaire.**

L'ADR 056 définit lui-même `--<sem>-foreground` comme « remplissage vif — la lisibilité y vient du fond clair », et nomme `--warning-foreground` comme un quasi-noir. Basculer les trois frères non alignés **applique** ce modèle, il ne l'étend pas. Aucun jeton neuf, aucun anneau par surface, aucune exception par composant — les trois choses qui auraient fait éclater la portée.

Mieux : la section « à surveiller » de l'ADR 056 **anticipe exactement ce moment** — « les `Badge`, les icônes et les états de focus ne sont pas mesurés : le prochain composant qui écrit du texte sur une teinte devra soit employer cette famille, soit élargir la commande ». `s57` est cet élargissement.

Et l'alternative — rétrécir le balayage pour ne jamais voir les trois rouges — est littéralement le mode d'échec que la story existe pour tuer. Les laisser rouges aurait expédié un `dev` rouge.

## Les cinq affirmations, vérifiées

**1. `--ring` unique sur les deux thèmes** — vérifié, la déclaration `.dark` est remplacée par un commentaire, et aucune autre déclaration n'existe. Les quatre surfaces dérivées sont les bonnes, et la revue a vérifié **d'où chacune vient**. Elle a aussi contrôlé les surfaces hors du dossier balayé (barre latérale, bannière de consentement) : toutes deux dans l'ensemble dérivé. **La dérivation n'est pas chanceuse.**

**2. Le raisonnement sur l'anneau est juste ; le nombre qui l'accompagne est faux.** Voir m1. La revue a **dérivé l'impossibilité indépendamment** : atteindre 3 : 1 contre un fond blanc force la luminance de l'anneau sous 0,30 ; y ajouter le destructif la force sous 0,023 ; cette valeur échoue alors contre le primaire à 1,01 : 1. Aucune valeur ne satisfait les trois. L'argument structurel — l'anneau est une ombre portée **hors** de la boîte — suffit seul, et neutraliser le filtre correspondant rend **10 cas rouges**.

**3. Les deux mutations vertes, rejouées** : toutes deux réellement corrigées. Les trois planchers échouent chacun pour sa propre raison, chaque test nomme le message **et** le nombre.

**4. Le défaut de l'outil de mesure est bien fermé** : la sélection de la couche d'ombre non vide et le refus au-delà d'une couche sont vérifiés par mutation — la lecture naïve donne `1.00 : 1, anneau #ffffff sur #ffffff`. **Recoupement notable** : la mesure peinte sur 14 arrêts de tabulation donne 4,74 en clair et 3,78–4,18 en sombre, contre 4,73 / 3,79 / 4,18 sur le papier. **Arithmétique et navigateur s'accordent au centième.**

**5. Un seul lecteur de disque**, partagé par la commande et la suite — vérifié.

**Ce que la story ne devait pas faire** : `alert.tsx` est absent du diff et ses variantes mesurent toujours 4,84 à 4,88 ; aucun jeton ajouté ; ni forme, ni épaisseur, ni décalage de l'anneau touchés.

**Critère 4** : la commande imprime les 16 fichiers balayés, les 4 surfaces, les 7 composants porteurs d'anneau, puis **cinq lignes « NON mesuré »** dont trois dérivées. Critère tenu proprement.

## Mutations — 8, dont 7 rouges

`--ring` restauré → 4 rouges · `--destructive-foreground` sombre restauré → 2 · autorité de `@theme inline` retirée → 8 · échecs vidés → 4 · surface teintée retombant sur `--card` → 1 · surfaces incluant les remplissages → **10** · les trois planchers, un par un → 1 chacun sur son propre message · lecture naïve de l'ombre → 2 rouges navigateur. **`MINIMUM_SWEPT_FILES` → 0 rouge** (m3).

## Constats

**m1 — minor — une affirmation qui a l'air mesurée et qui est fausse contre les jetons livrés.** Le commentaire dit que l'anneau contre le destructif vaut « 1,84 : 1 quelle que soit la valeur choisie ». Mesuré maintenant : **1,01 : 1**. 1,84 est l'**ancien** anneau — un nombre calculé avant le correctif et laissé à côté du correctif. Et « quelle que soit la valeur » est faux : un anneau noir atteint 4,41 contre le destructif. La conclusion est vraie et l'argument structurel la porte seul ; c'est le nombre qui ment, **dans le fichier dont le sujet est précisément ce mode d'échec**.

**m2 — minor — un compte écrit à côté du code qui le dérive** : « les **sept** composants qui portent l'anneau ». La commande dérive et imprime ce nombre. Pire, il se lit comme un total : **17** fichiers du dépôt portent cette classe, le balayage en voit 7. Deux lignes plus haut, la même table dit qu'un nombre écrit à côté du code vieillit — et qu'il a déjà vieilli deux fois.

**m3 — minor — un plancher que rien ne vérifie, et que rien ne peut vérifier** : `MINIMUM_SWEPT_FILES` neutralisé laisse **0 rouge**, le lecteur n'offrant aucun point d'injection. Impact faible — un balayage effondré déclencherait un autre plancher — mais la story a ajouté une garde qu'elle ne sait pas démontrer.

**m4 — minor — la règle écrite est plus large que le code** : « une source teintée dont aucune surface n'est déclarée est refusée ». Mesuré : le refus ne se déclenche que si la même chaîne porte aussi une couleur de texte au repos. Deux fichiers sont des sources teintées sans surface déclarée, ni refusés ni listés. Inoffensif au fond, mais c'est un trou dans la liste du critère 4.

**m5 — minor — aucune preuve navigateur enregistrée du changement d'apparence.** La tâche 7 est cochée, mais rien sur la branche ne consigne ce qui a été vu, et le critère 6 ne couvre que les cinq écrans d'authentification — où aucun des badges basculés ne paraît. La revue a produit la preuve elle-même : `/pricing` en clair, le badge d'essai passe de blanc sur bleu à **quasi noir sur bleu** (4,92 : 1, lisible, visiblement différent, sur le premier écran qu'un prospect voit) ; `/billing` idem ; `/account` en sombre, le bouton de suppression définitive devient quasi noir sur rouge clair — c'était le défaut à 2,77.

Rien ne bloque, mais **la description de la PR doit porter ces images** : un humain qui voit `/pricing` changer sans photo lira une régression.

## Non vérifié

- **Trois surfaces restantes** portant un badge basculé — `/notifications`, `/premium`, le back-office. Geste humain : les ouvrir et trancher si le texte sombre sur teinte convient à la marque. **C'est un jugement de goût, pas une mesure**, et c'est la seule chose de cette story qu'aucune commande ne peut répondre.
- **L'anneau sur d'autres écrans que la connexion** : les conteneurs concernés peignent des fonds dérivés, vérifié par lecture, jamais par un navigateur.
- **Un seul navigateur, une seule plateforme.** Le nombre de couches d'ombre et la sérialisation `lab()` sont des comportements de Chromium ; ailleurs l'outil **lèverait** plutôt que de mal mesurer, mais personne ne l'a joué là-bas.
- **Modes contrastes forcés du système** : intacts, non testés, et un changement d'anneau est exactement ce qu'ils surchargent.
- **La CI n'a jamais joué la version élargie.**
- **`pnpm test:socle` et `test:minimal-profile` non joués** : le dossier balayé est du socle, donc la dérivation ne peut pas varier avec un module — affirmé, pas mesuré.

Max severity: minor
Ship allowed: yes
