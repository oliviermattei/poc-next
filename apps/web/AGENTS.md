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
  référence : `@repo/module-auth`, `@repo/module-demo-enabled` et
  `@repo/module-demo-disabled` aujourd'hui. Un seul fichier fait exception et
  importe un module directement — `lib/auth.ts`, le point de composition de
  l'authentification (voir plus bas) ;
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
