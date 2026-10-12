# ADR 034 — L'état d'abonnement est un cache reconstructible, ordonné par l'horodatage d'événement

- Status: accepted
- Date: 2026-09-01
- Scope: story s19-subscribe-stripe

## Context

s19 pose le port `Payments` et son unique implémentation, Stripe. Quatre
questions structurantes se posent en même temps, et aucune n'est tranchée par un
ADR existant :

1. **Qui possède un abonnement ?** Selon que le module `organizations` est
   activé ou non, une organisation ou un compte. `docs/architecture.md` impose
   que « le code appelant soit identique dans les deux cas ».
2. **Que fait-on du désordre ?** Stripe ne garantit aucun ordre de livraison :
   `customer.subscription.updated` peut précéder le `checkout.session.completed`
   qui l'a causé, et deux `updated` peuvent s'inverser.
3. **Quelle est la source de vérité ?** Nos tables, ou Stripe ?
4. **Qui a le droit de souscrire, dans une organisation ?** La matrice de s17
   n'énumère aucune action de facturation, et `docs/security.md` §3 exige que
   chaque combinaison rôle × action sensible soit couverte.

`docs/reliability.md` §1 exige une idempotence prouvée par contrainte d'unicité
plutôt que par lecture préalable ; §5 exige une commande de réconciliation pour
« toute divergence possible avec un système externe ».

## Decision

### 1. Le propriétaire est résolu par `dataOwnerOf`, et rattaché **avant** le checkout

`billing_customer` associe un `ModuleScope` (`user:<id>` ou
`organization:<id>`) à un identifiant de client Stripe, sous contrainte
d'unicité des deux côtés. La ligne est écrite **pendant l'ouverture du
checkout**, avant que l'URL ne soit rendue au navigateur — jamais à la réception
de `checkout.session.completed`.

Conséquence : tout événement `customer.subscription.*` résout son propriétaire
par `provider_customer_id`, quel que soit son ordre d'arrivée. Le désordre de
rattachement cesse d'exister ; il n'y a pas de tampon d'événements orphelins.

Aucune clé étrangère ne sort du module (ADR 018) : le périmètre est stocké en
deux colonnes de texte. Le module `billing` ne déclare donc **aucun** `requires`,
et fonctionne à l'identique avec ou sans `organizations`.

### 2. L'ordre d'état est décidé par `event.created`, appliqué aux égalités

`billing_subscription.last_event_at` garde l'horodatage du dernier événement
appliqué. Un événement strictement antérieur est **journalisé comme traité et
n'écrit rien**. Un événement de même horodatage est appliqué.

### 3. Stripe est la source de vérité ; nos tables sont un cache

Ce que nous stockons — statut, fin de période, quantité, annulation programmée —
est reconstructible. `pnpm billing:reconcile` relit Stripe pour chaque client
connu et réécrit le cache ; une seconde exécution n'écrit rien.

### 4. `billing.manage` entre dans la matrice de rôles de s17

`ORGANIZATION_ACTION.manageBilling = 'billing.manage'`, accordée à `owner` et
`admin`, refusée à `member`, et accordée au compte sans organisation
(`allows(null, …) === true`, règle existante : sans organisation, le compte est
propriétaire de sa donnée).

Le module `billing` ne connaît pas cette matrice : il reçoit un prédicat
`canManage(scope, userId)` de son point de composition, comme il reçoit sa
connexion (ADR 020) et comme `marketing` reçoit `emailOfScope`. Module
`organizations` coupé, le prédicat rend toujours vrai.

## Considered options

**Sur le rattachement du client Stripe**

- *Créer le client Stripe à la réception de `checkout.session.completed`* —
  rejeté. C'est le chemin naturel des exemples Stripe, et c'est celui qui perd
  un `customer.subscription.updated` arrivé en premier. Le rattraper demanderait
  un tampon d'événements orphelins, c'est-à-dire un second mécanisme d'état à
  réconcilier.
