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
moment d'écrire : **30 stories sur 47 closes** et une trente-et-unième en vol
(s28, limitation de débit), 48 ADR sur `dev`, six modules optionnels, deux
configurations de modules vérifiées. Pile : Next 16, React 19, TypeScript 7,
Tailwind v4, Drizzle, Better Auth, Stripe, Playwright, Vitest.

Les comptes de tests sont donnés **par branche**, parce qu'ils bougent à chaque
story : sur `feature/s28-rate-limiting`, 1941 tests unitaires et 90 parcours
navigateur, mesurés en cinq passages complets pour la suite unitaire et trois
pour les parcours.

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
- **Mesuré à nouveau en s28, et c'est le cas le plus cher** — « c'est
  `maxPerSubject` qui borne l'énumération 2FA » était écrit en **cinq endroits**
  (`config/security.ts`, `docs/security.md` §7, `packages/core/src/module.ts`,
  un ADR, un `AGENTS.md` de module) et tenu par **zéro commande** : le seuil
  livré valait 10 alors que la bibliothèque détruit le défi à 5, donc il ne
  pouvait jamais mordre le premier. La ligne vivait dans un tableau intitulé
  « ce qui échoue si on le viole », colonne `pnpm test` — et `pnpm test` était
  vert. Deux autres au même endroit : « **deux** plafonds bornent l'énumération
  2FA » (il y en a trois — le verrouillage par compte de la bibliothèque, actif
  par défaut et jamais configuré ici, en est un quatrième axe), et « un
  cinquième port **non documenté** fait rougir `pnpm test` » alors que la
  commande n'exige que la présence de la **chaîne du nom de fichier**.
- **Mesuré une nouvelle fois en s29, avec un angle que les précédents n'avaient
  pas** — l'affirmation ne se contentait pas d'être invérifiable, elle **nommait
  un test qui n'existe pas**. L'ADR 053 écrivait « `tests/deployment.test.ts` en
  garde la trace » : `grep -rn outputFileTracing tests/` rend **zéro**
  occurrence. Et la garantie voisine, écrite dans `apps/web/AGENTS.md`, était
  fausse au fond : la ligne de configuration retirée, le build embarque
  **toujours** les fichiers, parce qu'un `resolve(process.cwd(), …)` fait tracer
  le projet entier — l'avertissement du build le dit lui-même. Deux phrases,
  deux endroits qu'un agent lit en premier, toutes deux fausses, et l'une citant
  une commande comme preuve. **Citer un nom de fichier de test est plus
  dangereux que de ne rien citer** : le lecteur suivant ne va pas le chercher.
  Piste : une règle exécutable qui vérifie que tout nom de fichier de test cité
  dans un ADR ou un `AGENTS.md` existe réellement — c'est mécanique, et ça
  aurait attrapé celui-ci.
- **La contre-mesure qui a marché, et qui est généralisable** — au lieu d'écrire
  le plafond de la dépendance, le test le **dérive du paquet installé**
  (`beginAttempt\((\d+)\)` lu dans le `dist/`), et compare le seuil du dépôt à
  la valeur trouvée. Une montée de version qui déplace le plafond rougit au lieu
  de laisser la phrase pourrir. Le test est **fail-closed** : si le chemin
  n'existe pas, la lecture lève au lieu de verdir. C'est la forme la plus forte
  de « dériver plutôt qu'écrire » rencontrée jusqu'ici, parce qu'elle dérive
  d'un tiers, pas du dépôt.
- **Proposé** — étendre la question aux affirmations, et préférer **dériver** un
  compte plutôt que l'écrire — y compris depuis une dépendance installée quand
  c'est elle qui tient la garantie.
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

- **Mesuré à nouveau, et bien pire, le 04/09** — le scan de secrets n'a **jamais**
  été vert sur une demande de fusion. Sur l'événement `pull_request`,
  `gitleaks-action` appelle `GET /repos/:owner/:repo/pulls/:number/commits` ; sans
  `pull-requests: read`, le jeton par défaut répond **403 « Resource not
  accessible by integration »** et l'action meurt **avant de scanner**. Le job
  rougissait donc en 8 secondes sans avoir rien vérifié, tout en passant sur
  l'événement `push` du **même commit**, où il scanne l'historique entier.
  Vérifié sur les demandes de fusion **4, 5, 6 et 7** : rouge à chaque fois d'un
  côté, verte à chaque fois de l'autre. **Trois stories ont été fusionnées
  au-dessus de ce rouge** sans que personne le relève.
- **Ce que ça dit du mode d'échec** — P8 supposait qu'un contrôle qui rougit
  toujours finit *désarmé* par décision. Ici il n'a même pas été désarmé : il est
  resté armé, rouge, et **contourné en silence**, parce qu'un second job du même
  nom était vert à côté. Deux exécutions homonymes suffisent à rendre un rouge
  invisible.
- **Correctif** — `permissions: { contents: read, pull-requests: read }` sur le
  job, avec la cause écrite en commentaire à l'endroit du défaut (commit
  `730e492`, fusionné avec s28).
- **Proposé, en plus de P8** — avant de fusionner, lire l'état des contrôles
  **par événement**, pas le rollup : un `pass` et un `fail` portant le même nom
  ne sont pas un contrôle instable, ce sont deux contrôles différents dont un est
  cassé.

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

## P12 — Un harnais de parcours doit réchauffer les routes avant de mesurer

- **Aujourd'hui** — le gabarit lance Playwright contre `next dev` sans
  préambule.
- **Mesuré** — `next dev` compile chaque route à sa **première** requête, et
  cette compilation tombe à l'intérieur d'une assertion. Dans un conteneur borné
  à deux cœurs : une inscription coûte **7 630 ms** cache vide contre **350 ms**
  cache chaud, pour un délai d'assertion de 5 000 ms. La suite passait sur un
  poste à huit cœurs et rougissait sur le runner — quatre parcours, dans les
  deux branches de la matrice, à la **première** exécution de CI du projet.
- **Ce que la mesure a écarté** — le nombre de travailleurs (la CI en utilise
  **un**, Playwright prenant la moitié des cœurs : elle est plus sérielle que le
  poste) et l'isolement d'état (suite rejouée dans l'ordre du job, à un
  travailleur, machine chargée : 80 vertes).
- **Proposé** — un préambule qui demande une fois chaque point d'entrée avant le
  premier parcours, avec les cibles **dérivées** de l'arborescence des routes :
  un segment que la dérivation ne sait pas rendre fait échouer le préambule
  plutôt que de laisser une route non réchauffée. Sans allonger un seul délai,
  sans reprise, sans sérialiser.
- **Patch** — `e2e/support/warm-up.ts`, `playwright.config.ts` (commit `bf821c6`).
- **État** — appliqué ici. **Candidat fort à remonter** : tout projet du gabarit
  a ce défaut, et il ne se voit que le jour où la CI tourne.

