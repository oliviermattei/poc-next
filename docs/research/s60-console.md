# Research — Story s60-console

> Vérifiée contre la branche par défaut au commit `cd8d762`, en lecture seule, dans le worktree `.worktrees/s60-console` (même commit).
> Rien n'a été exécuté : aucune base, aucun conteneur, aucun test. Tout ce qui suit vient de la lecture du code.

## The five structuring facts
1. **La console n'a pas de shell à elle aujourd'hui** : chaque écran `/admin/*` est rendu **dans** l'`AppShell` du layout racine (`apps/web/app/layout.tsx:96`). Le superadmin voit donc la barre latérale du produit (onze liens) **et**, dans le contenu, la navigation du back-office (`BackOfficeLayout`, `packages/modules/admin/src/presentation/back-office-screens.tsx:355`). Un « shell reconnaissable » (critère 4) suppose de **sortir `/console` de l'`AppShell`**. C'est le découpage en gabarits que s61 prévoit, tiré en avant. C'est le fait qui fait monter la complexité (voir plus bas).
2. **Les quatre lectures ont un total, mais pas le revenu** : comptes (`listAccounts` → `total`, `packages/modules/admin/src/application/ports.ts:243`), organisations (`total`, l. 332) et inscriptions (`total`, l. 532) oui. Le revenu récurrent, lui, est **une liste par devise** (`AdminRevenue.recurring: readonly AdminRecurringRevenue[]`, l. 419), plus un compte d'abonnements non valorisés (`recurringUnvalued`). La tuile « revenu récurrent estimé » affiche donc **un montant par devise**, jamais une somme.
3. **La garde des écrans n'est pas `asSuperadmin`** : elle passe par chaque lecture de `lib/admin.ts`, qui rend `{ ok: false, error: 'not_found' }` à un non-superadmin, puis la page appelle `notFound()` (`apps/web/app/admin/users/page.tsx`). `asSuperadmin` (`admin-routes.ts:182`) garde les routes d'**API**. Un tableau de bord qui fait quatre lectures fait donc quatre vérifications du rôle. Aucune lecture « est-ce un superadmin » n'est exposée aux écrans, en dehors de `platformRolesOf`.
4. **Un anonyme n'obtient pas un 404, mais une redirection vers la connexion** avec `next=/admin/users` (`apps/web/app/admin/users/page.tsx`, après le test `admin.available`). La console révèle donc son existence à un visiteur sans compte. Le critère 6 ne couvre que « un compte qui n'est pas superadmin » : ce comportement n'est ni exigé ni interdit (question ouverte 1).
5. **Le renommage touche quatre modules, huit pages et deux suites** : la valeur `'admin'` du type (`packages/core/src/module.ts:251`) ; quatre déclarations `surface: 'admin'` (`admin-routes.ts:537`, `organization-routes.ts:309`, `billing-routes.ts:328`, `marketing/src/module.ts:58`) ; quatre constantes `ADMIN_*_SCREEN_PATH` ; les six pages sous `apps/web/app/admin/` ; `apps/web/lib/back-office.ts:67` ; `tests/admin.test.ts` (dont l. 2975-3095, qui dérive la racine de `ADMIN_USERS_SCREEN_PATH`) ; `e2e/admin.spec.ts` (huit occurrences de `/admin/...`, dont sept `publicPath`). Les **routes d'API** du module s'écrivent aussi `/admin/...` (`admin-routes.ts:57-65`) mais sous le préfixe de montage `/api/modules/admin` : ce ne sont pas des écrans, elles ne bougent pas.

## Target story
Renommer la surface `admin` en `console`, servir les écrans sous `/console/*` (anciens chemins en 404, sans redirection), ouvrir `/console` sur un tableau de bord à quatre tuiles dérivées des modules actifs, lui donner un shell reconnaissable (titre « Console », badge, bannière de consentement), ne rendre aucun lien vers elle, et répondre 404 à tout compte non superadmin ou à toute session empruntée. Module `admin` coupé : 404 partout.

Critères (docs/stories.md, s60) :
1. La valeur `admin` n'existe plus, `surface: 'console'`, `pnpm typecheck` refuse l'ancienne.
2. Écrans sous `/console/*`, `/admin/*` en 404 sans redirection.
3. `/console` = tableau de bord : comptes, organisations, revenu récurrent estimé, inscriptions, chacun lié ; tuile absente si son module est coupé.
4. Shell reconnaissable (titre « Console », badge), composé du design system, avec la bannière et les scripts de consentement.
5. Aucun lien vers la console (application, site, plan de site, `robots.txt`).
6. Non-superadmin ou session empruntée : 404 sur `/console` et chaque écran.
7. Module `admin` coupé : `/console` en 404, `pnpm test:minimal-profile` vert.

