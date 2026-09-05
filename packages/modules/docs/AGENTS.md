# packages/modules/docs — règles locales

La documentation du produit : des pages MDX rangées en sections, lues par un
visiteur. C'est la **deuxième source de contenu par fichier** du dépôt après
`blog` (s29), et elle en reprend la mécanique — à une inversion près, qui est
tout l'intérêt de la story.

**1. Le MDX est compilé au build, jamais évalué à l'exécution (ADR 053).** La
politique de sécurité du contenu n'accorde `'unsafe-eval'` qu'en développement
(`apps/web/lib/security-headers.ts`). Toute brique qui construit un composant
par `new Function` est disqualifiée avant comparaison. Ce module ne compile
rien : il lit des **en-têtes** et les **titres** du corps, et le corps lui-même
est un module JavaScript que le bundler de Next produit.

**2. Aucun `dangerouslySetInnerHTML`, nulle part.** Le précédent est écrit dans
`packages/modules/marketing/src/presentation/legal-document.tsx` ; une brique
compilée en composants React n'en a pas besoin.

**3. Le repli i18n est l'inverse de celui du blog, et ce n'est pas une nuance.**
Un article sans traduction **disparaît** de sa langue (`articleOf` rend `null`) ;
une page de documentation **est servie** dans la langue par défaut, précédée
d'une mention explicite (`docsPageView` rend `{ page, translated: false }`). Une
documentation absente vaut moins qu'une documentation dans la mauvaise langue.
Copier le mécanisme de s29 sans le retourner est le défaut que la story vise.

**4. Les locales servies ne sont pas les locales de l'application.**
`readDocsDirectory` reçoit les deux, et la distinction est exécutable : un
dossier dont le nom est une locale de l'application mais qui n'est pas servi
(`en` quand `i18n` est coupé) est **ignoré** ; un dossier que personne ne servira
jamais (`de`) est **refusé en le nommant**. `config/i18n.ts:5-7` documente le
défaut que la confusion inverse a déjà coûté au dépôt.

## Comment le contenu est rangé, et les refus qui le tiennent

`content/docs/<locale>/<section>/<slug>.mdx`, plus un `section.json` par dossier
de section (`{ "title", "order" }`). Rien n'inscrit une page ni une section
ailleurs : l'arborescence **est** la navigation.

**L'arbre canonique est celui de la langue par défaut**, et la plupart des refus
en découlent. Ils lèvent tous pendant `pnpm build`, en nommant le fautif. La
liste ci-dessous est **groupée par cause** et c'est elle qui fait le compte :
aucune commande ne le dérive, et une cause lève depuis plusieurs endroits (un
frontmatter refusé a quatre points de sortie à lui seul). Ne pas écrire ici un
nombre — il a déjà été faux.

- **un frontmatter, ou un manifeste, invalide** (`parseDocsPage`,
  `parseDocsSection`) : bloc `---` absent, YAML ou JSON illisible, champ
  manquant, et **clé inconnue** — le schéma est fermé, parce qu'une clé qu'il
  ignorerait ferait croire à son auteur qu'elle produit quelque chose ;
- **une section sans manifeste** dans la langue par défaut
  (`resolveDocsCatalog`) : sans titre ni rang, elle serait rendue sous son slug
  à une place arbitraire ;
- **une page écrite seulement dans une traduction** (`resolveDocsCatalog`) :
  elle ne figurerait dans aucun arbre, donc ne serait jamais servie, et rien ne
  le dirait à son auteur ;
- **deux titres d'une même page produisant la même ancre** (`parseDocsPage`).
  Celui-là mérite son explication : le sommaire est dérivé de la **source**
  Markdown, les `id` sont posés au **rendu** par `createProseComponents`, et les
  deux passes ne comptent pas les occurrences de la même façon. Dédoublonner
  d'un seul côté donnerait un lien qui ne mène nulle part — et un fragment
  inconnu ne casse rien, il ne fait rien. Le refus supprime la divergence au
  lieu de la documenter, **à la condition que les deux passes portent sur les
  mêmes niveaux** : le sommaire ne dérive que de `##` et `###`, donc
  `createProseComponents` ne pose d'ancre que sur `h2` et `h3`. Tant qu'il en
  posait une sur `h1`, un corps portant `# Titre` puis `## Titre` livrait deux
  fois le même `id` sans qu'aucun refus ne le voie — mesuré à la revue de s30,
  et `tests/docs.test.ts` tient désormais les deux passes sur le même ensemble ;
- **un dossier de langue que personne ne servira jamais** (`readDocsDirectory`,
  voir le point 4 ci-dessus) — refusé en le nommant, là où une langue de
  l'application simplement non servie est ignorée ;
