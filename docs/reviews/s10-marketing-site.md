# Revue — s10-marketing-site

Branche `feature/s10-marketing-site`, commit unique `aa90610`, 52 fichiers.
Worktree `/Users/olivier/www/boilerplate/.claude/worktrees/agent-a2941357b5b24c199`, base `s10`.
Diff jugé : `git diff dev...feature/s10-marketing-site`.

Ce qui suit est ce que **cette revue** a balayé — jamais « tout ce qui existe ».
Les listes sont datées et les cas nommés.

## 1. Les six commandes, exécutées ici

Aucun résultat repris d'un résumé. Chaque ligne a été lancée dans ce worktree.

| Commande | `marketing` activé | `marketing` coupé (`pnpm ks toggle marketing`) |
|---|---|---|
| `pnpm typecheck` | 0 | 0 |
| `pnpm lint --max-warnings=0` | 0 | 0 |
| `pnpm test` | 729 passés, 2 ignorés, 28 fichiers | 729 passés, 2 ignorés |
| `pnpm test:e2e` | 34 passés, 2 ignorés | 32 passés, 4 ignorés |
| `pnpm build` | 0 | 0 |
| `pnpm run audit` | 0 (« 1 avis, aucun au seuil élevé qui ne soit couvert ») | 0 |

Troisième configuration, non demandée mais sur un chemin que s10 touche
(`localeRouting.publicPath` alimente le pied de page, le plan de site et le
`robots.txt`) : **`i18n` coupé, `marketing` activé** — `pnpm test`, `pnpm build`
et `pnpm test:e2e` verts. État restauré.

Après chaque bascule, `git diff --exit-code` propre et `pnpm ks list` remis à
l'état d'origine (`auth`, `i18n`, `marketing`, `demo-enabled` activés).

**Réserve de mesure sur les parcours.** `playwright.config.ts` porte
`reuseExistingServer: true` et le port 3100 est partagé entre worktrees : un
vert peut être obtenu contre l'arbre d'une autre branche sans que rien ne le
dise. Les deux exécutions retenues ci-dessus (activé / coupé) ont été relancées
après avoir vérifié `lsof -i :3100` vide avant et après. C'est un défaut du
harnais, **antérieur à s10 et hors de son diff** ; il est signalé ici parce
qu'il rend un vert local indistinguable d'une absence de mesure.

## 2. Références vérifiées dans le code cible

Ouvertes une à une, nom et emplacement exacts (liste de ce qui a été vérifié,
16 entrées) :

- `defineModule` et ses **quatorze** clés — `packages/core/src/module.ts:275-318`.
  Le contrat du module les déclare toutes ; aucune omise.
- `NavigationEntry.protection` est **lu** : `satisfiesProtection` /
  `visibleNavigation`, `packages/core/src/protection.ts:18-48`. Mutation faite
  (§4, L9) : la clé n'est pas décorative, contrairement au cas de s03.
- `qualifyMessageKey` — `packages/core/src/registry.ts:65`, réexporté
  `packages/core/src/index.ts:27`.
- `singleLocaleRouting` / `LocaleRouting.publicPath` — `packages/core/src/i18n.ts:127,162` ;
  `localePrefixRouting` — `packages/modules/i18n/src/application/locale-routing.ts:64`.
- `MetadataRoute.Sitemap` / `MetadataRoute.Robots`, `alternates.languages`,
  `rules.{userAgent,allow,disallow}`, `sitemap` — présents dans le paquet
  installé, et **servis** : `/sitemap.xml` et `/robots.txt` interrogés au
  navigateur, dans les deux états.
- `redirect` / `notFound` de `next/navigation` : signalent bien par un `digest`
  (`NEXT_REDIRECT;replace;/fr/sign-in;307;` observé).
- `getEnv().APP_URL` optionnelle au schéma, exigée par `resolveSiteUrl`
  (`apps/web/lib/site-url.ts:20`), sur le modèle de `lib/auth-config.ts`.
