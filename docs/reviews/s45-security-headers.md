# Revue — s45-security-headers

> Branche `feature/s45-security-headers`, commit unique `fed2909`, 19 fichiers.
> Diff jugé : `git diff dev...feature/s45-security-headers`. Base `dev` à
> `df3bb2f` — `dev` a depuis reçu s12, s15 et s10 ; ce que la fusion exposera est
> traité en fin de rapport.
>
> Référentiels opposés au diff : `docs/stories.md` § `s45-security-headers`,
> `docs/security.md` **§1** (dont cette story est la première implémentation),
> §4, §5, §6 ; `docs/reliability.md` §2 et §5 ; ADR 012, ADR 013, ADR 014 ;
> `AGENTS.md` racine, `apps/web/AGENTS.md`, `packages/ui/AGENTS.md` ; le plan
> `docs/plans/s45-security-headers.md` et la recherche
> `docs/research/s45-security-headers.md`.

## 1. Ce qui a été exécuté, et non pris sur parole

| Commande | Résultat |
|---|---|
| `pnpm test` | 757 passés, 2 ignorés, 29 fichiers — vert |
| `pnpm typecheck` | vert (15 tâches) |
| `pnpm lint` | `No issues found` |
| `pnpm build` | vert, 15 routes, toutes `ƒ (Dynamic)` — aucune route prérendue, le coût du nonce est déjà payé |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert |
| `E2E_PORT=3145 pnpm test:e2e` | 40 passés, 2 ignorés — **sur 6 exécutions sur 7** (voir §6) |
| `next start` + Chromium | vérification navigateur refaite, §4 |

## 2. Le tableau des mutations

Chaque invariant revendiqué a été neutralisé, mesuré, puis **restauré aussitôt**,
`git diff --exit-code` propre après chacune.

| # | Neutralisation | Fichier | Rouges |
|---|---|---|---|
| M1 | `'unsafe-inline'` forcé dans `script-src` dans les deux modes | `apps/web/lib/security-headers.ts` | **3** (vitest) |
| M2 | `'unsafe-inline'` introduit par le chemin détourné de la configuration (`style: ["'unsafe-inline'"]`) | `config/security.ts` | **3** (vitest) |
| M3 | `https://cdn.evil.test` écrit en dur dans `img-src` du constructeur | `apps/web/lib/security-headers.ts` | **1** (vitest) |
| M4 | câblage des en-têtes de **requête** supprimé (politique + `x-nonce`) | `apps/web/proxy.ts` | **1** (vitest) / **0** (e2e) |
| M5 | `x-nonce` de requête remplacé par une constante fausse | `apps/web/proxy.ts` | **0** (e2e, 6/6 verts) |
| M6 | le layout donne un faux nonce aux bibliothèques | `apps/web/app/layout.tsx` | **2** (e2e) |
| M7 | `<InlineStyleNonce>` retiré du layout | `apps/web/app/layout.tsx` | **1** (e2e) |
| M8 | propriété `nonce` retirée de `ThemeProvider` | `apps/web/app/layout.tsx` | **2** (e2e) |
| M9 | neutralisation des variables Radix retirée | `packages/ui/src/components/accordion.tsx` | **2** (vitest) |
| M10 | `enabled()` → `true` (collecteur ouvert en production) | `apps/web/app/api/csp-report/route.ts` | **1** (vitest) |
| M11 | `carriesLocalePrefix` → `true` | `apps/web/proxy.ts` | **1** (vitest complet, 1/759) |

**Le critère central mord.** M1 et M2 rougissent tous deux le cas
`ne porte, sous NODE_ENV=production, aucun mot-clé permissif`, qui lit
l'en-tête **réellement rendu par `proxy()`** et non le texte d'un fichier. La
politique est découpée directive par directive, pas cherchée au `includes` : une
reformulation ou une concaténation ne l'esquive pas. Les deux chemins détournés
demandés — déclaration en configuration, source écrite en dur dans le
constructeur — sont fermés (M2, M3). Le troisième, une variable d'environnement,
est fermé en amont : aucune lecture de `process.env` n'entre dans le diff hors
de `packages/config`, et `pnpm lint` couvre la règle.

