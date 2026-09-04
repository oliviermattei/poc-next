# Research — Story s29-blog-mdx

> Recherche menée **pendant la revue de s48**, depuis le worktree de s29 et une lecture seule de `dev`. Les faits ci-dessous sont vérifiés au commit `66b90e3`.

## Les cinq faits structurants

1. **Le dépôt ne porte aucune brique MDX.** Balayage du fichier de verrouillage sur neuf motifs — `next-mdx*`, `@mdx-js/*`, `contentlayer*`, `fumadocs*`, `gray-matter`, `remark*`, `rehype*`, `feed`, `rss*` — **aucune correspondance**. s29 introduit la famille de dépendances, et `docs/stories.md` dit qu'elle sert aussi s30 (docs) et s31 (changelog) : le choix engage trois stories, pas une.
2. **La CSP interdit d'évaluer du MDX à l'exécution en production.** `apps/web/lib/security-headers.ts:97-113` compose `script-src` = `'self'`, le nonce de la requête, `'strict-dynamic'`, plus les origines déclarées ; `'unsafe-eval'` n'est ajouté **que** si `mode === 'development'`, et le commentaire dit pourquoi (React). La compilation au build n'est donc pas une préférence de performance, c'est la seule voie qui respecte le socle de sécurité.
3. **Le balisage riche est une décision explicitement différée à une story — celle-ci.** `packages/modules/marketing/src/presentation/legal-document.tsx:18-22` : « Le rendu est **échappé** par React, et rien ici n'utilise `dangerouslySetInnerHTML` : le texte vient des catalogues, il n'a pas à porter de balisage (`docs/security.md` §4). Un document qui aurait besoin de mise en forme riche est **une décision de story, pas un contournement**. » s29 est cette décision.
4. **Le contrat de module n'a aucune clé de plan de site, et l'application connaît le module `marketing` par son nom.** Les quatorze clés de `ModuleDefinition` (`packages/core/src/module.ts`) sont `id, requires, schema, migrations, routes, navigation, messages, emails, webhooks, jobs, dataCategories, retention, purge, export` — zéro occurrence de « sitemap ». Or `apps/web/app/sitemap.ts:1,28` **et** `apps/web/app/robots.ts:30` importent `marketingSitemapEntries` / `marketingSite.publicPaths` de `@repo/module-marketing`. Deux fichiers de l'application, câblés à un module nommé.
5. **Tout le contenu du dépôt vit aujourd'hui dans les catalogues de messages, pas dans des fichiers.** Les pages légales sont des sections déclarées dans la configuration (`marketing-config.ts:132`, `legalDocuments`), rendues par clés de message. Le blog introduit la **première source de contenu par fichier**, et c'est exactement sur cette bascule que porte le critère i18n de la story.

## Target story

`s29-blog-mdx` — publier des articles en MDX, comme canal d'acquisition organique. Huit critères d'acceptation : un fichier déposé apparaît après build sans autre geste · frontmatter typé (titre, description, date, auteur, tags), un frontmatter invalide fait échouer le build **en nommant le fichier fautif** · liste paginée et filtrable par tag · balises méta et Open Graph par article, avec image OG par défaut si aucune n'est fournie · flux RSS valide · i18n activée, un article sans traduction n'apparaît pas dans cette locale ; i18n coupée, tout est servi dans la langue par défaut · articles référencés dans `sitemap.xml` · **module non activé** : aucune route, aucun flux, et le lien disparaît de la navigation publique.

Dépendances déclarées : `s10-marketing-site`, `s09-i18n`.

## État actuel du code

**Le module `marketing` est le modèle le plus proche.** Quatre couches présentes (`domain/`, `application/`, `infrastructure/`, `presentation/`), `domain/seo.ts` porte déjà la génération d'alternates par locale, `application/marketing-site.ts` expose `publicPaths`, et `EMPTY_MARKETING_SITE` (`marketing-site.test.ts:230`) donne le motif du module coupé : **une valeur vide fait tout le travail, sans condition sur un module**. C'est le motif à copier, pas à réinventer.

**`apps/web/app/sitemap.ts`** — `export const dynamic = 'force-dynamic'`, et le commentaire explique que ce n'est pas une commodité : le fichier est un route handler que Next met en cache, donc évalué pendant `next build`, où `getEnv()` rend l'environnement sans le valider et où la CI ne pose aucune `APP_URL`. Un plan de site figé au build porterait `undefined` dans chaque URL. **Toute contribution du blog au plan de site hérite de cette contrainte.**

**`config/i18n.ts:19,22`** — `appLocales = ['fr','en']`, `defaultLocale = 'fr'`. Le commentaire distingue explicitement les locales **de l'application** de celles que chaque module déclare au contrat, et dit que la confusion a déjà causé un défaut (les templates d'email contrôlés contre les mauvaises locales). Le critère i18n de cette story tombe exactement sur cette distinction.

**Aucun générateur d'image Open Graph** : `next/og` et `ImageResponse` n'apparaissent nulle part dans `apps/` ni `packages/` (hors `node_modules` et `.next`).

## Points d'ancrage

- `packages/core/src/module.ts` — le contrat, si une clé doit y naître.
- `packages/core/src/registry.ts:31,56` — `RegistryNavigationEntry` et l'agrégation : l'entrée de navigation du blog passe par là, et la moitié « le lien disparaît » du critère 8 est déjà tenue par le mécanisme existant.
- `apps/web/app/sitemap.ts` et `apps/web/app/robots.ts` — les deux fichiers à faire évoluer, ou à laisser tranquilles selon la voie retenue.
- `apps/web/lib/security-headers.ts:97` — la CSP, à ne pas assouplir.
- `packages/modules/marketing/src/domain/seo.ts` — les alternates par locale, déjà écrites une fois.

