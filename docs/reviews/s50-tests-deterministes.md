# Review — Story s50-tests-deterministes

> Fresh-context review. Each issue classified: critical / major / minor.
> Diff reviewed: `git diff dev...feature/s50-tests-deterministes` — HEAD `a13b571`, branche `feature/s50-tests-deterministes`, worktree `/Users/olivier/www/boilerplate/.worktrees/s50-tests-deterministes`, PostgreSQL sur 5442.
> 6 fichiers, +379 / −30 : `docs/plans/`, `docs/research/`, `e2e/auth.spec.ts`, `e2e/support/account.ts`, `e2e/two-factor.spec.ts`, `tests/billing.test.ts`. **Aucun `.tsx`, aucun fichier de `packages/`, `apps/` ou `config/` — vérifié par `--name-only`, pas supposé.** `docs/design-system.md` n'est pas engagé, aucune preuve navigateur n'est due.
> Diff de `.github/` : **vide**, confirmé par `git diff dev...feature/s50 --stat -- .github` (sortie vide).

## Ce que j'ai exécuté (et non ce qui est rapporté)

| Commande | Résultat mesuré ici |
|---|---|
| `pnpm test` ×4 | **3 vertes** à `1970 passed \| 8 skipped (1978)` ; **1 rouge** sur `tests/audit-exceptions.test.ts` — cas s48, hors diff (voir Constat 4) |
| `pnpm test:e2e` ×4 | **4/4 vertes**, `92 passed \| 8 skipped (100)` |
| `pnpm test:socle` | **exit 0** — vitest `1965 passed \| 13 skipped (1978)`, parcours `78 passed \| 22 skipped (100)`, `two-factor.spec.ts` en **7,8 s**, arbre inchangé |
| `pnpm test:minimal-profile` | **exit 0**, 4 parcours, profil coupant `billing, i18n, organizations, demo-disabled` |
| `pnpm test:golden-path` (`GOLDEN_PATH_PAYMENTS=simulated`) | **exit 0**, 4 cas — les 3 appelants de `signIn` que ni `test:e2e` ni `test:socle` ne touchent |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | exit 0, exit 0, exit 0 |
| `pnpm test:e2e --workers=1` sur `storage` + `two-factor` | 6 verts, `two-factor` en **7,0 s** séquentiel |

Total de cas **identique dans les deux configurations** : 1978 vitest, 100 parcours collectés. Le journal du run CI `33894919551` en collecte 100 lui aussi (`tous` : 91+1 ; `socle` : 77+1). **Aucune baisse.**

## Plan compliance

- [x] **Le code fait ce que le plan spécifie, rien de plus.** Les neuf tâches sont faites et cochées ; les trois mécanismes annoncés sont chacun traité à leur endroit. Rien dans le diff que le plan n'ait demandé — les deux écarts déclarés (deuxième sonde, `anonymousAgain`) sont écrits dans la note d'exécution avec leur mesure.
- [x] **Interdits de la story, chacun vérifié nommément** :
  - *Aucune reprise / `test.slow` / `setTimeout` / délai élargi / `test.skip` ajouté* : `grep '^+' | grep -Ei 'retr|slow|setTimeout|timeout|skip'` sur le diff de code rend **une seule ligne**, le texte cité « Test timeout » dans le commentaire de `two-factor.spec.ts`. Conforme.
  - *`.github/` vide* : confirmé.
  - *Nombre de cas exécutés stable* : confirmé dans les deux configurations, contre le journal de CI.
  - *Garantie de s24 non affaiblie* : voir Tests — les deux sondes rougissent, mais la propriété est **rétrécie** (Constat 2).
  - *Ne pas deviner la cause 2FA* : la tâche 1 est écrite avant toute modification du fichier, avec sa table de mesures, et la trace CI a effectivement été cherchée avant d'être déclarée absente.
  - *Ne pas élargir aux autres intermittents* : `rate-limiting.spec.ts:38` et `oauth.spec.ts:97` sont nommés, non corrigés. Correct — mais la liste n'est pas complète (Constat 4).
  - *`docs/killer-saas-feedback.md` immobile* : absent du diff.

## Anti-hallucination

