# packages/jobs-testing — règles locales

Outils de test et de développement du port `Jobs` (s33). **Ce ne sont pas des
fournisseurs** (ADR 008) : la seule implémentation livrée est Inngest, dans
`@repo/adapter-inngest`, et rien de ce que contient ce package ne rend légitime
un adaptateur trigger.dev, QStash ou BullMQ — ils sont au cimetière du PRD.

Même statut et même gabarit que `@repo/mailer-testing`, `@repo/storage-testing`
et `@repo/payments-testing`.

## Deux outils, deux emplois qu'il ne faut pas confondre

| Outil | Emploi | Ce qu'il fait |
|---|---|---|
| `createRecordingJobs` | le régime de **CI** (critère 2 de s33) | enregistre les émissions — leur nom **et leur charge utile** — sans rien exécuter |
| `createInMemoryJobs` | le **mode local** (critère 9) | exécute pour de vrai, en mémoire, sans clé, sans réseau et sans service |

Le second est du code que l'application monte réellement — `JOBS_LOCAL_RUNNER=1`,
opt-in explicite, jamais déduit de `NODE_ENV`. Ce qu'il **ne** fait **pas**, et
qui est écrit plutôt que sous-entendu : sa file ne survit pas au processus, et
deux instances exécuteraient chacune la même échéance. C'est pour cela que
`docs/deployment.md` le réserve à un déploiement à une seule instance.

La doublure d'enregistrement **refuse elle aussi une tâche inconnue**, et ce
n'est pas du zèle : une doublure plus permissive que le serveur mesure la
doublure. Un test qui émet vers une tâche qu'aucun module activé ne déclare doit
voir le même refus que l'application.

## Imports autorisés

- `@repo/ports` pour le port qu'ils servent ;
- `@repo/core` pour le répartiteur, le registre et la lecture des expressions
  cron — la règle vit là-bas, ces outils ne la réécrivent pas ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

## Ne doit jamais contenir

- **un second fournisseur** : un outil de test n'en est pas un, et n'en légitime
  aucun ;
- de règle de reprise, de déduplication ou de validation d'échéance : elles
  vivent dans `@repo/core`, et les réécrire ici ferait deux vérités — l'exécuteur
  local passerait alors des cas que la production échoue ;
- de lecture de `process.env` : le mode est décidé par
  `apps/web/lib/jobs-config.ts`, ces outils sont construits par injection ;
- de SDK, de client HTTP ou d'accès à la base.

## Tests

`src/**/*.test.ts`, à côté du code qu'ils couvrent.
