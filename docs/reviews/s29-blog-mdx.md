# Review — Story s29-blog-mdx

> Trois tours, en contexte frais à chaque fois. Chaque tour ne porte de lignes de porte
> qu'à sa fin ; les verdicts des tours précédents sont marqués dépassés, pour que le grep
> de `/ks-ship` n'ait qu'une réponse.
>
> **Note de procédure, écrite parce qu'elle a coûté quelque chose.** Ce fichier n'a pas
> été écrit après le premier tour : le contexte principal a reçu le corps du rapport et a
> enchaîné directement sur le correctif. Le second relecteur a découvert son absence et a
> dû juger contre un résumé plutôt que contre le texte — donc sans pouvoir vérifier les
> constats que ce résumé omettait. La porte de `/ks-ship` l'aurait refusé, mais deux tours
> plus tard. Le constat est enregistré dans `docs/killer-saas-feedback.md`.

---

# Premier tour — la story complète (HEAD `f97103f`)

> Diff jugé : `git diff dev...feature/s29-blog-mdx`, 55 fichiers, +4616/−45. Worktree `.worktrees/s29-blog-mdx`, PostgreSQL 5443. Chaque commande ci-dessous a été lancée par le relecteur, pas lue dans un résumé. Arbre prouvé propre après chaque mutation.

## Harnais — exécuté par le relecteur

| Commande | Résultat |
|---|---|
| `pnpm typecheck` | 26/26, exit 0 |
| `pnpm lint` | « ESLint: No issues found », exit 0 |
| `pnpm test` | **2027 passés, 8 sautés, 0 échec** |
| `pnpm build` | exit 0 ; `ƒ /blog` et `ƒ /blog/[slug]` servies ; 4 avertissements Turbopack |
| `pnpm test:e2e` | **97 passés / 8 sautés**, les 5 cas d'`e2e/blog.spec.ts` verts |
| `pnpm test:socle` | exit 0, 10 étapes rejouées, 3 exclues avec leur raison |
| `pnpm test:minimal-profile` | exit 0 — « 5 modules coupés : billing, **blog**, i18n, organizations, demo-disabled » |
| `pnpm run audit` | 1 avis, aucun au seuil élevé non couvert |

**Aucun test supprimé** ; le compte 1991 → 2027 est cohérent avec les 36 cas ajoutés. **Les trois intermittents connus n'ont pas rougi.**

Note : la **première** exécution de `test:socle` a échoué, et pour la bonne raison — quatre fixtures `.mdx` temporaires déposées pour rendre la pagination ont été nommées une par une par `assertWorkingTreeUnchanged`. La garde de s26/s48 mord réellement.

## Anti-hallucination

Les claims de l'ADR 053 sur les options rejetées ont été **ouvertes**, pas crues : `@mdx-js/mdx@3.1.1/lib/run.js` ligne 7 `const AsyncFunction = Object.getPrototypeOf(run).constructor`, ligne 24 `new AsyncFunction(...)`, ligne 43 `new Function(...)`, précédées de « ☢️ Danger: this `eval`s JavaScript ». **Les trois numéros de ligne sont exacts.** Les autres options ne sont pas installées, et l'ADR le dit lui-même dans un paragraphe « ce qui n'a pas été mesuré » — c'est la bonne façon de l'écrire.

Interdits vérifiés dans l'artefact plutôt que sur parole : `grep -rl "Object.getPrototypeOf(run)" apps/web/.next/standalone` → **aucun fichier**. Aucune origine ajoutée à la CSP (`security-headers.ts` et `config/security.ts` absents du diff). Aucun `dangerouslySetInnerHTML`. Le tag actif se distingue par la primaire et `aria-current`, **sans couleur sémantique** — styles calculés relevés au navigateur.

## Design

Neuf composants réutilisés, aucun inventé. `Skeleton` et `Pagination` étaient **déjà déclarés** dans `docs/design-system.md` sur `dev` sans exister dans `packages/ui` : le diff les implémente, il ne les invente pas. L'échelle de prose a été confrontée ligne à ligne au tableau des huit rôles — les onze entrées sont dérivées.