## APIs / fonctions vérifiées

- `marketingSitemapEntries({ paths, locales, defaultLocale, url })` — `@repo/module-marketing`, consommée par `sitemap.ts:28`.
- `marketingSite.publicPaths` — `apps/web/lib/marketing.ts`, consommée par `sitemap.ts:28` **et** `robots.ts:30`.
- `localeRouting.publicPath(pathname, locale)` et `localeRouting.locales` — `apps/web/lib/locale-routing.ts` ; `publicPath` est l'identité quand `i18n` est coupé, ce qui fait que le plan de site ne porte qu'une langue sans qu'une ligne le sache.
- `appLocales`, `defaultLocale`, `AppLocale` — `config/i18n.ts:19-24`.
- `NONCE_HEADER = 'x-nonce'` — `apps/web/lib/security-headers.ts:23`, le chemin par lequel le nonce atteint les composants serveur.

## Pièges & contraintes

- **La CSP est un socle non négociable.** Ajouter une origine à `script-src` demande une justification écrite dans la story, et `'unsafe-eval'` en production est exclu. Une bibliothèque MDX qui compile à l'exécution est disqualifiée avant d'être évaluée.
- **`dangerouslySetInnerHTML` est refusé par précédent explicite.** Un pipeline MDX compilé en composants React n'en a pas besoin ; un pipeline Markdown→HTML en aurait besoin. C'est le critère qui départage les deux familles.
- **Le frontmatter doit faire échouer le build en nommant le fichier.** Le dépôt impose Zod à chaque frontière ; c'est la même règle, appliquée à un fichier de contenu.
- **Le plan de site est `force-dynamic` pour une raison mesurée.** Toute solution qui recalcule les articles au build reprend le défaut que ce commentaire documente.
- **Le module coupé ne doit laisser aucune trace, par dérivation et non par condition.** `EMPTY_MARKETING_SITE` est le précédent ; une condition `if (blogEnabled)` dans `sitemap.ts` serait une régression de principe même si elle passe les tests.
- **Deux voies tournent en parallèle** au moment d'écrire : s48 est en revue et touche `tests/minimal-profile.test.ts`, `scripts/audit.ts`, `AGENTS.md` et `package.json`. Aucun de ces fichiers n'est central à s29, mais `AGENTS.md` et `package.json` seront touchés par les deux — rebaser sur `dev` après la fusion de s48 avant d'exécuter s29.
- **ADR 052 est pris par s48.** Les numéros **053 et 054** sont réservés à cette story.

## Questions ouvertes

- **Comment un article atteint-il `sitemap.xml` ?** Trois voies, aucune gratuite, et c'est la décision principale de la story : *(a)* un second import nommé dans `sitemap.ts` et `robots.ts` — l'application connaîtrait deux modules par leur nom, et chaque module de contenu futur en ajouterait un troisième ; *(b)* une clé au contrat — `AGENTS.md` annonce le coût : « adding one later means reopening every module already written », soit onze modules ; *(c)* dériver depuis `routes` — impossible tel quel, les URL d'articles sont du **contenu**, pas des routes déclarées. À trancher au plan, avec ADR.
- **Quelle brique MDX ?** Non tranché. Le critère éliminatoire est la compilation au build (fait 2) ; le critère secondaire est ce que s30 et s31 en réutiliseront.
- **L'image Open Graph par défaut est-elle générée ou statique ?** Générer implique `next/og`, absent du dépôt, et un rendu à la requête ou au build à décider. Une image statique par défaut coûte moins et satisfait le critère littéralement.
- **Un article sans traduction : le fichier est-il par locale, ou le frontmatter porte-t-il ses locales ?** Le dépôt a déjà été mordu par la confusion entre locales d'application et locales de module (`config/i18n.ts:5-7`) : la réponse doit être écrite, pas déduite.
- **Le flux RSS est-il une route de module ou un fichier de l'application ?** S'il est une route du module, le critère « module coupé, aucun flux » tombe tout seul ; s'il est un fichier de l'application, il faut une condition — donc probablement la première voie, mais rien ne l'a vérifié.

## Complexité réelle

La story est notée **3** dans `docs/stories.md`.

**Ma note : 4.** Huit critères qui couvrent un pipeline de contenu au build, une famille de dépendances neuve, une décision structurelle sur le contrat de module, la génération d'images, un flux de syndication, une bascule i18n sur une source de contenu inédite, et deux fichiers de l'application aujourd'hui câblés à un module nommé. Ce n'est pas la difficulté d'un écran, c'est la surface.

## Proposition de découpe (optionnelle, à trancher au plan)

Elle n'est pas obligatoire à 4, mais le dépôt a déjà été mordu deux fois par des stories dépassant 66 fichiers en un commit (s18, s19), et les constats critiques y étaient des **oublis de câblage**. Ligne de coupe proposée :

- **s29a — lire un article.** Le pipeline MDX au build, le frontmatter validé qui nomme le fichier fautif, la page d'article, la liste paginée et filtrable, les balises méta, l'entrée de navigation, et le module coupé qui ne laisse aucune trace. Close seule : on publie et on lit un article.
- **s29b — le faire trouver.** Le flux RSS, l'image Open Graph par défaut, et la contribution au plan de site — c'est-à-dire **la décision structurelle du fait 4**, isolée là où elle peut être discutée sans le reste. Close seule : un article publié est indexable et syndiqué.

L'argument contre : le critère i18n traverse les deux moitiés. L'argument pour : la décision du fait 4 mérite son propre cycle de revue, et c'est elle qui peut rouvrir onze modules.
