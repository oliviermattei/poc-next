# Review — Story s30-docs-site

> Branche `feature/s30-docs-site`, **un seul commit** au-dessus d'`origin/dev`.
> `git diff origin/dev...HEAD --name-only` : 67 fichiers, **rien sous `docs/research/`**.
>
> **Note de procédure.** Un second commit avait atterri sur cette branche par erreur — le contexte principal y a écrit `docs/research/s31-changelog.md` alors que son shell était resté dans ce worktree après y avoir déposé le design et le plan de s30. L'implémenteur l'a détecté **et a refusé de le supprimer par rebase**, la branche portant alors l'unique copie : le bon réflexe. Le fichier a été rapatrié sur `dev`, la branche rebasée. C'est le troisième manquement du contexte principal à « un agent, un répertoire de travail » sur cette séance, et le premier qui déplace un document ; il est enregistré dans `docs/killer-saas-feedback.md`.

## Harnais, exécuté par le relecteur

| Commande | Résultat |
|---|---|
| `pnpm typecheck` | **27/27** |
| `pnpm lint` | propre, `--max-warnings=0` |
| `pnpm test` | **2121 passés / 8 sautés / 70 fichiers** (base : 2064/8/67) |
| `pnpm build` | succès ; `ƒ /docs` et `ƒ /docs/[section]/[page]` dans la table des routes |
| `pnpm test:e2e` | 102 passés / 2 échecs — **des intermittents, pas une régression** (voir F6) |
| `pnpm test:socle` | **2116/13**, 90 cas navigateur, arbre propre après build et parcours |
| `pnpm test:minimal-profile` | **5/5**, **6 modules coupés** dont `docs`, **6 adresses de navigation en 404 HTTP** |
| `pnpm run audit` | 1 avis, aucun au seuil élevé non couvert |

**Aucun test supprimé** : une seule suppression dans le diff des fichiers de test, l'élargissement d'une condition de `e2e/marketing.spec.ts` au module `docs`.

## Le déplacement de l'échelle de prose (ADR 055)

**Vérifié par lecture du diff, pas par la déclaration.** `packages/modules/blog/src/presentation/prose.tsx` supprimé, `packages/ui/src/composed/prose.tsx` créé ; les seuls écarts sont l'import, la documentation, `textOf`, `ProseOptions`, l'enveloppe `createProseComponents` et les trois `{...anchored(props)}`.

**Le critère d'acceptation de l'ADR est rempli** : ni `tests/blog.test.ts` ni `e2e/blog.spec.ts` n'apparaissent dans le diff ; seuls des imports ont changé. Rejoués par le relecteur : `tests/blog.test.ts` **25/25**, `e2e/blog.spec.ts` **7/7**. **Zéro assertion réécrite.**

Le module `docs` déclare `requires: []` et n'importe **aucun** `@repo/module-*` — vérifié par balayage de tout son `src/`.

## Constats

### F1 — **major** — l'ordre déclaré des sections n'était vérifié par aucun test

Muter `byOrder` pour les sections seules laissait `pnpm test` **entièrement vert, 2121/8**. La cause : le cas nommé « range les sections par leur ordre déclaré » avait pour fixture `[section('reference', 2), section('prise-en-main', 1)]` — un ordre identique **par `order` et par l'alphabet**. Le contenu livré portait la même coïncidence.

C'est le piège que l'implémenteur avait identifié puis corrigé **une couche plus bas** : la fixture des pages contredit l'alphabet et sa mutation rend 2 rouges. Il l'a reproduit au niveau des sections.

**Fermé.** Reproduit d'abord (14/14 vert sous mutation), fixture corrigée (`api` à l'ordre 2, `prise-en-main` à 1), mutation rejouée → **1 rouge**. Code de production intact.

### F2 — minor — la paire `#` / `##` produisait deux ancres identiques

