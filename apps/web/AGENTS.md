# apps/web — règles locales

Application Next.js (App Router). Elle **monte** l'API et rend les écrans ; elle
n'héberge aucune règle métier — celles-ci vivent dans la couche `domain` d'un
module (`packages/modules/<module>/src/domain`).

## Imports autorisés

- `@repo/config` pour l'environnement, `@repo/config/server` pour ce qui lit un
  fichier ;
- `@repo/db` pour la base ;
- `@repo/core` pour le registre de modules ;
- `@repo/ports` pour les ports `Mailer` et `Storage`, `@repo/adapter-resend` et
  `@repo/adapter-s3` pour leurs uniques implémentations, `@repo/emails` pour le
  rendu des templates, `@repo/mailer-testing` pour la capture locale des emails
  et `@repo/storage-testing` pour le stockage sur disque — **uniquement** dans
  `lib/mailer.ts` et `lib/storage.ts`, qui sont les points de composition des
  deux ports ;
- `@repo/ports` pour les ports `Mailer` et `Payments`, `@repo/adapter-resend`
  pour l'unique implémentation du premier, `@repo/emails` pour le rendu des
  templates et `@repo/mailer-testing` pour la capture locale — **uniquement**
  dans `lib/mailer.ts`, qui est le point de composition du mailer ;
- `@repo/adapter-stripe` pour l'unique implémentation du port `Payments`, et
  `@repo/payments-testing` pour le mode local — **uniquement** dans
  `lib/billing.ts`, qui est le point de composition de la facturation (s19) ;
- les modules du projet, **uniquement** parce que `config/features.ts` les
  référence : `@repo/module-auth`, `@repo/module-billing`,
  `@repo/module-consent`, `@repo/module-i18n`, `@repo/module-marketing`,
  `@repo/module-organizations`, `@repo/module-storage`,
  `@repo/module-demo-enabled` et `@repo/module-demo-disabled` aujourd'hui. Sept
  fichiers font exception et importent un module directement — `lib/auth.ts`, le
  point de composition de l'authentification, `lib/locale-routing.ts`, celui de
  l'i18n, `lib/marketing.ts`, celui du site public, `lib/organizations.ts`,
  celui des organisations, `lib/storage.ts`, celui du stockage,
  `lib/billing.ts`, celui de la facturation, et `lib/consent.ts`, celui du
  consentement (voir plus bas). Les écrans du site public, des organisations, de
  la facturation, des cookies, ainsi que le shell, importent en plus le second
  point d'entrée de leur module (`@repo/module-marketing/presentation`,
  `@repo/module-organizations/presentation`,
  `@repo/module-billing/presentation`,
  `@repo/module-consent/presentation`) : ses composants React n'ont pas
  leur place dans le barril que lit `config/features.ts`, qu'aucun outil du
  dépôt ne compile en JSX (**ADR 024**, la règle de tout module à composants) ;
- `zod` pour valider les entrées de route — le paramètre `[document]` des pages
  légales aujourd'hui. Zod à **chaque** frontière (`docs/security.md` §4), y
  compris un segment d'URL ;
- `next-intl` pour la résolution des chaînes — dans `i18n/request.ts`,
  `i18n/request-config.ts`, `lib/i18n.ts`, `app/api/i18n-probe/route.ts` et les
  composants qui affichent du texte. La bibliothèque est un
  détail de ce point de composition : aucun module ne la connaît ;
- `@repo/ui` pour **tout** ce qui s'affiche : c'est le design system, et la
  seule frontière avec le socle de composants. Un import de `@radix-ui/*` ici
  est refusé par `pnpm lint` (ADR 022) ;
- `lucide-react` pour les icônes : un seul jeu dans tout le produit, 16 px dans
  l'application. Ce n'est pas le socle de composants — celui-là ne sort pas de
  `packages/ui` ;
- `uqr` dans **`app/account/two-factor-qr.tsx` uniquement** : il rend la
  **matrice** d'un QR code, pas une image. C'est ce qui permet de composer le
  `<svg>` en JSX — donc sans `dangerouslySetInnerHTML` (`docs/security.md` §4)
  et sans style en ligne, que la politique livrée par s45 refuse. Le secret
  TOTP ne quitte pas le processus : ni URL d'image, ni service tiers, ni appel
  réseau ;
- `@simplewebauthn/browser` dans **`app/account/passkey-card.tsx` et
  `app/sign-in/passkey-button.tsx` uniquement** (s14) : ce sont les deux seuls
  endroits où le navigateur doit appeler `navigator.credentials`. Le paquet
  n'apporte que trois choses, et chacune est une raison de ne pas la réécrire —
  `browserSupportsWebAuthn()` (le critère 4 de s14 : l'option est masquée quand
  le navigateur ne sait pas faire), et les deux cérémonies, qui encodent en
  base64url le défi, les identifiants de justificatif et les trois champs de
  réponse. C'est la **même version** que celle dont dépend le greffon serveur
  (`@better-auth/passkey`), donc les deux moitiés du format binaire sont
  écrites par le même auteur ; les réécrire à la main serait une seconde
  implémentation dont la divergence ne se verrait qu'à l'exécution, dans un
  navigateur. Le client `@better-auth/passkey/client`, lui, n'est **pas**
  employé : il suppose la table de routes et les corps de réponse de Better
  Auth, que le module réécrit tous les deux ;
- `geist` dans les deux fichiers qui rendent un **document** — `app/layout.tsx`
  et `app/global-error.tsx`, ce dernier remplaçant le premier quand la racine
  échoue. Les deux polices sont chargées par `next/font`, donc servies par
  l'application. Une police servie par un domaine externe serait un script
  tiers, soumis au consentement de s36. Hors de Next, `geist/font/*` ne résout
  pas : `vitest.config.ts` l'aliase vers `tests/fixtures/next-font.ts`, qui rend
  ce que le greffon de build rendrait ;
- `next`, `react`, `react-dom` ;
- `@repo/typescript-config` pour la configuration du compilateur.

Un import direct de `process.env` est interdit ici comme partout ailleurs : le
point d'accès unique est `@repo/config`.

## Ne doit jamais contenir

- de règle métier ni de requête SQL écrite à la main — elles appartiennent aux
  couches `domain` et `infrastructure` d'un module ;
- de secret, ni dans le code, ni dans une réponse HTTP : `/api/health` renvoie
  `unreachable` et journalise la cause, jamais la chaîne de connexion ;
- de composant copié depuis un design externe : le design system vit dans
  `packages/ui` ;
- de **texte affiché écrit en dur**, quelle qu'en soit la forme — un littéral,
  une variable, une clé d'objet de props, une concaténation. Tout ce qui
  s'affiche vient d'une clé de catalogue. La règle est exécutable :
  `tests/rendered-text.test.ts` rend chaque écran avec un catalogue dont chaque
  valeur est un marqueur, et refuse toute chaîne qui n'en est pas un. Un écran
  ajouté sans être rendu là fait rougir la garde de couverture du même fichier.
  « Écran » veut dire `page.tsx`, `not-found.tsx` **et** `global-error.tsx` :
  les trois sont servis à un visiteur ;
