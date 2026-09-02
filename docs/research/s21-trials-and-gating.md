# Recherche — s21-trials-and-gating

> Réserver une fonctionnalité à une offre payante, et proposer un essai.
> Ce qui suit est ce qui a été **lu dans le dépôt et dans les paquets installés**,
> pas dans une documentation en ligne. Chaque affirmation nomme son fichier.

## 1. Ce que la story demande, ligne à ligne

`docs/stories.md`, chapitre `s21-trials-and-gating` (lignes 571 à 593) :

1. une fonctionnalité est **déclarée** comme requérant une offre ; la vérification
   est une **fonction unique appelée côté serveur** ;
2. sans droit : **403** côté API, **invitation à souscrire** côté interface ;
3. le droit vient d'un abonnement actif **ou** d'un achat unique (s20) ;
4. une période d'essai configurée sur une offre donne l'accès **jusqu'à son
   terme**, puis le retire ;
5. essai expiré, abonnement en retard de paiement, abonnement annulé après sa
   période payée : les trois retirent l'accès ;
6. **module de facturation coupé** : la vérification accorde tout, et aucune
   invitation n'apparaît ;
7. chaque combinaison état de facturation × fonctionnalité réservée est testée.

Hors périmètre, dit par la story elle-même : **les quotas quantitatifs**. Un
compteur de consommation est la brique de la facturation à l'usage, qui est au
cimetière (`docs/prd.md`). Le gating porte sur l'appartenance à une offre.

## 2. Ce que s19 et s20 ont déjà livré, et qui ne se réinvente pas

Lu dans `packages/modules/billing/` et son `AGENTS.md`.

- **La signature d'abord** : `handleWebhook` appelle `payments.verifyWebhook`
  avant toute lecture et toute écriture (`application/billing-use-cases.ts`).
- **Idempotence par identifiant d'événement**, tenue par la clé primaire de
  `billing_webhook_event` dans la **même transaction** que l'effet.
- **Prédicat d'ordre** : `appliesAfter` nomme la règle, le `setWhere` du dépôt la
  refuse.
- **Stripe fait foi**, la base est un cache reconstructible par
  `pnpm billing:reconcile`, qui **n'efface jamais** et **ne ré-accorde jamais**
  (ADR 034 §3, `domain/purchase.ts#reconciledPurchaseStatus`).
- **L'accès est consolidé** : `grantsBillingAccess(subscription, purchases, now)`
  = abonnement **ou** achat payé, les deux sources indépendantes.
- **Deux fermetures qui ne se regardent pas** : `already_subscribed` ne lit que
  les abonnements, `already_purchased` que les achats (critère 6 de s20). La
  story ne doit refermer ni l'une ni l'autre en touchant l'autre.
- **Le repli de lecture de `purchaseOfSession`** sur
  `billing_purchase.provider_session_id` est une dette **datée** (fenêtre de
  déploiement, constat C4). Elle n'est pas touchée ici.
- Trois options **mesurées et rejetées** qu'il ne faut pas rejouer : unicité
  pleine et unicité partielle sur `billing_subscription` (ADR 037), expiration
  d'une session de checkout chez le fournisseur (ADR 038 §1).

## 3. L'essai, tel qu'il existe aujourd'hui — et les deux trous

`config/billing.ts` déclare `trialDays: 14` sur `pro-monthly` et `pro-yearly`.
`offer.trialDays` est passé en `trialPeriodDays` à `payments.createCheckout`
(`application/billing-use-cases.ts`), et le fournisseur ouvre l'abonnement en
`trialing` avec un `trial_end` (mesuré dans la simulation :
`packages/payments-testing/src/local-payments.ts:315-327`).

### Trou 1 — un essai expiré donne toujours l'accès