`parseDocsPage('# Options\n\n## Options')` était accepté, `headings = ['options']` — mais le rendu posait un `id` sur `h1` **comme** sur `h2`, donc deux `id="options"` dans le DOM, et le lien du sommaire atterrissait sur le mauvais. `packages/modules/docs/AGENTS.md` affirmait pourtant « le refus supprime la divergence au lieu de la documenter ».

**Fermé**, et par le bon geste : l'ancre est retirée du `h1` plutôt que le refus étendu au niveau 1. Le sommaire ne dérive que des `##`/`###` ; une ancre sur un niveau que rien ne nomme ne peut que doubler une ancre nommée. Les deux passes couvrent désormais le même ensemble de niveaux — **la condition que la phrase supposait sans la dire**. La phrase est rendue vraie, pas affaiblie. Mutation (`anchored` remis sur `h1`) → 1 rouge. **Sans effet sur le blog** : il appelle `createProseComponents()` sans `headingId`, donc `anchored` rendait déjà `{}`.

### F3 — minor — la réservation du slug `docs` ne mord que dans une configuration

`'docs'` retiré d'`APPLICATION_SEGMENTS` : `tests/organizations.test.ts` passe 112/112 et `pnpm test` reste vert ; seul `pnpm test:minimal-profile` rougit. La recette **est** dans la CI, donc c'est livrable — mais c'est la **troisième** occurrence du même mécanisme (`billing`, `blog`, `docs`), et rien ne dérive encore la règle : un écran de `apps/web/app/<seg>/` doit être réservé **indépendamment** de l'état du module qui le porte. **Laissé ouvert** : le mécanisme manquant est une story, pas une greffe.

### F4 — minor — la mesure de la mise en page à trois colonnes n'était écrite nulle part

Mesuré sous serveur réel : corps de **358 px à 390**, **464 px à 768**, **448 px à 1440** — plus étroit sur le grand écran, parce que la coquille borne à `max-w-4xl` et que la grille la partage à partir de `lg`. Conséquence : la mesure de ligne du design system (`max-w-2xl`, 672 px) **n'est jamais atteinte** sur une page de documentation.

Acceptable en l'état — 448 px font ~56 caractères, aucun débordement horizontal aux trois largeurs — et élargir la coquille serait une refonte hors périmètre. **Fermé** : les chiffres sont désormais dans le manque n°4 du design et au-dessus de `PROSE_CLASSNAME`, remesurés plutôt que recopiés.

### F5 — minor — deux comptes écrits qu'aucune commande ne dérive

`packages/modules/docs/AGENTS.md` disait « les **quatre** refus » puis « **deux** refus de forme s'y ajoutent », alors qu'un septième était nommé quatre paragraphes plus haut et que les points de levée réels sont treize. **Fermé** : les deux nombres retirés, les sept causes nommées, et le fichier dit que la liste **est** le compte et qu'aucune commande ne la dérive.

### F6 — minor — la liste des cinq intermittents était incomplète

`e2e/rate-limiting.spec.ts:163` et `:205` ont rougi sous quatre travailleurs et passent seuls comme sous `test:socle` ; la liste ne nommait que `:38` pour ce fichier. **Deuxième fois en deux stories** qu'une liste d'intermittents nomme un cas sur plusieurs. **Reporté dans `s52-derniers-intermittents`** sur la branche par défaut, avec le constat de méthode.

### F7 — minor — deux écarts de convention assumés

Le plan ne nomme aucune section de `docs/security.md`, que `AGENTS.md` exige — les contrôles sont respectés et cités **dans le code**. Et le test de `readDocsDirectory` vit à la racine plutôt qu'à côté de sa couche, alors que le blog place l'équivalent dans son module. **Laissés ouverts**, écrits dans la note d'exécution.

## Les huit écarts déclarés — jugés