## P13 — Le préambule d'une suite doit être prouvé porteur, pas supposé

- **Aujourd'hui** — rien n'oblige un préambule de suite à être vérifié. P12 a
  fait naître un préambule qui **réchauffe** les routes ; personne n'a demandé
  ce qui arrive à l'état **partagé** que la suite elle-même remplit.
- **Mesuré** — dès qu'un compteur partagé est persistant, la suite se limite
  elle-même. Après un passage complet, le seau de l'inscription portait **41**
  passages pour un seuil de 120 sur une fenêtre horaire : le **troisième**
  passage d'une même heure franchit la borne. Sans nettoyage, le deuxième
  passage échoue déjà et le troisième tombe à **53 verts sur 89**, puis, mesuré
  autrement, **62 verts sur 89 avec 27 rouges** — et **pas un seul rouge ne
  nomme la limitation** : ce sont des localisateurs qui expirent. Le symptôme ne
  désigne jamais la cause.
- **Ce qui a rendu le préambule sûr** — il vide la table **avant** le premier
  parcours, sous garde `to_regclass` pour qu'une base sans migration ne fasse
  pas planter la suite au lieu de la faire rougir.
- **Ce qui a rendu le préambule *crédible*** — il a été **muté** : nettoyage
  désactivé et le seau amené à la borne, la suite tombe. Un préambule qu'on ne
  mute pas est une ligne de code qu'on croit utile.
- **Proposé** — quand une story introduit un état partagé et persistant, sa
  définition de terminé inclut : le préambule qui le remet à zéro, **et** la
  mutation qui prouve que ce préambule porte. Formulation générale : *tout ce
  qu'une suite écrit dans un état partagé, elle le remet à zéro avant de
  mesurer, et elle le prouve.*
- **État** — appliqué en s28 (`e2e/support/warm-up.ts`). **Candidat à remonter**
  : le défaut n'existe qu'à partir du jour où un projet a un compteur partagé,
  et il se présente alors comme une suite instable, jamais comme une limitation.

## P14 — Un garde transverse qui ajoute un refus doit être classé par chaque écran qu'il atteint

- **Aujourd'hui** — le pipeline vérifie qu'un garde **refuse**. Rien ne vérifie
  ce que l'utilisateur **lit** quand il refuse.
- **Mesuré** — s28 pose un limiteur au répartiteur, en amont des gestionnaires.
  Le 429 court-circuite donc le mappage de refus des gestionnaires. Les
  formulaires d'authentification connaissaient trois classes (`restart`, `used`,
  repli `invalid`) : `rate_limited` tombe dans le repli, et l'écran annonce
  « **Ce code n'est pas valide** » à un utilisateur dont le code est **correct**,
  jusqu'à 300 s, en l'invitant implicitement à réessayer — exactement ce qu'une
  limitation demande de ne pas faire. Le `Retry-After` que le serveur calcule
  honnêtement n'est jamais montré.
- **Le détail qui fait la proposition** — ce défaut n'existait pas tant que le
  seuil était **au-dessus** de celui de la bibliothèque : le refus venait alors
  du gestionnaire, correctement traduit. C'est le **correctif de sécurité** de
  la ronde précédente, en abaissant le seuil, qui a déplacé le premier refus
  d'une couche à l'autre et rendu le trou atteignable. Un correctif juste sur
  son axe peut ouvrir un défaut sur un autre.
- **Ce que le dépôt savait déjà** — la classe de refus `throttled` existait
  depuis s11 sur les formulaires publics. Le motif était là ; la story ne l'a
  pas étendu aux écrans que son propre garde venait d'atteindre.
- **Proposé** — quand une story ajoute un refus **transverse**, sa définition de
  terminé inclut l'inventaire **dérivé** des écrans qui peuvent désormais le
  recevoir, et un cas par écran qui vérifie ce que l'utilisateur **lit**, pas
  seulement le code de statut. Un cas qui n'assère que le 429 est un test plus
  vert que son nom.
- **État** — corrigé en s28. **Candidat à remonter** : tout projet du gabarit
  qui ajoutera une limitation, un pare-feu applicatif ou une garde de
  maintenance rencontrera la même chose.

## P15 — Une phase ne provisionne que ce qu'elle utilise

- **Aujourd'hui** — `/ks-research` impose de créer le worktree avant toute
  lecture, et le `worktree-manager` importe les `.env` et installe les
  dépendances. C'est tout ce que le skill demande : ses 43 lignes ne
  mentionnent **ni base de données, ni port, ni migration**.
- **Mesuré le 04/09** — cinq conteneurs PostgreSQL tournaient en même temps,
  **un seul travaillait**. Deux avaient été créés pour des *recherches*, qui
  sont en lecture seule : celle de s29 a fait des `grep`, ouvert des fichiers et
  exécuté **un** script jetable important `config/features.ts` — elle ne s'est
  jamais connectée à une base. Un troisième survivait à la fusion de s28. À côté,
  six volumes orphelins de stories fusionnées, **395 Mo**, et le compteur monte
  d'environ 70 Mo par story.
- **Où était la faute** — pas dans la méthode : dans les consignes écrites à
  chaque appel du `worktree-manager` (« this story needs a working PostgreSQL »,
  « allocate a free port », « run the migrations »). L'agent a fait exactement ce
  qu'on lui demandait. C'est un défaut d'appelant, pas d'outil, et c'est la
  raison pour laquelle il a duré : rien ne le signalait.
- **Ce qui a une vraie contrainte, et qu'il ne faut pas casser en corrigeant** —
  deux implémenteurs qui lancent `pnpm test` **en même temps** sur une même base
  se télescopent. La preuve est dans le dépôt : `tests/billing.test.ts` rougit
  déjà par intermittence sur un delta **global** de `auth_session`, parce que les
  fichiers d'un **seul** passage se courent après sur une base ; mesuré à 2
  rouges sur 9 exécutions. Deux voies simultanées rendraient cet intermittent
  permanent.
- **Proposé** — provisionner par phase, pas par story :

  | Phase | Worktree | Base |
  |---|---|---|
  | Recherche | non — lecture seule sur la branche par défaut ; le document se commite au moment de l'exécution | **non** |
  | Design | non | non |
  | Plan | non | non |
  | Exécution, revue | oui | oui, **le temps des tests** |

  Et une base **par voie simultanée**, pas par story : en exécution séquentielle,
  une seule suffit et se réutilise. La suppression du conteneur et du volume
  rejoint la procédure de fusion, là où P7 a déjà mis celle du worktree.