- de connaissance d'un module en particulier : aucun `if (module activé)`, aucun
  fichier de route par module, aucune entrée de navigation écrite à la main. Tout
  cela vient du registre, et c'est ce qui fait qu'un module non activé n'expose
  rien du tout.

## Le montage des modules

Deux fichiers, et deux seulement :

- `lib/module-registry.ts` construit le registre depuis `config/features.ts`. La
  validation a lieu à l'import : une configuration incohérente empêche le
  démarrage en nommant les modules en cause.
- `app/api/modules/[...path]/route.ts` est **le** point de montage des routes de
  modules. Un fichier de route par module qui répondrait `notFound()` laisserait
  une route exposée ; ici la route d'un module non activé n'est dans aucune
  table.

La navigation du shell vient de `lib/navigation.ts` — `visibleNavigation`
(s03), traduite, **sans une seule condition**. Ajouter un `if` sur un
identifiant de module reviendrait à masquer une entrée au lieu de ne pas
l'avoir, et le composant qui l'affiche (`app/app-navigation.tsx`) ne sait même
pas ce qu'est un module : il reçoit des entrées.

## Le shell

`app/layout.tsx` pose les polices, le thème et `app/app-shell.tsx`, qui entoure
**tous** les écrans — authentification comprise. Le shell résout l'appelant une
seule fois (`currentViewer`) et en tire deux choses : les entrées de navigation
et le menu de compte. Un visiteur anonyme n'a pas de menu de compte parce qu'il
n'est **pas rendu**, jamais parce qu'il serait masqué.

Le thème est piloté par la classe `.dark` sur `<html>` (`next-themes`), et
`suppressHydrationWarning` sur cet élément est ce qui rend l'écart attendu :
le script pose la classe avant le premier rendu, donc le serveur et le client
diffèrent par construction. Le retirer fait apparaître un avertissement à chaque
chargement ; l'étendre à l'arbre masquerait de vrais écarts.

## Les formulaires

Trois composants, `app/auth-form.tsx`, `app/account/account-form.tsx` et
`app/public-form.tsx` (s11), et deux règles que tout écran hérite d'eux :

- **`method="post"` sur le `<form>`, toujours.** Sans `method`, le repli du
  navigateur est un `GET` vers l'URL courante : les champs — mot de passe
  compris — partent dans la chaîne de requête, donc dans le journal d'accès,
  l'historique et le `Referer` des requêtes suivantes (`docs/security.md` §5).
  Mesuré sur les deux écrans, JavaScript coupé : `/account?currentPassword=…`
  et `/sign-in?email=…&password=…` (revue de s08, C1). `pnpm lint` refuse
  désormais un `<form>` dont le `method` n'est pas écrit en toutes lettres —
  y compris étalé (`{...props}`), calculé ou `undefined`. La règle vise
  `apps/**`, `packages/**`, `tooling/**`, `config/`, `scripts/`, `generated/`
  et la racine,
  `packages/ui` compris ; elle ne juge pas la valeur (`method="get"` reste
  légitime pour un formulaire sans secret) ;
- **le bouton d'envoi est désactivé tant que `useHydrated()` répond `false`**
  (`app/use-hydrated.ts`). Entre le premier octet et l'hydratation, le
  gestionnaire React n'existe pas : un clic part par le repli natif, et l'action
  est perdue sans que rien ne le dise. C'est aussi ce qui rend le parcours
  déterministe — Playwright attend un contrôle actionnable, là où il cliquait
  dans le vide une fois sur trois.

**Un bouton éteint doit dire pourquoi.** Sans JavaScript, la règle ci-dessus le
laisse éteint pour toujours : `app/public-form.tsx` porte donc un `<noscript>`
qui l'explique, mesuré sous le build de production (constat F5 de la revue de
s11). Un `<noscript>` ne demande ni script en ligne ni source de politique de
sécurité du contenu supplémentaire. Piège du harnais : les moteurs de **texte**
et de **rôle** de Playwright ignorent le sous-arbre d'un `<noscript>` — mesuré,
`getByText` y rend zéro alors que le bloc occupe 622 × 66 pixels. Il faut un
sélecteur de structure (`noscript > *`), et c'est la seule exception au principe
« on cherche par rôle et par nom accessible ».

`e2e/app-shell.spec.ts` le prouve dans un contexte sans JavaScript, et **sans
reprise** (`retries: 0`) : c'est une reprise qui avait fait passer cette fuite
pour une instabilité de test.

**Pourquoi le formulaire public vit ici et non dans son module.** Il appelle
`fetch`, et `eslint.config.ts` refuse tout appel réseau sortant d'un module hors
d'une porte bornée (`docs/reliability.md` §3). La règle vise des appels
**serveur vers un tiers** ; celui-ci va du navigateur vers **notre propre
route**. Élargir une garde de sécurité pour un cas qu'elle ne visait pas est
précisément ce que ce dépôt refuse : le composant a donc rejoint `auth-form.tsx`,
qui poste vers les routes du module `auth` depuis s07 pour la même raison.
`MarketingHome` et `ContactView` le reçoivent en `ReactNode` — le module décide
**où** il s'affiche, l'application le fournit.

Il porte deux affordances de plus, propres à un formulaire **ouvert à tout
venant** (`docs/security.md` §7) :

- un **champ piège** masqué par la classe `hidden`, jamais par un attribut
  `style` : `style-src-attr` ignore les nonces, un style en ligne serait refusé
  en production. Rempli, la réponse est celle d'une soumission acceptée et rien
  n'est écrit ni envoyé — un 400 qui nommerait le champ apprendrait au robot
  lequel laisser vide ;
- `noValidate` sur le `<form>` : la validation du navigateur masquerait le refus
  **du serveur**, qui est la seule frontière qui compte, et rendrait le message
  d'erreur intestable au navigateur.

## Le montage de l'authentification

Deux fichiers, sur le modèle exact du mailer :

- `lib/auth-config.ts` porte la **règle** — `AUTH_SECRET` et `APP_URL` sont
  exigées de ce qui monte l'authentification, et de lui seul : `pnpm db:migrate`
  ne signe aucun cookie et doit s'exécuter avec le seul `DATABASE_URL` ;
- `lib/auth.ts` **construit** le service : il donne au module la connexion à la
  base, le mailer et le secret. C'est le **seul fichier de l'application** qui
  connaisse `@repo/module-auth`, et il ne pouvait pas en aller autrement : le
  crochet `resolveSession` que `dispatchModuleRequest` attend doit bien venir de
  quelque part, et `@repo/core` ne peut pas dépendre d'un module sans inverser la
  dépendance qui fait toute la modularité.

`APP_URL` n'est pas décorative : c'est elle qui construit les liens envoyés par
email. La **déduire** de l'en-tête `Host`, comme le proposent la plupart des
bibliothèques, laisse un attaquant faire pointer un lien de réinitialisation
vers son propre domaine.

Un troisième fichier depuis s12 : `lib/oauth-config.ts` porte la **règle des
fournisseurs externes**, sur le même modèle. Trois états, et il faut en choisir
un :

