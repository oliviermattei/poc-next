---
validated: yes
---
# Plan — Story s60-console

Branch: `feature/s60-console`
Research: `docs/research/s60-console.md` — read it first; this plan does not repeat it.
Design: `docs/designs/s60-console.md` (+ `.html`, référence visuelle seulement).
Décisions : ADR 070 (surface `console`), ADR 071 (dossiers de routes par zone) — dans ce dossier de branche, `docs/decisions/`.

## Target story
Renommer la surface `admin` en `console` et servir le back-office sous `/console/*` (anciens chemins en 404, sans redirection), ranger les pages de `apps/web/app` dans quatre dossiers de routes `(site)`, `(auth)`, `(app)`, `(console)` sans changer d'URL, donner à la console son propre shell (badge « Console », barre latérale des entrées `console`, langue, thème, consentement), ouvrir `/console` sur un tableau de bord à tuiles dérivées des entrées visibles, ne rendre aucun lien vers la console, répondre 404 à un anonyme, un non-superadmin, une session empruntée, et quand `admin` est coupé.

Critères (docs/stories.md, s60) :
1. Plus de valeur `admin` ; `surface: 'console'` ; `pnpm typecheck` refuse l'ancienne.
2. Écrans sous `/console/*` ; `/admin/*` en 404 sans redirection.
3. Pages rangées dans `(site)`, `(auth)`, `(app)`, `(console)` ; aucune URL ne change hors `/admin` → `/console` ; les trois premiers rendent l'`AppShell` à l'identique ; un test : chaque page dans exactement un dossier de zone.
4. `/console` = tableau de bord : comptes, organisations, revenu récurrent estimé, inscriptions, chacun lié ; tuile absente si son module est coupé.
5. Shell de console sans la barre latérale du produit : titre « Console », badge ; consentement (avec nonce), langue, thème.
6. Aucun lien vers la console (application, site, plan de site, `robots.txt`).
7. Anonyme, non-superadmin, session empruntée → 404, sans redirection vers la connexion.
8. `admin` coupé → `/console` en 404 ; `pnpm test:minimal-profile` vert.
9. `pnpm test:e2e` passe avec les dossiers de routes ; le préambule traduit `(…)` et refuse toujours `@`.

**Décisions prises à la planification** (questions ouvertes de la research) :
- Q2 — le tableau de bord **réutilise les quatre lectures existantes** de `apps/web/lib/admin.ts` (`accounts`, `organizations`, `revenue`, `subscriptions`), qui rendent déjà un total ; aucun port ne change.
- Q4 — le shell de console vit dans `apps/web` (`app/(console)/`), comme l'`AppShell` : il compose le consentement (module `consent`), la langue et le compte, que le module `admin` ne connaît pas.
- Q5 / lacune 4 du design — le **menu de compte est gardé** dans la console : c'est la seule déconnexion visible. Il crée un lien console → application ; le critère 6 interdit le sens inverse, pas celui-ci.

