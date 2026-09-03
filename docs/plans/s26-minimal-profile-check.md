---
story: s26-minimal-profile-check
validated: yes
---
# Plan — Story s26-minimal-profile-check

Branch: `feature/s26-minimal-profile-check`
Research: `docs/research/s26-minimal-profile-check.md` — **à lire d'abord** : elle a **mesuré** que la suite passe sous le profil minimal, ce qui lève le risque principal avant le plan.
Pas de design : story de harnais, aucun écran.

## Story visée

Porte le **critère de succès n°4 du PRD** — « aucune route morte, aucune entrée
de nav orpheline, aucune table inutilisée ». Symétrique de s25 : celle-là prouve
que le socle complet mène à un paiement, celle-ci que le socle réduit ne traîne
rien.

Huit critères. Le 8 commande tout : « Ajouter un module désactivé au profil ne
demande aucune modification du harnais. »

## Ce que la recherche a déjà tranché

La suite passe : **1803 verts / 11 sautés** sous profil minimal, contre
1806 / 8 en profil complet. Aucun couplage caché. Le plan n'a donc pas à prévoir
de découverte ; il a à rendre cette mesure **reproductible et bloquante**.

## Les trois décisions que ce plan prend

**1. La recette travaille dans une copie, jamais dans le dépôt de travail.**
Elle écrit dans `config/features.ts`, un fichier **suivi par git** — c'est la
différence avec s25, dont l'amorçage clonait. Une recette qui bascule le dépôt et
meurt en cours laisse un diff que personne n'a demandé, et l'ADR 041 interdit
précisément les écritures pilotées par agent sur un arbre sale. Cloner supprime
le sujet ; la restauration du CLI reste un filet, pas la stratégie.

**2. Le profil est une liste de modules à couper, et rien d'autre.**
Tout le reste — quelles routes ne doivent pas répondre, quelles entrées de
navigation ne doivent pas paraître, quelles tables ne doivent pas exister — se
**dérive du contrat** que chaque module déclare déjà (`routes`, `navigation`,
`schema`). C'est ce qui rend le critère 8 vrai par construction plutôt que par
discipline.

**3. La recette journalise le nombre de cas exécutés et sautés.**
Une suite « verte » sous profil minimal ne dit rien si la moitié des cas se sont
sautés. Cette session a mesuré deux fois ce que coûte un saut silencieux. Le
chiffre attendu est connu : 1803 / 11.

## Tâches (ordonnées)

1. [x] **Le profil.** Un fichier de configuration déclarant les modules coupés,
   validé par Zod comme toute frontière, et **refusant un module inconnu ou un
   module du socle** (`requiredModules = ['auth']`, `config/features.ts:68`) en
   le nommant.
   *Test* : un identifiant inconnu est refusé ; couper `auth` est refusé ;
   un profil vide est accepté (il vaut le profil complet).

2. [x] **La recette, dans une copie** (décision 1) : clone, `.env` depuis
   l'exemple, application du profil par `writeEnabledModules`
   (`packages/cli/src/features-file.ts`), installation, migration sur **base
   vierge** (critère 5), seed.
   *Test* : la recette laisse le dépôt de travail **intact** — `git status`
   propre après exécution, y compris après un échec provoqué.

3. [x] **Critère 3 — aucune route des modules coupés n'est joignable.** Pour
   chaque module **non activé**, chaque `path` qu'il déclare doit rendre 404.
   Dérivé du registre, jamais écrit à la main.
   *Test* : mutation — remettre un module dans le profil sans toucher au harnais
   doit changer ce qui est balayé. Et **compter les chemins balayés** : un
   balayage de zéro chemin passe pour de mauvaises raisons.

4. [x] **Critère 4 — aucune entrée de navigation orpheline.** La navigation
   rendue est comparée à l'union des entrées déclarées par les modules
   **activés**. Toute entrée d'un module coupé est un échec nommé.
   *Test* : idem, avec le compte d'entrées comparées.

5. [x] **Critère 5 — aucune table d'un module coupé.** Lecture du **schéma
   réel** par `information_schema` (`packages/db/src/introspect.ts`), jamais des
   fichiers de migration. La recherche a vérifié que ce mécanisme existe et
   attrape « une table créée par un import transitif ».
   *Test* : mutation — faire déclarer une table à un module coupé doit rougir.

6. [x] **Critère 2 — la suite complète passe**, avec les comptes journalisés
   (décision 3).
   *Test* : la recette échoue si le nombre de cas **exécutés** chute sous un
   plancher, pas seulement si un cas rougit.

7. [x] **Critère 6 — inscription et connexion de bout en bout** sous le profil.
   `auth` est au socle, donc toujours présent ; c'est le parcours qui prouve que
   le produit réduit reste utilisable.

