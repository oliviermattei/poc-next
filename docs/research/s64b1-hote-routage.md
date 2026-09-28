# Research — Story s64b1-hote-routage

> Vérifiée contre la branche par défaut au commit `e9837ac`, en lecture seule. Prolonge `docs/research/s64b-hote-routage.md` (mêmes faits de code, commit `3705f63`) : ce fichier ne répète pas ses faits, il fixe ce que la tranche 1 touche.

## The five structuring facts
1. **L'hôte demandé se lit dans `x-forwarded-host` (rempli par Next depuis `host`), jamais dans `request.url`** (parente, fait 1). Il ne sert qu'à **aiguiller** ; les cibles viennent des origines configurées de s64a (`resolveAuthConfig` : `appUrl`, `siteUrl`, `apps/web/lib/auth-config.ts`).
2. **Le proxy ne doit pas exiger tout l'environnement** : il ne lit aujourd'hui que `getNodeEnv(source)` (`packages/config/src/env.ts:831-835`), qui parse **une** clé et se replie sans lever. `getEnv()` (:846) parse tout et lèverait dans `tests/legacy-paths.test.ts`, `security-headers.test.ts`, `i18n.test.ts` (appels directs à `proxy()` sans env). Il faut un lecteur de même forme pour `APP_URL` + `APP_HOST` seulement.
3. **La garde du consentement (#66)** : `isSameSiteSubmission({ origin, referer, requestUrl })` (`consent/src/domain/request-guard.ts`) compare à `hostOf(requestUrl)`. Le module reçoit ses dépendances par `configureConsent` / `provideConsent` (`consent/src/infrastructure/consent-runtime.ts:39-47`) depuis `apps/web/lib/consent.ts` ; tests : `tests/consent.test.ts:196`, `tests/i18n.test.ts:969`. Le correctif naturel : injecter les **origines acceptées** (site + application) dans les dépendances.
4. **Origines de confiance de l'auth (#64)** : `lib/auth.ts:173-176` ajoute l'origine du site « pendant l'intérim » ; une fois les écrans Hors zone et `/api/modules/auth/*` servis par la seule application (critère 4), elle peut sortir. `(await auth.$context).trustedOrigins` existe en better-auth 1.7.2 ; le contrôle d'origine est coupé sous Vitest par défaut (`create-context.mjs:210`).
5. **Ordre du proxy** : le 308 legacy (`proxy.ts:107-118`) passe avant la langue ; toutes ses cibles sont sous `/app` → sur l'hôte du site, la cible doit être posée **directement** sur l'origine de l'application (un seul saut).

## Anchor points
- `packages/config/src/env.ts` : lecteur partiel `getHostRouting(source)` (patron `getNodeEnv`).
- `apps/web/lib/zones.ts` (nouveau) : table zone ← premier segment interne ; `tests/zones.test.ts` la compare au disque.
- `apps/web/proxy.ts` : aiguillage par hôte **avant** le legacy et la langue.
- `packages/modules/consent` : dépendance `acceptedOrigins`, garde réécrite ; `apps/web/lib/consent.ts` la fournit.
- `apps/web/lib/auth.ts:173-176` ; test des origines de confiance.

## Traps & constraints
- Hôte inconnu (ni site ni application : sonde de santé sur l'IP du conteneur, `0.0.0.0`) → **aucun aiguillage**, sinon `/api/health` redirigerait.
- `x-forwarded-host` peut porter une liste (`a, b`) : premier élément ; comparaison sur `URL.host` (hôte + port), en minuscules.
- `/api/modules/auth/*` : GET → 308 (magic link, rappels OAuth émis avant la bascule) ; tout autre verbe → 404 sur l'hôte du site.
- `robots.txt` et `sitemap.xml` sont de la zone Site (ils lisent `resolveSiteUrl`) ; `/api/health` est servi sur les deux hôtes.
- La relativisation des `Location` par Next (parente, fait 3) ne touche pas les tests unitaires du proxy ; elle ne vaut qu'au navigateur (s64b2).
- Cinq routes Next hors répartiteur : inchangées.

## Open questions
- Aucune qui bloque le plan : les décisions « hôte inconnu », « métadonnées » et « santé » sont prises au plan.

## Real complexity
**4**, conforme.
