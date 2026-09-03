import { describe, expect, it } from 'vitest'

import { createLocalPayments, LOCAL_CHECKOUT_PATH } from './local-payments'

/**
 * Le mode local — **un outil, pas un fournisseur** (ADR 008).
 *
 * Ce qui est éprouvé ici : qu'il produise une URL locale, qu'il fabrique des
 * événements que la **vraie** vérification de signature accepte, qu'il les
 * livre dans le désordre, et qu'il ne lève jamais.
 */

const options = () =>
  createLocalPayments({
    appUrl: 'https://app.test',
    webhookSecret: 'whsec_local',
    now: () => new Date('2026-09-01T10:00:00.000Z'),
  })

const CHECKOUT = {
  priceId: 'price_pro_monthly',
  mode: 'subscription',
  quantity: 2,
  customerId: null,
  customerEmail: 'client@example.test',
  reference: 'organization:org_1',
  successUrl: 'https://app.test/billing?checkout=success',
  cancelUrl: 'https://app.test/billing?checkout=cancelled',
  trialPeriodDays: 14,
  locale: 'fr',
  idempotencyKey: 'idem-local',
} as const

describe('le checkout local', () => {
  it('rend une URL servie par l’application, jamais par un tiers', async () => {
    const payments = options()

    const result = await payments.createCheckout(CHECKOUT)

    expect(result.ok).toBe(true)
    expect(result.ok && result.checkout.url).toContain(`https://app.test${LOCAL_CHECKOUT_PATH}`)
    expect(result.ok && result.checkout.customerId).toMatch(/^cus_local_/)
  })

  it('rend le même client pour le même périmètre : un rejeu ne fabrique pas un second', async () => {
    const payments = options()

    const first = await payments.createCheckout(CHECKOUT)
    const second = await payments.createCheckout(CHECKOUT)

    expect(first.ok && first.checkout.customerId).toBe(second.ok && second.checkout.customerId)
  })

  it('respecte le client déjà connu de l’appelant', async () => {
    const payments = options()

    const result = await payments.createCheckout({ ...CHECKOUT, customerId: 'cus_local_deja' })

    expect(result.ok && result.checkout.customerId).toBe('cus_local_deja')
  })
})