- Frontières de couches : `presentation → application|domain` est **autorisé**
  (`tooling/eslint/boundaries.ts:60-65`) ; `zod` admis dans `domain`
  (`domainForbiddenSources`, même fichier). `pnpm lint` vert.
- `Accordion` et `MarketingSection` sont **dans** l'inventaire de
  `docs/design-system.md` (lignes 124 et 144). Le token `display` = `text-5xl`,
  `h2` = `text-2xl`, `body-lg` = `text-base` : la correspondance est écrite
  dans `packages/ui/src/styles.css:106-108`, et le code la respecte.
- `@radix-ui/react-accordion@1.2.20` ajouté à `packages/ui` seul, et nommé dans
  `packages/ui/AGENTS.md` (ADR 022 respecté).
- `generated/schema/marketing.ts` : baril vide, régénéré à l'identique par
  `pnpm ks toggle` (arbre propre après aller-retour).

Aucune API inventée trouvée sur ces 16 points.

## 3. Diff contre plan, tâche par tâche

Les treize tâches du plan sont présentes dans le diff. Trois écarts, tous dans
le sens « le diff en fait plus que le plan » :

1. **Second point d'entrée `@repo/module-marketing/presentation`** (hors plan).
   La justification a été **reproduite**, pas crue : en réexportant
   `./presentation/marketing-home` depuis le barril principal,
   `pnpm exec turbo run typecheck --force` donne
   `@repo/db:typecheck: ../modules/marketing/src/index.ts(54,31): error TS6142:
   … but '--jsx' is not set.` La contrainte est réelle, le remède est le bon, et
   il est **exécutable** (c'est `pnpm typecheck` qui rougit si un module
   réexporte du JSX depuis son barril). Documenté à trois endroits
   (`src/index.ts`, `src/presentation/index.ts`, `apps/web/AGENTS.md`). Accepté.
2. `packages/ui/AGENTS.md` ajoute aussi `LocaleSwitcher` au tableau des composés
   maison — correction d'un oubli de s09, hors périmètre de s10, sans effet.
3. `apps/web/package.json` gagne `zod` (validation du segment `[document]`),
   avec la règle correspondante ajoutée à `apps/web/AGENTS.md`. Cohérent.

Les interdits de course ont tenu : `app-shell.tsx`, `layout.tsx`,
`lib/navigation.ts`, `packages/core/**`, `packages/db/**`, `packages/cli/**`,
`tooling/**`, `eslint.config.ts`, les écrans d'authentification et
`docs/STATE.md` sont **absents** du diff. Aucune migration, aucune table.
Aucun `if (module === 'marketing')` hors de `apps/web/lib/marketing.ts`.

**Point de contact inter-voies, à dire explicitement :** `e2e/auth.spec.ts` est
modifié (une ligne, `urlOf('/')` → `urlOf(anonymousLanding())`). Ce fichier est
dans le périmètre de la voie **s12-oauth-signin**. L'attente est *dérivée* et
non relâchée — c'est le bon geste —, mais le fichier sera en conflit si s12 y
touche. À arbitrer au merge, pas ici.

## 4. Mutations — ce qui a été neutralisé, et ce qui a rougi

Toutes appliquées puis restaurées immédiatement ; `git diff --exit-code` propre
vérifié après chacune, et l'arbre est propre à l'écriture de ce rapport.

