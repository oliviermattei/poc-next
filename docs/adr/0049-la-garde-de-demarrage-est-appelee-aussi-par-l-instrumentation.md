# ADR 049 — La garde de démarrage est appelée aussi par l'instrumentation, que la sortie autonome atteint

- Status: accepted
- Date: 2026-09-03

L'application valide sa configuration au chargement de `apps/web/next.config.ts`. Mais `output: 'standalone'`, nécessaire pour ne pas embarquer tout le `node_modules` du monorepo dans l'image, sérialise la configuration Next dans `server.js` : `next.config.ts` n'est plus exécuté au démarrage du serveur autonome. Une image démarrée sans aucune variable affichait `✓ Ready` et répondait 503 sur `/api/health` indéfiniment — un déploiement cassé qui a l'air vert pour son orchestrateur.

**La garde vit une fois, dans `apps/web/lib/startup.ts`, et deux points l'appellent** : `next.config.ts` (`next dev`, `next build`, avec la phase que Next transmet) et `apps/web/instrumentation.ts`, seul point que Next appelle une fois par instance de serveur en sortie autonome. Le refus (`refuseStartupOnInvalidConfiguration`) **sort en code 1** en nommant la variable fautive : une exception levée dans `register` laisse Next journaliser « Failed to prepare server » et garder le processus vivant, à répondre 500.

`instrumentation.ts` est aussi compilé pour le runtime *edge*, où `node:fs` n'existe pas — même la présence lexicale de `process.exit` y casse la compilation. Il lit donc `process.env.NEXT_RUNTIME` sous forme littérale, que Next remplace par une constante et dont il élimine la branche, puis importe tout le reste dynamiquement. C'est l'unique lecture directe de `process.env` de l'application, et une exception explicite à la règle de `docs/security.md` qui réserve l'environnement à `@repo/config` : elle ne lit aucune configuration.

## Considered options

- **Une indirection `isNodeRuntime()` dans `@repo/config`** — rejeté : elle retire la constante, Next ne plie plus la condition, et les imports Node reviennent dans le paquet edge.
- **Valider à la première requête** — rejeté : un orchestrateur ne lit qu'un code de sortie et une sonde, et le déploiement précédent aurait déjà été remplacé.

## Consequences

- Toute vérification de démarrage s'ajoute dans `lib/startup.ts` ; l'ajouter à un seul des deux points rouvre le trou de l'autre côté (`apps/web/AGENTS.md`).
- `tests/deployment.test.ts` fait rougir le retrait de la garde, et le job `image` de la CI démarre l'image sans variable en exigeant une sortie non nulle qui nomme `DATABASE_URL`. Que le refus arrive avant que le serveur accepte une requête n'est pas prouvé (issue #146). Sur une plateforme serverless, aucun orchestrateur ne lit de code de sortie : la sonde `/api/health` reste le signal.
