# Research — Story s66-404-par-zone

> Vérifiée contre la branche par défaut au commit `cf16a1b`, en lecture seule.
> Exécuté : un serveur `next dev` sur le port 3170 à `2f11ae9`, et Chromium (Playwright du dépôt) comptant `[data-slot="sidebar"]` sur trois URL. Aucune base modifiée.

## The five structuring facts
1. **La régression est mesurée, pas supposée** : sous Chromium, `/fr/blog/nexiste-pas` (un `notFound()` levé par la page `(site)/blog/[slug]/page.tsx`) rend **2** barres latérales ; `/fr/nexiste-pas` (aucune route) en rend **1** ; `/fr/pricing` (200) en rend 1. Le `curl` du HTML ne le voit pas : la 404 levée par une page part dans le flux RSC, seul un navigateur la compte.
2. **Cause** : `apps/web/app/not-found.tsx` rend `<AppShell nonce>` autour de `NotFoundScreen` (s60). Un `notFound()` levé par une **page** est rendu à l'intérieur du layout de sa zone, qui fournit déjà l'`AppShell` : le shell est doublé. Pour une URL sans route, seul le layout racine enveloppe la 404 : le shell de `not-found.tsx` est alors le seul.
3. **L'hypothèse de l'ADR 071 n'est vraie que pour un `notFound()` levé par un layout** : la garde de `(console)/layout.tsx` remonte à la frontière du parent (la racine), d'où l'absence de badge mesurée en s60. Pour une page, elle est fausse.
4. **Pages qui lèvent `notFound()`, par zone** (balayage `grep -rl "notFound()"`, 27/09) : `(site)` 10 fichiers (blog, docs, legal, pricing, contact, changelog, cookies, waitlist…) ; `(auth)` 1 (`invitations/accept`) ; `(app)` 5 (organizations, premium, notifications, billing, onboarding) ; `(console)` le layout et 7 pages. Chaque zone a donc au moins une page concernée.
5. **`tests/zones.test.ts:28` ne dérive que les `page.tsx`** : un `not-found.tsx` placé dans un dossier de zone n'entre pas dans la partition et ne la casse pas.

## Target story
Voir `docs/stories.md`, s66. Critères : un seul shell sur une 404 levée par une page de chaque zone ; l'URL sans route garde l'`AppShell` et la bannière (`e2e/security-headers.spec.ts:274`) ; la garde de la console rend toujours la 404 sans son shell ; un test navigateur compte les shells ; CI verte sur `tous` et `socle` ; un ADR corrige la règle de l'ADR 071.

## Current state of the code
- `apps/web/app/not-found.tsx` : lit le nonce (`headers()`, `NONCE_HEADER`), rend `AppShell` + `NotFoundScreen`.
- `apps/web/app/not-found-screen.tsx` : le contenu (`PageHeader`, `EmptyState`), rendu seul par `tests/rendered-text.test.ts`.
- `apps/web/app/(site|auth|app)/layout.tsx` : chacun rend `<AppShell nonce>`. `(console)/layout.tsx` : garde puis `ConsoleShell`.
- Aucun `not-found.tsx` sous un dossier de zone.

## Anchor points
- Nouveau `not-found.tsx` dans `(site)`, `(auth)`, `(app)`, `(console)`, rendant `NotFoundScreen` seul.
- `apps/web/app/not-found.tsx` inchangé (URL sans route).
- `e2e/` : un parcours qui compte les shells ; `e2e/admin.spec.ts:591` (bandeau d'emprunt sur `/organizations`, module coupé en `socle`) redevient vert.

## Verified APIs / functions
- `notFound()` de `next/navigation`, levé par pages et par `(console)/layout.tsx`.
- `NotFoundScreen` (`apps/web/app/not-found-screen.tsx`), export nommé.
- `[data-slot="sidebar"]` posé par `Sidebar` (`packages/ui/src/composed/sidebar.tsx`), utilisé aussi par `ConsoleShell`.

## Traps & constraints
- **Frontière d'un layout vs d'une page** : le `not-found.tsx` de `(console)` ne doit **pas** capter le refus de la garde du layout, sinon la 404 d'un non-superadmin serait rendue dans le shell de la console. Selon la règle mesurée au fait 3, la frontière d'un segment est placée **sous** son layout : un `notFound()` du layout la contourne. À **mesurer** (e2e existant « aucun badge » de s60), pas à supposer — c'est exactement ce que s60 a supposé à tort pour les pages.
- **Le `socle` coupe des modules** : les 404 de `/organizations`, `/billing`, `/notifications` y sont levées par les pages. Le test navigateur doit couvrir au moins une page d'une zone applicative ; la configuration `tous` ne coupe rien, donc une page qui lève sur un identifiant inconnu (`/blog/<slug inconnu>`, `/legal/<inconnu>`) est le témoin portable.
- **La 404 de console pour un superadmin** (`/console/users/<id inconnu>`) sera rendue dans le shell de la console : acceptable, il sait que la console existe ; ce n'est pas une divulgation.
- `tests/rendered-text.test.ts` rend `NotFoundScreen` : ajouter quatre `not-found.tsx` qui le réutilisent ne change pas sa déclaration, mais la research ne l'a pas exécuté.

## Open questions
1. Faut-il un `not-found.tsx` dans `(console)` (superadmin sur un identifiant inconnu → 404 dans le shell de la console), ou laisser la racine (shell doublé : console + `AppShell`) ? La première voie est la seule qui ne double pas.
2. Le compteur de shells se met-il dans `e2e/security-headers.spec.ts` (qui porte déjà « l'écran du design system » d'une URL inexistante) ou dans un fichier dédié ?

## Real complexity
Cotée **2**, confirmée **2** : quatre fichiers de trois lignes, un parcours navigateur, un ADR. Le risque est concentré sur le trap « frontière d'un layout », que l'e2e de s60 mesure déjà.
