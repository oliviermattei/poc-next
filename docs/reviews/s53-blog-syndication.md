# Review — Story s53-blog-syndication

> Deux tours, en contexte frais. Seul le dernier porte des lignes de porte ; le verdict du
> premier est marqué dépassé, pour que le grep de `/ks-ship` n'ait qu'une réponse.

---

# Premier tour — la story complète (HEAD `0777541`)

> Diff jugé : `git diff dev...feature/s53-blog-syndication`, 69 fichiers. Toutes les commandes rejouées par le relecteur.

## Harnais

`test` **2062 passés / 8 sautés / 0 échec** · `typecheck --force` **26/26, `Cached: 0`** · `lint` propre · `build` OK, `/robots.txt` et `/sitemap.xml` tous deux `ƒ (Dynamic)` · `test:e2e` **99 passés** au second passage (le premier a joué un intermittent connu) · `test:socle` **85 / 22**, arbre propre · `test:minimal-profile` vert, **15 routes** balayées — la route de flux est entrée dans le balayage, le blog n'en déclarait aucune · `audit` propre.

## La déviation centrale : la navigation n'est pas une source

Le plan demandait de dériver la liste d'autorisation des **entrées de navigation publiques du registre**. L'implémenteur a mesuré le registre livré au lieu d'appliquer : **cinq** entrées publiques — `marketing /`, `auth /sign-in`, `blog /blog`, `billing /pricing`, `demo-enabled /api/modules/demo-enabled/items`. Dériver de là aurait publié l'écran de connexion, la page de tarifs et une **route d'API** dans `robots.txt` et `sitemap.xml`.

Vérifié par la revue : les cinq entrées portent bien `{level:'public'}` ; `e2e/marketing.spec.ts` porte `PRIVATE_PATHS` hors de toute condition de configuration ; `tests/marketing.test.ts` confronte la politique à **chaque écran du disque**, avec garde d'inertie. La piste du plan ne compilait pas avec le socle.

**Seule la quinzième clé alimente donc la dérivation**, et la décision est gardée : mutation rebranchant la navigation → **8 rouges**, répartis des deux côtés de la composition.

## Constats du premier tour

