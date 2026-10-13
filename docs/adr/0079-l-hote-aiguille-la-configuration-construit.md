# ADR 079 — L'hôte de la requête aiguille, la configuration construit

- Status: accepted
- Date: 2026-09-29

Avec `APP_HOST`, `apps/web/proxy.ts` doit savoir quel hôte a été demandé pour servir, rediriger ou refuser une zone. Next 16 ne le donne pas dans `request.url`, qui porte l'hôte d'écoute (`0.0.0.0` dans l'image) ; il n'est lisible que dans des en-têtes que le client peut contrôler. L'hôte demandé sert donc **uniquement** à choisir une branche — hôte de l'application, hôte du site, ou inconnu (pas d'aiguillage, comme sans `APP_HOST`). Toute URL de redirection est construite depuis les origines configurées (`resolveAuthConfig`, ADR 078), et toute décision de sécurité sur l'origine (garde du consentement, origines de confiance de l'auth) compare à ces origines, jamais à un en-tête de la requête. Le proxy lit `APP_URL` et `APP_HOST` par un lecteur partiel de `@repo/config` qui ne lève pas.

L'hôte se lit dans l'en-tête `host` **seul**, jamais dans `x-forwarded-host` : Next conserve un `x-forwarded-host` envoyé par le client, si bien que, derrière un proxy amont qui le laisse passer, le client choisirait la branche — et un cache partagé, qui indexe par `Host`, mémoriserait la mauvaise réponse (#67). Les 308 d'aiguillage portent `Cache-Control: no-store`, pour qu'une configuration d'hôtes changée ne reste pas figée dans un cache.

## Considered options

- **`experimental.trustHostHeader`** — rejeté : `request.url` porterait l'en-tête `Host`, et toute URL construite depuis la requête deviendrait falsifiable dans tout le dépôt.
- **Garder `x-forwarded-host` avec `Vary: X-Forwarded-Host`** — rejeté : la réponse resterait pilotée par un en-tête que le client choisit, et bien des caches ignorent `Vary` sur un en-tête non standard.
- **Exiger seulement que le proxy amont retire `x-forwarded-host`** — rejeté : aucune commande ne le vérifierait ; lire `host` seul rend la règle inutile.
- **Deux déploiements, un par hôte** — rejeté : un code, un hôte optionnel ; l'infrastructure doublerait.

## Consequences

Un proxy amont qui réécrit `Host` vers l'adresse interne fait voir un hôte inconnu : l'application sert tout sans aiguiller — dégradé, jamais cassé. `docs/deployment.md` donne la configuration de transmission de `Host` pour nginx, Traefik et Caddy.
