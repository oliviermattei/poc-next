/**
 * L'unique implémentation livrée du port `Mailer` (ADR 008).
 *
 * La surface publique est la fabrique, et rien d'autre : le classement des
 * erreurs, le recul et l'assainissement des messages sont des détails de cet
 * adapter, éprouvés chez eux. Les exporter inviterait un appelant à s'en servir
 * — et le port cesserait d'être la seule surface appelée par le code métier.
 *
 * Les doublures — enregistrement en CI, capture locale en développement — sont
 * des outils de test et vivent dans `@repo/mailer-testing`. Elles ne rendent
 * légitime aucun second adapter.
 */
export { createResendMailer, type ResendMailerOptions } from './resend-mailer'
