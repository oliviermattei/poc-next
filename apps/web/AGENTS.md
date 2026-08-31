# apps/web — règles locales

Application Next.js (App Router). Elle **monte** l'API et rend les écrans ; elle
n'héberge aucune règle métier — celles-ci vivent dans la couche `domain` d'un
module (`packages/modules/<module>/src/domain`).

## Imports autorisés

- `@repo/config` pour l'environnement, `@repo/config/server` pour ce qui lit un
  fichier ;
- `@repo/db` pour la base ;
- `@repo/core` pour le registre de modules ;
- `@repo/ports` pour le port `Mailer`, `@repo/adapter-resend` pour son unique
  implémentation, `@repo/emails` pour le rendu des templates et
  `@repo/mailer-testing` pour la capture locale — **uniquement** dans
  `lib/mailer.ts`, qui est le point de composition du mailer ;
- les modules du projet, **uniquement** parce que `config/features.ts` les
  référence : `@repo/module-auth`, `@repo/module-i18n`,
  `@repo/module-marketing`, `@repo/module-demo-enabled` et
  `@repo/module-demo-disabled` aujourd'hui. Trois fichiers font exception et
  importent un module directement — `lib/auth.ts`, le point de composition de
  l'authentification, `lib/locale-routing.ts`, celui de l'i18n, et
  `lib/marketing.ts`, celui du site public (voir plus bas). Les écrans du site
  public importent en plus `@repo/module-marketing/presentation`, le second
  point d'entrée du module : ses composants React n'ont pas leur place dans le
  barril que lit `config/features.ts`, qu'aucun outil du dépôt ne compile en
  JSX (**ADR 024**, la règle de tout module à composants) ;
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
- `geist` dans `app/layout.tsx` uniquement : les deux polices, chargées par
  `next/font`, donc servies par l'application. Une police servie par un domaine
  externe serait un script tiers, soumis au consentement de s36 ;
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
  ajouté sans être rendu là fait rougir la garde de couverture du même fichier ;
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

Deux composants, `app/auth-form.tsx` et `app/account/account-form.tsx`, et deux
règles que tout écran hérite d'eux :

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

`e2e/app-shell.spec.ts` le prouve dans un contexte sans JavaScript, et **sans
reprise** (`retries: 0`) : c'est une reprise qui avait fait passer cette fuite
pour une instabilité de test.

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

Le proxy ne voit pas `/api` (son `matcher` l'exclut) : les routes des modules
n'héritent d'aucun préfixe de locale. Leur langue, elles la reçoivent du point
de composition, qui la lit dans le cookie puis dans `Accept-Language` — par la
même fonction que l'écran.

## Le montage du site public

Deux fichiers, sur le modèle exact de l'i18n :

- `lib/marketing.ts` porte le **choix** — le module `marketing` est-il monté ?
  C'est le seul fichier de l'application qui connaisse `@repo/module-marketing`,
  et le seul qui regarde s'il est activé. Il rend un `MarketingSite` dont la
  **forme est la même dans les deux états** : trois listes, vides quand le
  module est coupé ;
- `app/page.tsx`, `app/legal/[document]/page.tsx`, `app/sitemap.ts` et
  `app/robots.ts` **lisent** ce site sans jamais nommer de module. La racine a
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
