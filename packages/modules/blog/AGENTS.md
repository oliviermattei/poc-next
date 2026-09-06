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

- `@repo/core` pour le contrat de module, la qualification des clés et le
  **constructeur de flux** (`renderFeed`) : il vivait dans le `domain` de ce
  module (s53) et est monté au socle en s31 (ADR 065), quand le changelog en est
  devenu le second consommateur. `renderBlogFeed` n'est plus qu'une enveloppe qui
  parle d'articles ; ce qu'il reste ici est le vocabulaire du blog, jamais la
  mécanique RSS ;
- `@repo/ui` pour la présentation — jamais Radix directement (ADR 022). **C'est
  de là que vient l'échelle de prose** (`PROSE_CLASSNAME`, `proseComponents`) :
  s29 l'avait posée dans ce module, ADR 055 l'a remontée dans le design system
  quand s30 en est devenue la seconde consommatrice, et ce module l'importe
  désormais comme n'importe qui d'autre ;
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
- d'appel réseau sortant, ni de lecture de `process.env` : l'`APP_URL` du flux
  arrive par le contenu que l'application fournit.

## Ce que le contrat déclare, et pourquoi si peu

Ni table, ni migration : le contenu est dans des fichiers.
`dataCategories: []` et `retention: {}` sont **déclarés vides**, pas omis
(ADR 007) — un article est écrit par le propriétaire du dépôt, ce n'est la
donnée personnelle de personne.

Une seule entrée de navigation, publique. C'est elle qui disparaît avec le
module, sans qu'aucun composant ne porte de condition.

**Une seule route depuis s53 : le flux RSS** (`GET /blog/feed.xml`, montée sous
`/api/modules/…`). C'est ce qui rend « module coupé, aucun flux » **dérivé**
plutôt que conditionnel — coupée, la route n'est dans aucune table et le
répartiteur répond 404 comme sur un chemin inventé. Publique, donc **limitée**
par la politique `default` sans le déclarer (ADR 050).

**Et la quinzième clé, `publicUrls`** (ADR 054) : la liste et un chemin par
slug, avec les langues où l'article existe et la date du frontmatter. C'est par
elle que `/blog` entre dans le `robots.txt` et que les articles entrent dans le
`sitemap.xml`, sans que les deux fichiers de métadonnées de l'application ne
nomment ce module.

Le catalogue n'existe pas à l'import : `provideBlogContent`
(`src/infrastructure/blog-content.ts`) reçoit du point de composition le
catalogue, les langues **servies** et une façon de faire une URL absolue.
Demandé sans avoir été fourni, il **lève en le nommant** — un catalogue vide
serait indiscernable d'un module coupé.

**Le document RSS est écrit à la main** (`src/domain/feed.ts`), sans
bibliothèque de génération : une douzaine de balises ne valent pas une
dépendance d'exécution de plus dans l'image de production. Le prix est
l'échappement XML, et il est payé par la mesure — `tests/blog.test.ts` passe le
flux **servi** à un analyseur de flux tiers (`@rowanmanning/feed-parser`), avec
un article dont le titre porte `&`, `<` et des guillemets.

**Ce que cet analyseur prouve : « analysable comme flux », pas « valide ».** Il
se décrit lui-même comme *resilient*, il lève sur un document qui n'est pas un
flux et il accepte un `<channel>` sans titre, sans lien et sans description —
les deux bords sont un cas de `tests/blog.test.ts`, pour qu'aucune relecture ne
regonfle la phrase. Le dépôt n'embarque **aucun validateur** ; la conformité au
format se lit dans la spécification. C'est comme ça qu'a été trouvé le défaut
que s53 a corrigé en revue : `<item><author>` est une **adresse email** en
RSS 2.0, un nom nu y vaut `InvalidContact` — le nom d'auteur est donc rendu en
`dc:creator`, espace de noms déclaré, et le document **servi** l'atteste
(`e2e/blog.spec.ts`).

**L'image Open Graph n'est pas ici.** Un article peut déclarer la sienne
(`image:` au frontmatter, un chemin de **notre** origine — une URL externe
demanderait une source dans la politique de sécurité du contenu) ; le **défaut**
appartient à l'application (`apps/web/lib/og-image.ts`), parce qu'il vaut pour
tout le produit et pas pour le blog.

Aucun squelette de chargement non plus, ni la clé qui l'aurait légendé. Ce
n'est pas un oubli : un squelette suppose une frontière `Suspense`, donc un
`loading.tsx` dans `apps/web`, et un `loading.tsx` sur `app/blog/` fait répondre
**200** à un slug inconnu au lieu de 404 — la coquille part avant que la page
n'ait décidé. Mesuré par `e2e/blog.spec.ts:132`, et détaillé dans
`apps/web/AGENTS.md`. Le refus prime sur le confort ; le manque est signalé au
design system plutôt que comblé ici (constat F3 de la revue de s29).

## Tests

`src/**/*.test.ts`, à côté du code qu'ils couvrent — un par couche qui porte une
règle : `domain/article.test.ts` (le frontmatter, l'image de partage),
`application/blog-catalog.test.ts` (locale, tag, pagination, module coupé),
`infrastructure/content-directory.test.ts` (le dossier).

**Le flux et la contribution d'URL sont éprouvés dans `tests/blog.test.ts`**, et
c'est délibéré : les deux ne veulent rien dire sans le répartiteur, le registre
et le point de composition — ce sont des questions de câblage, pas des règles du
module.

**Les tests d'un module sont soumis aux règles de couches de ce module** :
l'exception de lint du harnais s'arrête aux packages de premier niveau
(`eslint.config.ts`, `testHarnessException`). Un test de `domain` qui aurait
besoin d'`infrastructure` signalerait un `domain` qui n'est plus pur.
