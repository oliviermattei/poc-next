---
validated: yes
---
# Plan — Story s30-docs-site

Branch: `feature/s30-docs-site`
Research: `docs/research/s30-docs-site.md` (**sur `dev`**) · Design : `docs/designs/s30-docs-site.md` (+ `.html`, référence, jamais recopiée).
Story découpée le 05/09 **avant ce plan** : la recherche plein texte et la validation des liens au build sont parties en `s54-docs-recherche`.

## Target story

Cinq critères : pages MDX **organisées en sections avec une navigation latérale générée depuis l'arborescence** · sommaire des titres et **ancre par section** · traduisible, une page non traduite **retombant sur la locale par défaut avec une mention explicite** · pages référencées dans `sitemap.xml` · **module non activé** : aucune route, le lien disparaît de la navigation publique.

## La décision que ce plan prend, et qu'il assume

Le design signale un manque qui n'en est pas un de jetons : **l'échelle de prose vit dans `@repo/module-blog/presentation`**, et deux modules en ont désormais besoin. L'importer d'ici exigerait `requires: ['blog']` sur la documentation (ADR 018) — un produit où couper le blog casserait la documentation.

**Ce plan tranche : l'échelle de prose monte dans `packages/ui`.** C'est là que le design system vit en code, et `PROSE_CLASSNAME` / `proseComponents` sont une **traduction de `docs/design-system.md`**, pas un objet du blog. Le blog l'importera de `@repo/ui` comme tout le monde. C'est un déplacement de code livré par s29 : il doit être déclaré comme tel, et prouvé sans régression sur les parcours du blog.

## Tasks (ordered)

