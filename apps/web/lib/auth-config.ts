import type { Env } from '@repo/config'

/**
 * **La règle qui exige une authentification configurée**, isolée de ce qui la
 * construit — exactement la forme retenue pour le mailer en s06, et pour la
 * même raison : `apps/web/next.config.ts` la réapplique au **démarrage**, sans
 * avoir à charger la bibliothèque d'authentification, la base et le registre
 * de modules pour poser une question à deux variables.
 *
 * L'exigence appartient à ce qui monte l'authentification, pas au schéma
 * d'environnement : `pnpm db:migrate` ne signe aucun cookie et doit s'exécuter
 * avec le seul `DATABASE_URL` (revue de s06, G3).
 */
export interface AuthConfig {
  readonly secret: string
  readonly appUrl: string
}

/** Une variable déclarée vide vaut absente, ici comme dans `parseEnv`. */
const declared = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()

  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

export function resolveAuthConfig(env: Env): AuthConfig {
  const secret = declared(env.AUTH_SECRET)
  const appUrl = declared(env.APP_URL)

  if (secret === undefined || appUrl === undefined) {
    throw new Error(
      'Authentification non configurée : renseignez AUTH_SECRET (32 caractères au ' +
        'minimum, qui signe les sessions et les jetons) et APP_URL (l’URL publique de ' +
        'l’application, qui construit les liens envoyés par email). Sans elles, ' +
        'l’application démarrerait avec des sessions non signées ou des liens de ' +
        'vérification pointant nulle part.',
    )
  }

  return { secret, appUrl }
}