**16 rendus faits par le relecteur**, 1280×900 et 380×900, clair et sombre, quatre états : `scrollWidth − clientWidth = 0` partout, 0 erreur de console partout. Deux écarts au brief relevés, aucun imputable à l'implémentation : le blog est servi dans `AppShell` comme toutes les pages marketing — c'est le brief qui est en retard sur le dépôt.

## Constats du premier tour

- **F1 — major — une garantie « mesurée » qui est fausse, et un test nommé qui n'existe pas.** L'ADR 053 écrivait « `tests/deployment.test.ts` en garde la trace » : `grep -rn outputFileTracing tests/` rend **zéro** occurrence. Et en retirant `outputFileTracingIncludes` puis en rebâtissant, les cinq `.mdx` sont **toujours** embarqués — `resolve(process.cwd(), …)` fait tracer le projet entier, ce que le build dit lui-même.
- **F2 — major — `blog` entre dans `enabledModules` contre le texte du plan, et `robots.txt` interdit `/blog`.** Livré activé, cela devient l'état par défaut : une entrée de navigation, trois articles servis, et une consigne de non-indexation — pour une fonctionnalité dont la raison d'être écrite est l'acquisition organique. **Décision humaine.**
- **F3 — minor — l'état de chargement est du code mort.** Aucun `loading.tsx`, donc `BlogListSkeleton` ne peut jamais être rendu.
- **F4 — minor — « Sept fichiers font exception » suivi de huit fichiers.**
- **F5 — minor — « aucune fixture ne peut le mettre en défaut » est plus étroit que « incouvrable ».** Le comparateur extrait en `domain/` se prouverait en trois lignes.
- **F6 — minor — `Pagination` n'a aucune troncature** : 84 liens à 500 articles.
- **F7 — minor — un `page` malformé emporte le `tag` valide.**
- **F8 — minor — un quatrième avertissement Turbopack de traçage**, qui rejoint trois sites préexistants.

## Non vérifié au premier tour

Le serveur autonome de production n'a jamais démarré (la garde de démarrage refuse `STORAGE_LOCAL_DIRECTORY` puis exige une origine S3 déclarée) : **toutes les preuves navigateur sont sous `next dev`**. La pagination avec du vrai contenu. Aucun lecteur d'écran. Le rendu du blog en configuration socle. La fidélité des options rejetées autres que `@mdx-js/mdx`, non installées.

> Verdict du premier tour — **dépassé par les tours suivants** :
> Max severity: major · Ship allowed: yes

---

# Second tour — revue de delta (`f97103f..a49498c`)

> Portée : le seul delta du correctif, plus la reconfirmation des preuves du premier tour au nouveau HEAD.

## Ce qui n'a pas été réexaminé

Le choix de la brique MDX · la validation Zod du frontmatter · la bascule i18n · l'échelle de prose · les balises méta · les quatorze clés du contrat · le composant `Pagination` · la fidélité au design · F5, F6, F8, confirmés intacts.

## Harnais, réexécuté

`typecheck` 26/26 · `lint` propre · `test` **2030 / 8 sautés** · `build` exit 0, **5 `.mdx`** dans `.next/standalone/content/blog/` · `test:e2e` **97 / 8** · `test:socle` **83 / 22**, arbre propre · `test:minimal-profile` 4 passés, suite du clone **2027 / 11 / 0 échec** · `audit` propre.

**Aucun test supprimé** : la liste des fichiers de test est **identique** entre `f97103f` et `a49498c`. Suite rejouée sur `f97103f` : 2027 passés, contre 2030 au HEAD — exactement les **+3 cas** du delta. Le retrait de `skeleton.tsx` n'a laissé tomber aucune couverture.

## Preuves du premier tour, reconfirmées

En-tête lu sur le serveur autonome **réellement démarré** : `default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'` — ni `unsafe-inline`, ni `unsafe-eval`. `.next/standalone/node_modules/.pnpm` ne contient **ni** `@mdx-js/*`, **ni** `remark*`, **ni** `micromark*`, **ni** `acorn`.

## Constats du second tour

