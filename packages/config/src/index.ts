/**
 * Barril principal : uniquement du code sans dépendance à Node, donc importable
 * depuis un composant client. Le chargement du `.env` vit dans
 * `@repo/config/server`.
 */
export {
  BUILD_ENV_KEYS,
  EMAIL_LOCAL_CAPTURE_ENABLED,
  ENV_KEYS,
  EnvValidationError,
  I18N_MISSING_KEY_PROBE_ENABLED,
  NEXT_BUILD_PHASE,
  OAUTH_LOCAL_PROVIDER_ENABLED,
  assertStartupEnv,
  envSchema,
  getEnv,
  isBuildPhase,
  parseEnv,
  type AssertStartupEnvOptions,
  type Env,
  type EnvSource,
} from './env'