- **une page posée à la racine d'une langue** (`readDocsDirectory`) : elle
  n'appartiendrait à aucune section ;
- **un nom de section ou de page qui ne peut pas devenir un segment d'URL**
  (`readDocsDirectory`).

## Imports autorisés

- `@repo/core` pour le contrat de module et la qualification des clés ;
- `@repo/ui` pour la présentation — jamais Radix directement (ADR 022). **C'est
  de là que vient l'échelle de prose** (`PROSE_CLASSNAME`, `createProseComponents`) :
  ADR 055 l'a remontée du module `blog` vers le design system précisément pour
  que ce module n'ait pas à déclarer `requires: ['blog']` ;
- `lucide-react` pour les icônes, comme `billing`, `consent` et `organizations` ;
- `zod` à la frontière du frontmatter et du manifeste, `yaml` pour lire le premier ;
- `node:fs` **uniquement** dans `src/infrastructure/` ;
- `@repo/typescript-config` pour la configuration du compilateur
  (`tsconfig.json`), et `react` en pair — le module rend des composants, il ne
  livre pas React.

## Ne doit jamais contenir

- de règle métier hors de `domain/` ;
- d'accès au disque hors de `src/infrastructure/` ;
- d'import d'un autre module : la seule dépendance inter-modules déclarée est
  `requires`, et celui-ci n'en a aucune. **Aucune commande ne le vérifie
  aujourd'hui** — `assertNoForbiddenModuleReferences` ne juge que les clés
  étrangères des schémas — et c'est écrit dans ADR 055 plutôt que tu ;
- d'appel réseau sortant, ni de lecture de `process.env` ;
- de `loading.tsx` dans l'application pour ses écrans. Ce n'est pas un oubli :
  la coquille part avant que la page n'ait décidé, et un `notFound()` arrive
  alors en **HTTP 200** — mesuré en s29 sur trois placements. `tests/docs.test.ts`
  refuse qu'un tel fichier apparaisse sous `apps/web/app`.

## Ce que le contrat déclare, et pourquoi si peu

Ni table, ni migration : le contenu est dans des fichiers. `dataCategories: []`
et `retention: {}` sont **déclarés vides**, pas omis (ADR 007) — une page de
documentation est écrite par le propriétaire du dépôt, ce n'est la donnée
personnelle de personne.

**Aucune route non plus.** Ce module apporte des **pages**, que seule
l'application peut servir : un `ModuleRoute` est un descripteur monté sous
`/api/modules/…` (ADR 017), pas un écran. Sa modularité se joue au point de
composition, `apps/web/lib/docs.ts`. La recherche plein texte, qui aurait pu
demander une route — donc une limitation de débit, `docs/security.md` §7 —,
appartient à `s54-docs-recherche`.

Une seule entrée de navigation, publique. C'est elle qui disparaît avec le
module, sans qu'aucun composant ne porte de condition.

**Et la quinzième clé, `publicUrls`** (ADR 054) : la documentation et une entrée
par page. Elle est déclarée dans **toutes** les langues servies, là où le blog
n'annonce un article que dans les langues où il existe — c'est la conséquence
directe du repli : une page non traduite répond quand même, l'omettre priverait
un moteur d'une URL qui existe. Ni `app/sitemap.ts` ni `app/robots.ts` ne
connaissent ce module.

Le catalogue n'existe pas à l'import : `provideDocsContent`
(`src/infrastructure/docs-content.ts`) reçoit du point de composition le
catalogue déjà lu. Demandé sans avoir été fourni, il **lève en le nommant** — un
catalogue vide serait indiscernable d'un module coupé.

## Tests

`src/**/*.test.ts`, à côté du code qu'ils couvrent, **une par couche qui porte
une règle** : `domain/docs-page.test.ts` (le frontmatter, le manifeste, les
titres et leurs ancres), `application/docs-catalog.test.ts` (l'arbre, l'ordre,
le repli i18n, le module coupé).

**La lecture du dossier est éprouvée dans `tests/docs.test.ts`**, à la racine, et
c'est délibéré : elle ne veut rien dire sans un vrai système de fichiers, et le
même fichier confronte le **contenu réellement livré** au reste — au moins deux
sections, au moins une page non traduite (sans laquelle l'état de repli
n'existerait nulle part), les ancres du sommaire contre les `id` réellement
rendus.

**Les tests d'un module sont soumis aux règles de couches de ce module** :
l'exception de lint du harnais s'arrête aux packages de premier niveau
(`eslint.config.ts`, `testHarnessException`).
