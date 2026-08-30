import { z } from 'zod'

/**
 * Contrat d'environnement de l'application.
 *
 * Le schéma est déclaré littéralement — jamais construit dynamiquement — afin
 * que ses clés restent énumérables : le test d'alignement de `.env.example`
 * en dépend.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => /^postgres(ql)?:\/\/.+/.test(value), {
      message: 'must be a PostgreSQL connection string (postgres://…)',
    }),
})

export type Env = z.infer<typeof envSchema>

export type EnvSource = Record<string, string | undefined>

/** Clés lues par l'application, dans l'ordre de déclaration du schéma. */
export const ENV_KEYS = Object.keys(envSchema.shape) as (keyof Env)[]

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvValidationError'
  }
}

/**
 * Valide une source d'environnement. Lève une `EnvValidationError` dont le
 * message nomme chaque variable fautive.
 */
export function parseEnv(source: EnvSource): Env {
  const result = envSchema.safeParse(source)

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')

    throw new EnvValidationError(`Invalid environment variables:\n${details}`)
  }

  return result.data
}

/**
 * Le build de Next s'exécute sans les secrets d'exécution : y valider
 * l'environnement ferait échouer `next build` en CI comme en conteneur.
 */
export function isBuildPhase(source: EnvSource): boolean {
  return source.NEXT_PHASE === 'phase-production-build' || source.SKIP_ENV_VALIDATION === '1'
}

/**
 * Point d'accès unique à l'environnement. Aucun autre module du dépôt ne lit
 * `process.env` directement.
 */
export function getEnv(source: EnvSource = process.env): Env {
  if (isBuildPhase(source)) {
    return source as unknown as Env
  }

  return parseEnv(source)
}