| Configuration | Ce qui se passe |
|---|---|
| une paire complète (`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`, idem GitHub) | le bouton correspondant s'affiche, la boucle OAuth est réelle |
| `OAUTH_LOCAL_PROVIDER=1`, aucune clé | un fournisseur de développement est monté, sans réseau ni clé |
| rien | aucun bouton, aucune session possible par fournisseur, l'application démarre |
| une paire **incomplète** | **le démarrage échoue en nommant la variable absente** |
| le drapeau **et** une clé | refusé : le choix serait implicite, comme pour la capture locale des emails |
| le drapeau **et** `NODE_ENV=production` | **refusé au démarrage, en nommant la variable** |

Le mode local est un **opt-in de développement**, jamais un repli : il ouvre
toujours la même adresse de test, il porte son propre identifiant de
fournisseur, et il n'emprunte l'identité ni de Google ni de GitHub. C'est lui
que `playwright.config.ts` pose, et c'est ce qui rend le parcours de connexion
externe exerçable sans aucune clé.

La dernière ligne du tableau est une **défense en profondeur**, et pas une
formalité : ce fournisseur ouvre une session sur une adresse fixe **sans mot de
passe**, pour n'importe quel visiteur. Posé seul sur un déploiement de
production — une variable copiée d'un `.env` de poste suffit —, il donnait un
bouton « Continuer avec Fournisseur local » à un anonyme. La règle du socle
« jamais déduit de `NODE_ENV` » reste tenue : le drapeau demeure l'unique
opt-in, `NODE_ENV` ne l'active jamais, il le **restreint**.

Deux écrans en héritent, et une page technique : les boutons
(`app/oauth-buttons.tsx`, un `<form method="post">` par fournisseur, sans
JavaScript — ces formulaires n'envoient aucun secret), la carte « Connexions
externes » de `/account`, et `app/oauth/return/page.tsx`, le **rebond** du
retour. Ce dernier n'est pas décoratif : le cookie de session est
`SameSite=Strict`, et il ne repart pas sur la fin d'une chaîne de navigation
venue du fournisseur — sans rebond same-site, l'utilisateur atterrit déconnecté
alors que sa session existe. Mesuré dans `e2e/oauth.spec.ts` : retirer le rebond
fait rougir exactement ce parcours-là, et aucun test de nœud ne le voit.

Le module reçoit sa connexion ; il n'importe jamais `@repo/db` (ADR 020).

## Le montage de l'i18n

Trois fichiers, sur le modèle exact du mailer et de l'authentification :

- `lib/locale-routing.ts` porte le **choix** — le module `i18n` est-il monté ?
  C'est le seul fichier de l'application qui connaisse `@repo/module-i18n`, et
  le seul qui regarde si ce module est activé. Il rend un `LocaleRouting`
  (`@repo/core`) dont la **forme est la même dans les deux états** ;
- `lib/current-locale.ts` et `lib/i18n.ts` **résolvent** la langue de la requête
  et rendent `{ locale, t, path }` ; `lib/messages.ts` assemble le catalogue —
  celui de l'application, plus celui des modules **activés**, que le registre
  agrège ;
- `proxy.ts` applique le préfixe de locale aux URL, et écrit le cookie quand
  l'utilisateur suit une URL de langue.

Ce que cela interdit ailleurs : **aucune branche sur l'existence de l'i18n**. Un
écran appelle `appIntl()`, une entrée de navigation passe par `path()`, un
composant client par `useTranslations()` — et rien de tout cela ne change quand
le module est coupé. C'est ce qui empêche chaque story suivante de porter un
`if (i18n)`.

Le sélecteur de langue apparaît quand l'application **sert plusieurs langues**
(`localeRouting.locales.length > 1`), pas quand un module s'appelle `i18n` :
c'est une condition sur des données, pas sur un identifiant de module.

Deux choses ne sont pas là où on les chercherait, et c'est mesuré :

- **`createMiddleware` de `next-intl` n'est pas utilisé.** Dans le paquet
  installé (4.14.1), il réécrit chaque requête vers `/<locale><chemin>`
  (`getLocaleAsPrefix`), ce qui impose un segment `[locale]` dans
  l'arborescence — donc rend impossible « module coupé, routes servies sans
  préfixe », et déplacerait toutes les routes livrées, `/api/modules/…`
  comprises. Le reste de la bibliothèque est agnostique du routage :
  `getRequestConfig` rend la locale qu'on lui donne. Le greffon
  `createNextIntlPlugin` ne fait qu'aliaser `next-intl/config` vers
  `i18n/request.ts` ;
- **une clé de traduction manquante lève.** `onError` et `getMessageFallback`
  de `i18n/request-config.ts` refusent tous deux le repli sur le chemin de la
  clé : un écran affichant « app.account.title » ne rougirait nulle part. La
  configuration vit dans un fichier séparé de `i18n/request.ts` pour une raison
  de preuve : `tests/i18n.test.ts` la passe au vrai traducteur de `next-intl`
  avec un catalogue amputé. La garde d'avant lisait le fichier source, et la
  revue de s09 l'a neutralisée deux fois sans la faire rougir — une garde
  textuelle ne tient pas un comportement.

  Le **câblage** est une seconde question, et elle a son propre contrôle :
  `app/api/i18n-probe/route.ts` demande une clé qu'aucun catalogue ne livre, et
  `e2e/i18n.spec.ts` exige que la requête échoue. Ramener `i18n/request.ts` au
  repli silencieux laissait tout le reste vert — mesuré en seconde revue de
  s09 ; ce parcours-là rougit. La sonde est un opt-in explicite
  (`I18N_MISSING_KEY_PROBE=1`, posé par `playwright.config.ts`) : sans le
  drapeau elle répond 404, et `tests/i18n.test.ts` le vérifie.

Le cookie de langue (`app_locale`, posé par `proxy.ts`) porte `HttpOnly`,
`Secure` et `SameSite=Lax`. `docs/security.md` §1 ne fait pas d'exception pour
un cookie sans privilège, et c'est le premier cookie hors session du dépôt :
`tests/i18n.test.ts` contrôle les en-têtes `Set-Cookie` que le proxy laisse
partir, `e2e/i18n.spec.ts` les contrôle tels que le navigateur les stocke. Un
cookie lu par du JavaScript de page demanderait une story, pas une exception.

Les routes des modules n'héritent d'aucun préfixe de locale. Leur langue, elles
la reçoivent du point de composition, qui la lit dans le cookie puis dans
`Accept-Language` — par la même fonction que l'écran. Depuis s45, ce n'est plus
le `matcher` qui les exclut mais `carriesLocalePrefix` dans `proxy.ts` (voir
plus bas) : le proxy doit voir `/api` pour y poser les en-têtes de sécurité, et
le périmètre du préfixe, lui, reprend **une à une** les quatre alternatives de
l'ancien motif (`api`, `_next`, `favicon.ico`, un point n'importe où). La
première écriture de s45 n'en reprenait que deux, et la revue a mesuré que
`/v1.2/page` et `/_next/quelque-chose` recevaient alors une redirection de
locale qu'ils n'avaient jamais reçue : « à comportement identique » était faux.
`tests/security-headers.test.ts` énumère les six sondes.

## Le montage du site public

Deux fichiers, sur le modèle exact de l'i18n :

