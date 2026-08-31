/**
 * Les règles de la connexion par fournisseur externe (s12).
 *
 * Pures : elles ne connaissent ni la bibliothèque d'authentification, ni une
 * requête, ni une table. Ce sont elles que la configuration de Better Auth et
 * les routes appellent, et c'est là qu'elles sont éprouvées
 * (`auth-rules.test.ts`).
 */

/**
 * Les fournisseurs **réels**, énumérés. Une énumération fermée, et c'est ce qui
 * donne son sens au critère « aucune route de rappel » : chaque fournisseur a
 * son chemin de rappel déclaré, un identifiant absent d'ici n'en a pas.
 */
export const OAUTH_PROVIDERS = ['google', 'github'] as const

export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number]

/**
 * Le fournisseur de **développement**, monté par un drapeau explicite et par
 * lui seul (`OAUTH_LOCAL_PROVIDER`, sur le modèle d'`EMAIL_LOCAL_CAPTURE`).
 *
 * Il porte un identifiant distinct des vrais fournisseurs : un compte ouvert
 * par lui est reconnaissable en base, et il ne peut pas se faire passer pour un
 * compte Google.
 */
export const LOCAL_OAUTH_PROVIDER_ID = 'local'

export type AnyOAuthProviderId = OAuthProviderId | typeof LOCAL_OAUTH_PROVIDER_ID

/** Tous les identifiants qui peuvent avoir un chemin de rappel déclaré. */
export const OAUTH_CALLBACK_PROVIDERS: readonly AnyOAuthProviderId[] = [
  ...OAUTH_PROVIDERS,
  LOCAL_OAUTH_PROVIDER_ID,
]

/**
 * L'identité **fixe** du fournisseur de développement.
 *
 * Fixe, et c'est la décision : une adresse choisie par le visiteur ferait du
 * drapeau un « se connecter en tant que n'importe qui ». Le domaine `example.test`
 * est réservé aux tests (RFC 6761) — cette adresse ne peut appartenir à
 * personne.
 */
export const LOCAL_OAUTH_EMAIL = 'local@example.test'

/** L'identifiant de compte chez le fournisseur de développement. Stable. */
export const LOCAL_OAUTH_ACCOUNT_ID = 'local-oauth-account'

/**
 * Les chemins que l'**infrastructure** et la **présentation** partagent, sans
 * se connaître : les deux couches ne s'importent pas (ADR 006), et la
 * bibliothèque a besoin de savoir où renvoyer.
 *
 * Ils sont relatifs au préfixe de montage des modules ; qui construit une URL
 * absolue y ajoute l'URL publique de l'application.
 */
export const LOCAL_OAUTH_AUTHORIZE_PATH = '/auth/local-provider/authorize'
export const OAUTH_ERROR_PATH = '/auth/oauth-error'

/** L'écran de rebond du retour, côté application. Voir `oauthReturnPath`. */
export const OAUTH_RETURN_SCREEN = '/oauth/return'

/**
 * Où atterrit un retour réussi : **le rebond**, portant la destination.
 *
 * Le rebond n'est pas une coquetterie : le cookie de session est
 * `SameSite=Strict` (`docs/security.md` §1), et il ne repart pas sur la fin
 * d'une chaîne de navigation venue du fournisseur. La page de rebond est
 * publique, ne lit rien du compte, et provoque une seconde navigation —
 * same-site, donc porteuse du cookie.
 */
export const oauthReturnPath = (destination: string): string =>
  `${OAUTH_RETURN_SCREEN}?next=${encodeURIComponent(destination)}`

export const isOAuthProviderId = (value: unknown): value is AnyOAuthProviderId =>
  typeof value === 'string' &&
  (OAUTH_CALLBACK_PROVIDERS as readonly string[]).includes(value)

/**
 * Le code de refus d'une identité dont le fournisseur n'atteste pas l'adresse.
 *
 * Il ne sort jamais tel quel vers un navigateur : `oauthFailureClass` le replie
 * sur l'échec unique. Il existe pour le journal et pour les tests.
 */
export const OAUTH_UNVERIFIED_EMAIL_REFUSAL = 'oauth_email_not_asserted'

/**
 * Le code d'un retour abandonné parce que le fournisseur n'a pas répondu dans
 * le délai (`docs/reliability.md` §3).
 *
 * Comme le précédent, il ne sort jamais tel quel : `oauthFailureClass` le replie
 * sur l'échec unique. Il existe pour que le refus soit **le nôtre** — sans lui,
 * une échéance dépassée n'aurait aucune réponse à rendre.
 */
