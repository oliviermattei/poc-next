# Research — Story s50-tests-deterministes

> Vérifiée contre `dev` au commit `b4baf4e`, en lecture seule. Worktree **nu** (9,3 Mo, sans dépendances), aucun conteneur.

## Les cinq faits structurants

1. **Trois tests, mais seulement deux mécanismes.** Le cas unitaire est un **compte global** ; les deux parcours navigateur sont un **signal d'achèvement manquant**. Les traiter comme trois défauts ferait écrire trois correctifs là où il en faut deux.
2. **`tests/billing.test.ts` compte toutes les sessions du dépôt.** `renderReturn` (`:5560-5563`) fait `const before = await countRows('auth_session')`, rend la page, puis exige un delta nul. Vitest exécute les fichiers **en parallèle** sur une base partagée : n'importe quel autre fichier qui ouvre une session fait rougir celui-ci. Mesuré : **3 rouges sur 23 exécutions complètes**, ~13 %.
3. **Et ce cas ne peut pas être « scopé » par compte** : il porte sur un **paiement invité**, donc il n'existe aucun compte auquel rattacher les sessions. Un compte de lignes ne peut pas dire *à qui* appartient une session — c'est la mauvaise mesure pour la propriété visée, pas seulement une mesure fragile.
4. **`signIn` n'attend rien.** `e2e/support/account.ts:103-110` remplit deux champs et clique, puis rend la main. Dans `e2e/billing.spec.ts:434-436`, le `page.goto` suivant part donc pendant que la redirection de connexion est en vol → `net::ERR_ABORTED`, exactement l'échec observé sur les demandes de fusion 7 et 8 **et** sur le run `33894919551` de `dev`.
5. **Le dépôt connaît déjà le remède, à trois lignes de là.** Le docstring de `signOut` (`account.ts:113-125`) écrit que « le signal d'achèvement est la navigation que `window.location.assign` provoque », et le fichier porte un `clickOnce` conçu pour ça (`support/interaction.ts`). `signIn` ne l'applique pas. **10 appelants dans 5 fichiers** (`app-shell`, `auth`, `billing`, `passkeys`, `two-factor`) : corriger `signIn` corrige une classe, pas un cas.

## Target story

Rendre déterministes trois tests intermittents, sans rendre un rouge plus rare : `tests/billing.test.ts:5627` (delta global sur `auth_session`), `e2e/billing.spec.ts:406` (`net::ERR_ABORTED` après `signIn`), `e2e/two-factor.spec.ts:126` (délai de 30 s dépassé, observé sous socle).

Les trois passent dix fois de suite avec le compte journalisé, aucune assertion perdue, et la cause retenue est écrite à l'endroit du test.

Dépendances : `s19-subscribe-stripe`, `s13-two-factor` — les deux fusionnées.

## État actuel du code

- `tests/billing.test.ts:5560` — `renderReturn` mocke déjà `../apps/web/lib/auth` (`currentViewer`), `../apps/web/lib/billing` et `../apps/web/lib/i18n` avant de rendre. **Le point d'observation existe donc déjà** : la propriété « le rendu n'ouvre aucune session » est observable au niveau du module mocké, sans toucher la base.
- `e2e/support/account.ts:103` — `signIn`, trois gestes, aucun `await` de navigation ni d'état.
- `e2e/support/interaction.ts` — `clickOnce`, qui porte la notion de signal d'achèvement que `signOut` utilise.
- `e2e/two-factor.spec.ts:126` — le parcours enchaîne activation (`/account`, `#two-factor-enable-password`, QR, `Code à six chiffres`, dix codes de secours), puis connexion par code, puis par code de secours.

## Pièges & contraintes

- **La sortie facile est interdite par la story et par P8** : une reprise Playwright, un `test.slow()` ou un délai élargi rendraient le rouge plus rare **sans le rendre juste**. C'est le mode d'échec que ce dépôt a déjà documenté.
- **Ne pas affaiblir l'assertion du cas invité.** La propriété — « la page de retour n'ouvre aucune session, ni sur un identifiant forgé ni sur un authentique » — est une **garantie de sécurité** de s24. Un correctif qui la rendrait moins mordante serait pire que l'intermittence. La mutation de contrôle doit rester : ouvrir une session dans ce chemin **doit** rougir.
- **`signIn` a 10 appelants** : le modifier touche cinq fichiers de parcours qu'aucune tâche ne nomme. Un passage complet de `pnpm test:e2e` **et** de `pnpm test:socle` est le seul filet.
- **Ne pas conclure sur `two-factor.spec.ts:126` sans la trace.** L'erreur de la demande de fusion 7 était `locator.fill: Test timeout of 30000ms exceeded` ; celle du run de `dev` dit seulement « Test timeout ». Le champ concerné n'est **pas** établi, et deviner entre `#two-factor-enable-password` et `Code à six chiffres` produirait un correctif qui ne mord pas. La trace est archivée en artefact du job (`Traces des parcours en échec`).
- **Le compte ne se déclare pas à l'impression.** Trois relectures indépendantes ont donné 2/9, 1/7 et 0/7 sur le cas unitaire : c'est la somme qui vaut, pas la dernière observation.

## Questions ouvertes

- **Sur quoi porte l'assertion du cas invité, une fois le compte global abandonné ?** Trois pistes, à trancher au plan : observer le module d'authentification déjà mocké et exiger zéro appel de création de session ; observer la réponse rendue et exiger l'absence d'un cookie de session ; ou capturer l'ensemble des identifiants de session avant et après et exiger que l'écart soit vide **pour ce rendu** — cette dernière reste sensible au parallélisme.
- **Quel est le champ qui expire dans `two-factor.spec.ts:126` ?** Non établi. Première tâche du plan : lire la trace, pas supposer.
- **`signIn` doit-il attendre une navigation ou un état ?** Une navigation est le signal que `signOut` utilise ; mais la connexion peut aboutir sur l'écran de second facteur au lieu du tableau de bord, selon la configuration du compte. Un signal trop précis casserait `two-factor.spec.ts`, un signal trop lâche ne corrigerait rien.
- **La duplication des runs de CI est-elle une cause ou une coïncidence ?** Une demande de fusion déclenche **deux** runs complets simultanés (`push` et `pull_request`), `dev` un seul. Les deux parcours ont rougi dans les deux conditions, donc la charge n'explique pas tout — mais elle n'a pas été écartée par la mesure. Ne pas la traiter dans cette story : si elle se confirme, la réduire est une décision d'infrastructure qui vaut pour elle-même (elle double le coût de chaque demande de fusion).

## Complexité réelle

Notée **2** dans `docs/stories.md`. **Ma note : 3.**

Le correctif unitaire est petit mais touche une garantie de sécurité de s24. Le correctif de `signIn` touche 10 appelants dans 5 fichiers, et son signal d'achèvement doit satisfaire à la fois le parcours qui atterrit sur un tableau de bord et celui qui atterrit sur l'écran de second facteur. Et un des trois cas n'a pas encore de cause établie.

Pas de proposition de découpe : les trois cas partagent un seul critère de fin — la CI de la branche par défaut redevient verte — et c'est ce critère que s48 n'a pas pu fermer.
