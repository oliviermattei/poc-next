---
story: s58-donnees-de-demonstration
validated: yes
---

# Plan — s58-donnees-de-demonstration

> Planifié contre `dev` au commit `1b00177`, qui porte la recherche. Elle relève la complexité de **2 à 3** : les données sont triviales, les trois mécanismes ne le sont pas.

## Le défaut, tel qu'il a été mesuré

`pnpm db:seed` sur une base migrée : « Aucun seed à exécuter », **sortie 0**, et les **29 tables** du schéma public à **zéro ligne**. Une commande qui ne fait rien et qui réussit. Le test d'idempotence, lui, existe — et **n'éprouve qu'un seeder qu'il s'injecte à lui-même**.

## Les trois décisions du plan

**1. Une clé optionnelle, jamais une seizième clé obligatoire.** Le commentaire de `publicUrls` le dit : ajouter une clé au contrat **rouvre tous les modules déjà écrits**. Le précédent à reprendre est `NavigationEntry.surface` (ADR 066/067) — optionnelle, donc les modules qui n'en veulent pas ne bougent pas, et le registre la dérive pour ceux qui la déclarent.

**2. La garde de non-écrasement se dérive d'un fait de la base, jamais de `NODE_ENV`.** Le socle refuse d'en déduire un comportement — c'est écrit pour les modes locaux et ça vaut ici. Le fait retenu : **le seed refuse dès qu'existe un compte qu'il n'a pas créé lui-même**. Un produit en service en a toujours un ; une base de découverte n'en a aucun.

**3. Les seeds vivent dans leur module.** À côté, ils cassent en silence quand le schéma bouge ; dedans, ils vieillissent avec lui et disparaissent avec sa coupure — par la valeur, sans qu'aucun nom de module soit écrit nulle part.

## Tâches

- [x] **1. La clé optionnelle dans le contrat**, et sa dérivation par le registre. Un module qui ne la déclare pas reste intact — vérifier que **les seize modules existants ne sont pas touchés**.
- [x] **2. Le plancher, qui est la cause du défaut.** Une exécution qui ne crée **rien** fait échouer la commande. Sans lui, le prochain module qui oublie son seed ne le saura pas davantage. Mutation : vider tous les seeds doit rougir.
- [x] **3. La garde de non-écrasement.** Refus dès qu'un compte non issu du seed existe, avec un message qui **nomme le fait** et non la variable. Mutation : la retirer doit rougir sur une base peuplée à la main.
- [x] **4. La rejouabilité, mesurée et non promise.** Deux exécutions successives, un **comptage** avant et après — pas une lecture du code. C'est ce que le commentaire du contrat demande depuis le premier jour sans que rien ne le vérifie.
- [x] **5. Les données elles-mêmes**, pour les modules où le vide se voit le plus : comptes, organisations, abonnements, notifications. **Manifestement fictives** — aucune adresse ni raison sociale qui puisse passer pour réelle. Assez pour que chaque écran montre quelque chose, pas assez pour masquer un défaut de pagination.
- [x] **6. Module coupé, aucune ligne.** Dérivé du registre. `pnpm test:minimal-profile` le tient sans nommer de module.
- [x] **7. La documentation de la découverte.** Ouvrir le produit a demandé **sept étapes tâtonnées** — dériver un environnement, migrer, s'inscrire, lire l'email capturé sur le disque, le vérifier, atteindre le back-office pour déclencher la désignation du superadmin. Écrire la recette, là où quelqu'un qui clone la cherchera.

## Ce que la story ne fait pas

Elle n'ajoute aucune clé obligatoire. Elle ne touche pas aux seize modules qui ne déclarent pas de seed. Elle ne crée pas de compte administrateur automatiquement — la désignation reste celle du socle. Elle ne remplit pas le blog, la documentation ni le changelog : leur contenu est livré en MDX.

## Sections de `docs/security.md` touchées

**Aucun secret dans les données livrées** — un seed est du code versionné, donc tout mot de passe qu'il pose est public par construction : il doit être manifestement de démonstration, et la garde de la tâche 3 est ce qui empêche qu'il atteigne une base en service.