## Tasks (ordered)
1. [x] **Surface `console`** — `packages/core/src/module.ts:251` : `'admin'` → `'console'`. Les quatre déclarations (`admin-routes.ts:537`, `organization-routes.ts:309`, `billing-routes.ts:328`, `marketing/src/module.ts:58`) et `apps/web/lib/back-office.ts:67` suivent. **Test** : un cas `@ts-expect-error` dans les tests de `@repo/core` qui déclare `surface: 'admin'` (critère 1 — il rougit si la valeur revient) ; `tests/admin.test.ts` (l. 2975-3095) passe sur `'console'`.
2. [x] **Chemins d'écrans** — les quatre `ADMIN_*_SCREEN_PATH` valent `/console/…` (noms inchangés, ADR 070). Le module `admin` déclare une entrée « Tableau de bord » `/console` (surface `console`, `authenticated`), **première** du registre de la console. `APPLICATION_SEGMENTS` (`apps/web/lib/organizations.ts:194`) : ajouter `'console'`, retirer `'admin'`. **Tests** : `tests/organizations.test.ts` (dérivé du disque) ; `tests/admin.test.ts:1829` (redirection d'une route d'API vers le détail) suit la constante.
3. [x] **Dossiers de routes, sans changement de comportement** — déplacer les pages selon la partition : `(site)` = `page.tsx`, `blog`, `docs`, `pricing`, `changelog`, `contact`, `legal`, `cookies`, `waitlist` ; `(auth)` = `sign-in`, `sign-up`, `forgot-password`, `reset-password`, `verify-email`, `two-factor`, `oauth`, `invitations` ; `(app)` = `account`, `billing`, `organizations`, `notifications`, `onboarding`, `premium`. `api/`, `layout.tsx`, `not-found.tsx`, `global-error.tsx`, `robots.ts`, `sitemap.ts` et les composants partagés (`app-shell.tsx`, `auth-form.tsx`…) restent à la racine. Le layout racine ne rend plus l'`AppShell` ; `(site)/layout.tsx`, `(auth)/layout.tsx`, `(app)/layout.tsx` le rendent (nonce relu comme aujourd'hui). `not-found.tsx` rend lui-même l'`AppShell` autour de son contenu. Corriger la profondeur des imports relatifs des pages déplacées (garder l'idiome relatif du dépôt). **Vérification** : `pnpm typecheck`, `pnpm lint`, `pnpm test` verts **sans modifier une assertion** — seuls les chemins d'import des 19 fichiers de `tests/` et les dérivations de disque changent.
4. [x] **Préambule Playwright et test de zone** — `e2e/support/warm-up.ts` : un segment `(…)` devient « aucun segment », `@…` lève toujours. Nouveau test (`tests/zones.test.ts`) : dérive les `page.tsx` de `apps/web/app` et exige que chacun soit sous **exactement un** des quatre dossiers de zone, avec un plancher anti-balayage-vide ; un cas couvre la traduction des segments du préambule (`urlSegment('(site)')` → segment vide, `urlSegment('@x')` lève). `tests/rendered-text.test.ts` : mettre à jour ses déclarations. **Test** : ces deux fichiers, plus `pnpm test:e2e` complet (critère 9).
5. [x] **Console déplacée et gardée** — `apps/web/app/admin/*` → `apps/web/app/(console)/console/*`. `(console)/layout.tsx` : si `admin.available` est faux, ou si la session est absente, empruntée (`currentViewer().impersonatedBy !== null`) ou ne porte pas le rôle `superadmin`, **`notFound()` avant tout rendu** du shell. Chaque page garde sa garde par lecture (`not_found` → `notFound()`) et **remplace la redirection vers `/sign-in` par `notFound()`**. **Tests** (`e2e/admin.spec.ts`, chemins mis à jour) : anonyme, compte ordinaire et session empruntée reçoivent 404 sur `/console` et `/console/users` ; `/admin/users` répond 404 et **aucune** réponse ne porte d'en-tête `Location` ; le corps d'un de ces 404 ne contient pas le badge « Console » (mesure de l'ADR 071).
6. [x] **Shell de la console** — `(console)/console-shell.tsx` compose `Sidebar` + `SidebarBrand` (nom + `Badge` « Console »), `DesktopNavigation`/`MobileNavigation` (`app/app-navigation.tsx`) alimentées par `visibleNavigation(…, 'console')`, barre du haut `h-14` avec `LocaleSwitcher` (si plusieurs langues), `ThemeToggle`, menu de compte existant ; `CookieBanner` et scripts de consentement avec le nonce, comme l'`AppShell`. Pas de cloche, pas de sélecteur d'organisation. Retirer `BackOfficeNavigation` des écrans du module (`back-office-screens.tsx:322-352`) et la prop `navigation` des pages ; racine du fil d'Ariane : « Console ». **Tests** : e2e — sur `/console/users`, badge présent, sélecteur de langue et bascule de thème présents, bannière de consentement présente à la première visite, **aucun** lien de la barre latérale du produit (`/pricing`, `/billing`…) ; `pnpm test:contrast` vert. **Vérification visuelle** : bureau et 380 px contre la maquette, sans débordement horizontal.
7. [x] **Tableau de bord `/console`** — une fonction pure dans `apps/web/lib/console.ts` associe chaque entrée `console` visible à sa lecture **par son `href`** (les constantes de chemin des modules, déjà importées par l'application — aucun identifiant de module écrit) ; une entrée sans lecture connue donne une tuile sans nombre, avec son seul lien. La page lance les lectures en parallèle ; un échec ne touche que sa tuile. Revenu : une ligne par devise (`Intl.NumberFormat` de la langue), jamais une somme, et « dont N … sans prix au catalogue » si `recurringUnvalued > 0`. Aucune entrée : `EmptyState`. **Tests** (`tests/console.test.ts`, registres construits comme dans `tests/admin.test.ts`) : `billing` coupé → pas de tuile revenu ; `marketing` coupé → pas de tuile inscriptions ; deux devises → deux lignes et aucune somme ; une lecture en échec → cette tuile seule en erreur. **E2E** : un superadmin voit quatre tuiles liées à leurs écrans.
8. [x] **Libellés** — `packages/modules/admin/src/messages/{fr,en}.json` : « Console », badge, tableau de bord, tuiles, erreur de tuile, entrée « Tableau de bord » ; `breadcrumb.root` → « Console ». **Test** : suites i18n existantes (clé manquante refusée à la construction du registre) et `tests/rendered-text.test.ts`.
9. [x] **Aucun lien, module coupé** — étendre `tests/admin.test.ts` (« ne laisse aucune adresse du back-office atteindre la navigation du produit ») : aucune entrée des surfaces `app` et `footer` ni du plan de site ne commence par `/console` ; `robots.ts` ne nomme pas `/console` (le nommer divulguerait la zone). Module `admin` coupé : `/console` → 404 (cas e2e ou `pnpm test:minimal-profile`, qui balaie les entrées des modules coupés). **Tests** : ceux-là.
10. [x] **Documentation** — `AGENTS.md` racine (vocabulaire back-office → console), `apps/web/AGENTS.md` (les quatre dossiers de zone, `not-found` qui rend son shell), `packages/modules/admin/AGENTS.md` (table des invariants : chemins `/console`, 404 anonyme), `docs/architecture.md` (« back-office superadmin »). Les commentaires d'en-tête qui nomment `/admin/…` (`back-office-screens.tsx`, `lib/marketing.ts:81`, `marketing/src/schema.ts:123`) suivent. **Vérification** : `tests/agents-md.test.ts` et `grep -rn "'/admin" apps packages` ne renvoie plus que des chemins d'API sous `/api/modules/admin`.

## Run interdicts
- Aucune URL ne change hors `/admin/*` → `/console/*` : la liste des URL servies avant et après la tâche 3 est identique (le test de la tâche 4 et `pnpm test:e2e` le tiennent).
- Les routes d'API du module (`/api/modules/admin/…`, `admin-routes.ts:57-65`) ne changent pas de chemin.
- Aucune redirection depuis `/admin/*`, ni vers la connexion depuis `/console/*`.
- Aucun `loading.tsx` sous `(console)` : il ferait répondre 200 avant le `notFound()` (lacune « Chargement », s29).
- `asSuperadmin` (`admin-routes.ts:182`) et les gardes par lecture de `lib/admin.ts` ne sont pas affaiblis ; la garde du layout **s'ajoute**, elle ne remplace rien.
- Les layouts `(site)`, `(auth)`, `(app)` rendent l'`AppShell` **à l'identique** : leur gabarit propre est le travail de s61, pas de cette story.
- Aucun nouveau composant dans `packages/ui` (pas de `StatCard`, lacune 2 du design) ; aucune couleur ni jeton nouveau (lacune 1).
- Pas de migration vers l'alias `@/` : les imports restent relatifs, comme dans le reste de `apps/web`.
- `robots.ts` n'ajoute pas `/console` à `disallow`.
- Le nombre de fichiers de route Next hors répartiteur reste cinq (`find apps/web/app/api -name route.ts`) : `api/` ne bouge pas.
- Aucune table, aucune migration.

## The point everything turns on
**La tâche 3 : déplacer toutes les pages sans qu'aucun comportement ne bouge**, puis poser la console par-dessus. Trois endroits où cela peut être faux :
- **La frontière 404.** L'ADR 071 suppose qu'un `notFound()` levé sous `(console)` est rendu par `app/not-found.tsx`, **au-dessus** du layout de la console, donc sans son shell. C'est la sémantique documentée des frontières de l'App Router, mais c'est une supposition : la tâche 5 la mesure dans le navigateur (corps du 404 sans badge, statut 404). Si elle est fausse, la garde du layout doit suffire seule, et le test doit le montrer.
- **L'`AppShell` dans `not-found.tsx`.** Aujourd'hui la 404 hérite du shell par le layout racine. Après la tâche 3, elle doit le rendre elle-même, sinon toute 404 perd la bannière de consentement. À comparer : une URL inconnue (`/nexiste-pas`) rend la même page avant et après la tâche 3.
- **Les dérivations de disque.** Plusieurs suites lisent `apps/web/app` et prennent le premier dossier comme segment d'URL (`tests/organizations.test.ts` pour les identifiants réservés). Si l'une lit `(site)` comme un segment, elle réserve un faux identifiant ou en perd un vrai en restant verte. À comparer : l'ensemble des segments dérivés avant et après la tâche 3 doit être identique, `admin` → `console` mis à part.

## Files touched
- `packages/core/src/module.ts` (+ un test de type dans `packages/core/src/`)
- `packages/modules/admin/src/presentation/{admin-routes.ts,back-office-screens.tsx,admin-intl.ts}`, `packages/modules/admin/src/messages/{fr,en}.json`, `packages/modules/admin/AGENTS.md`
- `packages/modules/organizations/src/presentation/organization-routes.ts`
- `packages/modules/billing/src/presentation/billing-routes.ts`
- `packages/modules/marketing/src/{module.ts,presentation/public-form-routes.ts,schema.ts}`
- `apps/web/app/layout.tsx`, `apps/web/app/not-found.tsx`
- `apps/web/app/(site)/**`, `apps/web/app/(auth)/**`, `apps/web/app/(app)/**` (déplacements + trois `layout.tsx`)
- `apps/web/app/(console)/layout.tsx`, `apps/web/app/(console)/console-shell.tsx`, `apps/web/app/(console)/console/**` (six pages déplacées + `page.tsx` du tableau de bord)
- `apps/web/lib/{back-office.ts,organizations.ts,marketing.ts}`, `apps/web/lib/console.ts` (nouveau)
- `e2e/support/warm-up.ts`, `e2e/admin.spec.ts`
- `tests/admin.test.ts`, `tests/organizations.test.ts`, `tests/rendered-text.test.ts`, `tests/zones.test.ts` (nouveau), `tests/console.test.ts` (nouveau), et les chemins d'import des autres fichiers de `tests/` qui importent une page déplacée (19 fichiers relevés en research)
- `AGENTS.md`, `apps/web/AGENTS.md`, `docs/architecture.md`
- `docs/decisions/070-…md`, `docs/decisions/071-…md`, `docs/designs/s60-console.{md,html}`, ce plan

## Test strategy
**Automatisé, comportement :**
- *Type* (`@repo/core`) : l'ancienne valeur de surface ne compile plus (critère 1).
- *Unitaire / câblage* (Vitest, `tests/`) : registre et navigation (`tests/admin.test.ts` — aucune adresse `/console` dans les surfaces `app`, `footer`, ni le plan de site) ; dérivation des tuiles (`tests/console.test.ts` — module coupé, multi-devise, échec isolé) ; partition des pages en zones et traduction des segments du préambule (`tests/zones.test.ts`) ; segments réservés (`tests/organizations.test.ts`).
- *Navigateur* (Playwright, `e2e/admin.spec.ts`) : 404 anonyme, ordinaire, emprunté, sur `/console` et un écran ; `/admin/users` en 404 sans `Location` ; 404 sans élément du shell ; shell de console (badge, langue, thème, consentement, aucun lien produit) ; tableau de bord à quatre tuiles liées.
- *Recettes* : `pnpm test:minimal-profile` (module coupé, balayage des entrées), `pnpm test:contrast`.
- Chaque invariant est tenu **une fois**, au niveau le plus proche : la garde de rôle par la lecture reste tenue par `tests/admin.test.ts` existant, pas re-testée par tuile.

**Vérification visuelle (pas de test de composant fabriqué) :** le shell et le tableau de bord à l'œil contre `docs/designs/s60-console.html`, en clair et en sombre, sur bureau et à 380 px (pas de débordement horizontal) ; plus `pnpm lint` et `pnpm typecheck`.

**Mutations attendues en revue** : remettre la redirection vers `/sign-in` (tâche 5) rougit un cas e2e ; retirer la garde du layout **et** celle de la page rougit ; rendre une tuile pour un module coupé rougit `tests/console.test.ts` ; laisser `urlSegment` lever sur `(` rougit `tests/zones.test.ts`.

## Definition of Done
- Une PR, un commit de story portant la research (déjà sur `dev`), le design, les deux ADR et ce plan.
- Les neuf critères tenus par les tests nommés ci-dessus ; `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:minimal-profile`, `pnpm test:contrast` verts.
- Aucune régression : aucune assertion existante modifiée à la tâche 3, hors chemins d'import et dérivations de disque.
- Sections de `docs/security.md` touchées : §3 (autorisation — 404 plutôt que 403, ressource d'une zone réservée) ; la CSP n'est pas touchée (nonce relu comme aujourd'hui dans chaque layout).
- `AGENTS.md` (racine, `apps/web`, module `admin`) et `docs/architecture.md` à jour dans le même commit.
- Revue passée (`/ks-review`), aucune constatation critique ouverte.
