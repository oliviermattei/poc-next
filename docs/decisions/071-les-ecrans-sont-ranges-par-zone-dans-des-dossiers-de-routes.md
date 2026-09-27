# ADR 071 — Les écrans sont rangés par zone dans des dossiers de routes

- Status: accepted
- Date: 2026-09-27
- Scope: story s60-console

## Context
Le layout racine (`apps/web/app/layout.tsx:96`) enveloppe **toutes** les pages dans l'`AppShell` : barre latérale du produit, barre du haut, bannière de consentement. Un layout imbriqué ne peut pas retirer celui de son parent. La console (s60) a besoin de son propre shell, et s61 a déjà fixé quatre zones — Site, Hors zone, Application, Console — chacune avec son gabarit.

## Decision
Les pages sont rangées, **une seule fois**, dans quatre dossiers de routes Next : `(site)`, `(auth)`, `(app)` et `(console)`, selon la partition de s61. Le layout racine garde `<html>`, `<body>` et les fournisseurs (langue, thème, nonce) ; chaque dossier a son `layout.tsx`. En s60, `(site)`, `(auth)` et `(app)` rendent l'`AppShell` actuel à l'identique, et `(console)` rend le shell de la console. s61 ne change plus que le contenu des trois premiers layouts. Aucune URL ne change. `not-found.tsx` et `global-error.tsx` restent à la racine.

## Considered options
- **Un en-tête posé par `proxy.ts`, lu par le layout racine pour choisir le gabarit** — rejetée : aucun fichier ne bouge, mais c'est un aiguillage par chemin écrit à la main là où Next fournit le mécanisme, et chaque nouvelle zone l'allongerait. Choix du porteur (27/09).
- **Deux dossiers seulement en s60, `(main)` et `(console)`, puis redécoupe de `(main)` en s61** — rejetée : les fichiers et les 19 imports de `tests/` bougeraient deux fois.
- **Laisser la console dans l'`AppShell`, avec un titre et un badge** — rejetée : la barre latérale du produit resterait visible dans la console, ce qui est précisément la confusion à lever.

## Consequences
- Tout segment de `apps/web/app` appartient à exactement un dossier de zone ; un test le dérive du disque.
- Le préambule Playwright (`e2e/support/warm-up.ts`) traduit un groupe `(…)` en « aucun segment » au lieu d'échouer ; il refuse toujours `@` (routes parallèles), qu'aucun écran n'utilise.
- Les suites qui dérivent les segments de premier niveau du disque (`tests/organizations.test.ts`, `tests/rendered-text.test.ts`…) lisent désormais le premier segment **hors groupe**.
- La page 404 est rendue par la frontière racine, **au-dessus** des layouts de zone : elle perd l'`AppShell` sauf à le rendre elle-même. En s60, `not-found.tsx` le rend ; s61 lui donne le gabarit Site. En échange, un `notFound()` levé dans la console devrait ne rendre **aucun** élément de son shell — c'est ce que la frontière racine promet, et un parcours navigateur de s60 le **mesure** au lieu de le supposer.