- **État** — corrigé côté appelant dès le constat (trois conteneurs arrêtés,
  aucun détruit). **Candidat à remonter** : le coût est invisible sur une story
  et devient un disque plein sur trente — exactement la trajectoire que P7 a
  déjà documentée pour les worktrees.

## P16 — Une voie de recherche unique et réutilisée, au lieu d'un atelier complet par story

- **Aujourd'hui** — chaque story reçoit son worktree dès la **recherche**, avec
  `pnpm install` complet et, dans les faits, une base de données. P15 a montré
  que la base ne sert à rien à cette phase ; ce qui suit chiffre le reste.
- **Mesuré le 04/09** — `node_modules` d'un worktree : **827 Mo**. Trois voies
  ouvertes : **2,8 Go**. Un volume PostgreSQL par story : ~70 Mo. Un appel du
  `worktree-manager` : **~36 000 tokens**. Soit environ **900 Mo et 36 k tokens
  par story**, dont la phase de recherche n'utilise ni le conteneur, ni sa copie
  privée de `node_modules` — elle lit des fichiers et exécute au plus un script
  jetable. Sur les stories restantes au moment d'écrire, c'est la moitié du coût
  de provisionnement engagée pour une phase en lecture seule.
- **Proposé** — **une voie de recherche unique**, par exemple
  `.worktrees/_recherche`, créée une fois et réutilisée :

  1. dépendances installées **une seule fois** (827 Mo au total, pas par story) ;
  2. **aucun conteneur**, jamais — et si une recherche en avait réellement besoin
     un jour, elle démarre celui qui existe déjà plutôt que d'en créer un ;
  3. pour chaque story : créer `feature/<id>` depuis la branche par défaut,
     écrire `docs/research/<id>.md`, commiter, **pousser**, puis revenir à la
     branche par défaut pour la story suivante ;
  4. la voie d'exécution part de la branche **déjà poussée** ; c'est là, et là
     seulement, que le worktree dédié et la base apparaissent, et ils
     disparaissent à la fusion (P7, P15).

- **Ce que ça achète en plus, et qui n'était pas le but** — pousser la branche
  dès la recherche rend la **péremption visible**. Une recherche écrite contre un
  état de la branche par défaut qui a bougé depuis devient fausse en silence ;
  une branche poussée, elle, diverge **et git le dit**. Le rebase avant exécution
  cesse d'être une discipline et devient une étape que l'outil réclame.
- **La réserve, à traiter avant d'appliquer** — `AGENTS.md` interdit aujourd'hui
  d'improviser un `git switch`, `git checkout` ou `git stash` dans un worktree, et
  la voie de recherche **change de branche par construction**. La règle a été
  écrite pour empêcher un agent de story de dériver hors de sa branche ; elle
  n'anticipe pas une voie dont c'est le métier. Appliquer P16 demande donc
  d'écrire la dérogation **en la nommant** — une voie déclarée, un seul agent à la
  fois dedans, jamais de travail de story — sinon la proposition contredit une
  règle contraignante, ce qui est pire que le gaspillage qu'elle corrige.
- **Ce que ça ne change pas** — deux exécutions **simultanées** gardent leurs
  bases séparées (P15) : la course inter-fichiers sur `auth_session` le prouve
  déjà à l'échelle d'un seul passage.
- **État** — proposé, non appliqué. Prérequis : la dérogation d'`AGENTS.md`
  ci-dessus. **Candidat fort à remonter** : le gaspillage est invisible sur une
  story et vaut plusieurs gigaoctets sur trente.

## P17 — La recherche se commite sur la branche par défaut ; le plan et la revue restent sur la branche

- **Aujourd'hui** — `AGENTS.md:136` range `docs/research/<id>.md` avec le plan et
  la revue : « committed on `feature/<id>` … **Every PR carries its own research,
  design, plan and review.** » C'est cette ligne, et elle seule, qui oblige à
  créer une branche **avant de pouvoir chercher** — donc tout le mécanisme que
  P16 propose pour rendre ça économique.
- **Ce que le PRD demande réellement** — angle 3, `docs/prd.md:87` : « sa
  recherche, son plan, ses tests et sa revue **versionnés dans `docs/`** ».
  *Versionnés dans le dépôt*, pas *portés par la demande de fusion*. La
  contrainte de branche est un durcissement d'`AGENTS.md`, pas une exigence du
  cadrage.
- **La distinction qui tranche** — la recherche documente le **terrain avant le
  changement** ; le plan et la revue documentent **le changement**. Le plan
  décide ce qu'on va faire du diff, la revue le juge : les deux sont couplés à la
  branche et doivent y rester. La recherche est un instantané du dépôt tel qu'il
  est, et **elle reste vraie même si la story est abandonnée ou annulée**. C'est
  la seule des trois dont le contenu ne dépend pas du diff.
- **Ce que la version stricte achetait, et ce qu'on perd vraiment** :
  1. *atomicité du revert* — annuler la story emporterait sa recherche. Perte
     réelle mais faible, par la distinction ci-dessus : une recherche décrit le
     terrain, pas le code livré ;
  2. *correction en cours de cycle* — sur une branche, une recherche fausse
     s'amende dans le commit unique et n'atterrit que juste. Sur la branche par
     défaut, la version fausse est déjà publique. **Mais c'est aussi ce qui la
     fait corriger plus tôt** : deux recherches se sont révélées à moitié fausses
     le 04/09 (la prémisse de l'audit en s48, le compte de l'invariant en s29),
     et les deux ont été relevées par la phase suivante, pas par la fusion ;
  3. *le relecteur voit le raisonnement dans le diff* — ne vaut que pour un
     humain sur GitHub : `/ks-review` lit le **fichier**, jamais le diff.
- **Proposé** — déplacer **la recherche seule** vers la branche par défaut, comme
  les documents de cadrage. Le plan, le design et la revue ne bougent pas. Effet :
  la recherche n'a plus besoin de branche, donc plus besoin de worktree, donc
  **P16 devient inutile** — plus de voie de recherche à créer, plus de dérogation
  à écrire dans `AGENTS.md` sur le changement de branche. Une story peut être
  recherchée des semaines avant d'être écrite, et sa recherche profite à toutes
  les autres en attendant.
- **Ce qu'il faut écrire en même temps** — la recherche gagne alors la même
  obligation que les autres documents de cadrage : **dater ce contre quoi elle a
  été vérifiée** (le commit de la branche par défaut), pour qu'un lecteur sache
  si elle a été doublée par une fusion. Sans cette ligne, on remplace une
  péremption visible par une péremption muette, ce qui serait un mauvais échange.
- **État** — **appliquée le 04/09** : `AGENTS.md` range désormais la recherche avec
  les documents de cadrage, avec l'obligation de dater le commit vérifié, et
  `templates/research.md` porte la ligne. Les quatre recherches d'avance ont été
  rapatriées. **Rend P16 caduque** — et c'est la bonne nouvelle : la
  proposition la moins chère est celle qui supprime le besoin, pas celle qui
  l'outille.

