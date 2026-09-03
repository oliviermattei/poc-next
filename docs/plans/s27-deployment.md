---
story: s27-deployment
validated: yes
---
# Plan — Story s27-deployment

Branch: `feature/s27-deployment`
Research: `docs/research/s27-deployment.md` — **à lire d'abord** : elle établit que la story part de zéro, et pourquoi `isBuildPhase` commande le Dockerfile.
Pas de design : aucun écran.

## Story visée

Complexité mesurée **4**, pas 3. Sept critères, dont **deux recettes manuelles**
qui exigent de vrais déploiements avec leur trace (URL, date, version).

**Le propriétaire a autorisé le déploiement réel sur son Coolify** (serveur
joignable, version 4.3.14). Le critère 5 sera donc **exercé**, pas seulement
documenté. Vercel reste à documenter sans preuve d'exécution, faute d'accès.

## Le fait qui commande tout

`apps/web/next.config.ts` valide l'environnement et résout la configuration de
chaque module **au chargement**. `AGENTS.md` exige pourtant que « le build n'ait
pas besoin des variables d'exécution ». Les deux ne tiennent ensemble que par
`isBuildPhase` (`packages/config/src/env.ts:493`).

**L'étape de construction pose la phase de build ; l'étape d'exécution ne la pose
pas.** Si elle la posait, l'image démarrerait sans valider son environnement, et
le critère 1 deviendrait faux en silence — le même chemin de vert silencieux que
s26 vient de fermer sur les clones.

## Tâches (ordonnées)

1. [x] **`output: 'standalone'`** dans `apps/web/next.config.ts`. Sans lui,
   l'image embarque tout `node_modules` d'un monorepo pnpm.
   *Test* : `pnpm build` reste vert ; le dossier `standalone` est produit.

2. [x] **Le `Dockerfile` multi-étapes.** Construction avec la phase de build
   posée, exécution **sans**. Aucun `.env` copié dans l'image — un secret dans un
   artefact de build est un manquement au socle. Utilisateur non privilégié.
   *Test* : `docker build` puis **`docker run`** — une image qui construit mais
   ne démarre pas est le faux vert évident de cette story. Et `docker run` **sans
   variables** doit refuser en les nommant : c'est le critère 1 à l'envers, et
   c'est ce qui prouve que la phase de build n'a pas fuité dans l'exécution.

3. [x] **`docker-compose.prod.yml`** : application + base, port configurable.
   Ne pas recopier le compose de développement, dont le port est celui du poste.
   *Test* : la pile démarre et sert l'application.

4. [x] **Les migrations avant le basculement** (critère 3) : une étape distincte,
   jamais un `postinstall`. Un échec interrompt le déploiement.
   *Test* : une migration en échec fait échouer le déploiement — mutation, pas
   affirmation.

5. [x] **La checklist des variables de production** (critère 4), **dérivée**
   d'`ENV_KEYS` et non recopiée. Un test compare la documentation au schéma et
   échoue en cas d'écart, dans les deux sens : une variable du schéma absente de
   la doc, **et** une variable documentée qui n'existe plus.
   *Test* : ajouter une variable au schéma sans documenter fait rougir.

6. [ ] **Le guide Coolify**, puis **son exécution réelle**. Créer un projet
   dédié, une base PostgreSQL, l'application ; déployer ; consigner **URL, date,
   version**. Annoncer chaque ressource créée avant de la créer.
   *Trace* : dans la revue, comme le critère l'exige.
   **Guide livré (`docs/deployment.md`), exécution NON faite** : le propriétaire
   a repris le déploiement réel à sa main. Aucune ressource n'a été créée sur
   son Coolify. La case reste décochée tant que la trace n'existe pas.

7. [x] **Le guide Vercel**, sans exécution. Le dire explicitement plutôt que de
   cocher : s25 a établi le précédent — le mécanisme est livré, son exécution
   réelle est nommée comme non faite.

