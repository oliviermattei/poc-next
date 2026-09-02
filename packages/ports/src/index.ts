/**
 * Interfaces des dépendances externes (`docs/architecture.md`).
 *
 * Un fichier par capacité. `mailer` est le premier (s06), `storage` le deuxième
 * (s18) et le premier héritier de son gabarit ; paiement, jobs, analytique et
 * monitoring suivront le même.
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

export type {
  PresignUploadInput,
  PresignUploadResult,
  PresignedUpload,
  ReadObjectResult,
  RemoveObjectResult,
  Storage,
  StorageError,
  StorageErrorCode,
  StorageLogRecord,
  StorageLogger,
  StoredObject,
  WriteObjectInput,
  WriteObjectResult,
} from './storage'