## P18 — La recherche de la story suivante se fait pendant la revue de la courante, dans un worktree nu

- **Aujourd'hui** — les phases s'enchaînent en file : recherche, design, plan,
  exécution, revue, ship, puis on recommence. La revue est la phase la plus
  longue et celle où le contexte principal **n'a rien à faire** : mesuré le
  04/09, entre 18 et 31 minutes par ronde, et s28 en a demandé cinq.
- **Proposé — quand la revue de la story N démarre, la recherche de la story N+1
  démarre aussi**, dans un worktree **nu** :
  - pas de conteneur, jamais (P15) ;
  - **pas de `pnpm install` par défaut**. Mesuré : un worktree complet pèse
    **836 Mo**, dont **827 Mo** de `node_modules` ; l'arbre source seul fait
    **9 Mo** sur 887 fichiers suivis. Une recherche lit des fichiers ; celle de
    s32 n'a rien exécuté, celle de s29 a eu besoin des dépendances pour **un**
    script jetable. Donc installation **à la demande**, quand la recherche doit
    exécuter quelque chose, et pas avant.
  - Coût d'une voie de recherche : **9 Mo** au lieu de 836.
- **La garde, sans laquelle la règle fabrique des recherches fausses** — la
  recherche de N+1 se fait contre une branche par défaut qui **ne contient pas
  encore** la story N. Si les deux touchent les mêmes points d'ancrage, la
  recherche naît périmée, et périmée en silence. Donc : **ne mettre en file que
  des stories dont la surface est disjointe de celle en revue**, et le vérifier
  au lieu de le supposer.
  - *Exemple qui marche, 04/09* : s48 (CI, `scripts/`, harnais) pendant que s29
    (marketing, plan de site, CSP) et s32 (mailer, notifications) étaient
    recherchées — trois surfaces disjointes.
  - *Exemple à ne pas faire* : s30 et s31 pendant s29. Les trois partagent le
    pipeline MDX, et c'est **s29 qui le crée** : les rechercher avant produirait
    deux documents décrivant un dépôt qui n'existe pas encore.
  - Les dépendances déclarées de `docs/stories.md` sont un bon premier filtre,
    mais elles ne suffisent pas : deux stories sans dépendance déclarée peuvent
    partager des fichiers.
- **Ce que ça compose avec** — si P17 est retenue (recherche commitée sur la
  branche par défaut), le worktree disparaît aussi et il ne reste que la règle
  d'ordonnancement. P18 est donc utile **dans les deux cas** : elle dit *quand*
  chercher, là où P15 à P17 disent *avec quoi*.
- **État** — l'ordonnancement a été appliqué le 04/09 (recherches de s29 et s32
  pendant la revue de s48) et il a tenu : les deux ont trouvé une décision
  structurelle que le plan aurait sinon découverte trop tard. Le worktree nu
  n'est pas encore appliqué — les deux voies ouvertes portent leurs 827 Mo.

## P19 — Le pipeline continue sans CI jusqu'à la fusion, et il faut savoir jusqu'où

- **Aujourd'hui** — rien ne dit ce qui reste faisable quand l'intégration continue
  est indisponible. La réaction naturelle est d'attendre.
- **Mesuré le 05/09** — GitHub Actions s'est arrêté au niveau du compte : tous
  les jobs morts en 3 secondes, sans journal, sur la branche par défaut comme
  sur les branches, sans qu'aucun commit ne touche `.github/`. Dépôt privé, donc
  minutes facturées. **Le travail a continué pendant plusieurs heures** :
  - **six recherches** écrites et poussées — elles ne demandent ni base, ni
    conteneur, ni CI (P15, P17) ;
  - **une story planifiée, exécutée et revue** de bout en bout, tout le harnais
    tournant en local : `typecheck`, `lint`, `test`, `build`, `test:e2e`,
    `test:socle`, `test:minimal-profile`, `audit`.
  Seule la **fusion** était bloquée.
- **Ce qui limite réellement**, et ce n'est pas la CI : chaque branche en attente
  diverge de la branche par défaut, donc coûte un rebase. Deux branches en
  attente se gèrent ; six deviennent un travail à part entière. **La règle
  praticable est de choisir des surfaces disjointes** — s30 (documentation,
  `packages/ui`) et s47 (facturation, autorisations) ne se recouvrent en rien,
  donc elles fusionneront dans n'importe quel ordre sans conflit.
- **Proposé** — écrire dans le gabarit ce que chaque phase exige réellement :

  | Phase | Base | Conteneur | CI |
  |---|---|---|---|
  | Recherche, design, plan | non | non | non |
  | Exécution, revue | oui | oui | **non** |
  | Ship | — | — | **oui** |

  Et une consigne d'ordonnancement : **quand la fusion est bloquée, n'avancer
  que sur des stories dont les surfaces sont disjointes**, et s'arrêter à deux ou
  trois branches en attente — au-delà, le coût de rebase dépasse le gain.
- **État** — appliqué le 05/09 pendant la panne. **Candidat à remonter** : la
  question « que puis-je encore faire ? » se pose à chaque indisponibilité d'un
  tiers, et la réponse par défaut — attendre — est la plus coûteuse.

## P20 — Quand la prose d'un document contredit sa propre table, c'est la table qui a raison

**Observé en s49.** La recherche produit une table de huit contrastes, puis conclut en une phrase : « Le mode sombre passe partout — le défaut est le mode clair seul. » Or sa propre table donne `info` en sombre à **4,41 : 1**, et le seuil de la story est 4,5 : 1. La phrase contredit la ligne qui la précède de six lignes, et rien ne l'a signalé.

Au recalcul indépendant, c'est le **chiffre** qui était faux (5,82 : 1), pas la conclusion. Mais l'ordre dans lequel on le découvre n'est pas neutre : j'ai vu la contradiction *avant* de savoir laquelle des deux moitiés céderait. Si le chiffre avait été juste, la story aurait livré une variante sous le seuil en croyant le contraire, et sa commande de vérification l'aurait attrapée — après.

**Ce qui rend le cas coûteux** : les quatre chiffres du mode clair étaient exacts, reproduits à la décimale par un calcul indépendant. Une table dont sept cellules sur huit sont justes inspire confiance en bloc, et c'est justement la forme d'erreur qu'aucune relecture ne voit. La recherche avait raison sur ce qui comptait, avec un chiffre faux et une phrase qui aurait dû rougir.

**Règle** : un document qui pose une table *et* une conclusion en prose doit être lu comme deux sources. La table est la mesure ; la prose est la thèse. Quand elles divergent, on ne choisit pas — **on recalcule**, et on écrit dans le document laquelle des deux a cédé. C'est le pendant, côté documents, de « une mutation verte veut dire que le test est faux » : la contradiction interne est un signal, pas une coquille.

