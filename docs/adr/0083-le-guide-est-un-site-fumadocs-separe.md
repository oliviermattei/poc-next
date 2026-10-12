# ADR 083 — Le Guide est un site Fumadocs séparé, jamais dans l'image de production

- Status: accepted
- Date: 2026-10-13
- Scope: issue #196 (spec #195)

## Context
Le propriétaire du projet (`GLOSSARY.md`) n'a pas de documentation à lui.
Ce qui existe est écrit pour des développeurs (`docs/getting-started.md`,
les documents de référence) ou pour ses clients : `/docs`, servi par le module
`docs`, est la **documentation produit**, que le propriétaire du projet écrit
pour les clients de son SaaS. La spec #195 décide d'un **Guide** : ce que fait
le boilerplate, quels services il prend en charge, comment activer chaque
fonctionnalité, brancher chaque service et déployer. En français et en anglais,
avec une recherche, et lisible d'un coup par un assistant IA (`llms.txt`).

Deux décisions existantes semblent l'interdire :

- l'**ADR 053** a écarté `fumadocs-mdx` pour la documentation produit, parce
  qu'il « apporte son propre routeur, sa propre recherche et son propre système
  de mise en page, c'est-à-dire une seconde interface par-dessus
  `packages/ui` » ;
- l'**ADR 022** fait de `packages/ui` la seule frontière avec Radix : aucun
  module applicatif ne l'importe directement. Or `fumadocs-ui` tire une dizaine
  de paquets `@radix-ui/*`.

## Decision
Le Guide est une **application à part, `apps/guide`, construite avec Fumadocs**
(`fumadocs-core`, `fumadocs-ui`, `fumadocs-mdx`, versions figées exactement) et
**exportée en site statique** (`output: 'export'`, `apps/guide/out`).

- **Séparé du produit.** Le Guide ne dépend d'aucun paquet du dépôt hormis le
  `tsconfig` partagé, et rien ne l'importe. Il se lit avant même que
  l'application tourne : `pnpm guide:dev` (port 3200), ou l'export publié sur
  n'importe quel hébergeur de fichiers.
- **Jamais dans une image.** `.dockerignore` exclut `apps/guide` du contexte de
  build : il n'est ni installé, ni construit, ni copié, pas même dans l'image de
  migration, qui repart du dépôt entier. Mesuré : `pnpm install
  --frozen-lockfile` accepte l'entrée du lockfile dont le dossier manque sans
  rien installer pour elle, et `turbo run build` ne la planifie pas.
  `tests/deployment.test.ts` garde l'exclusion.
- **Deux langues, mêmes pages.** Le français fait foi ; chaque page a sa
  traduction au même slug (`page.mdx`, `page.en.mdx`), toutes les adresses
  portent leur langue (`/fr/…`, `/en/…`), sans repli d'une langue sur l'autre.
  La racine écrit sa propre redirection vers `/fr/` : en export statique,
  `redirect()` de Next ne produit qu'une redirection par JavaScript (mesuré
  dans `out/index.html`).
- **Le Guide suit le code.** `tests/guide.test.ts` vérifie la parité des
  langues, chaque lien interne et l'honnêteté de la grille d'accueil, déclarée
  une seule fois dans `apps/guide/lib/feature-grid.ts` ; `CODING_STANDARDS.md`
  pose la règle de mise à jour dans le même commit que le code.

**Pourquoi l'ADR 053 ne s'applique pas.** Elle juge la **documentation
produit**, servie par `apps/web` à côté des autres écrans du produit, sous le
design system : une seconde couche de présentation y aurait contredit
`packages/ui` dans le produit même. Le Guide n'est pas servi par `apps/web`, ne
s'affiche à aucun client, et n'a pas à ressembler au produit. Le routeur, la
recherche et la mise en page de Fumadocs sont ici exactement ce qui est
demandé, plutôt qu'une seconde interface à concilier. Les deux contraintes de
sécurité de l'ADR 053 tiennent : `fumadocs-mdx` compile le MDX au build, sans
évaluation à l'exécution ni `dangerouslySetInnerHTML`.

**Pourquoi l'ADR 022 ne s'applique pas.** Sa frontière protège l'interface du
produit : un module applicatif qui importerait Radix rendrait coûteux le passage
à Base UI. Le Guide n'est ni un module ni une partie de cette interface, et il
n'importe Radix nulle part : ses composants viennent de `fumadocs-ui`. La règle
de lint qui interdit l'import direct de `@radix-ui/*` s'applique à
`apps/guide` comme au reste du dépôt.

**ADR 010** est respectée : dernières majeures stables, Next, React et
Tailwind aux versions de `apps/web`.

## Considered options
- **Écrire le Guide dans la documentation produit `/docs`** — rejeté : le
  Guide parlerait aux clients du propriétaire du projet, et partirait dans
  l'image de production de son SaaS. `GLOSSARY.md` sépare les deux publics.
- **Une section de la console superadmin** — rejeté : il faudrait une base,
  un compte et une application en marche pour lire comment l'installer.
- **Des fichiers Markdown sous `docs/`** — rejeté : ni grille, ni recherche,
  ni seconde langue servie, ni `llms.txt`, et `docs/` est déjà la référence
  technique, que le Guide vulgarise sans la recopier.
- **Un site maison sur `@next/mdx`, comme la documentation produit** — rejeté :
  la recherche, la navigation, la table des matières, le changement de langue et
  `llms.txt` seraient à écrire et à maintenir, pour un site dont Fumadocs fait
  exactement cela.
- **Un site Fumadocs servi par un serveur Next** — rejeté : un serveur à
  héberger de plus pour un contenu qui ne change qu'au build.

## Consequences
**Plus facile.** Le Guide se lit sans rien installer d'autre que les
dépendances, se publie comme des fichiers, et un assistant IA le lit d'un coup
(`/llms-full.txt`). Rien de ce qu'il fait ne touche au produit.

**Plus difficile.** Trois dépendances de plus, qui publient tous les deux à
cinq jours ; `fumadocs-ui` exige le `fumadocs-core` du même numéro, d'où les
versions figées. Elles entrent dans `pnpm run audit`. `pnpm dev` et
`pnpm build` lancent aussi le Guide, puisque Turbo prend chaque application.

**Hébergement et politique de sécurité du contenu.** Un site statique ne pose
aucun en-tête de réponse : la CSP à nonce de `docs/security.md` §1, construite
par `apps/web/lib/security-headers.ts`, ne le couvre pas, et ne le peut pas —
l'export de Next et `next-themes` écrivent des scripts en ligne. Le socle de
sécurité porte sur le produit ; le Guide n'a ni compte, ni formulaire, ni
donnée, ni secret. Publié sur un domaine, sa CSP est celle de l'hébergeur :
`default-src 'self'` avec `script-src 'self' 'unsafe-inline'` est le plancher
que l'export permet. Le publier sur un domaine public n'est pas dans le
périmètre de la spec #195.

**À surveiller.** Le Guide vieillit dès qu'il ment : la règle de
`CODING_STANDARDS.md` et `tests/guide.test.ts` sont là pour ça. Une montée de
`fumadocs-ui` qui changerait ses composants se voit au build du Guide, que la
CI joue avec `pnpm build`.
