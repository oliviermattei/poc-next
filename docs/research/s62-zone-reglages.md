# Research — Story s62-zone-reglages

> Vérifiée contre la branche par défaut au commit `7c5b33c` (s61 mergée), en lecture seule (sous-agent de lecture, chaque fichier ouvert). Rien n'a été exécuté.

## The five structuring facts
1. **Verdict de complexité : 5.** La story regroupe trois chantiers distincts — une nouvelle zone et sa surface, le **déplacement** de quatre écrans avec redirections et liens, et le **redécoupage** du contenu de deux écrans (onze cartes de `/account`, six de `/organizations`) plus la barre du haut. Chacun seul est un 3.
2. **Aucune infrastructure de redirection n'existe** : pas de `redirects()` dans `next.config.ts`, aucun `308` ni `permanentRedirect` dans `apps` ou `packages`. `apps/web/proxy.ts:57-151` ne sait que la redirection canonique de langue (307 par défaut, l. 87-95) et la réécriture interne. La table des anciens chemins est à construire, et son ordre avec le préfixe de langue est un piège (l'URL `/fr/account` doit être ramenée à `/account` avant la recherche, puis re-préfixée).
3. **Les chemins sont écrits en dur partout** : `/account` n'a **aucune constante** (littéral `auth-routes.ts:1866`, `(app)/app/page.tsx:56`, `app-shell.tsx`, `console-shell.tsx:104`) ; les retours Stripe sont un **littéral** `${appUrl}/billing${query}` (`billing-use-cases.ts:616`, utilisé l. 1004-1005 et 1059) et non `BILLING_SCREEN_PATH` ; `guest-account.ts:154` a `'/billing'` en dur. Côté tests : 39 assertions `${APP_URL}/organizations` dans `tests/organizations.test.ts`, ~30 occurrences dans `e2e/organizations.spec.ts`, 14 dans `e2e/billing.spec.ts`, ~40 sur `/account` réparties dans 15 specs e2e, le parcours doré (`golden-path.spec.ts:263, 277, 302, 308, 360, 366`).
4. **Le redécoupage de contenu est réel** :
   - `/account` (`(app)/account/page.tsx`, lectures l. 82-122) rend, dans l'ordre : en-tête + déconnexion, avatar (s18, si `storage.available`), nom, email, mot de passe, connexions OAuth, passkeys, 2FA, cookies (`ConsentSettingsCard`, s36), sessions, export RGPD, suppression (s34b). Profil / Sécurité / Cookies sont à redistribuer.
   - `/organizations` → `OrganizationsScreen` (`packages/modules/organizations/src/presentation/organizations-screen.tsx`) : organisation courante avec `OrgSwitcher` (401-420), membres (202-270), invitations (273-350), renommage (455), suppression (501-510), création (535-543). Organisation / Membres sont à séparer.
   - Les **préférences de notification** ne sont pas un écran : une carte `#notification-preferences` dans `NotificationsScreen` (`notifications-screen.tsx:84, 124-160, 238-251`), à côté du centre de notifications ; toutes les écritures répondent 303 vers `NOTIFICATIONS_SCREEN_PATH` (`notification-routes.ts:87-91`).
