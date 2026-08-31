# Recherche — s45-security-headers

> Story : `docs/stories.md` § `s45-security-headers`. Socle concerné :
> `docs/security.md` **§1** (en-têtes et politique de sécurité du contenu),
> §5 (aucune lecture directe de `process.env`), §6 (dépendance justifiée).
> Fiabilité : `docs/reliability.md` §2 (aucun service tiers requis), §5.
>
> **Tout ce qui suit a été mesuré** sur le paquet installé (`next` 16.3.3) et
> sur l'application réellement construite puis démarrée (`next build` +
> `next start`, port 3146) et en développement (`next dev`, port 3148), le
> 31 août 2026. Les listes disent ce qui a été balayé, jamais ce qui existe.

## 1. Ce que Next 16.3.3 fait réellement du nonce

Vérifié dans le paquet installé, pas de mémoire — la mécanique a changé
plusieurs fois et la documentation en ligne mélange les majeures.

- `middleware.ts` **n'existe plus** : la convention s'appelle `proxy.ts`
  (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`,
  « Middleware is deprecated and renamed to Proxy » en v16.0.0). Le dépôt a déjà
  un `apps/web/proxy.ts` (préfixe de locale, s09).
- **Le proxy s'exécute dans le runtime Node.js** depuis la v16 (même document,
  §Runtime : « Proxy defaults to using the Node.js runtime »). `process.env` y
  est donc complet — mais y valider tout l'environnement à chaque requête serait
  absurde, d'où l'accesseur étroit décrit au §5.
- **Next lit le nonce dans les en-têtes de la *requête*, pas de la réponse** :
  `node_modules/next/dist/server/app-render/app-render.js:209` →
  `headers['content-security-policy'] || headers['content-security-policy-report-only']`,
  puis `getScriptNonceFromHeader`
  (`node_modules/next/dist/server/app-render/get-script-nonce-from-header.js`),
  qui cherche la directive `script-src` **puis** `default-src` et en extrait le
  premier `'nonce-…'` conforme à `/^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/`.
  Conséquence tirée à ce moment-là : poser l'en-tête sur la seule réponse
  (`response.headers.set`) donnerait une politique correcte **et une page
  cassée**, Next n'ayant pas de nonce à mettre sur ses propres balises.

  **Corrigé après la revue de s45, et la correction est le point intéressant.**
  Cette conséquence n'avait pas été mesurée, et elle est fausse sur le runtime
  Node : `node_modules/next/dist/server/lib/router-utils/resolve-routes.js`
  recopie chaque en-tête de réponse ordinaire du proxy sur `req.headers`
  (`resHeaders[key] = value; req.headers[key] = value`). La politique posée sur
  la seule réponse atteint donc le rendu de toute façon, et la revue l'a
  observé : les deux lignes retirées, la page reste entièrement hydratée, six
  parcours verts. Le câblage explicite est conservé — c'est la voie du mécanisme
  de surcharge `x-middleware-request-*`, probablement la seule sur un runtime
  **edge**, qui n'a été mesuré ni par la story ni par la revue —, mais la raison
  écrite ici était une déduction présentée comme une mesure.
- Un nonce impose le rendu dynamique. **Mesuré sans risque ici** : `pnpm build`
  marque les quatorze routes `ƒ (Dynamic) server-rendered on demand`, aucune
  route prérendue. Le compromis annoncé par la story (pas de cache statique) est
  donc déjà payé par `app/layout.tsx`, qui lit `headers()` via `currentLocale()`.

## 2. Ce que l'application émet réellement, et ce qu'une politique stricte casse

Mesuré page par page sur le **build de production** servi par `next start`, puis
rejoué dans Chromium derrière un proxy local qui ajoute la politique en test.

### 2.1 Le HTML servi

Balayé : `/fr`, `/en`, `/fr/legal/privacy`, `/fr/legal/terms`, `/fr/sign-in`,
`/fr/sign-up`, `/fr/forgot-password`, `/fr/reset-password`, `/fr/verify-email`,
`/fr/account` (307), `/api/health` — onze réponses.

| Ce qui est émis | Compte | Origine |
|---|---|---|
| `<script>` en ligne | 3 par page HTML | 1 × `next-themes` (anti-clignotement), 2 × charge utile Flight de Next |
| `<style>` en ligne | 0 | — |
| `style="…"` en ligne | 1, et **uniquement** sur `/fr` et `/en` | Radix `AccordionContent` |
| `<img>` | 0 | les icônes sont des SVG en ligne (`lucide-react`) |
| police / CSS externe | 0 domaine tiers | `next/font` et Tailwind sont servis depuis `/_next/static` |

Aucune source tierce n'est donc nécessaire aujourd'hui : `default-src 'self'`
suffit, sans `img-src data:`, sans `connect-src` élargi, sans `font-src`.

### 2.2 Ce que la politique stricte refuse, mesuré dans le navigateur

Politique appliquée :
`default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self' 'nonce-…'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`.

Événements `securitypolicyviolation` observés, sur ces cinq gestes (chargement de
`/fr`, ouverture de l'accordéon, changement de thème, ouverture du panneau mobile
à 380 px, navigation vers `/fr/sign-in`) :

| Directive | Ce qui est refusé | Effet fonctionnel mesuré | Réparable ? |
|---|---|---|---|
| `script-src-elem` | script anti-clignotement de `next-themes` | le thème clignote au premier rendu | **oui** — `next-themes` pose le nonce sur son `<script>` et sur son `<style>`, vérifié dans le paquet installé (`e&&i.setAttribute("nonce",e)`) |
| `style-src-elem` | `<style>` « transition:none » injecté par `next-themes` (×2 au chargement, ×1 par changement de thème) | transitions non coupées pendant le basculement | **oui**, même mécanisme |
| `style-src-elem` | `<style>` `.with-scroll-bars-hidden` de `react-remove-scroll`, injecté à l'ouverture d'un `Sheet` ou d'un `DropdownMenu` | **le défilement de l'arrière-plan n'est plus verrouillé** (`body { overflow }` mesuré `visible` au lieu de `hidden`) | **oui** — `get-nonce`/`setNonce`, l'API documentée de `react-style-singleton` |
| `style-src-attr` | l'attribut `style` que Radix `AccordionContent` écrit toujours | **aucun** : les deux variables refusées ne sont utilisées nulle part dans `packages/ui/src/styles.css`, et le panneau s'ouvre à la même hauteur (40 px) qu'en l'absence de politique | **oui** — en neutralisant les deux variables depuis le composant du design system |

**Ce qui n'est pas cassé, contre l'intuition, et c'est la mesure qui le dit** :
le positionnement des menus Radix (`x=1020 y=52`, identique sans politique), la
largeur du panneau mobile, le basculement de thème et l'hydratation
(`use-hydrated` rend le bouton d'envoi actionnable). Raison : CSP ne gouverne que
les attributs `style` **analysés dans le HTML**, jamais les écritures CSSOM
(`element.style.transform = …`), qui sont ce qu'utilisent Floating UI et Radix
après hydratation.

### 2.3 Le développement n'a pas les mêmes besoins

Mesuré sur `next dev` derrière le même proxy :

- politique de production telle quelle → **37 violations**, dont
  `[script-src] eval` : React en développement utilise `eval` pour reconstruire
  les piles d'appel serveur. C'est ce que dit aussi le guide livré avec le
  paquet (`02-guides/content-security-policy.md`) ;
- politique assouplie sur **deux points seulement** —
  `script-src … 'unsafe-eval'` et `style-src 'self' 'unsafe-inline'` (Turbopack
  injecte le CSS par JavaScript sans nonce) → **1 violation**, le script de
  `next-themes`, qui disparaîtra une fois le nonce transmis.

Donc : `'unsafe-inline'` **jamais dans `script-src`, pas même en
développement** — c'est ce qui rend démontrable, dans les parcours Playwright
(qui tournent sur `next dev`), qu'un script en ligne sans nonce ne s'exécute pas.
Et `'unsafe-eval'`/`'unsafe-inline'` de style restent bornés au développement,
ce que `docs/security.md` §1 autorise explicitement (« en production »).

## 3. Le point qui n'était pas négociable, et comment il se règle

ADR 012 le tranche à l'avance : « certains contrôles (politique de sécurité du
contenu stricte) entrent en conflit avec des pratiques répandues comme les
scripts en ligne. **Ces conflits se résolvent en durcissant, pas en
assouplissant.** »

La sortie n'est donc pas `'unsafe-inline'` ni `'unsafe-hashes'` : c'est de
supprimer les quatre sources en ligne recensées au §2.2 — trois par transmission
du nonce, une en retirant du design system deux variables mortes. Après quoi la
politique de production n'a plus aucun mot-clé permissif, et la console
n'affiche plus rien.

## 4. Où les en-têtes doivent être posés, et le piège du `matcher`

Critère : « Les en-têtes sont présents aussi bien sur les pages publiques que
sur les routes de l'API ». Or le `matcher` actuel
(`'/((?!api|_next|favicon.ico|.*\\..*).*)'`) exclut `/api`, **et** tout chemin
contenant un point — donc `/robots.txt` et `/sitemap.xml`.

Deux mécanismes (proxy + `headers()` de `next.config.ts`) poseraient deux fois
`Content-Security-Policy` sur les chemins couverts par les deux : les navigateurs
appliquent alors l'**intersection** des politiques, et la plus stricte gagne
silencieusement. C'est une source unique ou rien.

Le `matcher` est donc élargi et l'exclusion redevient une **condition interne au
proxy**. « À comportement identique » exige de reprendre les **quatre**
alternatives du motif, une à une : `api`, `_next`, `favicon.ico`, et un point
**n'importe où** dans le chemin. Sans le dernier cas,
`canonicalPath('/robots.txt')` redirigerait vers `/fr/robots.txt` —
`app/robots.ts` et `app/sitemap.ts` cesseraient d'être servis. C'est le seul
risque de régression de la story, et il est couvert par un test.

**Corrigé après la revue de s45** : la première écriture ne cherchait le point
que sur le **dernier** segment et laissait tomber `_next`, si bien que
`/v1.2/page` et `/_next/quelque-chose` recevaient une redirection de locale
qu'ils n'avaient jamais reçue — mesuré sur `next start`, 307 dans les deux cas.
Aucune route de cette forme n'existe aujourd'hui ; la propriété est désormais
vraie, et six sondes la tiennent.

## 5. Comment le mode se lit sans violer §5 du socle

`packages/config` est le point d'accès unique à l'environnement, et `NODE_ENV`
est déjà dans son schéma. Mais `getEnv()` valide **tout** l'environnement et lève
si `DATABASE_URL` manque : inutilisable dans un proxy appelé à chaque requête, et
intestable. La recherche retient donc un accesseur étroit ajouté à
`@repo/config` — il ne juge que `NODE_ENV` et retombe sur `development`, comme le
défaut du schéma.

Ce n'est **pas** le cas du mailer : là, `docs/reliability.md` §2 interdit de
déduire un comportement de `NODE_ENV` parce qu'un envoi capturé serait
indiscernable d'un envoi réel. Ici, ce qui change entre les deux modes est le
**bundle React lui-même** (`eval` en développement) : aucun drapeau posé par le
développeur ne peut décrire cela, et une politique trop stricte se voit
immédiatement — la page ne s'affiche pas.

## 6. Le rapport de violation, sans service tiers

`report-uri` est marqué obsolète mais reste le seul mécanisme que Chrome honore
sans en-tête `Reporting-Endpoints` supplémentaire. Il est posé **en
développement uniquement**, vers une route de l'application qui garde les
derniers rapports en mémoire et les journalise. En production la route répond
404, et aucune dépendance tierce (`reliability.md` §2).

**Corrigé après la revue de s45** : la première rédaction disait « même forme
d'opt-in que la sonde de traduction manquante de s09 (`I18N_MISSING_KEY_PROBE`) ».
C'est faux — la sonde est un **drapeau explicite**, ce collecteur-ci dérive de
`NODE_ENV`. Elles ne se ressemblent que par le 404. Ce qui rend la dérivation
sûre est ailleurs, et c'est exécutable : un `NODE_ENV` mal orthographié
n'obtient pas le mode développement, il arrête le démarrage en nommant la
variable (`packages/config/src/env.test.ts`).

Un tampon **borné** (les 50 derniers) : un rapport de violation est déclenchable
par n'importe quelle page, donc une liste non bornée serait une fuite mémoire à
la demande.

## 7. Le premier client de cette politique : le rebond OAuth de s12

s12 (`feature/s12-oauth-signin`, en cours sur une autre voie) n'est pas sur cette
branche et **ne peut pas être testé ici**. Il est nommé parce qu'il est le
premier code qui mettra cette politique en défaut :

- un rebond écrit en `<meta http-equiv="refresh">` **n'est pas** bloqué par cette
  politique : aucune directive livrée par les navigateurs ne gouverne la
  navigation de premier niveau (`navigate-to` a été retirée de CSP 3). Le rebond
  passera ;
- un rebond écrit en `<script>location.href=…</script>` **sera bloqué**, comme
  tout script en ligne. La correction est le nonce
  (`headers().get('x-nonce')` → `<Script nonce=…>`), jamais l'élargissement de
  la politique ;
- si s12 poste un formulaire vers le fournisseur, `form-action 'self'` refusera.
  L'ajout se fait alors dans `config/security.ts`, avec la justification écrite
  qu'exige `docs/security.md` §1 — et le test de non-régression le voit.

Même remarque pour le captcha de s28 et l'analytique de s39 : sources tierces, à
déclarer dans le fichier unique, et soumises au consentement de s36.

## 8. Ce que la recherche laisse ouvert

- Les parcours Playwright tournent sur `next dev`, où `style-src` porte
  `'unsafe-inline'`. **Aucun parcours ne peut donc constater une violation de
  style.** La preuve de la politique de production passe par la réponse rendue
  par `proxy()` sous `NODE_ENV=production` et par une vérification navigateur
  manuelle sur `next start`, consignée dans le rapport.
- `'strict-dynamic'` neutralise `'self'` dans `script-src` pour les navigateurs
  qui le comprennent. Mesuré fonctionnel sur le build de production ; les
  navigateurs qui l'ignorent retombent sur `'self'`, donc jamais plus permissif.
- Ce qui a été balayé pour les styles en ligne, ce sont les **onze réponses**
  du §2.1 et les **cinq gestes** du §2.2. Un écran non visité peut porter un
  attribut `style` que rien ici n'a vu — c'est précisément ce que le collecteur
  de rapports du §6 sert à découvrir.

  **C'est exactement ce qui est arrivé.** Les onze réponses étaient toutes des
  URL *existantes* : la revue a mesuré que la page 404 intégrée de Next émet
  quatre attributs `style` et un `<style>` sans nonce, donc deux violations en
  production. La correction livre `app/not-found.tsx` et `app/global-error.tsx`,
  et surtout un contrôle qui juge le HTML servi sur une **URL inexistante** —
  sans quoi un cas serait réparé et la classe resterait ouverte.
