# Retour d'expérience killer-saas — référentiel

> **Ce fichier est la source unique** de tout ce que ce projet a mesuré sur la
> méthode killer-saas et de tout ce qu'il propose d'y changer. Il est écrit pour
> être lu par quelqu'un qui ne connaît pas ce dépôt, et pour qu'un rapport ou
> une demande de fusion vers killer-saas puisse en être tiré sans rien
> reconstituer.
>
> Version killer-saas installée : `e2b8578`, posée au commit `463c831`.
> **Le patch se régénère par** `git diff 463c831..HEAD -- .claude/` :
> tout ce qui a changé dans les skills et les commandes y figure.

## Le terrain

Un boilerplate SaaS complet mené par le pipeline, sans coder hors pipeline. Au
moment d'écrire : **20 stories sur 46 closes**, 1469 tests unitaires + 79
parcours navigateur déterministes, 37 ADR, six modules optionnels, deux
configurations de modules vérifiées. Pile : Next 16, React 19, TypeScript 7,
Tailwind v4, Drizzle, Better Auth, Stripe, Playwright, Vitest.

L'échantillon est ce qui donne du poids aux propositions : **14 tests faux** et
**7 défauts invisibles aux commandes** ont été trouvés, chacun daté et mesuré.

## Ce qui a trouvé les défauts — la base de toute décision

| Ce qui a trouvé | Nombre | Exemples |
|---|---|---|
| **Mutation posée à l'endroit du défaut** | 14 | empreinte volée acceptée comme code de secours ; `robots.txt` offrant `/reset-password?token=…` à l'indexation ; deux écritures inter-locataires sans filet |
| **Vérification navigateur** | 7 | QR code blanc sur noir ; avatar remplacé restant invisible ; libellé tronqué à un caractère à 390 px |
| **Revue indépendante en contexte frais** | tous les `critical` | croisement de locataires ; client réabonné traité comme expiré ; double prélèvement possible |
| **La fusion elle-même** | 6 | bloc de lint qui éteignait une règle voisine ; garde d'environnement née après ses propres cas |

Aucun n'a été trouvé par relecture seule. C'est le fait qui fonde les
propositions P1 à P4.

---

# Propositions

Chaque entrée : ce que fait killer-saas aujourd'hui, ce qui a été mesuré ici, ce
qu'on propose, où est le patch, et son état.

## P1 — La mutation doit être posée à l'endroit du défaut

- **Aujourd'hui** — `review-antihallu` demande de neutraliser un invariant et de
  compter les rouges. Il ne dit pas **où** poser la neutralisation.
- **Mesuré** — deux rapports ont annoncé « 1 rouge » pour une garde neutralisée
  *dans le module*, alors que le défaut vivait *au point de composition* :
  neutralisé là, **1320 tests sur 1320 restaient verts**. Le tableau de
  mutations mentait en toute bonne foi. Cas : s19, constats M1 et M2.
- **Proposé** — ajouter la règle et sa contre-épreuve : *avant d'écrire une
  ligne de tableau, demander si c'est l'endroit où un vrai défaut apparaîtrait,
  ou un endroit où mon propre code se trouve*. Et côté relecteur : *vérifier
  **où** chaque mutation est posée, pas seulement qu'elle rougit*.
- **Patch** — `.claude/skills/review-antihallu/SKILL.md`, `.claude/skills/tdd-skill/SKILL.md` (commit `cb72268`).
- **État** — appliqué ici.

## P2 — Chaque configuration de modules est un produit livrable

- **Aujourd'hui** — le pipeline promet qu'un module coupé ne laisse aucune
  trace, mais rien n'impose de jouer la configuration coupée.
- **Mesuré** — trois revues de suite (s10, s15, s11) ont trouvé des gardes qui
  **ne mordent que dans l'état que la CI ne jouait pas**. Une garde qui ne
  s'exécute jamais dans la configuration où elle mord est de la documentation.
- **Proposé** — matrice de CI `tous` / `socle` dans le gabarit de workflow, et
  la règle dans les deux skills. Corollaire mesuré : le contrôle « l'arbre reste
  propre » doit comparer à l'état **après configuration**, pas à l'arbre vierge.
- **Patch** — `.github/workflows/ci.yml` (commit `0323a9f`), skills (`cb72268`).
- **État** — appliqué ici.

## P3 — Trois familles de tests faux à nommer explicitement

