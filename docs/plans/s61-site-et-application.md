---
validated: yes
---
# Plan — Story s61-site-et-application

Branch: `feature/s61-site-et-application`
Research: `docs/research/s61-site-et-application.md` — read it first; this plan does not repeat it.
Design: `docs/designs/s61-site-et-application.md` (+ `.html`, référence visuelle seulement).
Décision : ADR 073 (surface `site`, bouton de gabarit), dans `docs/decisions/`.

**Prérequis d'exécution** : s66 (frontières 404 par zone) doit être **mergée sur `dev`** et cette branche mise à jour (`git merge --ff-only dev` si possible, sinon `git merge dev`) avant la tâche 1 — elle touche `not-found`, `apps/web/AGENTS.md` et `tests/rendered-text.test.ts`.

## Target story
Séparer le site public de l'application : surface `site` rendue dans un en-tête, trois gabarits (Site, Hors zone, Application), `/` toujours le site, `/app` tableau de bord, destination par défaut `/app` sur chaque parcours de connexion, connecté renvoyé de `/sign-in`/`/sign-up`. Dix critères : `docs/stories.md`, s61.

**Décisions de planification** (questions ouvertes de la research) :
- Q1 — en-tête : `Sheet` sous `md`, comme l'application (design, §1).
- Q2 — un connecté sur `/` ne voit **que** le bouton « Ouvrir l'application » ; le contenu de l'accueil ne change pas.
- La constante de destination par défaut vit dans le module `auth` (`domain/redirect.ts`, à côté de `safeRedirectPath`) : ses routes (`auth-routes.ts:370, 371, 646, 899`) en ont besoin, et un module n'importe pas `apps/web`. `apps/web` l'importe.
- Les éléments communs aux gabarits (bannière et scripts de consentement, bandeau d'emprunt, réserve sous la bannière) sont extraits de l'`AppShell` dans **un** composant d'`apps/web` réutilisé par les trois gabarits, pour qu'aucun ne les perde (critère 5).

## Tasks (ordered)
1. [x] **Surface `site`** — `packages/core/src/module.ts:256` gagne `'site'`. `surface: 'site'` sur marketing `home` (`marketing/src/module.ts:32`), blog `index` (`blog/src/module.ts:23`), docs `index` (`docs/src/module.ts:22`), billing `pricing` (`billing-routes.ts:297`). Entrée auth `sign-in` retirée (`auth-routes.ts:1859-1864`). **Tests** : `tests/app-shell.test.ts` (la navigation de l'application ne contient plus ces entrées) ; un cas de registre : `visibleNavigation(…, 'site')` rend exactement ces quatre entrées pour la configuration livrée ; `tests/admin.test.ts` (aucune adresse de console dans la surface `site`).
2. [x] **Cadre commun des zones** — extraire de `app/app-shell.tsx` (l. 199-203, 212-241, 256-257) un composant `ZoneFrame` (`apps/web/app/zone-frame.tsx`) qui rend `ImpersonationBanner`, le contenu avec la réserve `pb-64 md:pb-36`, `ConsentBanner` et `ConsentScripts nonce` ; l'`AppShell` l'utilise. **Vérification** : `pnpm test` inchangé (`tests/marketing.test.ts` l. 1135, 1185, 1256 comptent les requêtes : aucune nouvelle), `e2e/app-shell.spec.ts` vert.
3. [x] **En-tête et gabarit Site** — `app/(site)/site-header.tsx` : marque (lien `/`), entrées `visibleNavigation(…, 'site')` en `Button ghost`/`secondary` + `aria-current`, `Sheet` sous `md`, `LocaleSwitcher`, `ThemeToggle`, bouton de gabarit (anonyme → « Se connecter » `/sign-in` ; connecté → « Ouvrir l'application » `/app`), décidé par `currentViewer()`. `(site)/layout.tsx` : en-tête + `ZoneFrame`, **sans** `AppShell` ni pied de page. Exception du bouton écrite dans `apps/web/AGENTS.md:165-168`. La 404 racine (`app/not-found.tsx`) prend le gabarit Site. **Tests** : `tests/marketing.test.ts` — l'accueil anonyme n'ouvre **aucune** connexion (l. 1135) ; e2e — sur `/blog`, l'en-tête porte les quatre liens du site et « Se connecter », **aucune** barre latérale ; connecté sur `/` : « Ouvrir l'application » ; `marketing` coupé en configuration `socle` : `/blog` garde son en-tête.
4. [x] **Gabarit Hors zone** — `(auth)/layout.tsx` : barre minimale (marque, `LocaleSwitcher`, `ThemeToggle`), contenu centré, `ZoneFrame` ; ni navigation, ni bouton. **Tests** : `e2e/i18n.spec.ts:94-107` (sélecteur ouvert depuis `/sign-in`) vert ; e2e — `/sign-in` sans barre latérale ni en-tête du site, bannière de consentement présente.
5. [x] **Gabarit Application et `/app`** — `(app)/layout.tsx` garde l'`AppShell` (marque vers `/app`). Nouvelle page `app/(app)/app/page.tsx` : le contenu connecté actuel de `(site)/page.tsx:86-103`, plus la redirection vers le parcours d'intégration s'il est en cours (reprise de l. 82-84) ; un anonyme → `/sign-in?next=/app`. `APPLICATION_SEGMENTS` (`apps/web/lib/organizations.ts`) gagne `app`. **Tests** : `tests/zones.test.ts` (partition), `tests/organizations.test.ts` (segment réservé), `tests/rendered-text.test.ts` (le cas « accueil connecté » devient le cas `/app`) ; e2e — anonyme sur `/app` → connexion puis retour sur `/app`.
6. [x] **`/` toujours le site** — `(site)/page.tsx` : plus de branche connectée ; site coupé (aucune section) → anonyme vers `/sign-in`, connecté vers `/app`. **Tests** : `tests/marketing.test.ts:804-810` réécrit (un connecté sur `/` reçoit l'accueil marketing) et le cas site coupé (l. 547) couvre les deux visiteurs.
7. [x] **Destination par défaut `/app`** — constante `DEFAULT_SIGNED_IN_PATH = '/app'` dans `packages/modules/auth/src/domain/redirect.ts`, exportée. Elle remplace les repli `'/'` de `(auth)/sign-in/page.tsx:58, 69, 126`, `(auth)/two-factor/page.tsx:42`, `(auth)/oauth/return/page.tsx:31`, `auth-routes.ts:370, 371, 646`, le repli `'/account'` de `auth-routes.ts:899`, et la fin du parcours d'intégration `(app)/onboarding/page.tsx:70-71`. `safeRedirectPath` ne change pas. **Tests** : `packages/modules/auth` — chaque route de départ (2FA, OAuth, magic link) rend la constante sans `next` ; un test source (grep dans les fichiers nommés) refuse un repli `'/'` ou `'/account'` résiduel ; e2e — mot de passe, magic link, OAuth, passkey, 2FA atterrissent sur `/app` (critère 8, un test par parcours, les specs existantes `auth`, `oauth`, `passkeys`, `two-factor` réécrites via `signedInLanding`).
8. [x] **Connecté sur `/sign-in` et `/sign-up`** — les deux pages : `currentViewer()` ; connecté → `redirect(path(safeRedirectPath(next, DEFAULT_SIGNED_IN_PATH)))`. **Tests** : e2e — connecté sur `/sign-in` → `/app` ; sur `/sign-in?next=/invitations/accept?token=x` → ce `next` ; sur `/sign-in?next=//evil.test` → `/app`.
9. [x] **Parcours existants** — `e2e/support/locale.ts:94-95` : `signedInLanding()` rend `/app` (ou l'intégration) ; `e2e/support/account.ts:288` suit ; les attentes écrites en dur de `/` (golden path l. 155-156, 315-316, 326, 329 ; `app-shell`, `organizations`, `onboarding`, `minimal-profile`) passent par la dérivation ; les assertions de liens du site dans la barre latérale (`app-shell.spec.ts:108`, `billing.spec.ts:329-336`, `marketing.spec.ts:330-346`, `auth.spec.ts:212`, `minimal-profile.spec.ts:65`, `admin.spec.ts:673`) visent l'en-tête du site ; `modules.spec.ts:96-104` compare la barre latérale à `visibleNavigation(registry, session, 'app')` et l'en-tête à la surface `site` (preuve du critère 10). **Tests** : `E2E_PORT=… pnpm test:e2e` complet, `pnpm test:golden-path` (régime `simulated` en local), `pnpm test:minimal-profile`, `pnpm test:socle`.
10. [x] **Documentation** — `apps/web/AGENTS.md` (trois gabarits, `ZoneFrame`, exception du bouton), `AGENTS.md` racine (surface `site`), `docs/architecture.md` (écrans structurants), `docs/design-system.md` § Navigation (l'en-tête du site et ses lacunes 1-2 du design). **Vérification** : `tests/agents-md.test.ts`.

## Run interdicts
- Aucune page ne change de dossier ; seule `app/(app)/app/page.tsx` est créée.
- Aucune URL existante ne change ; `/app` est la seule nouvelle.
- La console (`(console)/**`, `console-shell.tsx`) ne change pas.
- Le pied de page n'est **pas** ajouté aux gabarits ; `publicFooterLinks` et `MarketingFooter` ne changent pas.
- `safeRedirectPath` ne change pas ; aucune destination ne vient d'autre chose qu'une constante ou d'un `next` filtré par lui.
- L'en-tête du site ne lit ni l'avatar ni le compteur de notifications : ses seules lectures sont celles de `currentViewer()`.
- Aucun composant nouveau dans `packages/ui`, aucun jeton ni couleur nouveaux (lacunes 1-3 du design).
- Aucune modification du contrat de module hors l'ajout de `'site'` au type.
- La zone Réglages, la cloche et le sélecteur d'organisation dans la barre du haut sont s62 : l'`AppShell` n'est touché qu'aux tâches 2 et 5.

## The point everything turns on
**Déplacer l'atterrissage de `/` vers `/app` sans laisser un seul parcours sur l'ancien** — huit replis, la fin d'intégration, et une dizaine de specs écrites en dur. Trois endroits où cela peut être faux :
- **Un repli oublié.** Un repli `'/'` survivant envoie ce parcours sur le **site**, et aucun test unitaire ne le voit. À comparer : le test source de la tâche 7 (aucun repli `'/'`/`'/account'` dans les fichiers de la research) **et** un parcours e2e par méthode de connexion.
- **Les requêtes de l'en-tête.** `currentViewer()` pour un anonyme sans cookie doit n'ouvrir aucune connexion ; sinon `tests/marketing.test.ts:1135` rougit à juste titre. À mesurer, pas à supposer.
- **Le gabarit de la 404 racine.** Il passe de l'`AppShell` à l'en-tête du site ; avec les frontières de zone de s66, une 404 levée par une page de l'application reste dans le gabarit Application. À comparer : `e2e/not-found-zones.spec.ts` (s66) reste vert, une barre latérale au plus.

## Files touched
- `packages/core/src/module.ts` ; `packages/modules/{marketing,blog,docs}/src/module.ts`, `packages/modules/billing/src/presentation/billing-routes.ts`, `packages/modules/auth/src/{domain/redirect.ts,presentation/auth-routes.ts,index.ts}`
- `apps/web/app/app-shell.tsx`, `apps/web/app/zone-frame.tsx` (nouveau), `apps/web/app/not-found.tsx`
- `apps/web/app/(site)/{layout.tsx,site-header.tsx,page.tsx}`, `apps/web/app/(auth)/{layout.tsx,sign-in/page.tsx,sign-up/page.tsx,two-factor/page.tsx,oauth/return/page.tsx}`, `apps/web/app/(app)/{layout.tsx,app/page.tsx,onboarding/page.tsx}`
- `apps/web/lib/organizations.ts`, messages de l'application (`apps/web/messages/{fr,en}.json`) pour les libellés du bouton et de l'en-tête
- `tests/{app-shell,marketing,rendered-text,zones,organizations,admin}.test.ts`, tests du module `auth`
- `e2e/support/{locale,account}.ts` et les specs de la tâche 9
- `AGENTS.md`, `apps/web/AGENTS.md`, `docs/architecture.md`, `docs/design-system.md`
- `docs/decisions/073-…md`, `docs/designs/s61-site-et-application.{md,html}`, ce plan

## Test strategy
**Automatisé, comportement :**
- *Registre* (Vitest) : répartition des surfaces `site` / `app` (tâche 1), aucune console dans `site`.
- *Composition* (Vitest) : aucune requête base pour le site anonyme ; aucune requête nouvelle pour un connecté (`tests/marketing.test.ts`).
- *Module `auth`* : chaque route de départ rend la constante ; test source des replis.
- *Navigateur* (Playwright) : en-tête et bouton selon la session ; gabarits sans barre latérale sur le site et l'authentification ; consentement, langue, thème, bandeau d'emprunt par gabarit ; atterrissage `/app` par méthode de connexion ; connecté sur `/sign-in` ; `/` connecté = site ; barre latérale = surface `app`.
- *Recettes* : `pnpm test:golden-path`, `pnpm test:minimal-profile`, `pnpm test:socle`, `pnpm test:contrast`.
Chaque invariant est tenu une fois, au plus près : la liste des entrées par surface au registre, le rendu au navigateur.

**Vérification visuelle** : les trois gabarits et `/app` contre `docs/designs/s61-site-et-application.html`, clair/sombre, bureau et 380 px (aucun débordement horizontal).

**Mutations attendues en revue** : remettre un repli `'/'` dans `two-factor/page.tsx` → le test source et l'e2e 2FA rougissent ; rendre l'`AppShell` dans `(site)/layout.tsx` → l'e2e « aucune barre latérale sur le site » rougit ; faire lire l'avatar à l'en-tête → `tests/marketing.test.ts` rougit ; retirer `ZoneFrame` de `(auth)/layout.tsx` → l'e2e consentement sur `/sign-in` rougit.

## Definition of Done
- Une PR, un commit de story portant le design, l'ADR 073 et ce plan.
- Les dix critères tenus par les tests nommés ; `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:golden-path`, `pnpm test:minimal-profile`, `pnpm test:socle`, `pnpm test:contrast` verts.
- Sections de `docs/security.md` touchées : redirection ouverte (la destination reste une constante ou un `next` filtré) ; CSP inchangée (nonce relu dans chaque layout).
- Documentation à jour dans le même commit.
- Revue passée ; CI verte sur `tous` et `socle` après merge.
