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
