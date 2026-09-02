import { qualifyMessageKey } from '@repo/core'

import type { BillingDisplayState } from './subscription'

/**
 * **Toutes** les clés de traduction du module, dérivées ici et nulle part
 * ailleurs.
 *
 * Deux clés de ce module sont **composées** — l'état affiché et le nom d'une
 * offre —, donc invisibles au balayage statique de `tests/i18n.test.ts`, qui ne
 * voit que les clés écrites en toutes lettres. Elles sont dérivées par des
 * fonctions nommées, jamais par un gabarit écrit dans un `.tsx` : un fragment
 * (`` `state.${state}` ``) se lit comme une phrase concaténée, et c'est
 * exactement la forme que ce balayage existe pour attraper.
 */

export const BILLING_MODULE_ID = 'billing'

/** Une clé du module, qualifiée comme le registre le fera. */
export const billingKey = (key: string): string => qualifyMessageKey(BILLING_MODULE_ID, key)

/**
 * Le titre et la description de l'état d'abonnement.
 *
 * Un couple par état, et c'est ce qui rend le critère « l'écran doit dire
 * lequel » vérifiable : six états, six paires de clés, aucune valeur partagée.
 */
export const stateTitleKey = (state: BillingDisplayState): string => billingKey(`state.${state}.title`)

export const stateDescriptionKey = (state: BillingDisplayState): string =>
  billingKey(`state.${state}.description`)

/** Le nom et le résumé d'une offre du catalogue, par identifiant d'offre. */
export const offerNameKey = (offerId: string): string => billingKey(`offer.${offerId}.name`)

export const offerDescriptionKey = (offerId: string): string =>
  billingKey(`offer.${offerId}.description`)

/**
 * Les clés écrites en toutes lettres — celles que le balayage statique voit.
 *
 * `refusal` est lue par les **routes** : elles rendent une clé de catalogue et
 * non une phrase, si bien que l'écran traduit et que le corps de la réponse ne
 * dit rien de l'état interne.
 */
export const BILLING_KEYS = {
  title: billingKey('title'),
  description: billingKey('description'),
  subscriptionTitle: billingKey('subscription.title'),
  renewsAt: billingKey('subscription.renewsAt'),
  endsAt: billingKey('subscription.endsAt'),
  trialEndsAt: billingKey('subscription.trialEndsAt'),
  seats: billingKey('subscription.seats'),
  unknownOffer: billingKey('subscription.unknownOffer'),
  manage: billingKey('action.manage'),
  subscribe: billingKey('action.subscribe'),
  noScript: billingKey('action.noScript'),
  offersTitle: billingKey('offers.title'),
  emptyTitle: billingKey('offers.emptyTitle'),
  emptyDescription: billingKey('offers.emptyDescription'),
  intervalMonth: billingKey('interval.month'),
  intervalYear: billingKey('interval.year'),
  trialDays: billingKey('offers.trialDays'),
  perSeat: billingKey('offers.perSeat'),
  /**
   * L'offre **déjà souscrite**, à la place de son déclencheur.
   *
   * Sans elle, la carte de l'offre en cours proposait encore « Souscrire », et
   * cliquer ouvrait un second checkout — donc un second abonnement (constat F5
   * de la revue). Une carte simplement privée de son bouton ne dirait pas
   * pourquoi ; ce libellé le dit.
   */
  currentOffer: billingKey('offers.current'),
  /**
   * **Par où passe un changement d'offre** : le portail du fournisseur.
   *
   * Le catalogue ne propose plus de souscrire à qui a déjà l'accès — un second
   * checkout ouvre un second abonnement facturé, que le SDK ne sait pas
   * remplacer (constat M3 de la seconde revue). Une carte simplement muette
   * laisserait croire que changer d'offre est impossible ; ce libellé dit où
   * cela se fait, et il désigne le bouton « Gérer la facturation » qui est
   * juste au-dessus.
   */
  changeThroughPortal: billingKey('offers.changeThroughPortal'),
  checkoutSuccess: billingKey('return.success'),
  checkoutCancelled: billingKey('return.cancelled'),
  refusal: {
    forbidden: billingKey('refusal.forbidden'),
    unknownOffer: billingKey('refusal.unknownOffer'),
    unsupportedMode: billingKey('refusal.unsupportedMode'),
    providerUnavailable: billingKey('refusal.providerUnavailable'),
    noCustomer: billingKey('refusal.noCustomer'),
    alreadySubscribed: billingKey('refusal.alreadySubscribed'),
    failed: billingKey('refusal.failed'),
  },
} as const

/**
 * Les refus que l'écran sait afficher, **énumérés**.
 *
 * Le composant client reçoit une clé du serveur ; sans cette énumération, une
 * clé inconnue traverserait jusqu'au traducteur, qui lève depuis s09 — donc un
 * écran en 500 sur un refus. Elle est lue par le composant, qui retombe sur
 * `refusal.failed`.
 */
export const BILLING_REFUSAL_KEYS: readonly string[] = Object.values(BILLING_KEYS.refusal)
