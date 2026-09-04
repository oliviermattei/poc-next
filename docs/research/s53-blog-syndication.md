# Research — Story s53-blog-syndication

> Vérifiée contre la branche par défaut au commit `8d3acf4`, en lecture seule.
> Aucune base, aucun conteneur, aucun worktree — la recherche lit des fichiers.

## Les cinq faits structurants

1. **La moitié « robots » se résout sans aucune clé nouvelle.** Le module `blog` déclare déjà `navigation: [{ id: 'index', href: BLOG_PATH, protection: { level: 'public' } }]`, et `moduleRegistry` (`apps/web/lib/module-registry.ts`) expose ces entrées **avec leur niveau de protection**. Or `apps/web/app/robots.ts:30` construit sa liste d'autorisation depuis `marketingSite.publicPaths` — un seul module, connu par son nom. Dériver cette liste des entrées de navigation **publiques du registre** couvre `/blog` immédiatement, et couvrira tout module de contenu futur sans y toucher.
2. **La quinzième clé n'est donc nécessaire que pour les URL d'articles.** `/blog/<slug>` est du **contenu découvert au build**, pas une entrée de navigation : aucune clé existante ne peut le porter. C'est la seule moitié qui justifie de rouvrir les douze modules — et le coût mesuré reste celui du 04/09 : le type, l'agrégation au registre, **douze éditions d'une ligne** (le douzième module est arrivé avec s29), et les tests.
3. **`marketingRobotsPolicy` a une bascule que la story doit connaître.** `packages/modules/marketing/src/domain/seo.ts:86-95` : si `allowed` est **vide**, la politique rend `disallow: ['/']` **sans `sitemap`**. Site public coupé et blog activé, la liste ne serait plus vide — donc le `sitemap.xml` réapparaîtrait dans `robots.txt` là où il était tu. Ce n'est pas un défaut, c'est un changement de comportement à assumer et à écrire.
4. **Les deux fichiers portent `export const dynamic = 'force-dynamic'` pour une raison mesurée** : ce sont des gestionnaires de route que Next met en cache, donc évalués pendant `next build`, où `getEnv()` rend l'environnement sans le valider et où la CI ne pose aucune `APP_URL`. Un plan de site figé au build porterait `undefined` dans chaque URL. **Toute contribution hérite de cette contrainte** — et une lecture du catalogue d'articles à la requête, pas au build.
5. **Un piège de préfixe, relevé en revue de s29 (constat M3).** `localeRouting.publicPath` préfixe **sans condition**, `/api…` compris, alors qu'`apps/web/proxy.ts` ne préfixe jamais ces chemins. `robots.ts:30-32` applique déjà `publicPath` à chaque chemin pour chaque locale : une entrée de navigation pointant vers une route d'API produirait une URL fausse, autorisée pour rien. Aucun module n'en déclare aujourd'hui ; la dérivation élargie du fait 1 en ferait une possibilité.

## Target story

Six critères. `robots.txt` **autorise `/blog`** — il l'interdit aujourd'hui · flux RSS **valide au sens d'un validateur**, pas d'une assertion maison · image Open Graph par défaut quand l'article n'en fournit pas · articles référencés dans `sitemap.xml`, **le mécanisme étant dérivé** : ni `sitemap.ts` ni `robots.ts` ne connaissent un module de plus par son nom · chaque module de l'annuaire déclare la nouvelle clé, vide s'il n'y contribue pas, **un module qui l'omettrait ne compilant pas** · module non activé : aucun flux, aucune URL d'article, la clé vide ne cassant rien · i18n activée, alternates par locale comme le site marketing les porte déjà.

Dépendances déclarées : `s29-blog-mdx`, `s10-marketing-site` — les deux fusionnées.

## Points d'ancrage

