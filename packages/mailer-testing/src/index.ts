/**
 * Outils de test et de développement du port `Mailer`.
 *
 * **Ce ne sont pas des fournisseurs** (ADR 008). Le seul fournisseur livré est
 * Resend, dans `@repo/adapter-resend`. Ce que ce package contient ne rend
 * légitime aucun adapter SMTP, SendGrid ou Nodemailer : ils sont au cimetière
 * du PRD.
 */
export { createLocalCaptureMailer, type LocalCaptureMailerOptions } from './local-capture-mailer'
export { createRecordingMailer, type RecordingMailer } from './recording-mailer'
