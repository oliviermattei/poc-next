---
validated: yes
---
# Plan — Story s62b-reglages-decoupage

Branch: `feature/s62b-reglages-decoupage`
Research: `docs/research/s62b-reglages-decoupage.md` (et la story mère `docs/research/s62-zone-reglages.md`) — read them first; this plan does not repeat them.
Design: `docs/designs/s62b-reglages-decoupage.md` (+ `.html`, référence visuelle seulement).

## Target story
Répartir le contenu de Compte (Profil, Sécurité, Cookies) et d'Organisation (Organisation, Membres) sans perte, avec un seul `h1` par écran et les libellés de la story. Critères : `docs/stories.md`, s62b (six).

**Décisions du design** : export et suppression en bas de Profil (zone « Données ») ; le cadre garde le `h1` « Réglages », les rubriques ouvrent par un `h2` ; `/app/settings/account` devient un ancien chemin (308 vers Profil) et `ACCOUNT_SCREEN_PATH` vise Profil. Aucun ADR : la table des anciens chemins (ADR 075) et les surfaces (ADR 066/067) suffisent.

## Tasks (ordered)
1. [x] **Inventaire figé d'avant** — une fixture `tests/fixtures/settings-cards-s62a.json` : la liste des cartes et actions des écrans Compte et Organisation **telle que livrée par s62a** (titres de carte et noms d'action, relevés sur le code de `0387df4`), et un test qui échoue tant qu'une entrée n'est pas retrouvée sous une rubrique. **Test** : le test lui-même, rouge avant la tâche 3.
2. [x] **Entrées de navigation** — `auth` déclare Profil (`/app/settings/profile`) et Sécurité (`/app/settings/security`) en surface `settings` (l'entrée Compte disparaît) ; `organizations` déclare Organisation et Membres (`/app/settings/members`) ; `consent` déclare Cookies (`/app/settings/cookies`) ; ordre du design. Constantes de chemin exportées ; `ACCOUNT_SCREEN_PATH` → Profil. **Tests** : registre (surface `settings` dans l'ordre du design, chaque entrée disparaît avec son module, sans nommer de module dans l'assertion).
3. [x] **Pages de rubriques** — `app/(app)/app/settings/{profile,security,cookies}/page.tsx` se partagent les composants locaux de l'ancien `account/` (qui déménagent avec leur page) ; `@repo/module-organizations/presentation` exporte deux écrans (organisation, membres) issus d'`OrganizationsScreen`, rendus par `organization/page.tsx` et `members/page.tsx`. Chaque page ouvre par un `h2` ; `SignOutButton` quitte l'écran (reste dans le menu de compte). **Tests** : la fixture de la tâche 1 passe ; `tests/rendered-text.test.ts` déclare les nouvelles pages ; `tests/rgpd-screens.test.ts` et `tests/consent.test.ts` suivent leurs cartes.
4. [x] **Retours d'action** — les 303 des routes d'organisation (`organization-routes.ts` `backToScreen`) reviennent sur la rubrique de l'action (invitation, rôle, retrait → Membres ; renommage, création, suppression, changement d'organisation → Organisation) ; les retours des actions de compte (sessions, 2FA, passkeys, connexions → Sécurité ; nom, email, avatar, export → Profil). **Tests** : unitaires des routes (`Location` par action) ; e2e d'une invitation qui revient sur Membres.
5. [x] **Anciens chemins** — `apps/web/lib/legacy-paths.ts` : `/app/settings/account` → Profil ; la fixture des anciens chemins (s62a) gagne ce chemin ; `/account` (s62a) vise désormais Profil. **Tests** : `tests/legacy-paths.test.ts` (servi ou redirigé), e2e `/account?x=1` → un seul 308 vers Profil.
6. [x] **Titre unique et libellés** — le cadre garde le seul `h1` ; menu de compte « Réglages » (application et console) ; libellés des rubriques fr/en. `e2e/app-shell.spec.ts` : l'assertion `.first()` redevient un titre précis. **Tests** : e2e — sur chaque rubrique, exactement un `h1` (« Réglages ») et un `h2` au nom de la rubrique ; `tests/i18n.test.ts`/catalogues.
7. [x] **Documentation** — `apps/web/AGENTS.md` (rubriques, où vit chaque carte), `packages/modules/organizations/AGENTS.md` (deux écrans exportés, retours par rubrique), `docs/design-system.md` (lacune `PageHeader` sans niveau). **Vérification** : `tests/agents-md.test.ts`.
8. [x] **Recettes** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `E2E_PORT=3412 pnpm test:e2e` (complet, une fois, en fin de story), `pnpm test:minimal-profile`, `pnpm test:socle`, `GOLDEN_PATH_PAYMENTS=simulated pnpm test:golden-path`.

