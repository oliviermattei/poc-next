# ADR 081 — L'aiguillage lit l'en-tête `Host` seul ; ses redirections ne se mettent pas en cache

- Status: accepted
- Date: 2026-09-29
- Scope: story s64c-hote-cookies
- Amends: ADR 079 (la source de l'hôte demandé seulement)

## Context
ADR 079 fait lire l'hôte demandé dans `x-forwarded-host`, puis `host`. La revue de s64b1 (#67) a montré que Next conserve un `x-forwarded-host` envoyé par le client, si bien que, derrière un proxy amont qui le laisse passer, le client choisit la branche d'aiguillage — et un cache partagé, qui indexe par `Host`, peut mémoriser la mauvaise réponse.

## Decision
- L'aiguillage lit **`host` seul**. Le proxy amont doit transmettre l'hôte d'origine dans `Host` (`docs/deployment.md` le donne pour nginx, Traefik, Caddy) ; un `Host` réécrit vers l'amont donne un hôte inconnu, donc aucun aiguillage (dégradé, jamais cassé).
- Les 308 d'aiguillage portent `Cache-Control: no-store` : une configuration d'hôtes changée n'est pas figée dans un navigateur ou un cache.

## Considered options
- **Garder `x-forwarded-host` et ajouter `Vary: X-Forwarded-Host`** — rejetée : la réponse resterait pilotée par un en-tête que le client choisit, et bien des caches ignorent `Vary` sur des en-têtes non standard.
- **Exiger seulement dans la documentation que le proxy amont retire `x-forwarded-host`** — rejetée : une règle qu'aucune commande ne vérifie est de la documentation ; lire `host` seul la rend inutile.

## Consequences
- Un déploiement dont le proxy amont réécrit `Host` vers l'adresse interne n'aiguille pas : la documentation le dit, avec la ligne de configuration de chaque proxy.