| # | Neutralisation | Rouge |
|---|---|---|
| A | `apps/web/app/page.tsx` : `sections.length === 0` → `>= 0` (la racine redirige toujours) | **1** (`tests/marketing.test.ts` — sert l'accueil public) |
| B | `legalDocumentOf` rend `legalDocuments[0]` sans regarder le slug | **2** (module + câblage) |
| C | `marketingRobotsPolicy` : `disallow: []` | **2** vitest + **1** e2e |
| D | `assertCoherent` rendue inerte | **8** |
| E | `internalPath` : regex → `/.*/ ` (une action peut sortir du site) | **1** |
| F | `sectionKeys` : suppression des clés d'éléments | **3** |
| G | `apps/web/app/globals.css` : suppression du `@source` des modules | **1** (`tests/design-system.test.ts`) |
| H | **une vraie requête SQL ajoutée au rendu de `/`** (`pool.query('select 1')`) | **0** — voir F3 |
| I | `navigation.protection` : `public` → `authenticated` | 0 vitest, **1** e2e |
| J | `MarketingSection` : `headingLevel` ignoré, toujours `h2` | 0 vitest, **1** e2e |
| K | chaîne française en dur (`aria-label`) dans `marketing-home.tsx` | **2** |
| L | `apps/web/lib/marketing.ts` : gate du registre supprimée, **module coupé** | **2** |

Onze mutations sur douze font rougir quelque chose. La douzième (H) est un
constat, et deux autres (A, I/J) montrent des filets plus étroits que leur nom.

## 5. Constats

### F1 — majeur — `robots.txt` ouvre tout le site sous le préfixe de langue

Fichier réellement servi, `marketing` activé, `i18n` activé :

```
User-Agent: *
Allow: /fr
Allow: /en
Allow: /fr/legal/privacy
…
Disallow: /
```

En robots.txt, la correspondance est **par préfixe**, et la règle la plus longue
l'emporte (RFC 9309 §2.2.2). `Allow: /fr` couvre donc `/fr/account`,
`/fr/sign-in`, `/fr/reset-password?token=…` — c'est-à-dire **toute
l'application**, et il bat `Disallow: /`. `i18n` coupé, `publicPaths` commence
par `/` et le fichier porterait `Allow: /` : même conséquence, en pire.

C'est l'inverse exact de ce que le code annonce
(`packages/modules/marketing/src/domain/seo.ts:54-66`, « interdire d'abord,
autoriser ensuite ce qui est public », avec renvoi à `docs/security.md` §7) et
de ce que le module déclare dans son `AGENTS.md`.

Les deux tests qui portent ce nom ne le tiennent pas :

- `packages/modules/marketing/src/application/marketing-site.test.ts:231`
  s'appelle « n'autorise que les chemins publics » et **affirme**
  `allow: ['/', '/en', '/legal/privacy']` — le défaut est inscrit dans
  l'attente ;
- `e2e/marketing.spec.ts:76` vérifie `not.toContain('Allow: /account')`, vrai
  par construction puisque `/account` n'est jamais dans la liste : l'assertion
  ne peut pas voir que `/fr/account` est autorisé par préfixe.

Ce n'est pas un contrôle d'accès (les écrans refusent côté serveur) et
`docs/security.md` §7 ne parle pas de `robots.txt` : d'où **majeur** et non
critique. Mais le critère 3 de la story dit « listent les pages publiques », et
le fichier livré en autorise beaucoup d'autres.

### F2 — majeur — le `canonical` des pages légales désigne une URL qui redirige, identique en fr et en en

Servi tel quel :

- `GET /fr/legal/privacy` → `<link rel="canonical" href="/legal/privacy"/>`
- `GET /en/legal/privacy` → `<link rel="canonical" href="/legal/privacy"/>`
- `GET /legal/privacy` → **307** vers `/fr/legal/privacy` (ou `/en/…` selon
  `Accept-Language`)

Trois conséquences, toutes mesurées ci-dessus :

1. la version anglaise déclare comme canonique une URL qui, pour un robot en
   négociation par défaut, sert la version **française** ;
2. les deux variantes de langue déclarent la **même** canonique, ce qui les
   fusionne pour un moteur — alors que le `sitemap.xml` les déclare
   explicitement comme alternates `hreflang` distinctes ;
3. la canonique contredit le `<loc>` du plan de site
   (`http://…/fr/legal/privacy`).

L'origine est `apps/web/app/legal/[document]/page.tsx:59` :
`alternates: { canonical: legalPath(document.slug) }` — un chemin **interne**,
là où tout le reste du fichier passe par `path()` / `localeRouting.publicPath`.
Aucun test, unitaire ou navigateur, n'observe la balise `canonical`.

C'est exactement la classe « valeur qui a l'air juste » : `legalPath` existe,
est correctement importé, et rend la mauvaise valeur à cet endroit précis.

### F3 — majeur — « aucune requête base de données au rendu » n'est tenu par aucune commande

Le critère 4 de la story est **vrai dans les faits** : compteur posé sur
`pg_stat_database` de la base `s10`, trois `GET /` et trois
`GET /fr/legal/privacy` anonymes, `xact_commit+xact_rollback` et `tup_returned`
**inchangés** (16433 / 1024072 avant et après). Rien à corriger côté production.

Le filet, lui, n'existe pas. `tests/marketing.test.ts:471-516` ouvre un
`describe` nommé **« le rendu d'une page publique »**, mais ne rend aucune page :
il appelle deux fois `auth.resolveSession()`. Mutation H : ajout d'un vrai
`createDatabaseClient(...).pool.query('select 1')` dans
`apps/web/app/page.tsx`, sur le chemin de rendu du visiteur anonyme →
**729 tests verts, zéro rouge**.

Trois documents affirment le contraire, et c'est ce qui en fait un constat
plutôt qu'une lacune :

- `apps/web/AGENTS.md` : « Ajouter une lecture de base à l'accueil ou au shell
  fait rougir cette mesure. » — faux, démontré ;
- `apps/web/app/page.tsx:29-30` : « `tests/marketing.test.ts` compte les
  requêtes réellement émises pendant ce rendu » — il ne rend rien ;
- `packages/modules/marketing/AGENTS.md`, section Tests : « la mesure "aucune
  requête base de données" ».

Le plan, lui, est honnête (« compteur sur le pool pendant une **résolution de
session** anonyme »). C'est la documentation qui a élargi la portée.

ADR 013 pose qu'une règle sans commande est de la documentation. J'ai hésité à
classer critique au titre du socle « dépôt orienté agent » ; j'ai retenu
**majeur** parce que le comportement livré est correct et vérifié, et que le
défaut porte sur la promesse faite au prochain agent. **Point d'arbitrage
propriétaire** si vous jugez qu'une fausse affirmation dans un `AGENTS.md` vaut
critique dans ce dépôt.

### F4 — majeur — `tests/rendered-text.test.ts` a été relâché, pas dérivé

`tests/rendered-text.test.ts:471-481` avale désormais **toute** exception à
`digest` (`redirect`, `notFound`) pour **les onze écrans** de la liste, et passe
au suivant. Le plancher qui est censé compenser est resté à
`expect(markers).toBeGreaterThan(60)` — mesuré : la suite en produit **331** en
configuration livrée. Il y a donc un facteur cinq de mou.

Conséquence observée, mutation A : quand la racine redirige systématiquement,
`tests/rendered-text.test.ts` **reste vert**. Avant s10, une redirection
inattendue dans n'importe quel écran faisait rougir ce fichier ; ce n'est plus
le cas pour aucun des onze.

Le besoin est légitime (la suite doit passer module coupé), mais la forme
dérivée existait et n'a pas été prise : l'ensemble des écrans qui refusent de
rendre est **prédictible** depuis `marketingSite.sections.length`, exactement
comme `anonymousLanding()` le fait pour les parcours. Le plan interdisait
explicitement d'assouplir un test existant (« Run interdicts », dernier tiret
de la liste des tests) ; c'est ce qui a été fait.

