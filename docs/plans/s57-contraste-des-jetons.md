---
story: s57-contraste-des-jetons
validated: yes
---

# Plan — s57-contraste-des-jetons

> Planifié contre `dev` au commit `b73f1ba`, qui porte la recherche de cette story. Elle relève sa complexité de **2 à 3** : les jetons se corrigent en dix minutes, la mesure est une réécriture.

## Pourquoi les deux moitiés atterrissent ensemble

Corriger les jetons sans élargir la mesure **ne retient rien** — le prochain jeton repassera sous le seuil sans que rien ne le dise. Élargir la mesure sans corriger les jetons rend une commande verte **rouge**, sans que personne l'ait décidé. C'est pour cela que la story porte les deux, et le critère 3 le dit.

## Ce que la recherche a trouvé et qui gouverne le travail

**Deux défauts, deux espèces.** `--ring` à **2,59 : 1** est un **indicateur non textuel** — seuil **3 : 1** — et il porte le focus clavier de **sept** composants. `--destructive-foreground` sur `--destructive` en sombre à **2,77 : 1** est du **texte** — seuil **4,5 : 1**. Une mesure à seuil unique serait fausse dans un sens ou dans l'autre.

**Le piège est `SURFACE_TOKEN`, figé à `--card`.** La commande **suppose** le fond au lieu de le mesurer, et `--ring` n'est jamais peint sur une carte : il entoure des champs et des boutons, sur `--background` ou sur leur propre couleur. Une mesure élargie qui garderait cette hypothèse mesurerait une composition qui n'existe pas.

**Les marges de l'`Alert` sont minces** : quatre variantes entre 4,84 et 4,88 pour un plancher de 4,50. Ne pas y toucher ; `s49` a déjà arbitré leur composition.

## Tâches

- [x] **1. Les deux seuils, dans le modèle.** Une paire déclare ce qu'elle est — texte ou indicateur non textuel — et son seuil en découle. `CONTRAST_THRESHOLD`, constante unique aujourd'hui, cesse d'être unique. Test d'abord.
- [x] **2. La surface cesse d'être supposée.** Chaque paire déclare la surface sur laquelle elle est réellement peinte. `SURFACE_TOKEN` disparaît ou devient un défaut explicite ; l'`Alert` garde `--card` **parce qu'elle est peinte dessus**, pas par héritage.
- [x] **3. Les paires, dérivées des fichiers livrés.** Critère 5 : un jeton ajouté demain entre dans la mesure sans qu'on y pense. **Aucune liste recopiée**, et un plancher — la généralisation de `MINIMUM_ALERT_VARIANTS = 4`, qui existe déjà pour empêcher une dérivation vide de passer verte.
- [x] **4. `--ring` atteint 3 : 1**, dans les deux thèmes, contre les fonds où il est **réellement** posé. Le sombre est à **vérifier**, pas supposé bon. Le geste minimal est un jeton plus sombre : élargir l'anneau ou lui ajouter un décalage serait une décision de design, pas de contraste.
- [x] **5. `Button variant="destructive"` atteint 4,5 : 1 dans les deux thèmes.** Le clair est à 4,56 — donc il passe, mais il passera *de justesse* : le vérifier aussi.
- [x] **6. Ce que la commande ne mesure pas est écrit dans sa propre sortie**, pas seulement dans un document. Le dépôt s'est déjà fait prendre à laisser une commande verte suggérer une couverture qu'elle n'a pas — c'est la moitié du critère 4.
- [x] **7. Les écrans restent reconnaissables.** Critère 6, mesuré dans un navigateur sur les écrans qui portent le plus de focus et de rouge : authentification et back-office. Le focus **ne se voit pas sur une capture** — la revue de `s46` l'a écrit : c'est la mesure du jeton qui fait foi, la capture ne sert qu'à constater que rien d'autre n'a bougé.

## Ce que la story ne fait pas

Elle ne touche pas aux variantes de l'`Alert`. Elle n'ajoute aucun jeton neuf. Elle ne change ni la forme, ni l'épaisseur, ni le décalage de l'anneau de focus — seulement sa couleur. Elle ne mesure pas les icônes, ni les états de survol, ni les bordures décoratives : ce qu'elle laisse dehors, elle l'écrit.

## La question ouverte de la recherche, et sa réponse

**Le seuil de 3 : 1 s'applique contre les fonds adjacents réellement possibles**, pas contre un fond dominant supposé. Si un jeton passe sur l'un et échoue sur l'autre, c'est un échec — un indicateur de focus qui disparaît sur la moitié des surfaces ne remplit pas son office. Écrire la règle là où les paires sont déclarées.

**Un ADR n'est nécessaire que si la correction déborde la portée de l'ADR 056** — par exemple un anneau par surface. Un jeton assombri ne la déborde pas.

## Sections de `docs/security.md` touchées

Aucune. C'est une story d'accessibilité et de mesure ; elle ne touche ni frontière, ni autorisation, ni secret.
