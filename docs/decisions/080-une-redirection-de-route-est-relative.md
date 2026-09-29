# ADR 080 — Une redirection émise par une route est relative

- Status: accepted
- Date: 2026-09-29
- Scope: story s64b2-hote-tarifs

## Context
Plusieurs gestionnaires de route construisent leur `Location` par `new URL(chemin, request.url)`. Next 16 donne à `request.url` l'hôte d'**écoute** du serveur (`0.0.0.0:3000` dans l'image, `localhost:PORT` en dev), pas l'hôte demandé, et ne relativise que les `Location` émis par le proxy. Résultat mesuré à deux hôtes : 303 vers le mauvais hôte, bloqués par CSP `form-action 'self'` ; déduit en production : 303 vers `0.0.0.0` (#69). ADR 079 a déjà écarté `request.url` pour toute décision d'origine.

## Decision
- Toute redirection émise par un gestionnaire de route vers un écran **du même hôte** porte un `Location` **relatif** (chemin + requête), que le navigateur résout contre l'hôte qu'il a demandé (RFC 9110 §10.2.2). `Response.redirect` (qui exige une URL absolue) n'est plus employé pour ces cas : `new Response(null, { status, headers: { location } })`.
- Une redirection vers **un autre hôte** (rare : proxy de s64b1) reste absolue et part d'une origine configurée (ADR 078/079).
- Un filtre de destination qui compare à « l'origine » compare à l'origine **configurée** (`appUrl`), jamais à `request.url`.
- Un test balaie les sources des routes : aucun `new URL(…, request.url)` ne sert à construire un `Location`.

## Considered options
- **Injecter l'origine configurée dans chaque module** — rejetée : quatre modules et une route à reconfigurer pour une information que le navigateur a déjà ; et la cible serait toujours l'hôte de l'application, faux pour une route servie sur le site.
- **`experimental.trustHostHeader`** — rejetée (ADR 079) : rendrait toute URL construite depuis la requête falsifiable.

## Consequences
- Les tests qui attendaient un `Location` absolu (`http://localhost:3000/...`) attendent un chemin.
- Les formulaires natifs fonctionnent derrière n'importe quel hôte d'écoute, avec ou sans `APP_HOST`.
