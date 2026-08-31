/**
 * La politique d'authentification : **de la configuration, pas des constantes
 * en dur**.
 *
 * `docs/stories.md` le nomme comme le piège de la story — « longueur minimale
 * de mot de passe et durées de validité des liens sont de la configuration ».
 * Elles vivent donc dans un objet unique, injecté au point de composition
 * (`apps/web/lib/auth.ts`), que le propriétaire du projet lit et modifie d'un
 * seul endroit.
 *
 * Cet objet est aussi ce qui garantit **une seule vérité** : la même valeur
 * arme la règle du `domain` et la configuration de Better Auth. Deux littéraux
 * divergeraient, et c'est toujours le plus permissif qui gagnerait.
 */
export interface AuthPolicy {
  /** Longueur minimale d'un mot de passe, à l'inscription et à la réinitialisation. */
  readonly passwordMinLength: number
  /** Longueur maximale : au-delà, le hachage devient un vecteur de déni de service. */
  readonly passwordMaxLength: number
  /** Durée de vie d'un lien de vérification d'email, en secondes. */
  readonly emailVerificationTtlSeconds: number
  /** Durée de vie d'un magic link, en secondes. */
  readonly magicLinkTtlSeconds: number
  /** Durée de vie d'un lien de réinitialisation de mot de passe, en secondes. */
  readonly passwordResetTtlSeconds: number
  /** Durée de vie d'une session, en secondes. */
  readonly sessionTtlSeconds: number
  /**
   * Fenêtre de fraîcheur d'une session, en secondes : au-delà, l'expiration
   * est repoussée à l'usage. Zéro remettrait la base à contribution à chaque
   * requête.
   */
  readonly sessionRefreshAfterSeconds: number
}

/**
 * Les valeurs livrées. Courtes, parce que le socle l'exige : un lien à usage
 * unique valide une journée est un lien qu'on retrouve dans une boîte
 * compromise (`docs/security.md` §2).
 */
export const defaultAuthPolicy: AuthPolicy = {
  passwordMinLength: 12,
  passwordMaxLength: 128,
  emailVerificationTtlSeconds: 60 * 30,
  magicLinkTtlSeconds: 60 * 10,
  passwordResetTtlSeconds: 60 * 30,
  sessionTtlSeconds: 60 * 60 * 24 * 7,
  sessionRefreshAfterSeconds: 60 * 60 * 24,
}
