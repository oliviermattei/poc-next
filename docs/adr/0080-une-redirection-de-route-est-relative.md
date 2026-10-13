# ADR 080 — Une redirection émise par une route est relative

- Status: accepted
- Date: 2026-09-29

Next 16 donne à `request.url` l'hôte d'écoute du serveur (`0.0.0.0:3000` dans l'image), pas l'hôte demandé, et ne relativise que les `Location` émis par le proxy : une redirection construite par `new URL(chemin, request.url)` partait vers le mauvais hôte, bloquée par la CSP `form-action 'self'`, ou vers `0.0.0.0` en production (#69). Toute redirection émise par un gestionnaire de route vers un écran du même hôte porte donc un `Location` **relatif** (chemin et requête), que le navigateur résout contre l'hôte qu'il a demandé — par `new Response(null, { status, headers: { location } })`, puisque `Response.redirect` exige une URL absolue. Une redirection vers un autre hôte reste absolue et part d'une origine configurée (ADR 078, 079), et un filtre de destination compare à `appUrl`, jamais à `request.url`. Un test balaie les sources des routes : aucun `new URL(…, request.url)` ne construit un `Location`.

## Considered options

- **Injecter l'origine configurée dans chaque module** — rejeté : plusieurs modules à reconfigurer pour une information que le navigateur a déjà, et la cible serait toujours l'hôte de l'application, faux pour une route servie sur le site.
