import { describe, expect, it } from 'vitest'

import { trialReminderWindow, trialsToRemind } from './trial-reminder'
import {
  BillingConfigError,
  formatOfferPrice,
  parseBillingCatalogue,
  type BillingOffer,
} from './offer'
import {
  appliesAfter,
  currentSubscriptionOf,
  displayStateOf,
  grantsAccess,
  trialDaysFor,
  type SubscriptionSnapshot,
} from './subscription'
import {
  entitledOfferIds,
  grantsBillingAccess,
  reconciledPurchaseStatus,
  purchaseGrantsAccess,
  refundRevokesPurchase,
  type PurchaseSnapshot,
  type PurchaseStatus,
} from './purchase'

/**
 * Les règles pures du module, éprouvées **là où elles vivent**.
 *
 * Un seul fichier pour le catalogue et pour l'abonnement : le coût d'une suite
 * est dominé par le fichier, pas par l'assertion, et les deux appartiennent au
 * même `domain`.
 */

const SUBSCRIPTION: BillingOffer = {
  id: 'pro-monthly',
  mode: 'subscription',
  priceId: 'price_pro_monthly',
  amount: 2900,
  currency: 'eur',
  interval: 'month',
  trialDays: 14,
  perSeat: false,
}

const offer = (overrides: Record<string, unknown>): unknown => ({ ...SUBSCRIPTION, ...overrides })

