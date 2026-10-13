# ADR 078 — Deux origines, une résolution : `APP_URL` reste le site, `APP_HOST` nomme l'application

- Status: accepted
- Date: 2026-09-29

Le projet peut servir l'application sur `app.<domaine>` à côté du site. Une seule URL, `APP_URL`, fondait tout : l'URL du site (plan de site, `metadataBase`, blog), les URL qui ouvrent une session (auth, emails, invitations, Stripe, achat invité) et le `rpID` des passkeys. `APP_URL` reste l'origine du site ; `APP_HOST`, facultative, est un nom d'hôte qui doit être un sous-domaine de l'hôte d'`APP_URL`. `resolveAuthConfig(env)` (`apps/web/lib/auth-config.ts`) est la seule résolution : `appUrl` (schéma et port d'`APP_URL` sur l'hôte d'`APP_HOST` ; sans `APP_HOST`, la chaîne d'`APP_URL` telle quelle), `siteUrl`, et `passkeyRpId`, toujours l'hôte d'`APP_URL`. Le module auth reçoit `passkeyRpId` et ses origines de confiance par injection ; il ne lit jamais l'environnement.

## Considered options

- **Lire l'en-tête `Host`** — rejeté : une URL absolue construite depuis la requête est falsifiable (empoisonnement des liens d'emails).
- **`APP_URL` devient l'application, nouvelle `SITE_URL`** — rejeté : change le sens d'une variable de chaque déploiement existant et déplace le `rpID`, ce qui invalide toutes les passkeys enregistrées.
- **Cookies de session sur le domaine parent (`crossSubDomainCookies`)** — rejeté : la session serait envoyée au site et à tout sous-domaine frère ; elle reste propre à l'hôte de l'application.

## Consequences

Déplacer tous les liens de session se fait à un seul endroit, et les URL du site n'y passent jamais (un test le garde).
