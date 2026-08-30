/**
 * Interfaces des dépendances externes (`docs/architecture.md`).
 *
 * Un fichier par capacité. `mailer` est le premier ; storage, paiement, jobs,
 * analytique et monitoring suivront le même gabarit.
 */
export type {
  EmailData,
  EmailRenderer,
  Mailer,
  MailerError,
  MailerErrorCode,
  MailerLogRecord,
  MailerLogger,
  RenderedEmail,
  SendEmailInput,
  SendEmailResult,
} from './mailer'
