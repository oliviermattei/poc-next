# ADR 073 — Le site a sa surface de navigation, et son bouton appartient au gabarit

- Status: accepted
- Date: 2026-09-28

L'adresse du produit ouvre son site public, connecté ou non, et la connexion mène à l'application ; une seule barre latérale ne pouvait plus mêler les liens des deux. `NavigationSurface` porte donc `'site'` : l'accueil, le blog, les docs et les tarifs la déclarent et sont rendus par l'en-tête du gabarit Site (ADR 066). L'entrée `/sign-in` du module `auth` n'existe plus. La destination par défaut d'une ouverture de session est `/app` (`DEFAULT_SIGNED_IN_PATH`, module `auth`) ; `/` sert toujours le site.

Le bouton de l'en-tête — « Se connecter » pour un anonyme, « Ouvrir l'application » pour un connecté — appartient au gabarit, comme le menu de compte de l'application. C'est une exception nommée à la règle « aucune entrée de navigation écrite à la main » (`apps/web/AGENTS.md`), sûre parce que l'authentification est du socle et ne peut pas être coupée.

## Considered options

- **Une visibilité « anonyme seulement » au contrat** — rejeté : toucher le contrat du cœur pour un seul bouton, et « Ouvrir l'application » n'aurait aucun module pour la déclarer (`/app` est un écran de `apps/web`). Une entrée `public` reste visible de tous.
- **Garder `/sign-in` comme entrée `site`** — rejeté : elle resterait visible d'un connecté, sans contrepartie.
