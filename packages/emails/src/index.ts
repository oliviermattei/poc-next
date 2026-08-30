/**
 * Templates React Email et leur rendu.
 *
 * Ce package est le seul du couple port/adapters à connaître React : le rendu
 * est **injecté** dans les implémentations de `Mailer`, jamais hérité.
 */
export { EmailTemplateError, createEmailRenderer, qualifyEmailTemplateId } from './render'
export { TransactionalEmail, type TransactionalEmailProps } from './transactional-email'
