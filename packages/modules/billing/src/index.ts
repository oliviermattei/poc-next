/**
 * Le module de facturation — **optionnel**, et c'est tout son intérêt.
 *
 * Trois surfaces sortent d'ici, et elles n'ont pas le même public :
 *
 * - le **contrat** (`billingModule`), lu par `config/features.ts` ;
 * - la **règle** (le domaine, le catalogue, le service), appelée par le point
 *   de composition de l'application, qui possède `config/billing.ts` ;
 * - la **présentation**, composée depuis `@repo/ui` — sur un **second point
 *   d'entrée**, `@repo/module-billing/presentation` (ADR 024).
 *
 * Ce second point d'entrée n'est pas une élégance : `config/features.ts` importe
 * le contrat, et ce fichier est lu par `pnpm db:generate` comme par `pnpm ks`,
 * dont les compilateurs ne connaissent pas le JSX.
 */
export { billingModule } from './module'
/**
 * Les tables, réexportées **à plat** : c'est la seule forme que
 * `drizzle-kit generate` sait lire dans le baril généré (`generated/schema/`),
 * qui n'accepte que des exports de premier niveau.
 */
export {
  billingCustomer,
  billingPurchase,
  billingPurchaseSession,
  billingRefundedPayment,
  billingSchema,
  billingSubscription,
  billingWebhookEvent,
} from './schema'
export {
  BILLING_INTERVALS,
  BILLING_MODES,
  BillingConfigError,
  formatOfferPrice,
  offerById,
  offerForPrice,
  parseBillingCatalogue,
  type BillingCatalogue,
  type BillingInterval,
  type BillingMode,
  type BillingOffer,
} from './domain/offer'
export { highlightedOfferId, selectedOfferOf } from './domain/pricing'
export { billableSeats, offerSyncsSeats } from './domain/seats'
export {
  PURCHASE_STATUSES,
  grantsBillingAccess,
  purchaseGrantsAccess,
  entitledOfferIds,
  refundRevokesPurchase,
  type PurchaseSnapshot,
  type PurchaseStatus,
} from './domain/purchase'
export {
  SUBSCRIPTION_STATUSES,
  appliesAfter,
  currentSubscriptionOf,
  displayStateOf,
  grantsAccess,
  trialDaysFor,
  type BillingDisplayState,
  type SubscriptionSnapshot,
  type SubscriptionStatus,
} from './domain/subscription'
export {
  BILLING_KEYS,
  BILLING_MODULE_ID,
  BILLING_REFUSAL_KEYS,
  billingKey,
  offerDescriptionKey,
  offerNameKey,
  stateDescriptionKey,
  stateTitleKey,
} from './domain/message-keys'
export {
  EMPTY_BILLING_VIEW,
  billingScopeReference,
  type BillingUseCases,
  type BillingView,
  type SeatSyncOutcome,
  type OfferView,
  type PurchaseView,
  type SubscriptionView,
} from './application/billing-use-cases'
export type {
  BillingPermission,
  ScopeEmailResolver,
  ScopeResolver,
  ScopeSeats,
  SeatCounter,
} from './application/ports'
export {
  purchaseReadOrder,
  subscriptionReadOrder,
} from './infrastructure/drizzle-billing-repositories'
export {
  BillingNotConfiguredError,
  configureBilling,
  provideBilling,
  requireBillingService,
  resetBillingService,
  type BillingService,
  type ConfigureBillingOptions,
} from './infrastructure/billing-runtime'
export {
  BILLING_SCREEN_PATH,
  PRICING_SCREEN_PATH,
  billingNavigation,
  billingRoutePath,
} from './presentation/billing-routes'
