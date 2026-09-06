# packages/modules/changelog — règles locales

Les nouveautés du produit : des notes de version écrites en MDX, lues par un
visiteur. C'est la **troisième source de contenu par fichier** du dépôt, après le
blog (s29) et la documentation (s30), et elle en hérite les deux interdits.

**1. Le MDX est compilé au build, jamais évalué à l'exécution (ADR 053).** La
politique de sécurité du contenu n'accorde `'unsafe-eval'` qu'en développement
(`apps/web/lib/security-headers.ts`). Ce module ne compile rien : il lit des
**en-têtes**, et le corps des entrées est un module JavaScript que le bundler de
Next produit.

**2. Aucun `dangerouslySetInnerHTML`, nulle part.**

**3. Les locales servies ne sont pas les locales de l'application.**
`readChangelogDirectory` reçoit les deux : un dossier dont le nom est une locale
de l'application mais qui n'est pas servi (`en` quand `i18n` est coupé) est
**ignoré** ; un dossier que personne ne servira jamais (`de`) est **refusé en le
nommant**. `config/i18n.ts:5-7` documente le défaut que la confusion inverse a
déjà coûté au dépôt.

**4. L'ordre des versions est numérique, jamais lexicographique.** `'10.0'` vient
**après** `'9.0'`, et `'10.0' < '9.0'` en comparaison de chaînes. C'est la seule
règle algorithmique du module, elle vit dans `compareVersions` (`domain/`), et sa
fixture franchit le passage à deux chiffres — sans quoi la mutation qui remplace
le tri resterait verte jusqu'à la dixième version du produit.

**L'ordre est décidé une fois, dans `domain/`, et la présentation ne le rejoue
pas.** À l'intérieur d'une version comme entre les versions, c'est
`changelogReleases` qui ordonne ; `ChangelogList` rend `release.entries` tel
quel. Une seconde clé de tri à l'écran (par catégorie, par exemple) contredirait
le domaine sans qu'aucun test du domaine ne bouge — c'est ce que la revue de s31
a mesuré sur la version 1.1, dont l'entrée du 18 février s'affichait au-dessus de
celle du 20. `tests/changelog.test.ts` compare désormais les ancres rendues à
l'ordre attendu.

**5. Aucun `requires`, et surtout pas `blog`.** Le constructeur de flux vit dans
`@repo/core` (`renderFeed`, ADR 065) précisément pour que ce module n'ait pas à
dépendre du blog : un produit qui coupe le blog garde ses notes de version.

## Imports autorisés

- `@repo/core` pour le contrat de module, la qualification des clés et le
  constructeur de flux (`renderFeed`) ;
- `@repo/ui` pour la présentation — jamais Radix directement (ADR 022) ;
- `zod` à la frontière du frontmatter, `yaml` pour le lire ;
- `node:fs` **uniquement** dans `src/infrastructure/` ;
- `@repo/typescript-config` pour la configuration du compilateur
  (`tsconfig.json`), `@types/node` et `@types/react` pour les types, et `react`
  en pair — le module rend des composants, il ne livre pas React ;
- `typescript` pour `pnpm typecheck`.

## Ne doit jamais contenir

- de règle métier hors de `domain/` ;
- d'accès au disque hors de `src/infrastructure/` ;
- d'import d'un autre module : la seule dépendance inter-modules déclarée est
  `requires`, et celui-ci n'en a aucune ;
- d'appel réseau sortant, ni de lecture de `process.env` : l'`APP_URL` du flux
  arrive par le contenu que l'application fournit.

## Ce que le contrat déclare, et pourquoi si peu

- `routes` : **une seule**, le flux RSS. C'est elle qui rend « module coupé,
  aucun flux » dérivé — coupée, elle n'est dans aucune table de routage et le
  répartiteur répond 404 comme sur un chemin inventé ;
- `navigation` : **une seule entrée, de surface `footer`** (s31, ADR 066). C'est
  elle qui fait apparaître et disparaître le lien du pied de page public, sans qu'aucun
  écran de `apps/web/app` ne nomme ce module. Rien dans la barre latérale : des
  notes de version sont du contenu public, pas une fonctionnalité du produit ;
- `publicUrls` : **une seule URL, la page**. Les entrées n'ont pas d'adresse
  propre — elles vivent toutes sur la même page —, et en annoncer une par entrée
  publierait des adresses qui répondent 404 ;
- `schema`, `migrations` : **rien, et c'est structurel** (ADR 053). Le contenu
  vit dans des fichiers `.mdx`, pas dans la base ;
- `dataCategories`, `retention`, `purge`, `export` : vides et **déclarés**. Une
  note de version n'est la donnée personnelle de personne.

## La catégorie est une énumération fermée

`CHANGELOG_CATEGORIES` porte quatre valeurs (`added`, `changed`, `fixed`,
`removed`). Une chaîne libre rendrait le regroupement instable — « Ajout »,
« Ajouts » et « ajout » seraient trois catégories — et le libellé deviendrait le
texte du frontmatter, c'est-à-dire du texte non traduit à l'écran. En ajouter une
est une ligne dans l'énumération **et** une clé dans chaque catalogue.

**La commande qui échoue est `pnpm test`, sur `tests/changelog.test.ts`** (« le
catalogue de traductions du module »), qui consomme `changelogMessageKeys()`.
**Pas `tests/i18n.test.ts`**, contrairement à ce que ce fichier a affirmé
jusqu'à la revue de s31 : son balayage est statique et ne voit pas une clé
composée (`category.<id>`) — mesuré, une cinquième catégorie sans traduction y
laissait 102 cas verts. Une garantie sans commande derrière n'est pas une règle.

## Tests

`src/**/*.test.ts`, à côté du code qu'ils couvrent : le frontmatter et l'ordre
des versions dans `src/domain/changelog-entry.test.ts`, le filtre de langue de la
page dans `src/application/changelog-catalog.test.ts`. Ce qui traverse les
packages — le flux servi, le plan de site, le pied de page dérivé, les ancres de
la page et le catalogue de traductions — vit dans `tests/changelog.test.ts`.

**Les attentes ne se dérivent jamais de la fonction mesurée.**
`tests/rendered-text.test.ts` construit son attendu en appelant
`changelogListView` — c'est légitime pour ce qu'il fait (aucun texte affiché hors
catalogue), et c'est précisément pourquoi il ne peut pas servir de filet au
filtre de langue : son attente suit la mutation. La revue de s31 l'a mesuré,
2610 cas restant verts.