## Run interdicts
- Aucune carte n'est réécrite : elles sont **déplacées** ; leurs actions, leurs routes et leurs textes ne changent pas (hors titres de rubrique et libellés listés).
- Pas de nouveau composant dans `packages/ui` ; `PageHeader` ne gagne pas de prop.
- La barre du haut (sélecteur d'organisation, cloche) et les préférences de notification sont s62c.
- Les cibles de redirection restent des constantes de la table (ADR 075).
- Pas de suite e2e complète pendant qu'une autre worktree en joue une (base partagée).

## The point everything turns on
**« Sans perte » doit être prouvé contre l'avant, pas contre l'après.** La fixture de la tâche 1 est relevée sur le code de s62a (`0387df4`) ; si elle était dérivée de l'arbre modifié, elle serait vide de sens. À comparer : la fixture contient au moins les onze cartes de Compte et les six blocs d'Organisation listés en research (fait 2 et 3).
Second point : **les retours 303**. Une action qui revient sur la mauvaise rubrique ne casse aucun test unitaire de carte ; seul un test par action le voit (tâche 4).

## Files touched
- `packages/modules/auth/src/{presentation/auth-routes.ts,domain/redirect.ts}`, `packages/modules/organizations/src/presentation/{organizations-screen.tsx,organization-routes.ts,index.ts}`, `packages/modules/consent/src/{module.ts,presentation/…}`, messages des modules
- `apps/web/app/(app)/app/settings/{profile,security,cookies,members}/**` (nouveaux), `account/**` (déménage), `organization/page.tsx`, `layout.tsx` ; `apps/web/app/{app-shell.tsx,(console)/console-shell.tsx,account-menu.tsx}` ; `apps/web/lib/legacy-paths.ts` ; `apps/web/messages/{fr,en}.json`
- `tests/fixtures/{settings-cards-s62a.json (nouveau),legacy-screen-paths.json}`, `tests/**`, `e2e/**`
- `apps/web/AGENTS.md`, `packages/modules/organizations/AGENTS.md`, `docs/design-system.md`
- `docs/designs/s62b-reglages-decoupage.{md,html}`, ce plan

## Test strategy
- **Fixture d'avant** : chaque carte et action retrouvée.
- **Registre** : rubriques, ordre, disparition par module.
- **Routes** : `Location` des 303 par action.
- **Navigateur** : un `h1` + un `h2` par rubrique ; invitation → Membres ; `/account` → Profil en un 308.
- **Recettes** : minimal-profile, socle, golden-path.
**Mutations attendues en revue** : retirer une carte d'une page → la fixture rougit ; renvoyer l'invitation sur Organisation → le test de route rougit ; rendre un `PageHeader` dans une rubrique → l'e2e « un seul h1 » rougit ; retirer la ligne `/app/settings/account` de la table → `legacy-paths` rougit.

## Definition of Done
- Une PR, un commit de story portant le design et ce plan.
- Les six critères tenus ; commandes de la tâche 8 vertes.
- Revue passée ; CI verte après merge.
