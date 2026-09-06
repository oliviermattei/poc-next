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
  (`readDocsDirectory`) ;
- **un lien interne mort** (`resolveDocsCatalog`, s54) — le refus nomme le
  fichier fautif **et** la cible manquante, les deux. C'est la **passe
  croisée**. Elle n'est **pas** le premier refus du dépôt à traverser deux
  fichiers — deux causes ci-dessus le font depuis s30, dans la même fonction :
  « une section sans manifeste dans la langue par défaut » et « une page écrite
  seulement dans une traduction » confrontent chacune une page à d'autres
  fichiers (la story l'avait affirmé, la revue l'a corrigé). Ce qui est neuf est
  la **nature de la relation** : ces deux-là cherchent un fichier que les
  coordonnées de la page désignent — sa section, son chemin —, là où un lien est
  une *référence écrite par l'auteur*, de cible arbitraire, résolue contre le
  catalogue **entier**. Elle porte
  sur le **catalogue** déjà résolu, jamais sur un second balayage du disque, et
  elle croise avec l'arbre **canonique** dans toutes les langues : une page
  anglaise qui cite une page écrite en français seulement pointe vers une
  adresse qui répond. Ce qu'elle **ne** juge **pas**, et c'est écrit dans son
  commentaire : un lien hors de `/docs` (il appartient à un module que la
  configuration peut couper), le **fragment** d'un lien, un `<a href>` écrit en
  HTML, une référence Markdown différée, un lien construit par un composant MDX ;
- **un index de recherche au-dessus de son plafond** (`docsSearchIndex`, s54) :
  64 Kio sérialisés par langue, et le refus donne la mesure. Aucun critère de la
  story n'en fixait ; l'index part avec la page, donc chez **chaque** visiteur,
  et sans plafond mesuré la promesse « sans service externe » se paierait en
  silence sur le réseau du lecteur. `tests/docs.test.ts` mesure le contenu livré
  dans chaque langue servie ;
- **un corps au-dessus de ses bornes** (`parseDocsPage`, s54, correctif CodeQL) :
  une ligne de plus de `MAX_DOCS_LINE_LENGTH` caractères, ou un corps de plus de
  `MAX_DOCS_LINES` lignes. Le refus donne la ligne, sa longueur et le plafond.
  Voir la section suivante — c'est un refus de sécurité, pas de style.

## Les motifs qui balaient du contenu, et la borne qui les tient

CodeQL a signalé `js/polynomial-redos` en **sévérité haute** sur les deux
balayages de liens de `domain/docs-page.ts` (s54). Le motif : `[^\]]*` avale les
`[`, si bien que chaque `[` d'une ligne ouvre une tentative qui parcourt le
reste. **Mesuré** sur `'['.repeat(n)` : 20 000 caractères → 0,75 s, 50 000 →
4,7 s, 100 000 → 19,0 s de processeur. Après correctif, 400 000 caractères
coûtent 2,9 ms.

**L'exposition, sans l'enfler ni la nier.** L'entrée n'est pas un corps HTTP
anonyme comme celui de s39 : c'est un fichier de `content/`, écrit par l'auteur
du dépôt et lu au build. Un inconnu ne fait donc pas pendre la production — un
contributeur fait pendre **son propre build**, sans message. Mais ce dépôt est
un boilerplate : ses utilisateurs écrivent leur propre `content/`, et livrer un
build qui pend en silence sur un `.mdx` collé de travers est un défaut qu'on
leur transmettrait. La requête d'un visiteur, elle, ne traverse jamais ces
motifs — la recherche filtre dans le navigateur, sur des classes simples.

**Deux gardes, et la seconde est celle qui ne vieillira pas** (même paire qu'en
s39, `packages/adapters/sentry/AGENTS.md`) :

1. **le balayage est linéaire** — aucune classe n'avale le délimiteur qui
   ouvrirait la tentative suivante, et le titre facultatif d'un lien est borné
   par construction ;
