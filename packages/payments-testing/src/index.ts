/**
 * Outils de test et de développement du port `Payments`.
 *
 * **Ce ne sont pas des fournisseurs** (ADR 008) : l'unique implémentation
 * livrée est `@repo/adapter-stripe`, et LemonSqueezy, Polar, Creem et Dodo sont
 * au cimetière du PRD. Rien ici ne parle à un service tiers.
 */
export {
  createLocalPayments,
  LOCAL_CHECKOUT_PATH,
  type LocalPayments,
  type LocalPaymentsOptions,
  type LocalWebhookDelivery,
} from './local-payments'