**Le piège que l'implémenteur a trouvé est refermé.** M7 — retirer
`<InlineStyleNonce>`, exactement le câblage dont il dit que son ancienne garde
laissait « cinq parcours sur cinq au vert » — fait rougir **1** parcours, le
nouveau, celui qui mesure la cause (`tout <style> injecté porte le nonce`). Le
parcours « aucune violation » reste vert, ce qui confirme sa propre analyse : en
`next dev`, `style-src` porte `'unsafe-inline'` et aucune sanction n'est
observable. M8 (nonce retiré de `ThemeProvider`) fait rougir **2** parcours. La
garde décorative a bien été remplacée par une garde qui mord.

**M5 est le seul zéro, et il ne dénonce pas le test.** Voir constat mineur 1 :
le câblage sur les en-têtes de requête est redondant sur le runtime Node, ce
n'est pas la garde qui est aveugle. Le test unitaire, lui, mord (M4).

## 3. Constats

### Majeur 1 — la page 404 de production viole la politique livrée

Mesuré sur le **build de production** servi par `next start`, puis rejoué dans
Chromium avec et sans politique :

- `/fr/page-qui-nexiste-pas` rend **4 attributs `style="…"` et un `<style>` sans
  nonce**, émis par le composant intégré de Next (`.next-error-h1`, `body{…}`) ;
- sous la politique livrée, Chromium remonte `style-src-attr inline` et
  `style-src-elem inline` ; sans la politique, **zéro**.

`apps/web/app` ne contient ni `not-found.tsx`, ni `error.tsx`, ni
`global-error.tsx` : c'est donc ce que le produit sert sur **chaque 404 en
production** — page dénudée, console bruyante, et aucun `report-uri` en
production pour s'en apercevoir. C'est la cinquième source en ligne, celle que
le balayage de la recherche (onze réponses, aucune page introuvable) ne pouvait
pas voir. La recherche §8 prévoit explicitement ce cas et ne revendique pas
l'exhaustivité : le reproche porte sur le livrable, pas sur l'honnêteté du
relevé.

Pourquoi majeur et non critique : la politique elle-même est juste et stricte,
aucune source n'a été élargie, rien n'est exploitable, et rien ne régresse par
rapport à `dev` où il n'y avait aucune politique. Mais c'est une page qu'un
visiteur atteint, et une console bruyante est précisément ce qui pousse l'agent
suivant à ajouter `'unsafe-inline'` — le mode d'échec contre lequel l'ADR 012
met en garde.

**Balayé pour trouver cette cinquième source** — 15 réponses du build de
production (`/fr`, `/en`, les cinq écrans d'authentification, les deux documents
légaux, un document légal inconnu, une URL inexistante, `/robots.txt`,
`/sitemap.xml`, `/api/health`, `/fr/account`), comptant attributs `style`,
balises `<style>`, `<img>`, `srcset`, scripts en ligne sans nonce et hôtes
externes. Une seule réponse sur quinze en porte : la page introuvable. Aucune
`<img>`, aucun `srcset`, aucun hôte externe (le seul `https://www.w3.org`
rencontré est le `xmlns` des SVG en ligne, pas une requête). Les polices sont
servies depuis `/_next/static`, donc `'self'`. Les quatre `<form>` des écrans
d'authentification portent `method="post"` littéral et une `action`
same-origin : `form-action 'self'` tient.

### Mineur 1 — une affirmation « mesurée » que le code contredit

La recherche §1 et `apps/web/AGENTS.md` affirment que poser la politique sur la
seule réponse donne « une politique correcte **et une page cassée** », « une
application qui ne s'hydrate pas ». Mesuré sur Next 16.3.3 : M4 supprime les deux
lignes et la page reste **entièrement hydratée**, tous les scripts noncés, les
six parcours verts ; M5 falsifie le `x-nonce` de requête et rien ne bouge.

La cause est dans Next lui-même,
`node_modules/next/dist/server/lib/router-utils/resolve-routes.js` : après avoir
appliqué les surcharges `x-middleware-request-*`, il recopie **chaque en-tête de
réponse ordinaire du proxy sur `req.headers`**
(`resHeaders[key] = value; req.headers[key] = value`). Les en-têtes posés par
`withSecurityHeaders` atteignent donc le rendu de toute façon, sur ce runtime.