2. **l'entrée est bornée avant d'être balayée** — `boundedLines` dans les trois
   balayeuses exportées, et un refus nommé dans `parseDocsPage`. Les deux ne
   disent pas la même chose : le refus connaît le fichier et le nomme, les
   balayeuses ne connaissent qu'un texte et **jettent** la ligne, ce qui empêche
   un appelant direct du baril de contourner la borne.

**Ce que les mutations donnent** (`domain/docs-page.test.ts`) : motif quadratique
restauré, borne gardée → **0 rouge sur 2 727 cas** — la borne seule désamorce,
exactement ce que s39 avait mesuré ; borne neutralisée, motif linéaire gardé →
**3 rouges** ; les deux neutralisés → **4 rouges**, dont le budget de temps à
4 739 ms pour 250.

**Le balayage qui a suivi le constat**, et il ne prétend pas à l'exhaustivité :
**21 occurrences, 17 motifs distincts**, mesurés sur 200 000 caractères adverses
chacun, dans le périmètre que cette story touche : `domain/docs-page.ts` (13),
`application/docs-search.ts` (2 — les seuls du lot qui voient une **requête** de
visiteur), `infrastructure/docs-directory.ts` (1), `blog` et `changelog` (2
chacun, `FRONTMATTER` et `SLUG` écrits à l'identique ici, donc mesurés une fois ;
leurs **corps** ne sont pas balayés du tout — seul `docs` relève titres, liens et
texte), et `packages/core/src/syndication.ts` (1, `patternMatcher`, dont le motif
**et** le chemin viennent du dépôt, et qu'aucun code d'exécution n'appelle —
seulement les tests et les parcours). Tous linéaires : le plus lent tient en
15 ms, et c'est `String.normalize` qui le paie, pas un retour arrière. Les deux
corrigés sont les deux que CodeQL avait nommés. C'est ce qui a été balayé, pas
ce qui existe : hors de ce périmètre, rien n'a été mesuré.

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
composition, `apps/web/lib/docs.ts`. **La recherche plein texte n'en a pas
demandé non plus** (s54), et la raison n'est pas la performance :
`routeIsRateLimited` (ADR 050) rend `true` pour toute route `public` sans
qu'elle le déclare, et le répartiteur est fail-closed — une route de recherche
serait plafonnée à 120 requêtes par minute et par appelant, ce qui est
raisonnable pour un formulaire et absurde pour une frappe au clavier. L'index
est donc dérivé du catalogue au chargement du point de composition — donc
pendant `pnpm build` —, il part avec la page, et le filtrage
(`searchDocsIndex`) tourne dans le navigateur. Aucune surface publique n'est
ajoutée, et `routes: []` reste vrai.

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
titres, leurs ancres, et les liens relevés du corps),
`application/docs-catalog.test.ts` (l'arbre, l'ordre, le repli i18n, le module
coupé, et la passe croisée des liens),
`application/docs-search.test.ts` (l'index, la langue servie, le plafond, le
classement). **Les attentes de ce dernier sont écrites, jamais dérivées de la
fonction mesurée** : c'est le défaut majeur que la revue de s31 a trouvé sur la
page du changelog, où le filtre de langue n'était protégé par rien parce que
l'attente était construite en appelant la fonction qu'elle jugeait.

**La lecture du dossier est éprouvée dans `tests/docs.test.ts`**, à la racine, et
c'est délibéré : elle ne veut rien dire sans un vrai système de fichiers, et le
même fichier confronte le **contenu réellement livré** au reste — au moins deux
sections, au moins une page non traduite (sans laquelle l'état de repli
n'existerait nulle part), les ancres du sommaire contre les `id` réellement
rendus.

**Les tests d'un module sont soumis aux règles de couches de ce module** :
l'exception de lint du harnais s'arrête aux packages de premier niveau
(`eslint.config.ts`, `testHarnessException`).
