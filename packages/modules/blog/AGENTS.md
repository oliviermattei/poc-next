# packages/modules/blog — règles locales

Le blog : des articles écrits en MDX, lus par un visiteur. C'est la **première
source de contenu par fichier** du dépôt — tout le reste vient des catalogues de
messages — et trois choses en découlent, dont deux sont des interdits.

**1. Le MDX est compilé au build, jamais évalué à l'exécution (ADR 053).** La
politique de sécurité du contenu n'accorde `'unsafe-eval'` qu'en développement
(`apps/web/lib/security-headers.ts`). Toute brique qui construit un composant
par `new Function` — `next-mdx-remote`, `@mdx-js/mdx` `run`/`evaluate`, la
sortie `code` de `velite` — est donc disqualifiée avant comparaison. Ce module
ne compile rien : il lit des **en-têtes**, et le corps des articles est un
module JavaScript que le bundler de Next produit.

**2. Aucun `dangerouslySetInnerHTML`, nulle part.** Le précédent est écrit dans
`packages/modules/marketing/src/presentation/legal-document.tsx` ; une brique
compilée en composants React n'en a pas besoin. Un pipeline Markdown → HTML en
aurait besoin : c'est le critère qui départage les deux familles.

**3. Les locales servies ne sont pas les locales de l'application.**
`readArticleDirectory` reçoit les deux, et la distinction est exécutable : un
dossier dont le nom est une locale de l'application mais qui n'est pas servi
(`en` quand `i18n` est coupé) est **ignoré** ; un dossier que personne ne servira
jamais (`de`) est **refusé en le nommant**. `config/i18n.ts:5-7` documente le
défaut que la confusion inverse a déjà coûté au dépôt.

## Imports autorisés

- `@repo/core` pour le contrat de module et la qualification des clés ;
- `@repo/ui` pour la présentation — jamais Radix directement (ADR 022) ;
- `zod` à la frontière du frontmatter, `yaml` pour le lire ;
- `node:fs` **uniquement** dans `src/infrastructure/` ;
- `@repo/typescript-config` pour la configuration du compilateur
  (`tsconfig.json`), et `react` en pair — le module rend des composants, il ne
  livre pas React.

## Ne doit jamais contenir

- de règle métier hors de `domain/` ;
- d'accès au disque hors de `src/infrastructure/` ;
- d'import d'un autre module : la seule dépendance inter-modules déclarée est
  `requires`, et celui-ci n'en a aucune ;
- de flux RSS, d'image Open Graph par défaut ou de contribution au plan de
  site : ils appartiennent à `s53-blog-syndication`, qui doit pouvoir être revue
  seule.

## Ce que le contrat déclare, et pourquoi si peu

Ni table, ni migration, ni route d'API : le contenu est dans des fichiers.
`dataCategories: []` et `retention: {}` sont **déclarés vides**, pas omis
(ADR 007) — un article est écrit par le propriétaire du dépôt, ce n'est la
donnée personnelle de personne.

Une seule entrée de navigation, publique. C'est elle qui disparaît avec le
module, sans qu'aucun composant ne porte de condition.

Aucun squelette de chargement non plus, ni la clé qui l'aurait légendé. Ce
n'est pas un oubli : un squelette suppose une frontière `Suspense`, donc un
`loading.tsx` dans `apps/web`, et un `loading.tsx` sur `app/blog/` fait répondre
**200** à un slug inconnu au lieu de 404 — la coquille part avant que la page
n'ait décidé. Mesuré par `e2e/blog.spec.ts:132`, et détaillé dans
`apps/web/AGENTS.md`. Le refus prime sur le confort ; le manque est signalé au
design system plutôt que comblé ici (constat F3 de la revue de s29).

## Tests

`src/**/*.test.ts`, à côté du code qu'ils couvrent — trois fichiers, un par
couche qui porte une règle : `domain/article.test.ts` (le frontmatter),
`application/blog-catalog.test.ts` (locale, tag, pagination, module coupé),
`infrastructure/content-directory.test.ts` (le dossier).

**Les tests d'un module sont soumis aux règles de couches de ce module** :
l'exception de lint du harnais s'arrête aux packages de premier niveau
(`eslint.config.ts`, `testHarnessException`). Un test de `domain` qui aurait
besoin d'`infrastructure` signalerait un `domain` qui n'est plus pur.