5. **La barre du haut n'a pas de sélecteur d'organisation** : `OrgSwitcher` n'est rendu que dans `organizations-screen.tsx:407`, et le changement d'organisation ne se fait que sur `/organizations` (route `switch`, `organization-routes.ts:256`, 303 vers l'écran). La cloche existe déjà (`app-shell.tsx:143-163`), le menu de compte a un seul lien « Réglages » vers `/account` (`account-menu.tsx:81-86`).

## Target story
Voir `docs/stories.md`, s62 (sept critères) : zone `/app/settings` avec sa surface `settings` ; contenu de `/account`, `/organizations`, `/billing` et des préférences servi sans perte sous `/app/settings/*` ; barre du haut avec sélecteur d'organisation, cloche et menu de compte ; barre latérale de `/app` vidée de ces entrées ; anciens chemins en 308 par une table unique ; liens de retour Stripe et d'emails à jour ; modules coupés et recettes vertes.

## Current state of the code
- **Écrans et propriétaires** : `/account` (auth, pas de constante), `/organizations` (`ORGANIZATIONS_SCREEN_PATH`, `organization-routes.ts:66`), `/billing` (`BILLING_SCREEN_PATH`, `billing-routes.ts:40`), `/notifications` (`NOTIFICATIONS_SCREEN_PATH`, `notifications/src/domain/notification.ts:15`). Re-exportés par `apps/web/lib/{organizations,billing,notifications}.ts`.
- **Entrées de navigation** (toutes `authenticated`, surface `app` par défaut) : auth `account` (`auth-routes.ts:1864-1870`), organizations (`organization-routes.ts:286-292`), billing (`billing-routes.ts:304-310`), notifications (`notification-routes.ts:274-280`).
- **Surfaces** : `NavigationSurface = 'app' | 'footer' | 'console' | 'site'` (`packages/core/src/module.ts:258`) ; pas de `settings`.
- **Emails** : aucun lien vers ces quatre écrans (`packages/emails/src`, `config/notifications.ts`). L'invitation vise `INVITATION_SCREEN_PATH`, hors zone, inchangé.
- **Redirections 303 des routes vers leur écran** : organisations `backToScreen` (`organization-routes.ts:136`), acceptation d'invitation → `/organizations` (l. 170), notifications (`notification-routes.ts:90`).
- **Segments réservés** : `APPLICATION_SEGMENTS` (`apps/web/lib/organizations.ts:194-283`) contient déjà `account`, `billing`, `notifications`, `organizations` ; `tests/organizations.test.ts:2390-2446` dérive les dossiers du disque (en traversant les groupes).
- **La « fixture figée de l'inventaire s61 »** citée par le critère 5 **n'existe pas** : à créer.

## Anchor points
- `packages/core/src/module.ts:258` : ajout de `'settings'`.
- `apps/web/app/(app)/app/settings/` : layout de la zone et ses pages.
- `apps/web/proxy.ts` : la table des 308, avant ou après `internalPath` selon la langue.
- `billing-use-cases.ts:616` : le retour Stripe passe par la constante.
- `apps/web/app/app-shell.tsx:111-173` et `account-menu.tsx:81-86` : barre du haut.
- `e2e/support/locale.ts` (`signedInLanding`, `sitePage`) : le bon endroit pour dériver les nouveaux chemins une fois.

## Verified APIs / functions
- `NextResponse.redirect(url, 308)` disponible ; `withSecurityHeaders` enveloppe les réponses du proxy.
- `SidebarNav` / `SidebarItem {id, href, label}` (`packages/ui/src/composed/sidebar.tsx:15-29`) pour une sous-navigation ; **`Tabs` absent** de `packages/ui` (lacune déjà écrite, `docs/design-system.md:197-199`).
- `OrgSwitcher` exporté (`packages/ui/src/index.ts:98-100`), une seule utilisation.
- `visibleNavigation(registry, session, surface)` accepte déjà une surface arbitraire du type.

## Traps & constraints
- **Minimal profile** : `e2e/minimal-profile/minimal-profile.spec.ts:80-117` compare chaque surface rendue aux entrées déclarées — la surface `settings` y sera soumise automatiquement.
- **Deux sessions et un compte qui change d'organisation** : un sélecteur d'organisation dans la barre du haut poste vers `switch`, qui répond 303 vers `/organizations` — à rediriger vers l'écran courant ou vers `/app`.
- **Les redirections 308 et `?next=`** : les pages redirigent un anonyme vers `/sign-in?next=/account` ; après s62 le `next` doit viser le nouveau chemin, sinon l'utilisateur fait un 308 de plus (inoffensif, mais à dire).
- **Le centre de notifications** reste à `/notifications` jusqu'à s63 ; s62 n'en extrait que les préférences.
- **Base partagée** entre worktrees parallèles : ne pas jouer deux suites e2e complètes en même temps.

## Open questions
1. Profil et Sécurité : où vont connexions OAuth, passkeys, sessions, export et suppression ? Proposition : Profil = avatar, nom, email ; Sécurité = mot de passe, connexions, passkeys, 2FA, sessions ; Données = export et suppression (ou sous Profil). À trancher au design.
2. Une zone Réglages sans organisation (module coupé) : la sous-navigation garde Profil, Sécurité, Notifications, Cookies ; à confirmer au design.

## Real complexity
Cotée **4** ; verdict après lecture : **5**. Trois chantiers indépendants (fait 1), une infrastructure de redirection à créer (fait 2), plus de 150 références écrites en dur à migrer (fait 3), et un redécoupage d'écrans appartenant à trois modules (fait 4).

## Split proposal
Trois tranches, dans l'ordre :
- **s62a-reglages-deplacement — la zone et les chemins.** Surface `settings`, layout `/app/settings` avec sa sous-navigation, les quatre écrans **déplacés tels quels** (`/app/settings/account`, `/organization`, `/billing`, et les préférences restent dans le centre de notifications jusqu'à s62c), la table des 308 dans `proxy.ts` avec sa fixture figée, la constante `/account`, les retours Stripe et le repli du guest checkout sur les constantes, la migration des chemins dans les tests. La barre latérale de `/app` perd ces entrées ; le menu de compte pointe vers la zone. Se clôt seule : chaque réglage a une adresse sous `/app/settings`.
- **s62b-reglages-decoupage — le contenu.** `/account` redistribué en Profil / Sécurité / Cookies (+ Données selon le design), `/organizations` en Organisation / Membres, sans perte de carte (un test retrouve chaque carte). Se clôt seule : la zone a la navigation de la story.
- **s62c-barre-du-haut — sélecteur, cloche, préférences.** `OrgSwitcher` dans la barre du haut (redirection du `switch` vers l'écran courant), préférences de notification extraites vers `/app/settings/notifications`, comportements modules coupés. Se clôt seule.