Je ne demande pas le retrait du câblage : il est probablement porteur sur un
runtime edge, où seul le mécanisme de surcharge existe, et le test unitaire le
protège (M4 → 1 rouge sur
`x-middleware-request-content-security-policy`). Ce qui est à corriger, c'est la
justification : un agent suivant la lira comme un fait mesuré.

### Mineur 2 — « à comportement identique » est faux sur deux formes de chemin

`carriesLocalePrefix` remplace le motif `'/((?!api|_next|favicon.ico|.*\..*).*)'`
mais ne teste le point que sur le **dernier** segment, et n'exclut plus `/_next`.
Mesuré sur `next start` :

- `/v1.2/page` → **307** vers `/fr/v1.2/page` (l'ancien motif l'excluait, un
  point n'importe où suffisait) ;
- `/_next/quelque-chose` → **307** vers `/fr/_next/quelque-chose` (l'ancien motif
  excluait tout `/_next`).

Aucune route de ce genre n'existe aujourd'hui, et `/__nextjs_original-stack-frames`
est traité par l'intergiciel de développement de Next avant le proxy (400 en
développement, pas de redirection) : **sur ces cinq sondes, aucune casse
observée**. Mais `proxy.ts`, `apps/web/AGENTS.md` et la recherche §4 affirment
tous les trois que le périmètre n'a pas bougé, et il a bougé.

### Mineur 3 — `frame-src` perd `'self'` dès qu'une source est déclarée

`directive('frame-src', sources.frame.length > 0 ? sources.frame : ["'none'"])` :
toutes les autres directives gardent `'self'` et ajoutent, celle-ci le remplace.
Le jour où s28 déclare l'iframe d'un captcha, les iframes de même origine
cessent de fonctionner. Aucun test ne couvre le cas : `reporte dans la politique
celles que la configuration déclare` n'exerce que `script` et `connect`.

### Mineur 4 — le collecteur journalise sans filtrer

`console.warn` interpole `blocked-uri` (≤ 2048), `document-uri` (≤ 2048) et
`script-sample` (≤ 512) sans retirer les retours à la ligne : injection dans le
terminal du développeur. Bornage correct par ailleurs (M10 et le cas de bornage
mordent), et la fermeture en production est vérifiée sur le serveur réel — POST
404, GET 404. **Ce n'est pas un amplificateur** : réponse 204 sans corps, rien de
réfléchi, aucun service tiers.

### Mineur 5 — dérive de signature par rapport au plan

Le plan, tâche 2, spécifie `securityHeaders({ mode, nonce, sources, reportPath })`.
L'implémentation expose `SecurityHeadersOptions` à trois champs et fait de
`CSP_REPORT_PATH` une constante de module. Sans conséquence, mais le plan est le
contrat.

### Mineur 6 — la justification du mode nomme un précédent qu'elle ne suit pas

`app/api/csp-report/route.ts` dit adopter « la même forme d'opt-in que la sonde
de s09 ». Or la sonde de s09 est un **drapeau explicite**
(`I18N_MISSING_KEY_PROBE`), tandis que cette route dérive de `NODE_ENV` — ce que
`docs/reliability.md` §2 interdit pour un port. La politique n'est pas un port,
la dérivation est argumentée dans la recherche §5, et j'ai vérifié qu'elle **ne
peut pas retomber en mode permissif** : avec `NODE_ENV=prod`, `assertStartupEnv`
appelé depuis `next.config.ts` refuse le démarrage en nommant la variable
(`Invalid option: expected one of "development"|"test"|"production"`). La
propriété tient donc ; seul le précédent invoqué est faux. Dans la même veine, le
commentaire de `getNodeEnv` affirme que le repli « ne peut pas produire une
politique plus permissive » alors que `development` est justement la plus
permissive des deux — ce qui protège, c'est la validation au démarrage, qu'il ne
mentionne pas.

## 4. La vérification navigateur, refaite

`next build` puis `next start` (port 3146), Chromium piloté, deux passes : avec
la politique servie, puis avec l'en-tête retiré à la volée comme référence.

