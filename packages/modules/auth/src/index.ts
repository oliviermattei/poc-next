/**
 * Le module d'authentification — socle **non désactivable** du produit.
 *
 * Deux surfaces sortent d'ici, et elles n'ont pas le même public :
 *
 * - le **contrat** (`authModule`) et les **tables**, lus par
 *   `config/features.ts` et par le baril de schéma de s04 ;
 * - la **configuration** (`configureAuth`), appelée par le seul point de
 *   composition de l'application, qui possède la connexion à la base et le
 *   mailer.
 */
export { authModule } from './module'
export {
  authSchema,
  authAccount,
  authDataExportRequest,
  authPasskey,
  authSession,
  authTwoFactor,
  authUser,
  authVerification,
} from './schema'
export { configureAuth, requireAuthService, resetAuthService } from './infrastructure/auth-runtime'
export {
  AUTH_MODELS,
  createBetterAuthService,
  type ConfigureAuthOptions,
} from './infrastructure/better-auth-service'
export {
  createDrizzleVerificationTokenRepository,
  type AuthDatabase,
} from './infrastructure/drizzle-auth-repositories'
export {
  createDrizzleDataExportRepository,
  type DataExportDatabase,
} from './infrastructure/drizzle-data-export-repository'
export { AuthNotConfiguredError, type AuthService } from './application/auth-service'
export { defaultAuthPolicy, type AuthPolicy } from './domain/auth-policy'
export {
  LOCAL_OAUTH_PROVIDER_ID,
  LOCAL_OAUTH_SLOT_PARAM,
  OAUTH_PROVIDERS,
  OAUTH_RETURN_SCREEN,
  oauthFailureClass,
  readOAuthFailureClass,
  type AnyOAuthProviderId,
  type OAuthFailureClass,
} from './domain/oauth'
export { safeRedirectPath } from './domain/redirect'
// s34 : l'identifiant de la tâche de purge et le champ de sa charge utile. Le
// point de composition en a besoin pour n'écrire aucun de ces noms deux fois.
export {
  ACCOUNT_PURGE_JOB,
  ACCOUNT_PURGE_JOB_FIELD,
  ACCOUNT_PURGE_JOB_LOCALE,
  confirmsAccount,
} from './domain/account-deletion'
// s35 : l'export de ses données. Ce qui sort d'ici est ce que l'application ou
// la suite doivent connaître — le schéma exécutable de l'archive, la durée de
// vie du lien, le chemin public de téléchargement — jamais la primitive de
// signature, qui reste dans `infrastructure/`.
export {
  DATA_EXPORT_DOWNLOAD_PATH,
  DATA_EXPORT_EMAIL_TEMPLATE,
  DATA_EXPORT_JOB,
  DATA_EXPORT_JOB_FIELD,
  DATA_EXPORT_LINK_TTL_SECONDS,
  DATA_EXPORT_SWEEP_MIN_AGE_SECONDS,
  DATA_EXPORT_SWEEP_PERIOD_MINUTES,
  DATA_EXPORT_SWEEP_SCHEDULE,
  dataExportArchiveSchema,
  dataExportExpiryFrom,
  decideDataExportDownload,
  parseDataExportToken,
  type DataExportArchiveDocument,
} from './domain/data-export'
export { createDataExportTokenSigner } from './infrastructure/data-export-signer'
export type {
  DataExportDependencies,
  DataExportRepository,
  DataExportTokenSigner,
  DataExportTrace,
  StoredDataExportRequest,
} from './application/ports'
export type {
  DataExportDownloadOutcome,
  DataExportUseCases,
  RequestDataExportOutcome,
} from './application/data-export-use-cases'
// s37a : l'état « banni » appartient au socle (ADR 058). La borne du motif sort
// d'ici parce qu'elle vit avec la colonne qui le porte — le module
// d'administration la lit, il n'en écrit pas une seconde.
export { BAN_REASON_MAX_LENGTH, parseBanReason, type ParsedBanReason } from './domain/ban'
export {
  TWO_FACTOR_CHALLENGE_COOKIES,
  TWO_FACTOR_CHALLENGE_COOKIE_NAME,
  type TwoFactorFailureClass,
} from './domain/two-factor'
export {
  PASSKEY_NAME_MAX_LENGTH,
  type DescribedPasskey,
  type PasskeyFailureClass,
} from './domain/passkey'
export { authRoutePath } from './presentation/auth-routes'
export {
  AUTH_EMAIL_TEMPLATES,
  type AccountDeletionOutcome,
  type AccountView,
  type AuthUseCases,
  type DescribedSignInMethod,
} from './application/auth-use-cases'
export type { DescribedSession } from './domain/session'
export { createTokenFactory } from './infrastructure/token-factory'
export { describeSecurityEvent, type SecurityEventRecord } from './domain/security-event'
export { tokenIdentifier, type TokenPurpose } from './domain/one-time-token'
