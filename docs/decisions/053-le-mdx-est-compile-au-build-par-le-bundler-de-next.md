# ADR 053 — Le MDX est compilé au build par le bundler de Next, jamais évalué à l'exécution

- Status: accepted
- Date: 2026-09-04
- Scope: story s29-blog-mdx

## Context

s29 introduit la première **source de contenu par fichier** du dépôt : tout ce
qui s'affichait jusqu'ici venait des catalogues de messages. s30 (documentation)
et s31 (changelog) rendront le même format : le choix engage trois stories.

Deux contraintes du dépôt, écrites avant cette story, réduisent l'espace des
solutions **avant** toute comparaison de confort ou de performance.

1. **La politique de sécurité du contenu n'accorde pas `'unsafe-eval'` en
   production.** `apps/web/lib/security-headers.ts` compose `script-src` avec
   `'self'`, le nonce de la requête et `'strict-dynamic'` ; `'unsafe-eval'` n'est
   ajouté que lorsque `mode === 'development'`, pour React. Ajouter une origine
   ou un mot-clé à cette directive demande une justification écrite
   (`docs/security.md` §1), et aucune fonctionnalité de blog n'en est une.
2. **`dangerouslySetInnerHTML` est refusé par un précédent écrit.**
   `packages/modules/marketing/src/presentation/legal-document.tsx:18-22` :
   « Un document qui aurait besoin de mise en forme riche est une décision de
   story, pas un contournement. » s29 est cette décision, et elle ne consiste
   pas à lever l'interdit : elle consiste à choisir la famille qui n'en a pas
   besoin.

## Decision

**Le MDX est compilé en composants React par le bundler de Next, à la
construction**, via `@next/mdx` + `@mdx-js/loader`, avec `remark-frontmatter`
pour que le bloc `---` ne soit pas rendu comme du texte.

Trois conséquences directes, et ce sont elles la décision :

- **Le corps d'un article est un module JavaScript du bundle serveur**, pas une
  chaîne. Aucun `dangerouslySetInnerHTML`, aucune évaluation à la requête.
- **Le frontmatter est lu séparément**, par le système de fichiers, validé par
  Zod, et une erreur **nomme le fichier fautif**. Il n'est pas lu depuis le
  module compilé : la liste doit exister sans charger le corps de chaque
  article.
- **Les corps sont atteints par un `import()` à segments variables**
  (`content/blog/${locale}/${slug}.mdx`). Mesuré sur ce dépôt, Turbopack en fait
  un **contexte** : après `pnpm build`, `fr/…mdx` **et** `en/…mdx` se retrouvent
  tous deux dans `.next/standalone/apps/web/.next/server/chunks/ssr/`, chacun
  dans son propre morceau. C'est ce qui fait tenir le critère « un fichier
  déposé apparaît après build sans autre geste » : aucun index à tenir.

## Considered options

- **`next-mdx-remote` (et tout `@mdx-js/mdx` `evaluate` / `run`)** — rejeté, et
  la mesure qui le tue est dans le paquet lui-même :
  `node_modules/.pnpm/@mdx-js+mdx@3.1.1/node_modules/@mdx-js/mdx/lib/run.js`
  lignes 7, 24 et 43 construisent le composant par `new AsyncFunction(String(code))`
  et `new Function(String(code))`. C'est une évaluation à l'exécution ; la
  déplacer côté serveur ne la fait pas disparaître, elle la déplace hors de la
  portée du navigateur — et le jour où le même pipeline sert un rendu client
  (s30 vise une palette de recherche), il demande `'unsafe-eval'`. Le dépôt
  refuse la brique, pas seulement son usage d'aujourd'hui.
- **`velite`** — rejeté pour la raison inverse et symétrique : sa sortie par
  défaut est du **HTML en chaîne**, qui n'est affichable que par
  `dangerouslySetInnerHTML` ; sa seconde sortie (`code`) est destinée à
  `useMDXComponent`, c'est-à-dire à `new Function`. Les deux voies tombent
  chacune sur l'un des deux interdits.
- **`contentlayer`** — rejeté : non maintenu (dernière publication 2023, dépôt
  archivé), et il génère un dossier d'artefacts à committer, donc un **index à
  tenir** — exactement ce que le critère 1 de la story interdit.
