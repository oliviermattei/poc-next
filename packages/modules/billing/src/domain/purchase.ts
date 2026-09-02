import { grantsAccess, type SubscriptionSnapshot } from './subscription'

/**
 * Ce qu'un **achat unique** donne, et ce qu'un remboursement lui retire — les
 * deux règles que ni le fournisseur ni la base ne peuvent trancher (ADR 038).
 *
 * `domain` pur : ni framework, ni ORM, ni SDK, ni port. Les statuts sont
 * redéclarés ici comme ceux de l'abonnement le sont, et c'est la couche
 * `application` qui fait la correspondance.
 *
 * **Un achat unique n'est pas un abonnement**, et tout ce fichier découle de
 * cette phrase : il n'expire pas, il ne se renouvelle pas, et aucune règle
 * d'ici ne prend de date. Le stocker comme « un abonnement toujours actif »
 * casserait au premier calcul de revenu récurrent (s38) — le piège que la story
 * nomme.
 */

/**
 * Les trois états d'une ligne d'achat.
 *
 * `pending` est écrit **à l'ouverture du checkout**, avant que l'URL ne parte au
 * navigateur (ADR 038 §1) : c'est lui qui porte l'offre, que la charge utile de
 * confirmation ne dit pas. Il n'accorde rien — personne n'a encore payé.
 */
export const PURCHASE_STATUSES = ['pending', 'paid', 'refunded'] as const

export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number]

/** L'achat tel que le cache local le connaît. C'est un cache (ADR 034). */
export interface PurchaseSnapshot {
  readonly status: PurchaseStatus
}

/**
 * Cet achat donne-t-il accès aux fonctionnalités payantes ?
 *
 * **Aucun instant en paramètre**, et c'est la décision : un achat unique
 * n'expire pas. Lui passer une date serait déjà lui donner une échéance, et le
 * premier appelant qui oublierait de la passer inventerait un comportement.
 */
export function purchaseGrantsAccess(purchase: PurchaseSnapshot | null): boolean {
  return purchase !== null && purchase.status === 'paid'
}

/**
 * Ce remboursement annule-t-il la vente ? (ADR 038 §3)
 *
 * Le fournisseur émet le **même** type d'événement pour un remboursement total
 * et pour un geste commercial partiel. Révoquer sur les deux détruirait une
 * licence à vie payée pour quelques euros rendus par politesse ; c'est le
 * vendeur qui serait puni d'avoir été aimable, et rien ne ré-octroie.
 *
 * La règle est donc ici, et non dans l'adaptateur : celui-ci transporte les deux
 * montants, celui-ci décide. Une charge à zéro n'a rien à rendre.
 */
export function refundRevokesPurchase(refund: {
  readonly amount: number
  readonly amountRefunded: number
}): boolean {
  return refund.amount > 0 && refund.amountRefunded >= refund.amount
}

/**
 * **Le droit d'accès consolidé** — abonnement *ou* achat payé (critères 3 et 6).
 *
 * C'est la fonction unique que s21 interrogera : le gating ne doit jamais lire
 * directement l'état d'un abonnement, sinon l'achat unique est inutilisable.
 *
 * Les deux sources sont **indépendantes**, et c'est tout le point : un
 * abonnement expiré ne retire pas un achat payé, un achat remboursé ne retire
 * pas un abonnement actif. Une règle qui prendrait le minimum des deux, ou qui
 * en ferait dépendre l'autre, casserait le sixième critère.
 */
export function grantsBillingAccess(
  subscription: SubscriptionSnapshot | null,
  purchases: readonly PurchaseSnapshot[],
  now: Date,
): boolean {
  return grantsAccess(subscription, now) || purchases.some(purchaseGrantsAccess)
}

/**
 * **Ce qu'une lecture de réconciliation impose à une ligne d'achat** — ou
 * `null` quand elle n'a pas d'opinion.
 *
 * La réconciliation relit le fournisseur, qui fait foi (ADR 034 §3). Mais faire
 * foi n'est pas tout savoir, et cette fonction existe pour deux silences que la
 * revue de s20 a relevés, chacun ayant produit une écriture fausse :
 *
 * 1. **une charge introuvable n'est pas une charge non remboursée** (constat
 *    m1). `listPurchases` rend `chargedAmount: null` quand aucune charge ne
 *    correspond — au-delà du plafond de pagination, et **toujours** en mode
 *    local. Traduire ce silence en `amountRefunded < amount` réécrivait une
 *    ligne `refunded` en `paid` : la réconciliation **ré-accordait** un achat
 *    remboursé. « Elle n'efface jamais » était tenu ; « elle ne ré-accorde
 *    jamais » ne l'était pas ;
 * 2. **une session impayée ne dit rien d'un achat qu'une autre a payé**. Depuis
 *    que `billing_purchase_session` retient chaque ouverture (constat C1),
 *    plusieurs sessions désignent le même achat : celle qui a été abandonnée
 *    rétrograderait en `pending` la ligne que celle qui a été payée vient de
 *    promouvoir.
 *
 * `null` veut donc dire « ne touche pas », et c'est la seule valeur honnête
 * quand la lecture ne tranche pas. La règle de révocation reste
 * `refundRevokesPurchase`, appelée ici comme elle l'est sur le webhook.
 */
export function reconciledPurchaseStatus(reading: {
  readonly stored: PurchaseStatus
  readonly paid: boolean
  readonly chargedAmount: number | null
  readonly amountRefunded: number
}): PurchaseStatus | null {
  if (!reading.paid) {
    return null
  }

  if (reading.chargedAmount === null) {
    // Le paiement est encaissé, mais rien ne dit ce qui a été rendu. On promeut
    // ce qui attendait ; on ne relève jamais un remboursement déjà connu.
    return reading.stored === 'refunded' ? null : 'paid'
  }

  return refundRevokesPurchase({
    amount: reading.chargedAmount,
    amountRefunded: reading.amountRefunded,
  })
    ? 'refunded'
    : 'paid'
}
