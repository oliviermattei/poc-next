# Revue — s52-derniers-intermittents

Story dont le sujet est les tests instables : l'instinct habituel de revue — « le rejouer et le voir passer » — ne prouve presque rien, puisqu'un cas instable passe la plupart du temps par définition. Ce qui compte est **si chaque cause revendiquée est établie par une mesure reproductible**, et si les cas laissés ouverts le sont honnêtement plutôt que discrètement élargis.

## Suites exécutées par le relecteur

| Commande | Résultat |
|---|---|
| `pnpm test` | **2332 passés / 8 sautés**, joué deux fois — conforme |
| `pnpm typecheck --force` | 29/29, **0 en cache** |
| `pnpm lint` | aucun problème |
| `pnpm test:e2e` | **108 passés / 8 sautés** — conforme |

## Les trois refus, jugés sur pièces

L'implémenteur a refusé le plan **trois fois, chaque fois sur une mesure**. Le relecteur a re-mesuré le cas d'audit lui-même :

- à vide, 6 passages : 2084 / 2425 / 2084 / 2191 / 2344 / 2490 ms
- sous **64 processus concurrents** sur 8 cœurs, 6 passages : 3728 / 4339 / 3944 / 4380 / 3916 / 4439 ms
- **12 passages sur 12 verts**, les trois tentatives comptées chaque fois ; `expected 2 to be 3` **jamais reproduit**

Contre un filet à 20 000 ms, c'est **au moins 4,5× de marge à huit fois la charge nominale**. Verdict : « ce n'est même pas serré ».