describe('les événements de la simulation', () => {
  it('sont signés de telle sorte que la vraie vérification les accepte', async () => {
    const payments = options()
    const opened = await payments.createCheckout(CHECKOUT)
    const sessionId = new URL(opened.ok ? opened.checkout.url : '').searchParams.get('session') ?? ''

    const deliveries = payments.completeCheckout(sessionId, CHECKOUT.reference)

    expect(deliveries.length).toBeGreaterThan(1)

    for (const delivery of deliveries) {
      const verified = await payments.verifyWebhook(delivery)

      expect(verified.ok, JSON.stringify(verified)).toBe(true)
    }
  })

  /**
   * **Le désordre est délibéré** (ADR 034) : le changement d'abonnement est
   * livré **avant** la session de checkout qui l'a causé, exactement comme le
   * fournisseur peut le faire. Le rattachement ayant lieu à l'ouverture du
   * checkout, l'ordre n'a plus d'importance — et la simulation le prouve au
   * navigateur plutôt que de l'affirmer.
   */
  it('livre le changement d’abonnement avant la session de checkout', async () => {
    const payments = options()
    const opened = await payments.createCheckout(CHECKOUT)
    const sessionId = new URL(opened.ok ? opened.checkout.url : '').searchParams.get('session') ?? ''

    const kinds: string[] = []

    for (const delivery of payments.completeCheckout(sessionId, CHECKOUT.reference)) {
      const verified = await payments.verifyWebhook(delivery)

      kinds.push(verified.ok ? verified.event.kind : 'refusé')
    }

    expect(kinds).toEqual(['subscription_changed', 'checkout_completed'])
  })

  it('ouvre une période d’essai quand l’offre en déclare une', async () => {
    const payments = options()
    const opened = await payments.createCheckout(CHECKOUT)
    const sessionId = new URL(opened.ok ? opened.checkout.url : '').searchParams.get('session') ?? ''

    const verified = await payments.verifyWebhook(payments.completeCheckout(sessionId, CHECKOUT.reference)[0]!)

    expect(verified.ok && verified.event.kind === 'subscription_changed' && verified.event.subscription).toMatchObject(
      {
        status: 'trialing',
        quantity: 2,
        priceId: 'price_pro_monthly',
        cancelAtPeriodEnd: false,
      },
    )
  })

  it('ouvre un abonnement actif quand l’offre n’a pas d’essai', async () => {
    const payments = options()
    const opened = await payments.createCheckout({ ...CHECKOUT, trialPeriodDays: null })
    const sessionId = new URL(opened.ok ? opened.checkout.url : '').searchParams.get('session') ?? ''

    const verified = await payments.verifyWebhook(payments.completeCheckout(sessionId, CHECKOUT.reference)[0]!)

    expect(verified.ok && verified.event.kind === 'subscription_changed' && verified.event.subscription.status).toBe(
      'active',
    )
  })

  it('ne livre rien pour une session inconnue, au lieu de lever', () => {
    expect(options().completeCheckout('cs_local_inexistante', 'organization:org_1')).toEqual([])
  })

  /**
   * **Une session appartient au périmètre qui l'a ouverte.**
   *
   * Les identifiants de session locale sont **déterministes** — dérivés du
   * périmètre et du prix —, donc devinables. Sans cette garde, un visiteur
   * pouvait terminer le checkout ouvert par quelqu'un d'autre, et lui accorder
   * un abonnement (constat F7 de la revue). Le refus est ici, dans le
   * simulateur, et non seulement dans la route : c'est la seule place où il
   * vaut pour tout appelant.
   */
  it('ne termine pas le checkout ouvert par un autre périmètre', async () => {
    const payments = options()
    const opened = await payments.createCheckout(CHECKOUT)
    const sessionId = new URL(opened.ok ? opened.checkout.url : '').searchParams.get('session') ?? ''

    expect(payments.completeCheckout(sessionId, 'user:quelqu-un-d-autre')).toEqual([])
    // Et le périmètre qui l'a ouverte, lui, est servi.
    expect(payments.completeCheckout(sessionId, CHECKOUT.reference)).toHaveLength(2)
  })

  /**
   * **L'horodatage de signature n'est pas celui de l'événement**, et la
   * distinction a coûté cinq rouges.
   *
   * `created` est une donnée du **domaine** : c'est lui qui ordonne deux
   * événements (ADR 034), et une simulation reproductible doit pouvoir le
   * fixer. L'horodatage porté par l'en-tête de signature est une donnée de
   * **transport** : le fournisseur s'en sert pour refuser un rejeu hors de sa
   * fenêtre de tolérance, qui est de 300 secondes.
   *
   * Les confondre rendait la simulation vérifiable le jour où l'horloge
   * injectée était écrite, et invérifiable le lendemain — une bombe à
   * retardement que la suite a déclenchée d'elle-même, un jour après. La
   * signature suit donc l'horloge réelle, quoi que l'horloge injectée dise.
   */
  it('reste vérifiable même quand l’horloge injectée est loin dans le passé', async () => {
    const payments = createLocalPayments({
      appUrl: 'https://app.test',
      webhookSecret: 'whsec_local',
      now: () => new Date('2020-01-01T00:00:00.000Z'),
    })
    const opened = await payments.createCheckout(CHECKOUT)
    const sessionId = new URL(opened.ok ? opened.checkout.url : '').searchParams.get('session') ?? ''

    const verified = await payments.verifyWebhook(payments.completeCheckout(sessionId, CHECKOUT.reference)[0]!)

    expect(verified.ok, JSON.stringify(verified)).toBe(true)
    // Et l'événement garde bien la date **du domaine**, celle de l'horloge
    // injectée : c'est elle qui ordonne.
    expect(verified.ok && verified.event.occurredAt.getUTCFullYear()).toBe(2020)
  })
})

