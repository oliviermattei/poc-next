# packages/adapters/inngest — règles locales

**L'unique implémentation livrée du port `Jobs`** (ADR 008, contrainte du PRD :
« adapter avec Inngest comme seule implémentation »). Il n'y en aura pas de
seconde : trigger.dev, QStash et BullMQ sont au cimetière du PRD. Les outils de
`@repo/jobs-testing` — la doublure d'enregistrement de la CI et l'exécuteur en
mémoire du mode local — sont des **outils**, ils ne rendent légitime aucun
fournisseur supplémentaire.

Ce package suit le gabarit de `packages/adapters/resend`, posé en s06 : un
package par adaptateur, toutes les collaborations **injectées** (`fetch`, délai,
recul, sommeil, journal), aucune méthode qui lève, délai d'attente explicite,
reprises en recul exponentiel dispersé et plafonné, sur erreurs transitoires
uniquement.

## Deux moitiés, et elles n'ont pas la même nature

C'est ce qui distingue cet adaptateur des trois autres, et il faut le lire avant
d'y toucher.

| Moitié | Ce qui l'implémente | Pourquoi |
|---|---|---|
| **l'émission** (`createInngestJobs`) | un `fetch` vers l'API d'événements documentée, `POST <base>/e/<clé>` | trois choses **relevées dans `inngest@4.20.0`**, pas dans la documentation : `client.send()` ne porte **aucun délai d'attente** (`docs/reliability.md` §3 en exige un explicite), il **reprend lui-même** ce que notre politique doit décider, et son échec est un `Error` nu dont le seul indice est la chaîne « Inngest API Error: 503 … » — classer une reprise sur une sous-chaîne de message est un piège que le code HTTP évite |
| **l'exécution** (`createInngestRunner`) | le vrai `serve` du SDK (`inngest/edge`) | le protocole d'appel de fonction — synchronisation, signature, pas d'exécution — n'est pas un POST documenté. Le réimplémenter serait le contraire de « generate, don't guess » |

Deux conséquences qui se lisent dans le code et qu'aucune commande ne rappelle :

- **`retries: 0` sur chaque fonction Inngest.** La politique de reprise vit dans
  le répartiteur (`dispatchModuleJob`, `@repo/core`), une fois, avec sa règle
  « jamais une erreur de validation ». Laisser le fournisseur reprendre
  par-dessus multiplierait les tentatives par deux et rendrait faux le plafond
  configuré ;
- **`isTransientInngestError` est exporté pour être confronté.** Ce package
  rejoue le classement transitoire / définitif du socle, parce qu'il ne peut pas
  importer `@repo/core`. Ce qui l'empêche de diverger tient en **deux**
  commandes, et il faut les deux : `pnpm typecheck` force les deux `switch` à
  traiter tous les codes — `const unhandled: never = code` —, et `pnpm test`
  (`tests/jobs.test.ts`) les force à rendre la **même** réponse sur
  `JOBS_ERROR_CODES`, la liste dont l'union est dérivée. Le compilateur seul ne
  disait rien de l'**accord** : c'était le constat b de la seconde revue de s33 ;
- **`serve` d'`inngest/edge` lit l'en-tête `Host`.** Mesuré :
  `new URL(req.url, \`https://${req.headers.get("host") || ""}\`)`
  (`components/createWebApiCommHandler.js`) — une requête sans en-tête `Host`
  fait rendre 500 au gestionnaire avec « Invalid URL ». Ce n'est pas un cas de
  production (tout client HTTP/1.1 en pose un), mais tout test qui fabrique une
  `Request` doit en poser un.

## Ce qu'il ne fait pas

- **il ne décide pas du mode.** Le choix entre le fournisseur et l'exécuteur
  local se fait sur la configuration (`apps/web/lib/jobs-config.ts`), jamais sur
  `NODE_ENV` ni sur l'absence de clé ;
- **il ne connaît pas le registre.** Il reçoit la **liste des tâches déclarées**
  (identifiant qualifié et cron) et une fonction de répartition. C'est ce qui lui
  permet de ne pas dépendre de `@repo/core`, et à la règle de vivre à un seul
  endroit.

## Imports autorisés

- `@repo/ports` pour le port qu'il implémente ;
- `inngest` — le SDK du fournisseur, et le seul paquet tiers de ce package ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

## Ne doit jamais contenir

- **une seconde implémentation** du port, ni un second fournisseur : ADR 008 en
  autorise une par port, et le PRD nomme Inngest ;
- de règle métier : un adaptateur dit *comment* on parle au tiers, jamais *quand*
  ni *pourquoi* ;
- de lecture de `process.env` : la clé, la clé de signature et l'URL de base sont
  **passées**, jamais lues (`docs/security.md` §5) ;
- de journal qui porte une clé, une URL ou une charge utile : la forme de
  `JobsLogRecord` est fermée, et le message du fournisseur est assaini.

## Tests

`src/**/*.test.ts`, à côté du code qu'ils couvrent, et **deux régimes qui ne se
mélangent jamais** (`docs/architecture.md`) :

- `inngest-jobs.test.ts` — bloquant en CI. Le **réseau** est doublé, jamais le
  SDK : le gestionnaire de rappel est le vrai `serve`, et les cas lui envoient
  une charge d'appel de fonction telle que le serveur d'Inngest en envoie une ;
- `inngest-live.test.ts` — **hors CI, sur commande explicite**, contre un serveur
  de développement Inngest réel. Ignoré sans `INNGEST_LIVE_TEST=1` ; il ne se
  substitue jamais au premier en silence.