## Current state of the code
- `apps/web/app/admin/{users,users/[id],organizations,organizations/[id],revenue,subscriptions}/page.tsx` : six pages. Chacune fait `if (!admin.available) notFound()`, puis `currentViewer()`. Un anonyme est redirigé vers `/sign-in?next=<chemin>`. Ensuite la lecture est faite avec `viewerId` : `not_found` donne `notFound()`, un autre échec `BackOfficeError`, sinon l'écran du module avec `navigation = backOfficeNavigation(session, intl, <chemin>)`.
- `apps/web/lib/back-office.ts` : `backOfficeNavigation` appelle `visibleNavigation(moduleRegistry, session, 'admin')` (l. 67) et marque l'entrée courante sur le chemin **interne**. `backOfficeLinks(listPath)` construit `detailPath` à partir de la constante.
- `apps/web/lib/admin.ts:492-555` : `AdminFeature` avec `accounts`, `account`, `organizations`, `organization`, `platformRolesOf`, `revenue`, `subscriptions`. Chaque lecture prend un `viewerId` et des `parameters` bruts, parsés par le module (`parseBackOfficeQuery`…). Module coupé : `ABSENT` = `{ ok: false, error: 'not_found' }`.
- `packages/modules/admin/src/presentation/back-office-screens.tsx` : `BackOfficeLayout` (l. 355) reçoit `navigation` et `navigationLabel = intl.t(K.breadcrumbRoot)`. La clé vaut « Administration » (`messages/fr.json:17`). Les en-têtes de commentaire nomment les chemins `/admin/...` (l. 402, 490, 633, 738, 933, 1261).
- `apps/web/app/layout.tsx:96` : `<AppShell nonce={nonce}>{children}</AppShell>` entoure **toutes** les pages. L'`AppShell` porte la bannière et les scripts de consentement, et le bandeau d'emprunt.
- `apps/web/lib/auth.ts:123` : `platformRolesOf` alimente `ModuleSession.roles` depuis la table du module `admin` (s56). Le rôle `superadmin` est donc visible des gardes de niveau `role`.
- `apps/web/lib/organizations.ts:210` : `'admin'` figure en dur dans `APPLICATION_SEGMENTS`. `reservedSlugs` (l. 284) ajoute les premiers segments des `href` de navigation.
- `apps/web/app/robots.ts` : `disallow` vient d'une politique, et aucune ligne ne nomme `admin`. Rien à retirer pour le critère 5, mais rien à ajouter non plus (ajouter `/console` à `disallow` **divulguerait** la console).

## Anchor points
- `packages/core/src/module.ts:251` : `NavigationSurface`.
- Les quatre déclarations d'entrée `surface: 'admin'` (fait 5) et les quatre constantes de chemin, exportées par les barils des modules (`packages/modules/{admin,billing,marketing,organizations}/src/index.ts`).
- `apps/web/app/admin/` → `apps/web/app/console/`, plus une nouvelle `apps/web/app/console/page.tsx` (tableau de bord).
- `apps/web/lib/back-office.ts:67` : la surface lue.
- `apps/web/app/layout.tsx:96` : l'endroit où la console doit échapper à l'`AppShell`.
- `packages/modules/admin/src/messages/{fr,en}.json` : `breadcrumb.root` (« Administration ») et les libellés du shell.
- Un nouvel ADR (le prochain numéro est **070**) qui renomme la valeur de surface sans réécrire 066/067.

## Verified APIs / functions
- `visibleNavigation(registry, session, surface?)`, `@repo/core`, appelé avec une surface en `back-office.ts:67` et `tests/admin.test.ts:3088`.
- `admin.accounts / organizations / revenue / subscriptions({ viewerId, parameters })` → `Promise<BackOfficeView<…>>`, `apps/web/lib/admin.ts:511-554`.
- `AdminAccountsPort.listAccounts(...)` → `{ ok: true, accounts, total }` (`ports.ts:238-243`).
- `AdminOrganizationsPort.listOrganizations(...)` → `{ ok: true, organizations, total }` (l. 321-333).
- `AdminRevenue` : `recurring: AdminRecurringRevenue[]` (`{ currency, amount, subscriptions }`), `recurringUnvalued`, `oneTime`, `oneTimeUnvalued` (l. 405-420).
- `listSubscriptions(...)` → `{ ok: true, subscriptions, total }` (l. 523-533).
- `asSuperadmin`, `admin-routes.ts:182` : garde des routes d'API, refuse l'emprunt avant le rôle.
- `ADMIN_USERS_SCREEN_PATH` (`admin-routes.ts:513`), `ADMIN_ORGANIZATIONS_SCREEN_PATH` (`organization-routes.ts:74`), `ADMIN_REVENUE_SCREEN_PATH` (`billing-routes.ts:60`), `ADMIN_SUBSCRIPTIONS_SCREEN_PATH` (`public-form-routes.ts:41`).
- `admin.available` : donnée lue dans le registre (`lib/admin.ts`, `mounted`).

