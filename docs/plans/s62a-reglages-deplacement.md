---
validated: yes
---
# Plan — Story s62a-reglages-deplacement

Branch: `feature/s62a-reglages-deplacement`
Research: `docs/research/s62-zone-reglages.md` (story mère, verdict 5 et découpage) — read it first; this plan does not repeat it.
Design: `docs/designs/s62a-reglages-deplacement.md` (+ `.html`, référence visuelle seulement).
Décision : ADR 075 (table des anciens chemins lue par le proxy).

## Target story
Déplacer tels quels `/account`, `/organizations`, `/billing` sous `/app/settings/{account,organization,billing}`, avec une surface `settings` et sa sous-navigation ; 308 depuis les anciens chemins par une table unique ; constante pour `/account` ; retours Stripe, repli guest checkout, redirections 303 et liens internes à jour ; menu de compte vers la zone ; modules coupés et recettes vertes. Six critères : `docs/stories.md`, s62a. Sections de `docs/security.md` touchées : redirection ouverte (cibles constantes).

## Tasks (ordered)
1. [x] **Surface `settings` et chemins** — `packages/core/src/module.ts:258` gagne `'settings'`. Constantes : `ACCOUNT_SCREEN_PATH = '/app/settings/account'` (module `auth`, remplace le littéral `auth-routes.ts:1866`), `ORGANIZATIONS_SCREEN_PATH = '/app/settings/organization'`, `BILLING_SCREEN_PATH = '/app/settings/billing'` ; les trois entrées de navigation passent en `surface: 'settings'`. **Tests** : registre (surface `settings` = ces trois entrées en configuration livrée, sans nommer de module dans l'assertion) ; `tests/app-shell.test.ts` (la barre latérale ne les porte plus).
2. [x] **Table des anciens chemins et 308** — `apps/web/lib/legacy-paths.ts` : `/account`, `/organizations`, `/billing` → constantes ; `apps/web/proxy.ts` : après `internalPath`, recherche dans la table, `NextResponse.redirect(cible re-préfixée + search, 308)` enveloppé des en-têtes de sécurité ; entrée ignorée si le module cible est coupé. Fixture figée `tests/fixtures/legacy-screen-paths.json` (les segments de la zone Application de s61). **Tests** : Vitest — chaque entrée de la fixture est servie ou redirigée ; la cible n'est jamais tirée de la requête ; e2e — `/account?x=1` et `/fr/organizations` répondent 308 vers leur cible (requête et langue conservées).
3. [x] **Déplacement des écrans** — `app/(app)/account` → `app/(app)/app/settings/account`, `organizations` → `app/settings/organization`, `billing` → `app/settings/billing`, contenu inchangé ; `?next=` des redirections anonymes sur les nouvelles constantes. `APPLICATION_SEGMENTS` garde `account`, `organizations`, `billing` (segments redirigés, ADR 075). **Tests** : `tests/zones.test.ts`, `tests/organizations.test.ts` (segments réservés), `tests/rendered-text.test.ts` (chemins d'import et déclarations).
4. [x] **Cadre de la zone** — `app/(app)/app/settings/layout.tsx` : `PageHeader` « Réglages » + `SidebarNav` des entrées `settings` (courante par préfixe), deux colonnes à partir de `md`, empilé en dessous (design). **Tests** : e2e — sur `/app/settings/billing`, la sous-navigation porte les entrées visibles et marque Facturation ; aucune entrée de réglage dans la barre latérale ; vérification visuelle bureau et 380 px.
5. [x] **Liens et retours** — `billing-use-cases.ts:616` construit ses retours depuis `BILLING_SCREEN_PATH` (plus de littéral) ; `apps/web/lib/guest-account.ts:154` sur la constante ; redirections 303 (`organization-routes.ts:136, 170`), liens `(app)/app/page.tsx:56`, `(app)/premium/page.tsx:99`, `(app)/onboarding/page.tsx:122`, menu de compte (`app-shell.tsx`, `console-shell.tsx:104` → `ACCOUNT_SCREEN_PATH`). **Tests** : `tests/billing.test.ts:6423-6424` (URLs de retour sur le nouveau chemin) ; un test source refuse les littéraux `'/account'`, `'/organizations'`, `'/billing'` hors de la table et des constantes, dans `apps/web` et les modules concernés.
6. [x] **Tests existants** — migrer les chemins écrits en dur **par la dérivation** : e2e via `e2e/support/locale.ts` (fonctions de chemin des écrans de réglages), unitaires via les constantes importées (`tests/organizations.test.ts` et ses 39 `${APP_URL}/organizations`, `tests/notifications.test.ts`, `tests/i18n.test.ts:875-881`, `tests/auth.test.ts:1680-1682`, `tests/syndication.test.ts`, `packages/core/src/syndication.test.ts`). **Vérification** : `pnpm test`, `E2E_PORT=3162 pnpm test:e2e` complet (une seule fois, en fin de story, base partagée avec s67).
7. [x] **Configurations et recettes** — module `organizations` coupé : pas d'entrée Organisation, `/organizations` et `/app/settings/organization` en 404 ; idem `billing`. **Vérification** : `pnpm test:minimal-profile`, `pnpm test:socle`, `GOLDEN_PATH_PAYMENTS=simulated pnpm test:golden-path` (le parcours passe par `/billing` et `/organizations`, `golden-path.spec.ts:263-366`).
8. [x] **Documentation** — `apps/web/AGENTS.md` (zone Réglages, table des anciens chemins), `AGENTS.md` racine (surface `settings`), `docs/architecture.md`, `docs/design-system.md` § Navigation (sous-navigation de réglages et lacune `Tabs`). **Vérification** : `tests/agents-md.test.ts`.

## Run interdicts
- Le **contenu** des trois écrans ne change pas (s62b) ; seuls les chemins, imports et `next` changent.
- `/notifications` et ses préférences ne bougent pas (s62c, s63).
- Aucune cible de redirection n'est tirée de la requête ; la table est la seule source des 308.
- Pas de `redirects()` dans `next.config.ts` (ADR 075).
- Aucun composant nouveau dans `packages/ui` (`Tabs` reste une lacune).
- Ne pas lancer la suite e2e complète pendant que la worktree de s67 en joue une (base partagée).
- Les routes d'API ne changent pas de chemin.

## The point everything turns on
**L'ordre du proxy.** La redirection canonique de langue (l. 87-95) répond avant la réécriture ; la table doit être consultée sur le chemin **interne** et la cible re-préfixée dans la langue de la requête, sinon `/fr/account` part en boucle ou perd sa langue. À comparer : les deux cas e2e de la tâche 2 (`/account?x=1` et `/fr/organizations`), et `pnpm test:socle` où l'i18n est coupée (`path()` identité).
Second point : **aucun chemin oublié**. Plus de 150 références écrites en dur (research, fait 3) ; un oubli ne casse qu'un parcours. Le test source de la tâche 5 et la dérivation e2e de la tâche 6 sont les deux filets.

## Files touched
- `packages/core/src/module.ts` ; `packages/modules/auth/src/presentation/auth-routes.ts` (+ constante exportée) ; `packages/modules/organizations/src/presentation/organization-routes.ts` ; `packages/modules/billing/src/{presentation/billing-routes.ts,application/billing-use-cases.ts}`
- `apps/web/proxy.ts`, `apps/web/lib/legacy-paths.ts` (nouveau), `apps/web/lib/{guest-account,organizations,billing}.ts`
- `apps/web/app/(app)/app/settings/{layout.tsx,account/**,organization/**,billing/**}` (déplacements + layout), `apps/web/app/(app)/{app/page.tsx,premium/page.tsx,onboarding/page.tsx}`, `apps/web/app/app-shell.tsx`, `apps/web/app/(console)/console-shell.tsx`
- `tests/fixtures/legacy-screen-paths.json` (nouveau), `tests/**` et `e2e/**` (chemins), `e2e/support/locale.ts`
- `AGENTS.md`, `apps/web/AGENTS.md`, `docs/architecture.md`, `docs/design-system.md`
- `docs/decisions/075-…md`, `docs/designs/s62a-reglages-deplacement.{md,html}`, ce plan

## Test strategy
- **Registre** : répartition `settings` / `app`.
- **Proxy** : table ↔ fixture ; 308 avec requête et langue ; module coupé → pas de redirection.
- **Source** : aucun littéral d'ancien chemin hors table et constantes.
- **Navigateur** : sous-navigation, barre latérale vidée, 308, parcours existants par dérivation.
- **Recettes** : minimal-profile, socle, golden-path.
**Mutations attendues en revue** : retirer une ligne de la table → le test de fixture rougit ; tirer la cible d'un paramètre → le test « cible constante » rougit ; remettre `${appUrl}/billing` dans `billing-use-cases.ts` → le test source rougit ; laisser l'entrée Facturation en surface `app` → le test de registre rougit.

## Definition of Done
- Une PR, un commit de story portant le design, l'ADR 075 et ce plan.
- Les six critères tenus ; `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:minimal-profile`, `pnpm test:socle`, `pnpm test:golden-path` verts.
- Revue passée ; CI verte sur `tous` et `socle` après merge.
