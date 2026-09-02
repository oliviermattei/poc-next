import { describe, expect, it } from 'vitest'

import { createStripePayments } from './stripe-payments'

/**
 * **Le second régime : appels réels contre les clés de test Stripe, hors CI,
 * sur commande explicite.**
 *
 * `docs/architecture.md` impose deux régimes d'intégration tierce et interdit de
 * les mélanger. `stripe-payments.test.ts` est le premier : bloquant en CI, il
 * double le réseau et ne parle à personne. Celui-ci est le second : il ouvre une
 * vraie session de checkout sur un compte de test, et il ne s'exécute **jamais**
 * sans qu'on le demande.
 *
 * C'est le neuvième critère de la story : « hors CI, sur commande explicite,
 * par un test contre les clés de test Stripe ».
 *
 * ```sh
 * STRIPE_LIVE_TEST=1 \
 * STRIPE_SECRET_KEY=sk_test_… \
 * STRIPE_LIVE_PRICE_ID=price_… \
 *   pnpm vitest run packages/adapters/stripe/src/stripe-live.test.ts
 * ```
 *
 * Les variables sont lues ici, et ici seulement, directement dans
 * `process.env` : ce fichier est du harnais, pas du code applicatif, et
 * `STRIPE_LIVE_PRICE_ID` n'existe que pour cette recette.
 *
 * **Aucun paiement n'est encaissé** : ouvrir une session de checkout ne débite
 * rien, et la session expire seule. Le portail client n'est pas exercé ici — il
 * exige une configuration de portail sur le compte, donc un état que la recette
 * ne peut pas poser sans effet durable.
 */

const live = process.env.STRIPE_LIVE_TEST === '1'
const apiKey = process.env.STRIPE_SECRET_KEY ?? ''
const priceId = process.env.STRIPE_LIVE_PRICE_ID ?? ''

describe.runIf(live)('appel réel contre les clés de test Stripe', () => {
  it('exige les deux variables de la recette', () => {
    // Sans ce cas, une variable oubliée ferait échouer l'appel sur un message du
    // fournisseur, et on croirait à une panne de Stripe.
    expect(
      [apiKey, priceId].every((value) => value !== ''),
      'STRIPE_SECRET_KEY et STRIPE_LIVE_PRICE_ID sont requises pour cette recette.',
    ).toBe(true)
  })

  it('refuse une clé de production : cette recette ne touche que le mode test', () => {
    expect(apiKey.startsWith('sk_test_'), 'la clé doit être une clé de test (sk_test_…)').toBe(true)
  })

  it('ouvre une vraie session de checkout et rend son URL', { timeout: 30_000 }, async () => {
    const payments = createStripePayments({
      apiKey,
      webhookSecret: 'whsec_unused_in_this_recipe',
      fetch: globalThis.fetch,
      timeoutMs: 20_000,
      maxAttempts: 2,
      backoff: { baseMs: 500, maxMs: 4_000, random: Math.random },
      sleep: async (ms) => {
        await new Promise((resolve) => setTimeout(resolve, ms))
      },
    })

    const result = await payments.createCheckout({
      priceId,
      mode: 'subscription',
      quantity: 1,
      customerId: null,
      customerEmail: 'recette@example.test',
      reference: `recette:${Date.now()}`,
      successUrl: 'https://example.test/billing?checkout=success',
      cancelUrl: 'https://example.test/billing?checkout=cancelled',
      trialPeriodDays: null,
      locale: 'fr',
      idempotencyKey: `recette-${Date.now()}`,
    })

    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect(result.ok && result.checkout.url).toMatch(/^https:\/\/checkout\.stripe\.com\//)
    expect(result.ok && result.checkout.customerId).toMatch(/^cus_/)
  })

  it('rend un échec typé, sans lever, sur un prix inexistant', { timeout: 30_000 }, async () => {
    const payments = createStripePayments({
      apiKey,
      webhookSecret: 'whsec_unused_in_this_recipe',
      fetch: globalThis.fetch,
      timeoutMs: 20_000,
      maxAttempts: 1,
      backoff: { baseMs: 500, maxMs: 4_000, random: Math.random },
      sleep: async () => {},
    })

    const result = await payments.createCheckout({
      priceId: 'price_inexistant_recette',
      mode: 'subscription',
      quantity: 1,
      customerId: null,
      customerEmail: null,
      reference: `recette:${Date.now()}`,
      successUrl: 'https://example.test/billing?checkout=success',
      cancelUrl: 'https://example.test/billing?checkout=cancelled',
      trialPeriodDays: null,
      locale: null,
      idempotencyKey: `recette-erreur-${Date.now()}`,
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('invalid_request')
    // Le message reste assaini, même quand il vient du vrai fournisseur.
    expect(!result.ok && result.error.message).not.toContain(apiKey)
  })
})
