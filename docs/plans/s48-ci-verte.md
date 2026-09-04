---
validated: yes
---
# Plan — Story s48-ci-verte

Branch: `feature/s48-ci-verte`
Research: `docs/research/s48-ci-verte.md` — **à lire d'abord** : le prédicat du critère 8 n'a qu'un seul candidat dans tout le dépôt, et la prémisse de la story sur l'audit est à moitié fausse.

## Target story

Rendre la CI verte sur la branche par défaut, sans retirer ni désarmer aucun contrôle.

- [x] `pnpm test` passe sous les deux configurations de la matrice, la configuration socle étant jouable par une commande locale documentée
- [x] L'assertion de généricité du critère 8 tient, ou déclare **pourquoi** elle ne peut pas tenir — et la déclaration est elle-même vérifiée : un saut silencieux est refusé
- [x] `pnpm run audit` distingue une panne de registre d'un avis (**déjà tenu**, `scripts/audit.ts:41-46`) et **reprend** sur la panne, ce qui manque aujourd'hui
- [ ] La CI de la branche par défaut est verte sur un run réel, l'état lu **par événement**
- [x] Aucun contrôle retiré, désactivé ni rendu non bloquant

## Tasks (ordered)

1. [x] **Cas rouge d'abord — l'invariant d'annuaire.** Ajouter à `tests/minimal-profile.test.ts` un cas qui affirme que **l'annuaire contient au moins un module qui serait candidat s'il était activé** : les quatre critères hors `actif` (hors socle, hors `minimalProfile.cut`, requis par personne, et déclarant ≥1 route **et** ≥1 entrée de navigation **et** ≥1 table). Cet invariant ne dépend pas de la configuration : il vaut sous « tous » comme sous « socle ». Il doit rougir si on retire l'entrée de navigation du seul module qui le satisfait. **Test qui peut échouer** : ce cas.
2. [x] **Rendre le critère 8 explicite plutôt que suspendu.** Remplacer `extra` (singulier, `toBeDefined()`) par `candidates` (pluriel) et deux branches : au moins un candidat → la vérification de généricité d'aujourd'hui, inchangée ; aucun candidat → un cas qui affirme que **chaque module de l'annuaire échoue sur au moins un critère nommé**, et que le décompte des modules expliqués **égale** la taille de l'annuaire. Aucun `it.skip`, aucun `it.skipIf`, aucune condition qui rende un cas silencieux. **Test qui peut échouer** : les deux branches, jouées l'une et l'autre.
3. [x] **ADR 052** — « une recette dont la précondition dépend de la configuration dérive son absence au lieu de la sauter ». Options rejetées à écrire : le saut conditionnel, le nom du module en dur, le relâchement du prédicat. Portée : story s48.
4. [x] **Commande socle locale.** Ajouter un script qui rejoue la configuration socle **dans une copie** du dépôt, sur le motif déjà éprouvé de `scripts/minimal-profile.ts`, puis y lance `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. La liste des modules coupés est **dérivée de `.github/workflows/ci.yml`**, jamais recopiée : la commande et la CI ne peuvent pas diverger. Déclarer le script dans `package.json`. **Test qui peut échouer** : un cas qui vérifie que la liste dérivée est non vide et correspond à ce que le fichier de workflow déclare — il rougit si la CI change ses toggles sans que la commande suive.
5. [x] **Cas rouge — la reprise de l'audit.** Un cas qui fait échouer la lecture du registre deux fois puis réussir, et exige **une seule** issue verte ; un second qui épuise les tentatives et exige un échec **nommant le nombre d'essais**. Le double remplace le **réseau**, jamais le SDK. **Test qui peut échouer** : ces deux cas.
6. [x] **La reprise ne s'applique qu'à la panne.** Implémenter la reprise dans `scripts/audit.ts` sur la seule branche « n'a pas pu auditer », avec attente exponentielle, gigue et plafond (`docs/reliability.md` §3). **Test qui peut échouer** : un cas qui rend un document d'avis valide et exige **zéro** nouvelle tentative — reprendre sur un avis serait le transformer en vert par patience.
7. [x] **Documentation à côté du code.** Le tableau des commandes d'`AGENTS.md` gagne la commande socle (ce qu'elle vérifie, ce qui la fait échouer) ; la ligne `pnpm run audit` dit qu'elle reprend sur la panne et jamais sur un avis. `docs/reliability.md` reçoit la reprise si elle n'y est pas déjà couverte. **Vérification** : le test d'`AGENTS.md` existant, plus `pnpm lint`.
8. [x] **Passage complet.** `pnpm typecheck`, `pnpm lint`, `pnpm test` (**cinq passages** — la suite porte un intermittent connu), `pnpm build`, la nouvelle commande socle, `pnpm test:minimal-profile`, `pnpm run audit`. Rapporter les comptes, et ce qui n'a pas pu être joué.

## Run interdicts

- **Ne pas rendre un contrôle non bloquant, ne pas retirer un job, ne pas ajouter `continue-on-error`.** Le diff de `.github/workflows/ci.yml` doit rester **vide** : cette story répare ce que la CI mesure, pas la CI.
- **Aucun `it.skip`, `it.skipIf`, `describe.skip` ni `return` anticipé** dans `tests/minimal-profile.test.ts`. Le nombre de cas exécutés ne doit pas baisser.
- **Ne nommer aucun module** dans `tests/minimal-profile.test.ts` ni dans le script socle : tout se dérive de l'annuaire et du fichier de workflow. Un identifiant de module écrit en dur est le défaut que le critère 8 existe pour attraper.
- **Ne pas toucher `config/features.ts` ni `config/profiles.ts`.** La configuration livrée n'est pas le sujet, et la faire bouger rendrait le test vert sans rien réparer.
- **Ne pas ajouter d'entrée de navigation à un module** pour créer un second candidat : ce serait écrire le produit pour la mesure. Si le dépôt doit en gagner une, c'est une décision de produit, à signaler, pas à prendre ici.
- **Ne pas toucher `tests/billing.test.ts`.** Son assertion `:5627` est intermittente (1 rouge sur 15 passages, constat m4 de s28) et appartient à la suite de s19. Elle rougira peut-être pendant cette story : ne pas se l'attribuer, ne pas la corriger.
- **Ne pas laisser l'arbre modifié.** La commande socle travaille dans une copie ; `git status --porcelain` doit être vide après elle, y compris après une interruption.
- **Ne pas supprimer de conteneur ni de volume Docker** : les résidus des stories fusionnées sont hors périmètre.

## The point everything turns on

**Remplacer une précondition non tenue par un invariant qui, lui, tient partout.** Le critère 8 veut prouver que le harnais absorbe un module coupé de plus sans qu'une ligne change ; sous la configuration socle il n'a aucun module sur quoi le prouver. Le plan ne supprime pas la preuve, il ajoute la propriété qui la rend possible : *l'annuaire contient toujours au moins un module qui serait candidat s'il était activé*. Sous « tous », la preuve tourne ; sous « socle », c'est la capacité qui est affirmée.

Trois endroits où ça peut être faux, et à quoi les comparer :

1. **L'invariant pourrait être tautologique.** À comparer au tableau de la recherche : il ne doit être satisfait que par les modules qui ont réellement route + nav + table. Retirer l'entrée de navigation du seul module qui le satisfait doit rougir — c'est la mutation qui décide.
2. **Les deux branches pourraient être vertes ensemble alors que la propriété est cassée.** À comparer en jouant les deux configurations : la branche « aucun candidat » ne doit jamais s'exécuter sous « tous », et la branche « au moins un candidat » jamais sous « socle ». Un cas qui affirme quelle branche a tourné vaut mieux qu'une intuition.
3. **La dérivation depuis le fichier de workflow pourrait rendre une liste vide** et faire passer la commande socle sans rien couper — le « balayage vide » que `test:minimal-profile` refuse déjà par ailleurs. Le cas de la tâche 4 doit exiger une liste non vide.

## Files touched

- `tests/minimal-profile.test.ts` — le prédicat, les deux branches, l'invariant d'annuaire.
- `scripts/audit.ts` — la reprise, sur la seule branche de panne.
- un nouveau script pour la configuration socle, plus sa déclaration dans `package.json`.
- `tests/` — les cas de la reprise d'audit et de la dérivation des toggles.
- `docs/decisions/052-*.md` — l'ADR.
- `AGENTS.md`, `docs/reliability.md` — la documentation qui voyage avec le code.
- `docs/research/s48-ci-verte.md`, `docs/plans/s48-ci-verte.md` — portés par le commit de la story.

## Test strategy

Trois invariants, chacun à la couche la plus proche :

- **L'annuaire est capable** — cas unitaire sur le contrat des modules, sans base, sans serveur. C'est le seul endroit où cette propriété vit.
- **Le critère 8 explique son absence** — même fichier, deux branches, chacune jouée sous sa configuration. La branche « aucun candidat » se vérifie en local en jouant la commande socle de la tâche 4.
- **L'audit reprend sur la panne et jamais sur un avis** — cas unitaires avec un double qui remplace le **réseau**. Trois cas : panne transitoire résolue, panne persistante nommée, avis valide sans nouvelle tentative.

Aucune vérification navigateur : la story ne touche aucun écran, aucun `.tsx`. La preuve finale est un run de CI réel, lu par événement.

## Definition of Done

- Les huit tâches cochées, chacune avec la mutation posée **à l'endroit du défaut** et son compte de rouges.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` verts ; `pnpm test` vert sur cinq passages, avec le compte des intermittents observés et leur nom.
- La commande socle verte, et `git status --porcelain` vide après elle.
- `pnpm run audit` vert, et ses trois cas de reprise verts.
- Diff de `.github/workflows/ci.yml` **vide**.
- Un commit unique, message impératif en français, portant la recherche et le plan.
- Après la fusion : un run de CI vert sur la branche par défaut, vérifié **par événement** (`push` et `pull_request`), pas au rollup — c'est le seul critère d'acceptation qui ne peut se constater qu'après le ship.