describe('le reste du port en mode local', () => {
  it('rend une URL de portail qui ramène dans l’application', async () => {
    const result = await options().createPortalSession({
      customerId: 'cus_local_1',
      returnUrl: 'https://app.test/billing',
    })

    expect(result.ok && result.session.url).toBe('https://app.test/billing?portal=local')
  })

  it('rend les abonnements simulés du client, pour la réconciliation', async () => {
    const payments = options()
    const opened = await payments.createCheckout(CHECKOUT)
    const sessionId = new URL(opened.ok ? opened.checkout.url : '').searchParams.get('session') ?? ''

    payments.completeCheckout(sessionId, CHECKOUT.reference)

    const listed = await payments.listSubscriptions({
      customerId: opened.ok ? opened.checkout.customerId : '',
    })

    expect(listed.ok && listed.subscriptions).toHaveLength(1)
  })

  it('rend une liste vide pour un client inconnu, sans lever', async () => {
    const listed = await options().listSubscriptions({ customerId: 'cus_local_inconnu' })

    expect(listed).toEqual({ ok: true, subscriptions: [] })
  })

  /* ---------------------------------------------------------------------- *
   * s20 — le paiement unique simulé.
   * ---------------------------------------------------------------------- */

  const PURCHASE = { ...CHECKOUT, mode: 'payment', trialPeriodDays: null, quantity: 1 } as const

  const openPurchase = async (payments: ReturnType<typeof options>) => {
    const opened = await payments.createCheckout(PURCHASE)

    return opened.ok ? opened.checkout : null
  }

  it('livre un **seul** événement pour un achat unique, encaissé et en mode paiement', async () => {
    const payments = options()
    const checkout = await openPurchase(payments)
    const deliveries = payments.completeCheckout(checkout?.sessionId ?? '', PURCHASE.reference)

    // Un seul : il n'y a pas de second objet à décrire — pas d'abonnement,
    // donc pas de désordre à simuler.
    expect(deliveries).toHaveLength(1)

    // La vraie vérification, et la vraie normalisation : ce que ce parcours
    // exerce est le code qui traitera les charges utiles du fournisseur.
    const verified = await payments.verifyWebhook(deliveries[0]!)

    expect(verified.ok && verified.event).toMatchObject({
      kind: 'purchase_paid',
      sessionId: checkout?.sessionId,
      reference: 'organization:org_1',
    })
    expect(verified.ok && verified.event.kind === 'purchase_paid' && verified.event.paymentId).toMatch(
      /^pi_local_/,
    )
  })

  it('rend l’identifiant de session du checkout ouvert : c’est l’acte d’achat', async () => {
    const payments = options()
    const checkout = await openPurchase(payments)

    expect(checkout?.sessionId).toBe(
      new URL(checkout?.url ?? '').searchParams.get('session'),
    )
  })

  it('rend les achats terminés du client, pour la réconciliation', async () => {
    const payments = options()
    const checkout = await openPurchase(payments)

    payments.completeCheckout(checkout?.sessionId ?? '', PURCHASE.reference)

    const listed = await payments.listPurchases({ customerId: checkout?.customerId ?? '' })

    expect(listed.ok && listed.purchases).toHaveLength(1)
    // **Aucun montant** : le port ne transporte pas de prix, et la simulation
    // n'en invente pas.
    expect(listed.ok && listed.purchases[0]).toMatchObject({ paid: true, amountTotal: null })
  })

  it('ne rend aucun achat pour un client qui n’en a pas', async () => {
    const listed = await options().listPurchases({ customerId: 'cus_local_inconnu' })

    expect(listed).toEqual({ ok: true, purchases: [] })
  })

  it('refuse une signature forgée, comme le vrai fournisseur', async () => {
    const payments = options()
    const opened = await payments.createCheckout(CHECKOUT)
    const sessionId = new URL(opened.ok ? opened.checkout.url : '').searchParams.get('session') ?? ''
    const delivery = payments.completeCheckout(sessionId, CHECKOUT.reference)[0]!

    const verified = await payments.verifyWebhook({ ...delivery, signature: 't=1,v1=forgee' })

    expect(verified.ok).toBe(false)
    expect(!verified.ok && verified.error.code).toBe('invalid_signature')
  })
})

describe('la quantité d’un abonnement, en mode local', () => {
  /** Ouvre le checkout, le termine, et rend l'abonnement simulé. */
  const anOpenSubscription = async (payments: ReturnType<typeof options>) => {
    const opened = await payments.createCheckout({ ...CHECKOUT, trialPeriodDays: null })
    const sessionId = new URL(opened.ok ? opened.checkout.url : '').searchParams.get('session') ?? ''

    payments.completeCheckout(sessionId, CHECKOUT.reference)

    const listed = await payments.listSubscriptions({
      customerId: opened.ok ? opened.checkout.customerId : '',
    })

    return { payments, subscription: listed.ok ? listed.subscriptions[0] : undefined }
  }

  it('mémorise la quantité visée, sans le moindre appel sortant', async () => {
    // La simulation est construite avec un `fetch` qui lève : si cette écriture
    // touchait le réseau, le cas ne serait pas seulement rouge, il serait
    // bruyant.
    const { payments, subscription } = await anOpenSubscription(options())

    const written = await payments.updateSubscriptionQuantity({
      subscriptionId: subscription?.id ?? '',
      quantity: 5,
      idempotencyKey: 'seats:organization:org_1:5',
    })

    expect(written.ok && written.subscription.quantity).toBe(5)

    const relu = await payments.listSubscriptions({ customerId: subscription?.customerId ?? '' })

    expect(relu.ok && relu.subscriptions[0]?.quantity).toBe(5)
  })

  it('converge au rejeu au lieu de compter deux fois', async () => {
    const { payments, subscription } = await anOpenSubscription(options())
    const target = {
      subscriptionId: subscription?.id ?? '',
      quantity: 3,
      idempotencyKey: 'seats:organization:org_1:3',
    }

    await payments.updateSubscriptionQuantity(target)
    await payments.updateSubscriptionQuantity(target)

    const relu = await payments.listSubscriptions({ customerId: subscription?.customerId ?? '' })

    expect(relu.ok && relu.subscriptions[0]?.quantity).toBe(3)
  })

  it('rend un échec pour un abonnement inconnu, au lieu de lever', async () => {
    const written = await options().updateSubscriptionQuantity({
      subscriptionId: 'sub_local_inconnu',
      quantity: 2,
      idempotencyKey: 'seats:inconnu:2',
    })

    expect(!written.ok && written.error.code).toBe('not_found')
  })
})