export const OAUTH_PROVIDER_TIMEOUT_REFUSAL = 'oauth_provider_timeout'

export interface OAuthProvisioningContext {
  /** La méthode d'authentification qui présente cette identité. */
  readonly method: string
  /** Ce que la bibliothèque s'apprête à faire : créer, lier, ou ouvrir la session. */
  readonly action: 'create-user' | 'link-account' | 'sign-in'
  /** Ce que le **fournisseur** affirme de l'adresse, jamais ce que la base en dit. */
  readonly providerAssertsEmail: boolean
}

/**
 * **La moitié « fournisseur » de la double preuve.**
 *
 * Un fournisseur qui ne garantit pas l'adresse ne prouve rien : il affirme
 * seulement que quelqu'un a écrit cette adresse chez lui. Accepter cette
 * affirmation, c'est laisser ouvrir un compte — ou pire, en rejoindre un — au
 * nom de la victime.
 *
 * La règle vaut pour les **trois** actions, et le refus à la création est le
 * moins évident des trois : sans lui, la bibliothèque crée la ligne `auth_user`
 * puis refuse la session (`link-account.mjs`, branche `isRegister`), et
 * l'adresse d'un tiers reste squattée par un compte que personne ne contrôle.
 *
 * L'autre moitié — « le compte local est déjà vérifié » — est tenue par
 * `accountLinking.requireLocalEmailVerified` de la bibliothèque, épinglé dans
 * `infrastructure/better-auth-service.ts` et éprouvé par un parcours.
 *
 * Rend le code de refus, ou `null` quand il n'y a rien à refuser. Ce qui ne
 * vient pas d'un fournisseur n'est pas jugé ici : le mot de passe a ses propres
 * règles, et les rejouer ici en ferait une seconde vérité.
 */
export function oauthProvisioningRefusal(context: OAuthProvisioningContext): string | null {
  if (context.method !== 'oauth') {
    return null
  }

  return context.providerAssertsEmail ? null : OAUTH_UNVERIFIED_EMAIL_REFUSAL
}

/** Ce qu'un retour en échec a le droit de dire au visiteur. Deux classes. */
export type OAuthFailureClass = 'denied' | 'failed'

/**
 * La classe d'un retour en échec (`docs/security.md` §7).
 *
 * Un seul code sort du lot, et c'est le seul qui ne parle **que** du geste du
 * visiteur : `access_denied`, la réponse normalisée d'un fournisseur OAuth 2
 * quand la personne refuse l'autorisation (RFC 6749 §4.1.2.1). Tout le reste
 * est replié sur un échec unique — `account_not_linked` dirait qu'un compte
 * existe à cette adresse, `email_not_found` dirait le contraire, et les deux
 * répondraient à une question que personne n'a le droit de poser depuis une
 * page publique.
 *
 * Le repli est le défaut, pas une liste : un code inconnu, absent ou vide est
 * un échec. Ajouter une classe demande une décision, jamais un oubli.
 */
export function oauthFailureClass(code: string | null | undefined): OAuthFailureClass {
  return code === 'access_denied' ? 'denied' : 'failed'
}

/**
 * La classe **relue d'un paramètre d'URL**, côté écran.
 *
 * Distincte de la fonction ci-dessus, et la distinction est le fond du sujet :
 * celle-là traduit un code de fournisseur en classe, celle-ci ne fait
 * qu'**accepter une classe déjà décidée**. L'écran ne doit surtout pas
 * reclasser un code — il n'en reçoit jamais, puisque la route les a tous
 * repliés avant que le navigateur ne voie l'URL. Tout ce qui n'est pas une
 * classe connue est un échec.
 */
export function readOAuthFailureClass(value: unknown): OAuthFailureClass {
  return value === 'denied' ? 'denied' : 'failed'
}

/**
 * Le déliement laisse-t-il un moyen de connexion ?
 *
 * `signInMethods` est le nombre de moyens **actuels**, mot de passe compris :
 * la bibliothèque range l'empreinte du mot de passe dans la même table que les
 * comptes de fournisseur, sous l'identifiant `credential`. Un compte sans aucun
 * moyen de connexion n'est pas récupérable — il faudrait un parcours de reprise
 * que la story ne demande pas et que personne n'a écrit.
 *
 * La règle est ici ; son application est **atomique** dans le dépôt, parce que
 * compter puis supprimer laisse deux déliements simultanés retirer les deux
 * derniers moyens.
 */
export function canUnlinkSignInMethod(signInMethods: number): boolean {
  return signInMethods > 1
}