## Correctifs de revue (après `docs/reviews/s48-ci-verte.md`, `Max severity: major`)

Ajoutés **après** les huit tâches, sur demande de la revue. Ils ne remplacent
aucune tâche du plan.

- [x] **Le major — la commande promettait « les commandes du job » et en rejouait
  six sur les treize que le job déclare.** Les étapes `run:` du job gardé sont
  désormais **dérivées de `.github/workflows/ci.yml`**, comme les bascules
  l'étaient déjà, et chacune est **soit rejouée, soit exclue avec sa raison
  écrite** (`SOCLE_STEP_DISPOSITION`). Une étape que la répartition ne classe pas
  fait échouer la commande en la nommant : le job qui gagne une étape force une
  décision. La commande **journalise ses exclusions et leur raison**, à côté de
  ses durées. Décision prise et écrite : `pnpm test:e2e` est **rejouée** (elle
  ajoute ~1 min 20 s à une commande qui en prend ~3 min 15 s, mesuré) ; trois
  étapes sont exclues — l'installation et les bascules, que l'amorçage joue déjà,
  et l'installation du navigateur, qui provisionne un runner en root.
- [x] **Ce que ce correctif a trouvé** : `e2e/rate-limiting.spec.ts:106` échouait
  sous la configuration socle — le POST « du geste de l'attaquant » vise un
  formulaire public que le module coupé ne sert plus, donc 404. L'attendu est
  maintenant **dérivé de la configuration** (`marketingSite.sections`), le cas
  reste exécuté dans les deux, et la propriété finale est asserée dans les deux.
  C'est la première fois que la moitié socle de `pnpm test:e2e` tourne hors d'un
  runner.
- [x] **Minor — délai d'attente de l'audit** : `spawnSync` porte
  `AUDIT_TIMEOUT_MS` (60 s, contre ~1,4 s pour un audit nominal mesuré ici), et
  une valeur illisible est refusée en nommant la variable plutôt que lue comme
  « aucun délai ».
- [x] **Minor — `docs/architecture.md`** connaît la troisième recette de la
  famille (`pnpm test:socle`), à côté du parcours doré et du profil minimal.
- [x] **Minor — `docs/reliability.md`** : « trois tentatives au plus, donc deux
  rejeux », au lieu de « rejoue trois fois ».
