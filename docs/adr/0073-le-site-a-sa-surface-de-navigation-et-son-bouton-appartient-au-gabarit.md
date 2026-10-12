# ADR 073 — Le site a sa surface de navigation, et son bouton appartient au gabarit

- Status: accepted
- Date: 2026-09-28
- Scope: story s61-site-et-application

## Context
Une seule barre latérale mélangeait les liens du site (accueil, blog, docs, tarifs, connexion) et ceux de l'application. Le porteur a demandé (27/09) que l'adresse du produit ouvre son **site public**, connecté ou non, et que la connexion mène à l'application. `NavigationSurface` vaut `'app' | 'footer' | 'console'` ; une entrée sans surface est en `app`. Le contrat ne connaît pas de visibilité « anonyme seulement » : une entrée `public` est visible de tous (`packages/core/src/protection.test.ts:84-92`).

## Decision
1. `NavigationSurface` gagne `'site'`. L'accueil, le blog, les docs et les tarifs déclarent `surface: 'site'` ; ils sont rendus par l'en-tête du gabarit Site. L'entrée `/sign-in` du module `auth` est **retirée**.
2. Le bouton de l'en-tête — « Se connecter » pour un anonyme, « Ouvrir l'application » pour un connecté — **appartient au gabarit**, comme le menu de compte de l'application. C'est une exception **nommée** à la règle « aucune entrée de navigation écrite à la main » (`apps/web/AGENTS.md`), sûre parce que l'authentification est du socle et ne peut pas être coupée.
3. La destination par défaut d'une ouverture de session devient `/app`, une constante unique ; `/` sert toujours le site.

Amende quatre critères livrés : s07 (repli de la destination), s08 (tableau de bord sur `/app`), s10 (critère 6 : un connecté sur `/` voit le site), s40 (le parcours d'intégration se termine sur `/app`).

## Considered options
- **Une visibilité « anonyme seulement » au contrat** — rejetée (décision du porteur, 27/09) : toucher le contrat du cœur, rouvrir le registre et ses tests pour un seul bouton, et « Ouvrir l'application » n'aurait de toute façon aucun module pour la déclarer (`/app` est un écran de `apps/web`).
- **Garder `/sign-in` comme entrée `site`** — rejetée : elle resterait visible d'un connecté, sans contrepartie « Ouvrir l'application ».
- **Rendre le pied de page dans le gabarit** — rejetée : chaque page le rend déjà (`publicFooterLinks`), il paraîtrait deux fois.

## Consequences
- Un module qui veut paraître dans l'en-tête du site déclare `surface: 'site'` ; aucune ligne de `apps/web` ne change.
- La barre latérale de l'application ne rend que la surface `app` : c'est le travail de s62 d'en retirer aussi les réglages.
- Les parcours qui attendaient `/` après connexion attendent `/app`, dérivé une seule fois (`e2e/support/locale.ts`, `signedInLanding`).