- *Porter le périmètre dans `metadata` de la session et de l'abonnement* —
  rejeté comme **source** de vérité : `metadata` est modifiable depuis le
  tableau de bord Stripe, et un périmètre falsifiable décide alors de qui accède
  à quoi. Le `client_reference_id` est posé quand même, mais il sert au
  diagnostic, jamais à l'autorisation.

**Sur l'ordre**

- *Rejouer l'objet depuis Stripe à chaque événement* (`subscriptions.retrieve`)
  — rejeté pour le chemin nominal : un appel réseau par webhook, sur un point
  d'entrée public non limité en débit avant s28, transforme une rafale
  d'événements en rafale d'appels sortants. C'est exactement ce que fait la
  commande de réconciliation, mais hors du chemin critique.
- *Numéro de version sur l'abonnement* — impossible : `stripe@22.6.0` n'en
  expose aucun sur l'objet `Subscription` (relevé dans
  `esm/resources/Subscriptions.d.ts`).
- *Refuser aussi les égalités d'horodatage* — rejeté : deux événements de la
  même seconde sont fréquents à la création d'un abonnement, et le second serait
  perdu. Le prix assumé est écrit : deux événements de la même seconde portant
  des états différents sont départagés par l'ordre d'arrivée, et c'est la
  réconciliation qui répare.

**Sur l'idempotence**

- *Lire le journal puis écrire* — rejeté par `docs/reliability.md` §1 : la
  fenêtre entre la lecture et l'écriture est exactement le cas que Stripe
  produit en rejouant deux fois en parallèle. C'est un
  `insert … on conflict do nothing` qui décide, dans la **même transaction** que
  l'écriture d'état : un traitement en échec annule les deux et laisse le rejeu
  possible.

**Sur les permissions**

- *Ne rien garder — toute personne connectée gère la facturation de son
  périmètre* — rejeté : un `member` pourrait annuler l'abonnement de son
  organisation. `docs/security.md` §3.
- *Réutiliser `organization.rename`* (owner + admin, la même population) —
  rejeté : la règle serait vraie par coïncidence, et changer les rôles de
  `rename` changerait ceux de la facturation sans que personne ne l'ait décidé.
- *Comparer le rôle dans `apps/web/lib/billing.ts`* — rejeté : le lint qui garde
  l'unicité de la matrice ne couvre que
  `packages/modules/organizations/src`, donc cette écriture passerait sans
  rougir, et la matrice existerait à deux endroits. C'est le défaut F4 de la
  revue de s17, rejoué.
- *Une matrice propre à `billing`* — rejeté : deux matrices de rôles
  d'organisation, dont une hors du module qui possède les rôles.

## Consequences

**Ce qui devient plus facile.** Le désordre le plus cher — un abonnement sans
propriétaire — n'existe plus. Une base perdue se reconstruit par une commande.
s20 (achat unique), s21 (gating), s38 (revenus) héritent d'un périmètre résolu
par une seule fonction et d'une permission déjà nommée.

**Ce qui devient plus difficile.** Ouvrir un checkout écrit en base **avant** de
parler à Stripe : la route n'est plus une simple redirection, et son échec doit
laisser un état repris (la ligne `billing_customer` créée sans session ouverte
est réutilisée au prochain essai, ce qui est le comportement voulu, pas un
résidu).

**Ce qu'il faut surveiller.** L'égalité d'horodatage (§2) est une perte de
précision assumée. Si un projet réel observe des états qui « reculent », la
réponse n'est pas d'élargir la comparaison : c'est de rejouer la réconciliation
et, si le cas se répète, d'ouvrir un ADR qui remplace `event.created` par une
relecture ciblée de l'objet.

**Ce que cet ADR ne dit pas.** Il ne dit rien de la synchronisation continue du
nombre de sièges, ni des emails de relance, ni du gating par offre : trois
stories distinctes, trois décisions à prendre le moment venu.
