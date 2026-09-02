# packages/adapters/stripe — règles locales

**L'unique implémentation livrée du port `Payments`** (ADR 008). Il n'y en aura
pas de seconde : LemonSqueezy, Polar, Creem et Dodo sont au cimetière du PRD, et
la facturation à l'usage aussi. Les doublures de `@repo/payments-testing` sont
des outils de test — elles ne rendent légitime aucun fournisseur supplémentaire.

Ce package suit le gabarit de `packages/adapters/resend`, posé en s06 : un
package par adaptateur, toutes les collaborations **injectées** (`fetch`, délai,
recul, sommeil, journal, clé d'idempotence), aucune méthode qui lève, délai
d'attente explicite, reprises en recul exponentiel dispersé et plafonné, sur
erreurs transitoires uniquement.

## Ce qui a été relevé dans `stripe@22.6.0`, pas dans la documentation

Six comportements décident du code de ce package. Ils viennent du paquet
installé et d'exécutions réelles du SDK contre un `fetch` doublé ; une montée de
version doit les revérifier.

| Constat | Conséquence ici |
|---|---|
| `current_period_end` **n'est plus sur l'abonnement** : il est sur `items.data[]` (`esm/resources/Subscriptions.d.ts` n'en déclare aucun ; `esm/resources/SubscriptionItems.d.ts` l. 54) | `normalizeSubscription` prend le **maximum** des lignes. Un abonnement sans ligne exploitable est refusé, jamais deviné |
| `status` est typé `… \| OtherString` : la valeur inconnue existe | repli **fermé** sur `incomplete`, qui n'accorde aucun accès |
| le SDK **lève**, contrairement à Resend qui rend `{data, error}` | le `try/catch` est le chemin nominal, pas une précaution |
| `type` est le **nom de classe** (`StripeRateLimitError`), `rawType` le type de l'API (`rate_limit_error`) | le classement lit `rawType`, puis la classe, puis `statusCode` — jamais « définitif » par défaut |
| délai dépassé et panne réseau rendent tous deux `StripeConnectionError`, sans `rawType` ni `statusCode`. Le marqueur est `detail.code === 'ETIMEDOUT'` — **pas** `detail.name`, qui reste « TypeError » (`esm/net/HttpClient.js` l. 19-21) | lire `name` n'aurait jamais correspondu, en silence. Mesuré : la première écriture le faisait, un cas de test l'a fait rougir |
| `timeout` vaut **80 000 ms** par défaut, `maxNetworkRetries` vaut **1** | les deux sont posés explicitement : le délai vient de l'appelant, `maxNetworkRetries: 0` laisse la politique de reprise du dépôt seule aux commandes |

Constat de sécurité, mesuré sur une réponse 400 réelle : le message du
fournisseur contient une clé, un identifiant de client **et** une URL de session
signée. `sanitize` les retire ; il garde les identifiants de catalogue
(`price_`, `prod_`), sans lesquels le message ne diagnostique plus rien.

Deux limites connues et bornées, relevées dans `esm/stripe.esm.node.js` (l. 138)
et dans les en-têtes réellement émis :

1. **Le SDK écrit sur `stderr` au chargement** quand `CLAUDECODE` ou
   `CLAUDE_CODE_CHILD_SESSION` est présent dans l'environnement — une ligne
   `<claude-code-hint … />`. Ce journal n'est pas le nôtre et n'est pas
   configurable ; il ne contient ni clé ni charge utile, et aucun déploiement ne
   pose ces variables. Observé pendant les parcours Playwright de cette machine.
2. **`X-Stripe-Client-User-Agent` porte un champ `ai_agent`** dérivé du même
   environnement, envoyé à chaque requête. `telemetry: false` ne le couvre pas —
   cette option ne gouverne que les métriques de latence. Aucun secret n'y
   transite ; c'est de la donnée d'environnement, et elle est nommée ici plutôt
   que découverte dans une capture réseau.

## Imports autorisés

- `@repo/ports` pour le port `Payments` et ses formes ;
- `stripe`, le SDK du fournisseur — **le seul endroit du dépôt qui l'importe** ;
- `@repo/typescript-config` pour la configuration du compilateur ;
- `vitest` dans les fichiers de test.

Ni `@repo/config`, ni `@repo/db`, ni React : la clé, le secret de webhook, le
délai et la politique de recul arrivent en arguments, ce qui rend cet adaptateur
constructible dans un test sans environnement.

## Ne doit jamais contenir

- de **second fournisseur**, ni de branche « si LemonSqueezy alors… » ;
- de lecture de `NODE_ENV` ou de `process.env` (hors `stripe-live.test.ts`, qui
  est du harnais) : un fournisseur choisi par l'environnement est intestable ;
- d'appel réseau **sans délai d'attente**, ni de reprise sur une erreur
  définitive ;
- de clé, de secret, d'URL de session ou d'identifiant de client dans un journal
  ou dans un message d'erreur — y compris quand c'est le fournisseur qui les a
  mis dans le sien ;
- de règle métier : cet adaptateur ne décide ni qui a le droit de souscrire, ni
  ce qu'un statut donne comme accès, ni dans quel ordre appliquer deux
  événements. Ces trois règles sont dans le `domain` de `@repo/module-billing`.

## Tests

Deux fichiers, **deux régimes, jamais mélangés** (`docs/architecture.md`) :

| Fichier | Régime | Quand |
|---|---|---|
| `src/stripe-payments.test.ts` | le **réseau** est doublé (`Stripe.createFetchHttpClient(fetchDouble)`), le SDK est réel | en CI, bloquant |
| `src/stripe-live.test.ts` | appels réels contre une clé de test | hors CI, sur commande explicite, avant un ship qui touche au paiement |

Ce que le premier prouve tient à ce qu'il double : la sérialisation réelle en
`application/x-www-form-urlencoded`, les en-têtes réels (version d'API, clé
d'idempotence), la vraie vérification de signature — les charges utiles
d'événement sont signées à l'exécution par `Stripe.webhooks.generateTestHeaderString`,
donc `constructEvent` fait vraiment son travail. Doubler `constructEvent` ou
`checkout.sessions.create` n'éprouverait que la doublure.

Sans `STRIPE_LIVE_TEST=1`, la seconde suite est ignorée : aucun appel réel ne
part d'une exécution de CI, même si une clé traînait dans l'environnement. La
recette refuse aussi une clé qui ne commence pas par `sk_test_`.

**Ce qui a été prouvé par mutation** (le compte est le nombre de cas passés au
rouge, sur les 24 de la suite) : tout classer transitoire → 2 ; retirer
l'assainissement des messages → 2 ; faire varier la clé d'idempotence → 2 ;
retirer le plafond du recul → 1 ; retirer la dispersion → 2 ; lire
`current_period_end` sur l'abonnement au lieu des lignes → 3 ; ouvrir le repli
de statut inconnu → 1 ; construire l'événement **sans** vérifier la signature
(`constructEventWithoutVerification`) → 2.