| Mesure | Avec politique | Sans politique (référence) |
|---|---|---|
| Position du menu de thème | `x=1069 y=57` | `x=1069 y=57` |
| Hauteur du contenu d'accordéon ouvert | 40 px | 40 px |
| `body.overflow` à l'ouverture du panneau mobile | `visible` → **`hidden`** | `visible` → `hidden` |
| Violations sur le parcours normal (accueil, menu de thème, changement de thème, accordéon, panneau mobile à 380 px, `/fr/sign-in`) | **0** | 0 |
| Violations sur la page 404 | **2** (`style-src-attr`, `style-src-elem`) | 0 |

Les en-têtes réellement servis en production :
`default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'nonce-…'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`,
plus `strict-transport-security: max-age=63072000; includeSubDomains`,
`x-content-type-options: nosniff`,
`referrer-policy: strict-origin-when-cross-origin`,
`permissions-policy: camera=(), microphone=(), geolocation=()`,
`x-frame-options: DENY`. Aucun mot-clé permissif, aucun `report-uri`.

Le verrou de défilement — le comportement dont l'implémenteur dit qu'il casse
sans le nonce — **fonctionne sous la politique de production**. C'est le contrôle
qui distingue « politique stricte » de « application cassée », et il passe.

## 5. Le plan, tâche par tâche

Les neuf tâches sont faites et cochées. Rien dans le diff que le plan n'ait
demandé. `.env.example` est inchangé, comme la tâche 9 le prévoyait (aucune
variable nouvelle). La dépendance `get-nonce@1.0.1` est justifiée dans
`packages/ui/AGENTS.md` et **était déjà dans l'arbre** comme dépendance
transitive de `react-style-singleton` (3 occurrences dans le lockfile de `dev`,
même version) : la story la promeut en dépendance directe, à la version
identique, +3 lignes de lockfile. Aucun code nouveau n'entre dans la chaîne
d'approvisionnement — c'est la voie la moins coûteuse pour obtenir `setNonce`, et
`setNonce`/`getNonce` existent bien avec cette signature dans le paquet installé.
Note : si un futur `react-remove-scroll` passait à `get-nonce@2`, deux copies
coexisteraient et le nonce serait écrit dans une instance que
`react-style-singleton` ne lit pas — le filet existe, M7 prouve que le parcours
rougirait.

Vérifications de références : `NextResponse`, `NextRequest`, `crypto.randomUUID`,
`envShape.NODE_ENV`, `setNonce`, `AccordionPrimitive.Content`, `LOCALE_HEADER`,
`localeRouting.canonicalPath/internalPath/resolve`, `policyMode`, `getNodeEnv`,
`CSP_REPORT_PATH`, `NONCE_HEADER` — toutes ouvertes et vérifiées, aucune API
inventée.

Les tests ne sont pas décoratifs : aucun n'asserte une classe CSS, une structure
DOM ou un libellé statique. Le cas
`n'autorise en production aucun mot-clé permissif` balaie **toutes** les
directives rendues et les quatre mots-clés permissifs de CSP, pas seulement
`script-src`. Le cas des sources tierces prouve d'abord que la configuration est
lue (sentinelle) avant de refuser tout jeton non déclaré — sans quoi la garde
serait vraie sur une configuration ignorée.

## 6. Une exécution e2e rouge sur sept, non reproduite

La **première** exécution de `E2E_PORT=3145 pnpm test:e2e` sur la branche intacte
a échoué à 22/42, tous fichiers confondus — `app-shell`, `auth`, `health`,
`i18n`, `marketing`, `modules` et le cas du collecteur, qui recevait du HTML au
lieu de JSON — en 1 min 48. Les **six** exécutions suivantes, dont une après
`rm -rf apps/web/.next`, sont vertes (40 passés, 2 ignorés) en 20 à 27 s. Je n'ai
pas reproduit la panne et je ne l'attribue pas à s45. Elle est consignée parce
que `retries: 0` est une politique délibérée du dépôt : une suite rouge une fois
sur sept bloque la CI sans rien expliquer. Une hypothèse à instruire, sans
l'affirmer : le proxy voit désormais bien plus de chemins qu'avant, y compris des
points d'entrée de développement, et certains reçoivent maintenant une
redirection de locale (mineur 2).

## 7. Ce que la fusion avec s12 exposera

**La fusion n'a pas été exécutée** : j'ai lu les sources de s12 sur `dev` plutôt
que de fusionner dans ce worktree. Sur les trois constructions que porte s12 :