- `lib/marketing.ts` porte le **choix** — le module `marketing` est-il monté ?
  C'est le seul fichier de l'application qui connaisse `@repo/module-marketing`,
  et le seul qui regarde s'il est activé. Il rend un `MarketingSite` dont la
  **forme est la même dans les deux états** : trois listes, vides quand le
  module est coupé ;
- `app/page.tsx`, `app/legal/[document]/page.tsx`, `app/contact/page.tsx`,
  `app/sitemap.ts` et `app/robots.ts` **lisent** ce site sans jamais nommer de
  module. La racine a
  trois branches — tableau de bord pour un visiteur connecté, accueil marketing
  pour un visiteur anonyme, redirection vers la connexion quand il n'y a pas de
  section — et les deux dernières se départagent sur `sections.length`,
  c'est-à-dire sur une donnée.

La configuration (`config/marketing.ts`) n'est **validée que lorsque le module
est monté** : un dépôt qui coupe le site public n'a pas à maintenir un fichier
cohérent. Module activé, une configuration fausse arrête le démarrage en nommant
la section fautive.

`app/sitemap.ts` et `app/robots.ts` déclarent `dynamic = 'force-dynamic'`, et ce
n'est pas une commodité : ce sont des route handlers que Next met en cache par
défaut, donc évalués pendant `next build` — où `getEnv()` ne valide rien et où la
CI ne pose aucune `APP_URL`. Un plan de site figé au build porterait `undefined`
dans chacune de ses URL.

**Le service du module, lui, est câblé dans `lib/module-services.ts`** et non
dans `lib/marketing.ts`, contrairement aux organisations. La raison est mesurée :
le harnais de parcours importe `lib/marketing.ts` **hors de Next** pour en
dériver ses attentes (`e2e/support/locale.ts`), et y importer `lib/auth` — qui
lit `next/headers` — fait échouer le chargement de tous les parcours avant
qu'aucun ne s'exécute. `lib/module-services.ts`, lui, n'est importé que par la
route d'API. C'est là que le module reçoit sa connexion, son mailer, les langues
servies et `emailOfScope` — la seule fonction qui relie une inscription publique
ou un message de contact à un compte, parce que le module ne connaît pas `auth`
et n'a pas le droit de lire ses tables.

`/contact` est déclaré dans `publicPaths` : il entre donc dans le `sitemap.xml`
et obtient son `Allow: /<langue>/contact$` **ancré** dans le `robots.txt`, sans
qu'aucune liste ne soit recopiée. Son segment est aussi **réservé** dans
`lib/organizations.ts` — `tests/organizations.test.ts` dérive du disque les
segments de premier niveau et exige que chacun soit refusé à une organisation.

**Aucune requête base de données au rendu d'une page publique.** Mesuré, pas
supposé, et en deux moitiés (`tests/marketing.test.ts`) :

- **le rendu** — l'accueil public, la redirection du site coupé, une page légale
  et l'`AppShell` sont réellement exécutés, avec un compteur posé sur les
  **prototypes** de `pg`. Toute connexion ouverte par n'importe quel fichier du
  processus est donc comptée, y compris une base ouverte par un écran pour son
  compte. Ajouter une lecture de base à l'accueil, à une page légale ou au shell
  fait rougir cette mesure — vérifié en y ajoutant un vrai
  `createDatabaseClient(…).pool.query('select 1')` ;
- **la résolution de session** — le vrai service d'authentification, contre une
  vraie base, sans cookie puis avec un cookie forgé : la signature est refusée
  avant tout accès. C'est ce qui rend la première moitié vraie en production, où
  `currentViewer()` n'est pas doublé.

Ce que cette mesure ne couvre pas, et qui est dit plutôt que sous-entendu : un
composant **client** exécuté dans le navigateur ne passe par aucun de ces deux
chemins — il n'a pas d'accès à la base, par construction.

## Les en-têtes de sécurité et la politique de sécurité du contenu (s45)

`docs/security.md` §1, implémenté. **Une seule source, et c'est structurant** :
tout part de `proxy.ts`. Poser une partie des en-têtes ici et une autre dans
`headers()` de `next.config.ts` ferait partir deux `Content-Security-Policy` sur
les chemins couverts par les deux — le navigateur applique alors leur
**intersection**, et la plus stricte gagne sans que rien ne le dise.

Trois fichiers, sur le modèle du mailer et de l'i18n :

- `config/security.ts` porte le **choix du propriétaire** : les sources tierces,
  par directive, vides à la livraison. C'est le seul endroit d'où une source peut
  entrer dans la politique, et la règle est exécutable —
  `tests/security-headers.test.ts` découpe la politique construite et refuse tout
  jeton qui n'est ni un mot-clé CSP ni une ligne de ce fichier. Un domaine écrit
  en dur dans le constructeur fait échouer `pnpm test` ;
- `lib/security-headers.ts` porte la **règle** : fonction pure — mode, nonce,
  sources et chemin du collecteur arrivent **tous** en argument —, donc une
  politique de production contrôlable sans être en production ;
- `proxy.ts` **applique** : un nonce par requête, la politique posée sur les
  en-têtes de la **requête** — c'est là que Next la lit
  (`dist/server/app-render/app-render.js` → `getScriptNonceFromHeader`) pour
  noncer ses propres balises — **et** sur la réponse.

  Ce que la revue de s45 a corrigé, et qu'il ne faut pas relire à l'envers : sur
  le runtime **Node** de Next 16.3.3, ne poser la politique que sur la réponse
  ne casse **pas** l'hydratation. `dist/server/lib/router-utils/resolve-routes.js`
  recopie chaque en-tête de réponse ordinaire du proxy sur `req.headers`, donc
  elle atteint le rendu de toute façon. Le câblage explicite reste parce qu'il
  est la voie du mécanisme de surcharge `x-middleware-request-*`, probablement
  la seule sur un runtime **edge** — runtime que personne n'a mesuré ici. Le
  test unitaire le protège (`x-middleware-request-content-security-policy`).

Le `matcher` couvre désormais tout ce qui produit une réponse de l'application,
`/api` et `/robots.txt` compris ; seuls `_next/static` et `_next/image` en sont
exclus. Le préfixe de locale, lui, garde exactement son périmètre d'avant :
c'est `carriesLocalePrefix` qui le porte, en reprenant une à une les quatre
alternatives du motif d'origine, et `pnpm test` le vérifie sur six sondes —
`/api/health`, `/api/modules/…`, `/_next/…`, `/favicon.ico`, `/robots.txt`,
`/sitemap.xml`, plus `/v1.2/page` pour le point ailleurs qu'en fin de chemin.
Sans cette condition, `canonicalPath('/robots.txt')` redirige vers
`/fr/robots.txt` et le plan de site cesse d'être servi.

**Le nonce doit atteindre ce que les bibliothèques injectent, pas seulement ce
que Next émet.** `app/layout.tsx` lit `x-nonce` et le transmet à
`ThemeProvider` (`next-themes` le pose sur son script anti-clignotement et sur
le `<style>` qui coupe les transitions) et à `InlineStyleNonce`
(`react-remove-scroll`, le verrou de défilement d'un `Sheet` ou d'un
`DropdownMenu`). Un composant qui injecterait une feuille de style sans passer
par là serait refusé en production, et **muet en développement**.