- **Aujourd'hui** — `tdd-skill` liste les tests à ne pas écrire (inventaires,
  échos de doublure, instantanés de balisage…). Trois familles manquent, et
  chacune a produit une suite verte au-dessus d'un vrai défaut.
- **Mesuré** —
  1. **doublure complaisante** : la doublure refusait d'elle-même ce que le test
     croyait mesurer (s11, mutation O) ;
  2. **assertion sur une page non hydratée** : `toHaveCount(0)` avant tout rendu
     client passe quoi qu'il arrive (s14) ;
  3. **balayage syntaxique** contourné par une forme non prévue — guillemet,
     accent grave, variable, objet (s09, trois passes).
- **Proposé** — les trois dans `review-antihallu`, avec la contre-épreuve de la
  première : *neutraliser la règle côté serveur et vérifier que l'entrée forgée
  devient acceptée*.
- **Patch** — `.claude/skills/review-antihallu/SKILL.md` (`cb72268`).
- **État** — appliqué ici.

## P4 — Ne pas écrire ce qu'aucune commande ne vérifie

- **Aujourd'hui** — `AGENTS.md` pose la question « quelle commande échoue si on
  casse ça ? » pour les *règles*. Elle ne s'applique pas aux **comptes et
  garanties** écrits dans les commentaires, les `AGENTS.md` et les ADR.
