/**
 * L'unique implémentation livrée du port `Payments` (ADR 008).
 *
 * La surface publique est la fabrique, et rien d'autre : le classement des
 * erreurs, le recul et l'assainissement des messages sont des détails de cet
 * adaptateur, éprouvés chez eux. Les exporter inviterait un appelant à s'en
 * servir — et le port cesserait d'être la seule surface appelée par le code
 * métier.
 *
 * Les doublures — enregistrement en CI, mode local en développement — sont des
 * outils de test et vivent dans `@repo/payments-testing`. Elles ne rendent
 * légitime aucun second adaptateur : LemonSqueezy, Polar, Creem et Dodo sont au
 * cimetière du PRD.
 */
export { createStripePayments, type StripePaymentsOptions } from './stripe-payments'
