# ADR 049 — La garde de démarrage vit dans l'instrumentation, que la sortie autonome atteint

- Status: accepted
- Date: 2026-09-03
- Scope: story s27-deployment

## Context

Depuis s01, l'application valide son environnement au **chargement de
`apps/web/next.config.ts`** : `assertStartupEnv` lève en nommant chaque variable
fautive, et `pnpm dev` refuse de démarrer sur une configuration incomplète.

s27 livre l'image de production, donc `output: 'standalone'` — sans lui, l'image
embarque tout le `node_modules` d'un monorepo pnpm. Et ce réglage déplace le
point de démarrage. Mesuré dans le `server.js` produit :

```
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)
```

La configuration est **sérialisée en littéral** au moment du build :
`next.config.ts` n'est plus exécuté au démarrage du serveur autonome. La
première image de la story démarrait donc avec un environnement entièrement
vide, affichait `✓ Ready`, et répondait 503 sur `/api/health` — indéfiniment.
Un conteneur dans cet état est « running » pour son orchestrateur : un
déploiement cassé qui a l'air vert, ce que `docs/reliability.md` interdit.

La frontière était déjà écrite comme telle dans `packages/config/src/env.ts`
(constats N15/N16 de la revue de s01), sans qu'aucun point de démarrage ne la
referme.

Next expose un seul point appelé une fois par instance de serveur, en `next dev`,
en `next start` et en sortie autonome : `instrumentation.ts`. Il porte une
contrainte propre — Next le compile **une fois par runtime**, y compris pour le
paquet *edge*, où `node:fs` et `node:path` n'existent pas. Mesuré sans garde de
runtime : « Ecmascript file had an error », trace d'import
`./packages/config/src/dotenv.ts` → `./apps/web/instrumentation.ts`. La garde
n'est possible que si Next **élimine la branche** à la compilation, ce qu'il ne
fait que sur la forme littérale `process.env.NEXT_RUNTIME`.

Or `docs/security.md` §5 interdit de lire `process.env` hors du module de
configuration.

## Decision

**La garde de démarrage est appelée par deux points d'entrée, et le second lit
`process.env.NEXT_RUNTIME` directement.**

- `apps/web/lib/startup.ts` porte la garde, une fois : environnement, catalogue
  d'offres, fonctionnalités réservées, mailer, OAuth, stockage, paiement.
- `apps/web/next.config.ts` l'appelle avec la phase que Next lui transmet — c'est
  le chemin de `next dev` et de `next build`.
- `apps/web/instrumentation.ts` l'appelle au démarrage de chaque instance de
  serveur — c'est **le seul des deux que la sortie autonome atteigne**. Il sort
  en **code 1** en nommant la variable fautive, plutôt que de lever : mesuré,
  une exception y laisse Next journaliser « Failed to prepare server » et
  **laisse le processus vivant**, à répondre 500 sur chaque requête.
- Ce fichier lit `process.env.NEXT_RUNTIME` sous forme littérale, et importe
  tout le reste **dynamiquement**, après la garde. C'est l'unique lecture
  directe de `process.env` de l'application, et une **exception explicite** à
  `docs/security.md` §5 : elle ne lit aucune configuration, seulement le runtime
  que Next remplace par un littéral à la compilation.

## Considered options

- **Garder la garde dans le seul `next.config.ts`** — rejeté parce que le
  fichier n'est plus exécuté au démarrage en sortie autonome : c'est exactement
  le trou mesuré, une image qui démarre sans rien valider et dégrade en 503
  silencieux.
- **Renoncer à `output: 'standalone'`** — rejeté : l'image embarquerait alors le
  `node_modules` complet d'un monorepo pnpm, et il faudrait y installer pnpm et
  le dépôt pour démarrer. La surface de l'image d'exécution est aussi une
  surface de sécurité ; la mesure de l'image livrée est de 307 Mo, dont 74,8 Mo
  de contenu.
- **Passer par une indirection dans `@repo/config`** (une fonction
  `isNodeRuntime()`) — rejeté parce qu'elle **retire la constante** : Next ne
  peut plus plier la condition à la compilation, la branche survit, et les
  imports Node reviennent dans le paquet *edge*, où la compilation échoue.
  Vérifié sur le paquet edge produit : ni `NEXT_RUNTIME`, ni
  `assertStartupConfiguration`, ni `node:fs` n'y apparaissent — c'est le
  remplacement littéral qui les fait disparaître.
- **Valider à la première requête** (dans un middleware ou une route) — rejeté :
  la validation ne serait plus un démarrage. Un orchestrateur ne lit qu'un code
  de sortie et une sonde ; une application qui répond 500 à chaque requête reste
  « running », et le déploiement précédent aurait déjà été remplacé.

## Consequences

- **Deux points de démarrage, une seule garde.** Toute vérification ajoutée au
  démarrage se met dans `apps/web/lib/startup.ts` ; l'ajouter à un seul des deux
  points rouvre le trou du côté qu'on n'a pas regardé. `apps/web/AGENTS.md` porte
  la règle.
- **`apps/web` porte une exception documentée à `docs/security.md` §5.** Elle est
  bornée à `NEXT_RUNTIME`, dans `instrumentation.ts`, et justifiée à trois
  endroits (le fichier, `apps/web/AGENTS.md`, `docs/deployment.md`). Une seconde
  lecture directe de `process.env` dans `apps/web` n'hérite d'aucune de ces
  raisons.
- **Ce qu'un test garde** : `tests/deployment.test.ts` fait rougir la
  suppression de la garde au point de composition (mesuré : 1 rouge), et le job
  `image` de la CI démarre l'image **sans aucune variable** en exigeant une
  sortie non nulle qui nomme `DATABASE_URL`. Sans ce second contrôle, une image
  construite et jamais démarrée ne prouverait rien.
- **Ce qui ne change pas en serverless.** Sur Vercel, `instrumentation.ts`
  s'exécute par instance de fonction, mais aucun orchestrateur n'y lit de code de
  sortie : la sonde `/api/health` y reste le signal. Non mesuré sur Vercel —
  `docs/deployment.md` et `docs/reliability.md` le disent aussi.
