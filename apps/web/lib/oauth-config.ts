import { OAUTH_LOCAL_PROVIDER_ENABLED, type Env } from '@repo/config'

/**
 * **La règle qui décide des fournisseurs OAuth**, isolée de ce qui les monte —
 * même forme que `lib/mailer-config.ts` et `lib/auth-config.ts`, et pour la
 * même raison : `apps/web/next.config.ts` la réapplique au **démarrage**, sans
 * charger la bibliothèque d'authentification ni le registre de modules pour
 * poser une question à cinq variables.
 *
 * Trois états, et il faut en choisir un :
 *
 * | Configuration | Ce qui se passe |
 * |---|---|
 * | une paire complète par fournisseur | les boutons correspondants s'affichent, la boucle OAuth est réelle |
 * | `OAUTH_LOCAL_PROVIDER=1`, aucune clé | un fournisseur de développement est monté, sans réseau |
 * | rien | aucun bouton, aucun rappel joignable, l'application démarre |
 *
 * Une paire **incomplète** n'est pas un quatrième état : c'est un refus au
 * démarrage, en nommant la variable absente (`docs/security.md` §5). La
 * bibliothèque, elle, se contenterait d'un avertissement dans le journal, et
 * l'échec n'apparaîtrait qu'au premier clic — en production.
 */
export type OAuthProviderId = 'google' | 'github'

export interface OAuthProviderCredentials {
  readonly id: OAuthProviderId
  readonly clientId: string
  readonly clientSecret: string
}

export interface OAuthConfig {
  readonly providers: readonly OAuthProviderCredentials[]
  readonly localProvider: boolean
}

/** Une variable déclarée vide vaut absente, ici comme dans `parseEnv`. */
const declared = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()

  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/**
 * Les paires, énumérées **littéralement**.
 *
 * Écrites en toutes lettres et non construites depuis l'identifiant : le
 * schéma d'environnement énumère lui aussi ses clés littéralement, et le test
 * d'alignement de `.env.example` en dépend.
 */
const PROVIDER_VARIABLES = [
  { id: 'google', clientId: 'GOOGLE_CLIENT_ID', clientSecret: 'GOOGLE_CLIENT_SECRET' },
  { id: 'github', clientId: 'GITHUB_CLIENT_ID', clientSecret: 'GITHUB_CLIENT_SECRET' },
] as const satisfies readonly {
  readonly id: OAuthProviderId
  readonly clientId: keyof Env
  readonly clientSecret: keyof Env
}[]

/**
 * Rend les fournisseurs configurés, ou lève en nommant la variable fautive.
 *
 * La règle est réappliquée ici et pas seulement dans le schéma parce que
 * `getEnv` ne valide rien en phase de build ni sous `SKIP_ENV_VALIDATION` :
 * sur ces chemins, le `GOOGLE_CLIENT_ID=` vide que livre `.env.example` se
 * lirait « clé renseignée » (revue de s06, G2).
 */
export function resolveOAuthConfig(env: Env): OAuthConfig {
  const providers: OAuthProviderCredentials[] = []
  let anyKey = false

  for (const variables of PROVIDER_VARIABLES) {
    const clientId = declared(env[variables.clientId])
    const clientSecret = declared(env[variables.clientSecret])

    anyKey = anyKey || clientId !== undefined || clientSecret !== undefined

    if (clientId !== undefined && clientSecret === undefined) {
      throw new Error(
        `Fournisseur « ${variables.id} » à moitié configuré : ${variables.clientSecret} est ` +
          `requis dès que ${variables.clientId} est renseigné. Sans lui, le bouton s'afficherait ` +
          'et l’échange de code échouerait au premier clic.',
      )
    }

    if (clientSecret !== undefined && clientId === undefined) {
      throw new Error(
        `Fournisseur « ${variables.id} » à moitié configuré : ${variables.clientId} est requis ` +
          `dès que ${variables.clientSecret} est renseigné.`,
      )
    }

    if (clientId !== undefined && clientSecret !== undefined) {
      providers.push({ id: variables.id, clientId, clientSecret })
    }
  }

  const localProvider = declared(env.OAUTH_LOCAL_PROVIDER) === OAUTH_LOCAL_PROVIDER_ENABLED

  /**
   * **Le drapeau ne s'arme pas en production**, et ce n'est pas de la forme.
   *
   * Le fournisseur de développement ouvre **toujours** une session sur
   * `local@example.test`, sans mot de passe et sans réseau. Posé seul sur un
   * déploiement de production — une variable copiée d'un `.env` de poste
   * suffit —, il donne un bouton « Continuer avec Fournisseur local » à tout
   * visiteur anonyme, et rien ne s'y oppose. Le rayon d'action est sans commune
   * mesure avec celui d'`EMAIL_LOCAL_CAPTURE`, dont il partage la forme : au
   * pire, des emails ne partent pas.
   *
   * La règle du socle — « jamais déduit de `NODE_ENV` » — reste tenue : le
   * drapeau demeure l'**unique** opt-in, `NODE_ENV` ne l'active jamais, il le
   * **restreint**. Et le refus est un refus de **démarrage**, qui nomme la
   * variable : le déploiement s'arrête avant de servir sa première requête,
   * plutôt que de servir une porte ouverte.
   */
  if (localProvider && env.NODE_ENV === 'production') {
    throw new Error(
      `OAUTH_LOCAL_PROVIDER=${OAUTH_LOCAL_PROVIDER_ENABLED} est posé avec NODE_ENV=production : ` +
        'le fournisseur de développement ouvre une session sur une adresse fixe, sans mot de ' +
        'passe, pour n’importe quel visiteur. Retirez OAUTH_LOCAL_PROVIDER de cet environnement, ' +
        'ou configurez un vrai fournisseur (GOOGLE_CLIENT_ID / GITHUB_CLIENT_ID et leurs secrets).',
    )
  }

  if (localProvider && anyKey) {
    throw new Error(
      `OAUTH_LOCAL_PROVIDER=${OAUTH_LOCAL_PROVIDER_ENABLED} et des identifiants de fournisseur ` +
        'sont configurés en même temps : choisissez l’un des deux. Le mode local est un opt-in ' +
        'de développement, jamais un repli — sans quoi personne ne peut distinguer une connexion ' +
        'réelle d’une connexion simulée.',
    )
  }

  return { providers, localProvider }
}