- `apps/web/app/oauth/return/page.tsx` rebondit par
  `<meta httpEquiv="refresh" content="0; url=…">` vers une destination
  **relative, same-origin**, revalidée par `safeRedirectPath`. Aucune directive
  livrée ne gouverne la navigation de premier niveau — `navigate-to` a été
  retirée de CSP 3 — donc le rebond passe. **L'affirmation de l'implémenteur
  tient** ;
- `apps/web/app/oauth-buttons.tsx` poste vers `authRoutePath('signInSocial')`,
  chemin de l'application : `form-action 'self'` est satisfait, et le départ vers
  le fournisseur est une redirection HTTP depuis notre propre point d'entrée,
  donc une navigation de premier niveau, hors CSP ;
- `apps/web/app/account/connection-list.tsx` appelle `fetch` sur un chemin
  same-origin : `connect-src 'self'` tient.

Ce que je n'ai pas vérifié : un éventuel logo de fournisseur chargé depuis un
domaine externe (aucun dans ces trois fichiers — `img-src 'self'` le refuserait),
et la branche de rappel dans un vrai navigateur contre un vrai fournisseur.
Aucune source tierce n'est à déclarer aujourd'hui ; si s12 en introduisait une
plus tard, `config/security.ts` est le seul point d'entrée et le test de
non-régression le voit (M3).

## 8. Ce que je n'ai pas pu vérifier

- **La page d'erreur (500)** : `apps/web/app` n'a ni `error.tsx` ni
  `global-error.tsx`, donc Next sert le même composant intégré, à styles en
  ligne, que la page 404 que j'ai mesurée. Je n'ai pas pu provoquer une erreur
  serveur sans toucher à l'environnement. **Déduit, non mesuré.**
- **Le runtime edge / serverless** : tout a été mesuré sur le serveur Node
  (`next dev`, `next start`) sous macOS. Le caractère porteur ou redondant du
  câblage des en-têtes de requête (mineur 1) dépend précisément du runtime que le
  poste local ne peut pas montrer.
- **HSTS en développement** : l'en-tête est émis dans les deux modes ; les
  navigateurs l'ignorent sur `http://localhost`, donc je n'ai pu observer aucun
  effet. Un développeur servant l'application en https sur un vrai nom d'hôte
  épinglerait `includeSubDomains` pour deux ans. Non mesuré.
- **Un seul navigateur** : Chromium. Le repli de `'strict-dynamic'` sur un
  navigateur qui l'ignore n'a pas été observé.
- **Le collecteur n'existe pas en production**, donc la classe de défaut que
  j'ai trouvée (mineur/majeur 1) est précisément celle que rien ne rapportera en
  production.
- **La ligne « cookies » de `docs/security.md` §1** n'est pas couverte par un
  test de cette story ; elle l'est par des tests antérieurs
  (`tests/auth.test.ts`, `tests/i18n.test.ts`, `e2e/auth.spec.ts`,
  `e2e/i18n.spec.ts`). Je n'ai pas rejoué leur mutation.

**Les gestes qu'un humain devrait faire** : ouvrir une URL inexistante sur le
build de production, regarder la console et l'allure de la page, et décider si le
boilerplate doit livrer un `not-found.tsx` et un `global-error.tsx` bâtis sur le
design system ; déployer une préversion sur la plateforme cible réelle et relire
les en-têtes servis et l'hydratation ; fusionner s12 localement et rejouer ses
parcours OAuth contre une vraie application de test du fournisseur.

## 9. Verdict

La story fait ce qu'elle annonce. La politique de production ne porte aucun mot
clé permissif, elle est mesurée sur l'en-tête réellement servi, les deux chemins
détournés demandés sont fermés, le nonce atteint ce que les bibliothèques
injectent, le verrou de défilement fonctionne sous la politique de production, le
collecteur est fermé et borné, la dépendance ajoutée n'introduit aucun code
nouveau, et le piège que l'implémenteur avait lui-même identifié est refermé par
une garde qui mord (M7, M8). Onze mutations, dix rouges, un zéro expliqué et
couvert ailleurs.

Il reste une page que le produit sert et que sa propre politique refuse, six
points mineurs dont trois sont des affirmations « mesurées » que la mesure
contredit — le type d'écart que ce dépôt paie cher, parce que l'agent suivant les
lit comme vérifiées.

