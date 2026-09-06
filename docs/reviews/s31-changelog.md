# Review — s31-changelog

> Contexte neuf. Diff jugé : `git diff dev...feature/s31-changelog` (66 fichiers), commit `ea99c90`.

## Ce que la revue a joué elle-même

| Commande | Résultat |
|---|---|
| `pnpm test` | **2610 verts, 11 sautés (2621)** — conforme au compte annoncé |
| `pnpm typecheck` | 33/33 |
| `pnpm lint` | aucun problème |
| `pnpm test:minimal-profile` | **vert**, 6/6 parcours navigateur, dont le nouveau cas du pied de page |
| `pnpm build` | vert ; `/changelog` dans la table des routes (`ƒ /changelog`) |
| requête sur serveur réel | `/fr/changelog` → 200 `text/html` ; `/api/modules/changelog/feed.xml` → 200 `application/rss+xml` |

Fausse piste écartée : le **premier** `test:minimal-profile` a échoué sur `tests/rgpd-screens.test.ts` (délai de 5000 ms) parce qu'un `pnpm test` complet tournait contre le même PostgreSQL. Rejeu propre vert. Pas un défaut de la branche.

## Conformité au plan

Les neuf tâches sont présentes, rien d'inutile dans le diff. **L'argument de sûreté de la tâche 2 tient** : `git diff dev...HEAD -- tests/blog.test.ts` est **vide**, et la revue a comparé l'ancien corps de `renderBlogFeed` à `renderFeed` — construction des items et du canal, `escapeXml` (cinq entités) et `rfc822` sont caractère pour caractère identiques ; le seul écart de comportement est le `dc:creator` désormais optionnel, mesuré dans `packages/core/src/syndication.test.ts`. Les 15 clés du contrat sont remplies. Les sept fichiers de `apps/web/app` qui nommaient `consentFooterLinks` ne nomment plus rien ; `consentFooterLinks` et `ConsentFooterLink` ont disparu de `apps/web/lib/consent.ts`.

## Anti-hallucination

Chaque import du diff ouvert et vérifié : `scaffoldFiles` (`packages/cli/src/scaffold-files.ts:35`), `PublicUrlContribution` / `PublicUrl.lastModified` (`packages/core/src/module.ts:260-289`), `MarketingFooterLink`, `Badge variant="outline"`, `EmptyState`, `PageHeader`, `qualifyMessageKey`, `MODULE_ROUTE_PREFIX`, `navigationSurfaceOf`. Aucune référence inventée. Le câblage est réel : `prepareChangelogContent` est atteint à la fois par `publicUrls()` et par `prepareModuleServices()`, donc le flux ne peut pas répondre 500 faute de contenu.

