---
validated: yes
---
# Plan — Story s50-tests-deterministes

Branch: `feature/s50-tests-deterministes`
Research: `docs/research/s50-tests-deterministes.md` — **à lire d'abord** : trois tests, deux mécanismes seulement, et un des trois cas n'a pas de cause établie.

## Target story

Rendre déterministes trois tests intermittents sans rendre un rouge plus rare. Les trois passent dix fois de suite avec le compte journalisé, aucune assertion perdue, et la cause retenue est écrite à l'endroit du test. C'est cette story qui referme le dernier critère d'acceptation de s48.

## Tasks (ordered)

1. [x] **Établir la cause de `two-factor.spec.ts:126` avant d'y toucher.** Récupérer la trace archivée par le job `Traces des parcours en échec` du run `33894919551` (configuration socle), l'ouvrir, et **écrire dans le plan** quel appel expire et ce qu'il attendait. Aucune modification de ce fichier avant cette ligne. Si la trace ne suffit pas, reproduire sous socle par `pnpm test:socle` plutôt que deviner.
2. [x] **Cas rouge d'abord — `signIn` sans signal d'achèvement.** Un cas qui échoue tant que `signIn` rend la main avant que la connexion ait abouti. Le signal doit valoir pour **les deux** atterrissages possibles : tableau de bord, et écran de second facteur quand le compte en a un. **Test qui peut échouer** : ce cas.
3. [x] **Donner à `signIn` son signal d'achèvement**, sur le motif que `signOut` documente déjà (`account.ts:113-125`) et avec le `clickOnce` de `support/interaction.ts` si c'est le bon outil. Ne pas ajouter de délai, ne pas ajouter de reprise. **Mutation attendue** : retirer l'attente doit rougir.
4. [x] **Vérifier les dix appelants.** `pnpm test:e2e` complet **et** `pnpm test:socle`, puisque cinq fichiers de parcours passent par `signIn` et qu'aucune tâche ne les nomme. Rapporter les comptes des deux.
5. [x] **Cas rouge — le rendu de la page de retour n'ouvre aucune session.** Remplacer le compte global par une observation du **module d'authentification déjà mocké** dans `renderReturn` : exiger **zéro** appel de création de session. La propriété visée est celle de s24 — « ni sur un identifiant forgé ni sur un authentique » — et elle doit rester au moins aussi mordante. **Test qui peut échouer** : un rendu qui ouvrirait une session.
6. [x] **Mutation de contrôle sur la garantie de s24.** Faire ouvrir une session dans le chemin de rendu et vérifier que le cas rougit. Une assertion qui ne rougit pas là est un test plus vert que son nom, et cette propriété est une garantie de sécurité, pas un confort.
7. [x] **Corriger `two-factor.spec.ts:126`** selon la cause établie à la tâche 1, avec la même discipline : un signal, pas un délai.
8. [x] **Dix passages consécutifs, comptés.** `pnpm test` ×10 et `pnpm test:e2e` ×10, comptes journalisés, y compris les rouges s'il y en a. Une stabilité se déclare avec son nombre de passages.
9. [x] **Écrire la cause à l'endroit du test**, pour les trois, avec la mesure qui l'établit — et `docs/killer-saas-feedback.md` **ne bouge pas** : il vit sur la branche par défaut.

## Tâche 1 — la cause de `two-factor.spec.ts:126`, mesurée (exécution)

**La trace du run `33894919551` n'existe pas.** Le job a bien exécuté l'étape
`Traces des parcours en échec`, et elle n'a rien téléversé :
`##[warning]No files were found with the provided path: playwright-report/. No artifacts will be uploaded.`
Les traces de ce dépôt vivent dans `test-results/`, pas dans
`playwright-report/` ; le seul artefact du run est `gitleaks-results.sarif`.
Corriger ce chemin est une modification de `.github/`, que la story interdit :
c'est noté ici, pas fait. La cause a donc été établie **par reproduction
locale**, comme la tâche l'autorise.

**Ce que le journal de CI donne déjà, et qui suffit à écarter « un locator qui
pend ».** Dans le **même** run, la configuration `tous` a fait **passer** ce cas
en `28,2 s`, et la configuration `socle` l'a fait **échouer** à `31,2 s`, budget
par défaut de 30 s. Le message n'y nomme aucun appel — « Test timeout of 30000ms
exceeded. » seul — parce qu'aucun appel Playwright n'était en vol quand
l'échéance est tombée. Sur la demande de fusion 7 il nommait `locator.fill`,
ailleurs `expect(page).toHaveURL` : ce n'est pas trois défauts, c'est **l'endroit
où l'échéance tombe**, qui change à chaque exécution.

