# ADR 054 — Un module déclare les URL qu'il publie ; le socle les agrège

- Status: accepted
- Date: 2026-09-05

`apps/web/app/robots.ts` et `sitemap.ts` construisaient leur liste depuis le module `marketing`, importé par son nom : chaque module de contenu (blog, documentation, nouveautés) aurait ajouté un import nommé. **Le contrat de module porte une clé obligatoire `publicUrls`, et c'est une fonction** (`(context: PublicUrlContext) => readonly PublicUrl[]`) : elle rend ce que le module donne à indexer — chemin interne, langues servies, date de modification facultative. `apps/web/lib/public-urls.ts` agrège les contributions des modules activés ; les fonctions de plan de site et de politique des robots, pures, vivent dans `packages/core/src/syndication.ts`, et un `grep '@repo/module-'` sur les deux fichiers de métadonnées revient vide.

Une fonction et non un tableau, parce que les URL d'articles n'existent qu'après lecture du disque, et que `robots.ts` et `sitemap.ts` sont `force-dynamic` : évalués pendant `next build`, ils liraient une `APP_URL` que la CI ne pose pas. `marketing` contribue comme les autres. Le contenu d'une contribution arrive par un accès différé posé au point de composition (`provideMarketingContent`, `provideBlogContent`, appelés par `apps/web/lib/module-content.ts`) ; un module demandé sans avoir été fourni lève en se nommant, car une contribution silencieusement vide est indiscernable d'un module coupé.

## Considered options

- **Dériver l'index des entrées de navigation publiques** — rejeté : `public` dit qui peut entrer, pas ce qui mérite un index. La dérivation aurait publié des routes d'API et des écrans de connexion dans `sitemap.xml`, une divulgation gratuite de surface (`docs/security.md`).
- **Faire lire son contenu au module lui-même** — rejeté : `marketing` ne le peut pas (ses chemins viennent de `config/marketing.ts`, qu'un module ne lit pas), et deux mécanismes de contribution pour une même clé rendraient la règle inapprenable.
- **Un fichier de métadonnées par module** (`app/blog/sitemap.ts`) — rejeté : un fichier de route par module expose une surface quand le module est coupé (ADR 085).

## Consequences

- `apps/web/lib/module-content.ts` est la seule énumération de modules de contenu du dépôt : un module coupé n'est pas dans le registre, sa contribution n'est jamais demandée.
- `robotsPolicy` rend `disallow: ['/']` sans ligne `Sitemap:` quand rien n'est public ; une installation « site public coupé, blog activé » réaffiche donc la ligne `Sitemap:`.
- `carriesLocalePrefix` (`@repo/core`) est partagé par `apps/web/proxy.ts` et la dérivation : une contribution vers une route montée n'est jamais annoncée sous `/fr/api/…`.
- La fonction est appelée à chaque requête sur `/robots.txt` et `/sitemap.xml` : un module qui y ferait une lecture coûteuse doit mémoïser lui-même.
- La forme symétrique — un chemin du socle qui consulte un module optionnel — est tranchée par l'ADR 057.
- `/pricing` n'est pas encore contribué (issue #104).
