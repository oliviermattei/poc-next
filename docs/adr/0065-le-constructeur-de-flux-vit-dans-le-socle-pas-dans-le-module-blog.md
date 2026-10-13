# ADR 065 — Le constructeur de flux vit dans le socle, pas dans le module blog

- Status: accepted
- Date: 2026-09-06

Le flux RSS du blog avait été écrit dans le module `blog` ; le module `changelog` publie le même document au vocabulaire près (des notes de version, sans auteur). `renderFeed(input)` vit donc dans `packages/core/src/syndication.ts`, à côté de `sitemapEntries` et `robotsPolicy` — la même famille, la syndication du contenu public. `renderBlogFeed` n'est qu'une enveloppe qui traduit `articles` en `items`, et `changelog` déclare `requires: []`. L'auteur est facultatif sur une entrée : présent, il s'écrit en `dc:creator` ; absent, aucune balise.

## Considered options

- **`changelog` déclare `requires: ['blog']`** — rejeté : couper le blog couperait les notes de version, une fonctionnalité payée par une autre ; c'est la modularité que `pnpm test:minimal-profile` mesure.
- **Copier le constructeur dans `changelog`** — rejeté : deux échappements XML divergent au premier caractère hostile.
- **Le monter dans `packages/ui`** — rejeté : un flux RSS n'est pas de la présentation, et `@repo/ui` n'est pas le dépôt des choses partagées (`packages/ui/AGENTS.md`).
- **Un paquet `@repo/syndication`** — rejeté : `@repo/core` porte déjà l'autre moitié du sujet et tout module peut l'importer ; un paquet de plus n'aurait gardé aucune frontière utile.

## Consequences

`renderFeed` produit du RSS 2.0 et rien d'autre : un besoin d'Atom ou de JSON Feed ne s'obtient pas par un drapeau ici. Ce que les tests prouvent du document est qu'il est analysable par `@rowanmanning/feed-parser`, pas qu'il passe un validateur — le dépôt n'en embarque aucun.