### F5 — mineur — les métadonnées de `/` ignorent le visiteur

`generateMetadata` de `apps/web/app/page.tsx` ne consulte pas `currentViewer()`.
Un utilisateur **connecté**, qui reçoit le tableau de bord, reçoit aussi
`<title>Un socle SaaS dont on coupe ce qu'on n'utilise pas</title>`, la
description marketing et les `og:*` de l'accueil public. La page a trois
lecteurs et une seule tête. Aucun test ne l'observe.

### F6 — mineur — `affiche les sections dans l'ordre de la configuration` est vide quand le rendu échoue

`tests/marketing.test.ts:286-302` : si aucun marqueur n'est trouvé,
`positionsOf` rend `[-1,-1,-1,-1,-1]`, qui est à la fois trié croissant et
décroissant — les deux assertions passent. Vérifié : ce cas est resté vert sous
la mutation A. Le test ne ment que sur lui-même (un autre cas attrape A), mais
il n'a pas de garde contre l'inertie là où le reste du fichier en a partout.

### F7 — mineur — ce que la nouvelle règle `@source` laisse encore passer

`tests/design-system.test.ts` mord (mutation G, 1 rouge) et c'est la bonne
règle. Trouvé jusqu'ici, sur ces **quatre** cas examinés :

1. le balayage ne parcourt que les fichiers `.tsx` ; une classe posée dans un
   `.ts` (variantes `cva`, table de classes) échapperait à la règle **et** au
   `@source '…/presentation/**/*.tsx'`. Balayage fait sur `packages`, `apps`,
   `config` : **zéro** `.ts` contenant `className` ou `cva(` aujourd'hui ;
