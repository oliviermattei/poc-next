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
 *
 * **Quatrième décision, ajoutée par s21 (ADR 044) : un essai expire par le
 * temps.** Le point 1 ci-dessus ne vaut plus pour `trialing`, et c'est le cœur
 * de la story — « un essai est un droit d'accès qui **expire sans paiement** ».
 * Le fournisseur émet bien un événement quand il convertit ou échoue l'essai,
 * mais cet événement peut se perdre : c'est exactement ce que la commande de
 * réconciliation existe pour rattraper (ADR 034 §3), donc exactement ce qu'un
 * droit d'accès ne peut pas attendre. Un essai dont le terme est passé
 * n'accorde plus rien, sans qu'aucun webhook n'ait à arriver.
 *
 * C'est la même mécanique que l'annulation programmée : la tolérance au retard
 * du cache s'efface devant une **échéance**, et l'essai en est une.
 * `trialEnd` absent d'une ligne `trialing` ne devrait pas exister ; il retombe
 * alors sur `currentPeriodEnd`, pour que l'accès reste **borné** au lieu de
 * devenir perpétuel sur une lacune de notre cache.
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

  if (subscription.status === 'trialing') {
    return now.getTime() < trialTermOf(subscription).getTime()
  }

  if (subscription.cancelAtPeriodEnd || subscription.status === 'past_due') {
    return now.getTime() < subscription.currentPeriodEnd.getTime()
  }

  return true
}

/** Le terme opposable d'un essai : sa date, ou à défaut la fin de la période. */
const trialTermOf = (subscription: SubscriptionSnapshot): Date =>
  subscription.trialEnd ?? subscription.currentPeriodEnd

/**
 * **Combien de jours d'essai cette offre ouvre à ce périmètre** — zéro, ou
 * plutôt `null`, s'il en a déjà eu un (ADR 044).
 *
 * Le fournisseur n'a **aucune** mémoire d'essai par client : mesuré dans
 * `stripe@22.6.1`, `subscription_data.trial_period_days` est un nombre que
 * l'appelant pose à chaque ouverture de session de checkout, et rien n'y
 * consulte l'historique. Un périmètre qui a essayé, laissé l'essai expirer,
 * puis ouvert un checkout sur une autre offre recevait donc quatorze jours de
 * plus — indéfiniment, offre après offre.
 *
 * La trace d'un essai déjà accordé est **déjà en cache**, et elle est
 * reconstructible depuis le fournisseur (`listSubscriptions` rend `trialEnd`) :
 * une ligne d'abonnement qui porte une date de fin d'essai. C'est pourquoi
 * cette règle ne demande **aucune table** — donc aucune donnée personnelle de
 * plus, aucune catégorie à déclarer, aucune purge ni aucun export à rouvrir.
 *
 * Elle prend les jours de l'offre plutôt que l'offre entière : c'est tout ce
 * qu'il lui faut, et cela la rend appelable sur une offre absente du catalogue.
 */
export function trialDaysFor(
  offerTrialDays: number | null,
  subscriptions: readonly Pick<SubscriptionSnapshot, 'trialEnd'>[],
): number | null {
  if (offerTrialDays === null) {
    return null
  }

  return subscriptions.some((subscription) => subscription.trialEnd !== null)
    ? null
    : offerTrialDays
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
export const BILLING_DISPLAY_STATES = [
  'none',
  'trialing',
  'active',
  'ending',
  'past_due',
  'expired',
] as const

/**
 * **Une liste, dont le type est dérivé** — et non l'inverse (revue de s37b2,
 * constat F7).
 *
 * Une union de littéraux n'existe qu'à la compilation : personne ne peut la
 * parcourir. Or ces états sortent du module par un port et deviennent des clés
 * de traduction chez l'appelant — le back-office construit
 * `admin.subscription.<état>` —, et `intl.t` **lève** sur une clé absente. Un
 * septième état ajouté ici transformait donc un écran d'un autre module en 500,
 * sans qu'aucune commande ne le voie. `tests/admin.test.ts` parcourt cette
 * liste et exige un libellé pour chacun, dans chaque locale.
 *
 * `SUBSCRIPTION_STATUSES`, juste au-dessus, est déjà de cette forme : celui-ci
 * s'y range.
 */
export type BillingDisplayState = (typeof BILLING_DISPLAY_STATES)[number]

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

  if (subscription.status === 'trialing') {
    // **Un essai périmé n'est pas « essai en cours »** (s21). L'écran suit
    // l'accès : dire « période d'essai » à quelqu'un qui n'a plus rien serait
    // le laisser chercher pourquoi ses fonctionnalités ont disparu.
    return now.getTime() < trialTermOf(subscription).getTime() ? 'trialing' : 'expired'
  }

  return 'active'
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