- **M1 — major — « valide au sens d'un validateur » est tenu par un analyseur complaisant.** `@rowanmanning/feed-parser`, mesuré sur six documents : il lève sur du html, du texte brut et un `<rss>` sans `<channel>`, mais **accepte** un `<channel>` sans titre ni lien ni description, deux `<item></item>` vides, et un flux Atom entièrement vide. Il prouve « analysable », pas « valide ». Et le document servi porte un défaut nommable : `<item><author>Olivier Mattei</author>`, là où RSS 2.0 définit `<author>` comme une **adresse email** — le validateur du W3C y émet `InvalidContact`.
- **M2 — major — deux docblocs de `@repo/core` enseignent encore la règle réfutée.** `module.ts` (`PublicUrl`) et `syndication.ts` (`IndexableUrl`) disaient l'index construit « des contributions **et des entrées de navigation publiques** ». `module.ts` est le premier fichier qu'on ouvre pour écrire un module : agir dessus publie `/sign-in` dans `sitemap.xml`.
- **m3** — l'en-tête du module `blog` décrivait le module d'avant s53 (« ni route d'API », et les trois livrables listés comme « pas encore »).
- **m4** — un pointeur mort : `domain/feed.ts` renvoyait à `tests/syndication.test.ts` pour un cas qui vit dans `tests/blog.test.ts`.
- **m5** — **six citations de `docs/security.md` §7** appuyaient la décision centrale, dont une dans un **ADR immuable** — et §7 (« Journalisation, détection et abus ») ne contenait pas la règle citée.
- **m6** — un quatrième intermittent, `e2e/blog.spec.ts:134` (`ECONNRESET`), à rattacher à s52.
- **m7** — aucune commande ne demande `/og-default.png` en HTTP.
- **m8** — quatre dimensions inventées au-dessus des huit rôles typographiques, non nommées dans la note de manque ; `page_document` en `snake_case`.
- **m9** — `apps/web/proxy.ts` modifié sans figurer dans les *Files touched* ; la dérivation de `e2e/marketing.spec.ts` rougirait pour une mauvaise raison le jour où un article n'existe qu'en anglais.

## Ce que le premier tour n'a pas vérifié

Le validateur du W3C (pas de réseau) · l'image de production · le rendu d'aperçu chez un réseau social · un vrai agrégateur · un article `en`-only · `pnpm test:golden-path`.

> Verdict du premier tour — **dépassé par le tour suivant** :
> Max severity: major · Ship allowed: yes

---

# Second tour — délta ciblé (`0777541..29ee108`)

> 11 fichiers, +288/−27. **Non réexaminé** : tout le premier tour — la clé `publicUrls`, ADR 054, la montée dans `@repo/core`, `lib/public-urls.ts`, `metadataBase`, le `Dockerfile`, `carriesLocalePrefix`. Ses deux preuves nommées ont en revanche été **rejouées**.

## Harnais, réexécuté

`typecheck` 26/26 · `lint` exit 0 · `test` **2064 passés / 8 sautés** · `build` exit 0 · `test:e2e` **99 passés / 8 sautés au premier passage**, aucun intermittent joué · `test:socle` exit 0 · `test:minimal-profile` exit 0, **15 routes et 5 entrées** balayées · `audit` propre.

**Aucun test supprimé** : le seul fichier retiré du diff complet est `packages/modules/marketing/src/domain/seo.ts`, déplacé dans `@repo/core` et jamais couvert par un `.test.ts` propre. Le délta ajoute 1 cas, n'en retire aucun.

## Preuves du premier tour, rejouées

Mutation « rebrancher la navigation publique » posée au site du défaut → **8 rouges**, exactement la répartition annoncée : 3 dans `packages/core/src/syndication.test.ts`, 4 dans `tests/syndication.test.ts`, 1 dans `tests/marketing.test.ts`. Sous `pnpm test:e2e` avec la même mutation, `e2e/marketing.spec.ts` rougit **2 fois**, dont `PRIVATE_PATHS` sur `/sign-in` — **sur le fichier réellement servi**. `grep '@repo/module-'` sur les deux fichiers de métadonnées : toujours vide.

## Le contrôle ajouté à `docs/security.md` — muté ligne par ligne

Le contrôle « Aucun écran applicatif dans un index public » est bien dans §7. Ses **trois lignes ont été mutées une par une**, chacune à l'endroit qu'elle nomme :

| Ligne | Mutation | Rouges |
|---|---|---|
| balayage des écrans du disque | `exactly()` cesse d'ancrer le motif — le défaut historique « `Allow: /fr` ouvre toute l'application » | **1** dans le fichier nommé (7 au total) |
| `indexableUrls` ne lit que `publicUrls` | rebranchement de la navigation | **7**, exactement les « 7 cas » écrits |
| `PRIVATE_PATHS` hors du fichier servi | même rebranchement | **2**, dont `/sign-in` |

Le balayage de la première ligne est **dérivé du disque** et porte sa garde d'inertie. **Les trois lignes mordent** : le contrôle n'est pas décoratif. Les huit citations de §7 sur cette règle sont désormais exactes.

## Le flux servi, récupéré en HTTP

200, `application/rss+xml; charset=utf-8`. `xmlns:dc` déclaré sur `<rss>` à côté de `xmlns:atom` · `<dc:creator>` sur les trois articles · **aucun `<author>`** · le document parse · non-régression vérifiée : `title`/`link`/`description` de canal, `language`, `atom:link rel="self"`, `guid isPermaLink="true"`, les cinq entités échappées, et les trois `pubDate` RFC 822 dont **les jours de semaine ont été vérifiés au calendrier**.

**Le raisonnement qui écarte `<author>adresse (Nom)</author>` tient** : le frontmatter ne porte qu'un nom d'affichage, et fabriquer une adresse publierait une boîte aux lettres dans un document moissonné.

**Le changement est gardé, pas espéré** : mutation de retour à `<author>` → 1 rouge en nœud **et** 1 rouge Playwright, et l'e2e assertionne sur `await response.text()`, ancré positivement — pas un `not.toContain` isolé qui passerait sur un corps vide.

## Vérifications rapides

La formulation de l'analyseur est corrigée aux quatre sites, et le nouveau cas **fixe les deux bords de l'outil** — il lève sur trois non-flux, accepte un `<channel>` vide. La phrase ne peut plus se regonfler sans faire rougir. **Le critère 2 reste littéralement non tenu** — le dépôt n'embarque aucun validateur — et la note d'exécution le dit sans arrondi : c'était le livrable de ce tour.

Le balayage M2 rejoué sur huit motifs confirme **quatre sites**, dont deux faux, désormais corrigés. m3, m4, m8 fermés ; **PNG identique octet pour octet** vérifié par `shasum` avant/après. Message de commit corrigé.

Les trois constats laissés ouverts (m6, m7, la dérivation de `e2e/marketing.spec.ts`) sont **écrits** dans la note d'exécution et aucun n'a été silencieusement corrigé.

## Constats de ce tour — quatre mineurs, tous documentaires

- **m10 — le correctif d'un problème de citation a écrit un compte, et il est faux.** « **Six** citations la désignaient sans qu'elle soit écrite » figure dans `docs/security.md` §7, dans le message de commit et dans la note du plan. Balayé : la règle est citée **sept** fois sur **six fichiers**, huit avec le délta. Lu comme « six *sites* » le nombre est juste ; écrit comme « six *citations* » il est faux dès l'écriture. Aucune commande ne le tient, et c'est **dans un document de socle**. C'est la règle « dériver les comptes » violée à l'intérieur du correctif d'un problème de citation.
- **m11 — un renvoi inexact dans le plan** : la tâche 4 est dite démentie « douze lignes plus bas », elle l'est soixante lignes plus bas, et elle ne porte aucun marqueur inline alors que c'est sa formulation que la story a renversée.
- **m12 — une attribution de rouges trop large** : la note dit `tests/syndication.test.ts` rougir de 8 cas ; il en rend 4, les 4 autres venant de deux autres fichiers. Le total est juste, l'attribution non. La ligne de `docs/security.md`, elle, est exacte.
- **m13 — placement** : le contrôle vit sous un titre (« Journalisation, détection et abus ») qui ne l'annonce pas, et la liste « Security baseline » de l'`AGENTS.md` racine n'a pas gagné de ligne. Le choix est défendable — il rend exactes des citations existantes dont une dans un ADR immuable — mais le coût mérite d'être noté.

## Ce que ce tour n'a pas vérifié

Le flux contre un **vrai validateur** (lecture de spécification, pas exécution) — le critère 2 reste non prouvé par une commande · un vrai agrégateur · le flux sous le build de production · les variantes `?locale=` en HTTP · l'image OG telle qu'un réseau social la rend, **m7 restant ouvert** · les intermittents, non reproduits — un passage vert ne prouve pas qu'ils ont disparu · l'après-fusion : `robots.txt` autorisant `/blog` et `sitemap.xml` portant les articles **sur `dev`** ne se constate qu'après le merge.

## Verdict

Le délta fait ce qu'il annonce et il est gardé partout où il compte : le contrôle ajouté au socle mord par les trois commandes qu'il nomme, `dc:creator` rougit en nœud et sur le corps servi, le PNG est identique après renommage, et les trois constats laissés ouverts le sont explicitement plutôt qu'en silence. Les quatre mineurs sont des chiffres et des renvois écrits à la main — dont un dans un document de socle, ce qui justifie de le nommer.

Ce tour ne **baisse pas** le major du premier : le critère 2 n'est pas tenu. Il est désormais **déclaré** au lieu d'être maquillé, ce qui était le livrable demandé.

Max severity: minor
Ship allowed: yes
