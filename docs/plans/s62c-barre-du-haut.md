---
validated: yes
---
# Plan — Story s62c-barre-du-haut

Branch: `feature/s62c-barre-du-haut`
Research: `docs/research/s62c-barre-du-haut.md` — read it first; this plan does not repeat it.
Design: `docs/designs/s62c-barre-du-haut/design.md` (écran dérivé, pas de maquette).
ADR: `docs/decisions/076-le-changement-d-organisation-revient-a-l-ecran-courant-filtre.md`.

## Target story
Tranche 3/3 de s62. Critères : (1) barre du haut = sélecteur d'organisation (absent sans `organizations`), cloche + compteur (absente sans `notifications`), menu de compte ; (2) changer d'organisation ramène sur l'écran courant ; (3) préférences de notification sous `/app/settings/notifications`, rubrique de la sous-navigation, le centre ne les porte plus ; (4) barre latérale sans réglage ni notification ; (5) `test:minimal-profile` et `test:socle` verts.

## Decisions (ne pas re-décider)
| Sujet | Décision |
|---|---|
| Retour du `switch` | Champ `next` du corps, **route `switch` seule**, filtré par `safeReturnPath(next, ORGANIZATIONS_SCREEN_PATH)` — **injecté** : nouvelle option obligatoire `safeReturnPath` de `ConfigureOrganizationsOptions`, exposée par `OrganizationsService`, fournie par `apps/web/lib/organizations.ts` = `safeRedirectPath` de `@repo/module-auth`. **Aucun import de `@repo/module-auth` dans `organization-routes.ts`** (lint `eslint.config.ts:500-536`, ADR 076). Refusé/absent → constante actuelle. Le refus (`?error=`) garde la constante. |
| Valeur de `next` | Chemin courant lu par `usePathname()` dans un composant client de `apps/web` ; **sans** chaîne de requête (pas de `useSearchParams`). |
| `OrgSwitcher` (`packages/ui`) | Une prop optionnelle `returnTo?: { name: string; value: string }` → `<input type="hidden">` dans le `<form>`. Aucune autre modification ; pas de nouveau composant `ui`. |
| Lecture pour la barre | Nouvelle méthode `switcher(userId)` sur `OrganizationsFeature` (`apps/web/lib/organizations.ts`) → `{ current: { id, name } \| null, options: { id, name }[] }`, adossée à un use case qui appelle `listMemberships` + `findActiveOrganizationId` (déjà au port). État coupé : `{ current: null, options: [] }` **sans base**. `view()` n'est pas appelée par le shell. |
| Rendu barre | `AppShell` : lecture seulement si `session !== null` ; sélecteur rendu si `options.length > 0`. Desktop : dans la grappe `:127`, **avant** `LocaleSwitcher`, `hidden md:block`. Mobile : dans le `Sheet` de `MobileNavigation` (nouvelle prop `header?: ReactNode`), au-dessus des entrées. |
| Libellé sans organisation courante | clé existante `K.switcherNone` du module (« Choisir… ») ; libellé du menu `K.switcherLabel`. Les clés sont exportées ou relues depuis le catalogue du module, jamais recopiées. |
| Carte « Organisation courante » | Perd son `OrgSwitcher` ; garde nom + `Badge` du rôle + une phrase (nouvelle clé fr/en) renvoyant à la barre du haut. |
| Rubrique Notifications | Constante `NOTIFICATIONS_SETTINGS_SCREEN_PATH = '/app/settings/notifications'` (domaine du module). Entrée de navigation `notifications-settings`, `surface: 'settings'`, **order 5**, `authenticated`. L'entrée `notifications` (sidebar, order 30) est **supprimée**. |
| Écran de la rubrique | `apps/web/app/(app)/app/settings/notifications/page.tsx`, calqué sur `cookies/page.tsx` : 404 si `!notifications.available`, anonyme → `/sign-in?next=`, `h2` + carte. La carte des préférences est extraite de `NotificationsScreen` en `NotificationPreferencesCard` (export `@repo/module-notifications/presentation`), rendue telle quelle. |
| Retour de `setPreference` | 303 vers `NOTIFICATIONS_SETTINGS_SCREEN_PATH` (constante). Les autres routes du module gardent `/notifications`. |
| Centre `/notifications` | Reste servi (s63 le déplacera) ; plus de carte ; le lien d'état vide (`#notification-preferences`, :207) pointe la rubrique. Aucune entrée dans `legacy-paths.ts`. |
| Cloche, menu de compte | Inchangés. |

