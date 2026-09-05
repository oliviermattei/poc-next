---
validated: yes
---
# Plan — Story s53-blog-syndication

Branch: `feature/s53-blog-syndication`
Research: `docs/research/s53-blog-syndication.md` — **à lire d'abord** : la moitié « robots » ne demande aucune clé nouvelle, et `marketingRobotsPolicy` a une bascule sur liste vide.
Story issue de la découpe de s29 (04/09). s29 a livré le blog **activé mais introuvable** : c'est cette story qui le rend indexable.

## Target story

Six critères : `robots.txt` autorise `/blog` · flux RSS valide **au sens d'un validateur** · image Open Graph par défaut · articles dans `sitemap.xml`, **le mécanisme étant dérivé** · chaque module déclare la nouvelle clé, un module qui l'omet **ne compilant pas** · module coupé : aucun flux, aucune URL, la clé vide ne cassant rien · i18n : alternates par locale.

## La décision que ce plan prend, et qu'il assume

La recherche laisse une question ouverte qui décide du reste : **`marketing` contribue-t-il par la nouvelle clé, ou garde-t-il son chemin nommé ?**

**Ce plan tranche : il y passe.** Sinon `robots.ts` et `sitemap.ts` continuent de connaître `marketing` par son nom, le critère 4 n'est tenu qu'à moitié, et la story ne fait que déplacer le problème d'un module à l'autre. Le coût est contenu — `marketing` déclare la clé, alimentée par ses `publicPaths` existants — et c'est la seule façon dont les deux fichiers de l'application cessent, réellement, de nommer qui que ce soit.

## Tasks (ordered)

1. [x] **Cas rouge d'abord — la clé au contrat, et un module qui l'omet ne compile pas.** Ajouter la quinzième clé à `ModuleDefinition` : une **fonction** rendant des URL publiques, pas un tableau — les URL d'articles n'existent qu'après lecture du contenu. Elle est **obligatoire comme les quatorze autres**, aucune option. **Test qui peut échouer** : un module d'essai qui l'omet doit faire échouer `pnpm typecheck`, et un cas doit le constater.
2. [x] **Douze déclarations, vides sauf deux.** Chaque module de l'annuaire déclare la clé ; seuls `blog` et `marketing` y contribuent. **Vérification** : `pnpm typecheck` et le cas de la tâche 1.
3. [x] **Agrégation au registre**, comme `navigation` l'est déjà. **Test qui peut échouer** : un module activé qui contribue doit apparaître, un module coupé ne doit rien rendre.
4. [x] **`robots.txt` autorise `/blog`, par dérivation.** La liste d'autorisation vient désormais des entrées de navigation **publiques du registre** **et** des contributions d'URL — plus de `marketingSite.publicPaths` nommé. Attention au piège de la recherche : `localeRouting.publicPath` préfixe **sans condition**, `/api…` compris. **Test qui peut échouer** : `/blog` autorisé module activé, absent module coupé, et aucune URL d'API préfixée d'une locale.
5. [x] **`marketingRobotsPolicy` : la bascule sur liste vide, écrite.** Site public coupé et blog activé, la liste cesse d'être vide et le `sitemap` **réapparaît** dans `robots.txt` là où il était tu. Ce n'est pas un défaut, c'est un changement de comportement. **Test qui peut échouer** : les deux configurations, et le commentaire dit laquelle.
6. [x] **Les articles dans `sitemap.xml`**, par la même clé, avec leurs alternates par locale — le motif que `marketingSitemapEntries` porte déjà. Hériter du `force-dynamic` et de sa raison. **Test qui peut échouer** : un article de fixture apparaît, module coupé il n'y en a aucun.
7. [x] **Le flux RSS comme route du module.** C'est ce qui rend le critère « module coupé, aucun flux » **dérivé** plutôt que conditionnel — `blog` déclare aujourd'hui `routes: []`. Le flux passe par un **analyseur de flux tiers**, pas par une assertion maison. **Test qui peut échouer** : l'analyse du document servi, plus un 404 module coupé. *(Corrigé en revue : la formulation « validé par un validateur réel » était fausse — voir la note d'exécution.)*
8. [x] **L'image Open Graph par défaut.** `next/og` n'existe nulle part dans le dépôt, et le design system n'a **ni gabarit, ni dimensions, ni jetons applicables** — c'est le manque n°2 signalé par `docs/designs/s29-blog-mdx.md`. Trancher entre une image statique unique et un gabarit dérivé des jetons, **écrire la décision**, et signaler ce que le système ne couvre toujours pas. **Aucune origine ajoutée à la CSP.** **Vérification** : les balises produites pour un article sans image, et le rendu de l'image.
9. [x] **ADR 054** — la quinzième clé : ce qu'elle porte, pourquoi une fonction et non un tableau, pourquoi `marketing` y passe aussi, et les options rejetées avec la mesure qui les tue. La forme symétrique — un chemin du socle qui consulte un module optionnel — **reste ouverte pour s32** et l'ADR doit le dire.
10. [x] **Passage complet.** `pnpm typecheck`, `lint`, `test`, `build`, `test:e2e`, `test:socle`, `test:minimal-profile`, `run audit`. Comptes rapportés, intermittents connus nommés sans être corrigés.

