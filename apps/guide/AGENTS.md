# apps/guide — le Guide du propriétaire du projet

Le **Guide** (`GLOSSARY.md`) : la documentation du boilerplate destinée au
propriétaire du projet. Un site Fumadocs **séparé**, exporté en statique
(`out/`), en français (qui fait foi) et en anglais. Ce n'est pas la
documentation produit — celle des clients, servie sous `/docs` par le module
`docs` de `apps/web`. Pourquoi un site à part, et pourquoi Fumadocs ici alors
que l'ADR 053 l'a écarté pour la documentation produit : ADR 083.

Il ne part jamais dans une image : `.dockerignore` l'exclut du contexte de
build, et `tests/deployment.test.ts` le vérifie.

## Où écrire

- **Les pages** : `content/docs/<partie>/<slug>.mdx` (français) et
  `<slug>.en.mdx` à côté (anglais), mêmes slugs. L'ordre et le titre de chaque
  partie : `meta.json` et `meta.en.json` du dossier. Une page qui n'est listée
  dans aucun `meta.json` est invisible.
- **La grille de l'accueil** : `lib/feature-grid.ts`, déclarée une seule fois et
  rendue dans les deux langues par `components/feature-grid.tsx`
  (`<FeatureGrid lang="fr" />` dans `content/docs/index.mdx`).
- **Une page en attente** porte `PLACEHOLDER_MARKER` (`lib/placeholder.ts`) et
  une phrase ; la rédiger, c'est retirer la marque.
- **Les liens internes** s'écrivent en absolu, dans la langue de la page :
  `/fr/demarrer/installer`, `/en/demarrer/installer`.

## Imports autorisés

- `fumadocs-core`, `fumadocs-ui`, `fumadocs-mdx` : le moteur du site, ses
  composants (`Cards`, `Card`, `Callout`, `Steps`, `Tabs`…), sa recherche
  statique et sa sortie `llms.txt`. Versions figées exactement : `fumadocs-ui`
  exige le `fumadocs-core` du même numéro.
- `next`, `react`, `react-dom` : le cadre, aux versions de `apps/web`.
- `@repo/typescript-config` : le `tsconfig` partagé, et rien d'autre.

## Ne doit jamais contenir

- **Aucun autre paquet du dépôt** (`@repo/ui`, `@repo/config`, un module…) :
  le Guide se lit sans que l'application tourne, et il ne s'importe nulle part.
  Les Radix qu'il tire passent par `fumadocs-ui`, jamais par un import direct
  (ADR 022, ADR 083).
- **Un composant maison** quand un composant de Fumadocs suffit.
- **Une page dans une seule langue**, un lien qui ne mène nulle part, une
  carte « Bientôt » sans son issue, ou un élément du cimetière de
  `docs/prd.md` dans la grille.
- **Ce que l'export statique ne sert pas** : proxy, `redirects()`,
  `headers()`, route non statique.
- **Une affirmation que le code ne vérifie pas** : le code fait foi, et une
  limite connue renvoie à son issue.

## Tests

`tests/guide.test.ts`, à la racine — le Guide n'a pas de test à lui :

- parité FR/EN de chaque page et de chaque `meta.json` ;
- chaque lien interne, cartes de la grille comprises ;
- une grille honnête (issue de chaque « Bientôt », rien du cimetière).

`pnpm guide:build` construit le site et échoue sur un frontmatter invalide ;
`pnpm typecheck` et `pnpm lint` le couvrent comme le reste du dépôt.

## Le bloc `nextjs-agent-rules` ci-dessous est versionné, et c'est un choix

Next l'écrit et le réinsère à chaque `next dev` : versionné, l'upsert est un
no-op et l'arbre reste propre. La raison complète est dans `apps/web/AGENTS.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
