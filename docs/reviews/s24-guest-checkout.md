# Review — Story s24-guest-checkout

> Fresh-context review. Each issue classified: critical / major / minor.
> Diff reviewed: `git diff dev...feature/s24-guest-checkout` — 1 commit (`63bfabf`), 37 fichiers, +3763/−197.

## Commands run by the reviewer

| Commande | Résultat |
|---|---|
| `docker compose up -d` (worktree, port 5434) | conteneur `s24-guest-checkout-postgres-1` joignable |
| `pnpm db:migrate` | « Rien à appliquer » (déjà posé) |
| `pnpm test` | **1745 passed, 8 skipped, 54 fichiers** |
| Contrôle « la base a bien été jouée » : `DATABASE_URL` vers le port mort 5999 | **1418 passed, 2 failed, 333 skipped** — soit **325 cas de moins exécutés**. La suite mesurée l'a donc été contre une base, pas contre des cas sautés en silence |
| `pnpm typecheck` | vert (24 tâches) |
| `pnpm lint` | vert — « No issues found » |
| `pnpm build` | vert |
| `pnpm test:e2e` | vert — **86 passed, 8 skipped** (la valeur annoncée dans `packages/modules/billing/AGENTS.md` est exacte) |
| Migration sur base **neuve** (`review_s24`) : `pnpm db:migrate` ×2 | 1ʳᵉ « billing (6) » appliquées ; 2ᵉ « Rien à appliquer ». Rejouable, et purement additive (`0005_happy_sister_grimm.sql` = un `create table` + un `create index`, aucune colonne existante touchée → rétro-compatible avec la version encore en ligne) |
| Parcours invité **paiement unique** joué à la main dans un navigateur (mode local) | voir *Preuve navigateur* ci-dessous |
| Parcours « lien reçu → mot de passe défini → connexion → droit visible » joué à la main | voir *Preuve navigateur* |
| 12 mutations (dont 3 non demandées par le plan), chacune restaurée | voir *Tests* |
| `git diff --exit-code` après restauration de **toutes** les mutations | **propre** (vérifié après chaque mutation et une dernière fois avant l'écriture de ce rapport, suivi d'un `pnpm test` final à 1745 verts) |

## Plan compliance

- [x] **The code does what the plan specifies** — les 9 tâches sont livrées et localisées : périmètre invité (`domain/guest.ts`, `infrastructure/guest-scope-id.ts`), entrée publique (`billing-use-cases.ts:670-736`, `billing-routes.ts:152-202`), limitation de débit (`domain/checkout-throttle.ts`, `drizzle-billing-repositories.ts:893-941`), promotion (`billing-use-cases.ts:629-654` + `:514-549`), lien envoyé (`apps/web/lib/guest-account.ts:130-157`), page de retour (`apps/web/app/pricing/page.tsx`), module coupé (test dédié), rétention (`module.ts:67-96`), documentation (deux `AGENTS.md` + `docs/security.md`).
- [x] **Run interdicts respected — chacun vérifié nommément :**
  - **`packages/core/src/module.ts` non modifié** : `git diff --name-only dev...HEAD | grep packages/core` ne rend **rien**. `ModuleScope` garde ses deux formes. ✔
  - **`openCheckout` non assoupli** : `billing-use-cases.ts:738-742` porte toujours `ownerOf(session)` puis `canManage(scope, session.userId)`, à l'identique. L'entrée invitée est une fonction **voisine**. ✔
  - **La ligne client s'écrit à l'ouverture, pas au webhook** : `linkGuestCustomer` est appelée dans `openGuestCheckout`, avant que l'URL ne soit rendue (`:721`). `applyEvent` fait un `update`, jamais un `insert`, sur `billing_customer`. ✔ (mesuré aussi par le cas « la ligne client existe avant tout webhook »)
  - **Aucune session depuis la page de retour** : `apps/web/app/pricing/page.tsx` n'importe ni `cookies`, ni `headers`, ni `lib/auth` autrement que par `currentViewer` (lecture). Prouvé par mutation M7. ✔
  - **Aucun lien de mot de passe vers un compte existant** : `guest-account.ts:133` branche sur `account.created`. Prouvé par mutation M4. ✔
  - **`auth` absent des `requires` de `billing`** : `module.ts:44` porte toujours `requires: []`. ✔
  - **Aucune commande de nettoyage** : `git diff --name-only` ne touche ni `scripts/` ni `package.json`. ✔
  - **`config/security.ts` et `config/billing.ts` intacts** : absents du diff. ✔