8. [x] **Critère 8 — la généricité, rendue exécutable.** Un test construit un
   profil **supplémentaire** (un quatrième module coupé) et vérifie que le
   harnais le traite sans modification.
   *Test* : c'est le cœur de la story. S'il est vert avec un harnais qui
   nommerait trois modules en dur, il ne prouve rien — le vérifier par mutation.

9. [x] **Critère 7 — commande unique et CI bloquante.** Sur le modèle de
   `pnpm test:golden-path` livré par s25. **Le job de CI passe par les deux
   gardes que s25 vient d'installer** : `actionlint` et le test des `if:` de
   niveau job — un `hashFiles` mal placé y rejetterait tout le workflow.

10. [x] **Documentation.** Le tableau des commandes d'`AGENTS.md` (un test le
    vérifie, il rougira sinon), `docs/architecture.md` pour le profil, et le
    fichier de profil lui-même, qui est **de la configuration** : il s'explique
    à son propriétaire.

## Interdits d'exécution

- **Ne pas nommer de module dans le harnais.** Ni `organizations`, ni `billing`,
  ni `i18n`. Tout se dérive du registre. C'est le critère 8, et c'est le seul
  interdit qui compte vraiment ici.
- **Ne pas basculer le dépôt de travail** : la recette travaille dans une copie.
- **Ne pas réutiliser une base entre deux exécutions** : le critère 5 est faux
  sur une base qui traîne les tables d'une exécution précédente.
- **Ne pas faire échouer la recette sur un compte de cas sautés qu'on aurait
  figé** : un plancher, pas une égalité — sinon toute story qui ajoute un test
  casse la recette.
- **Ne pas créer de commande de nettoyage** des tables des modules coupés :
  l'`eject` est au cimetière du PRD, et `ks toggle` dit déjà que les données sont
  conservées.
- **Ne pas modifier les quinze specs existantes** ni le harnais de s25.
- **Ne pas mettre `hashFiles` dans un `if:` de niveau job** — s25 a payé ce
  défaut, les deux gardes sont en place.
- **Ne pas toucher `config/features.ts`** dans le commit : le profil est un
  fichier à part.

## Le point sur lequel tout repose

**La généricité, et le fait qu'elle soit prouvée plutôt qu'affirmée.**

Un harnais qui vérifie l'absence de trois modules nommés est facile à écrire, il
passera, et il sera faux au module suivant — au moment précis où plus personne ne
regardera. La story le dit elle-même : « un profil codé en dur avec trois noms de
modules deviendrait faux dès le module suivant ».

Trois endroits où ce plan peut être faux :

1. **Un balayage vide passe.** Si la dérivation rend zéro route, zéro entrée,
   zéro table à vérifier, tout est vert et rien n'est prouvé. **Compter et
   assertionner le compte** est la seule protection, comme la revue de s25 l'a
   fait avec `expect(swept.length).toBeGreaterThan(10)`.
2. **`i18n` coupé change les URL.** Le routage par préfixe disparaît ; des
   chemins écrits en dur seraient faux, et un 404 obtenu pour la mauvaise raison
   ressemble à un succès.
3. **La copie peut diverger du dépôt.** `git clone` ne connaît que `HEAD` — s25
   a rencontré exactement ce cas et recopie les fichiers du plan de travail en
   annonçant leur nombre. Le même piège s'applique ici.

## Fichiers touchés (anticipé)

| Fichier | Nature |
|---|---|
| `config/profiles.ts` (ou équivalent) | le profil, validé |
| `scripts/minimal-profile.ts` | la recette, dans une copie |
| `packages/core/src/…` | dérivation registre → routes/nav/tables attendues |
| `tests/minimal-profile.test.ts` | critères 1, 3, 4, 5, 8 |
| `e2e/…` | critère 6 |
| `package.json` | la commande |
| `.github/workflows/ci.yml` | le job bloquant |
| `AGENTS.md`, `docs/architecture.md` | docs |

## Stratégie de test

| Niveau | Ce qu'il couvre |
|---|---|
| unité | validation du profil, dérivation registre → attendus |
| recette | les six vérifications, avec leurs **comptes** |
| mutation | **quatre** : un module nommé en dur dans le harnais ; un balayage vide ; une table d'un module coupé ; le dépôt de travail sali par la recette |
| CI | `actionlint` + le test des `if:` de niveau job, hérités de s25 |

## Definition of Done

- Les huit critères vérifiés, chacun par un test nommé.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` verts en profil complet.
- La recette verte, ses comptes journalisés, et le dépôt de travail **propre après**.
- Les quatre mutations vérifiées rouges.
- Le workflow validé par `actionlint`.
- Un seul commit, message impératif en français, portant recherche et plan.