`domain/subscription.ts#grantsAccess` : `trialing` rend `true` **sans regarder
aucune date**. Le commentaire l'assume — « notre cache peut être en retard d'un
webhook ». Conséquence mesurable : le temps passe, aucun événement n'arrive
(`stripe@22.6.1` n'émet `customer.subscription.updated` qu'au moment où il
convertit ou échoue l'essai, et ce message peut se perdre — c'est exactement le
cas que la commande de réconciliation existe pour rattraper), et l'accès reste
ouvert. Le critère 5 l'interdit.

C'est le cœur de la story : **un essai est un droit d'accès qui expire sans
paiement**, donc son terme doit être opposable **localement**, par le temps
seul. Le champ existe déjà en base : `billing_subscription.trial_end`, écrit par
le webhook comme par la réconciliation (`schema.ts`, `writeFrom`).

`displayStateOf` porte le même défaut : un `trialing` périmé s'affiche encore
« Période d'essai ».

### Trou 2 — l'essai se prolonge en le redemandant

`openCheckout` envoie `trialPeriodDays: offer.trialDays` **à chaque ouverture**.
Un périmètre qui a essayé `pro-monthly`, laissé l'essai expirer, puis ouvre un
checkout sur `pro-yearly` reçoit **quatorze jours de plus**. Rien côté
fournisseur ne s'y oppose : `stripe@22.6.1` n'a aucune mémoire d'essai par
client — `subscription_data.trial_period_days` est un nombre posé par
l'appelant (`esm/resources/Checkout/Sessions.d.ts`, champ
`subscription_data.trial_period_days`), et la simulation locale fait la même
chose.

**Ce qu'il faut pour le fermer, et ce qu'il ne faut pas.** Il n'y a pas besoin
d'une table : le cache porte déjà la trace de tout essai accordé —
`trial_end IS NOT NULL` sur une ligne de `billing_subscription` du client. Cette
trace est **reconstructible** depuis le fournisseur (`listSubscriptions` rend
`trialEnd`, `packages/ports/src/payments.ts:210`), donc elle survit à la
réconciliation, et elle n'ajoute **aucune donnée personnelle** — donc aucune
catégorie à déclarer, aucune purge ni aucun export à rouvrir.

## 4. Le gating — où il peut vivre, et où il ne peut pas

### Ce que le dépôt interdit

`packages/modules/billing/AGENTS.md`, première phrase : le module de facturation
« ne possède **ni** la page de tarifs publique (s22), **ni** le gating par offre
(s21) ». Le gating ne peut donc pas être un fichier de `packages/modules/billing`.

Il ne peut pas non plus être une comparaison de rôle : la matrice rôle × action
s'écrit une fois, dans
`packages/modules/organizations/src/domain/permissions.ts` (s17, ADR 034 §4), et
`pnpm lint` refuse la comparaison ailleurs.

### Ce que le dépôt offre déjà

`@repo/core` porte les deux règles qui doivent exister **quand un module est
coupé** : `resolveDataOwner` et `satisfiesProtection`
(`packages/core/src/protection.ts`). Le contrat de module déclare déjà un
**niveau de protection** par route et par entrée de navigation, et le
répartiteur le lit avant d'appeler le gestionnaire
(`packages/core/src/registry.ts#dispatchModuleRequest`) :

```ts
export type RouteProtection =
  | { readonly level: 'public' }
  | { readonly level: 'authenticated' }
  | { readonly level: 'role'; readonly role: string }
```