**Le mode se lit sur `NODE_ENV`, et c'est l'exception qui confirme la règle du
mailer.** Là-bas, déduire de l'environnement rendrait un email capturé
indiscernable d'un email envoyé (`docs/reliability.md` §2). Ici, ce qui change
est le **bundle React lui-même** — en développement il appelle `eval` pour
reconstruire les piles serveur — et aucun drapeau ne peut décrire cela. La
lecture passe malgré tout par `@repo/config` (`getNodeEnv`), qui reste le point
d'accès unique.

Ce n'est **pas** la forme d'opt-in de la sonde de s09, qui est un drapeau
explicite : la revue de s45 a corrigé la comparaison, elles ne se ressemblent
que par le 404. Ce qui rend la dérivation sûre n'est pas non plus le repli de
`getNodeEnv` — `development` est le plus permissif des deux modes — mais la
validation au démarrage : un `NODE_ENV=prod` mal orthographié arrête le
processus en nommant la variable, et `packages/config/src/env.test.ts` l'exige.

Le développement assouplit **deux** points, mesurés, et pas un de plus :
`'unsafe-eval'` dans `script-src`, `'unsafe-inline'` dans `style-src` (Turbopack
injecte le CSS par JavaScript). **`script-src` n'a jamais `'unsafe-inline'`**, et
c'est ce qui permet à `e2e/security-headers.spec.ts` — qui tourne sur
`next dev` — de démontrer qu'un script en ligne sans nonce ne s'exécute pas.

Ce que les parcours **ne peuvent pas** voir, et il faut le savoir avant d'y
ajouter une garde : `style-src` portant `'unsafe-inline'` en développement,
aucune violation de style n'y est jamais signalée. C'est pourquoi le fichier
mesure les **causes** — tout `<style>` du document porte le nonce, le HTML servi
ne contient aucun attribut `style` — et non la seule sanction du navigateur.
Retirer le câblage du nonce laissait sinon cinq parcours sur cinq au vert.

`app/api/csp-report/route.ts` collecte les violations **en développement**, en
mémoire et borné à 50, et répond 404 en production — comme la politique n'y
déclare aucun `report-uri`. Aucun service tiers (`docs/reliability.md` §2). Les
champs du rapport sont **normalisés à l'entrée** : Zod en borne la longueur, pas
la forme, et un `blocked-uri` portant un retour à la ligne fabriquait une
seconde ligne dans le terminal du développeur — une ligne que le rapport, donc
n'importe qui, choisissait.

### Les deux écrans qu'une politique stricte oblige à écrire

`app/not-found.tsx` et `app/global-error.tsx` existent pour une raison de
sécurité autant que de produit. Sans eux, Next sert ses composants intégrés, et
la revue de s45 a mesuré sur le build de production que celui de la page 404
émet **quatre attributs `style` et un `<style>` sans nonce** — deux violations
sous la politique livrée, zéro sans elle, sur une page qu'un visiteur atteint.
Une console bruyante est exactement ce qui pousse l'agent suivant à ajouter
`'unsafe-inline'`.

Ce qui les tient : `e2e/security-headers.spec.ts` juge le HTML servi sur une
**URL inexistante** comme sur une page existante — aucun attribut `style`, aucun
`<style>` sans nonce, aucun script en ligne sans nonce — et exige que l'écran
404 offre une et une seule sortie, vers l'accueil. Une future page d'erreur qui
réintroduirait du style en ligne rougit là.

`global-error.tsx` a trois contraintes qui viennent de Next, pas d'un choix
(`node_modules/next/dist/docs/…/error.md`, §Global Error) : composant **client**,
`<html>` et `<body>` à lui, aucun export `metadata`. Il remplace
`app/layout.tsx`, donc il n'a ni shell, ni thème, ni locale de requête — son
texte vient de `lib/fallback-text.ts`, le catalogue de l'application dans la
langue du site, qui **lève** sur une clé absente comme partout ailleurs.
Reconstruire le catalogue complet aurait fait entrer le registre de modules dans
un bundle client, pour un écran dont l'existence signale que ce registre peut
être ce qui a échoué.

Mesuré sur le build de production, Chromium (revue de s45, section de clôture) :
`/fr/adresse-inexistante` → **0 violation**, `/fr/<page qui lève>` → 500 et
**0 violation**, l'écran de dernier recours rendu.
## Le montage des organisations

Un fichier, sur le modèle exact du site public :

- `lib/organizations.ts` porte le **choix** — le module `organizations` est-il
  monté ? C'est le seul fichier de l'application qui connaisse
  `@repo/module-organizations`, et le seul qui regarde s'il est activé. Il rend
  une valeur dont la **forme est la même dans les deux états** : un drapeau
  `available`, une vue à deux champs, une organisation active qui vaut `null`.
  Module coupé, ses deux lectures n'ouvrent **aucune connexion** ;
- `app/organizations/page.tsx` **lit** cette valeur sans jamais nommer de
  module : `available` est une **donnée**, comme `sections.length` l'est pour la
  racine. Module coupé, l'écran répond 404 — le même arbitrage que
  `legal/[document]` ;
- `app/invitations/accept/page.tsx` (s16) fait de même : c'est l'écran
  d'atterrissage d'un lien d'invitation, servi à un visiteur **anonyme comme
  connecté** — un anonyme y voit deux chemins, connexion (avec retour vers cette
  URL, jeton compris) et inscription. **Rien n'y est accepté en `GET`** : un
  aperçu de lien — client de messagerie, antivirus, proxy — suit les `GET` et
  consommerait le jeton à usage unique avant l'invité. L'acceptation est un
  `<form method="post">` vers la route du module.

Ce fichier donne aussi au module ce qu'il ne peut pas se procurer pour envoyer
un email : le **port** `Mailer` (construit par `lib/mailer.ts`, jamais un
fournisseur), l'`APP_URL` validée par `lib/auth-config.ts` — jamais déduite d'un
en-tête `Host`, sans quoi un lien d'invitation pourrait pointer vers le domaine
d'un attaquant —, et la locale **du site**, parce qu'un destinataire dont rien
n'est connu n'en a pas d'autre.

C'est aussi ce fichier qui donne au module deux choses qu'il ne peut pas se
procurer : la **connexion** (ADR 020) et les **identifiants publics réservés**.
Ces derniers sont dérivés — segments de tête de la navigation du registre,
langues servies — plus la liste des écrans que l'application sert elle-même.
Cette dernière est écrite, et **vérifiée par une commande** :
`tests/organizations.test.ts` lit les segments de premier niveau réellement
présents sous `apps/web/app` et exige que chacun soit refusé. Ajouter un écran
sans réserver son segment fait rougir `pnpm test` — sans quoi une organisation
pourrait s'appeler `sign-in`.

**`resolveDataOwner` est la fonction unique** qui dit à qui appartient une
donnée (`@repo/core`, `docs/security.md` §3). `dataOwnerOf(session)`, exportée
par `lib/organizations.ts`, l'appelle — c'est elle que les écrans et les routes
emploient, et son appelant est identique que le module soit activé ou non :
c'est ce qui empêche le mode mono-utilisateur de dupliquer chaque requête. Elle
reçoit la session plutôt que de la lire elle-même : lire le cookie ici
importerait `next/headers` et rendrait ce fichier inutilisable hors d'un
contexte de requête.

