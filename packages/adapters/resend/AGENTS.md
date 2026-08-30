# packages/adapters/resend — règles locales

**L'unique implémentation livrée du port `Mailer`** (ADR 008). Il n'y en aura
pas de seconde : SMTP, SendGrid et Nodemailer sont au cimetière du PRD. Les
doublures de `@repo/mailer-testing` sont des outils de test — elles ne rendent
légitime aucun adapter supplémentaire.

C'est aussi le **premier adapter du dépôt**, donc le gabarit de s3 (`s3`),
Stripe, Inngest, Sentry et PostHog. Ce qui s'y répétera :

- un package par adapter, parce que c'est ce qui isole un SDK ;
- toutes les collaborations **injectées** (rendu, journal, sommeil, hasard,
  clé d'idempotence) : c'est ce qui rend l'adapter testable sans réseau ;
- `send` **ne lève jamais** ; l'échec est une valeur (`docs/reliability.md` §2) ;
- délai d'attente explicite, reprises en recul exponentiel dispersé et plafonné,
  **sur erreurs transitoires uniquement** (§3) ;
- le journal ne porte que ce que `MailerLogRecord` autorise, et le message du
  fournisseur est assaini (`docs/security.md` §5).

## Ce qui a été relevé dans `resend@6.25.0`, pas dans la documentation

Quatre comportements décident du code de ce package. Ils viennent du paquet
installé ; une montée de version doit les revérifier.

| Constat | Conséquence ici |
|---|---|
| `emails.send` **ne lève pas** : erreur d'API comme panne réseau reviennent en `{ data: null, error }` (`application_error`, `statusCode: null` pour le réseau) | l'échec se lit dans la valeur ; le `try/catch` reste par prudence pour une version future |
| `ResendOptions` = `{ baseUrl, userAgent }` et `PostOptions` = `{ query, headers }` : **ni délai d'attente, ni `AbortSignal`** | le délai est tenu par course (`Promise.race`). La requête est **abandonnée, pas annulée** : la socket vit jusqu'à ce que Node la ferme. §3 est tenue pour l'appelant, c'est ce qu'elle exige |
| `new Resend(undefined)` lit `process.env.RESEND_API_KEY` ; `getDefaultBaseUrl()` lit `process.env.RESEND_BASE_URL` | la clé **et** l'URL de base sont toujours passées explicitement, ce qui neutralise les deux lectures et respecte le point d'accès unique à l'environnement |
| `options.idempotencyKey` pose l'en-tête `Idempotency-Key` | **une seule clé pour toutes les tentatives** d'un envoi : une reprise ne peut pas envoyer un second email si c'est la réponse qui s'était perdue (`docs/reliability.md` §1) |

Limite connue et bornée : hors production, le SDK écrit ses erreurs sur
`console.error` (`logError`). Ce journal n'est pas le nôtre et n'est pas
configurable ; il ne contient ni clé d'API ni charge utile, mais un message de
fournisseur peut y nommer une adresse.

## Imports autorisés

- `@repo/ports` pour le port `Mailer`, sa forme de résultat et celle du journal ;
- `resend`, le SDK du fournisseur — **le seul endroit du dépôt qui l'importe** ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

Ni React, ni templates : le rendu est **injecté** (`EmailRenderer`). Ni
`@repo/config` : la clé, l'expéditeur et les délais arrivent en arguments, ce
qui rend cet adapter constructible dans un test sans environnement.

## Ne doit jamais contenir

- de **second fournisseur**, ni de branche « si SMTP alors… » ;
- de lecture de `NODE_ENV` ou de `process.env` (hors `resend-live.test.ts`, qui
  est du harnais) : un mailer choisi par l'environnement est intestable et se
  trompera un jour d'environnement ;
- d'appel réseau **sans délai d'attente**, ni de reprise sur une erreur
  définitive ;
- de secret, d'adresse, de sujet ou de corps d'email dans un journal ou dans un
  message d'erreur — y compris quand c'est le fournisseur qui les a mis dans le
  sien ;
- de règle métier : cet adapter ne décide pas quand un email part.

## Tests

Deux fichiers, **deux régimes, jamais mélangés** (`docs/architecture.md`) :

| Fichier | Régime | Quand |
|---|---|---|
| `src/resend-mailer.test.ts` | le **réseau** est doublé (`globalThis.fetch`), le SDK est réel | en CI, bloquant |
| `src/resend-live.test.ts` | envoi réel contre une clé de test | hors CI, sur commande explicite, avant un ship qui touche aux emails |

Ce que le premier prouve tient à ce qu'il double : la sérialisation réelle de la
requête, les en-têtes réels, le traitement réel de `{ data, error }`. Doubler
`emails.send` par une fonction à soi n'éprouverait que cette fonction — c'est le
piège relevé en revue de s01.

La recette d'envoi réel :

```sh
RESEND_LIVE_TEST=1 RESEND_API_KEY=re_… \
EMAIL_FROM='Killer SaaS <envoi@votre-domaine-verifie>' EMAIL_LIVE_TO=vous@votre-domaine \
  pnpm vitest run packages/adapters/resend/src/resend-live.test.ts
```

Sans `RESEND_LIVE_TEST=1` la suite est ignorée : aucun email réel ne part d'une
exécution de CI, même si une clé traînait dans l'environnement.

**Ce qui a été prouvé par mutation** (le compte est le nombre de cas passés au
rouge) : tout classer transitoire → 4 ; retirer l'assainissement des messages
→ 5 ; tirer une clé d'idempotence par tentative → 1 ; retirer la course du
délai d'attente → 2 ; retirer la dispersion → 1 ; retirer le plafond → 1 ;
retirer le repli sur le code HTTP → 1 ; ne plus rattraper le rendu → 1.