2. une classe composée dynamiquement (`` `md:grid-cols-${n}` ``) n'est générée
   par Tailwind dans aucun cas — la règle ne peut pas le voir ;
3. `IGNORED_DIRECTORIES` contient `fixtures` : un composant réel logé dans un
   dossier de ce nom serait sauté ;
4. seules deux feuilles sont lues (`packages/ui/src/styles.css`,
   `apps/web/app/globals.css`) ; une troisième ailleurs ne serait pas prise en
   compte.

Aucun de ces quatre n'est présent aujourd'hui. C'est ce qui a été balayé, pas la
liste de ce qui existe.

### F8 — mineur — des témoignages inventés livrés sans le dire

`packages/modules/marketing/src/messages/{fr,en}.json` livre deux témoignages
attribués (« Développeuse indépendante », « Directeur technique, SaaS B2B ») avec
des citations. Les pages légales, elles, portent « Modèle à adapter avant toute
mise en ligne » **dans leur corps** — et le module s'en fait une règle dans son
`AGENTS.md`. Les témoignages n'ont pas cette marque, alors que le tableau de
bord justifie son état vide par « il n'affiche rien d'inventé ». Un propriétaire
qui déploie tel quel publie de faux avis clients.

### F9 — mineur — le piège « rester statique » de la story n'est traité nulle part

`docs/stories.md`, notes de s10 : « Piège : les pages marketing doivent rester
statiques et rapides. » Sortie de `pnpm build` : `ƒ /`, `ƒ /legal/[document]`,
`ƒ /sitemap.xml`, `ƒ /robots.txt` — **tout est rendu à la demande**. La
recherche (Q2) tranche la question de la base de données et assume le maintien
de l'`AppShell`, mais ni la recherche ni le plan ne disent que le piège
« statique » est écarté et pourquoi. Ce n'est pas un critère d'acceptation ; ça
reste une note de story laissée sans réponse.

## 6. Ce que j'ai vérifié et qui tient

- **Module coupé, aucune trace — par exécution, pas par lecture.** Serveur
  démarré depuis ce worktree, `marketing` coupé : `robots.txt` réduit à
  `User-Agent: * / Disallow: /` sans annonce de plan de site ; `sitemap.xml`
  = `<urlset>` vide ; `GET /` → 307 → `/fr/sign-in` (200) ; `GET
  /fr/legal/privacy` → **404** ; zéro occurrence du libellé « Accueil » dans la
  navigation servie sur `/fr/sign-in`.
- **Aucune migration sur une base vierge** : base `s10_review` créée à neuf,
  `pnpm db:migrate` → « auth (1), demo-enabled (1) », tables présentes :
  `auth_account`, `auth_session`, `auth_user`, `auth_verification`,
  `demo_items`. Aucune table `marketing`. Base supprimée après mesure. La base
  `app` n'a pas été touchée.
