# ADR 079 — L'hôte de la requête aiguille, la configuration construit

- Status: accepted
- Date: 2026-09-29
- Scope: story s64b1-hote-routage

## Context
Avec `APP_HOST`, le proxy doit savoir quel hôte a été demandé pour servir, rediriger ou refuser une zone. Next 16 ne le donne pas dans `request.url`, qui porte l'hôte d'**écoute** (`0.0.0.0` dans l'image) ; il n'est lisible que dans `x-forwarded-host` / `host`, contrôlables par le client quand aucun proxy amont ne les réécrit. La garde d'origine du consentement comparait justement à `request.url` et refuse en production (#66).

## Decision
- L'hôte demandé (`x-forwarded-host`, premier élément, sinon `host`) sert **uniquement** à choisir une branche : hôte de l'application, hôte du site, ou inconnu. Un hôte inconnu n'est pas aiguillé (comportement sans `APP_HOST`).
- Toute URL de redirection est construite depuis les origines **configurées** (`resolveAuthConfig` — ADR 078), jamais depuis un en-tête.
- Toute **décision de sécurité** sur l'origine (garde du consentement, origines de confiance de l'auth) compare à ces origines configurées, jamais à l'hôte de la requête.
- Le proxy lit `APP_URL` et `APP_HOST` par un lecteur partiel de `@repo/config` qui ne lève pas, comme `getNodeEnv`.

## Considered options
- **`experimental.trustHostHeader`** — rejetée : ferait porter `request.url` par l'en-tête `Host`, donc toute URL construite depuis la requête deviendrait falsifiable, dans tout le dépôt et pas seulement dans le proxy.
- **Deux déploiements distincts (un par hôte)** — rejetée : contredit « un code, un hôte optionnel » (décision du porteur, s64) et double l'infrastructure.
- **Comparer la garde du consentement à l'en-tête `Host`** — rejetée : un attaquant qui contrôle `Origin` d'une page tierce ne contrôle pas `Host` de la requête du navigateur, mais la garde deviendrait dépendante d'un proxy amont correct ; la configuration est la seule source qui ne dépend d'aucun en-tête.

## Consequences
- Un proxy amont qui ne transmet pas `Host` fait voir un hôte inconnu : l'application sert tout sans aiguiller — dégradé, jamais cassé ; `docs/deployment.md` (s64c) exige la transmission.
- Le consentement fonctionne derrière un serveur qui écoute sur `0.0.0.0`, avec ou sans `APP_HOST`.
