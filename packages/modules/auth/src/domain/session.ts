import type { ModuleSession } from '@repo/core'

/**
 * Ce que le registre appelle une session, dérivé du compte.
 *
 * Deux refus vivent ici plutôt que dans le résolveur, pour qu'un second
 * appelant ne puisse pas les oublier :
 *
 * - **un compte non vérifié n'a pas de session.** C'est le critère « un compte
 *   non vérifié ne peut pas accéder aux routes protégées ». Better Auth refuse
 *   déjà de connecter un compte non vérifié ; cette règle est la seconde
 *   serrure, celle qui tient si un chemin futur (OAuth, invitation) crée une
 *   session sans passer par la connexion par mot de passe ;
 * - **un compte sans identifiant n'a pas de session** : une session anonyme
 *   satisferait la protection `authenticated` sans désigner personne.
 */
export interface AuthenticatedAccount {
  readonly userId: string
  readonly emailVerified: boolean
  readonly roles: readonly string[]
}

export function sessionOf(account: AuthenticatedAccount): ModuleSession | null {
  if (!account.emailVerified || account.userId === '') {
    return null
  }

  return { userId: account.userId, roles: [...account.roles] }
}

/** Une session telle que la persistance la connaît. Le jeton en fait partie. */
export interface StoredSession {
  readonly id: string
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly ipAddress: string | null
  readonly userAgent: string | null
}

/** Une session telle qu'un écran a le droit de la connaître. Le jeton n'en fait pas partie. */
export interface DescribedSession {
  readonly id: string
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly ipAddress: string | null
  readonly userAgent: string | null
  /** Celle de l'appelant : « c'est cet appareil-ci ». */
  readonly current: boolean
}

/**
 * Ce qu'une liste de sessions montre, et dans quel ordre.
 *
 * Deux propriétés, et elles sont ici plutôt que dans la requête SQL ou dans le
 * composant, parce qu'elles se prouvent sans base et sans navigateur :
 *
 * - **le jeton ne sort pas.** Les champs sont recopiés un à un, jamais étalés
 *   depuis la ligne : un `...row` ferait voyager le jeton de session jusqu'au
 *   HTML au premier ajout de colonne, et `HttpOnly` n'existe que pour empêcher
 *   exactement ça (`docs/security.md` §2) ;
 * - **la session courante d'abord.** Révoquer se fait dans une liste où l'on
 *   doit reconnaître son propre appareil avant de couper celui d'un autre.
 */
export function describeSessions(
  sessions: readonly StoredSession[],
  currentSessionId: string | null,
): readonly DescribedSession[] {
  return sessions
    .map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      current: session.id === currentSessionId,
    }))
    .sort((left, right) => {
      if (left.current !== right.current) {
        return left.current ? -1 : 1
      }

      return right.createdAt.getTime() - left.createdAt.getTime()
    })
}