- [x] **Aucune API inventée.** Chaque référence ouverte :
  - `publicPath` — exporté par `e2e/support/locale.ts`, `(pathname: string) => string`. ✔
  - `clickOnce(page, control, settled)` — `e2e/support/interaction.ts`, signature exacte. ✔
  - `appAuth` — `apps/web/lib/auth.ts`, `appAuth(options: AppAuthOptions = {}): AuthService`. La doublure `appAuth: () => {…}` correspond à la forme d'appel réelle (`appAuth()` sans argument partout). ✔
  - `next/headers` — la doublure expose `cookies` et `headers`, les deux seuls points d'entrée que le chemin de rendu peut atteindre ; `pnpm test` reste vert, donc rien d'autre n'est demandé au module mocké. ✔
- [x] **Aucune valeur plausible-mais-fausse.** J'ai refait la vérification de la fenêtre TOTP, qui est la seule façon dont ce correctif pouvait échanger un test instable contre un produit instable :
  - `better-auth@1.7.2` résout `@better-auth/utils@**0.4.2**` (lu dans son `node_modules`, pas déduit du lockfile) ; `dist/otp.mjs` : `verifyTOTP(otp, { window = 1, … })` puis `for (let i = -window; i <= window; i++)`. ✔
  - `better-auth/dist/plugins/two-factor/totp/index.mjs:194` — **un seul** `.verify(ctx.body.code)`, sans second argument. La fenêtre est donc bien ±1 période, pas un choix ouvert. ✔
  - `tests/auth.test.ts` — « accepte les trois compteurs de la fenêtre, et refuse les deux qui l'encadrent » : `-1/0/+1` acceptés (200 + session ouverte), `-2/+2` refusés (401, `{error:'invalid'}`, aucune session). **Les deux bords sont éprouvés**, exactement comme la note l'affirme. ✔
  - `packages/modules/auth/src/domain/two-factor.ts` — `totpStepsToTry` rend `[c−2, c−1, c, c+1]`, donc la garde de rejeu rattache encore un code dérivé **juste avant** une frontière de période. Retirer le sommeil **ne peut pas** faire échouer une vérification légitime : la dérivation et la soumission sont désormais séparées par ~1 s là où la marge est de 30 à 60 s. Et le cas le plus tendu du fichier — le rejeu de `signInCode` en fin de parcours, qui doit rester **dans** la fenêtre pour que « a déjà servi » soit atteignable — passe d'un écart d'environ 20 s à environ 4 s : le correctif le rend **plus** sûr, pas moins.
- [x] **Le code fait ce qu'il dit.** Deux points que j'ai voulu voir plutôt que croire :
  - Le signal `not.toHaveURL(SIGN_IN_SCREEN)` pourrait rendre la main sur une **URL intermédiaire**, ce qui rendrait l'instantané `page.url()` nouvellement instable. Il n'y en a pas : `apps/web/app/sign-in/page.tsx` calcule `destination = path(safeRedirectPath(next, '/'))` — **déjà préfixée de la locale** — et `apps/web/app/auth-form.tsx:148` fait un unique `window.location.assign(destination)`. Une seule navigation, une seule URL validée. Le choix de l'instantané est donc correct, pas seulement chanceux.
  - `signIn` appelle désormais `whenHydrated`, qui attend `next-route-announcer` et **n'apparaît jamais sans JavaScript**. J'ai balayé les cinq sites `javaScriptEnabled: false` (`organizations:519`, `consent:189`, `public-forms:222`, `oauth:35`, `app-shell:271`) : **aucun** n'appelle le geste. Pas de pendaison possible.

**Le recomptage des appelants, refait à la main.** `grep -rn "signIn(" e2e` moins `signInRedirectedFrom` : **18 lignes**, dont **17 hors** `e2e/support/account.ts`, réparties sur **7 fichiers** — `app-shell` 4, `auth` 3, `two-factor` 3, `golden-path` 3, `organizations` 2, `billing` 1, `passkeys` 1 — plus **1** appel interne dans `aSignedInAccount`. **La correction de l'implémenteur est la bonne ; le « 10 appelants dans 5 fichiers » de la recherche est faux.** Et le point qui décide de la justesse du signal : **aucun appelant n'attend un échec de connexion**. Les trois refus de `e2e/auth.spec.ts` (compte inconnu, mot de passe faux, adresse non vérifiée) **réécrivent les trois gestes en ligne** au lieu d'appeler le geste partagé — donc « la page a quitté l'écran de connexion » n'a jamais à être faux.