Ce qu'elle rend est le périmètre **au moment de l'appel**, et l'appartenance y
est jointe à la lecture : un compte retiré d'une organisation retombe
immédiatement sur son périmètre de compte, sans qu'aucune ligne n'ait été
nettoyée (ADR 025).

## Le montage du stockage (s18)

Deux fichiers, sur le modèle exact du mailer :

- `lib/storage-config.ts` porte la **règle** — un seau S3 complet, ou
  `STORAGE_LOCAL_DIRECTORY`, jamais les deux, jamais rien ;
- `lib/storage.ts` **construit** l'implémentation correspondante. C'est le seul
  fichier de l'application qui connaisse `@repo/adapter-s3`,
  `@repo/storage-testing` et `@repo/module-storage`. Le code métier ne connaît
  que le port `Storage`.

**Une différence avec le mailer, et elle est structurante** : le mailer est
exigé de toute application qui démarre, le stockage **seulement quand le module
`storage` est activé**. `next.config.ts` lit donc `enabledModules` avant
d'appliquer la règle. Un dépôt qui coupe le module n'a aucune variable à
renseigner, et l'avatar retombe sur les initiales sans erreur — c'est le
critère 7 de la story.

| Configuration | Ce qui se passe |
|---|---|
| `STORAGE_LOCAL_DIRECTORY=.storage` | les fichiers sont écrits sur le disque, l'URL présignée reste sur **notre origine**. C'est l'état livré |
| les quatre `STORAGE_S3_*` | seau réel (S3, R2, MinIO, Spaces) ; `STORAGE_S3_ENDPOINT` en plus hors AWS |
| les deux | refusé par le schéma d'environnement : le choix serait ambigu |
| un seau à moitié renseigné | **le démarrage échoue en nommant la variable absente** |
| ni l'un ni l'autre, module activé | **le démarrage échoue en nommant les deux voies** |
| ni l'un ni l'autre, module coupé | rien n'est exigé, rien n'est monté |
| un seau réel dont l'origine n'est pas dans `config/security.ts` | **le démarrage échoue en nommant l'origine et le champ** |
| `STORAGE_LOCAL_DIRECTORY` avec `NODE_ENV=production` | **refusé au démarrage, en nommant la variable** |

**Le geste que le propriétaire doit faire, et que le démarrage exige** : avec un
vrai seau, le navigateur téléverse **directement** vers son domaine, donc cette
origine doit entrer dans `config/security.ts`, champ `connect` —
`connect-src 'self'` la refuse autrement. La lecture, elle, ne demande rien :
l'avatar est **servi par l'application** (ADR 032), donc `img-src 'self'`
suffit.

C'était écrit dans `.env.example` et nulle part exécuté : quatre variables
renseignées passaient `pnpm dev`, `pnpm build` et la CI, et le téléversement
échouait **chez le navigateur du premier utilisateur**, sans trace côté serveur
(constat F3 de la revue de s18). `lib/storage-config.ts` **lit** désormais
`config/security.ts` — il ne le modifie pas, ce fichier appartient à s45 — et
refuse de démarrer en nommant l'origine attendue. `tests/storage.test.ts` le
tient dans les deux sens.

Les deux dernières lignes du tableau sont des **défenses en profondeur**, sur le
modèle d'`OAUTH_LOCAL_PROVIDER` : `NODE_ENV` n'arme jamais rien, il
**restreint**. Un `.env` recopié d'un poste écrirait sinon les avatars sur le
disque éphémère d'une fonction serverless, et le symptôme — l'image qui
disparaît — arriverait au premier redéploiement, longtemps après la cause.

**L'avatar de `/account` est celui de la personne**, et les trois chemins —
écrire, afficher, retirer — passent par la même résolution de propriétaire
(`ownerOf`, donnée au module, rejouée par `avatarOfUser`). La première écriture
donnait `dataOwnerOf` à l'écriture et fabriquait le périmètre du compte à
l'affichage : sous une organisation courante, le fichier partait dans
`avatars/organization/…`, l'écran ne changeait pas, et « Retirer » supprimait la
ressource **partagée** de l'organisation en rendant 204, sans aucune garde de
rôle (constat F1). `e2e/storage.spec.ts` crée une organisation et exige que la
photo du compte lui survive.

Deux surfaces en héritent : le menu de compte du shell et la carte « Photo de
profil » de `/account`. Le composant qui téléverse
(`app/account/avatar-form.tsx`) vit ici et non dans le module, pour la raison
déjà donnée à `app/public-form.tsx` : il appelle `fetch`, et `eslint.config.ts`
refuse un appel réseau dans un module hors de sa porte bornée.
## Le montage de la facturation (s19)

Quatre fichiers, sur le modèle exact du mailer — **une règle par fichier, et le
montage à part** :

- `lib/billing-config.ts` porte la **règle du fournisseur** — quelle
  configuration décide de qui encaisse, et le refus quand aucune n'est donnée.
  Il ne dépend que de `@repo/config`, et `next.config.ts` le réapplique au
  **démarrage** ;
- `lib/billing-catalogue.ts` porte le **catalogue validé**. Il est appelé aux
  deux bouts : par `next.config.ts` au démarrage — c'est le premier critère de
  la story, « une offre malformée fait échouer le démarrage » — et par
  `lib/billing.ts` à la construction du service, qui reçoit un catalogue déjà
  validé. Sans le premier appel, une offre malformée ne se voyait qu'à la
  première requête qui construisait le service, et cette requête pouvait être le
  **webhook public**, qui répondait alors 500 (constat F2 de la revue) ;
- `lib/billing-permission.ts` porte le **droit de gérer la facturation** : il
  pose la question au module `organizations`, il ne compare aucun rôle. Il est
  séparé pour être branché, dans `tests/billing.test.ts`, sur la vraie vue de ce
  module avec un rôle réel en base — neutralisé en `return true`, il laissait
  sinon la suite entière verte (constat F3) ;
- `lib/billing.ts` **construit** l'implémentation correspondante. C'est le seul
  fichier de l'application qui connaisse `@repo/module-billing`,
  `@repo/adapter-stripe` et `@repo/payments-testing`.

Il donne aussi au module l'**adresse** du compte qui ouvre le checkout, par un
import **différé** de `lib/auth` : ce fichier est chargé hors de Next par
`e2e/billing.spec.ts` et par `scripts/billing-reconcile.ts`, et un import
statique de `next/headers` y ferait échouer tous les parcours — la mesure qui a
déjà décidé du câblage de `marketing` dans `lib/module-services.ts`.

