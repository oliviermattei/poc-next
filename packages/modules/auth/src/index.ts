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
export { AuthNotConfiguredError, type AuthService } from './application/auth-service'
export { defaultAuthPolicy, type AuthPolicy } from './domain/auth-policy'
export {
  LOCAL_OAUTH_PROVIDER_ID,
  OAUTH_PROVIDERS,
  OAUTH_RETURN_SCREEN,
  oauthFailureClass,
  readOAuthFailureClass,
  type AnyOAuthProviderId,
  type OAuthFailureClass,
} from './domain/oauth'
export { safeRedirectPath } from './domain/redirect'
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
  type AccountView,
  type AuthUseCases,
  type DescribedSignInMethod,
} from './application/auth-use-cases'
export type { DescribedSession } from './domain/session'
export { createTokenFactory } from './infrastructure/token-factory'
export { describeSecurityEvent, type SecurityEventRecord } from './domain/security-event'
export { tokenIdentifier, type TokenPurpose } from './domain/one-time-token'
