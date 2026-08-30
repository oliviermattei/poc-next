import { z } from 'zod'

/**
 * Contrat d'environnement de l'application.
 *
 * Le schéma est déclaré littéralement — jamais construit dynamiquement — afin
 * que ses clés restent énumérables : le test d'alignement de `.env.example`
 * en dépend.
 */
/**
 * Expéditeur des emails transactionnels : `adresse` ou `Nom <adresse>`.
 *
 * Vérifié ici plutôt qu'à l'envoi : un expéditeur malformé n'échoue qu'au
 * premier email, c'est-à-dire en production, sur un parcours d'inscription.
 */
const EMAIL_FROM_PATTERN = /^(?:[^\s<>@]+@[^\s<>@]+\.[A-Za-z]{2,}|.+<[^\s<>@]+@[^\s<>@]+\.[A-Za-z]{2,}>)$/

/**
 * Les clés du contrat, déclarées littéralement.
 *
 * Extraites dans une constante — et non écrites en ligne dans `z.object` —
 * pour que `ENV_KEYS` reste énumérable une fois la règle croisée posée sur le
 * schéma : `superRefine` rend un schéma qui n'a plus de `shape`.
 */
const envShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => /^postgres(ql)?:\/\/.+/.test(value), {
      message: 'must be a PostgreSQL connection string (postgres://…)',
    }),
  /**
   * Clé du fournisseur d'emails (Resend), **optionnelle**.
   *
   * `docs/reliability.md` §2 : aucun port ne dépend d'une clé d'API pour
   * fonctionner en développement local. Sans elle, le mailer est la capture
   * locale — le choix se fait sur la **présence de la clé**, jamais sur
   * `NODE_ENV`.
   */
  RESEND_API_KEY: z.string().min(1).optional(),
  /** Expéditeur. Obligatoire dès qu'une clé est configurée : voir la règle croisée. */
  EMAIL_FROM: z
    .string()
    .min(1)
    .refine((value) => EMAIL_FROM_PATTERN.test(value), {
      message: 'must be an email address, optionally named (Name <user@example.com>)',
    })
    .optional(),
} as const

export const envSchema = z.object(envShape).superRefine((value, ctx) => {
  // Règle croisée : une clé sans expéditeur part avec un `from` vide, et
  // l'échec n'apparaît qu'au premier email refusé par le fournisseur.
  if (value.RESEND_API_KEY !== undefined && value.EMAIL_FROM === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['EMAIL_FROM'],
      message: 'is required when RESEND_API_KEY is set',
    })
  }
})

export type Env = z.infer<typeof envSchema>

export type EnvSource = Record<string, string | undefined>

/** Clés lues par l'application, dans l'ordre de déclaration du schéma. */
export const ENV_KEYS = Object.keys(envShape) as (keyof Env)[]

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
 * Variables qui désactivent la validation, et la valeur qui les déclenche.
 *
 * Elles ne sont pas dans le schéma : elles ne sont pas posées par le
 * développeur mais par l'outillage (`NEXT_PHASE` par `next build`) ou à la main
 * pour un build hors ligne (`SKIP_ENV_VALIDATION`). Elles sont malgré tout lues
 * par ce module, donc énumérées ici et documentées dans `.env.example`.
 */
const BUILD_PHASE_TRIGGERS = {
  NEXT_PHASE: 'phase-production-build',
  SKIP_ENV_VALIDATION: '1',
} as const

/** Clés lues par la garde de build, dérivées des déclencheurs ci-dessus. */
export const BUILD_ENV_KEYS = Object.keys(BUILD_PHASE_TRIGGERS) as (keyof typeof BUILD_PHASE_TRIGGERS)[]

/**
 * Le build de Next s'exécute sans les secrets d'exécution : y valider
 * l'environnement ferait échouer `next build` en CI comme en conteneur.
 */
export function isBuildPhase(source: EnvSource): boolean {
  return BUILD_ENV_KEYS.some((key) => source[key] === BUILD_PHASE_TRIGGERS[key])
}

/**
 * Phase que Next transmet à `next.config.ts` pendant `next build`. Elle arrive
 * en argument, alors que `NEXT_PHASE` n'est posée dans l'environnement que plus
 * tard dans le build : à la lecture de la configuration, l'argument est le seul
 * signal disponible.
 */
export const NEXT_BUILD_PHASE = BUILD_PHASE_TRIGGERS.NEXT_PHASE

export interface AssertStartupEnvOptions {
  /** Phase transmise par Next. Absente hors de `next.config.ts`. */
  readonly phase?: string
  readonly source?: EnvSource
}

/**
 * Validation au démarrage du serveur : lève une `EnvValidationError` nommant
 * chaque variable fautive, avant que le processus ne serve la moindre requête.
 *
 * Une base éteinte n'est pas une erreur de configuration : seule la forme des
 * variables est jugée ici. Un `DATABASE_URL` bien formé mais injoignable laisse
 * le serveur démarrer, et `/api/health` répond 503.
 *
 * Le build est exempté : `next build` s'exécute sans les variables d'exécution,
 * en CI comme en conteneur.
 *
 * Deux frontières connues, mesurées en revue de s01 (N15, N16) :
 * - la garde ne couvre que le **démarrage auto-hébergé**. En serverless (Vercel)
 *   comme en `output: 'standalone'`, `next.config.ts` n'est pas exécuté à la
 *   requête : une variable malformée s'y déploie sans bruit et dégrade en 503
 *   silencieux. La sonde `/api/health` reste alors le seul signal ;
 * - `next info` charge la configuration avec sa propre phase, non exemptée : la
 *   commande de diagnostic s'interrompt précisément quand l'environnement est
 *   cassé. Contournement : `SKIP_ENV_VALIDATION=1 next info`.
 */
export function assertStartupEnv(options: AssertStartupEnvOptions = {}): void {
  if (options.phase === NEXT_BUILD_PHASE) {
    return
  }

  getEnv(options.source ?? process.env)
}

/**
 * Point d'accès unique à l'environnement. Aucun autre module du dépôt ne lit
 * `process.env` directement.
 *
 * En phase de build, l'environnement est renvoyé tel quel, sans validation :
 * les variables d'exécution peuvent alors manquer. Ce qui les consomme doit
 * donc refuser explicitement une valeur absente plutôt que se rabattre sur un
 * défaut — c'est ce que fait `createDatabaseClient`.
 */
export function getEnv(source: EnvSource = process.env): Env {
  if (source.SKIP_ENV_VALIDATION === BUILD_PHASE_TRIGGERS.SKIP_ENV_VALIDATION) {
    console.warn(
      'SKIP_ENV_VALIDATION=1 : validation de l’environnement désactivée. ' +
        'Les variables ne sont ni vérifiées ni complétées — réservé au build.',
    )

    return source as unknown as Env
  }

  if (isBuildPhase(source)) {
    return source as unknown as Env
  }

  return parseEnv(source)
}
