# ADR 037 — Un client peut porter plusieurs abonnements, et c'est la lecture qui désigne le sien

- Status: accepted
- Date: 2026-09-02

Un client a plusieurs abonnements dès qu'il annule puis se réabonne : le fournisseur garde l'historique, la réconciliation le relit, et `billing_subscription` en garde une ligne par abonnement. Lues sans ordre, PostgreSQL rendait l'ordre d'insertion, donc l'abonnement annulé : l'écran refusait l'accès à quelqu'un qui venait de payer.

**Plusieurs lignes vivantes par client sont un état permis ; la lecture décide, en deux moitiés indissociables.**

1. **Un ordre total** : `last_event_at DESC`, puis `current_period_end DESC`, puis `provider_subscription_id DESC` (la clé primaire, donc jamais d'égalité). Il est écrit une fois, `subscriptionReadOrder` (`infrastructure/drizzle-billing-repositories.ts`), et l'index `billing_subscription_customer_idx` porte les mêmes colonnes dans le même sens et la même position des `NULL` — sans quoi le planificateur retrie par-dessus l'index ; un `EXPLAIN` dans `tests/billing.test.ts` les confronte.
2. **Une règle qui choisit**, `currentSubscriptionOf` (`domain/subscription.ts`) : celui qui donne l'accès l'emporte sur le plus récemment changé. Annuler l'ancien abonnement après avoir souscrit le neuf est ordinaire, et l'événement le plus récent est alors l'annulation.

**Le catalogue se ferme à qui a déjà l'accès.** Un second checkout crée toujours un second abonnement facturé, le SDK n'offrant aucun remplacement : `openCheckout` refuse en `409` (`already_subscribed`) quand le périmètre a l'accès, et l'écran renvoie au portail pour changer d'offre.

## Considered options

- **Unicité pleine sur le client** — rejeté : poser la contrainte sans changer l'écriture fait lever le webhook public sur le second abonnement (le fournisseur rejoue, abandonne, l'état diverge) ; déplacer la cible de conflit sur le client fait écraser l'abonnement actif par l'annulation de l'ancien.
- **Unicité partielle sur les statuts vivants** — rejeté : un second abonnement vivant reste créable depuis le tableau de bord du fournisseur, et la contrainte transforme alors le webhook public en `500` permanent (`docs/reliability.md`).
- **Prendre le plus récemment changé** — rejeté : c'est le cas « annuler l'ancien en dernier ».
- **Supprimer les lignes terminées** — rejeté : la réconciliation les réécrirait, et l'export perdrait l'historique de facturation.

## Consequences

L'invariant « un seul abonnement vivant » n'est pas en base : il tient par le refus applicatif et le portail. Un futur chemin d'écriture qui contournerait `openCheckout` rouvrirait la porte.