- [x] **Rien de plus que ce que le plan demande, à une exception près** — la modification de `packages/modules/auth` (finding **F1**), déclarée par l'implémenteur comme déviation mais absente du plan validé.

## Anti-hallucination

- [x] **Aucune API inventée.** Chaque référence neuve a été ouverte :
  - `users.markEmailVerified(userId)` → `auth/application/ports.ts:37`, `(userId: string): Promise<boolean>`, implémenté `drizzle-auth-repositories.ts:109-117`. ✔
  - `AuthService.handle` + `useCases.identifyAccount(email)` → `auth-use-cases.ts:137` / `:463`. ✔
  - `authRoutePath('signUp' | 'requestPasswordReset' | 'magicLink')` → `auth-routes.ts:60-103`, les trois clés existent. ✔
  - `Stripe.Checkout.Session.customer_details` → `stripe@22.6.1/esm/resources/Checkout/Sessions.d.ts:146`. Champ réel, non halluciné. ✔
  - `input.customerEmail` sur `CreateCheckoutInput` → `packages/ports/src/payments.ts:117`, **préexistant** ; s24 ne l'invente pas. ✔
  - La justification « le greffon magic-link fait déjà de même » citant `revokeUnprovenAccountAccess` → vérifiée dans `better-auth/dist/plugins/magic-link/index.mjs:6,166,178` : le greffon écrit bien `emailVerified: true` à la connexion. Claim **exacte**. ✔
- [x] **Aucune valeur plausible-mais-fausse repérée.** `hits > max` (et non `>=`) : le compte rendu par `hit` inclut l'ouverture en cours, donc `>` est le bon opérateur ; vérifié par le cas qui autorise exactement `maxPerClient` ouvertures puis refuse la suivante. Statuts 400/429/502 cohérents avec le reste du module. Fenêtre alignée sur la durée (`Math.floor(t/span)*span`), recopiée de `marketing/domain/rate-limit.ts:112-116`.
- [x] **Le code fait ce qu'il annonce** — deux points vérifiés indépendamment du commentaire qui les affirme :
  - la garantie d'ordre de l'**ADR 034 survit** : `effectOf` pour `subscription_changed` ne résout son propriétaire que par `customerByProviderId` (`billing-use-cases.ts:534`), qui ne filtre pas `scope_kind`. Un `customer.subscription.created` arrivé avant la complétion trouve donc bien la ligne invitée. Le simulateur local livre d'ailleurs les deux événements **dans le désordre** volontairement (`local-payments.ts`), et l'e2e le joue. ADR 034 **non contredit**, non superséré — l'ADR 047 l'étend sans y toucher. ✔
  - la signature du webhook est vérifiée **avant** toute lecture : `guestPromotionFor` — qui crée un compte — est situé après le `if (!verified.ok) return` (`billing-use-cases.ts:891-913`). Un événement forgé ne crée aucun compte. ✔

## Rules compliance