**Reproduction locale** (base dédiée à ce worktree, `E2E_PORT=3142`, un
travailleur) :

| Lot | Runs | Résultat | Total | Gap mesuré dans la trace |
|---|---|---|---|---|
| A (`--repeat-each=6`) | 4 | rouge | 31,2–31,4 s | aucun (< 0,5 s) |
| A | 2 | vert | 12,7 s | non conservée (trace gardée à l'échec) |
| B (`--repeat-each=8 --trace=on`) | 7 | rouge | 31,4–36,5 s | **une pause de 5,58 à 9,53 s avant `L147`** |
| B | 1 | vert | 29,5 s | pause de **3,17 s** avant `L147` |

`L147` est la ligne qui suit `await withinStablePeriod()`. **La pause est du
sommeil pur** : `withinStablePeriod` dort `remaining + 100 ms` quand il reste
moins de 10 s à la période TOTP courante, soit **0 à 10,1 s, une fois sur
trois, et le parcours l'appelle deux fois** — jusqu'à 20,2 s ajoutés à un
parcours qui coûte déjà 20 à 28 s. Dans le lot B, le seul run vert est celui
dont la pause a été la plus courte.

**Et ce sommeil ne protège de rien.** La fenêtre de vérification TOTP vaut
**±1 période** — pas un choix ouvert : `totp/index.mjs` appelle `.verify(code)`
sans second argument et `@better-auth/utils@0.4.2` y met `window = 1`, ce que
`packages/modules/auth/src/infrastructure/better-auth-service.ts:601-604`
documente et que `tests/auth.test.ts` éprouve aux deux bords. Un code dérivé à
la fin d'une période reste donc accepté pendant toute la période suivante :
30 à 60 s de marge, contre les quelques secondes que coûtent la saisie, le clic
et l'aller-retour.

**Cause retenue** : ce n'est **pas** le mécanisme de la tâche 3 (signal
d'achèvement manquant) — c'est un **troisième mécanisme**, un budget de temps
consommé par une attente d'horloge inutile. Les tâches 3 et 7 sont donc
indépendantes, comme le prévoyait « Trois endroits où ça peut être faux », point 3.

## Note d'exécution (s50)

**Les trois causes, et elles font trois mécanismes, pas deux.** La recherche en
annonçait deux ; la tâche 1 en a établi un troisième. `signIn` = signal
d'achèvement absent (deux atterrissages) ; `tests/billing.test.ts` = compte
global sur une base partagée ; `two-factor.spec.ts` = budget de temps dépassé
par une attente d'horloge. Le correctif de `signIn` ne fait rien pour le
troisième, et réciproquement.

**Ce que `signIn` a coûté à vérifier : dix-sept appelants, pas dix.** La
recherche comptait « 10 appelants dans 5 fichiers » ; le balayage
(`grep -rn "signIn(" e2e`) en donne **17 dans 7 fichiers** — `app-shell` (4),
`auth` (3), `two-factor` (3), `golden-path` (3), `organizations` (2),
`billing` (1), `passkeys` (1) — plus **un** appel interne dans
`aSignedInAccount`, que d'autres parcours utilisent à leur tour, soit 18 sites
au total. Aucun n'attend un échec de connexion : aucun n'exige de
rester sur l'écran de connexion, et le signal choisi — « la page a quitté
l'écran de connexion » — les couvre tous.

**Mesures**

| Commande | Résultat |
|---|---|
| `pnpm test` ×10 | 10/10 vertes — `1970 passed \| 8 skipped (1978)`, identique aux dix |
| `pnpm test:e2e` ×10 | 9/10 vertes — `92 passed \| 8 skipped (100)`. Un rouge, exécution 1, sur `e2e/rate-limiting.spec.ts:38` |
| `pnpm test:socle` | verte, code 0 — vitest `1965 passed \| 13 skipped`, parcours `78 passed \| 22 skipped`, et `two-factor.spec.ts` en **7,6 s** |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | vertes |

Le parcours 2FA, mesuré sur ce poste, séquentiel : **12,7 à 31,4 s** avant
(4 rouges sur 6), **12,0 à 13,2 s** l'attente d'horloge retirée, **6,6 à 7,5 s**
les trois déconnexions de confort remplacées (5 sur 5 vertes). Le rapport
poste → runner mesuré sur `e2e/storage.spec.ts` (quatre cas comparés au journal
du run 33894919551) vaut **2,3 à 2,8** : les 10 s d'après-sommeil valaient encore
25 à 28 s sur le runner, c'est-à-dire toujours au bord des 30 s — c'est cette
mesure qui a décidé la seconde coupe.

**Deux intermittents rencontrés, nommés et non corrigés** (interdit de la
story), tous deux inconnus de la CI, qui exécute la suite avec **un** travailleur
là où le poste en utilise quatre :

- `e2e/rate-limiting.spec.ts:38` — 1 rouge sur 11 suites complètes ; 24 passages
  verts en isolation (`--repeat-each=4`) ;
- `e2e/oauth.spec.ts:97` — 1 rouge sur 11 suites complètes (`oauth=failed` au
  retour du fournisseur) ; 5 passages verts en isolation.

**Ce que la story n'a pas pu faire.** L'étape `Traces des parcours en échec` de
`.github/workflows/ci.yml` téléverse `playwright-report/`, dossier qui n'existe
pas : les traces vivent dans `test-results/`. Aucune trace n'a donc jamais été
archivée, et la tâche 1 a dû reproduire localement. Corriger ce chemin est une
modification de `.github/`, que la story interdit — à reprendre ailleurs.

## Run interdicts

- **Aucune reprise, aucun `test.slow()`, aucun délai élargi, aucun `test.setTimeout`.** Ils rendraient le rouge plus rare sans le rendre juste — le mode d'échec que P8 documente. Le diff ne doit contenir aucun de ces mots.
- **Aucun `test.skip` / `skipIf` ajouté**, et le nombre de cas exécutés ne baisse dans aucune des deux configurations.
- **Ne pas affaiblir la garantie de s24.** La propriété « la page de retour n'ouvre aucune session, ni sur un identifiant forgé ni sur un authentique » doit rester mordante — la tâche 6 est là pour le prouver, et sa mutation doit rougir.
- **Ne pas toucher `.github/workflows/ci.yml`.** La duplication des runs de PR est peut-être un facteur ; c'est une décision d'infrastructure, pas cette story. Diff de `.github/` **vide**.
- **Ne pas deviner la cause du cas 2FA.** La tâche 1 est bloquante : aucune modification de `e2e/two-factor.spec.ts` avant qu'une cause soit écrite.
- **Ne pas élargir à d'autres tests intermittents** rencontrés en chemin : les nommer dans la note d'exécution, ne pas les corriger.

## The point everything turns on

**Remplacer deux mauvaises mesures, pas deux mesures fragiles.** Le compte global de `auth_session` ne peut pas dire *à qui* appartient une session, et le cas porte sur un invité qui n'a pas de compte : il mesurait la mauvaise chose depuis le début, et le parallélisme n'a fait que le révéler. `signIn` ne mesure rien du tout : il clique et espère.

Trois endroits où ça peut être faux :

1. **L'observation du module mocké pourrait ne rien observer** si la création de session ne passe pas par lui. À comparer : la mutation de la tâche 6 doit rougir ; si elle reste verte, c'est que le chemin observé n'est pas le chemin réel, et il faut trouver le vrai avant d'aller plus loin.
2. **Le signal de `signIn` pourrait être trop précis** et casser le parcours 2FA, qui atterrit ailleurs. À comparer : les dix appelants, dans les deux configurations, pas seulement `billing.spec.ts`.
3. **La cause du cas 2FA pourrait être un troisième mécanisme**, pas le signal de `signIn`. C'est pourquoi la tâche 1 précède tout : si la trace montre autre chose, les tâches 7 et 3 sont indépendantes et il faut le dire plutôt que de forcer une explication unique.

## Files touched

`e2e/support/account.ts` (le signal de `signIn`), `tests/billing.test.ts` (l'observation du rendu), `e2e/two-factor.spec.ts` (selon la tâche 1), éventuellement `e2e/support/interaction.ts`, plus la recherche et le plan portés par le commit de la story.

## Test strategy

Deux invariants, chacun à sa couche. **« Le rendu de la page de retour n'ouvre aucune session »** : cas unitaire, sur le module mocké, sans base — c'est ce qui le rend insensible au parallélisme. **« La connexion est achevée avant que le parcours continue »** : dans le support de parcours, éprouvé par les dix appelants réels plutôt que par un cas synthétique.

Aucune vérification navigateur au sens « écran » : la story ne change aucun rendu.

## Definition of Done

- Les neuf tâches cochées, la cause des trois cas **écrite** avec sa mesure.
- `pnpm test` ×10 et `pnpm test:e2e` ×10, comptes journalisés, rouges compris.
- `pnpm test:socle` verte, `pnpm typecheck`, `pnpm lint`, `pnpm build` verts.
- Diff de `.github/` vide ; aucun mot de reprise ou de délai dans le diff.
- Un commit unique, message impératif en français, portant la recherche et le plan.
- Après la fusion : **le run de CI de la branche par défaut est vert, lu par événement** — le critère que s48 n'a pas pu fermer.
