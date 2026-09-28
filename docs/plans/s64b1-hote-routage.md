---
validated: yes
---
# Plan — Story s64b1-hote-routage

Branch: `feature/s64b1-hote-routage`
Research: `docs/research/s64b1-hote-routage.md` et la parente `docs/research/s64b-hote-routage.md` — lire d'abord.
ADR: `docs/decisions/079-l-hote-aiguille-la-configuration-construit.md` (prolonge ADR 078). Pas de design (aucune UI).

## Target story
Avec `APP_HOST`, le proxy aiguille chaque zone vers son hôte (308 en un saut, 404 pour la console sur le site, règle GET/autres verbes pour `/api/modules/auth/*`) ; sans `APP_HOST`, rien ne change ; la garde du consentement et les origines de confiance de l'auth comparent aux origines configurées (#66, #64) ; CSP inchangée ; redirections mesurées sur le proxy.

## Decisions (ne pas re-décider)
| Sujet | Décision |
|---|---|
| Lecture de l'env dans le proxy | `getHostRouting(source = process.env)` dans `packages/config/src/env.ts`, patron `getNodeEnv` : parse `APP_URL` et `APP_HOST` seulement, **ne lève jamais** ; rend `null` si `APP_HOST` absente ou invalide (le démarrage l'a déjà refusée), sinon `{ siteOrigin, appOrigin }` (même calcul que `resolveAuthConfig` — **une seule fonction de calcul partagée**, `auth-config.ts` la réutilise ou l'inverse ; pas deux implémentations). |
| Hôte demandé | `x-forwarded-host` (premier élément d'une liste, `trim`) sinon `host`, en minuscules ; comparé à `new URL(origin).host` (hôte + port). Ni site ni application → **aucun aiguillage**. |
| Table des zones | `apps/web/lib/zones.ts` : `zoneOf(internalPath)` → `'site' \| 'outside' \| 'app' \| 'console' \| 'api'` sur le premier segment. Site = `''` (racine), blog, changelog, contact, cookies, docs, legal, pricing, waitlist, `robots.txt`, `sitemap.xml` ; outside = forgot-password, invitations, oauth, reset-password, sign-in, sign-up, two-factor, verify-email ; app = `app` **+ premiers segments des clés de `LEGACY_SCREEN_PATHS`** (dérivés, pas recopiés) ; console = `console` ; api = `api`. Segment inconnu → `null` (404 de Next, pas d'aiguillage). |
| Hôte de l'application | app, console, outside, api : servis. `/` (chemin interne vide) → 308 `appOrigin + publicPath('/app', locale)`. site → 308 `siteOrigin + chemin public + requête`. |
| Hôte du site | app et anciens chemins → 308 `appOrigin` + **cible finale** (cible legacy si c'en est un, sinon le chemin) + requête, **un saut** ; outside → 308 `appOrigin` + chemin + requête ; console → **404** (réponse du proxy, sans redirection) ; `api/modules/auth/*` → GET/HEAD : 308 `appOrigin` ; autre verbe : 404 ; reste de `api` et site : servis. |
| Ordre dans `proxy()` | Aiguillage par hôte **avant** le 308 legacy et la redirection de langue ; le chemin public (préfixe de langue) est conservé tel que reçu dans la cible. Les en-têtes de sécurité s'appliquent à la réponse d'aiguillage (`withSecurityHeaders`). |
| Codes | 308 partout (méthode conservée) ; 404 console sur le site. |
| Consentement (#66) | `ConsentDependencies` gagne `acceptedOrigins: readonly string[]` (**obligatoire**). `isSameSiteSubmission({ origin, referer, acceptedOrigins })` : l'hôte déclaré doit être celui d'une origine acceptée ; le paramètre `requestUrl` disparaît. `apps/web/lib/consent.ts` fournit `[siteOrigin, appOrigin]` dédoublonnées depuis `resolveAuthConfig`. Les deux appels de tests (`tests/consent.test.ts:196`, `tests/i18n.test.ts:969`) passent l'origine de leur fixture. |
| Auth (#64) | `lib/auth.ts` ne passe plus l'origine du site (`additionalTrustedOrigins` retirée de l'appel ; l'option du module reste pour d'autres besoins, ou est supprimée si plus aucun appelant — au choix du plus petit diff). Test : `(await auth.$context).trustedOrigins` égale `[appUrl]` avec `APP_HOST` ; et, si better-auth 1.7.2 le permet sans hack (`advanced.disableOriginCheck: false` dans un service de test), un POST d'auth avec `Origin` du site est refusé. |
| CSP | Aucun changement de `security-headers.ts` ; un cas vérifie la même politique sur une réponse des deux hôtes. |

## Tasks (ordered)
1. [x] `getHostRouting` + calcul d'origines partagé avec `resolveAuthConfig`. Tests : `packages/config/src/env.test.ts` (absente → `null` ; présente → origines ; invalide → `null` sans lever).
2. [x] `apps/web/lib/zones.ts` + cas dans `tests/zones.test.ts` : chaque premier segment de page de `(site)`, `(auth)`, `(app)`, `(console)` et chaque fichier de métadonnées/`api` est classé dans la zone de son dossier ; chaque clé legacy est `app`.
3. [x] Aiguillage dans `proxy.ts`. Tests : `tests/host-routing.test.ts` (nouveau) — requêtes `NextRequest` avec en-têtes `host` / `x-forwarded-host`, `vi.stubEnv` pour `APP_URL`/`APP_HOST` ; une table de cas paramétrée (≈ 14 lignes, **un seul `it.each`**) couvrant chaque ligne des deux colonnes « Hôte de l'application » et « Hôte du site », l'ancien chemin en un saut, la langue et la requête conservées, la cible construite depuis la configuration même avec un `x-forwarded-host` hostile, l'hôte inconnu non aiguillé ; + un cas « sans `APP_HOST` : aucune réponse d'aiguillage » (les suites existantes du proxy restent vertes).
4. [x] Consentement (#66). Test dans `tests/consent.test.ts` : soumission avec `Origin` = origine configurée alors que `request.url` porte `http://0.0.0.0:3000` → 303 ; `Origin` étrangère → 403.
5. [x] Auth (#64) : retrait de l'origine du site ; test des origines de confiance.
6. [x] CSP : un cas (dans `tests/host-routing.test.ts`) — même en-tête CSP sur une réponse aiguillée et une réponse servie.
7. [x] Docs : `docs/deployment.md` (le tableau `APP_HOST` garde « pas encore supportée en production » ; ajouter que l'hôte demandé est lu dans `x-forwarded-host`/`host` pour aiguiller seulement) ; `docs/security.md` si une section parle de la garde d'origine du consentement.
8. [x] Vérification : `pnpm typecheck`, `pnpm lint`, `pnpm test` (une fois en fin), `pnpm test:sans-env` ; `docs/verif/s64b1-hote-routage.md`.

## Run interdicts
- Aucune URL construite depuis `host`, `x-forwarded-host` ou `request.url` pour une cible **inter-hôtes** ; les cibles viennent de `getHostRouting`.
- `apps/web/lib/security-headers.ts`, `config/security.ts` : diff vide.
- Aucun cookie modifié (s64c) ; pas de `experimental.trustHostHeader` dans `next.config.ts`.
- `apps/web/lib/legacy-paths.ts` : table inchangée (lue, pas modifiée).
- Cinq routes Next hors répartiteur : inchangées ; `/api/health` jamais aiguillé.
- Pas de parcours Playwright à deux origines (s64b2).

## The point everything turns on
L'aiguillage par en-tête. Où il peut être faux : (a) une cible construite avec l'hôte reçu au lieu de l'origine configurée — le cas « `x-forwarded-host` hostile » doit rougir si l'on utilise l'en-tête ; (b) l'ordre : si le legacy 308 passe avant l'aiguillage, `/billing` sur le site fait deux sauts — le cas « un saut » le mesure ; (c) l'hôte inconnu doit tout servir (sonde de santé) ; (d) la garde du consentement ne doit plus regarder `request.url` du tout — un `Origin` égal à `0.0.0.0:3000` doit être **refusé** désormais.

## Files touched
`packages/config/src/env.ts` (+ test), `apps/web/lib/auth-config.ts`, `apps/web/lib/zones.ts`, `apps/web/proxy.ts`, `apps/web/lib/consent.ts`, `apps/web/lib/auth.ts`, `packages/modules/consent/src/{domain/request-guard.ts,presentation/consent-routes.ts,infrastructure/consent-runtime.ts}` (+ types), `packages/modules/auth/src/infrastructure/better-auth-service.ts` (si l'option est retirée), tests : `tests/{zones,host-routing,consent,i18n,auth}.test.ts`, `docs/deployment.md`.

## Test strategy
Budget 25 ; visé ~10 cas (dont un `it.each` de ≈ 14 lignes compté comme un cas). **Neutralisations à prouver** : cible construite depuis `x-forwarded-host` → le cas hostile rougit ; aiguillage placé après le legacy → le cas « un saut » rougit ; garde du consentement rendue à `requestUrl` → le cas `0.0.0.0` rougit ; origine du site remise dans `trustedOrigins` → le cas auth rougit ; hôte inconnu aiguillé → le cas santé rougit. E2E et build au ship (`Build stage: ship-if-route` : le proxy change le routage → **build joué**).

## Definition of Done
Critères de s64b1 cochés ; `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:sans-env` verts, consignés ; #64 et #66 fermées par la PR (`Closes #64`, `Closes #66`) ; ADR 079 ; un commit, PR vers `dev`, revue sans critique.