describe('le catalogue d’offres', () => {
  it('accepte une offre complète et la rend telle quelle', () => {
    expect(parseBillingCatalogue([SUBSCRIPTION])).toEqual([SUBSCRIPTION])
  })

  it('accepte un catalogue vide : un projet peut ne rien vendre', () => {
    expect(parseBillingCatalogue([])).toEqual([])
  })

  /**
   * **Le plafond de sièges** (s47, critère 1) : un champ **facultatif**.
   *
   * Les deux cas ci-dessous sont les deux moitiés du critère — « une limite
   * configurable sur une offre, une offre sans limite restant illimitée ». Le
   * second est celui qui rougit si le champ devenait obligatoire : le catalogue
   * livré ne déclarerait alors plus.
   */
  it('accepte une offre plafonnée et rend le plafond tel quel', () => {
    expect(parseBillingCatalogue([offer({ seatLimit: 5 })])).toEqual([
      { ...SUBSCRIPTION, seatLimit: 5 },
    ])
  })

  it('accepte une offre sans plafond, et n’en invente aucun', () => {
    const [parsed] = parseBillingCatalogue([SUBSCRIPTION])

    expect(parsed?.seatLimit ?? null).toBeNull()
  })

  /**
   * **Un plafond sur un forfait est légitime** (s47, décision 2) : c'est même
   * son cas d'usage le plus courant. Le catalogue ne doit donc pas le lier à
   * `perSeat`, contrairement à ce qu'une symétrie avec `offerSyncsSeats`
   * suggérerait.
   */
  it('accepte un plafond sur une offre au forfait', () => {
    expect(parseBillingCatalogue([offer({ perSeat: false, seatLimit: 3 })])).toEqual([
      { ...SUBSCRIPTION, perSeat: false, seatLimit: 3 },
    ])
  })

  /**
   * **Un plafond sur un achat unique ne s'exécute nulle part** (constat M1 de
   * la revue de s47) : `syncSeats` résout l'offre courante depuis l'abonnement
   * vivant, un encaissement unique n'en a aucun, et la fonction sort en
   * `not_applicable` avant même de lire le plafond. Le catalogue le refuse
   * donc au démarrage — le refus est dans la table ci-dessous.
   *
   * Ce cas-ci est l'**autre moitié** : `null` reste accepté sur ce mode. La
   * documentation du champ dit « absent comme `null`, l'offre est illimitée »,
   * et une condition écrite sur la présence de la clé plutôt que sur sa valeur
   * refuserait un catalogue parfaitement légitime.
   */
  it('accepte un achat unique dont le plafond est nul', () => {
    const oneTime = offer({ mode: 'one_time', interval: null, trialDays: null, seatLimit: null })

    expect(parseBillingCatalogue([oneTime])).toEqual([oneTime])
  })

  /**
   * Chaque cas nomme **l'offre et le champ**. Un message qui dirait seulement
   * « configuration invalide » obligerait à relire le fichier à la main, et
   * c'est au démarrage d'un déploiement que ça se produirait.
   */
  const REFUSED: readonly { readonly why: string; readonly value: unknown; readonly names: string }[] =
    [
      { why: 'un identifiant qui n’est pas en kebab-case', value: offer({ id: 'Pro Monthly' }), names: 'id' },
      { why: 'un mode inconnu', value: offer({ mode: 'invoice' }), names: 'mode' },
      { why: 'un prix de fournisseur vide', value: offer({ priceId: '' }), names: 'priceId' },
      { why: 'un montant négatif', value: offer({ amount: -1 }), names: 'amount' },
      { why: 'un montant fractionnaire', value: offer({ amount: 29.5 }), names: 'amount' },
      { why: 'une devise qui n’est pas un code ISO', value: offer({ currency: 'euros' }), names: 'currency' },
      { why: 'un intervalle inconnu', value: offer({ interval: 'week' }), names: 'interval' },
      { why: 'une période d’essai négative', value: offer({ trialDays: -3 }), names: 'trialDays' },
      { why: 'un abonnement sans intervalle', value: offer({ interval: null }), names: 'interval' },
      {
        why: 'un achat unique avec un intervalle',
        value: offer({ mode: 'one_time', trialDays: null }),
        names: 'interval',
      },
      {
        why: 'un achat unique avec une période d’essai',
        value: offer({ mode: 'one_time', interval: null }),
        names: 'trialDays',
      },
      {
        // M1 de la revue de s47, et le frère exact du cas ci-dessus : une
        // intention que rien n'exécute, refusée au démarrage plutôt
        // qu'ignorée en silence.
        why: 'un achat unique avec un plafond de sièges',
        value: offer({ mode: 'one_time', interval: null, trialDays: null, seatLimit: 5 }),
        names: 'seatLimit',
      },
      { why: 'un plafond de sièges nul', value: offer({ seatLimit: 0 }), names: 'seatLimit' },
      { why: 'un plafond de sièges négatif', value: offer({ seatLimit: -3 }), names: 'seatLimit' },
      {
        why: 'un plafond de sièges fractionnaire',
        value: offer({ seatLimit: 2.5 }),
        names: 'seatLimit',
      },
      { why: 'un champ absent', value: { id: 'pro' }, names: 'mode' },
    ]

  it.each(REFUSED)('refuse $why en nommant le champ', ({ value, names }) => {
    expect(() => parseBillingCatalogue([value])).toThrow(BillingConfigError)

    try {
      parseBillingCatalogue([value])
      expect.unreachable('le catalogue aurait dû être refusé')
    } catch (error) {
      const message = (error as Error).message

      expect(message).toContain(names)
      // L'offre est nommée par son identifiant quand il est lisible : sans lui,
      // il faut compter les entrées du tableau pour retrouver la fautive.
      expect(message.length).toBeGreaterThan(names.length)
    }
  })

  it('refuse deux offres qui portent le même identifiant', () => {
    expect(() => parseBillingCatalogue([SUBSCRIPTION, { ...SUBSCRIPTION, priceId: 'price_autre' }])).toThrow(
      /pro-monthly/,
    )
  })

  /**
   * Deux offres sur le même prix rendraient la lecture inverse ambiguë : un
   * abonnement reçu du fournisseur ne porte que le prix, et l'écran ne saurait
   * plus quelle offre nommer.
   */
  it('refuse deux offres qui pointent le même prix de fournisseur', () => {
    expect(() =>
      parseBillingCatalogue([SUBSCRIPTION, { ...SUBSCRIPTION, id: 'pro-annuel' }]),
    ).toThrow(/price_pro_monthly/)
  })

  it('refuse un catalogue qui n’est pas une liste', () => {
    expect(() => parseBillingCatalogue({ 'pro-monthly': SUBSCRIPTION })).toThrow(BillingConfigError)
  })
})

/* -------------------------------------------------------------------------- *
 * L'abonnement : accès, état affiché, ordre d'application.
 * -------------------------------------------------------------------------- */

const NOW = new Date('2026-09-01T12:00:00.000Z')
const LATER = new Date('2026-10-01T12:00:00.000Z')
const EARLIER = new Date('2026-08-01T12:00:00.000Z')