- **Mesuré** — « la purge est mesurée » (aucun test ne l'appelait), « le
  compilateur contrôle ce câblage » (faux), « cinq occurrences, toutes citées »
  (onze sur six fichiers), « dix-huit invariants » (vingt), « trois
  opérations » (quatre). Cinq affirmations fausses, chacune lue comme vérifiée
  par l'agent suivant.
- **Proposé** — étendre la question aux affirmations, et préférer **dériver** un
  compte plutôt que l'écrire.
- **Patch** — `.claude/skills/tdd-skill/SKILL.md` (`cb72268`).
- **État** — appliqué ici.

## P5 — Effort et modèle proportionnés au risque de la story

- **Aujourd'hui** — le pipeline applique le même protocole à toute story.
- **Mesuré** — le coût est dominé par les **tours de correction**, pas par les
  revues : s19 a demandé trois revues et deux corrections, s13 deux et deux. Une
  revue de correction **ciblée sur le delta** coûte 104 k tokens là où la revue
  complète en coûte 197 k, pour la même exigence.
- **Proposé** — trois niveaux choisis par ce que la story peut casser, jamais
  par sa taille ; briefing court quand l'historique est déjà dans les fichiers
  que l'agent lit ; revue de correction ciblée sur le delta. **Ce qui ne bouge à
  aucun niveau** : revue indépendante en contexte frais, mutations à l'endroit
  du défaut, deux configurations de modules, vérification navigateur dès qu'il y
  a un écran.
- **Patch** — `docs/STATE.md`, sections « Effort et modèle » et « Ce qui ne se
  négocie à aucun niveau » (commits `c36ccfb`, `4adc850`).
- **État** — appliqué ici. **Candidat à remonter dans `ks-review` et `ks-execute`.**

## P6 — Le travail en parallèle a des fichiers chauds et des ressources partagées

- **Aujourd'hui** — le pipeline prévoit un worktree par story, sans dire ce que
  plusieurs voies partagent.
- **Mesuré** — quatre collisions distinctes :
  1. **serveur Playwright partagé** : `reuseExistingServer: true` faisait
     mesurer l'arbre d'une autre branche — 20 rouges parasites, et le cas
     symétrique aurait donné un **vert obtenu contre le mauvais code** ;
  2. **numéros d'ADR** : deux voies prenant le même numéro ne produisent
     **aucun conflit git**, les fichiers ayant des noms différents — les deux
     survivent et la numérotation ment ;
  3. **base de données partagée** : deux suites qui migrent en même temps
     rougissent pour rien ;
  4. **outils partant de la racine du dépôt** : balayage Tailwind, `pnpm lint`
     et Playwright voient les worktrees des autres voies, qui vivent **dans** le
     dépôt.
- **Proposé** — port et base par voie ; réservation de **deux** numéros d'ADR
  par voie (un tour de correction en consomme parfois un) ; `reuseExistingServer:
  false` ; et tout balayage part de `git ls-files` ou exclut
  `.claude/worktrees/`.
- **Patch** — `playwright.config.ts` (`df3bb2f`), `tooling/eslint/base.ts`
  (`0c85639`), `tests/design-system.test.ts` (`2dabca6`).
- **État** — appliqué ici. **Candidat à remonter dans `ks-orchestrator`.**

## P7 — La suppression du worktree fait partie de la fusion

- **Aujourd'hui** — rien ne dit quand supprimer un worktree.
- **Mesuré** — douze worktrees de stories fusionnées, **1,5 à 2,4 Go chacun**,
  ont rempli le disque à 100 %. Plus aucun outil ne pouvait écrire son fichier
  de sortie — **y compris ceux qui auraient libéré la place**. Un agent en cours
  s'est arrêté proprement plutôt que d'implémenter sans pouvoir mesurer.
- **Proposé** — étape de la procédure de fusion : `git worktree remove --force`
  puis `git worktree prune`, **seulement** pour une branche fusionnée — jamais
  pour une voie interrompue, dont le travail non commité est le seul exemplaire.
- **Patch** — `docs/STATE.md`, section « Fusionner une story » (`a4ba2dd`).
- **État** — appliqué ici. **Candidat à remonter dans `ks-ship`.**

## P8 — Un contrôle bloquant qui rougit toujours finit désarmé

- **Aujourd'hui** — le gabarit de CI installe le scan de secrets sans
  configuration.
- **Mesuré** — sur ce dépôt il rapporte **15 fuites**, toutes des doublures de
  test — dont plusieurs sont **les assertions qui vérifient que le code masque
  les clés**. Un job bloquant rouge dès le premier jour finit désarmé par
  quelqu'un que ça fatigue, et c'est ce désarmement qui laisse passer le vrai
  secret.
- **Proposé** — livrer un `.gitleaks.toml` qui autorise **par emplacement de
  test** et **par valeur manifestement fausse**, jamais par règle désactivée ; et
  le vérifier par mutation dans les deux sens.
- **Patch** — `.gitleaks.toml` (`313d553`).
- **État** — appliqué ici. **Candidat à remonter dans le gabarit de projet.**

## P9 — Le harnais déclare ce dont il a besoin, jamais le `.env` d'un poste

- **Aujourd'hui** — rien ne l'impose.
- **Mesuré** — deux fois. Les parcours de s18 passaient chez la voie **parce que
  son `.env` portait `STORAGE_LOCAL_DIRECTORY`** ; sur un clone neuf ils
  échouaient. Et s19 a livré une variable absente du workflow de CI : le serveur
  affichait `✓ Ready` puis mourait, dans les deux branches de la matrice.
- **Proposé** — règle explicite : ce dont `playwright.config.ts` et la CI ont
  besoin s'y déclare. Corollaire de mesure : **Next 16 charge sa configuration
  après la ligne `✓ Ready`** — une sonde qui s'arrête à cette ligne conclut à
  tort que les gardes d'environnement sont mortes.
- **Patch** — `playwright.config.ts`, `.github/workflows/ci.yml` (fusion s19).
- **État** — appliqué ici.

## P10 — Une consigne que la mesure contredit doit céder

- **Aujourd'hui** — le pipeline ne dit pas quoi faire quand la consigne de
  l'orchestrateur se révèle fausse.
- **Mesuré** — trois fois, et à chaque fois l'agent a eu raison contre moi : la
  contrainte d'unicité que j'imposais réintroduisait le défaut sous une autre
  forme (s19, mesuré, ADR 037) ; l'interdiction de toucher `playwright.config.ts`
  était contradictoire avec l'interdiction de dépendre d'un `.env` (s36) ;
  l'interdiction de toucher le workflow de CI a produit un job mort (s19).
- **Proposé** — écrire la règle : *une consigne que la mesure contredit cède
  devant la mesure, à condition que la réfutation soit montrée* — et le
  relecteur rejoue la réfutation avant de valider. C'est ce qui a été fait, et
  ça a fonctionné les trois fois.
- **État** — pratiqué ici, **à formaliser dans `ks-execute` et `ks-review`.**

## P11 — Le parallélisme n'achète rien quand le budget est la contrainte

- **Aujourd'hui** — `ks-orchestrator` prévoit un worktree par story, ce qui
  invite à mener plusieurs voies de front.
- **Mesuré** — la limite de budget a été atteinte **quatre fois**. Paralléliser
  ne crée pas de budget : sur une fenêtre donnée, le nombre de stories livrables
  est le même. Le coût, lui, est réel — dix fichiers en conflit à la dernière
  fusion, quatre blocs tronqués à réparer, trois coupures survenues à trois
  voies simultanées, et **six défauts créés par le parallélisme lui-même**.
- **Proposé** — mener **en série** par défaut, chaque branche partant d'un `dev`
  fraîchement fusionné. Ne garder qu'un chevauchement : la **revue** d'une story
  pendant l'implémentation de la suivante — c'est du pipeline, sans conflit
  possible, puisque la revue ne touche pas au code.
- **État** — décidé ici le 01/09, après achèvement des deux voies en cours.

---

# Observations sans proposition ferme

- **Le découpage des stories.** Deux stories ont dépassé 66 fichiers en un
  commit (s18, s19), et dans les deux cas les constats critiques étaient des
  **oublis de câblage** qu'un découpage aurait exposés plus tôt. La complexité
  annoncée (3 sur 5) ne l'avait pas prévu. Piste : un signal de découpage fondé
  sur le nombre de paquets créés plutôt que sur une note.
- **Le document de recherche séparé** n'a de valeur que si la story explore un
  terrain neuf ; pour une variation d'un motif déjà livré, il redit le connu.
- **Un piège de mesure produit aussi de faux rouges, pas seulement de faux
  verts.** Un postgres orphelin détournait `localhost:5432` sous un conteneur
  « healthy » : trois parcours rougissaient sans rapport avec le code livré.
  L'agent a eu raison de ne pas se les attribuer **et** de ne pas prétendre au
  vert ; rejoués sur environnement sain, 1507 tests et 79 parcours passent. La
  bonne réponse à un rouge inexpliqué est de mesurer l'environnement, pas de
  choisir entre s'accuser et se dédouaner.
- **Une revue peut affirmer faux, et faire corriger la mauvaise chose.** En
  s41, le rapport écrivait que le module MCP était « le seul sans les quatre
  couches » ; c'est inexact — `i18n` n'en a que deux. L'implémenteur l'a mesuré
  et corrigé dans sa réponse. Le pipeline n'a aucun mécanisme pour ça : le
  rapport de revue est traité comme une vérité. Piste : rendre explicite qu'un
  implémenteur peut **réfuter un constat par la mesure**, comme il peut réfuter
  une consigne — trois réfutations de consigne se sont révélées justes.
- **Les mutations vertes déclarées** sont un signal de qualité, pas un aveu :
  trois voies ont signalé d'elles-mêmes une mutation restée verte plutôt que de
  la taire. Le skill pourrait le dire explicitement pour l'encourager.

---

# Journal des correctifs de processus

| Date | Constat | Correctif | Proposition |
|---|---|---|---|
| 31/08 | Playwright réutilisait le serveur d'un autre worktree | `reuseExistingServer: false`, `E2E_PORT` par voie | P6 |
| 31/08 | La CI ne jouait qu'une configuration de modules | matrice `tous` / `socle` | P2 |
| 31/08 | Un agent tué laisse sa mutation appliquée | restaurer dans la commande qui la pose | P1 |
| 01/09 | Deux voies prenant le même numéro d'ADR, sans conflit git | réservation, deux numéros par voie | P6 |
| 01/09 | Mutation déplacée annoncée « 1 rouge », défaut resté vert | mutation à l'endroit du défaut | P1 |
| 01/09 | Scan de secrets rouge dès le premier jour sur des doublures | `.gitleaks.toml` vérifié par mutation | P8 |
| 01/09 | Disque plein : douze worktrees de stories fusionnées | suppression dans la procédure de fusion | P7 |

---

# Comment régénérer ce rapport

1. **Le patch des skills et commandes** : `git diff 463c831..HEAD -- .claude/`
   — killer-saas est installé au commit `463c831`, version `e2b8578`.
2. **Les correctifs de processus** : `git log --oneline --grep='^docs(process)'`
   et le journal ci-dessus.
3. **Les mesures citées** : chaque constat renvoie à un rapport de revue dans
   `docs/reviews/<story>.md`, qui porte la mutation, son compte de rouges et la
   commande qui l'a produite.
4. **Les décisions structurelles** : `docs/decisions/` — 37 ADR, chacun avec ses
   options rejetées et la mesure qui les tue.
