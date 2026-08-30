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
  NEXT_BUILD_PHASE,
  assertStartupEnv,
  envSchema,
  getEnv,
  isBuildPhase,
  parseEnv,
  type AssertStartupEnvOptions,
  type Env,
  type EnvSource,
} from './env'
