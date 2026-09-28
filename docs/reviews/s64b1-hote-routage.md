# Review — Story s64b1-hote-routage

> Revue en contexte neuf. Chaque constat est classé critical / major / minor.
> Diff revu : `git diff dev...feature/s64b1-hote-routage` (un commit, `fa6f248`).

Review status: complete

## Plan compliance
- [x] Le code fait ce que le plan spécifie. Les 8 tâches sont présentes : `getHostRouting` + `applicationOrigin` partagé avec `resolveAuthConfig` (un seul calcul) ; `apps/web/lib/zones.ts` avec des segments applicatifs dérivés de `LEGACY_SCREEN_PATHS` ; aiguillage placé avant le 308 legacy et la langue ; `acceptedOrigins` obligatoire dans `ConsentDependencies`, `requestUrl` retiré de la garde ; `additionalTrustedOrigins` retiré de `lib/auth.ts` (l'option du module reste, comme le plan le permet) ; cas CSP ; ligne de `docs/deployment.md` ; ADR 079. Aucun ajout hors plan. `docs/security.md` n'a pas de section sur la garde du consentement, donc aucune modification n'y était due.
- [x] Interdits d'exécution vérifiés un par un. Toute cible inter-hôtes est construite sur `new URL(origin)` depuis `getHostRouting`, le chemin étant posé par `pathname` (proxy.ts:63). `security-headers.ts` et `config/security.ts` ont un diff vide. Aucun cookie n'est touché. `next.config.ts` est inchangé (pas de `trustHostHeader`). `legacy-paths.ts` est inchangé. `/api/health` n'est jamais aiguillé (zone `api`, hors préfixe auth). Aucun parcours Playwright ajouté.

## Anti-hallucination
- [x] Chaque référence a été ouverte. `envShape.APP_URL` (env.ts:193) et `appHostProblem` (env.ts:34, le même que celui du schéma à :481). `MODULE_ROUTE_PREFIX` = `/api/modules` (core/registry.ts:200). `authModule.id` = `'auth'` (module-auth/module.ts:96). `legacyScreenTarget`, `carriesLocalePrefix` et `localeRouting.publicPath` existent. Better Auth 1.7.2 : `skipOriginCheck` = `isTest()` sauf si `advanced.disableOriginCheck` est posé (create-context.mjs:210). Le `origin` de la cérémonie passkey vient de la même liste `trustedOrigins` (better-auth-service.ts:626-628, :1028).
- [x] Redirection ouverte : un chemin `//evil.com` ou `/\evil.com` est normalisé en 308 par Next avant le proxy (`resolve-routes.js:105`, `base-server.js:578`). Poser `pathname` sur une URL http(s) ne change pas l'hôte. Aucune cible n'est construite depuis un en-tête : la mutation M1 le prouve.
- [x] Le code fait ce qu'il annonce, avec les réserves des constats ci-dessous.

## Rules compliance
- [x] Conventions du dépôt respectées (point de composition, `@repo/config` comme seul lecteur de l'environnement, module sans lecture d'environnement).
- [x] Aucun ADR accepté n'est contredit. ADR 078 : les origines viennent de `resolveAuthConfig`. ADR 075 : la table legacy est lue, pas modifiée. ADR 071 : les zones suivent les dossiers.
- [x] Design system : sans objet (aucune UI).

## Tests
- [x] Registre de vérification contrôlé à la main (`ks-gate` absent) : `git diff --quiet 114918bb… HEAD -- . ':(exclude)docs'` rend 0. Le registre est **à jour**, `Verification status: complete`, tous les codes de sortie valent 0 (`pnpm lint`, `pnpm test` 3109 passés, `pnpm test:sans-env`, `pnpm typecheck`). Ces résultats sont pris comme preuve : ni la suite ni le type check n'ont été relancés. La section « Not proven here » a été lue.
- [x] Les assertions épinglent les critères. Une table `it.each` couvre les deux colonnes d'hôtes, le cas legacy en un saut, l'en-tête `x-forwarded-host` hostile et l'hôte inconnu. Les autres cas : CSP identique, absence d'`APP_HOST`, consentement sur `0.0.0.0:3000`, zones comparées au disque, cérémonie passkey refusée depuis l'origine du site. Budget : environ 10 cas ajoutés ou modifiés (la table en compte 17 lignes), sous les 25.
- [x] Mordant prouvé par neutralisation. Seuls les fichiers concernés ont été lancés, et chaque fichier a été restauré (`git diff --exit-code` propre à chaque fois) :
  - M1 cible construite depuis l'hôte demandé (proxy.ts:63) → **6 rouges**, dont le cas « x-forwarded-host hostile »
  - M2 cible legacy jamais résolue sur l'hôte du site → **1 rouge** (« un seul saut »)
  - M3 hôte inconnu traité comme le site → **1 rouge** (« hôte inconnu : rien n'est aiguillé »). La sonde de santé resterait verte sous cette mutation (`/api/health` n'est pas sous le préfixe auth) : c'est le cas console qui porte la garde.
  - M4 POST d'auth redirigé comme un GET → **1 rouge**
  - M5 console servie sur le site → **1 rouge**
  - M7 la route accepte aussi `request.url` → **1 rouge** (#66)
  - M8 la composition du consentement perd l'origine de l'application → **1 rouge**
  - M9 la garde ignore la liste → **4 rouges**
  - M10 l'origine du site remise dans `trustedOrigins` (`lib/auth.ts`) → **1 rouge** (le cas passkey à deux origines, base joignable, non ignoré)
- [x] Aucun test rendu redondant par la story. Le cas passkey « depuis l'application comme depuis le site » a été correctement inversé, pas dupliqué.

## Regressions
- [x] Sans `APP_HOST`, `getHostRouting` rend `null` et le proxy suit exactement le chemin d'avant (cas « sans APP_HOST » + suite complète verte au registre). Sans `APP_HOST`, les origines de confiance valent `[appUrl]`, comme avant (`additionalTrustedOrigins` valait déjà `[]`). Les deux autres appelants de la garde du consentement (`tests/consent.test.ts`, `tests/i18n.test.ts`) ont été mis à jour. Aucune page du site ne poste vers `/api/modules/auth/*` : l'en-tête du site pointe vers `/sign-in` par lien, et le bandeau d'impersonation poste vers le module `admin`, qui reste servi sur le site.

## Findings
- **major** — apps/web/proxy.ts:22 (`requestedHost`) + docs/deployment.md:310. `x-forwarded-host` est lu en premier, et Next ne l'écrase pas quand le client l'envoie (`base-server.js:609` : `req.headers['x-forwarded-host'] ??= req.headers['host']`). Derrière un proxy amont qui transmet l'en-tête du client tel quel (le comportement par défaut de nginx), un client choisit la branche d'aiguillage. La cible reste bien configurée : pas de redirection ouverte, ADR 079 tenu. Mais la réponse dépend d'un en-tête que ni `Vary` ni `Cache-Control` ne signalent. Avec un cache partagé indexé sur `Host`, on peut empoisonner le cache : un `X-Forwarded-Host: app.exemple.com` envoyé sur `https://exemple.com/` met en cache un 308 vers `/app` pour la page d'accueil du site. Autre exemple : sur `/pricing`, une boucle 308 site → site. Ni l'ADR 079 (§Consequences ne parle que de la transmission de `Host`) ni `deployment.md` n'exigent que le proxy amont **réécrive ou retire** `X-Forwarded-Host`. Aucune exposition aujourd'hui, puisque `APP_HOST` est marquée « pas encore supportée en production ». À corriger avant s64c : exiger l'écrasement de l'en-tête dans la doc de déploiement, et/ou poser `Cache-Control: no-store` (ou `Vary: Host, X-Forwarded-Host`) sur les réponses aiguillées.
- **minor** — apps/web/proxy.ts:78, :93, :96. Premier point signalé par l'implémenteur. Un chemin **sans préfixe de langue** (`/app/x`, `/sign-in`, `/pricing` sur l'hôte de l'application) repart tel que reçu. L'hôte d'arrivée ajoute alors un 307 de langue, soit deux sauts, alors que le critère 4 dit « en un seul saut » pour `/app/*` et les écrans Hors zone. C'est le choix explicite du plan (« le chemin public est conservé tel que reçu »), et le cas legacy (le vrai objet du critère) fait bien un seul saut. Le correctif tient en une ligne : `localeRouting.canonicalPath(localeRequest) ?? pathname` comme chemin cible.
- **minor** — apps/web/proxy.ts:89-93. Second point signalé par l'implémenteur. Un ancien chemin dont le module est coupé (`/billing` sans billing), demandé sur l'hôte du site, est redirigé tel quel vers l'hôte de l'application, qui répond 404. Avant, le 404 venait sur l'hôte demandé. Le résultat est le même pour l'utilisateur, avec un saut inter-hôtes de plus. Acceptable, mais le commentaire de `hostRoute` devrait le dire.
- **minor** — apps/web/lib/consent.ts:177. `acceptedOrigins` passe par `resolveAuthConfig`, qui **lève** sans `AUTH_SECRET`. La garde du consentement dépend donc du secret d'authentification, qui ne la concerne pas. C'est sans effet aujourd'hui (l'auth est du socle, le démarrage exige le secret), mais `getHostRouting`/`applicationOrigin` donnaient les deux origines sans ce couplage.
- **minor** — docs/deployment.md:310. Le piège de relativisation de Next (research parente, fait 3) n'est pas signalé. Si l'origine d'`APP_URL` est l'origine d'écoute (`APP_URL=http://localhost:3000` avec `APP_HOST=app.localhost` en dev), le 308 de l'hôte de l'application vers le site devient `Location: /pricing` et boucle. Le harnais relève de s64b2, mais un opérateur qui pose `APP_HOST` en local tombe dessus aujourd'hui sans avertissement.

## Not verified
- **Le contrôle d'origine propre à Better Auth** (le middleware `originCheck` sur un POST `sign-in/email` avec `Origin` du site) n'a pas été exercé : il est désarmé sous Vitest. La preuve passe par la cérémonie passkey, qui compare à **la même liste** `trustedOrigins` (vérifié dans better-auth-service.ts), et M10 montre qu'elle mord. L'écart restant est la lecture de cette liste par la bibliothèque elle-même, pas le code de la story. Il était testable sans hack (`advanced.disableOriginCheck: false`), à condition que le module expose l'option. Geste humain : sur un déploiement à deux hôtes, envoyer un `curl -X POST https://app…/api/modules/auth/sign-in/email -H 'Origin: https://site…'` et attendre un 403.
- **Rien n'a été rendu au navigateur** : ni la relativisation des `Location` par Next, ni le suivi réel des 308 entre `site.localhost` et `app.site.localhost` (s64b2).
- **Le remplissage de `x-forwarded-host` par le serveur standalone** a été lu dans le source de Next (`base-server.js:609`), pas mesuré sur l'image Docker. Geste humain : `docker compose -f docker-compose.prod.yml up` avec `APP_HOST`, puis `curl -I -H 'Host: exemple.com' http://localhost:3000/fr/console` (attendre 404) et `curl -I -H 'Host: 10.0.0.5' …/api/health` (attendre 200).
- **« Aucun formulaire d'un hôte ne redirige vers l'autre »** (critère 8) est établi par lecture : aucune page du site ne poste vers une route redirigée. Il n'est vérifié ni par un test ni au navigateur (`form-action` sur une redirection). Le formulaire des tarifs est le cas de s64b2.
- **Les variantes d'encodage du chemin** (`/%63onsole` sur l'hôte du site) n'ont pas été essayées. La console reste protégée par l'authentification, donc ce 404 n'est pas une frontière de sécurité.
- **Le build de production et l'E2E** n'ont pas été lancés, comme le veut la doctrine. Ils sont dus au ship (`Build stage: ship-if-route`, le proxy change le routage ; `E2E stage: ship`).

## Verdict
Max severity: major
Ship allowed: yes
