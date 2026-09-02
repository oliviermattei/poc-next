# ADR 037 — Un client peut porter plusieurs abonnements, et c'est la lecture qui désigne le sien

- Status: accepted
- Date: 2026-09-02
- Scope: story s19-subscribe-stripe

## Context

ADR 034 §2 ordonne les **événements** : `last_event_at` décide si un événement
livré en retard doit être appliqué. Il ne dit rien d'une question voisine que la
revue de s19 a fait remonter deux fois — **lequel des abonnements d'un client
est *le* sien**.

Un client en a plusieurs dès qu'il annule puis se réabonne : le fournisseur
garde l'historique, la réconciliation le relit intégralement, et `billing_subscription`
en garde une ligne par abonnement. La première écriture lisait ces lignes sans
`ORDER BY` et prenait la première rendue par le moteur : PostgreSQL rend l'ordre
d'insertion, donc l'abonnement **annulé**. L'écran affichait « abonnement
expiré » et refusait l'accès à quelqu'un qui venait de payer (constat F1 de la
première revue, mesuré et reproductible).

La revue demandait de fermer ce défaut par une **contrainte de schéma** — une
unicité qui rendrait l'état ambigu impossible. Les deux formes de cette
contrainte ont été construites, exécutées contre la base, et cassent toutes les
deux. Ce document existe parce que ce raisonnement ne vivait que dans un
docblock de `schema.ts` et dans le plan : la seconde revue a rejoué les deux
réfutations, les a confirmées, puis a opposé quatre scénarios à la solution
retenue, qui a tenu. Une décision de cette nature se perd si elle n'est pas
écrite là où on la cherche.

## Decision

**Plusieurs lignes vivantes par client sont un état permis. Ce qui décide est la
lecture, en deux moitiés indissociables :**

1. **un ordre total à la lecture.** `subscriptionsOfCustomer` trie par
   `last_event_at DESC`, puis `current_period_end DESC`, puis
   `provider_subscription_id DESC`. La dernière clé est la clé primaire : deux
   lignes ne sont jamais à égalité, et deux lectures successives rendent la même
   liste quoi que décide le moteur. L'ordre est écrit **une fois**
   (`subscriptionReadOrder`, `infrastructure/drizzle-billing-repositories.ts`) et
   l'index `billing_subscription_customer_idx` porte les mêmes quatre colonnes,
   dans le même ordre de tri et avec la même position des `NULL` — sans quoi le
   planificateur retrie par-dessus l'index, ce qui a été mesuré et corrigé par la
   migration `0002` ;
2. **une règle qui choisit**, `currentSubscriptionOf` (`domain/subscription.ts`) :
   **celui qui donne l'accès l'emporte** sur le plus récemment changé, et à
   défaut c'est le premier de la liste ordonnée. L'ordre entre ces deux
   décisions est le point : annuler l'ancien abonnement *après* avoir souscrit le
   neuf est un parcours ordinaire, l'événement le plus récent est alors celui de
   l'annulation, et trier par l'horodatage seul rejouerait le défaut.

**Le catalogue se ferme à qui a déjà l'accès.** Ouvrir un second checkout crée
*toujours* un second abonnement facturé chez le fournisseur — le SDK n'offre
aucun paramètre de remplacement. `openCheckout` refuse donc en `409` quand
`grantsAccess` est vrai pour le périmètre, et l'écran retire ses boutons en
renvoyant au portail, qui est ce que le sixième critère de la story désigne pour
changer d'offre. Plusieurs abonnements vivants restent **représentables** — la
réconciliation en trouverait si le tableau de bord du fournisseur en créait —,
ils ne sont simplement plus **atteignables depuis le produit**.

## Considered options

- **Unicité pleine sur `billing_customer_id`** — rejetée, mesurée. Elle oblige
  l'écriture à remplacer la ligne du client à chaque événement. Deux variantes
  ont été exécutées :
  - *contrainte posée sans changer l'écriture* : la livraison du webhook du
    second abonnement **lève** une violation d'unicité, et le point d'entrée
    public échoue. `docs/reliability.md` §1 l'interdit : le fournisseur rejoue,
    abandonne, et l'état diverge en silence ;
  - *cible de conflit déplacée sur le client, `provider_subscription_id`
    réécrit* : le parcours « souscrire le neuf, puis annuler l'ancien » écrase
    l'abonnement actif par l'annulation, qui est l'événement le plus récent.
    Résultat mesuré : `lignes: 1, état: expired, accès: false` — **le constat F1
    reproduit à l'identique**, à l'endroit d'à côté.
- **Unicité partielle sur les statuts vivants**
  (`where status in ('active','trialing','past_due')`) — rejetée, mesurée. Elle
  décrit bien l'invariant voulu, mais un second abonnement vivant reste
  atteignable : un appel direct sur la route de checkout suffisait, et l'écran
  lui-même l'offrait avant la présente décision. La contrainte transforme alors
  le webhook public en `500` permanent, ce que `docs/reliability.md` §1 interdit
  pour la même raison que ci-dessus. Fermer le chemin — ce que fait le refus
  `409` — protège le client ; la contrainte, elle, protège la table en cassant le
  point d'entrée.
- **Prendre la ligne la plus récemment changée** (`last_event_at` seul) —
  rejetée : c'est le cas « annuler l'ancien en dernier », où le plus récent est
  l'annulation. Mesuré comme un rouge dédié (`tests/billing.test.ts`, « reste
  actif quand l'annulation de l'ancien arrive en dernier »).
- **Supprimer les lignes terminées** — rejetée : la réconciliation relit
  l'historique complet du fournisseur et les réécrirait au passage suivant, et
  l'export des données du périmètre perdrait l'historique de facturation.
  Effacer ce que le fournisseur conserve fabriquerait une divergence au lieu de
  la réduire.

## Consequences

Ce qui devient plus facile : le parcours « annuler puis se réabonner » est un cas
ordinaire, sans écriture destructive ni fenêtre de concurrence ; la
réconciliation peut réécrire tout l'historique d'un client sans arbitrer ; le
webhook public ne peut plus échouer à cause d'un état que le produit permet.

Ce qui devient plus difficile, et ce qu'il faut surveiller :

- **l'invariant n'est pas en base.** Deux abonnements vivants pour un même client
  sont un état que le schéma accepte. Ce qui l'empêche est un refus applicatif
  (`already_subscribed`) et le portail ; un futur chemin d'écriture qui
  contournerait `openCheckout` rouvrirait la porte. Le refus est éprouvé par
  mutation, il n'est pas garanti par le moteur ;
- **l'ordre de lecture et l'index doivent rester d'accord.** Ils sont écrits à
  deux endroits — la définition de l'index dans `schema.ts`, l'ordre dans
  `subscriptionReadOrder` — et un `EXPLAIN` les confronte dans
  `tests/billing.test.ts`. C'est ce contrôle qui a montré que la première
  version de l'index ne servait pas la requête qui l'avait motivé ;
- **l'égalité d'horodatage reste départagée par la clé primaire**, donc par une
  valeur du fournisseur qui n'a aucun sens métier. C'est ce qui rend l'ordre
  *total* ; ce n'est pas ce qui le rend *juste*. Quand deux abonnements vivants
  coexistent malgré tout, c'est `currentSubscriptionOf` qui tranche, et la
  réconciliation qui répare.