**Où cela mord** : à ce jour, aucune commande ne relit une table de mesures d'un document de recherche. Le plan de s49 a rattrapé celle-ci parce qu'il refaisait le calcul pour choisir des valeurs — donc par chance, pas par dispositif. Piste, non implémentée : quand une recherche pose un seuil et une table, le plan qui s'en sert **recalcule au moins une ligne** et dit laquelle.


---

# Observations sans proposition ferme

- **La leçon a été appliquée dès la story suivante, et elle a coûté cinq minutes.**
  s30 a été découpée **le 05/09, avant d'écrire son plan** : la recherche avait
  rendu 4 avec une ligne de coupe, le décompte des tâches donnait onze à douze, et
  la coupe a été faite là plutôt qu'à mi-plan. La recherche plein texte et la
  validation des liens au build sont parties en `s54-docs-recherche` — les deux
  partagent une passe croisée sur l'ensemble du contenu que le reste de s30 n'a
  pas besoin de construire. C'est la même ligne que celle qui a séparé s29 de
  s53, et la troisième fois qu'elle tient : **« ce qu'on lit » d'un côté, « ce qui
  le fait trouver » de l'autre**. Pour un dépôt qui livre trois modules de contenu
  (blog, documentation, changelog), c'est probablement une ligne de coupe
  réutilisable, pas une coïncidence.
- **La découpe faite au plan arrive plus tard que celle faite à la recherche, mais
  elle arrive.** s29 a été découpée le 04/09 **au moment d'écrire son plan**, pas
  à la recherche : c'est le décompte des tâches — treize — qui a déclenché la
  règle du skill (« si le plan dépasse une dizaine de tâches, la story est trop
  grosse »). La recherche avait pourtant *proposé* la ligne de coupe, sans la
  trancher, parce que la note de complexité était 4 et que le gabarit ne réclame
  une découpe qu'à 5. Piste : un verdict de 4 assorti d'une proposition de coupe
  devrait être traité comme une question à trancher **à la recherche**, pas
  reportée au plan — le plan la tranche de toute façon, mais après avoir été
  écrit à moitié.
- **Dériver un compte trouve les trous que compter ne trouve pas.** Toujours en
  s29 : `apps/web/AGENTS.md` annonçait « sept fichiers font exception » en
  listant huit noms. Plutôt que de corriger le chiffre, la règle a été rendue
  **dérivée** — un test lit sur le disque les fichiers de `apps/web/lib` qui
  importent un module et exige que chacun soit nommé. La dérivation a
  immédiatement révélé un **neuvième trou préexistant** (`lib/rate-limit.ts`,
  documenté nulle part), que personne ne cherchait. C'est l'argument le plus
  concret pour P4 rencontré jusqu'ici : dériver ne se contente pas d'empêcher
  le compte de vieillir, il **trouve ce que le compte cachait**.
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
- **Le précédent qui tranche une question est souvent dans le fichier qu'on
  édite, dix lignes plus bas.** En s47, un plafond de sièges posé sur une offre à
  achat unique était **accepté et sans effet** — le câblage résout l'offre depuis
  l'abonnement vivant, qu'un achat unique n'a pas. Le même fichier refuse déjà
  une période d'essai sur une offre à achat unique, avec la raison écrite :
  « *une intention que rien n'exécute : le fournisseur l'ignorerait en silence* ».
  Même objet, même remède, six lignes de `superRefine`. Ni l'implémenteur ni le
  plan ne l'avaient vu ; c'est la revue qui a lu le voisinage. **Piste** : avant
  d'ajouter un champ à une structure de configuration, lire **ce que les champs
  voisins refusent** — la question a souvent déjà été tranchée, et l'incohérence
  coûte plus qu'une règle manquante.
- **Un champ de sortie sans consommateur, et un commentaire qui en invente un.**
  Toujours en s47 : `SeatSyncOutcome` porte un plafond « *qui voyage avec le
  refus, le message qui le nomme étant composé plus haut* ». Le balayage de la
  revue : ce plafond n'est **lu nulle part**, et le seul message qui le nommerait
  n'est rendu par **aucun parcours** — il n'est atteignable qu'en tapant le
  paramètre d'URL à la main. La moitié « le propriétaire voit la limite nommée »
  d'une décision de plan n'avait donc **aucune porte**, et rien ne rougissait.
  C'est le pendant exact du compte écrit : une **donnée** transportée sans
  consommateur vieillit comme un nombre, en silence. Piste : quand une décision
  de plan nomme un destinataire, vérifier qu'un chemin l'atteint — le grep du
  champ suffit.
- **Une liste qui sert de validateur cache ses propres oublis.** Mesuré en s47 :
  `ACCEPT_REFUSALS` est un sous-ensemble **écrit** de `INVITATION_REFUSALS`, et
  c'est la liste contre laquelle le paramètre `?error=` de l'écran d'acceptation
  est validé. Un motif absent de cette liste est donc **muet à l'écran** — et
  **aucun test unitaire ne le voit**, puisqu'ils valident contre cette même
  liste. Mesure : retirer le nouveau motif fait rougir **1 cas navigateur** et
  laisse **175 tests de nœud verts**. La recherche l'avait prédit, le correctif
  l'a confirmé au chiffre près. La leçon générale : **quand une liste sert à la
  fois de source et de validateur, elle ne peut pas attraper son propre oubli**
  — il faut un cas qui traverse la vraie surface, ici un parcours navigateur.
  Le dépôt a d'autres listes de cette forme.
- **Une liste d'intermittents se comporte exactement comme un compte écrit : elle
  vieillit, et on la lit comme vérifiée.** Deux fois en deux stories, la liste des
  cas instables a nommé **un cas sur plusieurs** : `e2e/oauth.spec.ts:97` alors
  que la paire est `:30`/`:97` (identité partagée du fournisseur local), puis
  `e2e/rate-limiting.spec.ts:38` alors que `:163` et `:205` rougissent dans les
  mêmes conditions. À chaque fois, la story suivante rencontre le cas non nommé et
  doit décider seule s'il lui appartient. C'est le même remède que pour les
  comptes : **écrire ce qui a été balayé et sur combien d'exécutions**, jamais
  « les N intermittents connus ». Et tant qu'ils ne sont pas fermés, une liste
  incomplète coûte plus qu'une liste absente — elle éteint la recherche.