## Tasks (ordered)
1. [x] **Route `switch` + `next` filtré.** `organizations-runtime.ts` : option obligatoire `safeReturnPath` + exposée par le service ; appels de `configureOrganizations` mis à jour (`apps/web/lib/organizations.ts`, `tests/{organizations,billing,account-deletion}.test.ts` — ceux des tests passent le vrai `safeRedirectPath`). `organization-routes.ts` : `submit` reçoit en option un résolveur de destination ; `switch` lit `next` du corps déjà parsé (`submittedBody`) et appelle `service().safeReturnPath`. Mettre à jour les commentaires « une constante, jamais un paramètre » (:173-177, :210) en citant ADR 076. Tests : `organization-routes.test.ts` (:33 réécrit).
2. [x] **`OrgSwitcher.returnTo`** (`packages/ui/src/composed/org-switcher.tsx`) : champ caché dans le `<form>` (hors `<noscript>`, pour servir les deux chemins). Vérif : typecheck + test ci-dessous (tâche 4).
3. [x] **Lecture `switcher(userId)`** : use case dans `organization-use-cases.ts`, exposé par `apps/web/lib/organizations.ts` (+ `ABSENT_ORGANIZATIONS`). Tests : `tests/organizations.test.ts`.
4. [x] **Barre du haut** : composant client `apps/web/app/shell-org-switcher.tsx` (`usePathname` → `returnTo: { name: 'next', value }`) ; `AppShell` lit `organizations.switcher` et le rend (desktop + prop `header` de `MobileNavigation`). Mettre à jour `tests/marketing.test.ts:1279` (moquer `switcher` comme `unreadCount`, anonyme → jamais appelé). Tests : `tests/app-shell.test.ts`.
5. [x] **Carte informative** dans `organizations-screen.tsx:425-450` ; clé de message fr/en du module.
6. [x] **Préférences extraites** : `NotificationPreferencesCard` (+ export presentation), `NotificationsScreen` sans carte, lien d'état vide vers la rubrique ; constante `NOTIFICATIONS_SETTINGS_SCREEN_PATH` ; `setPreference` → 303 rubrique. Tests : `tests/notifications.test.ts` (:581, :689, :1241 mis à jour).
7. [x] **Rubrique + navigation** : page `settings/notifications/page.tsx`, titre `app.settings.notifications.title` (fr/en), entrée `settings` order 5, suppression de l'entrée sidebar ; `SETTINGS_SCREENS` de `tests/app-shell.test.ts:203-210` passe à sept. Tests : `tests/notifications.test.ts` (:993, :1008-1013).
8. [x] **E2E** (écrits, joués au ship) : `e2e/organizations.spec.ts` — les recherches de boutons (:162, :169, :553, :557, :561) visent la barre du haut (région `banner`) ; attentes :168/:560 → l'écran courant ; un cas « depuis `/app`, changer → reste sur `/app` ». Nouveau cas dans une spec existante : rubrique Notifications, bascule d'une préférence, retour sur la rubrique.
9. [x] **Docs** : `docs/architecture.md` (rubriques des réglages, entrée sidebar retirée), `AGENTS.local.md` si une phrase nomme l'entrée Notifications de la barre latérale ; recette `pnpm ks list` inchangée.
10. [x] **Vérification** : `pnpm typecheck`, `pnpm lint`, `pnpm test` (une fois, en fin), `pnpm test:minimal-profile`, `pnpm test:socle` ; contrôle visuel navigateur (desktop + mobile, clair + sombre) : barre avec/sans organisation, `/app/settings/notifications`, sidebar. `docs/verif/s62c-barre-du-haut.md`.

## Run interdicts
- `eslint.config.ts` et `tests/lint-rules.test.ts` : diff vide (la frontière §7 ne bouge pas).
- `packages/modules/auth/src/domain/redirect.ts` : diff vide (on consomme le filtre, on ne le modifie pas).
- Aucune autre route d'`organizations` ni de `notifications` n'accepte de destination reçue (`grep -n "next" organization-routes.ts` ne montre que `switch`).
- `apps/web/lib/legacy-paths.ts` et `tests/fixtures/legacy-screen-paths.json` : diff vide (`/notifications` reste servi).
- Pas de nouveau composant dans `packages/ui` hors la prop `returnTo` ; aucun jeton ni classe de couleur nouveaux.
- Le shell n'appelle jamais `organizations.view()`.
- Pas de déplacement du centre `/notifications` (s63), pas de sélecteur dans la console.
- Aucun `if` nommant un module dans `app-shell.tsx` : la présence se lit dans `available`/`options`.