**ADR 065 est libre** : `dev` s'arrête à 064, aucune branche locale ou distante ne porte de 065. La discipline sur « valide » tient — les seules occurrences du mot dans le code neuf, l'ADR et les tests sont les refus explicites (« analysable, jamais valide au sens d'un validateur »).

## Mutations (toutes restaurées, `git diff --exit-code` propre après chacune)

| # | Neutralisé | Rouges |
|---|---|---|
| 1 | `.strict()` retiré du frontmatter | **1** — le correctif de M2 mord : le cas échoue sur `to contain 'titre'` |
| 2 | `compareVersions` → `localeCompare` | **2** |
| 3 | filtre de surface retiré de `visibleNavigation` | **6** — 5 dans `protection.test.ts`, **1 au point de composition** |
| 4 | `?locale=` du flux accepté sans validation | **1** |
| 5 | lien `/changelog` écrit en dur dans `MarketingFooter` (M8) | **0 sur 2621 cas unitaires** ; **1 rouge dans l'étape navigateur** de `test:minimal-profile` |
| 6 | une page passant une seconde expression de pied de page | **1** — le balayage de `app/` mord |
| 7 | filtre de locale de `changelogListView` retiré | **0** ← constat |
| 8 | garde `catalog.index === null` retirée | **0** ← constat |
| 9 | cinquième valeur de `CHANGELOG_CATEGORIES` sans clé de catalogue | **0** ← constat |
| 10 | ancre `id={entry.slug}` retirée | **0** ← constat |

M8 est la revendication centrale de la story, confirmée **dans les deux sens** : invisible à toute la suite unitaire, rouge exactement là où le défaut vivrait.

## Constats

**major — `packages/modules/changelog/src/application/changelog-catalog.ts`** — le filtre de locale de la page n'est pas testé. Remplacer `catalog.entries.filter((entry) => entry.locale === query.locale)` par `catalog.entries` laisse 2610 cas verts : la page française listerait les entrées anglaises sans que rien ne le dise. `tests/rendered-text.test.ts` ne peut structurellement pas l'attraper — son `changelogData` attendu est construit **en appelant la fonction sous test**, donc l'attente suit la mutation. Il n'y a aucun fichier de test dans `application/`. C'est la moitié « page » du critère 4 ; la moitié « flux » est couverte.

**minor — `tests/changelog.test.ts`** — le commentaire du cas « n'annonce rien quand le catalogue n'est pas monté » affirme que sans la garde il annoncerait `/changelog`. Faux : le seul catalogue à `index === null` est `EMPTY_CHANGELOG_CATALOG`, dont les `entries` sont vides, donc la garde suivante renvoie `[]` de toute façon. Mutation à `if (false)` : cas vert. Une mutation verte veut dire que le test est faux, pas que le code est juste.

**minor — `packages/modules/changelog/AGENTS.md` + `src/domain/message-keys.ts`** — les deux affirment qu'ajouter une catégorie sans clé de catalogue fait rougir `tests/i18n.test.ts`. Mesuré : ça laisse 102 cas verts. `changelogMessageKeys()` est exporté et **consommé par rien** — son homologue du consentement, lui, est consommé par `tests/consent.test.ts:451`, ce qui rend la même phrase vraie là-bas. Une garantie sans commande derrière, dans un dépôt dont la règle est de demander quelle commande échoue.

**minor — `changelog-list.tsx`** — `CATEGORY_ORDER` réécrit `CHANGELOG_CATEGORIES` à la main, dans un fichier qui importe déjà ce module. Une cinquième catégorie donne `indexOf === -1` et se trie silencieusement en premier. Dériver plutôt que nommer — le thème de la story elle-même.

**minor — design system, `changelog-list.tsx:80`** — `<h3 className="text-lg font-medium">` (1,125 rem / 500) ne correspond à aucun rôle de `docs/design-system.md`, et `text-lg` n'apparaît **nulle part ailleurs dans le dépôt**. Confirmé dans le HTML servi. Lié : aucun `docs/designs/s31-changelog.md` n'existe alors que la story livre un écran public neuf — s29 et s30, même famille, en portent un, et c'est exactement une passe de design qui attrape une paire de type inventée.

**minor — aucun ADR pour la clé `surface`** — `NavigationEntry.surface` modifie le contrat dans `packages/core` et fait passer le pied de page d'un import nommé à une dérivation du registre. Le précédent du dépôt pour un changement de contrat est un ADR (054 pour `publicUrls`, 024 pour la seconde entrée) ; les trois options ne sont pesées que dans la recherche et dans des commentaires.

**minor — comptes écrits périmés dans des fichiers touchés** — `tests/syndication.test.ts` dit « la configuration livrée compte **cinq** entrées de navigation publiques » ; mesuré **8** sur le registre livré. `packages/core/src/module.ts:285` dit encore « dix des douze modules du dépôt » alors que l'annuaire en porte 17 (préexistant, rendu plus périmé ici).

**minor — ancre non testée** — retirer `id={entry.slug}` laisse la suite verte, alors que chaque `link`/`guid` du flux vaut `…/changelog#<slug>`. Les deux ne sont liés que par l'intention.

**observation** — à l'intérieur d'une version, la présentation retrie par catégorie, si bien que la version 1.1 affiche 2026-02-18 au-dessus de 2026-02-20, alors qu'un commentaire de `changelog-entry.test.ts` annonce l'ordre chronologique inverse « à tous les étages ». L'écran contredit le commentaire ; la lecture du critère au niveau du groupe, elle, est satisfaite.

## Règles, ADR, régressions

Aucun ADR contredit : 065 est cohérent avec 055 (`@repo/ui` n'est pas le tiroir des choses partagées) et avec 054 (`publicUrls` reste la seule source du plan de site). ADR 053 respecté : aucun MDX évalué à l'exécution, aucun `dangerouslySetInnerHTML`. Les couches tiennent (`node:fs` seulement sous `infrastructure/`, la présentation reçoit l'infrastructure en paramètre, le barrel principal ne réexporte aucun `.tsx`). Zod aux deux nouvelles frontières ; la route du flux est publique, donc limitée par dérivation (`routeIsRateLimited`, couvert par `tests/rate-limiting.test.ts:1062`). Le défaut du créneau réservé dans `apps/web/lib/organizations.ts` est réellement fermé, et c'est le cas dérivé du disque qui le tient. Consommateurs de `registry.navigation` ouverts pour régression : `entitlement.ts`, `validate.ts`, `organizations.ts`, la coquille applicative, `scripts/minimal-profile-rules.ts` — tous cohérents, et le lien du consentement rend à l'identique.

## Non vérifié

- **Aucun navigateur n'a jamais chargé `/changelog` dans la configuration activée.** La seule couverture navigateur de cette story est la configuration **coupée**, et `e2e/` n'a pas de `changelog.spec.ts` là où `blog.spec.ts` et `docs.spec.ts` existent. La page a été récupérée et analysée depuis un vrai serveur, mais en **mode dev**. Geste humain : ouvrir `/fr/changelog` et `/en/changelog` sur le build de production, à **390 px** et en **thème sombre**, et contrôler les titres de version, les badges et le contraste de la date — `pnpm test:contrast` ne couvre que l'`Alert`.
- **`pnpm test:e2e` non joué.** Le pied de page gagne un cinquième lien ; aucun impact attendu, non prouvé.
- **« Un frontmatter invalide fait échouer le build » non exercé de bout en bout.** Le refus est prouvé au niveau unitaire, pas en cassant un `.mdx` et en rejouant `pnpm build`.
- **Le flux n'a jamais été donné à un vrai agrégateur**, seulement à `@rowanmanning/feed-parser` — ce que le code lui-même écrit comme prouvant « analysable », pas « valide ».
- **`pnpm test:socle` et `pnpm test:golden-path` non joués.**

Max severity: major
Ship allowed: yes
