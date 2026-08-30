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
  référence : `@repo/module-demo-enabled` et `@repo/module-demo-disabled`
  aujourd'hui. Aucun fichier de `apps/web` n'importe un module directement ;
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

`app/navigation.tsx` affiche `moduleRegistry.navigation` sans condition. Ajouter
un `if` ici reviendrait à masquer une entrée au lieu de ne pas l'avoir.

## Le montage du mailer

`lib/mailer.ts` est le seul fichier du dépôt qui sache à la fois qu'il existe un
fournisseur d'emails, une capture locale et des templates. Le code métier ne
connaît que le port `Mailer` : il ne saura jamais lequel des deux l'exécute.

**Le choix se fait sur la présence de `RESEND_API_KEY`, jamais sur `NODE_ENV`.**
Un mailer conditionné par l'environnement est intestable et se trompera un jour
d'environnement — en envoyant de vrais emails depuis une suite, ou en écrivant
sur disque en production. `tests/mailer.test.ts` croise les deux axes
(production sans clé, développement avec clé) : remplacer la condition par
`NODE_ENV` fait rougir les deux cas.

Sans clé, l'application **dégrade** (`docs/reliability.md` §2) : l'email est
rendu et écrit dans `.mail/`, ignoré par git, consultable dans un navigateur.
Elle ne refuse pas de démarrer. La configuration DNS qui rend l'envoi réel
crédible est dans `docs/deliverability.md`.

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
