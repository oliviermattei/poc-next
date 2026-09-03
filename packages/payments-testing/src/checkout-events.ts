import type { CheckoutMode } from '@repo/ports'

/**
 * **D'où viennent les événements qu'un checkout terminé fait passer par la
 * route de webhook** — la seule couture entre les deux régimes de la story s25.
 *
 * Deux sources, jamais mélangées, et le choix est toujours **explicite** :
 *
 * | Source | Ce qu'elle rend | Quand |
 * |---|---|---|
 * | `simulatedCheckoutEvents` | des formes **écrites à la main** | développement local, parcours qui n'ont pas besoin de fidélité au fournisseur |
 * | `createRecordedCheckoutEvents` | des formes **enregistrées** chez le fournisseur | régime enregistré (`PAYMENTS_RECORDED_EVENTS`), CI du parcours doré |
 *
 * **La seconde ne retombe jamais sur la première** (ADR 048) : un
 * enregistrement absent fait échouer en le nommant. Un simulateur ne peut pas
 * détecter sa propre dérive — le jour où le fournisseur renomme un champ, il
 * reste vert pendant que la production casse —, et c'est précisément le mode de
 * défaillance que le rejeu existe pour fermer. Un repli le rouvrirait en
 * silence.
 */

/**
 * **La marque que chaque source laisse sur les identifiants d'événement**, et
 * ce à quoi elle sert (constat F1 de la revue de s25).
 *
 * Les deux régimes ne se distinguent autrement par **rien d'observable** : le
 * serveur reçoit une variable d'environnement, construit la source qu'elle
 * désigne, et l'exécution qui l'a demandée n'a aucun moyen de savoir laquelle a
 * répondu. Mesuré : la transmission retirée, une exécution annoncée
 * « enregistrée » tournait sur le simulateur, trois parcours verts, sortie 0.
 *
 * Ces préfixes sont ce qui rend la question **observable** : ils partent dans
 * l'identifiant de l'événement, la route de webhook les écrit dans son journal
 * d'idempotence (`billing_webhook_event`), et le parcours doré exige d'y
 * retrouver celui du régime demandé — un **signal positif**, jamais la simple
 * confiance en un `...spread` que personne ne garde.
 *
 * Ils doivent rester **distincts et non préfixes l'un de l'autre** :
 * `src/recorded-events.test.ts` le vérifie, sur les deux producteurs.
 */
export const SIMULATED_EVENT_ID_PREFIX = 'evt_local_'
export const RECORDED_EVENT_ID_PREFIX = 'evt_rec_'

/** Ce qu'un abonnement terminé connaît de lui-même, avant toute mise en forme. */
export interface SubscriptionCheckout {
  readonly sessionId: string
  readonly customerId: string
  readonly subscriptionId: string
  readonly itemId: string
  readonly priceId: string
  readonly reference: string
  /** L'adresse collectée par la page hébergée : `null` pour un checkout authentifié. */
  readonly email: string | null
  readonly quantity: number
  /** En secondes, comme le fournisseur les écrit. */
  readonly createdAt: number
  readonly trialEnd: number | null
  readonly periodStart: number
  readonly periodEnd: number
}

/** Idem pour un achat unique : pas d'objet `Subscription`, donc moins à décrire. */
export interface PurchaseCheckout {
  readonly sessionId: string
  readonly customerId: string
  readonly paymentId: string
  readonly reference: string
  readonly email: string | null
  readonly createdAt: number
}

export interface SubscriptionDelivery {
  /**
   * L'objet `subscription` **mémorisé** par la simulation, celui que la lecture
   * de réconciliation relira. Il vient de la même source que les événements :
   * deux provenances feraient deux vérités.
   */
  readonly subscription: Record<string, unknown>
  /** Les événements à signer puis à livrer, **dans l'ordre d'envoi**. */
  readonly events: readonly Record<string, unknown>[]
}

export interface CheckoutEvents {
  readonly subscription: (checkout: SubscriptionCheckout) => SubscriptionDelivery
  readonly purchase: (checkout: PurchaseCheckout) => Record<string, unknown>
}

/** Le mode que porte la session, pour les appelants qui distinguent les deux. */
export type { CheckoutMode }

/**
 * **Les formes écrites à la main** — le simulateur historique, extrait ici sans
 * changement de comportement.
 *
 * Ce qu'il produit est ce que *nous* avons jugé nécessaire. C'est suffisant
 * pour dérouler un parcours sans clé ; ce n'est pas une preuve de fidélité au
 * fournisseur, et `packages/payments-testing/AGENTS.md` le dit.
 */
export const simulatedCheckoutEvents: CheckoutEvents = {
  subscription: (checkout) => {
    const subscription: Record<string, unknown> = {
      id: checkout.subscriptionId,
      object: 'subscription',
      customer: checkout.customerId,
      status: checkout.trialEnd === null ? 'active' : 'trialing',
      cancel_at_period_end: false,
      trial_end: checkout.trialEnd,
      items: {
        object: 'list',
        data: [
          {
            id: checkout.itemId,
            object: 'subscription_item',
            quantity: checkout.quantity,
            current_period_start: checkout.periodStart,
            current_period_end: checkout.periodEnd,
            price: { id: checkout.priceId, object: 'price' },
          },
        ],
      },
    }

    return {
      subscription,
      // **Volontairement dans le désordre** : le changement d'abonnement part
      // avant la session qui l'a causé. C'est ce que le fournisseur peut faire,
      // et ADR 034 dit pourquoi cela n'a plus d'importance ici.
      events: [
        {
          id: `${SIMULATED_EVENT_ID_PREFIX}sub_${checkout.sessionId}`,
          object: 'event',
          api_version: null,
          created: checkout.createdAt + 1,
          livemode: false,
          pending_webhooks: 0,
          request: { id: null, idempotency_key: null },
          type: 'customer.subscription.created',
          data: { object: subscription },
        },
        {
          id: `${SIMULATED_EVENT_ID_PREFIX}checkout_${checkout.sessionId}`,
          object: 'event',
          api_version: null,
          created: checkout.createdAt,
          livemode: false,
          pending_webhooks: 0,
          request: { id: null, idempotency_key: null },
          type: 'checkout.session.completed',
          data: {
            object: {
              id: checkout.sessionId,
              object: 'checkout.session',
              mode: 'subscription',
              customer: checkout.customerId,
              subscription: checkout.subscriptionId,
              client_reference_id: checkout.reference,
              // Ce que la page hébergée du fournisseur aurait collecté (s24).
              ...(checkout.email === null ? {} : { customer_details: { email: checkout.email } }),
            },
          },
        },
      ],
    }
  },

  /**
   * **`amount_total` reste absent** : le port ne transporte aucun montant, et la
   * simulation n'en invente pas. L'historique affiche donc l'achat sans son
   * prix, ce qui est la vérité de ce qu'on sait ici.
   */
  purchase: (checkout) => ({
    id: `${SIMULATED_EVENT_ID_PREFIX}purchase_${checkout.sessionId}`,
    object: 'event',
    api_version: null,
    created: checkout.createdAt,
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: 'checkout.session.completed',
    data: {
      object: {
        id: checkout.sessionId,
        object: 'checkout.session',
        mode: 'payment',
        payment_status: 'paid',
        customer: checkout.customerId,
        payment_intent: checkout.paymentId,
        client_reference_id: checkout.reference,
        // Ce que la page hébergée du fournisseur aurait collecté. Absent pour
        // un checkout authentifié : nous connaissions déjà l'adresse.
        ...(checkout.email === null ? {} : { customer_details: { email: checkout.email } }),
      },
    },
  }),
}
