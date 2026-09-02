/**
 * Ce qu'un abonnement **donne** et ce que l'écran doit en **dire** — les deux
 * règles que ni le fournisseur ni la base ne peuvent trancher.
 *
 * `domain` pur : ni framework, ni ORM, ni SDK, et **pas non plus `@repo/ports`**
 * (`tooling/eslint/boundaries.ts` le refuse — un port est l'interface d'une
 * dépendance externe, et le domaine n'en connaît aucune). Les statuts sont donc
 * redéclarés ici, et c'est la couche `application` qui fait la correspondance.
 * Les deux listes portent les mêmes mots, et c'est délibéré : traduire un mot en
 * lui-même est le prix d'une frontière, pas une duplication de règle.
 */

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incomplete',
  'paused',
] as const

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

/** L'abonnement tel que le cache local le connaît. C'est un cache (ADR 034). */
export interface SubscriptionSnapshot {
  readonly status: SubscriptionStatus
  readonly currentPeriodEnd: Date
  readonly cancelAtPeriodEnd: boolean
  readonly trialEnd: Date | null
}

/**
 * Cet abonnement donne-t-il accès aux fonctionnalités payantes ?
 *
 * Trois décisions, et chacune se paie si on l'inverse :
 *
 * 1. **`active` et `trialing` donnent l'accès sans regarder la date.** Notre
 *    cache peut être en retard d'un webhook ; refuser l'accès à un client que
 *    Stripe a renouvelé serait le couper sur **notre** retard.
 * 2. **Une annulation programmée rend la date opposable.** C'est le critère 7 :
 *    l'accès court jusqu'à la fin de la période payée, puis s'arrête. Ici la
 *    tolérance du point 1 ne s'applique pas — c'est justement l'annulation qui
 *    fait de cette date une échéance.
 * 3. **Un paiement en retard garde l'accès jusqu'à la fin de la période
 *    payée.** La relance de Stripe court pendant cette période : couper au
 *    premier échec punirait une carte expirée comme un impayé définitif.
 *
 * `canceled`, `paused` et `incomplete` ne donnent rien : le premier est fini, le
 * deuxième est suspendu, le troisième n'a jamais été payé.
 */
export function grantsAccess(subscription: SubscriptionSnapshot | null, now: Date): boolean {
  if (subscription === null) {
    return false
  }

  if (
    subscription.status === 'canceled' ||
    subscription.status === 'paused' ||
    subscription.status === 'incomplete'
  ) {
    return false
  }

  if (subscription.cancelAtPeriodEnd || subscription.status === 'past_due') {
    return now.getTime() < subscription.currentPeriodEnd.getTime()
  }

  return true
}

/**
 * **Lequel des abonnements d'un client est *le* sien** — la règle qui manquait
 * (constat F1 de la revue).
 *
 * Un client qui annule puis se réabonne a deux lignes en cache, et rien
 * n'interdit qu'il en ait davantage : le fournisseur garde l'historique, et la
 * réconciliation le relit. Prendre « la première ligne rendue par la base »
 * affichait « abonnement expiré » et refusait l'accès à quelqu'un qui venait de
 * payer — mesuré, et reproductible : PostgreSQL rend l'ordre d'insertion.
 *
 * Deux décisions, et l'ordre entre elles est le point :
 *
 * 1. **celui qui donne l'accès l'emporte.** Annuler l'ancien abonnement *après*
 *    avoir souscrit le neuf est un parcours ordinaire ; l'événement le plus
 *    récent est alors celui de l'annulation, et trier par l'horodatage seul
 *    rejouerait le défaut ;
 * 2. **à défaut, le plus récemment changé.** C'est le premier de la liste : elle
 *    arrive **déjà ordonnée** du dépôt (`subscriptionsOfCustomer`), par un ordre
 *    total qui ne dépend pas du moteur.
 *
 * Elle est générique sur la ligne pour que l'appelant récupère **sa** forme —
 * la couche `application` a besoin de l'offre et des dates, que ce `domain`
 * n'a pas à connaître.
 */
export function currentSubscriptionOf<TSubscription extends SubscriptionSnapshot>(
  subscriptions: readonly TSubscription[],
  now: Date,
): TSubscription | null {
  return (
    subscriptions.find((subscription) => grantsAccess(subscription, now)) ??
    subscriptions[0] ??
    null
  )
}

/**
 * Ce que l'écran affiche — **six états, dont les trois que la story exige**
 * (sans abonnement, expiré, paiement échoué).
 *
 * Les trois autres existent parce que les confondre serait un mensonge : un
 * essai n'est pas un abonnement payé, une annulation encore couverte n'est pas
 * une expiration, et un abonnement qui se termine ne se gère pas comme un
 * abonnement qui court.
 *
 * C'est une fonction **distincte** de `grantsAccess`, et non un dérivé : un
 * abonnement `incomplete` n'accorde rien mais s'affiche « paiement échoué »,
 * parce que c'est ce que la personne doit lire pour agir.
 */
export type BillingDisplayState =
  | 'none'
  | 'trialing'
  | 'active'
  | 'ending'
  | 'past_due'
  | 'expired'

export function displayStateOf(
  subscription: SubscriptionSnapshot | null,
  now: Date,
): BillingDisplayState {
  if (subscription === null) {
    return 'none'
  }

  if (subscription.status === 'past_due' || subscription.status === 'incomplete') {
    return 'past_due'
  }

  if (subscription.status === 'canceled' || subscription.status === 'paused') {
    return 'expired'
  }

  if (subscription.cancelAtPeriodEnd) {
    return now.getTime() < subscription.currentPeriodEnd.getTime() ? 'ending' : 'expired'
  }

  return subscription.status === 'trialing' ? 'trialing' : 'active'
}

/**
 * Cet événement doit-il être appliqué à l'état enregistré ? (ADR 034)
 *
 * Le fournisseur ne garantit **aucun** ordre de livraison. Un
 * `customer.subscription.updated` livré en retard décrit un passé : l'appliquer
 * remplacerait l'état courant par un état périmé, et l'écran mentirait jusqu'au
 * prochain événement.
 *
 * L'**égalité est appliquée**, et c'est écrit plutôt que subi : deux événements
 * de la même seconde sont fréquents à la création d'un abonnement, et refuser
 * l'égalité perdrait le second d'une paire légitime. Le prix — deux états
 * différents à la même seconde sont départagés par l'ordre d'arrivée — est
 * assumé dans l'ADR 034, et c'est la commande de réconciliation qui le répare.
 */
export function appliesAfter(lastEventAt: Date | null, occurredAt: Date): boolean {
  return lastEventAt === null || occurredAt.getTime() >= lastEventAt.getTime()
}