## Rules compliance

- [x] **AGENTS.md.** Un seul commit, message impératif en français, portant la recherche et le plan. Deux emplacements de test respectés (`tests/`, `e2e/`). Aucun `process.env` ajouté, aucune frontière de couche traversée (`pnpm lint` vert). Aucune commande de nettoyage introduite.
- [x] **Aucun ADR contredit.** Rien de structurel n'est décidé ici ; ADR 048 (régime d'enregistrement), 050/051 (limitation de débit, seau de défi 2FA) ne sont pas touchés — `e2e/rate-limiting.spec.ts` n'est pas modifié. La discipline « aucune reprise » de `playwright.config.ts` (`retries: 0`) est **renforcée**, pas contournée.
- [x] **Socle de sécurité.** La propriété visée (« la page de retour n'ouvre aucune session, ni sur un identifiant forgé ni sur un authentique ») reste **mordante** — prouvé par deux mutations ci-dessous. Elle est en revanche **observée autrement**, et le périmètre observé est plus étroit : voir Constat 2.
- [x] **Socle de fiabilité.** Aucun appel sortant, aucune migration, aucun webhook touché.
- [ ] **« Une règle doit être exécutable »** — l'écart résiduel déclaré dans `tests/billing.test.ts` n'est adossé à aucune commande (Constat 2), et le diff écrit une affirmation d'exhaustivité fausse (Constat 1).

## Tests

- [x] **Suite exécutée par le relecteur** — voir le tableau d'ouverture. Trois configurations jouées (`tous`, `socle`, profil minimal), plus le parcours doré.
- [x] **Les assertions épinglent les critères d'acceptation.** Rien de décoratif dans ce diff : aucune assertion sur une classe CSS, une structure DOM, un libellé statique ou un inventaire. Les deux assertions ajoutées sont des instantanés d'URL non réessayés, et l'observation unitaire remplace un compte de lignes par deux sondes nommées.
- [x] **Morsure prouvée par neutralisation.** Quatre mutations, **toutes posées au site du défaut**, pas dans un module voisin :

| # | Mutation | Où | Rouges |
|---|---|---|---|
| A | `if (paid) { appAuth() }` — la page de retour atteint le point de composition | `apps/web/app/pricing/page.tsx:92` | **1** — `tests/billing.test.ts`, « n'ouvre aucune session, ni sur un identifiant forgé ni sur un authentique » |
| B | `if (paid) { (await cookies()).set('app.session_token', …) }` | `apps/web/app/pricing/page.tsx:92` | **1** — même cas, sur la sonde elle-même : `expected [ 'cookies().set(app.session_token)' ] to deeply equal []` |
| C | corps de `settled` vidé dans `signIn` | `e2e/support/account.ts:146` | **2** — `e2e/auth.spec.ts:28` et `e2e/two-factor.spec.ts:162` |
| D | **contrôle** : C + les deux instantanés `page.url()` remis en `await expect(page).toHaveURL(…)` | `account.ts` + `auth.spec.ts` + `two-factor.spec.ts` | **0** — `92 passed`, suite entièrement verte |

La mutation D est celle qui compte le plus : elle établit que **la forme réessayante cachait complètement le défaut**, et donc que les deux instantanés ne sont pas un ornement mais le filet. C'est la démonstration que le plan promettait et que je n'ai pas prise sur parole.

Restauration : `cp` des sauvegardes puis `git diff --exit-code` → **propre**, et `git status --porcelain` vide en fin de revue.

- [x] **La garde mord dans les deux configurations.** Le `describe` de la garantie de s24 n'est gardé que par `databaseReachable` — aucun gate de module — et `socle` ne coupe que `marketing`, `organizations`, `i18n` : `billing` et `auth` restent activés, donc les deux cas centraux s'exécutent dans les deux branches de la matrice. Confirmé par le total identique de 1978 cas.
- [x] **Aucune doublure complaisante.** La sonde `appAuth` **jette** en plus d'enregistrer, donc elle ne peut pas « accepter en silence » ; la sonde `cookies().set` enregistre sans jeter, et la mutation B montre qu'elle attrape la pose et que l'assertion la lit. Les deux mécanismes sont complémentaires.
- [x] **Aucun test rendu redondant n'a été laissé.** `withinStablePeriod` de `e2e/two-factor.spec.ts` est retiré et remplacé par la mesure qui le condamne ; celui de `tests/auth.test.ts` (seuil 3 s) **reste** et doit rester — ce fichier dérive des codes à des compteurs choisis, il a réellement besoin d'une période stable. La distinction est correcte.

**Sur la marge, puisque c'est le nœud.** J'ai refait la mesure du rapport poste → runner moi-même, cinq cas de `storage.spec.ts`, poste **séquentiel** contre le journal du run `33894919551` en configuration `tous` (que le journal déclare explicitement `Running 100 tests using 1 worker` — donc comparaison à travailleur égal, ce que j'ai vérifié plutôt que de supposer le défaut de Playwright) :

| Cas | Poste (1 travailleur) | CI | Rapport |
|---|---|---|---|
| `storage:92` | 5,1 s | 6,8 s | 1,33 |
| `storage:151` | 7,1 s | 11,0 s | 1,55 |
| `storage:195` | 2,4 s | 5,3 s | 2,21 |
| `storage:253` | 2,3 s | 5,2 s | 2,26 |
| `storage:281` | 4,0 s | 9,6 s | 2,40 |

Je mesure **1,33 à 2,40**, pas 2,3 à 2,8 (Constat 5) — mais la conclusion tient et le pire cas reste confortable : `two-factor` mesuré ici à **7,0 s** séquentiel donne ≈ **17 s** au rapport 2,40, ≈ **20 s** au rapport 2,8 de l'implémenteur, pour un budget de 30 s.

L'argument décisif n'est cependant pas la moyenne, c'est **la disparition de la source de variance**. Le sommeil ajoutait 0 à 10,1 s, deux fois, environ une exécution sur trois — un mode bimodal. Mes cinq exécutions rendent 7,6 / 7,9 / 7,8 / 7,8 s (quatre travailleurs) et 7,0 s (séquentiel) : **0,9 s d'amplitude totale**, là où le parcours en avait 18,7 s. Le journal de CI corrobore la cause : 28,2 s en `tous` (vert, sommeil court) contre 31,2 s en `socle` (rouge), même commit, même minute.

## Regressions

- [x] **Les 18 sites d'appel de `signIn` sont couverts par au moins une exécution verte.** `pnpm test:e2e` (×4) couvre `app-shell`, `auth`, `two-factor`, `organizations`, `billing`, `passkeys` ; `pnpm test:socle` les rejoue sans `i18n` (donc sans préfixe de locale, ce qui exerce l'autre forme de `SIGN_IN_SCREEN`) ; `pnpm test:minimal-profile` les rejoue encore autrement ; et **j'ai exécuté `pnpm test:golden-path` moi-même** pour ses 3 appelants — que ni `test:e2e` ni `test:socle` ne touchent, et dont le job de CI est **`skipped`** (vérifié par `gh run view --json jobs`). Vert.
- [x] **Le cas que la story cible sans le modifier**, `e2e/billing.spec.ts:406`, est bien celui que le correctif ferme : le journal de CI donne `Expected pattern: /localhost:\d+\/fr\/pricing\?offer=pro-monthly$/` / `Received string: "http://localhost:3100/fr"` à la ligne 439 — l'atterrissage de la connexion arrivé après le `goto`. Le geste attend désormais avant de rendre la main.
- [x] **Aucune couverture perdue par `anonymousAgain`.** Vérifié, pas admis : `e2e/auth.spec.ts:28` exerce la déconnexion **et** sa révocation côté serveur (il repose le cookie capturé et vérifie que `/account` redirige vers la connexion), et `e2e/passkeys.spec.ts` appelle encore `signOut` **trois fois** (`:107`, `:126`, `:170`). Le geste partagé reste exercé. Le seul écart réel est décrit au Constat 3.
- [x] Aucun autre chemin de production n'est touché : le diff ne contient aucun fichier de `apps/`, `packages/` ou `config/`.

## Constats

1. **minor — `tests/billing.test.ts:5574-5577` — affirmation d'exhaustivité fausse, sur la justification d'une sonde de sécurité.** Le commentaire écrit que `appAuth` vit dans « le seul fichier de l'application qui connaisse le module `auth` ». C'est faux, mesuré : `apps/web/lib/guest-account.ts:1` importe aussi `@repo/module-auth` (`authRoutePath`). L'argument de fond survit — `authRoutePath` est un chemin, il n'ouvre aucune session — mais c'est exactement la forme de phrase que l'`AGENTS.md` interdit (« Never claim exhaustiveness… The next agent reads such a claim as verified and stops looking »), et aucune commande ne la tient. Écrire « balayé sur `apps/web/app` et `apps/web/lib`, 2 fichiers importent le module, un seul l'instancie » serait juste.

2. **minor — `tests/billing.test.ts:5582-5588` — la garantie de s24 est rétrécie, et le rétrécissement n'est adossé à aucune règle.** L'ancien compte global attrapait **toute** ligne `auth_session` créée pendant le rendu ; les deux sondes n'attrapent que `appAuth()` et `cookies().set`. L'écart — une écriture directe par `@repo/db` depuis l'écran, sans cookie — est honnêtement écrit, et j'ai vérifié le balayage : `eslint.config.ts:529` est bien la **seule** borne sur `@repo/module-auth`, et elle vise `packages/modules/organizations/src`, pas `apps/web`. L'écart est acceptable tel quel — une session que le visiteur n'emporte pas n'ouvre l'accès de personne, et Next refuse de toute façon `cookies().set()` pendant un rendu de composant serveur —, mais il reste de la documentation, pas une règle. Le remède proportionné, si on veut retrouver la force sans le parallélisme, n'est pas le compte global : c'est une observation **du dépôt** (espionner les insertions dans `auth_session` pendant ce rendu-là), pas de la base entière.

3. **minor — `e2e/two-factor.spec.ts:152-156` — « plus strict que se déconnecter » n'est vrai que côté navigateur.** `clearCookies()` retire tout ce que le navigateur porte, donc strictement plus que le seul cookie de session — mais il **ne révoque rien côté serveur** : les trois sessions précédentes du compte restent valides jusqu'à leur expiration. Aucune assertion de ce fichier n'en dépend, et la révocation reste éprouvée par `auth.spec.ts` (vérifié) : la couverture n'est pas perdue. C'est la phrase qui est trop large.

4. **minor — un **quatrième** intermittent de `pnpm test`, non nommé, qui suffit à garder la CI rouge.** Sur mes 4 exécutions complètes, une rouge : `tests/audit-exceptions.test.ts` › « coupe un `pnpm audit` qui ne répond pas » — `expected 2 to be 3`, c'est-à-dire deux tentatives au lieu de `AUDIT_ATTEMPTS` avant que le `timeout: 20_000` du `spawnSync` extérieur ne coupe. **6/6 vert en isolation**, rouge sous charge : même signature que les deux intermittents que la story nomme. Le fichier est du code de s48, **hors diff**, et l'interdit de la story dit justement de nommer sans corriger — donc rien à reprocher au correctif. Mais la mesure « `pnpm test` ×10 → 10/10 » est un échantillon heureux, et le dernier critère de s48 (« le run de CI de la branche par défaut est vert ») **ne sera pas fermé par cette story seule**. À porter dans une story de suite, avec les deux autres.

5. **minor — `docs/plans/…:108-110` — le rapport poste → runner cité (2,3–2,8) est au-dessus de ce que je reproduis (1,33–2,40 sur cinq cas de `storage.spec.ts`).** La conclusion ne change pas — 17 à 20 s pour un budget de 30 s —, mais la fourchette écrite n'est pas celle que ma mesure rend, et elle est utilisée comme argument décisif de la seconde coupe. Une fourchette mesurée doit dire sur quels cas et dans quel régime elle a été prise.

6. **minor — `docs/plans/s50-tests-deterministes.md` — le plan ne nomme aucune section de `docs/security.md`,** alors qu'il change la façon dont une garantie de sécurité est observée. L'`AGENTS.md` l'exige (« A story's plan names the sections of `docs/security.md` it touches »). Le fond est traité, la référence manque.

