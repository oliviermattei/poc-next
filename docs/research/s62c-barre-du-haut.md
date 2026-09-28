# Research — Story s62c-barre-du-haut

> Vérifiée contre la branche par défaut au commit `6659244` (s62a, s62b, s67, s68 mergées), en lecture seule, dans `.worktrees/s62c-barre-du-haut`. Aucune base, aucun serveur.

## The five structuring facts
1. **Le critère 2 heurte une règle de sécurité écrite** : la route `switch` (`organization-routes.ts:45`, enregistrée :285-289) revient **toujours** sur `ORGANIZATIONS_SCREEN_PATH`, et le code l'assume (« une constante, jamais un paramètre », commentaires :173-177, :210, `docs/security.md` §4). « Revenir sur l'écran courant » impose un `next` : il doit passer par `safeRedirectPath` (`packages/modules/auth/src/domain/redirect.ts:66`, durci en s67 contre les segments `.`/`..` et les caractères de contrôle), avec repli sur la constante actuelle. C'est la décision centrale du plan, à écrire dans un ADR.
2. **Aucune lecture légère pour la barre du haut** : le shell ne connaît pas `organizations` (`app-shell.tsx` ne l'importe pas). `view(userId)` (`apps/web/lib/organizations.ts:87` → `viewOrganizations`, `organization-use-cases.ts:762-819`) lit membres et invitations : trop lourd pour chaque page. Il faut une lecture « appartenances + organisation active » (le dépôt a `listMemberships` et `findActiveOrganizationId`, `drizzle-organization-repositories.ts:214, 266`), qui rend un état vide **sans base** quand le module est coupé (comme `activeOrganizationId`, :168).
3. **Un test compte les requêtes du shell** : `tests/marketing.test.ts:1279` (« n'émet aucune requête propre pour un compte connecté ») ne moque que `lib/storage` et `unreadCount` ; `lib/organizations` n'y est pas moqué. Une nouvelle lecture dans le shell le fera rougir — à moquer comme `unreadCount`, avec sa propre preuve de coût.
4. **Les préférences ne sont pas un écran** : carte `#notification-preferences` dans `NotificationsScreen` (`notifications-screen.tsx:84, 238-256`, lien d'état vide :207) ; `setPreference` (`notification-routes.ts:228-260`) répond 303 vers `NOTIFICATIONS_SCREEN_PATH` (`/notifications`, `notification.ts:15`). Les extraire vers `/app/settings/notifications` change la cible de ce 303 et crée une entrée `settings` déclarée par `notifications`.
5. **Seule l'entrée `notifications` est à retirer de la barre latérale** (critère 4) : elle n'a pas de `surface` (`notification-routes.ts:273-281`, ordre 30) ; les autres entrées `app` sont celles de `demo-enabled` (`demo-item-routes.ts:170-205`). Le centre `/notifications` reste servi (`apps/web/app/(app)/notifications/page.tsx`) jusqu'à s63 ; il ne sera plus atteint que par la cloche.

## Target story
`docs/stories.md`, s62c (cinq critères) : barre du haut avec sélecteur d'organisation (absent si `organizations` coupé), cloche (absente si `notifications` coupé) et menu de compte ; changer d'organisation ramène sur l'écran courant ; préférences sous `/app/settings/notifications` ; barre latérale sans réglage ni notification ; `test:minimal-profile` et `test:socle` verts.
**Prémisse périmée** : la note de la story cite `organizations-screen.tsx:407` ; le sélecteur est désormais à la ligne 434 (`OrganizationScreen`, :395).

## Current state of the code
- **`AppShell`** (`apps/web/app/app-shell.tsx`) : lectures `currentViewer()` :58, avatar :67, `unreadCount` :87, `currentConsent()` :93 ; en-tête :111-174 → `MobileNavigation` :112, nom mobile :119, grappe `ml-auto` :127 : `LocaleSwitcher` :128-134, `ThemeToggle` :135-142, cloche :143-163 (`!notifications.available || account === null ? null`, lien vers `NOTIFICATIONS_SCREEN_PATH`, `Badge` si non-lus), `AccountMenu` :164-172.
- **`OrgSwitcher`** (`packages/ui/src/composed/org-switcher.tsx`, client) : props :39-60 (`label`, `current`, `currentValue`, `action`, `fieldName`, `options`) ; `<form method="post">` :85 ; repli `<noscript>` :101-117 ; menu Radix :118-155. Exporté `packages/ui/src/index.ts:98-100`. Une seule utilisation : `organizations-screen.tsx:434`.
- **Route `switch`** : corps `{ organizationId }` (`organization-use-cases.ts:177`, parsé :497-503), `switchOrganization` :643-653, `backToScreen` :146-168 (404/403, sinon 303 `new URL(screen, request.url)`).
- **Zone Réglages** (s62b) : profile 2, security 3, organization 20, members 25, billing 40, cookies 50 (tous `surface: 'settings'`) ; layout `apps/web/app/(app)/app/settings/layout.tsx:27-44`.
- **Table des anciens chemins** : `apps/web/lib/legacy-paths.ts:27-34` ; fixture `tests/fixtures/legacy-screen-paths.json` contient `/notifications`, qui doit rester servi ou redirigé.

## Anchor points
- `app-shell.tsx` :127 (grappe de droite) : sélecteur d'organisation avant la cloche.
- `apps/web/lib/organizations.ts` : nouvelle méthode de la feature (appartenances + active), état coupé sans base.
- `organization-routes.ts` : `switch` accepte un `next` filtré par `safeRedirectPath`.
- `notification-routes.ts:273-281` : entrée `notifications` → retrait de la surface `app` ; nouvelle entrée `settings` (préférences).
- `notifications-screen.tsx:238-256` : la carte des préférences part dans un écran `/app/settings/notifications` ; `setPreference` y revient.

## Verified APIs / functions
- `safeRedirectPath(candidate, fallback)` — `packages/modules/auth/src/domain/redirect.ts:66`, exporté `auth/src/index.ts:59` (le module `organizations` ne peut l'importer que si `auth` est un `requires` déclaré — il l'est déjà pour la clé étrangère des membres ; à vérifier au plan).
- `visibleNavigation(registry, session, surface)` ; `navigationSurfaceOf` défaut `'app'` (`packages/core/src/protection.ts:111`).
- `OrganizationsFeature` : `available` (:64/:412), `activeOrganizationId` (:85), `view` (:87).

## Traps & constraints
- **Deux sélecteurs sur la même page** : sur `/app/settings/organization`, la barre du haut **et** la carte « Organisation courante » rendent un `OrgSwitcher` ; `e2e/organizations.spec.ts` cherche les boutons par nom (:162, :169, :553, :557, :561) → ambiguïté (strict mode). Soit la carte perd son sélecteur, soit les tests se restreignent à une région nommée.
- **Retours attendus** : `e2e/organizations.spec.ts:168, :560` attendent `settingsPath('organization')` après un changement ; `organization-routes.test.ts:33` fige `switch → ORGANIZATIONS_SCREEN_PATH`. Le critère 2 les réécrit.
- **Notifications non couvertes en e2e** : aucune spec pour la cloche, le centre ou les préférences ; unitaires `tests/notifications.test.ts` (303 :581, :689 ; préférences :708 ; navigation :993, :1008-1013 ; ancre :1241).
- **Profils** : `config/profiles.ts:102-117` (minimal) coupe `organizations` **et** `notifications` ; `ci.yml:100-101` (socle) coupe `organizations`, garde `notifications`. Les deux états des deux éléments sont donc joués par les recettes.
- `tests/app-shell.test.ts:203-210` fige la liste des six rubriques `SETTINGS_SCREENS` (`toEqual` :246, :305) : la septième (Notifications) doit y entrer.

## Open questions
1. La carte « Organisation courante » garde-t-elle son sélecteur (doublon) ou devient-elle informative ? Au design.
2. Ordre de la rubrique Notifications dans la zone (entre Membres et Facturation, ou après Cookies) : au design.

## Real complexity
Cotée **3**, confirmée **3** : une lecture légère, un `next` filtré sur une route, une carte déplacée, une entrée de navigation retirée. Le risque est concentré sur la redirection (fait 1) et le coût du shell (fait 3).