`billing.prepare()` accepte **trois** substitutions, et trois seulement : la
connexion, le port `Payments` et l'`APP_URL`. C'est la même ouverture que
`createAppMailer({ env })` (« injecté dans les tests ; lu au démarrage sinon »),
et elle existe pour une raison mesurée : les deux gardes qui vivent **ici** — la
permission et l'adresse du compte — ne pouvaient être éprouvées qu'en
reconstruisant cette composition à côté, si bien que les neutraliser à leur
propre ligne laissait toute la suite verte. `tests/billing.test.ts` branche
désormais le vrai objet `billing` sur la base du test. Ce que l'ouverture ne
donne pas est le point : le périmètre, la permission, les sièges, l'adresse et le
catalogue restent ceux de l'application, quel que soit l'appelant.

Trois états, et il faut en choisir un :

| Configuration | Ce qui se passe |
|---|---|
| `STRIPE_SECRET_KEY` **et** `STRIPE_WEBHOOK_SECRET` | le vrai fournisseur |
| `PAYMENTS_LOCAL_MODE=1`, aucune clé | la simulation locale, sans réseau |
| ni l'un ni l'autre, **module activé** | **le démarrage échoue en nommant les trois variables** |
| une clé sans son secret de webhook | refusé par le schéma d'environnement |
| le drapeau **et** une clé | refusé : le choix serait implicite |
| le drapeau **et** `NODE_ENV=production` | **refusé au démarrage, en nommant la variable** |

La dernière ligne est une **défense en profondeur**, comme pour le fournisseur
OAuth de développement : la simulation accorde un abonnement complet **sans
paiement**, à n'importe quel compte. La règle du socle « jamais déduit de
`NODE_ENV` » reste tenue — le drapeau est l'unique opt-in, `NODE_ENV` ne
l'active jamais, il le **restreint**.

**La garde de démarrage ne s'applique que si le module est activé** : c'est la
seule des quatre dans ce cas. Un projet qui ne vend rien n'a pas à configurer un
fournisseur de paiement, et `next.config.ts` lit `enabledModules` pour le savoir.

**Ce dont le harnais a besoin se déclare dans sa configuration.** Le mode local
du paiement est posé par `playwright.config.ts` (le serveur que Playwright
démarre) **et** par le job `quality` de `.github/workflows/ci.yml`, jamais laissé
au `.env` d'un poste : sans lui, `next dev` affiche `✓ Ready` puis meurt sur la
garde de démarrage, et `pnpm test:e2e` échoue au lancement du serveur — dans les
deux branches de la matrice, le module restant activé en configuration « socle ».
`tests/env-wiring.test.ts` démarre la configuration de Next avec l'union de ces
deux fichiers et rien d'autre, et vérifie sur chacun qu'aucun fournisseur réel
n'y est joignable. Conséquence à connaître : un poste muni d'une vraie clé Stripe
verra `pnpm test:e2e` refuser de démarrer en nommant le conflit — ces parcours ne
sauraient de toute façon pas se dérouler contre un vrai fournisseur.

`GET /api/billing-local-checkout` est le **checkout simulé** : elle n'existe que
sous le drapeau (404 sinon), elle fabrique les événements que le fournisseur
enverrait, les signe, et les fait passer par la **vraie** route de webhook du
module. C'est la seule route du dépôt qui écrive en `GET`, et c'est assumé : elle
tient la place d'une page tierce vers laquelle le navigateur **navigue**.

Elle exige une **session**, et le périmètre de cette session-là : les
identifiants de session locale sont déterministes, donc devinables, et sans
cette garde un visiteur terminait le checkout ouvert par quelqu'un d'autre
(constat F7 de la revue). Le refus est **404** dans les trois cas — mode local
absent, appelant anonyme, session d'un autre périmètre.

**Ce que la politique de sécurité du contenu n'a pas eu à changer, et pourquoi
c'est fragile.** Une redirection 303 vers `checkout.stripe.com` depuis une
soumission de formulaire serait soumise à `form-action 'self'` dans les
navigateurs fondés sur Chromium et WebKit : il faudrait déclarer deux origines
tierces dans `config/security.ts`. `app/billing-actions.tsx` navigue donc par
`window.location.assign`, qu'aucune directive livrée ne borne. **La conséquence,
écrite plutôt que découverte** : le tunnel de paiement ne fonctionne pas sans
JavaScript — le bouton reste éteint et un `<noscript>` le dit. Une story qui
voudrait un formulaire natif vers le fournisseur devra déclarer ces origines,
avec la justification écrite qu'exige `docs/security.md` §1 — voir
`docs/research/s19-subscribe-stripe.md` §7.

## Le montage du consentement (s36)

Un fichier, sur le modèle exact du site public :

- `lib/consent.ts` porte le **choix** — le module `consent` est-il monté ? —
  **et le registre des scripts non essentiels** (ADR 036). C'est le seul fichier
  de l'application qui regarde si ce module est activé, et le seul qui sache
  qu'un script non essentiel existe. Ailleurs — le shell, l'écran `/cookies`, la
  carte de compte — on lit `consent`, dont la forme est la même dans les deux
  états : un drapeau `available`, une liste de scripts vide.

| | module activé | module coupé |
|---|---|---|
| `/cookies` | l'écran | **404** |
| bannière | s'il reste une catégorie non décidée | **jamais** |
| scripts injectés | ceux dont la catégorie est accordée | **aucun** |
| cookie `app_consent` | posé au choix du visiteur | jamais posé |

**Le registre n'est pas au contrat de module, et c'est une décision** (ADR 036) :
y ajouter une quinzième clé obligerait à rouvrir les sept modules écrits **et**
`docs/architecture.md`. s39 ajoutera trois lignes à `lib/consent.ts` —
« module d'analytique monté ⇒ le script du fournisseur entre dans la liste » —
exactement comme `lib/marketing.ts` décide de l'existence du site public.

**Le consentement ne touche jamais la base** (ADR 035) : le choix vit dans le
cookie `app_consent` (`HttpOnly`, `Secure`, `SameSite=Lax`, six mois), écrit par
la route du module. Un visiteur anonyme a exactement le même droit qu'un compte,
et l'enregistrer côté serveur demanderait de le pister pour noter son refus
d'être pisté.

**Deux points d'accès, et c'est le cœur de la story** (finding F57 de la revue
des stories) :

- le **lien du pied de page** du site public, fourni par l'application au module
  `marketing` (`footerLinks`) et non déclaré chez lui — sinon il disparaîtrait
  avec le site public ;
- la **carte « Cookies » de `/account`**, rendue quel que soit l'état de
  `marketing`. Sur une installation « site public coupé, analytique activée », il
  est le seul moyen de retirer son consentement.

Les deux mènent à `/cookies`, servi par l'application. Son segment est
**réservé** dans `lib/organizations.ts`, et l'identifiant vient du module
(`CONSENT_SCREEN_SEGMENT`) : `tests/organizations.test.ts` dérive du disque les
segments de premier niveau et exige que chacun soit refusé.

**Toute la surface fonctionne sans JavaScript**, et c'est structurel : refuser
des cookies ne peut pas dépendre du script qu'on refuse. La bannière et l'écran
de préférences sont des `<form method="post">` natifs avec des `<input
type="checkbox">` natifs — d'où le `Checkbox` de `packages/ui`, qui n'est **pas**
porté par Radix. Aucun `<noscript>` n'est nécessaire ici : il n'y a pas de bouton
éteint à expliquer.