Et le relecteur tranche une subtilité qui comptait : **ce refus ne contredit pas un fait vérifié, il résout une question que la recherche laissait explicitement ouverte** (« ce qui reste à établir : le facteur exact n'a pas été mesuré »). L'implémenteur a fait la mesure demandée, et elle a falsifié l'inférence de la recherche. C'est le pipeline qui fonctionne.

Même verdict sur la « cause C » (5 000 ms de défaut contre ~235 ms mesurés, 21× de marge) et sur la course de migration — cause établie **par lecture** (quatre fichiers appellent `runModuleMigrations` en `beforeAll` contre une base unique en travailleurs parallèles ; le migrateur de Drizzle est idempotent par journal, pas concurrent), correctement reportée parce que le correctif change le contrat de `@repo/db` et demande une connexion dédiée — un verrou consultatif de session pris sur une connexion du pool serait relâché sur une autre.

## L'hypothèse des travailleurs, mesurée des deux côtés

L'implémenteur avait chronométré l'écart entre les deux défis 2FA sur 15 passages à 4 travailleurs : 3, 2, 44, 1, 42, 12, 13, 12, 53, 26, 31, 2, 52, **0**, 22 ms — **le passage à 0 ms est exactement celui qui a rougi**, faisant tomber les deux cas ensemble. À 1 travailleur : 456, 364, 348, 292, 107 ms.

Le relecteur l'a mesurée indépendamment — écart minimal sur 12 passages : 4, 7, 8, 12, 15, 17, 22, 27, 38, 46, 54, 111 ms. Même famille de distribution. Une collision à 0 ms est atteignable, donc `Date.now()` à la milliseconde **est** une ressource partagée, et `randomUUID` la supprime structurellement au lieu de la rendre rare.

Il a aussi joué 10 passages avec l'ancienne forme sans voir de rouge, et l'a lu comme **cohérent avec un événement 1 sur 15, pas comme une réfutation** — la bonne lecture d'un vert sur un intermittent.

**Confirmée sur un cas précis, réfutée comme explication de la famille** : la cause A n'implique aucun travailleur Playwright, et le relecteur l'a reproduite sans aucun. « Trois documents l'affirment » était lui-même un compte périmé : un seul le faisait.

## Cause B — aucune régression de sécurité

Vérifié confiné au fournisseur de développement local : `localOAuthPlugins` vaut `[]` sauf sous `options.oauth?.localProvider === true`, les vrais fournisseurs passent par `socialProviders`, intacts. Les deux gardes de démarrage tiennent. L'ensemble des identités atteignables est exactement `local@example.test` ∪ `local-<[a-z0-9]{1,16}>@example.test`, **toutes dans le domaine réservé par la RFC 6761** — un `code` fourni par un attaquant ne peut nommer le compte d'un tiers.

## Constats — trois majeurs, tous fermés

**M1 — le refus n'était pas testé à son site.** Replier une étiquette malformée sur l'identité par défaut **à la route** laissait 2332 cas et les 5 parcours OAuth verts, alors que le `AGENTS.md` du module et `.env.example` affirment le contraire. Le domaine était couvert ; la route, non — or c'est là qu'un appelant externe fournit l'étiquette. Fermé : trois cas de route, et la mutation passe de **0 à 1 rouge**. Les mutations du domaine se sont approfondies au passage (2 → 3, et 3 → 5).

**M2 — le filet anti-échappatoire était plus étroit que son nom**, et c'est toute la réponse de la story à P8. `test.skip()` **sans argument** — la forme idiomatique de Playwright — et `test.describe.configure({ retries: 3 })` passaient tous deux : 8/8 verts. Fermé par une réécriture qui **analyse les arguments plutôt que l'orthographe** : commentaires retirés en suivant les chaînes, parenthèses équilibrées par site d'appel. Elle a révélé un faux positif au passage — `playwright.config.ts` **cite** `retries: 0` dans sa prose. Sept mutations le prouvent désormais, dont `test.describe.configure({ mode: 'serial' })`, c'est-à-dire la sérialisation que le plan avait rejetée pour la cause B.

**M3 — le critère 1 était violé par le fichier même que le diff modifie.** Il disait « aucun critère, aucune note et aucun document ne réécrit ce nombre », et trois « trois » survivaient dans la même section — titre compris — pendant que le registre en dérive **treize**. La story dont le sujet est les comptes périmés en livrait trois dans son propre titre, juste sous la note annonçant que le compte n'est plus écrit.

**Et l'implémenteur a fait plus que les retirer : il a affaibli le critère pour qu'il dise ce qu'une commande tient.** Rien ne peut empêcher un quatrième document de réécrire le compte ; seule la dérivation le rend inutile. C'est une story qui modifie sa propre condition de succès — inhabituel, et justifié ici parce que la version antérieure promettait un contrôle qui n'existe pas.

## Le quatrième appelant, et l'exemption mesurée

La liste des fichiers chargeant le graphe lourd est désormais **dérivée** — `COLD_GRAPH_ENTRY_POINTS` pilote un balayage sur disque, et chaque appelant doit porter le délai **ou** figurer dans une liste d'exemptions **avec son nombre**. Une exemption périmée est refusée, un cinquième appelant aussi.

Mesuré, les quatre fichiers ensemble sous 16 processus concurrents, 5 passages :

| Fichier | Pire cas | Décision |
|---|---|---|
| `tests/deployment.test.ts` | 7 184–7 551 ms | délai explicite |
| `tests/env-wiring.test.ts` | 6 925–7 465 ms | délai explicite |
| `tests/jobs.test.ts` | 2 318–2 499 ms | mesuré, ~2× de marge — pas de délai |
| `tests/admin.test.ts` | 634–768 ms | mesuré, ~6,5× de marge — pas de délai |

L'écart n'est pas du bruit : les deux premiers font du graphe la **première** transformation d'un test après `vi.resetModules()` ; les deux autres l'ont déjà tiré par imports statiques, donc le coût est payé au chargement du fichier, hors de toute assertion. Leur donner le délai aurait été l'élargissement aveugle que les critères interdisent.

**Le rebase a rendu la mutation déterministe** : `vi.setConfig` retiré, les quatre fichiers sous 16 processus donnent **2 rouges sur 3 passages sur 3** — la même mesure prouve le correctif *et* l'exemption, puisque `admin` et `jobs` restent verts dans les mêmes exécutions.

## Cas laissés ouverts, honnêtement

`e2e/rate-limiting.spec.ts:38` (seul rouge observé confondu avec un serveur pas encore servant), `e2e/blog.spec.ts:134` et `e2e/health.spec.ts` (`ECONNRESET`, non reproduits), `tests/auth.test.ts:765` (symptôme introuvable dans les documents, 0 rouge sur 3 suites complètes), le cas d'audit et la région 2FA. Chacun porte **« cause non établie »** écrite, jamais un délai posé sur une hypothèse.

## Non vérifié

Trois des treize cas n'ont jamais rougi qu'**en CI**, à un travailleur ; tout ici a tourné sur macOS 8 cœurs. `pnpm test:socle` et `pnpm test:minimal-profile` non joués — or c'est le régime qui a produit deux des cas ouverts. La course de migration a été établie **par lecture** des deux côtés : personne n'a forcé deux migrations concurrentes contre une base vide, et c'est un geste de dix minutes à faire avant de rouvrir la décision. Les chiffres de la région 2FA n'ont pas été re-instrumentés par le relecteur.

Max severity: major
Ship allowed: yes