`RouteProtection` n'est référencé que par cinq fichiers de code — mesuré :
`packages/core/src/module.ts`, `protection.ts`, `index.ts`, et deux mentions en
prose dans `packages/modules/organizations`. Le CLI (`packages/cli`) et le
serveur MCP (`packages/modules/mcp-server`) n'en parlent pas : `grep -rn
"protection" packages/cli/src packages/modules/mcp-server/src` ne rend rien.
Ajouter un niveau est donc borné.

`DispatchOptions` porte déjà le patron de l'injection :
`resolveSession?: (request) => Promise<ModuleSession | null>` — `@repo/core` ne
connaît aucun module, il **reçoit** la résolution du point de composition. Un
`resolveFeatures` de la même forme est le même mécanisme.

### Le module de démonstration est le bon porteur

`packages/modules/demo-enabled/AGENTS.md` dit sa charge : démontrer « le
**niveau de protection déclaré** sur chaque route et chaque entrée de
navigation […] — publique, authentifiée, réservée à un rôle — et **lu** ». Il
porte déjà les trois niveaux existants
(`src/presentation/demo-item-routes.ts`). Un quatrième y appartient. Il ne
crée aucune dépendance vers `billing` : le module **nomme** un identifiant de
fonctionnalité, la configuration dit quelles offres l'ouvrent.

## 5. Le point de composition, et ce que la mutation doit viser

Leçon écrite dans `packages/modules/billing/AGENTS.md` (constats M1 et M2 de la
seconde revue de s19) : `canManage` neutralisé **dans le module** laissait
1 320 cas sur 1 320 au vert, parce que le défaut vivait au **point de
composition** (`apps/web/lib/billing.ts`). Les mutations de cette story doivent
donc être posées :

- sur la **règle** (`packages/core`, `packages/modules/billing/src/domain`) ;
- **et** sur le câblage (`apps/web/lib/entitlements.ts`,
  `apps/web/app/api/modules/[...path]/route.ts`), qui est l'endroit où un
  résolveur oublié rendrait le gating inopérant.

Les deux fichiers de câblage sont atteignables sans monter Next :
`apps/web/lib/billing.ts` est déjà importé hors de Next par `e2e/billing.spec.ts`
et `scripts/billing-reconcile.ts` (l'import de `./auth` y est **différé** pour
cette raison, commentaire d'`emailOfScope`).

## 6. Démarrage : où une configuration fausse doit s'arrêter

`apps/web/next.config.ts` appelle `billingCatalogue()` **sans condition de
phase**, et seulement si le module est activé. C'est le seul point traversé par
`next dev` comme par `next start` avant la première requête (constat F2 de la
revue de s19 : sans lui, une offre malformée ne se voyait qu'au premier appel,
qui pouvait être le webhook public, alors servi en 500).

Une déclaration de fonctionnalité réservée qui nomme une offre inexistante est
la même classe de faute, et doit s'arrêter au même endroit.

## 7. Pièges de mesure, hérités et vérifiés

- `pnpm build --force` **avant toute mesure au navigateur** : `turbo` sert
  volontiers le `.next` de l'autre configuration de modules.
- Next 16.3.3 charge `next.config.ts` **après** la ligne `✓ Ready` : une mesure
  de démarrage qui s'arrête à cette ligne conclut à tort que les gardes sont
  mortes.
- `lsof -nP -iTCP:5432 -sTCP:LISTEN` si la base rougit : un postgres orphelin
  sur `127.0.0.1` prime sur le proxy Docker. Vérifié au début de cette story —
  une seule ligne, `*:5432`, le proxy Docker.
- Base de travail **`s21`**, jamais `app`.
- `tests/rendered-text.test.ts` rend chaque écran en pseudo-locale et exige un
  champ `refuses` **dérivé** de l'état du module. Un écran ajouté sans y être
  inscrit n'est pas balayé par le filet de texte en dur.
- `tests/billing.test.ts` doit vider `billing_refunded_payment` entre les cas :
  les cas réemploient `pi_life_1`.

## 8. Ce que la recherche laisse ouvert au plan

- Le **nom** de la déclaration et son fichier (`config/`).
- La forme exacte du refus : le critère dit **403**, et ce n'est pas la
  ressource d'autrui (où `docs/security.md` §3 impose 404) — c'est une
  fonctionnalité dont l'existence est publique, seul l'usage est réservé.
- La visibilité de la navigation d'une entrée réservée : la masquer
  contredirait le critère 2, qui demande une **invitation**, pas une
  disparition.
