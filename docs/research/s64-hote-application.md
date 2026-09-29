# Research — Story s64-hote-application

> Vérifiée contre la branche par défaut au commit `95e5952` (s63 mergée), en lecture seule. Aucune base, aucun serveur.
> **Verdict : complexité 5 → DÉCOUPÉE** (proposition en fin de fichier).

## The five structuring facts
1. **Aucune notion d'hôte ni de zone à l'exécution.** `apps/web/proxy.ts:59-181` ne lit jamais l'hôte (`request.url` sert seulement de base à `new URL`) ; les zones n'existent que comme groupes de routes (`tests/zones.test.ts:26`). Le routage par hôte (critères 3-4) est un classement neuf du **chemin interne** (après langue) : `(site)` = `/`, blog, changelog, contact, cookies, docs, legal, pricing, waitlist ; Hors zone `(auth)` = forgot-password, invitations, oauth, reset-password, sign-in, sign-up, two-factor, verify-email ; `/app` ; `/console` ; `/api` ; anciens chemins redirigés. Ordre réel du proxy : **308 legacy (:107-118) avant** la redirection canonique de langue (:120-128) — la story dit l'inverse.
2. **L'auth tient à une seule origine exacte.** `resolveAuthConfig(env).appUrl` (`apps/web/lib/auth-config.ts:28`) alimente `baseURL` (`better-auth-service.ts:609`), `trustedOrigins: [appUrl]` (:613), passkey `rpID: new URL(appUrl).hostname` et `origin: appUrl` (:998-1003), les URL d'emails (`auth-use-cases.ts:468-471` → vérification :548, reset :641, changement d'email :724, export ~:486), les invitations (`organization-use-cases.ts:581` via `lib/organizations.ts:344`), Stripe (`billing-use-cases.ts:617` via `lib/billing.ts:228,285,382`), le guest checkout (`lib/guest-account.ts:97`). **Le rpID et l'origine passkey se séparent** : rpID = hôte d'`APP_URL`, origin = origine de l'application — `origin` accepte-t-il un tableau ? à vérifier dans better-auth 1.7.2.
3. **`guestReturnUrl` vise le site** : `billing-use-cases.ts:767` `${appUrl}/pricing${query}` ; le retour de tarifs du guest (`lib/billing.ts:331-349`) est `/sign-in?next=/pricing?offer=…`, consommé par `(site)/pricing/page.tsx:82`. Avec `APP_HOST`, `/pricing` est sur le site, qui ne voit pas la session ; `safeRedirectPath` (`auth/src/domain/redirect.ts:66`) refuse toute autre origine — le retour doit viser un écran de l'application portant l'offre.
4. **Tous les cookies sont propres à l'hôte** (aucun `Domain`) : session et défi 2FA (`defaultCookieAttributes` `sameSite: 'strict'`, `better-auth-service.ts:320-325`), consentement `app_consent` (`consent-cookie.ts:104-112`, lu `lib/consent.ts:195`), langue `app_locale` (`proxy.ts:171-177`, lu `proxy.ts:61`, `lib/current-locale.ts:44`, `lib/auth.ts:87`). **`__Host-` inaccessible** : better-auth 1.7.2 ne l'émet jamais (`cookie-utils.mjs:11,17` ne sert qu'à le retirer) ; ajouter `cookiePrefix` fait rougir `tests/rate-limiting.test.ts:895` (noms figés `two-factor.ts:166-169`).
5. **Les URL du site lisent `APP_URL` directement** et restent sur l'origine du site : `lib/site-url.ts:21,63` → `sitemap.ts:29`, `robots.ts:32`, `layout.tsx:27`, `lib/blog.ts:18`, `lib/changelog.ts:17`. Plusieurs redirections utilisent l'origine **de la requête** (`auth-routes.ts:403`, `organization-routes.ts:167,202`, notifications :101, onboarding :87, admin :148, proxy :114,126,156, `api/billing-local-checkout/route.ts:64,141,150`) — correct tant qu'elles restent sur l'hôte qui les sert.

## Target story
12 critères (`docs/stories.md` s64) : `APP_HOST` optionnelle validée ; sans elle, rien ne change ; routage des deux hôtes ; URL de session sur l'origine de l'application ; URL depuis la configuration ; cookies de session sans `Domain` mesurés au navigateur ; consentement/langue sur le domaine parent avec précédence ; retour des tarifs entre hôtes (golden-path `APP_HOST=app.localhost`) ; passkey antérieure valide ; CSP par hôte ; `docs/deployment.md` + recette manuelle à deux hôtes.

## Verified APIs / functions
- Env : `packages/config/src/env.ts` — `APP_URL` :151-157, `superRefine` :421, `ENV_KEYS` :620, `parseEnv` :651. Démarrage : `apps/web/lib/startup.ts:43,128` (appelé par `next.config.ts:6` et `instrumentation.ts:42`). `.env.example:57` ; `tests/env-example.test.ts:22-38` exige chaque clé de `ENV_KEYS`.
- CSP : `apps/web/lib/security-headers.ts:130` `form-action 'self'` ; `config/security.ts:60`.
- Garde d'origine du consentement : `consent/src/domain/request-guard.ts:12,56` compare Origin/Referer à l'hôte de `request.url`.
- Better Auth 1.7.2 : nom de cookie `${__Secure-}${cookiePrefix||'better-auth'}.${name}` (`dist/cookies/index.mjs:20-45`), `domain` seulement avec `crossSubDomainCookies`.

## Traps & constraints
- **Playwright** : `playwright.config.ts:93-100` force `APP_URL=http://localhost:PORT` ; `:151-153` fusionne `process.env` (un `APP_HOST` du shell fuit dans le serveur). Next dev bloque les origines inconnues : `app.localhost` exigera `allowedDevOrigins` (`next.config.ts`).
- **Golden-path** : `scripts/golden-path.ts:167-168,174,193-196` propage `process.env` ; `webServerEnv` fixe encore `APP_URL`.
- **Tests épinglés sur `APP_URL=http://localhost:3000`** : `tests/auth.test.ts` (31), `tests/organizations.test.ts` (47), `tests/billing.test.ts` (20), + marketing, deployment, env-wiring, sans-env, golden-path, i18n. Sans `APP_HOST` ils doivent rester verts octet pour octet (critère 2).
- **Proxy en amont** : `docs/deployment.md:220-292` ne parle que de `x-forwarded-for` ; la ligne `APP_URL` :309 dit « jamais déduite de Host ». Rien sur la transmission de `Host`.
- `form-action 'self'` : un formulaire du site qui poste vers l'hôte de l'application serait bloqué (y compris par redirection) — le choix d'offre doit donc passer par un lien (GET), pas un formulaire.
- Passkeys : changer l'hôte d'`APP_URL` invalide les passkeys (`better-auth-service.ts:978-985`) ; le rpID doit rester l'hôte d'`APP_URL`.
- Le PRD ne mentionne pas l'extension multi-hôte (constat F88) : à consigner.

## Open questions
1. `passkey({ origin })` de better-auth 1.7.2 accepte-t-il plusieurs origines (site + application, pour une passkey utilisée depuis l'un ou l'autre) ? Sinon l'origine devient celle de l'application seule.
2. Forme du retour de tarifs côté application : écran `/app/…?offer=` qui relance le checkout, ou route d'API GET de l'application qui ouvre le checkout. À trancher au plan de la tranche concernée.
3. Précédence cookie parent vs cookie d'hôte (critère 8) : les deux arrivent sous le même nom dans l'en-tête `Cookie`, sans attribut — l'ordre n'est pas garanti par la RFC 6265 au-delà du chemin. Mesure navigateur nécessaire.

## Real complexity
Cotée **4**, réévaluée **5** : quatre chantiers qui se croisent (classement de zones à l'exécution dans le proxy, séparation des origines de l'auth avec le cas passkey, cookies de domaine parent avec précédence, parcours inter-hôtes Playwright avec `allowedDevOrigins`), plus une recette manuelle à deux hôtes. Aucune migration.

## Split proposal
Chaque tranche est inerte sans `APP_HOST` (critère 2 tenu par chacune), si bien qu'un état intermédiaire ne change rien pour un déploiement à un hôte. **Tant que s64c n'est pas livrée, `docs/deployment.md` dit qu'`APP_HOST` n'est pas encore supportée en production.**
- **s64a-hote-origines** — critères 1, 2, 5, 6, 10 : `APP_HOST` validée (sous-domaine de l'hôte d'`APP_URL`) ; une résolution d'origines unique (site / application) ; toute URL qui ouvre ou consomme une session sur l'origine de l'application ; rpID passkey inchangé ; retours Stripe et guest vers l'application. Tests unitaires par parcours. Complexité 4.
- **s64b-hote-routage** — critères 3, 4, 9, 11 : classement des zones sur le chemin interne dans `proxy.ts` ; 308/404 selon l'hôte ; CSP par hôte ; retour des tarifs inter-hôtes ; Playwright `app.localhost` (`allowedDevOrigins`) et `pnpm test:golden-path` avec `APP_HOST=app.localhost`. Complexité 4.
- **s64c-hote-cookies** — critères 7, 8, 12 : cookies de session mesurés sans `Domain` au navigateur ; consentement et langue sur le domaine parent avec précédence et effacement de l'ancien ; `docs/deployment.md` (deux configurations, URI OAuth, `www`+`app`, transmission de `Host`) ; recette manuelle à deux hôtes consignée. Complexité 3.
