import { describe, expect, it } from 'vitest'

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
  type SubscriptionSnapshot,
} from './subscription'
import {
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