- **R2-1 — major — la phrase que F1 ferme survit au troisième endroit, celui du code.** `apps/web/next.config.ts:45-47`, le commentaire au-dessus de la déclaration, portait encore mot pour mot l'affirmation jugée fausse — et ces lignes sont **introduites par s29**. La note d'exécution écrivait « **les deux** phrases » : un compte au-dessus d'une liste plus longue, à l'intérieur même de la correction d'un constat sur les comptes écrits.
- **R2-2 — major — la justification de F3 est fausse telle qu'écrite, et la garde ne mord que dans une configuration.** La **conclusion** est juste et vérifiée : ni la liste ni l'article ne peuvent porter un squelette sans perdre un 404. Le **mécanisme** invoqué — « la frontière d'un segment couvre ses enfants » — est réfutable : un groupe de routes `app/blog/(index)/` scope bien la frontière (le repli est engagé, prouvé par son balisage dans le corps servi, **et** `/blog/<inconnu>` reste 404). La vraie raison est que la liste elle-même refuse quand le module est coupé. **Et le trou :** un `loading.tsx` dans un groupe de routes laisse `e2e/blog.spec.ts:132` vert, `tests/blog.test.ts` vert (il appelle la fonction de page, court-circuitant toute frontière) et `test:minimal-profile` vert (le module déclare `routes: []`). Le jour où s30 réfute la phrase et pose le repli scopé, le produit en profil minimal sert `/blog` en **200** sans qu'aucune commande ne rougisse.
- **R2-3 — minor — `packages/ui/AGENTS.md` range encore `Pagination` parmi les non copiés.** `Avatar` y est déjà mal rangé sur `dev` : le défaut préexiste, s29 en ajoute une occurrence.
- **R2-4 — minor — la tâche 6 du plan reste cochée** alors que son « `Skeleton` au chargement » n'est pas livré. L'écart est déclaré à cinq endroits, mais soixante lignes plus bas que la case.
- **R2-5 — minor — la dérivation de F4 est réelle et plus étroite que sa prose** : `readdirSync` est plat, le cas exige une mention **quelque part** et non dans la bonne catégorie, et le plancher est un nombre écrit à la main (8) contre 15 importateurs.
- **R2-6 — observation** — un seul des deux nouveaux cas de `tests/blog.test.ts` mord ; l'autre est un garde-fou de régression, correctement étiqueté.

## Non vérifié au second tour

Le 404 contre le serveur de production en HTTPS (la redirection de locale boucle sur `http://`, le cookie étant `Secure`). `/blog` en 404 HTTP quand le module est coupé — **aucune recette ne le sollicitait**, ce qui est précisément R2-2. Le rendu navigateur, non refait. Le premier rapport de revue, **absent du disque**.

> Verdict du second tour — **dépassé par le tour suivant** :
> Max severity: major · Ship allowed: yes

---

# Troisième tour — passe étroite sur la garde de F3 (`a49498c..c1852c1`)

> 6 fichiers, +186/−30, **aucun code de production**. Les tours 1 et 2 ne sont pas rouverts ; F2, F5, F6, F8, R2-5, R2-6 restent intacts.

## Harnais, réexécuté

`typecheck` 26/26 · `lint` exit 0 · `test` **2030 / 8 sautés** · `build` exit 0 · `test:e2e` **97 / 8** · `test:socle` **rouge au premier passage, vert au second** (83 / 22) · `test:minimal-profile` **5/5**, joué deux fois · `audit` propre. `.env` d'empreinte identique avant et après chaque exécution.

**Le rouge du socle n'appartient pas à s29** : `e2e/oauth.spec.ts:30`, `duplicate key value violates unique constraint "auth_user_email_key"` — les deux cas OAuth pilotent le fournisseur local, qui rend toujours la même identité ; joués en parallèle, celui qui perd la course d'insertion échoue. C'est l'intermittent de s52, **et sa liste ne nomme que `:97` alors que la paire est `:30`/`:97`** — une liste qui nomme un cas sur deux se lit comme vérifiée.

## La garde, sur les quatre points