## The point everything turns on
Le `next` du `switch` est la seule redirection pilotée par le client ajoutée par cette story. Trois endroits où elle peut être fausse : (a) la route teste avec un double de `safeReturnPath` au lieu du vrai filtre — les cas `//evil.test` doivent tourner avec `safeRedirectPath` réel injecté ; (a') la route re-sérialise ou préfixe la valeur **après** le filtre (`new URL(next, request.url)` doit recevoir la sortie de `safeRedirectPath`, jamais l'entrée) — comparer avec l'usage dans `auth-routes.ts` ; (b) le refus (`status: 'refused'`) doit revenir sur la constante avec `?error=`, pas sur `next` ; (c) `usePathname()` derrière la réécriture de langue du proxy peut rendre le chemin interne — au navigateur, vérifier qu'en locale non par défaut le retour garde son préfixe (sinon le proxy canonise en 307, acceptable mais à constater). Second risque : le coût du shell (`marketing.test.ts:1279`) — la lecture doit être moquée **et** absente pour un anonyme.

## Files touched
`packages/modules/organizations/src/presentation/{organization-routes.ts,organizations-screen.tsx}`, `.../application/organization-use-cases.ts`, `.../messages/*`, `packages/ui/src/composed/org-switcher.tsx`, `apps/web/lib/organizations.ts`, `apps/web/app/{app-shell.tsx,app-navigation.tsx,shell-org-switcher.tsx}`, `apps/web/app/(app)/app/settings/notifications/page.tsx`, `apps/web/messages/*` (titre), `packages/modules/notifications/src/{domain/notification.ts,index.ts,presentation/notification-routes.ts,presentation/notifications-screen.tsx,presentation/notification-preferences-card.tsx,presentation/index.ts,messages/*}`, tests : `packages/modules/organizations/src/presentation/organization-routes.test.ts`, `tests/{organizations,notifications,app-shell,marketing}.test.ts`, `e2e/organizations.spec.ts` (+ une spec pour la rubrique), docs.

## Test strategy
Budget 25 ; visé ~12 cas neufs ou réécrits.
- **Route `switch`** (unitaire, `organization-routes.test.ts`, 4) : `next=/app/demo` → 303 `/app/demo` ; `next=//evil.test` et `next=/.//evil.test` → constante (un cas paramétré) ; sans `next` → constante ; refus métier avec `next` valide → constante + `?error=`. Le filtre lui-même n'est **pas** re-testé (tests d'`auth`). Une autre route du module (`update`) avec `next` → constante (1).
- **Lecture `switcher`** (`tests/organizations.test.ts`, 2) : base réelle, deux appartenances + active → forme attendue ; module coupé → vide sans connexion (patron `module-off`).
- **Shell** (`tests/app-shell.test.ts` + `marketing.test.ts`, 3) : sélecteur rendu avec `next` = chemin courant quand `options` non vide ; absent si vide ; anonyme → `switcher` jamais appelé (réécriture du comptage existant).
- **Notifications** (`tests/notifications.test.ts`, 3 réécrits) : `setPreference` → 303 rubrique ; navigation : aucune entrée `app`, une entrée `settings` vers la rubrique ; `NotificationsScreen` ne rend plus la carte.
- **Rubrique** : `SETTINGS_SCREENS` à sept (existant) ; 404 module coupé couvert par `test:minimal-profile` (balayage dérivé).
- **E2E** (au ship) : retour sur l'écran courant ; bascule d'une préférence dans la rubrique ; repli sans JS existant conservé.
- **Neutralisation à prouver** : remplacer `safeReturnPath(next, …)` par `next` dans la route → le cas `//evil.test` rougit ; retirer la garde `session !== null` → le cas anonyme rougit ; remettre l'entrée sidebar → le test de navigation rougit.
- **Visuel** (non automatisé) : barre desktop/mobile, clair/sombre, sans débordement ; rubrique Notifications.

## Definition of Done
Critères 1-5 cochés ; tests ci-dessus verts et neutralisations constatées ; `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:minimal-profile`, `pnpm test:socle` verts, consignés dans `docs/verif/s62c-barre-du-haut.md` ; contrôle navigateur fait ; ADR 076 et docs à jour ; un commit, une PR vers `dev`, revue sans critique.