- **Une affirmation fausse se corrige par un balayage de son *contenu*, jamais par
  la liste des endroits dont on se souvient. Trois occurrences en trois stories.**
  s29 : une garantie corrigée dans un ADR et un `AGENTS.md`, laissée intacte dans
  le commentaire au-dessus de la ligne concernée — puis, une fois celui-là
  corrigé, retrouvée dans le **corps du message de commit**. s53 : la règle que
  la story existe pour réfuter, encore enseignée par **deux docblocs de
  `packages/core`**, dont celui du contrat — le premier fichier qu'on ouvre pour
  écrire un module. À chaque fois, celui qui corrigeait avait la bonne intention
  et une liste incomplète. Le remède est mécanique et tient en une ligne :
  **`grep` sur la formulation, dans plusieurs de ses tournures, avant d'écrire
  quoi que ce soit** — et rapporter le nombre de sites trouvés, pas le nombre de
  sites corrigés. Une consigne de correction devrait exiger ce compte.
- **Six citations peuvent pointer vers une règle qui n'existe pas, et l'une
  d'elles vivre dans un document immuable.** En s53, la décision centrale
  s'appuie six fois sur `docs/security.md` §7 — dont une fois dans un ADR. Or §7
  s'intitule « Journalisation, détection et abus » et ne porte pas la règle
  citée. La décision est bonne, elle est même gardée par deux commandes réelles ;
  c'est le **pointeur** qui est faux, et il a été promu en autorité par une story
  qui l'a hérité d'une autre. Deux enseignements : une citation de section se
  vérifie comme un nom de fichier de test — le dépôt a déjà payé pour l'un —, et
  **le meilleur correctif est souvent de rendre la citation vraie** plutôt que de
  la retirer, quand la règle citée mérite d'exister. Ici, l'ajouter à
  `docs/security.md` avec la commande qui échoue quand on la viole rend les six
  citations exactes d'un coup, sans superséder l'ADR.
- **Une dérivation qui paraît gratuite doit être mesurée sur l'ensemble dont elle
  dérive, pas sur le cas qui l'a inspirée.** La recherche de s53 a vu que le
  module `blog` déclarait une entrée de navigation **publique** et en a conclu
  que `robots.txt` pouvait dériver sa liste d'autorisation des entrées publiques
  du registre — « sans aucune clé nouvelle ». L'implémenteur a regardé ce que ce
  registre contient réellement : **cinq** entrées publiques, dont l'écran de
  connexion, la page de tarifs et **une route d'API**. Dériver de là aurait
  publié `/sign-in` dans `robots.txt` et le plan de site, ce que
  `tests/marketing.test.ts` et `docs/security.md` §7 interdisent. La recherche
  avait généralisé depuis **un** cas sans énumérer l'ensemble — exactement le
  mode d'échec que le dépôt nomme, commis par le document dont le métier est de
  vérifier les prémisses. Piste : quand une recherche propose une dérivation,
  elle doit **exécuter** la dérivation sur l'état réel et lister ce qu'elle
  produit, pas décrire ce qu'elle produirait. Le coût est d'un script jetable ;
  ici, il aurait tenu en cinq lignes.
- **Corriger une affirmation fausse à deux endroits en laisse une au troisième,
  et le troisième est celui du code.** En s29, une garantie mesurée fausse était
  écrite dans un ADR, dans un `AGENTS.md`, **et en commentaire au-dessus de la
  ligne de configuration concernée**. Les deux premières ont été corrigées ; la
  troisième — celle qu'ouvre exactement l'agent qui viendrait toucher ce
  fichier — est restée. Et la note qui rendait compte du correctif écrivait
  « les **deux** phrases », un compte au-dessus d'une liste plus longue : le
  défaut de P4 réintroduit *à l'intérieur* de sa propre correction. Piste : quand
  une affirmation est jugée fausse, la chercher par son **contenu** dans tout le
  dépôt avant de la corriger quelque part — pas par la liste des endroits où on
  se souvient de l'avoir écrite.
- **Un mécanisme faux au service d'une conclusion juste est plus dangereux qu'un
  mécanisme absent.** Toujours en s29 : la conclusion « la liste ne peut pas
  avoir d'état de chargement sans perdre son 404 » est exacte et vérifiée. Le
  *mécanisme* écrit pour la justifier — « la frontière d'un segment couvre ses
  enfants, aucun placement ne sauve les deux » — a été **réfuté en cinq minutes**
  par la revue, qui a montré qu'un groupe de routes scope bien la frontière. Un
  lecteur qui infirme le mécanisme conclura que la contrainte entière est du
  folklore, et posera le repli. Le coût n'est pas théorique : la garde
  exécutable ne mordait que sur deux des trois placements, si bien que le repli
  scopé aurait servi une page en 200 là où elle doit rendre 404, **sans qu'une
  seule commande rougisse**.
- **Un confort d'interface peut désarmer une règle de sécurité, sans que rien ne
  le dise.** Mesuré en s29 : poser un `loading.tsx` sur un segment fait vider la
  coquille vers le client **avant** que la page ne décide, si bien qu'un
  `notFound()` arrive en **HTTP 200**. Le parcours navigateur l'a attrapé — 200
  au lieu de 404 — et la limite posée au niveau parent donne le même résultat :
  **aucun placement ne sauve à la fois l'état de chargement et le 404**. Or le
  404 n'est pas ici un détail d'ergonomie : `docs/security.md` §3 en fait la
  réponse à la ressource d'autrui. L'arbitrage était donc écrit d'avance —
  le squelette a été retiré et le manque signalé, pas comblé. Deux choses à en
  tirer : la contrainte **attend s30 et s31 au même endroit**, puisqu'elles
  rendront le même genre de contenu ; et c'est un parcours navigateur, pas un
  test unitaire, qui l'a vue — un cas qui aurait vérifié « la page rend
  `notFound()` » serait resté vert.
- **Une mutation verte trouvée *pendant* l'implémentation vaut mieux que la même
  trouvée en revue, et le dépôt n'a pas de mot pour ça.** En s29, deux mutations
  sont restées vertes et l'implémenteur a corrigé **les tests, pas le code** : le
  cas « clé de frontmatter inconnue » était satisfait par un champ *manquant*,
  donc `strict()` n'était jamais exercé ; et la mutation du tri restait verte
  parce que `readdirSync` rend des noms déjà triés qui coïncidaient avec l'ordre
  des dates — la fixture ordonne désormais les noms **contre** les dates, et le
  commentaire le dit. C'est exactement la règle du dépôt appliquée par celui qui
  écrit, avant que quiconque ne le lui demande. Le skill parle de mutations
  vertes comme d'un aveu à ne pas taire ; il pourrait les nommer comme un
  **livrable** de la phase d'exécution : « combien de mutations ont été posées,
  combien sont restées vertes, et ce qui a changé à cause d'elles ».