8. [x] **La construction d'image en CI** (critère 7). Les deux gardes de s25
   s'appliquent : `actionlint`, et aucun `hashFiles` dans un `if:` de niveau job.

9. [x] **Documentation.** `docs/deployment.md`, le tableau des commandes
   d'`AGENTS.md` si une commande naît, et `docs/architecture.md`.

## Interdits d'exécution

- **Ne jamais copier de `.env` ni de secret dans l'image.**
- **Ne pas poser la phase de build dans l'étape d'exécution** — l'image doit
  valider son environnement au démarrage.
- **Ne pas recopier `ENV_KEYS` à la main** dans la checklist : la dérivation
  existe, et une liste recopiée mentira à la première variable ajoutée.
- **Ne pas jouer les migrations dans un `postinstall`** ni après le basculement.
- **Ne pas créer de ressource sur le Coolify sans l'annoncer d'abord.**
- **Ne pas mettre `hashFiles` dans un `if:` de niveau job.**
- **Ne pas modifier les harnais de s25 et s26** ni les specs existantes.
- **Ne pas toucher `config/`.**

## Le point sur lequel tout repose

**L'étape d'exécution ne doit pas hériter de la permissivité de l'étape de
construction.**

Le build a besoin de contourner la validation d'environnement ; l'exécution a
besoin de la subir. Si la variable qui désactive la validation traverse les
étapes, l'image démarre en production **sans vérifier sa configuration** — et
rien ne le dit, puisque tout est vert.

C'est littéralement le défaut que s26 a trouvé sur les clones il y a deux heures,
transposé à Docker. Le dépôt l'a déjà payé une fois.

Trois endroits où ce plan peut être faux :

1. **La variable de build qui survit à l'étape d'exécution.** À vérifier par
   `docker run` sans configuration : l'image **doit** refuser en nommant les
   variables manquantes. Si elle démarre, le défaut est là.
2. **Le `standalone` d'un monorepo pnpm.** Les paquets liés par `workspace:`
   doivent être résolus dans l'image. Ça ne se voit pas au `docker build`, mais
   au premier `docker run`.
3. **Une image construite en CI et jamais démarrée.** Le critère 7 parle de
   construction ; s'arrêter là livre une garantie creuse.

## Fichiers touchés (anticipé)

| Fichier | Nature |
|---|---|
| `Dockerfile` | image multi-étapes |
| `docker-compose.prod.yml` | pile de production |
| `.dockerignore` | empêche `.env` et `node_modules` d'entrer |
| `apps/web/next.config.ts` | `output: 'standalone'` |
| `docs/deployment.md` | guides Coolify et Vercel, checklist |
| `tests/deployment.test.ts` | checklist dérivée, Dockerfile |
| `.github/workflows/ci.yml` | construction de l'image |
| `AGENTS.md`, `docs/architecture.md` | docs |

## Stratégie de test

| Niveau | Ce qu'il couvre |
|---|---|
| `tests/deployment.test.ts` | checklist ↔ schéma, dans les deux sens ; l'image ne copie aucun secret |
| `docker build` + **`docker run`** | l'image démarre, et **refuse sans configuration** |
| mutation | **quatre** : phase de build posée à l'exécution ; variable du schéma non documentée ; `.env` copié dans l'image ; migration en échec n'interrompant pas |
| CI | `actionlint` + le balayage des `if:` de niveau job |
| recette manuelle | déploiement Coolify réel, trace consignée |

## Definition of Done

- Les sept critères vérifiés, sauf le critère 6 (Vercel) dont le guide est livré
  et l'exécution **déclarée non faite**.
- Le critère 5 (Coolify) **exercé pour de vrai**, URL, date et version consignées.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` verts.
- `docker build` **et** `docker run` vérifiés, y compris le refus sans configuration.
- Les quatre mutations vérifiées rouges.
- `actionlint` vert.
- Un seul commit, message impératif en français, portant recherche et plan.
