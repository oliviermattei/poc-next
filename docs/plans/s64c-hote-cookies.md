---
validated: yes
---
# Plan — Story s64c-hote-cookies

Branch: `feature/s64c-hote-cookies`
Research: `docs/research/s64c-hote-cookies.md` — lire d'abord. ADR: `docs/decisions/081-l-hote-se-lit-dans-host-seul.md` (amende ADR 079). Pas de design (aucune UI).

## Target story
Session et défi 2FA propres à l'hôte de l'application (mesuré au navigateur) ; consentement et langue sur le domaine parent, le parent fait foi, l'ancien est effacé ; aiguillage sans empoisonnement de cache (#67) ; `docs/deployment.md` complet ; recette manuelle à deux hôtes préparée ; extension multi-hôte consignée au PRD.

## Decisions (ne pas re-décider)
| Sujet | Décision |
|---|---|
| Domaine parent | Avec `APP_HOST` : `Domain=<hôte d'APP_URL, sans port>` pour `app_consent` et `app_locale`. Sans `APP_HOST` : aucun `Domain` (inchangé, octet pour octet). Valeur calculée une seule fois depuis `getHostRouting` / `resolveAuthConfig`, jamais depuis un en-tête. |
| Consentement | Dépendance du module `cookieDomain: string \| null` (**obligatoire**, `null` = propre à l'hôte) passée par `apps/web/lib/consent.ts`. `consentSetCookie(…, { domain })` ; quand `domain !== null`, la route émet **aussi** un effacement de la copie d'hôte (`app_consent=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, sans `Domain`) — `Headers.append`, deux `set-cookie`. |
| Langue | `proxy.ts` : `domain` posé sur `app_locale` quand `APP_HOST` ; effacement de la copie d'hôte à la même écriture (append **après** `cookies.set`). |
| Doublons à la lecture | Le proxy, quand `APP_HOST` est posée et qu'un nom (`app_locale` ou `app_consent`) apparaît **deux fois** dans l'en-tête `Cookie`, ajoute à sa réponse l'effacement de la copie d'hôte de ce nom. Aucune ré-émission de valeur (la durée du consentement n'est jamais prolongée). La valeur retenue reste celle de Next (dernière = la plus récente = le parent). |
| `lib/auth.ts:87` | Lecture de la **dernière** occurrence d'`app_locale` (même règle que Next), par le parseur de cookies de Next ou une fonction équivalente. |
| Hôte (#67, ADR 081) | `proxy.ts` lit `host` seul ; les 308 d'aiguillage portent `Cache-Control: no-store`. |
| Session | Aucun changement de code. Test unitaire : les `Set-Cookie` de connexion (session) et du défi 2FA ne portent aucun `Domain`. Mesure navigateur dans le parcours doré en mode split : après la connexion, `context.cookies(siteOrigin)` ne contient ni cookie de session ni de défi, `context.cookies(appOrigin)` contient la session ; après un choix de consentement, `app_consent` a le domaine du site (`.site.localhost`) et est visible des deux origines. |
| Documentation | `docs/deployment.md` : section « Deux hôtes » (configurations un hôte / deux hôtes, `APP_URL` = apex, coût de `www`+`app` — `APP_URL` passe à l'apex, `rpID` change, passkeys à réenregistrer), transmission de `Host` (nginx `proxy_set_header Host $host;`, Traefik `passHostHeader` par défaut, Caddy par défaut), URI de rappel OAuth sur l'**origine de l'application**, cookies ; retrait de « pas encore supportée » ; **recette manuelle** pas à pas (TLS local via Caddy, deux noms, parcours à jouer, trace à consigner). |
| Recette manuelle | Écrite, **non jouée** par l'agent (exige un humain, TLS et DNS) : issue GitHub « à jouer par un humain » ouverte au ship, citée dans la revue. |
| PRD | `docs/prd.md` : ligne du périmètre « Déploiement » — hôte d'application optionnel (`APP_HOST`), décision du porteur du 27/09, stories s64a-s64c ; F88 noté fermé dans `docs/reviews/stories.md` (docs de cadrage : commités sur la branche avec la story, la PR les porte vers `dev`). |

## Tasks (ordered)
1. [x] ADR 081 appliqué : `host` seul + `no-store` dans `proxy.ts`. Tests : `tests/host-routing.test.ts` — le cas hostile passe de `x-forwarded-host` à « `x-forwarded-host` ignoré » ; en-tête `cache-control` sur un 308 d'aiguillage.
2. [x] Consentement : `cookieDomain`, double `set-cookie`. Tests : `consent/src/domain/consent.test.ts` (attributs avec / sans domaine) ; `tests/consent.test.ts` (route : deux `set-cookie` avec `APP_HOST`, un seul et identique à avant sans).
3. [x] Langue et doublons dans `proxy.ts`. Tests : `tests/i18n.test.ts` ou `tests/host-routing.test.ts` — domaine posé avec `APP_HOST`, absent sans ; doublon → effacement de la copie d'hôte ; pas de doublon → aucun effacement ; valeur retenue = dernière.
4. [x] `lib/auth.ts:87` : dernière occurrence. Test : la langue d'un email suit la dernière occurrence.
5. [x] Session sans `Domain` : test unitaire (`tests/auth.test.ts`, à côté de :820).
6. [x] Mesure navigateur : pas du parcours doré en mode split (session propre à l'application, consentement au domaine parent).
7. [x] Docs : `docs/deployment.md`, `docs/prd.md`, `docs/reviews/stories.md` (F88).
8. [x] Vérification : `pnpm typecheck`, `pnpm lint`, `pnpm test` (une fois), `pnpm test:sans-env`, `GOLDEN_PATH_PAYMENTS=simulated GOLDEN_PATH_HOSTS=split pnpm test:golden-path` et le régime à un hôte ; `docs/verif/s64c-hote-cookies.md`.

## Run interdicts
- Aucun `Domain` ni `crossSubDomainCookies` sur la session, le défi 2FA ou le cookie d'emprunt ; `better-auth-service.ts` inchangé.
- Aucune ré-émission d'une valeur de consentement hors d'un choix du visiteur.
- Sans `APP_HOST`, les `set-cookie` émis sont identiques à ceux de `dev`.
- Aucune lecture de `x-forwarded-host` dans `apps/web`.
- `tests/rate-limiting.test.ts:886` : noms des cookies 2FA inchangés.

## The point everything turns on
L'effacement de la copie d'hôte : (a) il doit être **sans** `Domain` (sinon il efface le parent) — le test d'attributs le mesure ; (b) il doit être ajouté **après** `cookies.set` du même nom (sinon écrasé) ; (c) la valeur lue en cas de doublon doit être celle du parent — vraie par l'ordre de création, à confirmer au navigateur dans le parcours doré ; (d) Chromium doit accepter `Domain=site.localhost` depuis `app.site.localhost` — si non, stopper et rapporter.

## Files touched
`apps/web/proxy.ts`, `apps/web/lib/consent.ts`, `apps/web/lib/auth.ts`, `packages/modules/consent/src/{domain/consent-cookie.ts,application/consent-use-cases.ts,presentation/consent-routes.ts}`, tests, `e2e/golden-path/golden-path.spec.ts`, `docs/deployment.md`, `docs/prd.md`, `docs/reviews/stories.md`, `docs/decisions/081-*.md`.

## Test strategy
Budget 25 ; visé ~10. **Neutralisations** : effacement avec `Domain` → cas d'attributs rouge ; `x-forwarded-host` relu → cas hostile rouge ; domaine posé sans `APP_HOST` → cas « identique à avant » rouge ; regex de `lib/auth.ts` en première occurrence → cas langue rouge ; session avec `Domain` → cas session rouge. E2E et build au ship (le proxy change → build joué).

## Definition of Done
Critères de s64c cochés, sauf la recette manuelle (préparée, issue ouverte pour un humain) ; commandes vertes consignées ; `Closes #67` ; un commit, PR vers `dev`, revue sans critique.