- **Un invariant qu'aucune mutation ne peut atteindre doit être écrit comme tel.**
  Toujours en s29 : le départage par slug à dates égales n'est pas couvrable,
  parce que `readdirSync` rend déjà des noms triés sur les systèmes de fichiers
  essayés — aucune fixture ne peut mettre la règle en défaut. L'implémenteur l'a
  écrit **dans le fichier**, pas dans son rapport. C'est la bonne place : le
  rapport disparaît, le code reste.
- **Les mutations vertes déclarées** sont un signal de qualité, pas un aveu :
  trois voies ont signalé d'elles-mêmes une mutation restée verte plutôt que de
  la taire. Le skill pourrait le dire explicitement pour l'encourager.
- **Le répertoire courant d'un shell est un état invisible qui traverse les
  phases, et il a fait atterrir un document de cadrage sur une branche de story.**
  05/09 : le contexte principal écrit le design puis le plan de s30 dans le
  worktree de s30 — légitime, ce sont des documents de story. Le shell y reste.
  Deux tours plus tard, il écrit la **recherche de s31**, qui appartient à la
  branche par défaut depuis P17 : `git add && git commit` atterrissent sur
  `feature/s30-docs-site`, et le `git push origin dev` qui suit pousse un `dev`
  qui ne la contient pas. Le fichier n'existait donc **que** sur une branche de
  story. Détecté par l'implémenteur de s30, qui a **refusé de le supprimer par
  rebase** en constatant que la branche portait l'unique copie — le bon réflexe,
  et il vaut d'être cité. Deux remèdes, cumulables : préfixer les commandes git
  de `-C <chemin absolu>` dès qu'on travaille sur plusieurs arbres, et faire de
  « quelle branche est sortie ici ? » une vérification **avant** chaque écriture
  de document, pas seulement avant chaque phase de story. C'est le **troisième**
  manquement du contexte principal à « un agent, un répertoire de travail » sur
  cette séance ; les deux premiers n'avaient coûté que de la confusion, celui-ci
  a déplacé un document.
- **Le rapport de revue peut ne jamais être écrit, et rien ne le signale avant
  le ship.** En s29, le contexte principal a reçu le corps du rapport du premier
  tour et a enchaîné directement sur le correctif : `docs/reviews/s29-blog-mdx.md`
  n'existait ni dans le worktree, ni sur la branche par défaut, ni dans
  l'historique. Le second relecteur l'a découvert et a dû juger contre un résumé
  au lieu du texte — donc sans pouvoir vérifier les constats que ce résumé
  omettait. La porte de `/ks-ship` aurait fini par le refuser, mais **deux tours
  plus tard**. Piste : `/ks-review` écrit le fichier **avant** de rendre la main,
  ou `/ks-execute` en mode correctif refuse de démarrer si le rapport qu'il est
  censé corriger n'existe pas — c'est la même règle fail-closed que la porte,
  appliquée une étape plus tôt.
- **Un constat accepté à la porte n'a de domicile que si quelqu'un pense à lui
  en ouvrir un.** La porte est mécanique et ne bloque que sur `critical` ; ce
  qu'on laisse passer est écrit dans le rapport de revue, qui part avec la
  demande de fusion, et rien ne l'en ressort. Le dépôt sait pourtant le faire
  quand il y pense : `s46-auth-screens-design` est née d'un constat de la revue
  de s09, `s47-seat-limit` d'une recherche de s23. Mais c'est un geste, pas une
  étape — la revue de s28 a produit quatre mineurs dont deux n'avaient aucune
  story au moment de la fusion, et il a fallu les créer après coup (s48, s49).
  Piste : faire de l'ouverture d'une entrée dans `docs/stories.md` une sortie
  explicite de `/ks-review` pour tout constat non corrigé, plutôt qu'une bonne
  habitude.
- **Deux tours de correction d'affilée ont chacun produit un `major` né du tour
  précédent.** Corriger le nom du cookie a laissé la valeur ; corriger la valeur
  et le seuil a déplacé le premier refus vers un écran qui ne savait pas le
  dire. Ce n'est pas un signe de mauvaise correction — chaque tour a fermé son
  constat, prouvé par mutation — mais de constats **empilés sur un même axe**.
  Piste : quand une revue trouve « X et Y ne lisent pas la même chose », le
  correctif doit couvrir **tous** les axes de normalisation de la référence,
  pas celui que le constat cite ; et le tour de correction doit être borné
  d'avance, sinon le pipeline boucle poliment.
- **Une déclaration de stabilité a besoin d'un nombre de passages.** Un test
  rouge intermittent a été jugé « reporté et stable » sur **trois** passages
  complets ; sur **cinq**, il tire (1 rouge sur 5). Trois passages ne suffisent
  pas à déclarer stable une porte de CI. La règle du dépôt sur l'exhaustivité
  s'applique aussi aux mesures de stabilité : dire *sur combien de passages*.
- **Une dépendance peut écrire du balisage adressé à l'agent dans un flux que
  l'agent lit.** `stripe@22.6.1` (`stripe/cjs/stripe.core.js:138-146`) détecte
  `CLAUDECODE` dans l'environnement et écrit sur stderr
  `<claude-code-hint v="1" type="plugin" value="stripe@claude-plugins-official" />`,
  qui a traversé la sortie du serveur de dev jusque dans les journaux Playwright.
  Ce n'est pas hostile — c'est de la recommandation de plugin — mais la forme est
  celle d'une injection. L'implémenteur l'a traité comme du texte de terminal non
  fiable et n'a rien changé, ce qui est la bonne réponse. À noter comme classe :
  la sortie d'outil n'est pas de la donnée neutre du seul fait qu'elle vient
  d'un paquet installé.

- **La CI de la branche par défaut était rouge depuis au moins cinq commits, et
  le pipeline ne l'a jamais regardée.** Constaté le 04/09 : les cinq derniers
  runs de `dev` échouent, pour deux causes distinctes. La première est un vrai
  défaut — `tests/minimal-profile.test.ts`, critère 8, « aucun module activé
  n'est coupable pour éprouver la généricité » — qui ne rougit **que** sous la
  branche `socle` de la matrice, donc qu'aucune commande locale ne joue. La
  seconde est `pnpm run audit`, qui tombe en `ERR_SOCKET_TIMEOUT` vers
  `registry.npmjs.org` **sans aucune reprise** : un aléa réseau y devient un
  rouge de porte. Le pipeline vérifie qu'une story passe sa revue ; **rien, à
  aucune étape, ne regarde si la branche par défaut est verte**. Piste : `/ks-ship`
  lit l'état de la CI de la branche cible avant d'ouvrir la demande de fusion, et
  le dit — fusionner dans du rouge doit être une décision, pas un défaut.
