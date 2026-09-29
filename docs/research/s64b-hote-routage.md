# Research — Story s64b-hote-routage

> Vérifiée contre la branche par défaut au commit `3705f63` (s64a mergée), en lecture seule. Un `pnpm build` a été lancé dans le worktree pour lire le `server.js` standalone ; aucun serveur de production n'a pu démarrer (gardes des modes locaux sous `NODE_ENV=production`).
> **Verdict : complexité 5 → DÉCOUPÉE** en s64b1 et s64b2 (fin de fichier).

## The five structuring facts
1. **Prémisse fausse — l'URL de la requête ne porte pas l'hôte demandé.** Dans le proxy comme dans un gestionnaire de route, `request.url` / `nextUrl.hostname` viennent de l'**hôte d'écoute** du serveur (`next/dist/server/next-server.js:1136-1142, 1280` ; `lib/router-utils/resolve-routes.js:117`), les boucles locales réduites à `localhost` (`web/next-url.js:15-19`). L'hôte demandé n'est lisible que dans les en-têtes : `x-forwarded-host`, que Next remplit d'office depuis `host` (`base-server.js:609`). Le routage par hôte doit lire ces en-têtes — pour **aiguiller** seulement ; toute URL construite reste issue de la configuration (ADR 078).
2. **Défaut existant en production (#66)** : la garde d'origine du consentement (`consent/src/domain/request-guard.ts:12,55-65`) compare `Origin` à l'hôte de `request.url` — `0.0.0.0:3000` dans l'image (`server.js:15` `HOSTNAME || '0.0.0.0'`). Chaque choix de consentement y répondrait 403 ; invisible en dev/e2e (écoute sur `localhost`). Même question d'hôte que s64b : à corriger ici, contre les origines **configurées**.
3. **Piège du harnais : Next relativise un `Location` de même origine que l'écoute** (`resolve-routes.js:489-493`, `shared/lib/router/utils/relativize-url.js`). Avec `APP_URL=http://localhost:PORT`, un 308 de `app.localhost` vers le site devient `Location: /pricing` et boucle. Le parcours à deux hôtes doit mettre le site hors de l'origine d'écoute : `APP_URL=http://site.localhost:PORT`, `APP_HOST=app.site.localhost` (Chromium et Node résolvent `*.localhost` ; `allowedDevOrigins` inutile — `block-cross-site-dev.js` autorise `**.localhost` et ne bloque que `/_next`).
4. **Le site ne voit jamais la session avec `APP_HOST`** (cookie propre à l'hôte, `better-auth-service.ts:329-334`) : le bouton du site (`(site)/site-header.tsx:41,80-86`) montre toujours « Se connecter », et `/pricing` prend toujours le chemin invité (`(site)/pricing/page.tsx:147`, `billing-actions.tsx:81-102`, POST `fetch` vers `/api/modules/billing/billing/guest-checkout` sur l'hôte courant). `/app/settings/billing` **ne lit pas** `?offer=`. Le retour invité `${appUrl}/pricing?checkout=…` (`billing-use-cases.ts:767,892`) atterrit sur l'application et doit repartir vers le site **avec sa requête**. Le « retour des tarifs » demande donc une décision produit (où un compte connecté choisit-il une offre ?) — c'est la tranche s64b2.
5. **Zones** (premier segment du chemin **interne**) : Site = `/`, blog, changelog, contact, cookies, docs, legal, pricing, waitlist, `robots.txt`, `sitemap.xml` ; Hors zone = forgot-password, invitations, oauth, reset-password, sign-in, sign-up, two-factor, verify-email ; Application = `app` (+ anciens chemins de `legacy-paths.ts:41-54`, tous vers `/app`) ; Console = `console` ; API = `api`. Comparables au disque via `tests/zones.test.ts:26,29` et `e2e/support/warm-up.ts:62,107`. Sur l'hôte du site, le 308 legacy (`proxy.ts:107-118`) s'exécute avant tout et produirait deux sauts : le classement doit passer avant, ou la cible legacy être posée directement sur l'hôte de l'application.

## Current state of the code
- `apps/web/proxy.ts` (runtime Node, `matcher` hors `_next/static|image` :200-202) : chemin interne :89-92, legacy 308 :107-118, langue :120-128, en-têtes :130-159, cookie de langue :161-178. N'importe que `getNodeEnv` de la config ; `resolveAuthConfig` est importable (pur) mais lève sans `AUTH_SECRET`/`APP_URL` — les tests qui appellent `proxy()` (`tests/legacy-paths.test.ts:16,44`, `security-headers.test.ts:15,418`, `i18n.test.ts:28,1005`) tournent sans env.
- Better Auth après s64a : `trustedOrigins = [appUrl, ...additional]` (`better-auth-service.ts:626-638`), passkey `origin` :1028 ; `lib/auth.ts:173-176` ajoute l'origine du site. `(await auth.$context).trustedOrigins` existe (1.7.2) ; le contrôle d'origine est coupé sous Vitest (`create-context.mjs:210`) — #64.
- Formulaires : seuls ceux du consentement sont des POST natifs (`cookie-banner.tsx:58`, `consent-preferences.tsx:79`) ; les autres sont des `fetch` relatifs. Rien ne traverse les hôtes tant que le site sert `/api/modules/{marketing,billing,consent}`.
- Playwright : `playwright.config.ts:23-27,93-100,223,236-238` (un projet, `APP_URL: BASE_URL`) ; golden-path `playwright.golden-path.config.ts:3,81-93`, `scripts/golden-path.ts:167-195`, `.env.example:64` `APP_HOST=` vide.

## Traps & constraints
- `x-forwarded-host` est contrôlé par le client sans proxy amont : il ne doit **jamais** fonder une URL ni une décision de sécurité — seulement un aiguillage vers un hôte configuré.
- `robots.txt`, `sitemap.xml`, `/api/health` sur l'hôte de l'application : le texte de la story est muet (décision de plan).
- `e2e/support/locale.ts:38-39` `urlOf` ne distingue pas `app.localhost` de `localhost`.
- CI Linux : résolution de `*.localhost` par Node non vérifiée.

## Open questions
1. s64b2 : où un compte connecté choisit-il une offre quand le site ne voit pas la session — lien du site vers `/app/settings/billing?offer=` (écran qui propose de confirmer), ou le site ne propose que le chemin invité ? (question produit ; parité à montrer).
2. Hôte des fichiers de métadonnées sur l'application : servis ou 404.

## Real complexity
Cotée **4**, réévaluée **5** : routage à deux hôtes sur des en-têtes (fait 1), harnais e2e à deux origines avec le piège de relativisation (fait 3), un défaut de production à corriger au passage (fait 2), et un parcours de tarifs qui demande une décision produit (fait 4).

## Split proposal
- **s64b1-hote-routage** — critères : classement des zones (table comparée au disque), 308/404 par hôte, rien sans `APP_HOST`, CSP inchangée et aucun formulaire inter-hôtes ; **+ #66** (garde du consentement contre les origines configurées) ; **+ #64** (origines de confiance testées, origine du site retirée une fois l'auth servie par la seule application) ; harnais e2e à deux origines (`site.localhost` / `app.site.localhost`). Complexité 4.
- **s64b2-hote-tarifs** — critères : retour des tarifs entre les deux hôtes (connecté et invité, requête conservée), `pnpm test:golden-path` joué avec `APP_HOST`. Complexité 3.