Aucun critique. Fusion autorisée, les constats à traiter au cycle suivant.

## 10. Clôture — tour de correction (`664213b`)

> Rédigé par l'implémenteur après le tour de correction demandé sur cette même
> branche. Commit `664213b`, 19 fichiers. Le commit de story `fed2909` est
> intact ; ce qui suit s'y ajoute.

### Constat par constat

| Constat | Décision | Ce qui a été fait, et ce qui le tient |
|---|---|---|
| **Majeur 1** — la page 404 viole la politique | **fermé** | `apps/web/app/not-found.tsx` et `apps/web/app/global-error.tsx`, composés avec `PageHeader`, `EmptyState` et `Button` — aucun composant ni jeton hors `docs/design-system.md`. Textes par les catalogues. Le contrôle qui ferme la **classe** : `e2e/security-headers.spec.ts` juge le HTML servi sur une URL inexistante comme sur une page existante, et exige une sortie unique vers l'accueil |
| **Mineur 1** — justification « mesurée » fausse | **fermé** | Câblage **conservé**. `proxy.ts`, `apps/web/AGENTS.md` et la recherche §1 disent ce qui a été vérifié dans le paquet installé — `resolve-routes.js:461-463` recopie chaque en-tête de réponse du proxy sur `req.headers` — et nomment l'incertitude edge comme non mesurée |
| **Mineur 2** — « à comportement identique » faux | **fermé, propriété rendue vraie** | `carriesLocalePrefix` reprend les quatre alternatives du motif d'origine (`api`, `_next`, `favicon.ico`, un point n'importe où). Six sondes, dont `/v1.2/page` et `/_next/quelque-chose` |
| **Mineur 3** — `frame-src` perd `'self'` | **fermé** | Une source déclarée s'ajoute ; les **sept** clés de `ContentSecurityPolicySources` sont exercées, et l'état livré (`'none'`) a son propre cas |
| **Mineur 4** — injection de journal | **fermé** | Normalisation de **tout** caractère de contrôle (pas seulement `\n`), à l'entrée, donc tampon et journal compris |
| **Mineur 5** — dérive de signature | **fermé** | `securityHeaders({ mode, nonce, sources, reportPath })`, la signature de la tâche 2 |
| **Mineur 6** — précédent invoqué faux | **fermé** | La comparaison avec le drapeau de s09 est retirée ; le commentaire de `getNodeEnv` dit que son repli est **le plus permissif** et que ce qui protège est la validation au démarrage — désormais éprouvée par un cas |

### Les mutations de ce tour

Neutralisées, mesurées, **restaurées aussitôt** (`diff` vérifié après chacune).

| # | Neutralisation | Fichier | Rouges |
|---|---|---|---|
| N1 | `frame-src` remplace `'self'` au lieu de l'y ajouter | `apps/web/lib/security-headers.ts` | **1** (vitest) |
| N2 | `reportPath` ignoré, constante de module rétablie | `apps/web/lib/security-headers.ts` | **1** (vitest) |
| N3 | `carriesLocalePrefix` ramené à l'écriture d'origine de s45 | `apps/web/proxy.ts` | **1** (vitest, sur 101) |
| N4 | `singleLine` réduit à l'identité | `apps/web/app/api/csp-report/route.ts` | **1** (vitest) |
| N5 | `NODE_ENV` accepte n'importe quelle chaîne | `packages/config/src/env.ts` | **2** (vitest) |
| N6 | `fallbackText` se replie sur la clé au lieu de lever | `apps/web/lib/fallback-text.ts` | **1** (vitest) |
| N7 | un titre écrit en dur dans l'écran de dernier recours | `apps/web/app/global-error.tsx` | **2** (vitest) |
| N8 | un `style` en ligne réintroduit sur l'écran 404 | `apps/web/app/not-found.tsx` | **1** (e2e) |
| N9 | l'écran 404 n'offre plus de sortie | `apps/web/app/not-found.tsx` | **1** (e2e) |

Neuf mutations, neuf rouges, aucun zéro. N8 est celle qui compte : c'est la
preuve que la **classe** est fermée et pas seulement le cas — une future page
d'erreur réintroduisant du style en ligne rougit.