## Run interdicts

- **Ne nommer aucun module dans `apps/web/app/robots.ts` ni `apps/web/app/sitemap.ts`.** C'est le critère 4 et la raison d'être de la story. Un `import` de `@repo/module-*` dans l'un de ces deux fichiers est un échec, pas un détail.
- **Aucune origine ajoutée à la CSP**, pour l'image OG ni pour autre chose. `apps/web/lib/security-headers.ts` et `config/security.ts` restent hors du diff.
- **Ne pas retirer `force-dynamic`** des deux fichiers : la raison est mesurée et écrite sur place.
- **Ne rien inventer hors du design system.** L'image OG est un manque à **signaler** ; le combler par un gabarit inventé serait la dérive que le dépôt refuse.
- **Ne pas corriger les intermittents connus** — `tests/audit-exceptions.test.ts`, `e2e/rate-limiting.spec.ts:38`, la paire `e2e/oauth.spec.ts:30`/`:97`. Ils appartiennent à s52 ; les nommer s'ils rougissent, ne pas se les attribuer.
- **Ne pas traiter la forme symétrique** du contrat (le socle qui consulte un module optionnel) : elle appartient à s32.
- **Ne pas toucher `docs/killer-saas-feedback.md`** ni `docs/research/` : ils vivent sur la branche par défaut.

## The point everything turns on

**Faire cesser deux fichiers de l'application de connaître un module par son nom** — et pour de bon, pas à moitié. C'est pourquoi `marketing` passe par la clé lui aussi : le laisser sur son chemin nommé aurait donné une story qui *paraît* tenir le critère 4 tout en le violant à l'endroit exact où il compte.

Trois endroits où ça peut être faux :

1. **La clé pourrait ne rien porter d'utile.** À comparer : un module coupé doit rendre zéro URL, un module contributeur doit en rendre, et le balayage ne doit pas être vide — c'est le plancher que `test:minimal-profile` réclame déjà ailleurs, et la garde HTTP de s29 en donne le motif.
2. **La dérivation pourrait produire des URL fausses.** Le piège est nommé : `publicPath` préfixe `/api…` sans condition. Un cas doit l'exiger.
3. **La bascule de `marketingRobotsPolicy` pourrait surprendre.** Site public coupé, blog activé : la liste cesse d'être vide, donc le `sitemap` réapparaît. À comparer aux deux configurations, pas à l'intuition.

## Files touched

`packages/core/src/module.ts` et `registry.ts` (la clé, l'agrégation) · les douze `packages/modules/*/src/module.ts` · `apps/web/app/robots.ts` et `sitemap.ts` · le module `blog` (sa route de flux, sa contribution d'URL) · `packages/modules/marketing` (sa contribution) · `docs/decisions/054-*.md` · les tests · le plan.

