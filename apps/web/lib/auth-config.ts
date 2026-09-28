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
  /**
   * **L'origine de l'application** : ce qui construit toute URL qui ouvre ou
   * consomme une session (s64a, ADR 078). Sans `APP_HOST`, la chaîne d'`APP_URL`
   * **telle quelle** — jamais re-sérialisée, qui ajouterait une barre finale à
   * chaque lien. Avec, le schéma et le port d'`APP_URL` sur l'hôte d'`APP_HOST`.
   */
  readonly appUrl: string
  /** L'URL du site : `APP_URL`, telle quelle, avec ou sans `APP_HOST`. */
  readonly siteUrl: string
  /**
   * Le `rpID` des passkeys : **toujours l'hôte d'`APP_URL`**. Le déplacer vers
   * l'hôte de l'application invaliderait toutes les passkeys enregistrées.
   */
  readonly passkeyRpId: string
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

  const site = new URL(appUrl)
  const appHost = declared(env.APP_HOST)

  return {
    secret,
    // Construite depuis la configuration, jamais depuis l'en-tête `Host`. La
    // forme d'`APP_HOST` et sa relation à `APP_URL` sont jugées par le schéma.
    appUrl:
      appHost === undefined
        ? appUrl
        : `${site.protocol}//${appHost}${site.port === '' ? '' : `:${site.port}`}`,
    siteUrl: appUrl,
    passkeyRpId: site.hostname,
  }
}
