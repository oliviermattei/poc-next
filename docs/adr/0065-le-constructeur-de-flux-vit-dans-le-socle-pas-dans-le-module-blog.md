# ADR 065 — Le constructeur de flux vit dans le socle, pas dans le module blog

- Status: accepted
- Date: 2026-09-06
- Scope: story s31-changelog

## Context

s53 a livré le flux RSS du blog. Le constructeur du document — échappement XML,
`pubDate` en RFC 822, `atom:link` de désignation, ordre des entrées — a été écrit
dans `packages/modules/blog/src/domain/feed.ts`, ce qui était le bon endroit tant
que le blog était le seul module à publier un flux.

s31 demande un flux des nouveautés. C'est le **même document**, au vocabulaire
près : le blog parle d'articles avec un auteur, le changelog de notes de version
qui n'en ont pas. Trois voies existaient, et deux d'entre elles cassent une
promesse du produit.

La recherche de s31 a par ailleurs mesuré que ce n'est pas un cas isolé : s29 a
construit **dans le module blog** trois choses qui se révèlent être de
l'infrastructure partagée — l'échelle de prose (montée dans `@repo/ui` par ADR
055), le balayage d'un dossier de contenu par locale, et ce constructeur de flux.
Ce n'est pas un reproche à s29 : rien ne dit à la première story qu'elle est une
fondation. C'est la **troisième** occurrence, et c'est ce qui rend la décision
due maintenant.

## Decision

`renderFeed(input)` vit dans `packages/core/src/syndication.ts`, à côté de
`sitemapEntries` et `robotsPolicy` — la même famille : la syndication du contenu
public. `renderBlogFeed` devient une **enveloppe mince** qui traduit le
vocabulaire du blog (`articles`) en celui du primitif (`items`), et le module
`changelog` déclare `requires: []`.

L'auteur devient **facultatif** sur une entrée : présent, il est écrit en
`dc:creator` ; absent, aucune balise n'est écrite. C'est la seule différence de
comportement introduite par l'extraction, et elle est mesurée à l'endroit où elle
vit (`packages/core/src/syndication.test.ts`).

Le déplacement est **vérifiable par ce qui n'a pas bougé** : `tests/blog.test.ts`
n'est pas modifié par cette story. S'il avait fallu l'éditer, l'extraction aurait
changé le comportement, et c'eût été le constat plutôt que le correctif.

## Considered options

- **Le changelog déclare `requires: ['blog']`** — rejeté : il rendrait les notes
  de version indisponibles à tout produit qui coupe le blog, c'est-à-dire qu'il
  ferait payer une fonctionnalité par une autre. La promesse de modularité du
  PRD est exactement ce que `pnpm test:minimal-profile` mesure ; ce couplage
  l'aurait vidée de son sens pour deux modules à la fois.
- **Copier le constructeur dans le module `changelog`** — rejeté : deux
  implémentations de l'échappement XML divergent au premier caractère hostile,
  et c'est précisément la partie qu'une bibliothèque de génération ferait mieux
  que nous. Le prix de « aucune dépendance d'exécution » (s53) n'est tenable que
  s'il est payé une fois.
- **Le monter dans `packages/ui`** — rejeté : un flux RSS n'est pas de la
  présentation. `@repo/ui` livre des composants React et des jetons ; y ranger un
  générateur de XML servi par une route ferait de ce paquet le dépôt des choses
  partagées, ce qu'ADR 055 a explicitement refusé d'en faire.
- **Créer un paquet `@repo/syndication`** — rejeté : un paquet de plus pour une
  fonction, alors que `@repo/core` porte déjà `sitemapEntries`, `robotsPolicy` et
  `carriesLocalePrefix`, c'est-à-dire l'autre moitié exacte du même sujet. Tout
  module a déjà le droit d'importer `@repo/core` ; un nouveau paquet aurait
  demandé une ligne de dépendance dans chaque module qui publie un flux, pour
  une frontière que personne n'a besoin de faire respecter.
- **Ne rien faire et écrire le flux du changelog à la main dans sa route** —
  rejeté : c'est la copie ci-dessus, sans même un nom pour la désigner.

## Consequences

**Ce qui devient plus facile.** Un module qui publie un flux n'a plus rien à
décider : il fournit un titre, une description, des URL absolues et des entrées.
Le troisième flux du dépôt ne rouvrira ni le blog, ni le changelog.

**Ce qui devient plus difficile.** `@repo/core` grossit d'un sujet de plus, et
`syndication.ts` porte désormais quatre choses (plan de site, robots, préfixe de
langue, flux). Le jour où un cinquième sujet s'y ajoute, la question du découpage
en fichiers se posera pour de bon — elle ne se pose pas encore.

**Ce qu'il faut surveiller.** `renderFeed` produit du RSS 2.0 et rien d'autre. Un
module qui aurait besoin d'Atom ou de JSON Feed ne doit pas l'obtenir en ajoutant
un drapeau ici : ce serait une seconde surface à tenir, et s53 a écrit pourquoi
elle ne l'a pas prise. Ce que la suite prouve du document reste « **analysable**
par `@rowanmanning/feed-parser` », jamais « valide au sens d'un validateur » — le
dépôt n'en embarque aucun, et cette limite est elle-même un cas de test.