**Ajoutés à l'exécution, et nommés ici après la revue** (constat m9) : `apps/web/proxy.ts` (il appelle `carriesLocalePrefix` au lieu de porter la règle — comportement identique, mais c'est le fichier qui pose la CSP), `apps/web/app/layout.tsx` (`metadataBase`), `apps/web/lib/` (`public-urls.ts`, `site-url.ts`, `module-content.ts`, `og-image.ts`, `blog.ts`, `marketing.ts`), `scripts/og-image.ts`, `apps/web/public/og-default.png`, le `Dockerfile`, `docs/design-system.md`, et — au tour de correction — `docs/security.md` (le contrôle d'indexation, constat m5).

## Test strategy

**La clé** : au contrat et au registre, sans base — c'est là qu'elle vit. **La dérivation** : sur les deux fichiers de l'application, dans les deux configurations de modules, avec le cas des URL d'API. **Le flux** : passé à un analyseur de flux tiers — ce qui prouve « analysable », pas « valide » —, plus un 404 module coupé. **L'image OG** : les balises produites, et un rendu.

Aucun écran nouveau : la story ne rend rien qu'un utilisateur lise, sauf l'image OG, qui se vérifie en la regardant.

## Definition of Done

- Les dix tâches cochées, chacune avec sa mutation posée **à l'endroit du défaut** et son compte de rouges.
- **Aucun `import` de `@repo/module-*` dans `robots.ts` ni `sitemap.ts`** — vérifiable d'un `grep`.
- Le harnais complet vert, comptes rapportés, intermittents connus nommés.
- ADR 054 écrit, avec ses options rejetées et ce qu'il laisse ouvert pour s32.
- Un commit unique, message impératif en français, portant le plan.
- Après la fusion : `robots.txt` autorise `/blog`, et `sitemap.xml` porte les articles — constaté sur `dev`, pas déduit.

## Ce que l'exécution a changé au plan (05/09)

**La tâche 4 n'a pas été tenue telle qu'écrite, et la mesure explique pourquoi.**
Le plan demandait que la liste d'autorisation vienne « des entrées de navigation
**publiques du registre** **et** des contributions d'URL ». La configuration
livrée compte **cinq** entrées de navigation publiques — `marketing /`,
`auth /sign-in`, `blog /blog`, `billing /pricing`,
`demo-enabled /api/modules/demo-enabled/items` : en dériver l'index aurait
publié l'écran de connexion, la page de tarifs et une route d'API dans le
`sitemap.xml` et le `robots.txt`. `tests/marketing.test.ts` (balayage des écrans
du disque) et `e2e/marketing.spec.ts` (`PRIVATE_PATHS`) l'interdisent déjà par
leur nom, et `docs/security.md` §7 aussi.

La dérivation ne lit donc **que la quinzième clé** : `blog` déclare `/blog` en
plus de ses articles, `marketing` déclare ses chemins publics. Les six critères
sont tenus, la story ne nomme aucun module dans les deux fichiers, et un module
de contenu futur entre par sa déclaration. `public` est un niveau de
**protection**, pas une décision d'indexation — c'est écrit dans l'ADR 054, et
`tests/syndication.test.ts` rougit si quelqu'un rebranche la navigation
(mutation mesurée : 8 cas).

**La tâche 5 a déménagé la fonction qu'elle nomme.** `marketingRobotsPolicy` et
`marketingSitemapEntries` sont montées dans `@repo/core` sous les noms
`robotsPolicy` et `sitemapEntries` : les laisser dans le module aurait gardé
`robots.ts` et `sitemap.ts` important `@repo/module-marketing`, c'est-à-dire
l'interdit de la story. La bascule sur liste vide, elle, est inchangée et
mesurée dans les deux configurations.

**Trois ajouts que le plan ne nommait pas, chacun exigé par un critère.**
`app/layout.tsx` pose `metadataBase` (sans elle Next publie
`http://localhost:3000` dans les balises de partage), le `Dockerfile` recopie
`apps/web/public` (la sortie autonome ne trace pas ce dossier, l'image OG y
répondrait 404), et le frontmatter gagne un champ `image` **facultatif** —
sans lui, « une image par défaut **quand l'article n'en fournit pas** » n'aurait
pas eu de second cas.

## Ce que la revue a fait corriger (05/09, même commit)

La revue (`Max severity: major`, `Ship allowed: yes`) a laissé deux majeurs et
trois mineurs à fermer avant le ship. Ils l'ont été dans **le commit de la
story**, pas dans un second.

**M2 — deux blocs de documentation de `@repo/core` enseignaient encore la règle
que cette story réfute.** `packages/core/src/module.ts` (docblock de
`PublicUrl`) et `packages/core/src/syndication.ts` (docblock d'`IndexableUrl`)
disaient l'index construit « des contributions **et des entrées de navigation
publiques du registre** ». `module.ts` est le premier fichier qu'un agent ouvre
pour écrire un module : agir sur cette phrase publie `/sign-in`, `/pricing` et
`/api/modules/demo-enabled/items` dans le `sitemap.xml`. Les deux disent
désormais la source unique, **et pourquoi** la navigation n'en est pas une — les
cinq entrées mesurées sont l'argument.

**Le balayage, fait par le contenu de l'affirmation et non par la liste de deux
sites.** Recherche sur `navigation publique`, `deux sources`, `sources
fusionnées`, `publicNavigation`, `navigation ↔ registre/index`, `protection ↔
index` : **quatre** sites portaient la phrase, et deux seulement étaient faux.
Les deux autres sont `docs/plans/s53-blog-syndication.md` (la tâche 4 telle
qu'écrite avant l'exécution, démentie douze lignes plus bas par la note du
05/09) et `docs/research/s53-blog-syndication.md` (une piste proposée, pas une
règle — et la recherche vit sur la branche par défaut). Tous les autres sites —
ADR 054, les deux `AGENTS.md`, `docs/architecture.md`, les docblocks
d'`indexableUrls` et de `robots.ts`, huit cas de test — disaient déjà l'inverse.

**M1 — « valide au sens d'un validateur » était tenu par un analyseur
résilient, et le document avait un défaut de conformité nommable.** Deux gestes,
et le second compte autant :

1. **Le document.** `<item><author>` est, en RSS 2.0, l'**adresse email** de
   l'auteur (`<author>lawyer@boyer.net (Lawyer Boyer)</author>`) ; un nom nu y
   vaut `InvalidContact` au validateur de flux du W3C. Le frontmatter porte un
   nom d'affichage. Des deux corrections possibles, `<author>adresse (Nom)</author>`
   a été **écartée** : le dépôt n'a aucune adresse à publier, et en inventer une
   mettrait une boîte aux lettres dans un document que des robots moissonnent.
   Le nom est donc rendu en `dc:creator`, espace de noms Dublin Core déclaré sur
   `<rss>` — la convention prévue pour un nom seul. Vérifié **sur le document
   servi** : `e2e/blog.spec.ts` lit le corps HTTP, pas seulement un test de nœud.
2. **La phrase.** Quatre sites annonçaient un validateur tiers :
   `packages/modules/blog/src/domain/feed.ts`, `packages/modules/blog/AGENTS.md`,
   l'en-tête du bloc de `tests/blog.test.ts`, et les tâches 7 / *Test strategy*
   de ce plan. Ils disent maintenant « analysé par un analyseur de flux tiers »,
   et **ce que cet analyseur ne prouve pas** : mesuré, il lève sur `<p>bonjour</p>`,
   sur du texte brut et sur un `<rss>` sans `<channel>`, mais il accepte un
   `<channel>` sans titre ni lien ni description dont l'article n'a qu'un
   `<guid>`. Un cas de `tests/blog.test.ts` fixe désormais les deux bords, pour
   qu'aucune relecture ne regonfle la phrase. **Le critère 2 de la story dit
   « valide au sens d'un validateur » : le dépôt n'en embarque aucun**, et le
   tenir vraiment demanderait une dépendance de validation ou un appel au
   service du W3C — ni l'un ni l'autre n'a été décidé ici. C'est ce que la story
   tient réellement, écrit sans arrondi.

**m5 — six citations de `docs/security.md` §7 désignaient une règle absente du
document.** §7 est « Journalisation, détection et abus » ; la règle citée est
« publier un écran applicatif dans un index public est une divulgation gratuite
de surface ». La citation la plus ancienne vient de s10, et s53 la promouvait à
l'autorité d'un ADR. Plutôt que de retirer six citations dont une **dans un ADR
immuable**, la règle a été **écrite** : `docs/security.md` §7 porte un contrôle
« Aucun écran applicatif dans un index public », au format du document — chaque
ligne nomme la commande qui échoue (`pnpm test` pour le balayage des écrans du
disque et pour la dérivation, `pnpm test:e2e` pour `PRIVATE_PATHS`). Les six
citations sont exactes, et l'ADR 054 n'a pas besoin d'être supersédé.

**m3 — l'en-tête de `packages/modules/blog/src/module.ts`** annonçait encore
« ni table, ni migration, **ni route d'API** » dix-huit lignes au-dessus de
`routes: createBlogFeedRoutes(…)`, et listait le flux, l'image OG et la
contribution au plan de site comme « ce que ce module ne fait pas encore », les
trois livrés dans le même objet. Réécrit.

**m4 — `domain/feed.ts` envoyait à `tests/syndication.test.ts`** pour la mesure
du flux servi, qui est dans `tests/blog.test.ts`. Pointeur mort corrigé.

**m8 — les quatre dimensions inventées sont nommées.** Titre 88 px, sous-titre
36 px, marge et retrait 64 px, interligne 24 px : aucune ne dérive des huit
rôles typographiques du système. Elles entrent dans la note de manque de
`docs/design-system.md` (« Image sociale »), sous forme de tableau avec la
raison pour chacune — c'est le travail de cette note : dire à la story suivante
ce qui manque. `scripts/og-image.ts` y renvoie, et son `const page_document` est
renommé `pageDocument` (règle de nommage du dépôt). L'image a été **régénérée
après le renommage** : octet pour octet identique.

**Constats laissés ouverts, délibérément.**

- **m6 — un quatrième intermittent.** `e2e/blog.spec.ts:134` a échoué une fois
  en `ECONNRESET`, vert au rejeu et vert sur un second passage complet. Il
  rejoint la liste de s52 (`tests/audit-exceptions.test.ts`,
  `e2e/rate-limiting.spec.ts:38`, la paire `e2e/oauth.spec.ts:30`/`:97`) ; les
  corriger n'appartient pas à cette story, et se les attribuer masquerait la
  cause commune.
- **m7 — rien ne demande `/og-default.png` en HTTP.** La revue a prouvé le
  critère avec une sonde temporaire ; aucune commande ne le garde. Trois lignes
  dans `e2e/blog.spec.ts` suffiraient — c'est un choix du cycle suivant, pas une
  correction à improviser sous un fix.
- **m9 — deux choses, non traitées.** `apps/web/proxy.ts` est modifié sans
  figurer dans *Files touched* ci-dessus : le changement est **identique
  caractère pour caractère** au comportement précédent (la règle de préfixe est
  montée dans `@repo/core` sous `carriesLocalePrefix` et le proxy l'appelle),
  mais c'est le fichier qui pose la CSP et il méritait d'être nommé — il l'est
  ici. Et `e2e/marketing.spec.ts` dérive l'ensemble attendu du plan de site
  d'une façon qui rougirait pour la mauvaise raison le jour où un article
  n'existera qu'en `en` ; `tests/syndication.test.ts` le fait correctement, par
  slug. Laissé tel quel : le corriger demande de décider ce que le parcours
  mesure, ce qui est une décision de plan.
