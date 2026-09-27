# Research — Story s61-site-et-application

> Vérifiée contre la branche par défaut au commit `3bddc75`, en lecture seule (sous-agent de lecture, chaque fichier ouvert). s66 (frontières 404 par zone) est en revue sur sa branche et n'est pas encore sur `dev` : ses quatre `not-found.tsx` de zone ne sont pas comptés ici.
> Rien n'a été exécuté : aucune base, aucun serveur.

## The five structuring facts
1. **Prémisse à corriger dans la story** : ses notes nomment `apps/web/app/page.tsx` ; depuis s60 l'accueil est `apps/web/app/(site)/page.tsx`. Les trois layouts `(site)/layout.tsx:17-21`, `(auth)/layout.tsx:17-21`, `(app)/layout.tsx:16-20` sont **identiques** (`<AppShell nonce>`) : s61 n'a rien à déplacer, seulement trois layouts à différencier — ce que s60 a préparé.
2. **Le tableau de bord n'existe pas comme écran** : pour un connecté, `(site)/page.tsx:86-103` rend en ligne un `PageHeader` + `EmptyState` (`app.dashboard.*`) et un bouton vers `/account`. `/app` est donc une **nouvelle page** qui reprend ce contenu, pas un déplacement de composant.
3. **La destination après connexion a sept repli `'/'` et un `'/account'`** : `(auth)/sign-in/page.tsx:58` (qui alimente passkey l. 122, formulaire l. 145, magic link l. 173), `:69` (2FA), `:126` (OAuth), `(auth)/two-factor/page.tsx:42`, `(auth)/oauth/return/page.tsx:31`, `auth-routes.ts:370` et le `: '/'` nu de `:371` (2FA d'origine étrangère), `auth-routes.ts:646` (départ OAuth) ; `auth-routes.ts:899` a pour repli **`'/account'`** (route magic link sans `callbackURL` — la page de connexion en envoie toujours un). Et **le parcours d'intégration se termine sur `/`** : `(app)/onboarding/page.tsx:70-71` (`redirect(path('/'))`).
4. **Le changement d'atterrissage casse beaucoup de parcours écrits en dur** : au moins 11 fichiers e2e attendent `/` après connexion ou y cherchent le tableau de bord (`app-shell`, `auth`, `oauth`, `two-factor`, `passkeys`, `organizations`, `onboarding`, `minimal-profile`, `support/account.ts:288`, `golden-path` l. 155-156, 315-316, 326, 329), et au moins 7 affirment des liens du site **dans la barre latérale** (`app-shell.spec.ts:108` « Connexion », `modules.spec.ts:96-104` qui compare la barre latérale à `visibleNavigation(registry, null)`, `billing.spec.ts:329-336` « Tarifs », `marketing.spec.ts:330-346`, `auth.spec.ts:212`, `minimal-profile.spec.ts:65`, `admin.spec.ts:673`). Le parcours doré dérive déjà son atterrissage (`e2e/support/locale.ts:94-95`, `signedInLanding`) : c'est le bon point à changer, une fois.
5. **Aucun en-tête de site n'existe** : ni composant, ni `NavigationMenu` dans `packages/ui`. Le pied de page existe (`MarketingFooter`, `packages/modules/marketing/src/presentation/marketing-footer.tsx:62`) mais **chaque page le rend elle-même** (`publicFooterLinks`, `apps/web/lib/footer.ts:29-56`, appelé par l'accueil, le blog, la liste d'attente, le contact, le changelog, les docs, les pages légales). L'en-tête est donc un **écran à concevoir** (`/ks-design`), composé de `Button`, `Sheet`, `DropdownMenu`, `LocaleSwitcher`, `ThemeToggle` (`packages/ui/src/index.ts`), sur le modèle de `MobileNavigation` (`app/app-navigation.tsx:47-79`).

## Target story
Voir `docs/stories.md`, s61 (dix critères) : surface `site` (accueil, blog, docs, tarifs) rendue dans un en-tête ; entrée `/sign-in` retirée ; chaque zone avec son gabarit (partition de la story) ; en-tête toujours présent sur la zone Site, avec un bouton de gabarit « Se connecter » / « Ouvrir l'application » ; consentement, langue, thème et bandeau d'emprunt dans les gabarits Site, Hors zone, Application ; exception du bouton écrite dans `apps/web/AGENTS.md` ; `/` toujours le site ; `/app` tableau de bord ; destination par défaut `/app` sur chaque parcours ; connecté sur `/sign-in`/`/sign-up` → `?next=` filtré ou `/app` ; barre latérale réservée à la surface `app`.

## Current state of the code
- **Layout racine** `apps/web/app/layout.tsx:67-104` : `<html>`, polices, `InlineStyleNonce`, `NextIntlClientProvider`, `ThemeProvider nonce`, `{children}` — plus de shell.
- **`AppShell`** (`apps/web/app/app-shell.tsx`) lit : `currentViewer()` (l. 58), `appIntl()` (59), `shellNavigation(…)` → `visibleNavigation` surface `app` (61), `localeOptions` (62), avatar `storage.avatarOf` si compte (67, **lecture base**), `notifications.unreadCount` si session (87, **lecture base**), `currentConsent()` (93, cookie), `currentImpersonation` (108). Rend : `Sidebar` + `SidebarBrand` (lien `/`, l. 113-118), `DesktopNavigation` (119), en-tête avec `MobileNavigation` (124-130), `LocaleSwitcher` si plusieurs langues (140-146), `ThemeToggle` (147-154), cloche (155-175), `AccountMenu` (176-184), `main` avec `pb-64 md:pb-36` si bannière (199-203), `ImpersonationBanner` (212-241), `ConsentBanner` (256), `ConsentScripts nonce` (257). **`OrgSwitcher` n'est rendu nulle part** dans `apps/web` (exporté par `@repo/ui`, l. 97-101).
- **`(console)/layout.tsx:31-49`** : garde puis `ConsoleShell`, qui rend lui aussi langue, thème et consentement.
- **Surfaces** : `NavigationSurface = 'app' | 'footer' | 'console'` (`packages/core/src/module.ts:256`) ; `visibleNavigation(registry, session, surface = 'app')` (`packages/core/src/protection.ts:92-100`) ; une entrée sans surface est en `app` (`navigationSurfaceOf`, l. 109-111).
- **Entrées qui passent en `site`** : marketing `home` `/` (`marketing/src/module.ts:32`), blog `index` (`blog/src/module.ts:23`), docs `index` (`docs/src/module.ts:22`), billing `pricing` (`billing-routes.ts:297`). **À retirer** : auth `sign-in` (`auth-routes.ts:1859-1864`).
- **Connecté sur `/sign-in` ou `/sign-up`** : aucune des deux pages n'appelle `currentViewer` ni `redirect` ; `proxy.ts` non plus. Le formulaire est servi.

## Anchor points
- `apps/web/app/(site)/layout.tsx`, `(auth)/layout.tsx`, `(app)/layout.tsx` : les trois gabarits.
- `packages/core/src/module.ts:256` : `'site'` ajouté au type.
- Les quatre déclarations d'entrée ci-dessus et `auth-routes.ts:1859`.
- `apps/web/app/(site)/page.tsx:62-121` : branche connectée → rend le site ; site coupé → connecté vers `/app`.
- `apps/web/app/(app)/page.tsx` (nouveau, sous `(app)` : `/app` n'est pas un dossier existant — **attention** : une page `(app)/page.tsx` servirait `/`, en conflit avec `(site)/page.tsx`. Il faut un dossier `(app)/app/page.tsx`).
- Les huit points de repli de la destination, plus `(app)/onboarding/page.tsx:70-71`.
- `(auth)/sign-in/page.tsx`, `(auth)/sign-up/page.tsx` : redirection d'un connecté.
- `e2e/support/locale.ts:94-95` (`signedInLanding`) et `e2e/support/account.ts:288`.
- `apps/web/AGENTS.md:165-168` : la règle « aucune entrée de navigation écrite à la main », où l'exception du bouton s'écrit.

## Verified APIs / functions
- `visibleNavigation(registry, session, surface?)`, `packages/core/src/protection.ts:92`.
- `safeRedirectPath(candidate, fallback)`, `packages/modules/auth/src/domain/redirect.ts:17-29` : vide ou non-chaîne → repli ; `\` → `/` ; ne commence pas par `/`, ou commence par `//` → repli.
- `publicFooterLinks(t)`, `apps/web/lib/footer.ts:55-56`.
- `MobileNavigation`, `DesktopNavigation`, `app/app-navigation.tsx`.
- `signedInLanding()`, `anonymousLanding()`, `e2e/support/locale.ts:52-53, 94-95`.
- `localeOptions(...)` : lien de chaque langue vers `publicPath('/', candidate)` (`lib/navigation.ts:73-79`) — le sélecteur ramène à `/`.

## Traps & constraints
- **`/app` et le dossier `(app)`** : un dossier de groupe n'est pas un segment. `/app` exige `apps/web/app/(app)/app/page.tsx`. `tests/zones.test.ts` dérive les pages du disque ; `apps/web/lib/organizations.ts` (`APPLICATION_SEGMENTS`) doit réserver `app` (sinon une organisation pourrait s'appeler `app`).
- **Coût en requêtes** : `tests/marketing.test.ts` l. 1135 (« n'émet aucune requête base de données ») rend le site anonyme et compte les connexions ; l. 1185 et 1256 comptent celles d'un connecté. Un en-tête de site qui choisit son bouton selon la session lit `currentViewer()` : pour un anonyme sans cookie cela ne doit ouvrir aucune connexion (à mesurer), et l'en-tête **ne** doit **pas** hériter des lectures avatar et notifications de l'`AppShell`.
- **`tests/rendered-text.test.ts:2064`** enveloppe chaque écran dans l'`AppShell` ; avec trois gabarits, l'enveloppe doit suivre la zone de l'écran. Le cas « accueil connecté » (l. 1179-1185) change de sens.
- **Pied de page rendu par les pages** : garder ce découpage (le critère 3 ne parle que de l'en-tête) ; ne pas dupliquer `MarketingFooter` dans le gabarit, ou les pages qui le rendent l'afficheraient deux fois — le même piège que s66.
- **Sélecteur de langue** : il ramène à `/` (`lib/navigation.ts:78`) ; depuis l'application, un changement de langue enverrait sur le **site**. Constat, pas un critère de s61 — à signaler au plan.
- **`guest-account.ts:154`** (`callbackPath ?? '/billing'`) : écran de l'application, concerne s62, pas s61.
- **`modules.spec.ts:96-104`** compare la barre latérale à `visibleNavigation(registry, null)` : il devient la preuve du critère « barre latérale = surface `app` seule », à réécrire plutôt qu'à supprimer.

## Open questions
1. **Forme de l'en-tête** (sous 768 px surtout) : `Sheet` comme l'application, ou liens défilants ? C'est la question de `/ks-design`.
2. **L'accueil `/` pour un connecté** montre-t-il un rappel (« Ouvrir l'application ») dans le contenu, ou seulement le bouton de l'en-tête ? La story ne dit que le bouton.
3. **Le cas « site coupé » et l'en-tête** : si aucune section d'accueil n'est configurée, `/` redirige ; les autres pages du site gardent l'en-tête (critère 3). Rien à trancher, mais à tester dans la configuration qui coupe `marketing` (`socle`).

## Real complexity
Cotée **3** ; verdict après lecture : **4**. Le code à écrire est modeste (trois gabarits, un en-tête, une page `/app`, une constante de destination, deux redirections). Ce qui fait monter la cote, c'est la **surface de tests écrits en dur** : au moins onze fichiers e2e attendent `/` comme atterrissage et sept affirment des liens du site dans la barre latérale (fait 4), plus trois tests unitaires qui comptent les requêtes du shell. Ce n'est pas un 5 : aucun système externe, aucune donnée.

## Split proposal
Facultatif avec un 4. Une coupe nette si le plan dépasse dix tâches :
- **s61a — gabarits de zone** : surface `site`, en-tête de site avec son bouton, gabarit Hors zone, barre latérale réservée à `app` (critères 1, 2, 3, 4, 5, 6, 10). Se clôt seule : le site et l'application ont chacun leur navigation ; l'atterrissage reste `/`.
- **s61b — atterrissage `/app`** : page `/app`, destination par défaut sur les huit points de repli et la fin d'intégration, `/` toujours le site, connecté sur `/sign-in` (critères 7, 8, 9 et la moitié « connecté » de 7). C'est elle qui paie la réécriture des parcours e2e.
