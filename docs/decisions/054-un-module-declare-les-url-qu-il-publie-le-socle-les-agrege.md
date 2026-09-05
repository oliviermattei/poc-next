# ADR 054 — Un module déclare les URL qu'il publie ; le socle les agrège

- Status: accepted
- Date: 2026-09-05
- Scope: story s53-blog-syndication

## Context

s29 a livré le blog **activé et introuvable** : `apps/web/app/robots.ts`
interdisait `/blog` et `apps/web/app/sitemap.ts` l'ignorait, parce que ces deux
fichiers construisaient leur liste depuis `marketingSite.publicPaths` —
c'est-à-dire depuis **un module connu par son nom**. Un second import nommé y
appellerait un troisième en s30 (documentation) et un quatrième en s31
(changelog).

Deux moitiés, et elles n'ont pas le même coût :

1. **la page d'index d'un module de contenu** (`/blog`) est une page fixe : le
   module la connaît à l'import ;
2. **les URL d'articles** (`/blog/<slug>`) sont du **contenu découvert à la
   lecture** du disque. Aucune des quatorze clés du contrat ne peut les porter :
   `navigation` est une liste de déclarations statiques, et le catalogue
   n'existe qu'après que le point de composition de l'application a lu
   `content/blog`.

La recherche de la story proposait de dériver la liste des **entrées de
navigation publiques du registre** — `blog` en déclare une, le mécanisme
existait déjà. Cette piste a été **mesurée avant d'être écartée** : voir plus
bas.

## Decision

**Le contrat de module gagne une quinzième clé, `publicUrls`, obligatoire comme
les quatorze autres, et c'est une fonction.** Elle rend ce que le module donne à
indexer : un chemin interne, les langues où il est servi, et une date de
dernière modification facultative.

```ts
type PublicUrlContribution = (context: PublicUrlContext) => readonly PublicUrl[]
```

Trois conséquences, et chacune est une décision :

- **une fonction, pas un tableau.** Les URL d'articles n'existent qu'après
  lecture du contenu, et les deux fichiers de métadonnées portent
  `force-dynamic` pour une raison mesurée en s10 : évalués pendant `next build`,
  ils liraient une `APP_URL` que la CI ne pose pas. Une clé déclarative aurait
  figé le catalogue à la construction du registre ;
- **`marketing` y passe comme les autres.** Le laisser sur son chemin nommé
  aurait gardé `robots.ts` et `sitemap.ts` important `@repo/module-marketing` :
  le critère « le mécanisme est dérivé » aurait été tenu à moitié, à l'endroit
  exact où il compte. Ses `publicPaths` sont désormais sa contribution, et les
  fonctions de plan de site et de politique des robots — pures, sans rien de
  marketing — sont montées de `packages/modules/marketing/src/domain/seo.ts` à
  `packages/core/src/syndication.ts` ;
- **`public` n'est pas une décision d'indexation.** La dérivation ne lit **pas**
  les entrées de navigation publiques : elle ne lit que la clé.

Le contenu d'une contribution, lui, arrive par un **accès différé** posé par le
point de composition de l'application (`provideMarketingContent`,
`provideBlogContent`, appelés par `apps/web/lib/module-content.ts`). Un module
demandé sans avoir été fourni **lève en le nommant**, il ne rend pas une liste
vide : une contribution silencieusement à zéro est indiscernable d'un module
coupé.

## Considered options

- **Dériver des entrées de navigation publiques du registre** — rejetée, et
  c'est la mesure qui la tue. La configuration livrée compte **cinq** entrées
  publiques : `marketing /`, `auth /sign-in`, `blog /blog`, `billing /pricing`
  et `demo-enabled /api/modules/demo-enabled/items`. Les dériver aurait publié
  l'écran de connexion et une route d'API dans le `sitemap.xml`, et les aurait
  autorisées dans le `robots.txt` — la divulgation gratuite de surface que
  `docs/security.md` §7 refuse. `tests/marketing.test.ts` (balayage des écrans
  du disque) et `e2e/marketing.spec.ts` (`PRIVATE_PATHS`) interdisent déjà
  `/sign-in` **dans les deux configurations de modules** : la piste ne
  compilait pas avec le socle de sécurité. `public` dit *qui peut entrer*, pas
  *ce qui mérite un index*.