1. **Elle n'est pas vide, et son plancher est le sien.** `minimal-profile.spec.ts:165` ouvre sur `expect(sweep.navigation.length).toBeGreaterThan(0)`. Ça compte plus qu'il n'y paraît : le plancher partagé `assertSweepIsNotEmpty` **additionne** routes + navigation + tables et sort dès que le total est positif — un profil coupant des modules qui déclarent des routes mais **aucune** navigation passerait donc le plancher partagé pendant que le nouveau cas ne balaierait rien. Dérivation vérifiée de bout en bout : `sweepProfile` construit `navigation` depuis `cut.flatMap(m => m.navigation)`, rien ne nomme un module, et le profil livré rend exactement **5** entrées.
2. **Elle mord, au site du défaut.** Mutation reproduite — groupe de routes `app/blog/(index)/` avec son `loading.tsx`, plus les quatre écritures collatérales — : **1 rouge sur 5**, `blog index /blog`, attendu 404, reçu 200. Et le trio vert est confirmé dans ses deux moitiés : `tests/blog.test.ts` **16/16 vert**, `e2e/blog.spec.ts` **5/5 vert** (`:132` compris), balayage de routes de la recette **vert**, suite vitest du clone **verte**. C'est le trou que la garde existe pour fermer, et c'est la seule chose qui rougit.
3. **L'assertion porte sur un statut HTTP réel** — `request.get(href)` puis `response.status()`, contre le serveur démarré. C'est précisément pourquoi elle attrape ce que `tests/blog.test.ts` ne peut pas voir : la mutation prouve que la fonction de page rend toujours `notFound()` pendant que la frontière écrit 200 devant elle.
4. **Le contrôle positif est réel** : 6 entrées de modules activés, aucune en 404. L'assertion est `served.length > 0`, donc sa force est « le montage est vivant », pas « les six répondent ».

## Les quatre sites de la phrase fausse

Corrigés. `grep -rn outputFileTracing` hors `node_modules` rend exactement les quatre attendus, et le compte a été remplacé par des sites **nommés**. L'artefact vérifié par le relecteur : `.next/standalone/content/blog/` porte les 5 `.mdx` (3 fr, 2 en). Le message de commit ne dit plus qu'une frontière de segment couvre ses enfants.

## Constats du troisième tour — tous mineurs

- **M1 — `packages/ui/AGENTS.md` écrit « pris en défaut deux fois » alors que c'est déjà trois**, dans l'édition même qui corrige un mauvais compte : `packages/ui/src/composed/` porte onze fichiers, la ligne en liste dix, et `InlineStyleNonce` (exporté depuis s45) manque à la fois de la ligne **et** de `docs/design-system.md`. Le mode d'échec de R2-1, reproduit un fichier plus loin.
- **M2 — `Avatar` reste mal rangé, et la liste dit toujours quelque chose de faux.** Le paragraphe en dessous explique honnêtement que la dérive est antérieure à s29 ; la liste, elle, continue d'écrire qu'`Avatar` « n'est pas encore copié » alors que le fichier existe.
- **M3 — la dérivation d'URL de la nouvelle garde préfixe les chemins d'API d'une locale.** `localeRouting.publicPath` préfixe sans condition, `/api…` compris, là où `apps/web/proxy.ts` ne le fait jamais. Inatteignable dans le profil livré ; motif hérité du cas de navigation préexistant.
- **M4 — `docs/design-system.md` § États ne nomme qu'une des deux gardes.** Sa généralisation est correcte et c'est le seul site qui n'a jamais porté le mécanisme réfuté — mais il cite `e2e/blog.spec.ts:132` seul, qui est exactement la garde que le groupe de routes contourne. s30 et s31 lisent ce document en premier.
- **M5 — la liste d'intermittents de s52 nomme un cas sur deux.** Voir le rouge du socle ci-dessus.

## Ce que le troisième tour n'a pas vérifié

Aucun rendu navigateur — la preuve de présentation appartient aux tours 1 et 2. `/blog/<slug inconnu>` **en HTTP dans la configuration coupée** : aucun cas ne le demande, il n'est couvert qu'au niveau de la fonction de page, et la mutation vient de prouver ce niveau aveugle aux frontières. La ligne 2 du tableau des trois placements. Tout ce qui est tiers.

**Et un manquement de procédure à écrire** : `docs/reviews/s29-blog-mdx.md` est apparu en cours d'exécution dans le worktree, écrit par le contexte principal pendant que le relecteur mesurait. `AGENTS.md` pose « un agent, un répertoire de travail » ; la règle a été enfreinte, et les mesures de ce tour ont été prises sous un arbre qui bougeait. Aucune d'elles ne porte sur les fichiers touchés, mais le fait doit être écrit.

Max severity: minor
Ship allowed: yes
