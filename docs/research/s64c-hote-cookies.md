# Research — Story s64c-hote-cookies

> Vérifiée contre la branche par défaut au commit `a5c5cc6` (s64b2 mergée), en lecture seule. Aucune base, aucun serveur. Prolonge `docs/research/s64-hote-application.md` (fait 4), dont les numéros de ligne du proxy et de `lib/consent.ts` ont bougé (ci-dessous, à jour).

## The five structuring facts
1. **Deux cookies non sensibles seulement** : `app_consent` (`consent/src/domain/consent-cookie.ts:18`, construit :104-112, `Path=/; Max-Age=182 j; HttpOnly; Secure; SameSite=Lax`, **sans `Domain`** ; seul émetteur `consent-routes.ts:123`, en-tête posé par un littéral d'objet — un seul `set-cookie` possible ; lu `apps/web/lib/consent.ts:212`) et `app_locale` (`lib/locale-routing.ts:40` ; seul émetteur `proxy.ts:284-290`, `response.cookies.set`, sans `domain` ; lu `proxy.ts:162`, `lib/current-locale.ts:44`, `lib/auth.ts:87`). Aucun autre cookie applicatif hors session.
2. **Prémisse à préciser — « le parent fait foi » ne se lit pas dans la requête** : l'en-tête `Cookie` ne porte pas de `Domain`. Next garde la **dernière** occurrence d'un nom (`@edge-runtime/cookies/index.js:48-65`, `map.set`), et le navigateur ordonne deux cookies de même chemin par **date de création** croissante : le plus récent gagne. Une fois `APP_HOST` posée, toute écriture part sur le parent, donc le parent est toujours le plus récent → il fait foi par construction. L'**effacement** de l'ancien se fait sans le reconnaître : un `Set-Cookie` du même nom **sans `Domain`** et `Max-Age=0` n'efface que la copie propre à l'hôte. Exception : `lib/auth.ts:87` lit la **première** occurrence (regex) — à aligner.
3. **Session et défi 2FA déjà propres à l'hôte** : `SESSION_COOKIE_ATTRIBUTES` sans `domain` (`better-auth-service.ts:329-334`), pas de `crossSubDomainCookies` (:826-848) ; le cookie d'emprunt n'émet `Domain` que si la bibliothèque en porte (`auth/src/domain/impersonation.ts:74-75`). **Aucun test n'affirme l'absence de `Domain`**, et aucune mesure navigateur (critère 1).
4. **#67** : `proxy.ts:23-24` lit `x-forwarded-host` puis `host` ; aucun `Cache-Control`/`Vary` sur les 308 d'aiguillage (`proxy.ts:68`), et un 308 est cachable par heuristique. Lire **`host` seul** retire le vecteur contrôlé par le client (un cache indexe par `Host`) ; les 308 d'aiguillage `no-store` évitent qu'un navigateur fige une configuration d'hôtes changée.
5. **Documentation fausse avec `APP_HOST`** : `docs/deployment.md:333,335` donne les rappels OAuth en `<APP_URL>/api/modules/auth/callback/…`, alors que `baseURL` = `appUrl` (`auth-config.ts:61`) ; `:310` dit « pas encore supportée » ; `:220-292` ne parle que de `x-forwarded-for`. Le PRD (`docs/prd.md`) ne mentionne aucun hôte ; F88 ouvert (`docs/reviews/stories.md:40,93`).

## Anchor points
- Consentement : dépendance `cookieDomain: string | null` (module), `consentSetCookie` + effacement de la copie d'hôte ; route : `Headers.append`.
- Proxy : `app_locale` sur le parent quand `APP_HOST` ; effacement des doublons (`app_locale`, `app_consent`) quand le nom apparaît deux fois dans l'en-tête `Cookie` ; lecture de `host` seul ; `no-store` sur les 308 d'aiguillage.
- `lib/auth.ts:87` : dernière occurrence.
- Parcours doré (mode split) : `page.context().cookies(origin)` après la connexion (`golden-path.spec.ts:300+`, :414-437).
- `docs/deployment.md`, `docs/prd.md`.

## Traps & constraints
- `response.cookies.set` est indexé par nom (`index.js:292-296`) : un effacement et une écriture du même nom s'écrasent ; `replace()` (:313-318) supprime tous les `set-cookie`. Ajouter l'effacement par `headers.append('set-cookie', …)` **après** tout `cookies.set`.
- **Ne pas ré-émettre** un cookie de consentement à chaque requête pour le migrer : cela prolongerait sa durée au-delà du choix du visiteur (durée de conservation du consentement).
- `www` + `app` : `APP_HOST` doit être un sous-domaine de l'hôte d'`APP_URL` ; `Domain=www.x.com` n'atteint pas `app.x.com` — d'où « APP_URL = apex » dans la doc.
- `upgrade-insecure-requests` en production (`security-headers.ts:139`) et cookies `Secure` : une recette de production locale exige TLS (Caddy, certificats locaux) ; noms `__Secure-` en production.
- `Domain=site.localhost` posé depuis `app.site.localhost` : acceptation par Chromium à **mesurer** dans le parcours doré.
- Tests existants d'attributs : `tests/auth.test.ts:820`, `tests/i18n.test.ts:1015,1054`, `consent/src/domain/consent.test.ts:160-165`, `e2e/i18n.spec.ts:133`.

## Open questions
- Recette manuelle à deux hôtes (critère 4) : exige un humain et un vrai déploiement (TLS, DNS) — l'agent ne peut que l'écrire et la préparer.

## Real complexity
Cotée **3**, réévaluée **3-4** : peu de code (deux cookies, un en-tête, une lecture d'hôte), mais une mesure navigateur et une documentation de déploiement conséquente.