`createProseComponents` **ajouté** plutôt que simplement déplacé (justifié : sans le paramètre, une seconde typographie) · `documentHeadings` **refuse** au lieu de dédoublonner (le bon geste : retirer la divergence plutôt que la documenter) · **cinq refus au build** non nommés par le plan, chacun avec son cas et prouvé sur le contenu versionné · `e2e/marketing.spec.ts` dérivé **du contenu** et non de `publicUrls()`, qui aurait été tautologique · `docsBodyStrings` séparé, la version étroite du blog intacte · **la garde de `packages/ui/AGENTS.md`**, meilleur apport de la story : elle a rougi immédiatement sur `Avatar`, une dérive ouverte depuis **s18** que s29 avait signalée sans la fermer · `ScrollArea`, `Command` et `BreadcrumbEllipsis` non copiés · quatre fichiers de test, placement conforme.

## Deux défauts que seuls le navigateur et les recettes ont trouvés

Un **HTTP 500 sur chaque page de documentation** — un objet de fonctions ne traverse pas vers un composant client. Aucun test unitaire ne pouvait le voir : `tests/docs.test.ts` appelle la fonction de page, ce qui court-circuite la frontière. Il est désormais gardé par `e2e/docs.spec.ts`, qui tourne dans `test:e2e` **et** dans `test:socle`.

Et `pnpm test:minimal-profile` rouge sur `reservedSlugs`, module coupé — voir F3. **`pnpm test` était vert dans les deux cas.**

## Écran, rendu

Douze chargements, deux pages × trois largeurs × deux thèmes, sous serveur réel. **Zéro erreur de console, zéro `pageerror`.** Ancres du sommaire et `id` rendus coïncident exactement aux six configurations. `/docs` → 307 vers `/fr/docs` ; page inconnue → **404** ; section inconnue → **404**. `sitemap.xml` : 12 `<loc>`, aucun chemin privé.

Rien d'inventé hors du système : `Breadcrumb` **copié** de shadcn/ui, `Sheet`, `Accordion`, `Alert` en **variante par défaut** (donc aucune couleur sémantique, ce que s49 impose), `EmptyState`. **Aucun `loading.tsx` nulle part**, vérifié par `find` et gardé par un cas dérivé de `git ls-files`.

## Socles

**Sécurité** : Zod aux deux frontières de contenu et aux paramètres de route ; l'`import()` du corps est construit depuis le catalogue résolu, jamais depuis l'entrée utilisateur ; aucune route ajoutée ; CSP intacte ; module coupé, six adresses en 404 HTTP ; rien de privé dans le plan de site. **Aucune brèche.**
**Fiabilité** : ni webhook, ni job, ni migration, ni appel sortant. **Aucune brèche.**
**ADR** : 018, 022, 024, 053, 054 respectés ; 055 cohérent avec ce qu'il décrit, **y compris son dernier point** — aucune commande ne refuse un `import` inter-modules aujourd'hui, `assertNoForbiddenModuleReferences` ne juge que les clés étrangères. **Le signaler plutôt que le combler était juste** : la règle demande un mécanisme de lint transverse, donc une story.

## Ce qui n'a pas été vérifié

Le serveur de production réel — `next start` refuse de démarrer sur ce poste, trois fois et **chaque fois en nommant la variable manquante**, ce sont les gardes de s27/s18 qui mordent. Le corps MDX compilé n'a donc jamais été observé **sous la CSP de production**. · Le repli i18n n'a aucun parcours navigateur. · Le suivi du défilement du sommaire, vérifié au clic et non au défilement continu. · Aucun lecteur d'écran. · Le rendu sans JavaScript. · `pnpm test:golden-path`. · L'effet réel d'`outputFileTracingIncludes`, masqué par l'avertissement de traçage que le build émet.

**Le delta du correctif n'a pas fait l'objet d'une passe de revue indépendante** : chacun de ses deux changements de code porte sa mutation, reproduite avant correction pour F1, et l'absence d'effet sur le blog a été vérifiée séparément. Les deux autres corrections sont documentaires.

Max severity: minor
Ship allowed: yes