const snapshot = (overrides: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot => ({
  status: 'active',
  currentPeriodEnd: LATER,
  cancelAtPeriodEnd: false,
  trialEnd: null,
  ...overrides,
})

describe('qui a accès aux fonctionnalités payantes', () => {
  it('refuse quand il n’y a pas d’abonnement', () => {
    expect(grantsAccess(null, NOW)).toBe(false)
  })

  it('accorde un abonnement actif ou en essai', () => {
    expect(grantsAccess(snapshot(), NOW)).toBe(true)
    expect(grantsAccess(snapshot({ status: 'trialing', trialEnd: LATER }), NOW)).toBe(true)
  })

  /**
   * **Le cache peut être en retard, et un client qui paie ne doit pas en
   * pâtir.** Un abonnement `active` que Stripe a renouvelé sans que le webhook
   * soit arrivé porte encore l'ancienne fin de période. Lui refuser l'accès
   * serait couper un client à jour sur notre propre retard.
   */
  it('accorde un abonnement actif dont la période affichée est dépassée', () => {
    expect(grantsAccess(snapshot({ currentPeriodEnd: EARLIER }), NOW)).toBe(true)
  })

  /**
   * **Critère 7.** Un abonnement annulé conserve l'accès jusqu'à la fin de la
   * période payée, puis le perd. Ici la tolérance ci-dessus ne s'applique
   * **pas** : c'est justement l'annulation qui rend la date opposable.
   */
  it('accorde un abonnement annulé jusqu’à la fin de la période payée', () => {
    const ending = snapshot({ cancelAtPeriodEnd: true })

    expect(grantsAccess(ending, NOW)).toBe(true)
    expect(grantsAccess(ending, LATER)).toBe(false)
    expect(grantsAccess({ ...ending, currentPeriodEnd: EARLIER }, NOW)).toBe(false)
  })

  it('accorde un paiement en retard jusqu’à la fin de la période payée', () => {
    // La relance de Stripe court pendant la période déjà payée : couper
    // immédiatement punirait une carte expirée comme un impayé définitif.
    expect(grantsAccess(snapshot({ status: 'past_due' }), NOW)).toBe(true)
    expect(grantsAccess(snapshot({ status: 'past_due', currentPeriodEnd: EARLIER }), NOW)).toBe(
      false,
    )
  })

  it('refuse un abonnement annulé, suspendu ou jamais payé', () => {
    for (const status of ['canceled', 'paused', 'incomplete'] as const) {
      expect(grantsAccess(snapshot({ status }), NOW), status).toBe(false)
    }
  })
})

describe('ce que l’écran doit dire', () => {
  /**
   * Les trois états que la story exige d'abord — **sans abonnement**,
   * **expiré**, **paiement échoué** — plus les trois que confondre serait un
   * mensonge : un essai n'est pas un abonnement payé, et une annulation encore
   * couverte n'est pas une expiration.
   */
  const CASES: readonly {
    readonly state: string
    readonly subscription: SubscriptionSnapshot | null
    readonly at?: Date
  }[] = [
    { state: 'none', subscription: null },
    { state: 'trialing', subscription: snapshot({ status: 'trialing', trialEnd: LATER }) },
    { state: 'active', subscription: snapshot() },
    { state: 'ending', subscription: snapshot({ cancelAtPeriodEnd: true }) },
    { state: 'expired', subscription: snapshot({ cancelAtPeriodEnd: true }), at: LATER },
    { state: 'expired', subscription: snapshot({ status: 'canceled' }) },
    { state: 'expired', subscription: snapshot({ status: 'paused' }) },
    { state: 'past_due', subscription: snapshot({ status: 'past_due' }) },
    { state: 'past_due', subscription: snapshot({ status: 'incomplete' }) },
  ]

  it.each(CASES)('rend « $state »', ({ state, subscription, at }) => {
    expect(displayStateOf(subscription, at ?? NOW)).toBe(state)
  })

  it('distingue les trois états que la story nomme', () => {
    // Sans ce cas, les trois pourraient se confondre en un seul libellé et la
    // suite resterait verte : c'est la distinction qui est le critère.
    const states = new Set([
      displayStateOf(null, NOW),
      displayStateOf(snapshot({ status: 'canceled' }), NOW),
      displayStateOf(snapshot({ status: 'past_due' }), NOW),
    ])

    expect(states.size).toBe(3)
  })
})

/**
 * **Lequel des abonnements d'un client est *le* sien** (constat F1 de la revue).
 *
 * Un client qui annule puis se réabonne a **deux** lignes en cache : l'ancienne,
 * annulée, et la neuve. Prendre la première venue affichait « expiré » et
 * refusait l'accès à quelqu'un qui venait de payer.
 *
 * La liste arrive **déjà ordonnée** par le dépôt — événement le plus récent en
 * tête —, et cette règle-ci tranche ce que l'ordre ne suffit pas à trancher :
 * l'abonnement qui **donne l'accès** l'emporte sur celui qui ne le donne plus,
 * quel que soit lequel a bougé en dernier.
 */
describe('l’abonnement courant d’un client', () => {
  const canceled = { ...snapshot({ status: 'canceled' }), id: 'ancien' }
  const active = { ...snapshot(), id: 'neuf' }

  it('n’en trouve aucun quand le client n’en a jamais eu', () => {
    expect(currentSubscriptionOf([], NOW)).toBeNull()
  })

  it('rend le seul qu’il y a', () => {
    expect(currentSubscriptionOf([canceled], NOW)).toBe(canceled)
  })

  it('rend celui qui donne l’accès, même quand l’autre a bougé en dernier', () => {
    // Le scénario mesuré : souscrire, annuler, se réabonner — puis annuler
    // l'ancien, dont l'événement est alors **le plus récent**. Sans cette
    // règle, l'écran dit « expiré » à un abonné qui paie.
    expect(currentSubscriptionOf([canceled, active], NOW)).toBe(active)
    expect(currentSubscriptionOf([active, canceled], NOW)).toBe(active)
  })

  it('rend le plus récemment changé quand aucun ne donne plus l’accès', () => {
    const older = { ...snapshot({ status: 'canceled' }), id: 'plus-ancien' }

    expect(currentSubscriptionOf([canceled, older], NOW)).toBe(canceled)
  })
})

describe('l’ordre d’application des événements', () => {
  it('applique le premier événement, quand rien n’a encore été appliqué', () => {
    expect(appliesAfter(null, NOW)).toBe(true)
  })

  it('applique un événement plus récent', () => {
    expect(appliesAfter(EARLIER, NOW)).toBe(true)
  })

  it('n’applique pas un événement plus ancien : c’est le désordre de livraison', () => {
    // Stripe ne garantit aucun ordre. Un `customer.subscription.updated` livré
    // en retard écraserait l'état courant par un état périmé (ADR 034).
    expect(appliesAfter(LATER, NOW)).toBe(false)
  })

  it('applique un événement du même instant', () => {
    // Deux événements de la même seconde sont fréquents à la création d'un
    // abonnement : refuser l'égalité perdrait le second d'une paire légitime.
    // Le prix assumé est écrit dans l'ADR 034 — la réconciliation répare.
    expect(appliesAfter(NOW, NOW)).toBe(true)
  })
})

describe('le prix affiché', () => {
  it('rend un montant lisible dans la devise de l’offre', () => {
    const formatted = formatOfferPrice({ amount: 2900, currency: 'eur' }, 'fr')

    expect(formatted).toContain('29')
    expect(formatted).toContain('€')
  })

  it('n’invente pas de décimales : le montant est en unités mineures', () => {
    expect(formatOfferPrice({ amount: 29_000, currency: 'eur' }, 'fr')).toContain('290')
  })
})

/* -------------------------------------------------------------------------- *
 * s20 — l'achat unique. Mêmes règles pures, même fichier : le coût d'une suite
 * est dominé par le fichier, et ces règles appartiennent au même `domain`.
 * -------------------------------------------------------------------------- */

const purchase = (status: PurchaseStatus): PurchaseSnapshot => ({ status })

describe('ce qu’un achat unique donne', () => {
  it('n’accorde rien tant que le paiement n’est pas encaissé', () => {
    expect(purchaseGrantsAccess(purchase('pending'))).toBe(false)
  })

  it('accorde l’accès à un achat payé, **sans regarder aucune date**', () => {
    // Le critère 2 : un achat unique n'expire pas. La règle ne prend donc pas
    // d'instant — lui en donner un serait déjà une échéance.
    expect(purchaseGrantsAccess(purchase('paid'))).toBe(true)
  })

  it('n’accorde plus rien à un achat remboursé', () => {
    expect(purchaseGrantsAccess(purchase('refunded'))).toBe(false)
  })
})

describe('ce qu’un remboursement révoque', () => {
  it('révoque quand tout a été rendu', () => {
    expect(refundRevokesPurchase({ amount: 49_000, amountRefunded: 49_000 })).toBe(true)
  })

  it('laisse le droit sur un geste commercial partiel', () => {
    // ADR 038 §3 : `charge.refunded` est émis pour un remboursement partiel
    // comme total. Révoquer sur tout remboursement détruirait une licence à vie
    // pour un geste de quelques euros.
    expect(refundRevokesPurchase({ amount: 49_000, amountRefunded: 100 })).toBe(false)
  })

  it('ne révoque rien quand rien n’a été rendu', () => {
    expect(refundRevokesPurchase({ amount: 49_000, amountRefunded: 0 })).toBe(false)
  })

  it('ne révoque pas sur une charge à zéro : il n’y a rien à rendre', () => {
    expect(refundRevokesPurchase({ amount: 0, amountRefunded: 0 })).toBe(false)
  })
})

describe('l’accès consolidé aux fonctionnalités payantes', () => {
  it('n’accorde rien sans abonnement ni achat', () => {
    expect(grantsBillingAccess(null, [], NOW)).toBe(false)
  })

  it('accorde par l’abonnement seul', () => {
    expect(grantsBillingAccess(snapshot(), [], NOW)).toBe(true)
  })

  it('accorde par l’achat seul, **sans aucun abonnement**', () => {
    // Le critère 3 : « le droit d'accès survit à l'absence d'abonnement ».
    expect(grantsBillingAccess(null, [purchase('paid')], NOW)).toBe(true)
  })

  it('garde l’accès de l’achat quand l’abonnement est expiré', () => {
    // La moitié qui mord du critère 3 : aucune vérification d'abonnement actif
    // ne révoque un achat unique.
    expect(grantsBillingAccess(snapshot({ status: 'canceled' }), [purchase('paid')], NOW)).toBe(
      true,
    )
  })

  it('garde l’accès de l’abonnement quand l’achat a été remboursé', () => {
    expect(grantsBillingAccess(snapshot(), [purchase('refunded')], NOW)).toBe(true)
  })

  it('ne retient qu’un achat payé parmi plusieurs', () => {
    expect(grantsBillingAccess(null, [purchase('refunded'), purchase('paid')], NOW)).toBe(true)
    expect(grantsBillingAccess(null, [purchase('refunded'), purchase('pending')], NOW)).toBe(false)
  })
})

describe('ce qu’une lecture de réconciliation impose à un achat', () => {
  it('promeut ce qui attendait quand le fournisseur dit « encaissé »', () => {
    expect(
      reconciledPurchaseStatus({
        stored: 'pending',
        paid: true,
        chargedAmount: 49_000,
        amountRefunded: 0,
      }),
    ).toBe('paid')
  })

  it('révoque quand la charge relue a été intégralement rendue', () => {
    expect(
      reconciledPurchaseStatus({
        stored: 'paid',
        paid: true,
        chargedAmount: 49_000,
        amountRefunded: 49_000,
      }),
    ).toBe('refunded')
  })

  it('n’a **aucune opinion** sur une session que le fournisseur dit impayée', () => {
    // Plusieurs sessions désignent le même achat depuis que chaque ouverture
    // est retenue : celle qui a été abandonnée ne doit pas rétrograder la ligne
    // que celle qui a été payée vient de promouvoir.
    expect(
      reconciledPurchaseStatus({
        stored: 'paid',
        paid: false,
        chargedAmount: null,
        amountRefunded: 0,
      }),
    ).toBeNull()
  })

  it('ne ré-accorde jamais un achat remboursé dont la charge est introuvable', () => {
    // `chargedAmount: null` veut dire « je ne sais pas », pas « rien n'a été
    // remboursé » — c'est le cas du mode local et celui du plafond de
    // pagination (constat m1).
    expect(
      reconciledPurchaseStatus({
        stored: 'refunded',
        paid: true,
        chargedAmount: null,
        amountRefunded: 0,
      }),
    ).toBeNull()
  })

  it('promeut quand même un achat en attente dont la charge est introuvable', () => {
    // La dissymétrie est voulue : le silence sur le remboursement ne doit pas
    // empêcher de rattraper un paiement qu'aucun webhook n'a apporté.
    expect(
      reconciledPurchaseStatus({
        stored: 'pending',
        paid: true,
        chargedAmount: null,
        amountRefunded: 0,
      }),
    ).toBe('paid')
  })
})

/* -------------------------------------------------------------------------- *
 * s21 — l'essai, et l'accès **nommé par offre**.
 *
 * Mêmes règles pures, même fichier : trois unités du même `domain`, et le coût
 * d'une suite est dominé par le fichier.
 * -------------------------------------------------------------------------- */

/**
 * **Un essai est un droit d'accès qui expire sans paiement** (ADR 044).
 *
 * Sa conséquence est le cœur de la story : le terme est **opposable
 * localement**. Le temps passe, personne ne nous notifie — le fournisseur émet
 * un événement quand il convertit ou échoue l'essai, et cet événement peut se
 * perdre, c'est précisément ce que la réconciliation existe pour rattraper. Un
 * accès qui attendrait cet événement serait donc gratuit d'une durée
 * indéterminée.
 *
 * La tolérance au retard du cache, écrite pour `active`, ne s'applique **pas**
 * ici, et pour la même raison qu'elle ne s'applique pas à une annulation
 * programmée : c'est l'essai lui-même qui fait de cette date une échéance.
 */
describe('l’essai expire par le temps, sans qu’aucun événement n’arrive', () => {
  it('accorde l’accès jusqu’au terme de l’essai', () => {
    expect(grantsAccess(snapshot({ status: 'trialing', trialEnd: LATER }), NOW)).toBe(true)
  })

  it('retire l’accès une fois le terme passé, l’état du fournisseur inchangé', () => {
    // La ligne est toujours `trialing` en base : aucun webhook n'est arrivé.
    // C'est exactement le cas que le critère 5 nomme, et le seul qui ne dépende
    // de personne.
    const expired = snapshot({ status: 'trialing', trialEnd: EARLIER })

    expect(grantsAccess(expired, NOW)).toBe(false)
  })

  it('borne un essai dont le terme est inconnu par la fin de période', () => {
    // `trial_end` absent d'une ligne `trialing` ne devrait pas exister ; s'il
    // arrive, l'accès reste **borné** au lieu de devenir perpétuel. Fermer
    // sèchement couperait un essai légitime sur une lacune de notre cache.
    expect(grantsAccess(snapshot({ status: 'trialing', currentPeriodEnd: LATER }), NOW)).toBe(true)
    expect(grantsAccess(snapshot({ status: 'trialing', currentPeriodEnd: EARLIER }), NOW)).toBe(
      false,
    )
  })

  it('le dit à l’écran : un essai périmé n’est plus « essai en cours »', () => {
    const expired = snapshot({ status: 'trialing', trialEnd: EARLIER })

    expect(displayStateOf(expired, NOW)).toBe('expired')
    expect(displayStateOf(snapshot({ status: 'trialing', trialEnd: LATER }), NOW)).toBe('trialing')
  })

  it('n’est plus l’abonnement courant dès qu’un autre donne l’accès', () => {
    const expiredTrial = { ...snapshot({ status: 'trialing', trialEnd: EARLIER }), id: 'essai' }
    const active = { ...snapshot(), id: 'payé' }

    expect(currentSubscriptionOf([expiredTrial, active], NOW)).toBe(active)
  })
})

/**
 * **L'essai commence une fois, et une seule, par périmètre** (ADR 044).
 *
 * Le fournisseur n'a aucune mémoire d'essai par client : `trial_period_days`
 * est un nombre que **nous** posons à chaque ouverture de checkout. Un
 * périmètre qui a essayé, laissé expirer, puis ouvert un checkout sur une autre
 * offre recevait quatorze jours de plus — indéfiniment.
 *
 * La trace est déjà là, et elle est reconstructible depuis le fournisseur : une
 * ligne d'abonnement qui porte un `trial_end`. Aucune table, donc aucune donnée
 * personnelle de plus.
 */
describe('l’essai ne se prolonge pas en le redemandant', () => {
  it('accorde l’essai à un périmètre qui n’en a jamais eu', () => {
    expect(trialDaysFor(14, [])).toBe(14)
    expect(trialDaysFor(14, [snapshot()])).toBe(14)
  })

  it('ne le réaccorde pas à un périmètre qui en a déjà eu un', () => {
    expect(trialDaysFor(14, [snapshot({ status: 'trialing', trialEnd: LATER })])).toBeNull()
  })

  it('ne le réaccorde pas non plus quand l’essai est terminé depuis longtemps', () => {
    // C'est le seul cas atteignable en pratique : tant que l'essai court, la
    // garde d'abonnement de s20 refuse déjà le second checkout.
    expect(trialDaysFor(14, [snapshot({ status: 'canceled', trialEnd: EARLIER })])).toBeNull()
  })

  it('n’invente pas d’essai sur une offre qui n’en déclare pas', () => {
    expect(trialDaysFor(null, [])).toBeNull()
  })
})

/**
 * **Le droit d'accès, nommé par offre** — ce que le gating interroge.
 *
 * `grantsBillingAccess` répond « ce périmètre a-t-il accès », ce qui ne suffit
 * pas dès qu'une fonctionnalité est réservée à **certaines** offres. Les deux
 * sources restent indépendantes (critère 6 de s20) : un abonnement expiré ne
 * retire pas un achat payé, un achat remboursé ne retire pas un abonnement
 * actif.
 */
describe('les offres qu’un périmètre détient', () => {
  const sub = (
    offerId: string | null,
    overrides: Partial<SubscriptionSnapshot> = {},
  ): SubscriptionSnapshot & { readonly offerId: string | null } => ({
    ...snapshot(overrides),
    offerId,
  })

  const owned = (
    offerId: string,
    status: PurchaseStatus,
  ): PurchaseSnapshot & { readonly offerId: string } => ({ status, offerId })

  it('n’en détient aucune sans abonnement ni achat', () => {
    expect(entitledOfferIds([], [], NOW)).toEqual([])
  })

  it('détient l’offre de son abonnement vivant', () => {
    expect(entitledOfferIds([sub('pro-monthly')], [], NOW)).toEqual(['pro-monthly'])
  })

  it('détient l’offre de son achat payé, sans aucun abonnement', () => {
    expect(entitledOfferIds([], [owned('lifetime', 'paid')], NOW)).toEqual(['lifetime'])
  })

  /**
   * **Chaque état de facturation, face au droit qu'il donne** (critère 7 de la
   * story). L'énumération est ici, à la règle : ses appelants n'ont qu'à
   * prouver qu'ils l'appellent.
   */
  const STATES: readonly {
    readonly why: string
    readonly subscription: SubscriptionSnapshot & { readonly offerId: string | null }
    readonly at?: Date
    readonly offers: readonly string[]
  }[] = [
    { why: 'actif', subscription: sub('pro-monthly'), offers: ['pro-monthly'] },
    {
      why: 'en essai, avant le terme',
      subscription: sub('pro-monthly', { status: 'trialing', trialEnd: LATER }),
      offers: ['pro-monthly'],
    },
    {
      why: 'en essai, après le terme',
      subscription: sub('pro-monthly', { status: 'trialing', trialEnd: EARLIER }),
      offers: [],
    },
    {
      why: 'en retard de paiement, période encore couverte',
      subscription: sub('pro-monthly', { status: 'past_due' }),
      offers: ['pro-monthly'],
    },
    {
      why: 'en retard de paiement, période dépassée',
      subscription: sub('pro-monthly', { status: 'past_due', currentPeriodEnd: EARLIER }),
      offers: [],
    },
    {
      why: 'annulé, période payée en cours',
      subscription: sub('pro-monthly', { cancelAtPeriodEnd: true }),
      offers: ['pro-monthly'],
    },
    {
      why: 'annulé, période payée terminée',
      subscription: sub('pro-monthly', { cancelAtPeriodEnd: true }),
      at: LATER,
      offers: [],
    },
    { why: 'résilié', subscription: sub('pro-monthly', { status: 'canceled' }), offers: [] },
    { why: 'vivant mais sur une offre retirée du catalogue', subscription: sub(null), offers: [] },
  ]

  it.each(STATES)('un abonnement $why ouvre $offers', ({ subscription, at, offers }) => {
    expect(entitledOfferIds([subscription], [], at ?? NOW)).toEqual(offers)
  })

  it.each([
    ['payé', 'paid', ['lifetime']],
    ['en attente', 'pending', []],
    ['remboursé', 'refunded', []],
  ] as const)('un achat %s ouvre %s', (_why, status, offers) => {
    expect(entitledOfferIds([], [owned('lifetime', status)], NOW)).toEqual([...offers])
  })

  it('cumule les deux sources sans que l’une ferme l’autre', () => {
    // Le sixième critère de s20, relu par le gating : un abonné qui a aussi
    // acheté à vie détient les deux offres, et perdre l'une ne retire pas
    // l'autre.
    expect(
      entitledOfferIds(
        [sub('pro-monthly', { status: 'canceled' })],
        [owned('lifetime', 'paid')],
        NOW,
      ),
    ).toEqual(['lifetime'])
    expect(entitledOfferIds([sub('pro-monthly')], [owned('lifetime', 'refunded')], NOW)).toEqual([
      'pro-monthly',
    ])
    expect(
      new Set(entitledOfferIds([sub('pro-monthly')], [owned('lifetime', 'paid')], NOW)),
    ).toEqual(new Set(['pro-monthly', 'lifetime']))
  })

  it('ne rend jamais deux fois la même offre', () => {
    expect(entitledOfferIds([sub('pro-monthly'), sub('pro-monthly')], [], NOW)).toEqual([
      'pro-monthly',
    ])
  })
})

/**
 * **Qui relancer, et quand** (s33, critère 7) — la règle, là où elle vit.
 *
 * `trialEnd` était présent partout depuis s21 et **rien ne le lisait pour
 * agir** : il manquait le déclencheur, pas le modèle de données. Cette règle est
 * ce que le déclencheur lit.
 */
describe('la relance d’essai', () => {
  const trial = (
    id: string,
    trialEnd: string | null,
    status: SubscriptionSnapshot['status'] = 'trialing',
  ) => ({ id, status, trialEnd: trialEnd === null ? null : new Date(trialEnd) })

  const NOW_TRIAL = new Date('2026-09-05T09:00:00.000Z')

  it('retient un essai qui se termine exactement le jour visé', () => {
    expect(trialsToRemind([trial('a', '2026-09-08T23:59:00.000Z')], NOW_TRIAL, 3)).toEqual([
      trial('a', '2026-09-08T23:59:00.000Z'),
    ])
  })

  /**
   * **Le jour est exact, pas « dans les trois jours »**, et c'est ce qui rend la
   * relance non répétitive sans rien stocker : une tâche quotidienne ne trouve
   * un abonnement donné qu'un seul jour de sa vie. Une règle « il reste au plus
   * trois jours » l'aurait trouvé trois fois, et il aurait fallu une colonne
   * « déjà relancé » — c'est-à-dire une migration pour tenir ce qu'un calcul
   * tient.
   */
  it.each([
    ['la veille du jour visé', '2026-09-07T12:00:00.000Z'],
    ['le lendemain du jour visé', '2026-09-09T12:00:00.000Z'],
    ['aujourd’hui', '2026-09-05T12:00:00.000Z'],
  ])('écarte un essai qui se termine %s', (_why, trialEnd) => {
    expect(trialsToRemind([trial('a', trialEnd)], NOW_TRIAL, 3)).toEqual([])
  })

  it('écarte un abonnement qui n’est plus en essai, même au bon jour', () => {
    expect(
      trialsToRemind([trial('a', '2026-09-08T12:00:00.000Z', 'active')], NOW_TRIAL, 3),
    ).toEqual([])
    expect(
      trialsToRemind([trial('a', '2026-09-08T12:00:00.000Z', 'canceled')], NOW_TRIAL, 3),
    ).toEqual([])
  })

  it('écarte un essai sans échéance : il n’y a rien à annoncer', () => {
    expect(trialsToRemind([trial('a', null)], NOW_TRIAL, 3)).toEqual([])
  })

  /**
   * La fenêtre lue en base **dérive du même calcul** que la règle : plus large,
   * la relance partirait en boucle ; plus étroite, elle manquerait des essais.
   */
  it('borne la lecture sur le jour visé, des deux côtés', () => {
    expect(trialReminderWindow(NOW_TRIAL, 3)).toEqual({
      from: new Date('2026-09-08T00:00:00.000Z'),
      to: new Date('2026-09-08T23:59:59.999Z'),
    })
  })
})