- **`fumadocs-mdx`** — rejeté : il compile bien au build, mais il apporte son
  propre routeur, sa propre recherche et son propre système de mise en page,
  c'est-à-dire une seconde interface par-dessus `packages/ui`. Le design system
  fait autorité (`AGENTS.md`) ; adopter une couche de présentation tierce le
  contredirait sur trois stories.
- **Un pipeline Markdown → HTML (`remark` + `rehype-stringify`)** — rejeté :
  il produit une chaîne de HTML, donc il exige `dangerouslySetInnerHTML`, donc
  il tombe sur le précédent de `legal-document.tsx`.
- **`@tailwindcss/typography` pour l'échelle de prose** — rejeté, et c'est la
  moitié « design » de la même décision : le greffon apporte **sa propre**
  échelle typographique, ses propres tailles et ses propres couleurs. Le dépôt a
  un design system qui fait autorité, et huit rôles typographiques déclarés ;
  une seconde typographie livrée par un paquet ne se compose pas avec eux, elle
  les remplace localement. Le corps d'article passe donc par une **table de
  composants MDX** (`components` de MDX) dont chaque entrée n'utilise que des
  rôles et des jetons existants.

## Consequences

**Plus facile.** s30 et s31 héritent du pipeline complet — loader, frontmatter
validé, table de composants de prose — et n'ont plus qu'à déclarer leur dossier
de contenu. Un article est un fichier ; il n'y a rien à enregistrer nulle part.

**Plus difficile.** Le corps d'un article n'existe qu'après un build : déposer
un `.mdx` dans un conteneur en marche ne le sert pas. C'est le sens littéral du
critère 1 (« apparaît **après build** »), et c'est aussi ce qui garantit
qu'aucune ligne de contenu n'est évaluée à la requête.

**À surveiller — et ce qui suit est mesuré, pas déduit.** Le contenu est lu par
le système de fichiers à l'amorçage du serveur, et `apps/web/next.config.ts`
déclare `outputFileTracingIncludes` pour `content/blog`. **Ce n'est pourtant pas
ce qui embarque les articles aujourd'hui** : les deux lignes retirées, un
`pnpm build` complet dépose quand même les cinq `.mdx` dans
`.next/standalone/content/blog/`. La raison est dans le build lui-même, qui
l'annonce — « Dynamic filesystem access causes tracing of the whole project » —
sur `resolve(process.cwd(), …)` (`apps/web/lib/blog.ts:48`) : le traçage prend
le projet entier, contenu compris. Trois autres appels du dépôt déclenchent le
même avertissement (`apps/web/lib/mailer.ts:107`, `apps/web/lib/storage.ts:106`,
`packages/storage-testing/src/local-disk-storage.ts:186`).

La déclaration est donc une **assurance dont l'effet est masqué** : elle ne
deviendra porteuse que le jour où ce traçage large sera resserré, et **rien ne
la surveille**. Aucun test ne le peut tant que la retirer ne change rien — un
cas qui rougirait sur son retrait ne mesurerait que l'orthographe de la ligne.
Le prix à payer est nommé ici plutôt que dissimulé : resserrer `lib/blog.ts:48`
sans poser au même moment une garde sur la sortie autonome livrerait une image
de production sans articles, et le démarrage échouerait en nommant le dossier.

**Une version antérieure de cet ADR affirmait l'inverse** — « retirer cette
ligne rend la liste vide en production », « `tests/deployment.test.ts` en garde
la trace » —, et ce test n'a jamais existé (`grep -rn outputFileTracing tests/`
ne rend rien). C'est exactement la faute que `AGENTS.md` interdit : une garantie
écrite comme mesurée, que le lecteur suivant croit vérifiée.

**Ce qui n'a pas été mesuré.** La comparaison ci-dessus tue chaque option
rejetée par une propriété **vérifiable dans son code ou sa documentation**
(évaluation à l'exécution, sortie en chaîne HTML, artefact à committer, seconde
couche de présentation). Aucune n'a été installée et exécutée dans ce dépôt : la
seule brique dont le comportement a été mesuré ici est celle qui est retenue.