- **Une clé déclarative (`publicUrls: readonly PublicUrl[]`)** — rejetée : les
  URL d'articles n'existent pas à l'import du module, et une liste figée à la
  construction du registre le serait aussi pendant `next build`, où `APP_URL`
  n'est pas validée. C'est la contrainte que `force-dynamic` porte depuis s10.
- **Laisser `marketing` sur son chemin nommé et n'ajouter la clé que pour le
  blog** — rejetée : `robots.ts` et `sitemap.ts` auraient continué d'importer
  `@repo/module-marketing`, et la story n'aurait fait que déplacer le problème
  d'un module à l'autre.
- **Faire lire son propre contenu au module** (le blog ouvre `content/blog`
  lui-même, sans accès différé) — rejetée par symétrie : `marketing` ne le peut
  pas, ses chemins publics venant de `config/marketing.ts`, que le module n'a
  pas le droit de lire. Deux mécanismes de contribution pour une même clé
  auraient rendu la règle inapprenable.
- **Un fichier de métadonnées par module** (`app/blog/sitemap.ts`) — rejetée :
  Next sait le faire, mais c'est un fichier de route **par module**, donc une
  surface exposée par un module coupé, exactement ce qu'ADR 017 refuse pour les
  routes.

## Consequences

**Ce qui devient plus facile.** Un module de contenu ajouté demain (s30, s31)
entre dans le `sitemap.xml` et le `robots.txt` en déclarant sa clé : zéro ligne
dans les deux fichiers de métadonnées, et un `grep '@repo/module-'` sur eux
revient vide — c'est dans la Definition of Done de la story.

**Ce qui devient plus difficile.** Un module de contenu dont la contribution
dépend d'une donnée de l'application demande **une ligne** dans
`apps/web/lib/module-content.ts` — la seule énumération de modules de contenu du
dépôt, et elle est assumée : ni `marketing` ni `blog` ne peuvent se procurer ce
qu'ils publient. Ce n'est pas une condition : un module coupé n'est pas dans le
registre, sa contribution n'est jamais demandée, et l'y préparer ne change rien.

**Un changement de comportement à connaître.** `robotsPolicy` rend
`disallow: ['/']` **sans ligne `Sitemap:`** quand aucun chemin n'est public.
La liste ne venant plus d'un seul module, une installation « site public coupé,
blog activé » cesse d'être vide : le plan de site **réapparaît** dans le
`robots.txt` là où il était tu. Ce n'est pas un défaut — il référence de vrais
articles —, et les deux configurations sont écrites dans
`packages/core/src/syndication.test.ts` et `tests/syndication.test.ts`.

**Un piège fermé au passage.** `localeRouting.publicPath` préfixe **sans
condition**, `/api…` compris, alors que `apps/web/proxy.ts` ne préfixe jamais
ces chemins (constat M3 de la revue de s29). La règle est montée dans
`@repo/core` sous le nom `carriesLocalePrefix` : le proxy et la dérivation
partagent la même, et une contribution vers une route montée n'est jamais
annoncée sous `/fr/api/…`.

**Ce que cet ADR ne tranche pas, et qui reste ouvert pour s32.** La forme
**symétrique** — un chemin du socle qui doit consulter un module optionnel, par
exemple des notifications que l'application afficherait si le module existe. La
clé décrite ici va du module vers le socle ; l'inverse demande un autre
mécanisme, et il ne se déduit pas de celui-ci.

**À surveiller.** La clé est une fonction appelée à chaque requête sur
`/robots.txt` et `/sitemap.xml`. Le catalogue d'articles, lui, est lu **une
fois** au chargement du point de composition : la fonction ne relit pas le
disque. Un module qui y ferait une lecture coûteuse paierait ce coût par
requête, et c'est à lui de mémoïser — le socle ne peut pas le faire à sa place
sans figer ce que `force-dynamic` existe pour garder frais.