- **L'étape qui devait capturer les traces d'échec n'a jamais rien capturé.**
  Trouvé en s50, en allant chercher la trace d'un parcours rouge : le job
  `Traces des parcours en échec` archive `playwright-report/`, alors que les
  traces de ce dépôt vivent dans `test-results/`. Le journal du job dit
  `No files were found with the provided path`, et l'étape est verte — un
  `upload-artifact` qui ne trouve rien ne rougit pas. Conséquence : depuis que la
  CI existe, **aucun échec de parcours n'a laissé de trace exploitable**, et
  chaque diagnostic a dû être refait en local. Même famille que le scan de
  secrets de s28 : un filet qu'on croit posé, qui ne rougit jamais parce qu'il ne
  s'exécute pas vraiment. Piste : une étape d'archivage dont le chemin est
  **dérivé** de la configuration Playwright, et qui échoue si elle ne trouve rien
  alors qu'un parcours a rougi.
- **Une note de recherche peut se tromper sur un compte, et le compte se propage.**
  La recherche de s50 écrivait « `signIn` a 10 appelants dans 5 fichiers » ; il y
  en a **17 dans 7 fichiers** — le balayage n'avait couvert que `e2e/*.spec.ts`,
  oubliant les supports et `golden-path`. Relevé par l'implémenteur, qui a
  recompté avant de modifier. C'est la règle « dire ce qui a été balayé, et sur
  combien de cas » appliquée à l'envers : la recherche avait annoncé un compte
  sans dire sur quel périmètre elle l'avait pris.
- **Un critère d'acceptation qui dépend de tout le dépôt ne peut pas être fermé
  par une story.** s48 portait « la CI de la branche par défaut est verte sur un
  run réel ». Elle a réparé ses deux causes — mesuré sur `dev` après fusion : la
  suite unitaire passe sous **les deux** configurations, 1965/13 sous socle, là
  où l'assertion du critère 8 rougissait depuis cinq commits. Et le critère reste
  **non tenu**, parce que deux parcours navigateur appartenant à d'autres stories
  (s19 et s13) rougissent par intermittence. Aucune quantité de travail dans s48
  ne pouvait le fermer. Piste : un critère de ce genre appartient à une story de
  **recette**, ou doit être formulé sur ce que la story contrôle — « les causes
  nommées ne rougissent plus », pas « tout est vert ». Sinon on livre une story
  dont la définition de terminé dépend du hasard d'un autre fichier.
- **Trois stories d'affilée butent sur la même absence du contrat de module.**
  Recherches menées le 04/09, sur des surfaces sans rapport entre elles : s29 a
  besoin qu'un module de contenu alimente `sitemap.xml`, s32 d'un point
  d'émission qui **survive à la coupure** du module qui le porte, s37 d'un refus
  à la connexion pour un compte banni par un module optionnel. Chaque fois, un
  module optionnel doit se greffer sur un chemin du **socle**, et les quatorze
  clés du contrat n'ont pas de fente pour ça. Chaque fois, la voie *(a)* est un
  import nommé de plus dans l'application — c'est ce que fait déjà
  `apps/web/app/sitemap.ts` avec `marketing` —, et la voie *(b)* est une clé de
  plus au contrat, dont `AGENTS.md` annonce le coût : « adding one later means
  reopening every module already written ». À trois occurrences, ce n'est plus
  une coïncidence : c'est un manque d'architecture, et le payer **une fois** vaut
  mieux que de le contourner trois fois. Piste : une story de cadrage qui tranche
  avant s29, plutôt qu'un ADR par story qui déciderait la même chose trois fois
  sans le savoir.
- **Une note de complexité posée sur une phrase de la story se paie plus tard.**
  s37 est notée 3 dans `docs/stories.md`, sur la foi de « le plugin `admin` de
  Better Auth fournit tout, le travail réel est l'interface ». La recherche l'a
  relevée à **5, découpe requise** : les plugins réellement configurés sont
  `magicLink`, `passkey` et `withTwoFactorOnEverySignIn`, et surtout **s15 n'a
  pas adopté le plugin `organization`** pour la feature la plus proche — le dépôt
  avait donc déjà tranché dans l'autre sens. Même famille que s48, dont la story
  affirmait une distinction que `scripts/audit.ts` tenait déjà. La note de
  complexité est écrite avant d'ouvrir un fichier ; c'est la recherche qui la
  vaut, et l'écart va dans les deux sens.
- **Un échec de parcours navigateur en CI n'est pas imputable tant qu'on n'a pas
  lu le journal.** Sur la demande de fusion 7, deux parcours ont échoué dans un
  run et zéro dans l'autre, **au même commit**. L'hypothèse évidente était le
  seuil que la story venait d'abaisser ; le journal dit `locator.fill: Test
  timeout of 30000ms exceeded` et `net::ERR_ABORTED`, et le message de refus que
  la story ajoute n'apparaît **nulle part**. La bonne réponse à un rouge
  plausible est de chercher sa signature dans le journal, pas de l'attribuer à la
  modification la plus récente.

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
| 04/09 | Une garantie de sécurité écrite en cinq endroits, tenue par zéro commande | seuil abaissé sous le plafond du tiers, plafond **dérivé** du paquet installé | P4 |
| 04/09 | La suite e2e se limitait elle-même dès le deuxième passage | préambule qui vide le compteur partagé, **prouvé par mutation** | P13 |
| 04/09 | Un 429 affiché « votre code est invalide » à un code correct | classe de refus `throttled` étendue aux écrans que le garde atteint | P14 |
| 04/09 | Un test intermittent déclaré stable sur trois passages, rouge sur cinq | déclarer une stabilité avec son nombre de passages | — |
| 04/09 | Scan de secrets jamais vert sur une demande de fusion, 403 avant de scanner | `pull-requests: read` sur le job, cause écrite sur place | P8 |
| 04/09 | CI de `dev` rouge depuis cinq commits, jamais regardée par le pipeline | lire l'état de la branche cible avant d'ouvrir la fusion | — |
| 04/09 | Cinq bases PostgreSQL, une seule utilisée ; deux créées pour des recherches en lecture seule | provisionner par phase, pas par story | P15 |
| 04/09 | 827 Mo de `node_modules` et ~36 k tokens par story, pour une phase en lecture seule | une voie de recherche unique et réutilisée | P16 |
| 04/09 | La contrainte de brancher avant de chercher vient d'`AGENTS.md`, pas du PRD | commiter la recherche sur la branche par défaut | P17 |
| 04/09 | La revue bloque 18 à 31 min par ronde, contexte principal inoccupé | chercher la story suivante pendant, worktree nu à 9 Mo | P18 |
| 05/09 | Une recherche conclut « le mode sombre passe partout » six lignes sous sa propre table qui donne 4,41 : 1 pour un seuil à 4,5 | recalcul indépendant au plan : le chiffre était faux (5,82), la conclusion juste ; l'écart est écrit dans le plan | P20 |

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