1. [x] **ADR 055, puis le déplacement.** L'échelle de prose monte dans `packages/ui`, le blog l'importe de là. L'ADR nomme les options rejetées **avec la mesure qui les tue** : `requires: ['blog']` sur la documentation (un produit incohérent), la duplication (deux typographies, ce que le design system refuse), un troisième paquet partagé (une couche pour deux consommateurs). **Test qui peut échouer** : les parcours du blog restent verts sans réécriture de leurs assertions, et `pnpm lint` tient les frontières de couches.
2. [x] **Cas rouge d'abord — l'arborescence devient des sections.** Le dossier des pages, par locale, produit sections et pages ordonnées. Frontmatter validé par Zod sur le motif de s29 : un frontmatter invalide **fait échouer le build en nommant le fichier fautif**. **Test qui peut échouer** : une fixture au frontmatter cassé, et une arborescence à deux sections.
3. [x] **La navigation latérale, dérivée.** Sections repliables, page courante marquée par `aria-current` — **pas par une couleur sémantique** (s49 a mesuré les quatre variantes d'`Alert` sous le seuil AA en clair). Sous `lg`, elle entre dans un `Sheet`. **Test qui peut échouer** : l'ordre des sections, la page courante, et un parcours navigateur pour l'ouverture en petit écran.
4. [x] **Le fil d'Ariane.** `Breadcrumb` est **déclaré par `docs/design-system.md` et absent de `packages/ui`** : le copier depuis shadcn/ui, comme s29 l'a fait pour `Pagination`. **Copier n'est pas inventer** — et ne pas copier ce dont on n'a pas besoin : ni `ScrollArea`, ni `Command`, qui appartient à s54.
5. [x] **Le sommaire et ses ancres.** Les titres de la page, une ancre par section, la position courante marquée par `aria-current`. Le design signale qu'**aucun composant du système ne couvre ça** : composer avec une liste, et le signaler plutôt que l'inventer. **Test qui peut échouer** : les ancres produites pour une page de fixture correspondent à ses titres.
6. [x] **Le repli i18n, avec sa mention.** Page absente dans la locale servie → la page de la locale par défaut est rendue, **précédée d'une mention explicite**. C'est **l'inverse du blog**, où un article sans traduction disparaît : ne pas copier le mécanisme de s29 sans le retourner. Attention au piège que `config/i18n.ts:5-7` documente — les locales **de l'application** ne sont pas celles que le module déclare. **Test qui peut échouer** : les trois cas — traduite, non traduite avec mention, module `i18n` coupé.
7. [x] **Les pages dans `sitemap.xml`.** Déclarer `publicUrls` (quinzième clé, ADR 054, livrée par s53) et rien d'autre : ni `sitemap.ts` ni `robots.ts` ne doivent être touchés. **Test qui peut échouer** : les pages apparaissent, module coupé il n'y en a aucune.
8. [x] **Le module coupé ne laisse aucune trace**, par dérivation et non par condition — motif `EMPTY_BLOG_CATALOG` / `EMPTY_MARKETING_SITE`. **Test qui peut échouer** : `pnpm test:socle` et `pnpm test:minimal-profile`, dont la garde HTTP de s29 qui exige 404 sur l'adresse de navigation d'un module coupé.
9. [x] **Vérification navigateur.** Les trois largeurs du design, les deux thèmes, et **l'état « page non traduite »** — c'est le seul écran de cette story qu'aucun test unitaire ne décrit. Pas de débordement horizontal à 380 px.
10. [x] **Passage complet.** `typecheck`, `lint`, `test`, `build`, `test:e2e`, `test:socle`, `test:minimal-profile`, `run audit`. Comptes rapportés, intermittents connus nommés sans être corrigés.

## Run interdicts

- **Aucun `loading.tsx`, nulle part.** Mesuré en s29 sur trois placements : la coquille est vidée avant que la page ne décide, et un `notFound()` arrive en **HTTP 200**. Le 404 est une règle du socle de sécurité. Le design l'écrit comme une décision, pas comme un oubli.
- **Ne pas traiter la recherche ni la validation des liens** : elles appartiennent à `s54-docs-recherche`, et les y laisser est ce qui rend sa revue possible.
- **Ne toucher ni `apps/web/app/sitemap.ts` ni `apps/web/app/robots.ts`.** s53 a fait en sorte qu'ils ne connaissent aucun module ; déclarer `publicUrls` suffit.
- **Ne rien inventer hors du design system.** `Breadcrumb` se **copie** ; le sommaire se **compose** ; ce qui manque se **signale**.
- **Ne pas copier `ScrollArea` ni `Command`** : `packages/ui/AGENTS.md` refuse de livrer du code que personne n'exerce.
- **Ne pas corriger les cinq intermittents connus** (`tests/audit-exceptions.test.ts`, `e2e/rate-limiting.spec.ts:38`, la paire `e2e/oauth.spec.ts:30`/`:97`, `e2e/blog.spec.ts:134`, `e2e/two-factor.spec.ts:162`). Ils appartiennent à s52 ; les nommer s'ils rougissent, ne pas se les attribuer.
- **Ne pas toucher `docs/killer-saas-feedback.md` ni `docs/research/`** : ils vivent sur la branche par défaut.

## The point everything turns on

**L'échelle de prose n'appartient pas au blog, et le prouver demande de la déplacer.** Tant qu'elle vit dans un module optionnel, tout second consommateur doit soit en dépendre, soit la dupliquer — et les deux sont mauvais. La monter dans `packages/ui` la remet là où le design system vit déjà en code.

Trois endroits où ça peut être faux :

1. **Le déplacement pourrait casser le blog en silence.** À comparer : les parcours de s29 doivent rester verts **sans réécriture de leurs assertions**. Une assertion retouchée pour accommoder le déplacement est un signal, pas une adaptation.
2. **Le repli i18n pourrait être écrit comme celui du blog.** À comparer : le blog **retire** un article non traduit, la documentation **la sert avec une mention**. Un cas doit exiger la mention, pas seulement la page.
3. **La navigation dérivée pourrait ne rien dériver.** À comparer : une arborescence à deux sections doit produire deux sections, et une fixture ajoutée doit apparaître sans inscription ailleurs — c'est le critère 1 de s29, appliqué à un arbre.

## Files touched

Un module `packages/modules/docs/` avec ses quatre couches · le dossier des pages et ses fixtures · `packages/ui` (l'échelle de prose montée, `Breadcrumb` copié) · `packages/modules/blog` (son import change) · `config/features.ts` (l'annuaire) · `docs/decisions/055-*.md` · `docs/design-system.md` si l'échelle y gagne sa nouvelle adresse · les tests, plus le design et le plan portés par le commit.

## Test strategy

**L'arborescence et le frontmatter** : unitaire, sur le domaine, sans base. **La navigation et le sommaire** : unitaire sur l'application, plus un parcours navigateur pour ce que l'utilisateur voit. **Le repli i18n** : unitaire dans les trois cas. **Le module coupé** : par les recettes existantes, pas par un cas écrit à la main. **La présentation** : au navigateur, dans les deux thèmes — un test de composant ne dit rien de la lisibilité d'une mise en page à trois colonnes.

## Definition of Done

- Les dix tâches cochées, chacune avec sa mutation posée **à l'endroit du défaut** et son compte de rouges.
- Les parcours du blog verts **sans réécriture d'assertion** après le déplacement de l'échelle de prose.
- Le harnais complet vert, comptes rapportés, intermittents connus nommés.
- ADR 055 écrit, avec ses options rejetées et la mesure qui les tue.
- Vérification navigateur des trois largeurs, des deux thèmes et de l'état « page non traduite ».
- Un commit unique, message impératif en français, portant le design et le plan.

## Note d'exécution — reprise après revue (`docs/reviews/s30-docs-site.md`)

La revue passe la porte (`Max severity: major`, `Ship allowed: yes`). Quatre points fermés, trois délibérément laissés.

### Fermés

11. [x] **F1 — l'ordre des sections n'avait pas de filet** (majeur). La fixture de `docs-catalog.test.ts` rangeait `prise-en-main` (rang 1) avant `reference` (rang 2) : un ordre que le rang **et** l'alphabet produisent tous les deux. Remplacer le tri des sections par un `localeCompare` sur le slug laissait les 14 cas verts — le piège exact déjà évité côté pages, où la fixture de `firstDocsPage` (`traduite` rang 1, `seule` rang 2) contredit l'alphabet. La section porte désormais `api` au rang 2 : le rang le met second, l'alphabet le mettrait premier. **Mutation** : `.sort((a, b) => a.section.localeCompare(b.section))` dans `docsNavigationTree` — 0 rouge avant, **1 rouge** après.
12. [x] **F2 — le couple `#` / `##` produisait deux ancres identiques** (mineur, mais il rendait fausse une phrase absolue). `documentHeadings` ignore le niveau 1 ; `createProseComponents` posait un `id` sur `h1` **aussi**. Un corps portant `# Options` puis `## Options` livrait deux fois `id="options"`, et le lien du sommaire tombait sur le premier — celui qu'il ne nomme pas. `parseDocsPage` ne voyait rien : son refus compte les ancres du sommaire. **Tranché : `h1` ne porte plus d'ancre**, plutôt que d'étendre le refus au niveau 1. Le sommaire ne dérive que de `##` et `###` ; une ancre sur un niveau dont aucune entrée ne parle ne peut que doubler une autre, et l'étendre au refus ferait échouer un `pnpm build` sur une divergence qui peut simplement ne pas exister. Les deux passes portent désormais sur le même ensemble de niveaux, ce qui est la condition que la phrase de `packages/modules/docs/AGENTS.md` supposait sans le dire. **Mutation** : `{...anchored(props)}` rétabli sur `h1` dans `packages/ui/src/composed/prose.tsx` — **1 rouge** (`tests/docs.test.ts`, « ne pose d'ancre que sur les niveaux dont le sommaire dérive »).
13. [x] **F5 — deux nombres écrits que rien ne dérive.** `packages/modules/docs/AGENTS.md` annonçait « les **quatre** refus » puis « **deux** refus de forme s'y ajoutent », en ayant nommé un septième quatre paragraphes plus haut (le dossier de langue que personne ne servira jamais) ; les `throw` réels sont treize, groupés par cause. Les nombres sont retirés : la liste est le compte, elle est groupée par cause, elle nomme les sept, et elle dit qu'aucune commande ne la dérive. Correction de documentation — **aucune mutation ne s'y applique** : rien dans le code ne change, et un nombre en prose n'a pas de site de défaut.
14. [x] **F4 — la mesure à trois colonnes n'était écrite nulle part.** Re-mesurée sous serveur réel (Chromium, `prise-en-main/installer`, `boundingBox()` de l'`<article>`) : **358 px à 390, 464 px à 768, 448 px à 1440** — la coquille vaut 896 px à 1440, dont la grille prend 13 rem + 11 rem + deux gouttières de 2 rem. Écrite dans le **manque n°4 du design**, qui avait prédit l'absence de gabarit, et résumée au-dessus de `PROSE_CLASSNAME`, dont la borne de 672 px n'est **jamais** atteinte sur une page de documentation. Élargir la coquille reste hors périmètre. **Aucune mutation** : c'est une observation reportée, pas une règle ajoutée.

### Laissés, et pourquoi

- **F3 — la réservation du slug `docs`** ne mord que sous `pnpm test:minimal-profile`. C'est la **troisième** occurrence du même mécanisme après `billing` et `blog`, et rien ne dérive aujourd'hui la règle « un écran sous `apps/web/app/<seg>/` doit être réservé indépendamment de l'état de son module ». Le greffer ici serait une règle écrite dans une story qui ne la vérifie pas : c'est une story, pas un correctif.
- **F6 — la liste des cinq intermittents connus est incomplète.** `e2e/rate-limiting.spec.ts:163` et `:205` rougissent eux aussi sous quatre workers et passent seuls. Ils appartiennent à s52 comme les cinq autres ; la revue les y consigne. Ne pas se les attribuer.
- **F7 — deux remarques de procédure** : ce plan ne nomme aucune section de `docs/security.md`, et le test de `readDocsDirectory` vit à la racine plutôt qu'à côté de sa couche (choix assumé et écrit dans `packages/modules/docs/AGENTS.md` § Tests — il ne veut rien dire sans un vrai système de fichiers). Rien à changer dans le code de la story.