- `apps/web/app/robots.ts:30` — la liste d'autorisation, aujourd'hui tirée d'un seul module.
- `apps/web/app/sitemap.ts:28` — `marketingSitemapEntries({ paths, locales, defaultLocale, url })`, même dépendance nommée.
- `packages/modules/marketing/src/domain/seo.ts:86` — `marketingRobotsPolicy` et sa bascule sur liste vide.
- `packages/core/src/module.ts` — les quatorze clés, toutes obligatoires, aucune optionnelle.
- `packages/core/src/registry.ts:56` — `navigation: readonly RegistryNavigationEntry[]`, ce que le fait 1 exploite.
- `apps/web/lib/blog.ts:76` — `blogCatalog`, la source des URL d'articles, et son `EMPTY_BLOG_CATALOG`.

## Pièges & contraintes

- **Ne pas nommer un module dans `sitemap.ts` ni `robots.ts`.** C'est le critère 4, et c'est toute la raison d'être de la story : un second import nommé en appellerait un troisième en s30.
- **La clé doit être calculée, pas déclarative.** Les URL d'articles n'existent qu'après lecture du contenu ; une clé portant un tableau statique ne pourrait pas les porter.
- **Le module coupé ne doit rien laisser, par dérivation.** `EMPTY_BLOG_CATALOG` est le précédent immédiat, `EMPTY_MARKETING_SITE` le précédent d'origine.
- **Un flux RSS « valide » demande un validateur, pas une assertion maison** — le critère le dit explicitement. Choisir la brique est une décision de la story.
- **L'image OG par défaut est un manque du design system**, signalé par `docs/designs/s29-blog-mdx.md` : ni gabarit, ni dimensions, ni jetons applicables. `next/og` n'existe nulle part dans le dépôt. À trancher : image statique unique, ou gabarit dérivé des jetons.
- **La CSP ne doit gagner aucune origine.** Une image OG générée à la requête reste servie par l'application ; une image hébergée ailleurs demanderait une origine, donc une justification écrite.
- **Le flux doit être une route du module**, sinon le critère « module coupé, aucun flux » exige une condition au lieu d'une dérivation. Le module `blog` déclare aujourd'hui `routes: []` — c'est là que la story ajoutera la sienne.

## Questions ouvertes

- **La dérivation du fait 1 remplace-t-elle `marketingSite.publicPaths`, ou s'y ajoute-t-elle ?** Le marketing déclare des chemins qui ne sont pas des entrées de navigation (pages légales, contact). Les deux sources coexisteront probablement — mais alors `robots.ts` connaît toujours `marketing` par son nom, et le critère 4 n'est tenu qu'à moitié. À trancher au plan : soit le marketing contribue lui aussi par la nouvelle clé, soit le critère est reformulé pour ce qu'il tient.
- **Que fait la clé pour un module qui n'a pas de contenu ?** Un tableau vide, une fonction rendant un tableau vide, ou `null` ? Les quatorze clés existantes mélangent les trois conventions (`routes: []`, `migrations: null`, `purge: async () => {}`).
- **Le flux RSS est-il par locale ?** Le critère i18n parle des alternates du plan de site, pas du flux. Un flux unique mêlant les langues, ou un flux par locale servi sous son préfixe — non tranché.
- **L'image OG par défaut est-elle unique, ou dérivée de l'article ?** Le critère dit « une image par défaut », ce qui n'exclut ni l'une ni l'autre. Le coût diffère d'un ordre de grandeur.
- **Le `sitemap.xml` doit-il porter la date de l'article ?** `lastModified` est un champ que le format prévoit et que le frontmatter porte déjà. Non demandé par les critères.

## Complexité réelle

Notée **3** dans `docs/stories.md`. **Ma note : 3, confirmée** — mais la répartition n'est pas celle qu'on croit.

La quinzième clé, qui semblait le gros du travail, est **mécanique** : douze éditions d'une ligne, une agrégation, des tests. Ce qui coûte est ailleurs — le choix d'une brique RSS et sa validation réelle, la décision sur l'image OG, et surtout la **question ouverte n°1** : tant que `marketing` contribue par un chemin différent des autres modules, `robots.ts` continue de le connaître par son nom et le critère 4 n'est tenu qu'à moitié.

Pas de proposition de découpe : les six critères partagent le même mécanisme de contribution, et les séparer produirait une story qui ne close rien.