- **Les six clés `app.dashboard.anonymous.*`** : retirées des deux catalogues, et
  la branche qu'elles servaient a bien disparu de `apps/web/app/page.tsx`.
  Recherche dans tout le dépôt (`*.ts`, `*.tsx`, `*.json`, `*.md`) : plus aucune
  demande, seules trois mentions documentaires subsistent (recherche s10, plan
  s10, revue s09).
- **Le contrat de module est complet et non décoratif** : quatorze clés,
  `protection` réellement lue (mutation I → e2e rouge), catalogues `fr`/`en`
  symétriques (garde de `tests/i18n.test.ts` sur l'annuaire complet).
- **Zod à la frontière** : la configuration (`parseMarketingConfiguration`, huit
  refus nommés, mutation D → 8 rouges) et le segment `[document]`
  (`z.string().regex(/^[a-z][a-z0-9-]*$/)`). Aucun `dangerouslySetInnerHTML`.
- **Pas de redirection ouverte** : la destination de `/` est une constante du
  code ; les `href` d'action sont contraints à un chemin interne, `//evil.test`
  compris (mutation E → 1 rouge).
- **Aucune ressource tierce** sur les pages publiques : aucun `src`/`href` vers
  un domaine externe dans le HTML servi de `/fr`.
- **Les quatre fichiers de parcours adaptés** : `e2e/auth.spec.ts` et
  `e2e/i18n.spec.ts` (×2 attentes) dérivent bien de `anonymousLanding()` /
  `marketingSite`, `tests/fixtures/pseudo-locale.ts` gagne un paramètre de
  registre sans rien retirer, `tests/rendered-text.test.ts` — voir F4. Le
  `.first()` ajouté sur « Create an account » est une dérivation acceptable :
  la moitié qui mord (`Créer un compte` à zéro occurrence) est intacte.

## 7. Ce que je n'ai pas pu vérifier

- **Le rendu visuel.** Aucune capture n'a été reprise ni refaite : je n'ai pas
  ouvert de navigateur en clair/sombre à 1280 px et 380 px. La trace de
  `docs/designs/s10-marketing-site.md` (cinq lignes, « débordement horizontal
  0 px ») est une déclaration de l'implémenteur que je n'ai pas contre-mesurée.
  **Geste humain attendu** : ouvrir `/` et `/legal/privacy`, thème clair et
  sombre, 1280 px puis 380 px, et vérifier que la grille de fonctionnalités est
  bien sur trois colonnes et qu'il n'y a qu'un filet au-dessus du pied de page.
- **Le contraste des couleurs** : aucune vérification automatique dans le dépôt,
  aucune faite ici.
- **Le comportement réel d'un moteur d'indexation** sur le `robots.txt` livré :
  F1 s'appuie sur la RFC 9309 et sur le fichier servi, pas sur un test avec le
  robot de Google. **Geste humain attendu** : passer le `robots.txt` de la
  préproduction dans le testeur robots.txt de la Search Console.
- **Le rendu des `og:*` par un consommateur réel** (aperçu de lien
  Slack/LinkedIn/X) : les balises sont présentes dans le HTML, personne ne les a
  consommées. Il n'y a ni `og:image` ni `og:url` — à décider si c'est voulu.
- **La page en production derrière une CSP** : le dépôt n'a toujours pas
  d'en-têtes de sécurité (manque antérieur, correctement déclaré par le plan).
  L'`Accordion` Radix pose des attributs `style` en ligne ; quand la story CSP
  arrivera, `style-src` devra être arbitré. Rien à corriger ici, à ne pas
  oublier là-bas.
- **Un utilisateur connecté au navigateur sur `/`** : F5 est établi par lecture
  du code (`generateMetadata` n'a pas accès au viewer), pas par une session
  ouverte dans Playwright.
- **Les combinaisons de modules au-delà des trois essayées** : activé, coupé, et
  `i18n` coupé avec `marketing` activé. `marketing` **et** `i18n` coupés
  ensemble n'a pas été essayé.

## Verdict

Aucun critique : rien dans ce diff ne casse un comportement existant, n'ouvre un
accès, n'invente une API ni ne contredit un ADR accepté. Les six critères
d'acceptation sont satisfaits, le module coupé ne laisse aucune trace — vérifié
par exécution — et le socle du dépôt (Zod aux frontières, aucun texte en dur,
aucune couleur brute, aucun `if (module)`, Radix confiné, aucune migration) est
tenu.

Quatre constats majeurs restent, et ils ont un air de famille : trois fois sur
quatre, ce qui est faux n'est pas le code mais **ce que le code affirme de
lui-même** — un `robots.txt` qui dit interdire et autorise, une mesure de base
de données annoncée dans trois documents et absente de la suite, un filet
existant élargi pendant qu'on écrit qu'on ne l'a pas élargi. Le quatrième (le
`canonical`) est un vrai défaut fonctionnel, silencieux et non testé.


## 8. Clôture — ce qui a été corrigé, et par quelle mutation c'est prouvé

Tour de correction exécuté dans le **même** worktree, sur la même branche, base
`s10`. Chaque mutation ci-dessous a été appliquée puis restaurée immédiatement ;
`git diff` vérifié vide après chacune. Avant chaque `pnpm test:e2e`,
`lsof -i :3100` vérifié vide.

### Constat par constat

- **F1 — `robots.txt` autorisait par préfixe → fermé.** `marketingRobotsPolicy`
  n'écrit plus le chemin public tel quel mais son motif **ancré**
  (`Allow: /fr$`), le `$` étant l'un des deux caractères spéciaux que RFC 9309
  §2.2.3 impose aux robots. Le fichier servi a été relu :
  `Allow: /fr$ /en$ /fr/legal/privacy$ …` puis `Disallow: /`. Surtout, la
  politique n'est plus jugée sur sa forme : `robotsAllows` (domaine du module)
  implémente la lecture de RFC 9309 §2.2.2 — motif le plus long, autorisation
  gagnante à égalité, autorisé par défaut —, et
  `tests/marketing.test.ts` confronte la politique à **chaque `page.tsx` du
  disque**, dans chaque langue, segments dynamiques développés et
  `?token=…` compris. Les deux tests qui inscrivaient le défaut dans leur
  attente ont été réécrits (unitaire et parcours).
- **F2 — `canonical` faux → fermé.** `alternates.canonical` passe désormais par
  `path()`, comme tout le reste du fichier. Servi et vérifié au navigateur :
  `/fr/legal/privacy` → `href="/fr/legal/privacy"`, `/en/legal/privacy` →
  `href="/en/legal/privacy"`. Le test dérive l'attente de `localeRouting` et
  exige en plus **autant de canoniques distinctes que de langues servies**.
- **F3 — la promesse « aucune requête base de données » → fermée par le
  comportement.** Le cas qui portait ce nom rend maintenant réellement les pages
  publiques (accueil, redirection du site coupé, page légale) **et** exécute
  l'`AppShell`, avec un compteur posé sur les **prototypes** de `pg` — atteints
  par le client du dépôt, donc toute connexion ouverte par n'importe quel
  fichier du processus est comptée, `vi.resetModules()` compris (garde interne
  qui le prouve à chaque exécution). Le cas de résolution de session subsiste,
  renommé pour ce qu'il mesure. Les trois documents qui affirmaient la propriété
  disent maintenant ce qui est mesuré, et ce qui ne l'est pas.
- **F4 — filet de `tests/rendered-text.test.ts` relâché → fermé.** Le `catch`
  générique a disparu : chaque écran déclare le refus qu'on attend de lui
  (`null`, `NEXT_REDIRECT`, `NEXT_HTTP_ERROR_FALLBACK;404`), **dérivé** de
  `marketingSite`. Un refus inattendu rougit, un refus attendu du mauvais type
  aussi. Le plancher de marqueurs n'est plus une constante : il vaut
  `écrans réellement rendus × 20`, et chaque écran doit franchir ce plancher
  **pour son propre compte** — mesure faite, l'écran le plus pauvre en produit
  30, la suite 331.
- **F8 — témoignages inventés → fermé.** Les quatre corps (fr, en) portent
  « Modèle à adapter avant toute mise en ligne : ce témoignage est fictif. » et
  la description de section annonce des exemples de mise en page. La règle est
  exécutable et **dérivée de la configuration** : sections légales et éléments
  d'une section de nature `testimonials` doivent porter la marque de leur langue.
  Vérification visuelle refaite : 1280 px clair et 380 px sombre, débordement
  horizontal 0 px dans les deux cas.
- **Second point d'entrée → ADR 024** (`docs/decisions/024-point-d-entree-presentation-des-modules.md`),
  numéro vérifié libre (023 appartient à la voie s12). La contrainte a été
  **reproduite une troisième fois** en écrivant l'ADR :
  `@repo/db:typecheck: … error TS6142 … '--jsx' is not set`. La règle est
  répercutée dans `AGENTS.md` racine (contrat de module) et dans
  `packages/modules/marketing/AGENTS.md`.

### Mutations de ce tour

| Neutralisation | Rouge |
|---|---|
| `marketingRobotsPolicy` : motif non ancré (`/fr` au lieu de `/fr$`) | **3** vitest (2 au domaine, 1 au câblage) + **1** e2e |
| `canonical: legalPath(slug)` — chemin interne, commun aux deux langues | **1** vitest |
| **mutation H de la revue, à l'identique** : `createDatabaseClient(…).pool.query('select 1')` dans `app/page.tsx` | **2** vitest (`tests/marketing.test.ts`, `tests/rendered-text.test.ts`) — **0** avant ce tour |
| même lecture posée dans `app/app-shell.tsx` | **1** vitest |
| **mutation A de la revue** : `sections.length === 0` → `>= 0` | **2** vitest — **1** avant ce tour |
| marque « Modèle à adapter » retirée d'un témoignage `fr` | **1** vitest |

Six mutations, six rouges. Deux d'entre elles étaient vertes ou trop étroites
avant ce tour : c'est ce que la revue reprochait, et c'est ce qui a changé.

**Défaut trouvé pendant la correction, par l'exécution :** la première version
du contrôle de parcours comparait une ligne mise en minuscules à un préfixe
capitalisé (`'Allow:'`) — elle ne lisait donc aucune directive et concluait
« autorisé par défaut ». `pnpm test:e2e` l'a fait rougir. Une garde d'inertie a
été ajoutée : l'analyse doit retrouver `Disallow: /`.

### Les six commandes, réexécutées après correction

| Commande | `marketing` activé | `marketing` coupé |
|---|---|---|
| `pnpm typecheck` | 0 | 0 |
| `pnpm lint --max-warnings=0` | 0 | 0 |
| `pnpm test` | 734 passés, 2 ignorés | 734 passés, 2 ignorés |
| `pnpm test:e2e` | 34 passés, 2 ignorés | 32 passés, 4 ignorés |
| `pnpm build` | 0 | 0 |
| `pnpm run audit` | 0 (« 1 avis, aucun au seuil élevé qui ne soit couvert ») | 0 |

Module réactivé ensuite, `pnpm ks list` conforme à l'état d'origine et arbre
vérifié propre (aucun baril généré ne diffère).

### Ce qui reste ouvert

- **F5, F6, F7, F9** — les quatre mineurs, non traités : arbitrage du
  propriétaire, ils ne sont pas dans ce tour.
- **`playwright.config.ts` (`reuseExistingServer`)** — défaut de harnais
  antérieur à s10, laissé tel quel pour ne pas fabriquer un conflit avec la voie
  s12 ; à traiter sur `dev` après fusion.
- **`e2e/auth.spec.ts`** — laissé tel quel, conflit à arbitrer au merge.
- **Les gestes humains attendus** du §7 restent attendus, à une exception près :
  le rendu visuel de la section des témoignages a été recontrôlé ici (deux
  points de mesure : 1280 px clair, 380 px sombre). Le reste du §7 est inchangé.

Max severity: minor
Ship allowed: yes