### La page 500 : mesurée, plus déduite

Le §8 la donnait comme déduite. Elle a été mesurée : une page qui lève, ajoutée
**temporairement** à l'arborescence, `pnpm build` puis `next start` (port 3147),
Chromium. Résultat : statut 500, HTML servi sans aucun attribut `style` ni
`<style>`, tous les scripts en ligne noncés, **zéro violation**, et
`global-error.tsx` rendu (`lang="fr"`, `h1` « Une erreur est survenue »). La
page temporaire a été retirée et le build refait avant le commit. Le corps
servi par le serveur est une coquille d'erreur (`id="__next_error__"`) : l'écran
est rendu côté client après hydratation — la mesure porte donc sur le DOM, pas
sur le HTML.

### Vérification navigateur, build de production

`next start` (port 3147), Chromium, sur `/fr/adresse-inexistante`,
`/en/adresse-inexistante` et une page qui lève.

| Contexte | Statut | Violations | `h1` | Débordement horizontal | Sortie |
|---|---|---|---|---|---|
| clair, 1280 px, `fr-FR` | 404 | **0** | « Page introuvable » | non | `/fr` |
| sombre, 380 px, `fr-FR` | 404 | **0** | « Page introuvable » | non | `/fr` |
| clair, `en-US` | 404 | **0** | « Page not found » | non | `/en` |
| page qui lève, `fr-FR` | 500 | **0** | « Une erreur est survenue » | non | — |

**Balayé pour ce tour : ces quatre contextes**, plus l'accueil et `/fr/sign-in`
en référence (0 violation, inchangés). Ce n'est pas la liste de ce qui existe.

### Les commandes de ce tour

| Commande | Résultat |
|---|---|
| `pnpm typecheck` | vert (15 tâches) |
| `pnpm lint --max-warnings=0` | `No issues found` |
| `pnpm test` | 762 passés, 2 ignorés — vert (757 avant) |
| `E2E_PORT=3145 pnpm test:e2e` | 41 passés, 2 ignorés — vert (40 avant) |
| `pnpm build` | vert, 15 routes, toutes `ƒ (Dynamic)` |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert |

### Ce que ce tour laisse ouvert, et qu'il faut lire comme tel

- **Le runtime edge reste non mesuré.** Le câblage des en-têtes de requête est
  conservé sur cette base ; le commentaire le dit désormais au lieu de
  l'affirmer ;
- **`global-error.tsx` n'a ni thème ni locale de requête.** Ce n'est pas un
  oubli : il remplace `app/layout.tsx`, et la documentation de Next le dit
  explicitement pour cet écran. Il rend donc en thème clair, dans la langue du
  site — un visiteur anglophone verra le français sur cet écran-là ;
- **Une seconde locale sur l'écran 500** demanderait de faire entrer le
  catalogue complet dans un bundle client, donc le registre de modules : refusé
  ici, à instruire dans une story si le besoin se confirme ;
- **L'exécution e2e rouge sur sept du §6 n'a pas été revue** — huit exécutions
  sur cette branche pendant ce tour, toutes vertes. Un mode d'échec **voisin** a
  été rencontré et il est nommé, faute de mieux : Next 16 refuse de démarrer un
  second serveur de développement pour le même répertoire (`Another next dev
  server is already running`), et `pnpm test:e2e` échoue alors au démarrage du
  `webServer`. Ce n'est pas la panne du §6, qui était un 22/42 après démarrage ;
- **Un seul navigateur**, Chromium, comme au premier tour.

## 11. Verdict après correction

Le majeur est fermé, et fermé au bon niveau : ce n'est pas la page 404 qui a été
réparée, c'est le contrôle qui manquait — le HTML servi sur une URL sans route
est désormais jugé comme celui d'une page. Les six mineurs sont fermés, dont les
trois affirmations « mesurées » que la mesure contredisait, corrigées dans les
trois endroits où un agent suivant les aurait lues comme vérifiées : le code, la
règle de paquet et la recherche. Neuf mutations, neuf rouges.

Le gate est inchangé : aucun critique n'a jamais été ouvert, la fusion restait
autorisée. Elle l'est toujours, et les constats qui devaient être traités au
cycle suivant l'ont été avant.

Max severity: major
Ship allowed: yes