**Le nonce descend jusqu'au shell, et il est obligatoire.** `script-src` porte
`'strict-dynamic'` (s45) : un navigateur qui comprend CSP niveau 3 **ignore
alors `'self'` et toute source d'hôte**, si bien qu'un `<script src>` sans nonce
est refusé — y compris depuis notre propre origine. `app/layout.tsx` lit `x-nonce`
et le passe à `AppShell`, qui le passe à `ConsentScripts`. Mesuré sous le build
de production en remplaçant le nonce par une valeur fausse : les deux scripts
sont bloqués, `e2e/consent.spec.ts` rougit sur deux parcours, et la console dit
« Note that 'strict-dynamic' is present, so host-based allowlisting is disabled ».

**La bannière réserve sa place au lieu de couvrir la page.** Posée en surface
fixe sans réserve, elle interceptait les clics de **dix** parcours — pied de
page marketing, formulaires de fin d'écran, actions d'une ligne de membre à
390 px. Ce n'était pas un défaut de test : un visiteur ne pouvait pas atteindre
le bas de la page avant d'avoir répondu, ce qui rend la bannière modale par
accident. `app/app-shell.tsx` ajoute donc `pb-64 md:pb-36` au contenu tant que
`bannerRequired` — mesuré au navigateur sous le build de production : la
bannière fait 241 px à 390 px et 121 px à 1280 px, pour 256 px et 144 px
réservés.

`app/api/consent-probe/[script]/route.ts` sert les **scripts de démonstration**,
un par catégorie, sur opt-in explicite `CONSENT_SCRIPT_PROBE=1` — même forme que
la sonde de traduction manquante de s09, et posé par `playwright.config.ts`, pas
par le `.env` d'un poste. Sans le drapeau : aucun script déclaré, aucune
bannière, aucun cookie, et la route répond 404. C'est l'état livré.

## Le montage du mailer

Deux fichiers :

- `lib/mailer-config.ts` porte la **règle** — quelle configuration décide de
  quel mailer, et le refus quand aucune n'est donnée. Il ne dépend que de
  `@repo/config` ;
- `lib/mailer.ts` **construit** l'implémentation correspondante. C'est le seul
  fichier du dépôt qui sache à la fois qu'il existe un fournisseur d'emails, une
  capture locale et des templates. Le code métier ne connaît que le port
  `Mailer` : il ne saura jamais lequel des deux l'exécute.

Séparés parce que `next.config.ts` réapplique la règle au **démarrage** : le
montage et la garde de démarrage ne peuvent pas diverger, et la configuration de
Next n'a pas à charger le SDK du fournisseur, React Email et le registre de
modules pour poser une question à trois variables.

**Le choix se fait sur la configuration, jamais sur `NODE_ENV`.** Un mailer
conditionné par l'environnement est intestable et se trompera un jour
d'environnement — en envoyant de vrais emails depuis une suite, ou en écrivant
sur disque en production. `tests/mailer.test.ts` croise les deux axes
(production sans clé, développement avec clé) : remplacer la condition par
`NODE_ENV` fait rougir les deux cas.

Deux configurations, et il faut en choisir une :

| Configuration | Ce qui se passe |
|---|---|
| `RESEND_API_KEY` (+ `EMAIL_FROM`) | envoi réel chez le fournisseur |
| `EMAIL_LOCAL_CAPTURE=1` | l'email est rendu et écrit dans `.mail/`, ignoré par git, consultable dans un navigateur (`docs/reliability.md` §2) |
| les deux | refusé par le schéma d'environnement : le choix serait ambigu |
| ni l'un ni l'autre | **le démarrage de cette application échoue en nommant les deux variables** |

La capture locale est un **opt-in, pas un repli**. En faire la conséquence
automatique d'une clé absente rendait `{ok:true}` sur un email que personne ne
recevrait, en production comme ailleurs, sans qu'aucun appelant puisse le
distinguer d'un envoi réussi (revue de s06, F3).

**L'exigence est celle de cette application, pas celle du dépôt.** Le schéma de
`@repo/config` juge la forme des variables pour tout processus qui lit cet
environnement ; il n'impose aucun mailer, sans quoi `pnpm db:migrate` — un
conteneur muni du seul `DATABASE_URL` — ne s'exécuterait plus (revue de s06,
G3). C'est ce qui monte un mailer qui exige un choix : `next.config.ts` au
démarrage, `lib/mailer.ts` au montage. Le second n'est pas redondant : `getEnv`
ne valide rien en phase de build ni sous `SKIP_ENV_VALIDATION`, et c'est aussi
pourquoi la règle normalise elle-même les valeurs vides — sur ces chemins, le
`RESEND_API_KEY=` que livre `.env.example` se lisait « clé renseignée » et la
branche fournisseur l'emportait sur la capture demandée (revue de s06, G2).

Le montage fixe aussi le **budget d'attente** : deux essais de 4 s, recul
compris, pour tenir sous les dix secondes d'une fonction serverless — aux
défauts de l'adapter, un fournisseur muet faisait attendre ~31 s.

La configuration DNS qui rend l'envoi réel crédible est dans
`docs/deliverability.md`.

## Tests

- parcours navigateur : `e2e/*.spec.ts` à la racine du dépôt (`pnpm test:e2e`) ;
- tests de câblage et de route : `tests/` à la racine (`pnpm test`).

Cette application n'a pas de tests dans son propre dossier : ce qui la concerne
traverse au moins un package.

## `next-env.d.ts` n'est pas versionné

Next réécrit ce fichier à chaque `dev` et à chaque `build`, avec un chemin qui
change selon la commande (`.next/dev/types/…` contre `.next/types/…`, voir
`next/dist/lib/typescript/writeAppTypeDeclarations.js`). Versionné, il salissait
l'arbre après chaque build — c'était le finding N5 de la revue de s01, et il
rendait impossible le critère « après `pnpm build`, `git status` reste propre ».

Il est donc dans `.gitignore`. Sur un clone vierge, avant tout `dev` ou `build`,
le fichier n'existe pas : les deux directives stables qu'il portait
(`/// <reference types="next" />` et `next/image-types/global`) vivent dans
`types/next.d.ts`, versionné. `pnpm typecheck` passe donc sur un clone neuf sans
dépendre d'un artefact généré. Les types de routes (`.next/types/**`) restent
absents tant que rien n'a été construit, ce qui est correct : ils ne décrivent
que des routes déjà compilées.

## Le bloc `nextjs-agent-rules` ci-dessous est versionné, et c'est un choix

Next l'écrit et le réinsère à chaque `next dev`
(`node_modules/next/dist/server/lib/generate-agent-files.js`). Il n'existe aucun
moyen d'ignorer une *portion* de fichier : ne pas le versionner rendrait
`apps/web/AGENTS.md` modifié après chaque démarrage, donc après chaque
`pnpm test:e2e`, et ferait échouer en permanence le critère « après le build,
`git status` reste propre ». Versionné, l'upsert est un no-op.

Le jour où une montée de Next change ce texte, l'étape « l'arbre reste propre »
de la CI — placée **après** les parcours, précisément pour cela — rougira. La
correction attendue est alors de recommitter le bloc tel que Next l'écrit, pas
de le supprimer.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
