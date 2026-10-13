# ADR 034 — L'état d'abonnement est un cache reconstructible, ordonné par l'horodatage d'événement

- Status: accepted
- Date: 2026-09-01

Le port `Payments` et son implémentation Stripe posent quatre décisions liées.

1. **Le propriétaire est rattaché avant le checkout.** `billing_customer` associe un `ModuleScope` (`user:<id>` ou `organization:<id>`, résolu par `dataOwnerOf`) à un identifiant de client Stripe, unique des deux côtés, et la ligne est écrite pendant l'ouverture du checkout, avant que l'URL parte au navigateur. Tout événement `customer.subscription.*` résout donc son propriétaire par `provider_customer_id`, quel que soit son ordre d'arrivée : pas de tampon d'événements orphelins. Le périmètre est stocké en deux colonnes de texte, sans clé étrangère sortante (ADR 018) ; `billing` ne déclare aucun `requires`.
2. **L'ordre est décidé par `event.created`.** `billing_subscription.last_event_at` garde l'horodatage du dernier événement appliqué ; un événement strictement antérieur est journalisé comme traité et n'écrit rien, une égalité est appliquée. L'idempotence est un `insert … on conflict do nothing` sur le journal d'événements, dans la même transaction que l'écriture d'état (`docs/reliability.md`).
3. **Stripe est la source de vérité, nos tables un cache.** `pnpm billing:reconcile` relit Stripe pour chaque client connu et réécrit le cache ; une seconde exécution n'écrit rien.
4. **`billing.manage` entre dans la matrice des rôles d'organisation** (ADR 030) : accordée à `owner` et `admin`, refusée à `member`, accordée au compte sans organisation. `billing` ignore cette matrice : il reçoit un prédicat `canManage(scope, userId)` de son point de composition (`apps/web/lib/billing.ts`), qui rend toujours vrai quand `organizations` est coupé.

## Considered options

- **Créer le client Stripe à `checkout.session.completed`** — rejeté : c'est le chemin des exemples Stripe, et il perd un `customer.subscription.updated` arrivé en premier.
- **Porter le périmètre dans `metadata`** — rejeté comme source d'autorisation : `metadata` est modifiable depuis le tableau de bord Stripe. `client_reference_id` est posé, pour le diagnostic seulement.
- **Relire l'objet chez Stripe à chaque événement** — rejeté sur le chemin nominal : un appel sortant par webhook transforme une rafale d'événements en rafale d'appels. C'est le travail de la réconciliation, hors du chemin critique.
- **Refuser aussi les égalités d'horodatage** — rejeté : deux événements de la même seconde sont fréquents à la création, et le second serait perdu.
- **Réutiliser `organization.rename`, ou comparer le rôle dans `apps/web`** — rejeté : une règle vraie par coïncidence, ou une seconde matrice hors du lint qui garde son unicité.

## Consequences

Ouvrir un checkout écrit en base avant de parler à Stripe ; une ligne `billing_customer` sans session ouverte est réutilisée au prochain essai.

Deux événements de la même seconde portant des états différents sont départagés par l'ordre d'arrivée, et la réconciliation répare. Si des états « reculent » en pratique, la réponse est une ADR qui remplace `event.created` par une relecture ciblée, pas une comparaison élargie.
