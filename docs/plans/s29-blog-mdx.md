---
validated: yes
---
# Plan — Story s29-blog-mdx

Branch: `feature/s29-blog-mdx`
Research: `docs/research/s29-blog-mdx.md` — **à lire d'abord**. Design : `docs/designs/s29-blog-mdx.md` (+ `.html`, référence, jamais recopiée).
Story **découpée le 04/09** : la syndication (RSS, image OG par défaut, plan de site, quinzième clé du contrat) est partie en `s53-blog-syndication`. Ce plan ne la traite pas.

## Target story

Publier un article en MDX et le lire. Six critères : un fichier déposé apparaît après build sans autre geste · frontmatter typé, un frontmatter invalide fait échouer le build **en nommant le fichier fautif** · liste paginée et filtrable par tag · balises méta et Open Graph par article, depuis le frontmatter · i18n activée, un article sans traduction n'apparaît pas dans cette locale ; coupée, tout est servi dans la langue par défaut · **module non activé** : aucune route de blog, et le lien disparaît de la navigation publique.

## Tasks (ordered)

1. [x] **Choisir la brique MDX, et écrire l'ADR 053.** Critère **éliminatoire, non négociable** : la compilation se fait **au build**. `apps/web/lib/security-headers.ts` n'ajoute `'unsafe-eval'` qu'en développement — `script-src` vaut `'self'`, le nonce, `'strict-dynamic'` en production —, donc toute brique qui évalue du MDX à l'exécution est disqualifiée avant comparaison. Second critère : ce que s30 et s31 en réutiliseront. L'ADR nomme les options rejetées **et** la mesure qui les tue. **Vérification** : `pnpm build` passe, et un cas assère qu'aucune origine n'a été ajoutée à la politique de sécurité du contenu.
2. [x] **Cas rouge d'abord — le frontmatter invalide fait échouer le build en nommant le fichier.** Zod à la frontière, comme partout ailleurs dans ce dépôt. Le message porte le **chemin du fichier fautif**, pas seulement le champ. **Test qui peut échouer** : un article de fixture au frontmatter cassé.
3. [x] **Le dépôt d'un fichier suffit.** Un `.mdx` posé dans le dossier des articles apparaît dans la liste après build, sans inscription dans un index, sans autre geste. **Test qui peut échouer** : un article de fixture ajouté, la liste le rend.
4. [x] **Poser l'échelle de prose dans `docs/design-system.md`.** Le design signale le manque n°1 : huit rôles d'interface, aucun pour un corps d'article long. L'échelle est **dérivée des rôles existants** (`h1`/`h2`/`h3`, `body-lg`, `mono`, l'échelle d'espacement Tailwind, `--radius`), **jamais inventée** — titres internes, paragraphes, listes, citations, liens, images, blocs de code. Elle sert s29, s30 et s31 : la poser ici est un service rendu aux deux suivantes, pas un élargissement. **Vérification** : la maquette rendue dans les deux thèmes, et le tableau du système consigne ce qui a été ajouté.
5. [x] **La page d'article.** En-tête (titre, description, date, auteur, tags), corps rendu, retours vers la liste. Composants du design : `Avatar`, `Badge`, `Separator`, `Button`. **Aucun `dangerouslySetInnerHTML`** — le précédent de `legal-document.tsx` le refuse explicitement, et une brique compilée en composants React n'en a pas besoin. **Test qui peut échouer** : le rendu d'un article de fixture, plus un cas qui assère l'absence de `dangerouslySetInnerHTML` dans le module.
6. [~] **La liste, sa pagination et ses filtres — livrée SANS son état de chargement.** Tout est là *sauf* le `Skeleton` : cet écran ne peut pas porter de repli de chargement sans perdre son 404 quand le module est coupé. Écart déclaré et mesuré, voir la note d'exécution (F3) ; le manque est signalé dans `docs/design-system.md` § États. `PageHeader`, grille de `Card`, `Pagination`, `Badge` pour les tags, `EmptyState` pour « aucun article » et « aucun article dans ce tag », ~~`Skeleton` au chargement~~. Le tag actif se distingue **sans couleur sémantique** : `s49-contraste-des-alertes` a mesuré que les quatre variantes sont sous le seuil WCAG AA en clair. **Test qui peut échouer** : la pagination borne bien, le filtre par tag réduit la liste, l'état vide est atteint.
7. [x] **Les balises méta et Open Graph, depuis le frontmatter.** Titre, description, date, auteur, tags. L'image OG par défaut **n'est pas ici** — elle part avec s53. **Test qui peut échouer** : un cas qui lit les balises produites pour un article de fixture.
8. [x] **La bascule i18n, dans les deux sens.** Module `i18n` activé : un article sans traduction dans la locale courante **n'apparaît pas** dans cette locale — et la liste plus courte doit rester lisible comme telle, pas comme une panne (le design le dit dans ses états). Module coupé : tout est servi dans la langue par défaut. Attention au piège que `config/i18n.ts:5-7` documente — les locales **de l'application** ne sont pas celles que chaque module déclare, et le dépôt s'est déjà fait mordre par la confusion. **Test qui peut échouer** : les deux sens, plus un article sans traduction.
9. [x] **Le module coupé ne laisse aucune trace.** Aucune route (404), aucune entrée de navigation, par **dérivation** et non par condition — le motif est `EMPTY_MARKETING_SITE` (s10). **Test qui peut échouer** : `pnpm test:socle` et `pnpm test:minimal-profile` avec le module coupé.
10. [x] **Passage complet.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm test:socle`, `pnpm test:minimal-profile`, `pnpm run audit`. Comptes rapportés, intermittents connus nommés sans être corrigés.

## Run interdicts

- **Aucune évaluation de MDX à l'exécution**, et **aucune origine ajoutée** à `script-src`. Le diff ne doit toucher ni `apps/web/lib/security-headers.ts`, ni la politique de sécurité du contenu.
- **Aucun `dangerouslySetInnerHTML`**, nulle part.
- **Ne pas traiter la syndication.** Pas de flux RSS, pas d'image OG par défaut, **aucune modification de `apps/web/app/sitemap.ts` ni de `apps/web/app/robots.ts`**, aucune clé ajoutée au contrat de module. Tout cela appartient à s53, et l'y laisser est ce qui rend sa revue possible.
- **Ne rien inventer hors du design system.** Les composants sont ceux que `docs/designs/s29-blog-mdx.md` liste ; l'échelle de prose est **dérivée** des rôles existants. Un besoin non couvert se **signale**, il ne se comble pas.
- **Le tag actif ne se distingue pas par une couleur sémantique** tant que s49 n'a pas tranché.
- **Ne pas corriger les intermittents connus** (`tests/audit-exceptions.test.ts`, `e2e/rate-limiting.spec.ts:38`, `e2e/oauth.spec.ts:97`) : ils appartiennent à s52. Les nommer s'ils rougissent, ne pas se les attribuer.
- **Ne pas toucher `docs/killer-saas-feedback.md`** : il vit sur la branche par défaut.

## The point everything turns on

**La compilation au build n'est pas une préférence de performance, c'est le socle de sécurité.** La CSP de production n'accorde pas `'unsafe-eval'`, et le dépôt refuse `dangerouslySetInnerHTML` par un précédent écrit. Ces deux contraintes, prises ensemble, ne laissent qu'une famille de solutions : du MDX compilé en composants React à la construction. Tout le reste du plan en découle — la source de contenu, la validation du frontmatter, la façon dont l'i18n filtre.

Trois endroits où ça peut être faux :

1. **La brique choisie pourrait compiler au build *et* évaluer à l'exécution** pour certaines constructions (composants importés, expressions). À comparer : un `pnpm build` de production, puis une page d'article servie avec la CSP réelle, et la console du navigateur vide.
2. **Le filtre i18n pourrait porter sur les mauvaises locales.** À comparer : `config/i18n.ts:19` (`appLocales`) contre les locales que le contrat de module déclare — le commentaire du fichier dit que la confusion a déjà causé un défaut.
3. **L'échelle de prose pourrait déborder en refonte du design system.** À comparer : le tableau des rôles existants. Ce qui est ajouté doit se lire comme une **extension dérivée**, pas comme une seconde typographie.

## Files touched

Un nouveau module `packages/modules/blog/` avec ses quatre couches, le dossier des articles et ses fixtures, `config/features.ts` (l'annuaire, pas la configuration livrée), `docs/design-system.md` (l'échelle de prose), `docs/decisions/053-*.md`, les tests, plus la recherche, le design et le plan portés par le commit.

## Test strategy

Chaque invariant à sa couche. **Le frontmatter** : unitaire, sur le domaine, sans base. **La liste, la pagination, le filtre** : unitaire sur l'application, plus un parcours navigateur pour ce que l'utilisateur lit. **La bascule i18n** : unitaire dans les deux sens. **Le module coupé** : par les recettes qui existent (`test:socle`, `test:minimal-profile`), pas par un cas écrit à la main. **La prose** : vérification navigateur dans les deux thèmes — c'est de la présentation, un test de composant ne dirait rien de sa lisibilité.

## Definition of Done

- Les dix tâches cochées, chacune avec sa mutation posée **à l'endroit du défaut** et son compte de rouges.
- Le harnais complet vert, comptes rapportés, intermittents connus nommés.
- ADR 053 écrit, avec ses options rejetées et la mesure qui les tue.
- L'échelle de prose consignée dans `docs/design-system.md`, dérivée et non inventée.
- Vérification navigateur de la liste et de l'article, **dans les deux thèmes**, jusqu'à 380 px sans débordement horizontal.
- Un commit unique, message impératif en français, portant la recherche, le design et le plan.

## Note d'exécution — reprise après revue

Quatre constats fermés avant le ship, un cinquième et trois autres laissés tels
quels **volontairement**. La revue passe la porte (`Max severity: major`,
`Ship allowed: yes`) : ce qui suit est une reprise choisie, pas un déblocage.

### Fermés

- [x] **F1 (majeur) — une garantie « mesurée » et fausse, écrite à deux
  endroits.** L'ADR 053 et `apps/web/AGENTS.md` affirmaient que retirer
  `outputFileTracingIncludes` viderait la liste en production, et l'ADR nommait
  un cas de `tests/deployment.test.ts` pour en garder la trace. Les deux mesures
  de la revue ont été **refaites ici** : `grep -rn outputFileTracing tests/` ne
  rend rien (le cas n'a jamais existé), et un `pnpm build` complet **sans les
  deux lignes** dépose quand même les cinq `.mdx` dans
  `.next/standalone/content/blog/`. **Voie retenue : la formulation honnête.**
  La voie forte — écrire le cas qui rougit au retrait de la ligne — est
  impossible aujourd'hui : le retrait ne change rien, donc le seul cas
  écrivable serait un `grep` de `next.config.ts`, qui garderait l'orthographe de
  la ligne et pas la garantie, c'est-à-dire exactement l'illusion qu'on ferme.
  La rendre porteuse demanderait de resserrer le traçage de `lib/blog.ts:48`,
  ce qui est du ressort de F8 et pas de cette reprise. Les phrases disent
  désormais ce qui a été mesuré, y compris que **rien ne surveille cette ligne**.

  **Corrigé au tour suivant (R2-1) : ce compte disait « les deux phrases » et il
  y en avait trois.** La troisième vivait dans le code — le commentaire au-dessus
  de la déclaration, `apps/web/next.config.ts` —, c'est-à-dire à l'endroit qu'un
  agent lit en dernier et croit sur parole. Un nombre écrit au-dessus d'une liste
  plus longue, dans le correctif d'un constat qui portait exactement là-dessus.
  Les emplacements sont désormais **nommés plutôt que comptés**, et ils sont ceux
  que `grep -rn outputFileTracing` (dépôt entier, hors `node_modules`) rend :
  `docs/decisions/053-*.md`, `apps/web/AGENTS.md`, `apps/web/next.config.ts` —
  plus ce plan. C'est ce qui a été balayé, pas une prétention d'exhaustivité.
- [x] **F3 (mineur) — `Skeleton`, `BlogListSkeleton` et la clé `blog.list.loading`
  étaient du code mort.** Le câblage a été **tenté d'abord**, parce que la tâche
  6 du plan et `docs/designs/s29-blog-mdx.md` le demandent : deux `loading.tsx`,
  plus un squelette à la forme de l'article. Les deux replis ont été **vérifiés
  au navigateur** : 12 et 7 squelettes rendus, clair et sombre, 380 px, sans
  débordement horizontal.

  **Puis `pnpm test:e2e` a rougi, et le câblage a été retiré.** Un `loading.tsx`
  fait flusher la coquille de la page avant qu'elle n'ait décidé : le statut HTTP
  est écrit, et le `notFound()` arrive trop tard — `/blog/<slug inconnu>` répond
  **200** (`e2e/blog.spec.ts:132`). Le 404 est un critère de la story et une
  règle du socle de sécurité ; l'état de chargement est du confort. **Voie
  finalement retenue : la suppression** — `BlogListSkeleton`, le squelette
  d'article écrit pour l'occasion, la clé `blog.list.loading` et
  `packages/ui/src/components/skeleton.tsx`, qui n'avait plus d'appelant. Le
  manque est **signalé** dans `docs/design-system.md` (§ États) plutôt que
  comblé : c'est la règle du dépôt sur un besoin que le système ne couvre pas.

  **Écart au plan, déclaré** : la tâche 6 demandait « `Skeleton` au chargement ».
  Cet écran ne peut pas l'avoir sans renoncer à son 404. Le plan disait aussi
  qu'un besoin non couvert se signale — c'est ce qui a été fait. **La case de la
  tâche 6 le dit désormais à sa propre ligne** (`[~]`, constat R2-4) : la
  déclaration vivait ici, soixante lignes plus bas, alors que les cases sont le
  suivi vivant du plan.

  **Le mécanisme écrit ici était faux, corrigé au tour suivant (R2-2).** La
  phrase disait « la frontière d'un segment couvre ses enfants, aucun placement
  ne sauve les deux ». Réfuté en cinq minutes, `next dev`, 4 septembre 2026 : un
  **groupe de routes** `app/blog/(index)/` portant le repli ne couvre pas
  `[slug]` — le repli est bel et bien engagé sur la liste (il apparaît dans le
  corps servi) et `/blog/<slug inconnu>` **reste 404**. La vraie raison est celle
  que seul `docs/design-system.md` énonçait correctement : **la liste elle-même
  refuse** quand le module est coupé, et un repli au-dessus d'elle écrit le
  statut avant qu'elle n'ait décidé — mesuré, `/blog` sert alors **200** avec la
  coquille. Le tableau des trois placements est dans `apps/web/AGENTS.md`.

  **Et le trou était réel, pas seulement rédactionnel.** Avec le repli porté par
  un groupe de routes, les trois gardes existantes restaient vertes, mesuré une
  par une : `e2e/blog.spec.ts` (5 cas), `tests/blog.test.ts` (16 cas), et le
  balayage de `pnpm test:minimal-profile` — qui ne touchait aucune adresse de
  blog, le module déclarant `routes: []`, et dont la garde de navigation ne
  vérifie que le **rendu** de l'entrée. Un cas HTTP a donc été ajouté à
  `e2e/minimal-profile/minimal-profile.spec.ts` : **l'écran de chaque entrée de
  navigation d'un module coupé doit répondre 404 sur une vraie requête**, dérivé
  du contrat comme tout le reste de ce fichier, avec son contrôle positif.
  Mutation posée à l'endroit du défaut — groupe de routes + `loading.tsx` sur la
  liste — : **1 cas rouge sur les 5** de la recette, `blog index /blog` attendu
  404, reçu 200.
- [x] **F4 (mineur) — « Sept fichiers font exception » au-dessus de huit noms.**
  **Voie retenue : la dérivation.** Le nombre disparaît du texte, et
  `tests/agents-md.test.ts` dérive du disque la liste des fichiers de
  `apps/web/lib` qui importent un module : chacun doit être nommé dans
  `apps/web/AGENTS.md`. La dérivation a immédiatement trouvé un neuvième trou
  préexistant — `lib/rate-limit.ts` n'y était nommé nulle part —, désormais
  comblé.
- [x] **F7 (mineur) — un `page` malformé emportait le `tag` valide.**
  `?tag=produit&page=abc` servait la liste complète, filtre disparu sans un mot.
  Les deux paramètres sont désormais validés **séparément**.

### Laissés tels quels, et pourquoi

- **F2** — `blog` dans `enabledModules`, et `robots.txt` qui n'autorise pas
  `/blog` : traité au niveau du backlog. `s53-blog-syndication` porte maintenant
  un critère explicite « `robots.txt` autorise `/blog` », et c'est la story
  suivante.
- **F5** — le comparateur de départage des slugs gagnerait à descendre dans
  `domain/` pour devenir prouvable : bonne idée, pas cette story.
- **F6** — `Pagination` ne tronque pas au-delà d'environ 84 liens.
- **F8** — le quatrième avertissement de traçage de Turbopack.