- [x] **AGENTS.md racine** : quatre couches respectées (`domain/guest.ts` n'importe pas `node:crypto`, le tirage vit dans `infrastructure/`) ; `pnpm lint` vert sur les frontières ; un seul commit, message impératif en français, portant recherche, plan et ADR 047 ; `<form method="post">` présent sur les trois déclencheurs (mesuré : `occurrences(html,'method="post"') === 3`).
- [x] **ADR 018** : aucune clé étrangère neuve ne sort du module ; le périmètre invité reste deux colonnes de texte.
- [x] **ADR 034** : respecté, pas contourné (ci-dessus). **ADR 047** : appliqué à la lettre — `ModuleScope` intact, `scope_id` CSPRNG (32 octets `randomBytes` → hex, `guest-scope-id.ts:23`), promotion en `update`, rétention déclarée.
- [x] **ADR 006 / lint de couches** : `domain/checkout-throttle.ts` ne contient que la règle ; le compteur est en `infrastructure/`.
- [ ] **`docs/security.md`** : le §7 gagne un inventaire **incomplet** — finding **F6**.
- [ ] **« Docs ship with the code that changes them »** : `packages/modules/auth/AGENTS.md` n'est pas touché alors que s24 change la sémantique de `onPasswordReset` — finding **F1**.
- Pas de design system à vérifier : aucun composant ni jeton neuf, `Alert` et `Button` viennent de `@repo/ui`.

## Tests

- [x] **Suite exécutée par le relecteur, verte, et prouvée jouée contre une base** (tableau ci-dessus).
- [x] **Les assertions épinglent les critères**, pas la décoration. Les cas neufs interrogent la base (`storedCustomers()`, `countRows`), le port `Mailer` réel, le vrai répartiteur et le vrai service `auth`. Le seul cas qui compte du balisage (`occurrences('<form')`) mesure une règle du dépôt, pas une classe CSS. Aucun test sans assertion, aucun écho de props gratuit.
- [x] **Tests rendus caducs nommés et remplacés** : les deux cas s22 « mène un visiteur sans session à la connexion » et « n'envoie qu'un identifiant d'offre (connecté) » sont réécrits, pas doublonnés, avec un commentaire disant que s24 remplace le 4ᵉ critère de s22.
- [x] **Bite proven by neutralization** — 12 mutations, chacune restaurée et l'arbre reprouvé propre :

| # | Mutation | Site | Rouges |
|---|---|---|---|
| M1 | retrait de `eq(scopeKind, GUEST_SCOPE_KIND)` de l'`update` de promotion | `drizzle-billing-repositories.ts:545` (**stockage**) | **1** |
| M2 | `!isGuestScopeKind(...)` retiré de la garde applicative | `billing-use-cases.ts:639` | **2** |
| M3 | `accountScopeOfCustomer` rend un `user:` pour un invité | `domain/guest.ts:80` | **2** (dont 1 sur `reconcile`) |
| M4 | lien de **définition de mot de passe** vers un compte existant | `apps/web/lib/guest-account.ts:152` (**point de composition**) | **1** |
| M5 | `scope_id` invité tiré d'un horodatage, forme conservée | `guest-scope-id.ts` | **1** |
| M6 | compteur de débit en mémoire de processus | `billing-runtime.ts:108` | **6** |
| M7 | la page de retour **ouvre une session** en base pour le payeur | `apps/web/app/pricing/page.tsx` (**écran**) | **1** |
| M8 | `if (applied && promoted !== null)` → `if (promoted !== null)` | `billing-use-cases.ts:932` | **0** → F4 |
| M9 | le journal d'événements ne bloque plus la promotion | `drizzle-billing-repositories.ts:510` | **0** → F5 |
| M12 | `purchase_paid` retiré de la branche de promotion | `billing-use-cases.ts:912` | **0** en unitaire **et 0 en e2e** → **F2** |
| M11 | `await users.markEmailVerified(userId)` supprimé | `auth-use-cases.ts:394` | **0 sur 1745** → **F1** |

  Les mutations sont posées **au site du défaut** : M1 au stockage (pas dans le cas d'usage), M4 et M7 au point de composition et dans l'écran, pas dans le module. Les six mutations exigées par le plan sont rouges. Les résultats reproduisent exactement le tableau de `packages/modules/billing/AGENTS.md`, y compris les deux vertes que l'implémenteur signale lui-même — l'honnêteté du rapport est confirmée, et **deux mutations vertes de plus** ont été trouvées (M11, M12).
- [x] **Preuve navigateur** (dev, 1280 px et 390 px — `next start` refuse par conception `PAYMENTS_LOCAL_MODE`, `STORAGE_LOCAL_DIRECTORY` et `OAUTH_LOCAL_PROVIDER` sous `NODE_ENV=production`, donc la capture sous build de production est impossible sans clés réelles) :
  - `/fr/pricing` anonyme : trois déclencheurs `<button>` **actifs** après hydratation, aucun lien vers `/sign-in` ;
  - `?checkout=success` : bandeau `info` lisible, non tronqué ; `?checkout=cancelled` à 390 px : bandeau `warning` lisible, cartes empilées, aucun débordement ;
  - **parcours « paiement unique » joué à la main** (le seul que ni l'unitaire ni l'e2e ne couvre) : clic « Acheter » anonyme → `POST /api/modules/billing/guest-checkout` → page hébergée simulée → retour `/fr/pricing?checkout=success`. En base : `billing_customer` **promue** (`scope_kind = user`), `billing_purchase` `paid` sur `lifetime`, compte créé `…@guest.local` avec `email_verified = f`. **Le chemin fonctionne** — F2 est un trou de filet, pas un bogue ;
  - **parcours « lien reçu → compte » joué à la main** : email `auth.reset-password` capturé, lien `/reset-password?token=…` suivi, mot de passe défini, **connexion réussie**, `/fr/billing` affiche « Licence à vie — Acheté le 3 septembre 2026 — Payé ». `email_verified` est passé à `t`. La justification de la modification d'`auth` est donc **réelle et mesurable à la main** : sans elle, `requireEmailVerification: true` refusait cette connexion. Aucune session n'a été ouverte par le retour ni par le lien : il a fallu se connecter.

## Regressions

- `openCheckout`, `openPortal`, `view`, `purge`, `export` : inchangés. `handleWebhook` gagne deux instructions encadrées, l'ordre existant (signature → effet → journal en transaction) est préservé.
- `scopeOfCustomer` devient nullable — le seul appelant est `reconcile`, qui traite désormais `null` en sautant le compteur de sièges (`billing-use-cases.ts:1156-1172`). Couvert par un cas dédié, rouge sous M3.
- `customerForScope` filtre déjà `scope_kind` **et** `scope_id` (`drizzle-billing-repositories.ts:226`, préexistant) : un périmètre `user:`/`organization:` ne peut structurellement pas atteindre une ligne `guest`. Vérifié en lisant, pas seulement en croyant la table d'`AGENTS.md`.
- `packages/payments-testing` : `completeCheckout` refactorisé vers `complete()` partagé ; les deux portes sont mutuellement exclusives (`guest:` vs `user:`/`organization:`), mesuré par un cas qui les fait se rencontrer. Le refus reste **404 indiscernable** (constat F7 de la revue s19 préservé), vérifié dans `apps/web/app/api/billing-local-checkout/route.ts`.
- `auth` : `onPasswordReset` gagne un effet **pour tous les comptes du produit**, pas seulement les comptes invités. Voir F1.
- Modules coupés : `auth` est un `requiredModules` (`config/features.ts:68`), il ne peut pas disparaître sous `guest-account.ts`. `billing` coupé → route absente (404, cas dédié) et `/pricing` en `notFound()`.

## Findings

- **F1 — major — `packages/modules/auth/src/application/auth-use-cases.ts:394`.** `markEmailVerified` posé sur `onPasswordReset` : **0 test rouge sur 1745** quand on supprime la ligne. C'est la ligne la plus sensible du diff, elle change le comportement de **tous** les comptes du produit (pas seulement ceux d'un paiement invité), et aucune commande ne tombe si elle disparaît ou si quelqu'un l'élargit. Trois constats, dans l'ordre :
  - *Pas de contournement trouvé.* Le jeton de réinitialisation ne part que vers `user.email` (`sendPasswordResetEmail`), il est émis par la bibliothèque, il n'apparaît dans aucune réponse ; `markEmailVerified` ne pose que `true` (`drizzle-auth-repositories.ts:109-117`), il ne peut donc **ni dégrader ni contourner** une vérification existante. Le précédent invoqué est réel (le greffon magic-link fait déjà de même). J'ai joué le parcours à la main : la marque est bien la conséquence d'un lien lu dans une boîte.
  - *Le plan ne le demandait pas.* Aucune tâche du plan validé ne touche `auth` ; « Fichiers touchés (anticipé) » ne le liste pas. Dérive assumée, mais dérive.
  - *Piège latent, non tenu par une commande.* `better-auth@1.7.2` appelle `onPasswordReset` depuis **trois** sites : `dist/api/routes/password.mjs:172`, `dist/plugins/email-otp/routes.mjs:601`, `dist/plugins/phone-number/routes.mjs:484`. Seul le premier est atteignable aujourd'hui (les greffons montés sont `genericOAuth`, `magicLink`, `twoFactor`, `passkey`). Le jour où une story monte `phoneNumber`, une réinitialisation **par téléphone** marquera l'adresse email vérifiée, et le commentaire qui justifie la ligne (« le lien de réinitialisation ne part que vers l'adresse du compte ») deviendra faux sans que rien ne rougisse. Enfin, `packages/modules/auth/AGENTS.md` continue d'affirmer « la vérification d'email est à nous » et n'est pas mis à jour, alors qu'un second chemin l'écrit désormais. Manque : un cas dans `tests/auth.test.ts` (« consommer un lien de réinitialisation rend l'adresse vérifiée, et une connexion auparavant refusée devient possible ») et une ligne dans l'`AGENTS.md` d'`auth`.
- **F2 — major — `packages/modules/billing/src/application/billing-use-cases.ts:912`.** La promotion d'un **paiement unique** invité n'est tenue par **aucun** test : réduire la branche à `event.kind === 'checkout_completed'` laisse `tests/billing.test.ts` (160) **et** `e2e/billing.spec.ts` (13) entièrement verts. Le critère 1 nomme pourtant explicitement « une offre en abonnement **comme en paiement unique** », et le critère 2 porte le rattachement du droit. Le helper `guestCompletion` n'émet que `mode: 'subscription'`, et le parcours e2e clique « Souscrire ». J'ai joué le chemin à la main dans un navigateur : **il fonctionne** (ligne promue, achat `paid`, compte créé), donc ce n'est pas un bogue livré — c'est la moitié d'un critère d'acceptation livrée sans filet, sur le seul chemin qui puisse encaisser 490 € d'un anonyme. Manque : un cas `purchase_paid` invité dans `tests/billing.test.ts`, ou le clic « Acheter » dans le parcours e2e.
- **F3 — major — `packages/modules/billing/src/domain/checkout-throttle.ts`.** Un seul seau, par appelant, sur le **premier** maillon de `x-forwarded-for` — c'est-à-dire sur une valeur que l'appelant écrit lui-même. Rien ne borne le **coût total** de la route. Chaque requête acceptée crée, chez le fournisseur, **un client *et* une session de checkout** (`stripe-payments.ts:456-470` ; la clé d'idempotence est `customer:guest:<64 hex tirés au hasard>`, elle ne converge donc jamais) et, chez nous, **une ligne `billing_customer` que rien n'effacera jamais** — l'ADR 047 et le commentaire de `module.ts` refusent nommément toute commande de nettoyage. Un attaquant qui fait tourner l'en-tête obtient donc de la croissance de base **définitive** et une consommation illimitée du budget d'appels du marchand. Le module `marketing` nomme exactement cette faiblesse (`domain/rate-limit.ts:88-92`) et y répond par un **second seau, par formulaire, qui dégrade**. L'argument écrit ici — « il n'y a rien à dégrader, l'appel au fournisseur *est* l'opération » — passe à côté d'une dégradation disponible et non considérée : au-delà d'un seuil global, **revenir au comportement d'avant s24** (le déclencheur anonyme mène à la connexion), ce qui borne le coût sans fermer le canal de vente et sans toucher au chemin authentifié. Le socle §7 est tenu à la lettre (limitation présente, partagée entre instances) ; c'est son intention qui ne l'est pas.
- **F4 — minor — `packages/modules/billing/src/application/billing-use-cases.ts:932`.** `if (applied && promoted !== null)` : le retrait d'`applied` ne fait rougir aucun cas. L'implémenteur le signale et conclut que la condition « reste comme seconde barrière ». Elle est en réalité **la seule** barrière dans deux situations qu'aucun test ne joue : (a) quand la clause `not exists` a bloqué la promotion, la ligne reste `guest` et un rejeu reproduit un `promoted` non nul — un second lien d'accès partirait ; (b) deux livraisons **simultanées** du même événement passent toutes deux `isGuestScopeKind` et `accountFor`, et seul le journal départage. Manque : un cas « second paiement d'un compte qui a déjà une ligne client, événement rejoué → un seul email ».
- **F5 — minor — `packages/modules/billing/src/infrastructure/drizzle-billing-repositories.ts:510`.** Le `return false` du journal peut être déplacé après la promotion sans qu'aucun cas ne rougisse. La structure est **antérieure à s24** et l'inertie du rejeu est bien portée par les deux gardes que j'ai prouvées rouges (M1, M2) — la conclusion de l'implémenteur (« l'idempotence de la promotion est une propriété du stockage ») est exacte. Reste que `docs/reliability.md` §1 s'appuie sur ce journal et qu'aucune commande ne tombe quand il cesse de bloquer : à nommer pour la story qui reprendra le journal.
- **F6 — minor — `docs/security.md` §7.** « Les autres routes déclarées `public` — celles de `auth`, le webhook de paiement — ne sont **pas** limitées en débit à ce jour » se lit comme une énumération, et elle est incomplète. Compté sur l'arbre : 29 déclarations `protection: { level: 'public' }`, dont au moins deux routes omises par la phrase — `POST /consent/decide` (`consent/presentation/consent-routes.ts:87`, qui **écrit** un consentement) et `GET /demo-enabled/items` (`demo-enabled/presentation/demo-item-routes.ts:50`). C'est le motif que l'`AGENTS.md` racine désigne nommément comme récidive (« Never claim exhaustiveness … caught three times »). La phrase se répare en écrivant « relevé sur les N routes publiques déclarées au 3 septembre 2026, et voici les cas balayés ».
- **F7 — minor — `packages/modules/billing/src/messages/{fr,en}.json`.** Le bandeau de retour affirme des faits que l'écran n'a jamais lus : « **Paiement reçu.** » sur n'importe quel `?checkout=success` forgé, et « Rien n'a été prélevé, et **aucun compte n'a été créé.** » sur un `?checkout=cancelled` forgé — y compris après un paiement réel. Rien n'est accordé (prouvé par M7), la discipline de s19 est tenue ; mais s19 dit « n'affiche **qu'un bandeau** », pas « affirme un état de base ». Une formulation qui ne prétend rien savoir (« Si le paiement a abouti, un email vient de partir à l'adresse indiquée ») coûterait deux mots.
- **F8 — minor — `tests/module-registry.test.ts:840-863`.** La garde « aucun répartiteur de webhooks dans `apps/web` » gagne une exception. Elle est correctement resserrée — égalité de chemin exacte, existence du fichier assertée, sonde `.webhooks` maintenue — mais le motif `/\.handle\s*\(/` ne distingue pas une répartition d'un appel pass-through, et c'est désormais un commentaire qui porte la différence. Acceptable en l'état ; à revoir si une deuxième exception se présente.

## Not verified

Ce que cette revue **n'a pas** pu vérifier, et le geste humain correspondant :

1. **Aucun appel réel à Stripe.** Tout le tunnel invité a été joué contre le simulateur local et une doublure `fetch` enregistrée. Un humain doit ouvrir **un** checkout invité avec de vraies clés de test et vérifier trois choses sur la page hébergée réelle : qu'elle **collecte bien une adresse** sans qu'on la lui donne (sans quoi `customer_details.email` revient `null` et aucun compte n'est créé), que `checkout.session.completed` la rapporte, et que la ligne `billing_customer` est promue. C'est le seul point où le parcours peut échouer silencieusement en production tout en étant vert ici.
2. **La branche « magic link » n'a jamais été suivie de bout en bout.** Le test unitaire prouve que le gabarit `auth.magic-link` part ; personne n'a cliqué le lien, ouvert la session et vérifié que le droit acheté apparaît sur `/billing` pour un compte **préexistant**. À jouer : créer un compte, payer en invité avec la même adresse, ouvrir la boîte, cliquer, voir l'achat.
3. **Capture navigateur sous build de production impossible** : `next start` refuse `PAYMENTS_LOCAL_MODE`, `STORAGE_LOCAL_DIRECTORY` et `OAUTH_LOCAL_PROVIDER` sous `NODE_ENV=production` — par conception, et c'est une bonne chose. Les captures 1280 px / 390 px et les deux parcours manuels ont été faits sous `next dev`, le même harnais que l'e2e. Un humain avec un environnement de recette (clés Stripe test + S3) doit refaire la page `/pricing` anonyme et le bandeau de retour sous build de production.
4. **La concurrence n'a pas été jouée.** Deux livraisons simultanées du même `checkout.session.completed`, et deux ouvertures de tunnel simultanées, n'ont été raisonnées que par lecture des contraintes d'unicité. La transaction et l'index `(scope_kind, scope_id)` rendent le raisonnement solide, mais il n'est pas mesuré (voir F4).
5. **L'abus de la route publique n'a pas été mesuré.** F3 est dérivé de la lecture d'`ensureCustomer` et de `linkGuestCustomer`, pas d'une campagne de requêtes avec `x-forwarded-for` tournant. Un humain devrait envoyer quelques centaines de requêtes avec des en-têtes distincts contre un environnement de recette et compter les lignes `billing_customer` et les objets créés côté fournisseur — c'est cette mesure qui dira si F3 doit devenir bloquant avant s28.
6. **Les configurations à modules basculés n'ont pas été rejouées.** `pnpm ks toggle billing` puis `pnpm test` / `pnpm test:e2e` n'ont **pas** été exécutés : le critère 8 est couvert par un registre `withoutBilling` construit dans la suite et passé au **vrai** répartiteur, ce qui est solide, mais ce n'est pas la configuration réellement livrée. À faire au prochain passage, avec restauration.
7. **Aucun envoi d'email réel.** `EMAIL_LOCAL_CAPTURE=1` partout ; le port `Resend` n'a jamais parlé au réseau. Le rendu des deux gabarits (`auth.reset-password`, `auth.magic-link`) dans un vrai client mail n'est pas vérifié.
8. **La base de ce worktree porte les traces de mes parcours manuels** (un compte `…@guest.local`, une ligne promue, un achat payé). Elle est locale au worktree ; aucun fichier suivi n'a été modifié (`git diff --exit-code` propre, `git status` vide).

## Verdict

Le cœur de la story tient. Les trois interdits qui pouvaient couler ce diff — pas de session depuis la page de retour, pas de lien de mot de passe vers un compte existant, pas de périmètre invité dans le cœur — sont tenus **et** mesurés par mutation, chacune posée à son propre site. La garantie d'ordre de l'ADR 034 survit intacte, et je l'ai vérifiée en lisant `effectOf`, pas en croyant l'ADR 047. Le `scope_id` est un tirage CSPRNG, le filtre `scope_kind` mord aux deux étages, le rejeu est inerte, la migration est additive et rejouable, un seul commit porte recherche, plan et décision. Le rapport de l'implémenteur est honnête : ses deux mutations vertes déclarées sont exactes, et son tableau de mesures se reproduit à l'identique.

Ce qui reste est de la couverture, pas de la correction : la ligne d'`auth` la plus sensible du dépôt n'a aucun test et laisse un piège pour la story qui montera un greffon de plus (F1) ; la moitié d'un critère d'acceptation — le paiement unique invité — n'a aucun filet, alors que je l'ai vue fonctionner à la main (F2) ; et la première route de paiement publique du dépôt n'a aucune borne de coût total, sur des lignes que rien n'effacera jamais (F3). Aucun critique : rien ne fuit, rien ne s'ouvre, rien ne se corrompt en silence.

## Reprise après revue (même branche, commit amendé `6bc521f`)

Les **trois majeurs** ont été refermés avant le ship, plus les cinq mineurs, bien
que le portail autorisât déjà l'expédition.

| Constat | Ce qui a été fait | Morsure |
|---|---|---|
| **F3** — coût total non borné | Second seau, **sans clé** (`maxGlobal: 50` par fenêtre de 10 min). Saturé, il ne refuse pas : il **dégrade** vers le comportement d'avant s24 — le déclencheur anonyme mène à la connexion — sans appeler le fournisseur ni écrire de ligne `billing_customer`. Deux décisions d'ordre, écrites et testées : le seau global est frappé **après** le refus par appelant et après l'offre inconnue (compter les refus donnerait à un seul appelant le pouvoir d'envoyer tout le monde à la connexion), et la destination est décidée au point de composition, `billing` ne connaissant pas `auth`. | **3 rouges** (neutralisation ; seau clé sur l'appelant, donc contournable ; refus comptés) |
| **F1** — la ligne d'`auth` sans filet | Cas neuf dans `tests/auth.test.ts` : inscription non vérifiée → connexion refusée 401 → lien de réinitialisation consommé → la même connexion ouvre une session. Le **piège latent** est écrit à deux endroits que le prochain agent lira : la table des **trois** appelants de `onPasswordReset` de `better-auth@1.7.2` en commentaire, et l'`AGENTS.md` d'`auth`, qui n'affirme plus que la vérification d'email n'appartient qu'à nous. | **1 rouge** — contre **0 sur 1745** |
| **F2** — paiement unique invité sans filet | `guestCompletion` gagne un mode `payment` ; le cas va jusqu'à `entitledOffers` sur le compte créé par le webhook, pas seulement jusqu'à la ligne promue. | **1 rouge** — contre 0 en unitaire **et** 0 en e2e |
| **F4** | Cas « second paiement dont la promotion était bloquée, événement rejoué → aucun troisième lien ». | **1 rouge** — contre 0 |
| **F5** | Le `return false` du journal est nommé comme une **économie**, pas comme la garantie ; la condition qui le rendrait porteur est écrite. Reste vert **délibérément**. | — |
| **F6** | `docs/security.md` §7 réécrit en **mesure datée** : la commande, 30 occurrences, 25 routes publiques déclarées balayées une par une dans un tableau — dont `POST /consent/decide` et `GET /demo-enabled/items` que la phrase omettait — plus « aucune commande ne tient cette table ». | — |
| **F7** | Les deux bandeaux deviennent conditionnels : ils n'affirment plus un état que l'écran n'a jamais lu. | — |
| **F8** | Commentaire seul : une seconde exception devra faire remplacer le motif `.handle(` par une reconnaissance de la répartition à ce qu'elle lit. | — |

### Contre-vérification indépendante (contexte principal)

Mutation de la ligne la plus sensible du diff — `await users.markEmailVerified(userId)`
supprimée à `auth-use-cases.ts:413` — reposée à la main : **rouge**
(« rend l'adresse vérifiée en consommant un lien de réinitialisation »), arbre
restauré et `git diff --exit-code` propre. Puis `pnpm typecheck` 24 tâches,
`pnpm lint` sans anomalie, `pnpm test` **1751 passés / 8 sautés**,
`pnpm test:e2e` **86 passés / 8 sautés**, contre une base réellement joignable.
Un seul commit sur la branche.

### Ce que la reprise n'a pas fermé, et pourquoi

- **La navigation navigateur du chemin dégradé n'est pas couverte.** Elle réemploie
  la branche `window.location.assign(body.url)` que l'e2e exerce déjà pour l'URL
  du fournisseur ; saturer un seau global de 50 dans un parcours Playwright aurait
  coûté cinquante ouvertures de tunnel réelles. Nommé plutôt que laissé implicite.
- **M9 reste vert délibérément** (F5) : l'inertie du rejeu est portée par le
  stockage, pas par l'ordre des instructions. C'est désormais écrit dans le code.
- Les huit points de la section *Not verified* ci-dessus restent ouverts — en
  particulier qu'**aucun appel réel à Stripe n'a jamais été fait**, et que la page
  hébergée doit être vue une fois pour confirmer qu'elle collecte bien une adresse,
  sans quoi `customer_details.email` revient `null` et aucun compte n'est créé.

Max severity: major
Ship allowed: yes
