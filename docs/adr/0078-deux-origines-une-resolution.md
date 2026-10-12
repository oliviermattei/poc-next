# ADR 078 — Deux origines, une résolution : `APP_URL` reste le site, `APP_HOST` nomme l'application

- Status: accepted
- Date: 2026-09-29
- Scope: story s64a-hote-origines

## Context
s64 (découpée) sert l'application sur `app.<domaine>` quand le propriétaire le configure. Aujourd'hui une seule URL, `APP_URL`, fonde tout : URL du site (plan de site, `metadataBase`, blog) **et** URL qui ouvrent une session (auth, emails, invitations, Stripe, guest checkout), plus le `rpID` des passkeys. Il faut séparer les deux origines sans casser les déploiements à un hôte ni les passkeys déjà enregistrées.

## Decision
- `APP_URL` reste **l'origine du site** ; `APP_HOST`, facultative, est un **nom d'hôte** qui doit être un sous-domaine de l'hôte d'`APP_URL`.
- `resolveAuthConfig(env)` est la **seule** résolution : elle rend `appUrl` (origine de l'application = schéma et port d'`APP_URL`, hôte d'`APP_HOST` ; sans `APP_HOST`, la chaîne d'`APP_URL` telle quelle), `siteUrl` et `passkeyRpId` (toujours l'hôte d'`APP_URL`).
- Le module auth reçoit `passkeyRpId` et des origines de confiance supplémentaires par injection ; il ne lit jamais l'environnement.
- Pendant l'intérim (avant le routage de s64b), l'origine du site reste une origine de confiance de l'auth et de la cérémonie passkey.

## Considered options
- **Lire l'en-tête `Host`** — rejetée : une URL absolue construite depuis la requête est falsifiable (empoisonnement de liens d'emails) ; `docs/deployment.md` l'interdit déjà pour `APP_URL`.
- **`APP_URL` devient l'application, nouvelle `SITE_URL`** — rejetée : change le sens d'une variable de chaque déploiement existant, et déplace le `rpID`, ce qui invalide toutes les passkeys.
- **Cookies de session sur le domaine parent (`crossSubDomainCookies`)** — rejetée : la session serait envoyée au site et à tout sous-domaine frère ; la décision du porteur la garde propre à l'hôte de l'application.
- **Application seule en origine de confiance dès s64a** — rejetée pour l'intérim : le site sert encore les écrans d'auth jusqu'à s64b, et une connexion y serait refusée sans message utile.

## Consequences
- Un seul endroit à changer pour déplacer tous les liens de session ; les URL du site ne passent jamais par lui (un test le garde).
- `guestReturnUrl` (`/pricing`) suit `appUrl` et atterrit sur l'hôte de l'application jusqu'à ce que s64b route les zones et fixe le retour des tarifs.
- s64b peut retirer l'origine du site des origines de confiance une fois les écrans d'auth servis par la seule application.
