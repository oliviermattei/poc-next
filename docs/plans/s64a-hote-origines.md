---
validated: yes
---
# Plan — Story s64a-hote-origines

Branch: `feature/s64a-hote-origines`
Research: `docs/research/s64a-hote-origines.md` (et la parente `docs/research/s64-hote-application.md`) — lire d'abord.
ADR: `docs/decisions/078-deux-origines-une-resolution.md`. Pas de design (aucune UI).

## Target story
`APP_HOST` facultative et validée ; sans elle, rien ne change ; avec elle, toute URL qui ouvre ou consomme une session vise l'origine de l'application, construite depuis la configuration ; les URL du site restent sur `APP_URL` ; le `rpID` des passkeys reste l'hôte d'`APP_URL` ; `docs/deployment.md` dit que la variable n'est pas encore supportée en production.

## Decisions (ne pas re-décider)
| Sujet | Décision |
|---|---|
| Forme d'`APP_HOST` | Un **nom d'hôte** seul (pas de schéma, de port ni de chemin), minuscules, `z.string()` facultative dans `packages/config/src/env.ts` ; valeur vide = absente (patron existant). |
| Règles croisées (`superRefine`) | Refus, **en nommant `APP_HOST`**, si : `APP_URL` absente ; `APP_HOST` n'est pas un nom d'hôte valide ; `APP_HOST` n'est pas `<label(s)>.` + hôte d'`APP_URL` (égal, frère, ou sans rapport refusés) ; `APP_URL` porte un chemin autre que `/`. |
| Résolution | `resolveAuthConfig(env)` rend `{ secret, appUrl, siteUrl, passkeyRpId }`. Sans `APP_HOST` : `appUrl = siteUrl =` la chaîne d'`APP_URL` **telle quelle** (critère 2, octet pour octet), `passkeyRpId = new URL(APP_URL).hostname`. Avec : `appUrl = <schéma d'APP_URL>//APP_HOST[:port d'APP_URL]` (sans barre finale), `siteUrl` = `APP_URL`, `passkeyRpId` = hôte d'`APP_URL`. |
| Module auth | Deux options **facultatives** de `configureAuth` / `createBetterAuthService` : `passkeyRpId` (défaut : hôte d'`appUrl`, comportement actuel) et `additionalTrustedOrigins: readonly string[]` (défaut `[]`). Les appels existants des tests ne changent pas. `cookiePrefix` interdit (`tests/rate-limiting.test.ts:895`). |
| Origines de confiance (intérim) | Avec `APP_HOST` : `trustedOrigins = [appUrl, origine du site]` et `passkey.origin = [appUrl, origine du site]` — tant que s64b n'a pas routé les zones, le site sert encore les écrans d'auth ; les deux origines appartiennent au propriétaire. s64b pourra resserrer (le noter dans l'ADR). |
| Appelants | `lib/auth.ts`, `lib/organizations.ts`, `lib/billing.ts` continuent de lire `appUrl` (devenu l'application) ; `lib/auth.ts` passe en plus `passkeyRpId` et `additionalTrustedOrigins`. Aucun module ne lit l'environnement. `lib/site-url.ts` inchangé. |
| `guestReturnUrl` (`/pricing`) | Suit `appUrl` sans changement de forme ; son routage entre hôtes est s64b (critère « retour des tarifs »). Écrit dans la section Consequences de l'ADR. |
| Documentation | `.env.example` : `APP_HOST=` commentée ; `docs/deployment.md` : ligne `APP_HOST` du tableau des variables avec « **pas encore supportée en production** (tranches s64b, s64c) » ; `AGENTS.local.md` : phrase de la convention Deployment si elle nomme `APP_URL` comme origine unique. |

## Tasks (ordered)
1. [x] **Env** : clé + règles croisées dans `packages/config/src/env.ts` ; `.env.example`. Tests : `packages/config/src/env.test.ts` (ou le fichier qui teste déjà `superRefine`) — un cas paramétré « refusé en nommant `APP_HOST` » (malformée, égale, frère, sans rapport, `APP_URL` avec chemin) + un cas accepté (`app.localhost` sous `http://localhost:3000`, `app.exemple.com` sous `https://exemple.com`).
2. [x] **Résolution** : `auth-config.ts`. Tests : `tests/auth-config.test.ts` (existant ou nouveau) — sans `APP_HOST`, `appUrl === APP_URL` littéral (y compris une valeur avec barre finale) ; avec, les quatre champs ; le port est conservé.
3. [x] **Module auth** : options `passkeyRpId`, `additionalTrustedOrigins` ; `lib/auth.ts` les passe. Test : configuration du plugin passkey et `trustedOrigins` observées sur le service construit avec `APP_HOST` (`rpID` = hôte du site, `origin` contient l'application).
4. [x] **Un test par parcours** (`tests/auth.test.ts`, `tests/organizations.test.ts`, `tests/billing.test.ts`, `tests/guest-*.test.ts` selon où chaque parcours est déjà testé) : avec `APP_HOST=app.localhost` et `APP_URL=http://localhost:3000`, l'URL émise commence par `http://app.localhost:3000` pour — magic link, email de vérification, réinitialisation, changement d'email, export de données, retour OAuth (URL de rappel dérivée de `baseURL`), invitation, mot de passe du guest checkout, retour de checkout et de portail Stripe. **Un cas paramétré par fichier**, pas un cas par ligne.
5. [x] **URL du site** : un cas qui construit l'app avec `APP_HOST` et vérifie que `resolveSiteUrl`/`metadataBaseUrl` rendent l'origine d'`APP_URL`.
6. [x] **Docs** (`.env.example`, `docs/deployment.md`, `docs/architecture.md` si une phrase parle de l'origine unique).
7. [x] **Vérification** : `pnpm typecheck`, `pnpm lint`, `pnpm test` une fois en fin, `pnpm test:sans-env` (le nouvel `APP_HOST` ne doit rien exiger d'un fichier de test) ; `docs/verif/s64a-hote-origines.md`.

## Run interdicts
- `apps/web/proxy.ts`, `apps/web/lib/security-headers.ts`, `config/security.ts` : diff vide (routage et CSP = s64b).
- Aucun cookie modifié : pas de `Domain`, pas de `cookiePrefix`, pas de `crossSubDomainCookies` (s64c).
- `apps/web/lib/site-url.ts` et ses consommateurs : diff vide.
- Aucune lecture de `headers.get('host')`, `nextUrl.host` ni `x-forwarded-host` ajoutée.
- Aucun `process.env` hors du module de configuration.
- Sans `APP_HOST`, aucune assertion existante sur `http://localhost:3000` ne change.

## The point everything turns on
La résolution d'origines. Où elle peut être fausse : (a) critère 2 — une re-sérialisation par `new URL` ajoute une barre finale à `appUrl` sans `APP_HOST` et fait dériver tous les liens ; comparer les tests épinglés, inchangés ; (b) le `rpID` doit rester l'hôte d'`APP_URL` **avec** `APP_HOST` — comparer au service construit, pas à `auth-config.ts` seul ; (c) la règle « sous-domaine » : `evilexemple.com` ne doit pas passer pour un sous-domaine d'`exemple.com` (suffixe `.` + hôte, pas `endsWith(hôte)`). Second risque : un parcours qui ne passe pas par `appUrl` (ex. local payments `local-payments.ts:308`) — le test par parcours doit le trouver.

## Files touched
`packages/config/src/env.ts` (+ test), `.env.example`, `apps/web/lib/auth-config.ts`, `apps/web/lib/auth.ts`, `packages/modules/auth/src/infrastructure/better-auth-service.ts` (+ runtime / options), tests listés, `docs/deployment.md`, `docs/decisions/078-*.md`.

## Test strategy
Budget 25 ; visé ~10 cas (paramétrés). Env (2), résolution (2), service auth passkey/origines (1), un cas paramétré par fichier de parcours (≈4), URL du site (1). **Neutralisations** : règle de suffixe remplacée par `endsWith(hôte)` → le cas « sans rapport »/`evil` rougit ; `passkeyRpId` ignoré → le cas passkey rougit ; `appUrl` = `APP_URL` même avec `APP_HOST` → les cas de parcours rougissent. E2E et build : au ship (aucune route modifiée → build probablement sauté, `Build stage: ship-if-route`).

## Definition of Done
Critères de s64a cochés ; `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:sans-env` verts, consignés ; neutralisations constatées en revue ; ADR 078 ; un commit, PR vers `dev`, revue sans critique.
