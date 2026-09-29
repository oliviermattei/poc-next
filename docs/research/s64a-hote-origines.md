# Research — Story s64a-hote-origines

> Vérifiée contre la branche par défaut au commit `e7011d2` (s63 mergée, s64 découpée), en lecture seule. Aucune base, aucun serveur.
> Prolonge `docs/research/s64-hote-application.md` (même commit de code `95e5952`) : ce fichier ne répète pas ses faits, il tranche ce qui concerne la tranche 1.

## The five structuring facts
1. **Le point d'appui existe et il est unique côté application** : `resolveAuthConfig(env)` (`apps/web/lib/auth-config.ts:26-41`) rend `{ secret, appUrl }` et n'a que quatre appelants — `lib/auth.ts:164-170` (Better Auth + emails d'auth), `lib/organizations.ts:344` (invitations), `lib/billing.ts:228,285,382` (Stripe, local payments, guest), `lib/startup.ts:128` (garde de démarrage). Les modules ne lisent jamais l'environnement : ils reçoivent `appUrl` injecté. Faire rendre à ce point l'**origine de l'application** déplace d'un coup toutes les URL de session (fait 2 de la research parente).
2. **Les passkeys demandent deux valeurs distinctes, et le module n'en reçoit qu'une** : `better-auth-service.ts:998-1003` dérive `rpID` **et** `origin` du même `options.appUrl`. `@better-auth/passkey` 1.7.2 accepte `origin?: string | string[] | null` (`dist/index-B7Y0IgKK.d.mts:162`), résolu à la cérémonie (`dist/index.mjs:337, 453` → `expectedOrigin`). L'origine n'est **pas** stockée avec la clé : une passkey antérieure reste valide tant que `rpID` ne bouge pas. Il faut donc une **seconde option** du module auth (`rpId` ou l'URL du site), sinon le `rpID` suit l'hôte de l'application et invalide les passkeys (commentaire `:978-985`).
3. **`guestReturnUrl` vise `/pricing` sur `appUrl`** (`billing-use-cases.ts:767`) : si `appUrl` devient l'application, le retour d'un paiement invité atterrit sur `app.<domaine>/pricing` — la zone Site servie par l'hôte de l'application. Sans routage (s64b), cet écran y est rendu tel quel ; s64b le redirigera vers le site. La forme correcte (retour dans l'application) est tranchée en s64b ; s64a ne doit que **ne pas casser** le cas sans `APP_HOST`.
4. **Les URL du site lisent `APP_URL` directement** (`lib/site-url.ts:21,63` et consommateurs) : rien à faire, sauf un test qui le garde (critère 4) — qu'un futur refactor ne les fasse pas passer par `resolveAuthConfig`.
5. **Validation** : `APP_URL` est déclarée `packages/config/src/env.ts:151-157` ; les règles croisées vivent dans `superRefine` (:421) ; `tests/env-example.test.ts:35-38` exige que `.env.example` déclare toute clé de `ENV_KEYS` (:620), une valeur vide valant absence. `APP_HOST` = un **nom d'hôte** (pas une URL) ; sous-domaine de l'hôte d'`APP_URL` = se termine par `.` + cet hôte, différent de lui. `app.localhost` sous `APP_URL=http://localhost:3000` est donc valide (utile à s64b).

## Target story
s64a (`docs/stories.md`) : `APP_HOST` validée ; sans elle rien ne change ; toute URL de session sur l'origine de l'application (un test par parcours) ; URL du site inchangées ; URL depuis la configuration, jamais `Host` ; `rpID` inchangé ; mention « pas encore supportée » dans `docs/deployment.md`.

## Current state of the code
- `AuthConfig` = `{ secret, appUrl }` ; `appAuth()` (`lib/auth.ts:160+`) passe `appUrl` à `configureAuth` → `better-auth-service.ts:609` (`baseURL`), `:613` (`trustedOrigins`), `:998-1003` (passkey), et aux use cases (`auth-use-cases.ts:468-471` → emails :548, :641, :724, export ~:486).
- `incomingRequest()` `lib/auth.ts:329` : `new URL('/', appUrl)` — base de requêtes internes à Better Auth.
- Invitations `organization-use-cases.ts:581` ; Stripe `billing-use-cases.ts:617, :767` ; guest `lib/guest-account.ts:97` ; local payments `packages/payments-testing/src/local-payments.ts:308`.

## Anchor points
- `packages/config/src/env.ts` : clé `APP_HOST`, règle croisée dans `superRefine`.
- `apps/web/lib/auth-config.ts` : `AuthConfig` gagne l'origine du site (ou `rpId`) ; `appUrl` = origine de l'application si `APP_HOST`, sinon `APP_URL`.
- Module auth : option supplémentaire pour le `rpID` (et, au choix du plan, `trustedOrigins` élargies).
- `.env.example` ; `docs/deployment.md` (ligne `APP_URL` :309, nouvelle ligne `APP_HOST`).

## Verified APIs / functions
- `resolveAuthConfig(env: Env): AuthConfig` — `auth-config.ts:26`.
- `passkey({ rpID, rpName, origin })` — `origin: string | string[] | null`.
- Better Auth `trustedOrigins: string[]` ; `baseURL: string`.

## Traps & constraints
- **Critère 2 « octet pour octet »** : `appUrl` sans `APP_HOST` doit être la chaîne d'`APP_URL` **telle quelle** (pas re-sérialisée par `new URL` — `http://localhost:3000` deviendrait `http://localhost:3000/`). Les tests épinglés (`tests/auth.test.ts` 31 occurrences, `organizations` 47, `billing` 20…) le prouvent.
- **Construire l'origine** : schéma et port viennent d'`APP_URL`, l'hôte d'`APP_HOST` ; un chemin éventuel d'`APP_URL` (déploiement sous préfixe) est à refuser ou conserver — à trancher.
- **`trustedOrigins`** : avec seulement l'application, une connexion tentée sur l'hôte du site (possible tant que s64b n'est pas livrée) est refusée par Better Auth ; avec les deux, elle réussit mais le cookie reste propre à l'hôte du site. Décision au plan.
- `tests/rate-limiting.test.ts:895` interdit `cookiePrefix` dans `better-auth-service.ts` : ne pas y toucher.
- `tests/data-export.test.ts`, `tests/notifications.test.ts` appellent `resolveAuthConfig` : la nouvelle forme doit rester compatible.
- Garde de démarrage (`startup.ts:128`) : une erreur d'`APP_HOST` doit **nommer la variable** (patron des autres refus).

## Open questions
1. `trustedOrigins` : application seule, ou site + application pendant l'intérim ? (sécurité : les deux sont des origines du propriétaire).
2. `APP_URL` avec un chemin non vide + `APP_HOST` : refus au démarrage (le plus simple) ?

## Real complexity
Cotée **4**, confirmée **3-4** : une variable, une résolution d'origines, une option de plus au module auth, et surtout un test par parcours (≈ 10 parcours) sur un harnais déjà épinglé à `APP_URL`. Aucune migration, aucune UI (pas de `/ks-design`).
