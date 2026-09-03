/**
 * Outils de test et de développement du port `Payments`.
 *
 * **Ce ne sont pas des fournisseurs** (ADR 008) : l'unique implémentation
 * livrée est `@repo/adapter-stripe`, et LemonSqueezy, Polar, Creem et Dodo sont
 * au cimetière du PRD. Rien ici ne parle à un service tiers.
 *
 * Deux sources d'événements, jamais mélangées, jamais l'une en repli de
 * l'autre : les formes **simulées** (`createLocalPayments` sans `events`) et
 * les formes **enregistrées** (`createRecordedCheckoutEvents`, ADR 048).
 */
export {
  createLocalPayments,
  LOCAL_CHECKOUT_PATH,
  type LocalPayments,
  type LocalPaymentsOptions,
  type LocalWebhookDelivery,
} from './local-payments'
export {
  RECORDED_EVENT_ID_PREFIX,
  simulatedCheckoutEvents,
  SIMULATED_EVENT_ID_PREFIX,
  type CheckoutEvents,
  type PurchaseCheckout,
  type SubscriptionCheckout,
  type SubscriptionDelivery,
} from './checkout-events'
export {
  applyPlaceholders,
  createRecordedCheckoutEvents,
  GOLDEN_PATH_EVENT_KINDS,
  missingRecordingKinds,
  parseRecording,
  readCapturedEvents,
  readRecordings,
  sanitizeStripeEvent,
  type RecordedEventKind,
  type RecordingStore,
  type StripeRecording,
} from './recorded-events'