## Traps & constraints
- **Sortir de l'`AppShell` sans perdre le consentement** : la bannière et `ConsentScripts` (nonce) sont dans l'`AppShell`. Le shell de console doit les rendre lui-même (critère 4), et `ConsentScripts` a besoin du nonce lu dans le layout racine.
- **Groupes de routes** : si la sortie de l'`AppShell` passe par un groupe (`(app)`, `(console)`…), `e2e/support/warm-up.ts:65-68` lève sur tout segment `(`/`@` et fait échouer **tout** Playwright tant qu'il n'est pas traduit ; `tests/rendered-text.test.ts` demande aussi une mise à jour. Même piège que dans s61.
- **Tuiles dérivées, pas écrites** : « une tuile dont le module est coupé n'est pas rendue » se dérive des entrées `surface: 'console'` visibles (quatre modules, chacune disparaît avec son module), comme la navigation. Écrire `if (billing.available)` violerait la règle « aucun nom de module » que `pnpm test:minimal-profile` suppose.
- **Revenu multi-devise** (fait 2) : une somme toutes devises confondues serait fausse, et s38 l'a déjà refusée (« jamais un total qui les additionne »).
- **Coût des lectures** : chaque lecture de liste charge aussi sa première page. Quatre lectures pour quatre nombres, c'est acceptable à cette échelle, mais c'est à trancher au plan (question ouverte 2).
- **`tests/admin.test.ts:3060-3095`** dérive la racine du back-office de `ADMIN_USERS_SCREEN_PATH` et exige qu'aucune adresse sous cette racine n'atteigne la navigation du produit. Il suivra le renommage de lui-même, mais la page `/console` du tableau de bord doit aussi rester hors de la surface `app`.
- **`tests/admin.test.ts:1829`** : une route d'API redirige vers l'écran de détail (`/admin/users/<id>`) après une action. Les redirections des routes d'API vers les écrans suivent donc la constante, et tout chemin écrit en dur casserait ici.
- **`APPLICATION_SEGMENTS`** : retirer `'admin'` à la main (l. 210) et laisser `console` venir du `href`. `tests/organizations.test.ts` dérive les segments du disque et rougit si `console` n'est pas réservé.
- **`pnpm test:minimal-profile`** balaie les routes et entrées des modules coupés (`scripts/minimal-profile-rules.ts:201`) et suit les redirections. Une page `/console` qui redirige vers la connexion quand `admin` est coupé serait lue comme un 200 : le test `admin.available` doit précéder la session, comme aujourd'hui.
- **Commentaires d'en-tête** : `back-office-screens.tsx`, `lib/marketing.ts:81` et `marketing/src/schema.ts:123` nomment `/admin/...`. Documentation seulement, mais un `grep` de revue les trouvera.
- **Docs à suivre** : `AGENTS.md` racine (section rate limiting et vocabulaire back-office), `apps/web/AGENTS.md` et `packages/modules/admin/AGENTS.md` (« aucune route de back-office », table des invariants), `docs/architecture.md` (« back-office superadmin (s37) »).

## Open questions
1. **Anonyme sur `/console`** : on garde la redirection vers la connexion (qui révèle l'existence de la console), ou on répond 404 comme à un non-superadmin ? Le 404 est cohérent avec « aucune redirection ne révèle la console » (critère 2 et s64). Mais le superadmin doit alors se connecter d'abord, puis taper l'URL. À trancher au plan, ou par le porteur.
2. **Nombres du tableau de bord** : réutiliser les quatre lectures de liste (avec leur première page), ou ajouter aux ports une lecture de total seul ? La story autorise la seconde (« le plan l'ajoute au port existant »).
3. **Sortie de l'`AppShell`** : faut-il un groupe de routes (et payer le piège Playwright maintenant), ou un gabarit racine qui ne rend l'`AppShell` que hors `/console` ? La seconde voie décide sur un chemin, ce que s61 remplacera. Le choix conditionne s61.
4. **Emplacement des composants du shell de console** : dans `@repo/module-admin/presentation` (comme `BackOfficeLayout`) ou dans `apps/web` ? Le badge et le titre ne dépendent que du module `admin`, mais la bannière de consentement vient de `consent`.
5. **Le lien « retour à l'application »** depuis la console n'est pas demandé. Un superadmin qui veut utiliser le produit retape l'URL. C'est volontaire (aucun lien dans l'autre sens non plus), mais non écrit.

## Real complexity
La story est cotée **3** dans `docs/stories.md`. Verdict après lecture : **4**.
Le renommage et le tableau de bord sont bien du 3 : mécanique répartie sur quatre modules, plus quatre lectures qui existent déjà. Ce qui ajoute un cran, c'est le fait 1 : la console vit dans l'`AppShell` racine. Lui donner un shell propre oblige à toucher le layout racine, à reporter la bannière de consentement et son nonce, et probablement à payer le piège des groupes de routes dans Playwright. Le tout sans casser les autres écrans, et avant que s61 ne pose les gabarits de zone. Ce n'est pas un 5 : aucun système externe, aucune migration, aucune donnée nouvelle.

## Split proposal
Facultatif avec un verdict de 4. Une coupe possible, si le plan juge le shell trop lourd :
- **s60a** : renommage (`console`, `/console/*`, anciens chemins en 404), ADR, tableau de bord `/console`, tuiles dérivées, 404 aux non-superadmins. Le shell reste l'`AppShell`, avec un titre et un badge dans le contenu. Se clôt seule : la console est nommée et a une porte d'entrée.
- **s60b** : sortie de la console de l'`AppShell`, avec shell propre et consentement reporté. Se fond naturellement dans s61, qui pose déjà les gabarits de zone.
