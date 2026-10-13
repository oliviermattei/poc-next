# ADR 071 — Les écrans sont rangés par zone dans des dossiers de routes

- Status: accepted
- Date: 2026-09-27

Le produit a quatre zones — Site, Hors zone (authentification), Application, Console —, chacune avec son gabarit, et un layout imbriqué ne peut pas retirer celui de son parent. Les pages sont donc rangées, une seule fois, dans quatre dossiers de routes Next : `apps/web/app/(site)`, `(auth)`, `(app)` et `(console)`, chacun avec son `layout.tsx`. Le layout racine ne garde que `<html>`, `<body>` et les fournisseurs (langue, thème, nonce). Les dossiers de groupe ne changent aucune URL. `not-found.tsx` et `global-error.tsx` restent à la racine ; le rendu des 404 par zone est l'ADR 072.

## Considered options

- **Un en-tête posé par `proxy.ts`, lu par le layout racine pour choisir le gabarit** — rejeté : un aiguillage par chemin écrit à la main là où Next fournit le mécanisme, et chaque nouvelle zone l'allongerait.
- **Garder un seul shell, avec un titre ou un badge de console** — rejeté : la barre latérale du produit resterait visible dans la console, la confusion même à lever.

## Consequences

Tout segment de `apps/web/app` appartient à exactement un dossier de zone, et un test le dérive du disque. Les suites qui dérivent les segments de premier niveau du disque lisent le premier segment hors groupe ; le préambule Playwright (`e2e/support/warm-up.ts`) traduit un groupe `(…)` en « aucun segment » et refuse toujours `@` (routes parallèles), qu'aucun écran n'utilise.