7. **minor (dette, décision correcte) — `.github/workflows/ci.yml:176` téléverse `playwright-report/` là où les traces vivent dans `test-results/`.** L'étape n'a **jamais** rien archivé, ce qui a coûté à la tâche 1 une reproduction locale complète. Le même fichier porte déjà le correctif à la ligne 303 pour le parcours doré, avec le commentaire qui l'explique — donc le défaut est connu et isolé. **Ne pas le corriger ici était le bon appel** : la story interdit `.github/`, un diff d'infrastructure glissé dans une story de déterminisme aurait été une dérive, et c'est écrit dans le plan. Mais c'est une story de suite, pas une note : tant qu'elle n'existe pas, chaque échec de parcours en CI recommencera par une reproduction locale.

Aucun constat **critical**, aucun **major**.

## Ce que je n'ai **pas** vérifié

- **La CI elle-même. C'est le point le plus important de cette revue.** Rien ici n'a tourné sur un runner Ubuntu. Les 17 à 20 s projetés pour `two-factor.spec.ts` sont une **extrapolation** d'un rapport mesuré sur cinq cas d'un autre fichier, sur un poste macOS Apple Silicon, contre un seul run de CI. Le raisonnement est solide et la variance a bien disparu, mais **« la CI de `dev` est verte » reste à constater, pas à déduire.** Le geste humain : fusionner, puis **lire le run de CI de `dev` par événement**, les deux branches de la matrice, et relever la durée de `two-factor.spec.ts` dans chacune. Si elle dépasse 20 s en `socle`, la marge est plus mince qu'annoncée même en vert.
- **La duplication des runs de demande de fusion** (`push` **et** `pull_request` simultanés) n'a pas été écartée comme facteur de charge. Elle est hors périmètre par décision de la story, mais elle reste une hypothèse vivante : le geste humain est de comparer, sur la PR de cette story, la durée de `two-factor.spec.ts` entre les deux runs concurrents.
- **Le quatrième intermittent (Constat 4) n'a pas été caractérisé sous CI.** Je l'ai vu 1 fois sur 4 sous charge locale, jamais en isolation ; je ne sais pas s'il rougit sur un runner à un travailleur. À surveiller sur le premier run de `dev`.
- **Les deux intermittents nommés** (`rate-limiting.spec.ts:38`, `oauth.spec.ts:97`) ne se sont **pas** manifestés sur mes 4 passages + `socle` + profil minimal. Je ne peux donc ni confirmer ni infirmer l'explication « quatre travailleurs contre un » ; le journal de CI confirme en revanche le « un travailleur » côté runner, ce qui la rend plausible.
- **Le régime `recorded` du parcours doré** n'a pas tourné : je l'ai exécuté en `simulated`, et `tests/fixtures/stripe-events/` ne porte toujours aucun enregistrement (le job de CI reste `skipped`). Le vert que j'y obtiens ne dit rien de la fidélité aux formes Stripe réelles — c'est la limite que l'`AGENTS.md` documente déjà, pas une régression de cette story.
- **Aucune preuve navigateur au sens « écran »** n'est due ni fournie : le diff ne rend rien. Confirmé par l'absence de `.tsx` et de tout fichier de `apps/` ou `packages/`, vérifiée et non supposée.
- **Le `two_factor` d'un appareil de confiance** : `anonymousAgain` prétend supprimer « aucun cookie d'appareil de confiance » ; ce dépôt n'expose pas cette fonctionnalité, donc l'affirmation est vide plutôt que fausse. Non vérifiée parce qu'il n'y a rien à vérifier.

## Verdict

Le correctif est juste sur les trois mécanismes, il est prouvé au bon endroit, il ne perd aucune assertion mesurable, il ne baisse aucun compte de cas, et il refuse la sortie facile que la story interdisait. La mutation de contrôle D — remettre la forme réessayante et voir la suite redevenir entièrement verte malgré le signal neutralisé — est ce qui établit que ce diff ferme un vrai trou et pas seulement une gêne. Les sept constats sont tous mineurs : quatre portent sur des phrases trop larges ou des mesures citées au-delà de ce qu'elles portent, deux sur des règles absentes plutôt que violées, un sur une dette d'infrastructure correctement différée. Aucun ne corrompt quoi que ce soit, aucun ne bloque.

Ce qu'il faut retenir en sortant : **la story fait ce qu'elle promet, mais elle ne ferme pas encore le critère de s48.** Un quatrième intermittent vit dans `pnpm test`, et le chemin d'archivage des traces reste faux. Deux stories de suite, pas des notes.

Max severity: minor
Ship allowed: yes
