import { JOBS_LOCAL_RUNNER_ENABLED, type Env } from '@repo/config'

/**
 * **La règle qui décide de l'exécuteur de tâches**, isolée de ce qui le
 * construit — même forme que `lib/mailer-config.ts`, `lib/billing-config.ts` et
 * `lib/oauth-config.ts`, et pour la même raison : `apps/web/lib/startup.ts` la
 * réapplique au **démarrage**, sans charger le SDK ni la base pour poser une
 * question à trois variables.
 *
 * Trois états, et il faut en choisir un :
 *
 * | Configuration | Ce qui se passe |
 * |---|---|
 * | `INNGEST_EVENT_KEY` **et** `INNGEST_SIGNING_KEY` | le fournisseur |
 * | `JOBS_LOCAL_RUNNER=1`, aucune clé | l'exécuteur en mémoire, sans service |
 * | rien | l'application **refuse de démarrer**, en nommant les trois variables |
 *
 * Le troisième état est le point : `docs/reliability.md` §2 interdit le repli
 * silencieux. Un déploiement sans clé qui basculerait tout seul en mémoire
 * exécuterait deux fois chaque échéance dès la seconde instance, et perdrait sa
 * file à chaque redémarrage — sans que rien ne le dise.
 *
 * **Cette règle n'est appliquée que si le module `jobs` est activé.** Coupé,
 * l'émission s'exécute de façon synchrone dans la requête appelante, et il n'y a
 * aucune variable à renseigner (critère 8 de s33).
 */

export type JobsConfig =
  | {
      readonly kind: 'provider'
      readonly eventKey: string
      readonly signingKey: string
      readonly baseUrl: string | null
    }
  | { readonly kind: 'local' }

/** L'identifiant de l'application chez le fournisseur. Du code, pas une variable. */
export const JOBS_APP_ID = 'killer-saas'

/** Une variable déclarée vide vaut absente, ici comme dans `parseEnv`. */
const declared = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()

  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/**
 * Rend la configuration des tâches, ou lève en nommant les variables.
 *
 * La règle est réappliquée ici et pas seulement dans le schéma parce que
 * `getEnv` ne valide rien en phase de build ni sous `SKIP_ENV_VALIDATION` : sur
 * ces chemins, l'`INNGEST_EVENT_KEY=` vide que livre `.env.example` se lirait
 * « clé renseignée » (revue de s06, G2).
 */
export function resolveJobsConfig(env: Env): JobsConfig {
  const eventKey = declared(env.INNGEST_EVENT_KEY)
  const signingKey = declared(env.INNGEST_SIGNING_KEY)

  if (eventKey !== undefined && signingKey !== undefined) {
    return {
      kind: 'provider',
      eventKey,
      signingKey,
      baseUrl: declared(env.INNGEST_BASE_URL) ?? null,
    }
  }

  if (declared(env.JOBS_LOCAL_RUNNER) === JOBS_LOCAL_RUNNER_ENABLED) {
    return { kind: 'local' }
  }

  throw new Error(
    'Aucun exécuteur de tâches configuré : renseignez INNGEST_EVENT_KEY (avec ' +
      `INNGEST_SIGNING_KEY) pour mettre en file chez le fournisseur, ou JOBS_LOCAL_RUNNER=${JOBS_LOCAL_RUNNER_ENABLED} ` +
      'pour exécuter en mémoire, sans service externe.',
  )
}
