import type { ModuleSession } from '@repo/core'

import type { AuthPolicy } from '../domain/auth-policy'
import type { AuthUseCases } from './auth-use-cases'

/**
 * Le port de la bibliothèque d'authentification.
 *
 * `presentation/` ne connaît que cette interface : elle ne sait pas qu'il
 * existe un Better Auth, et le jour où il change, aucune route ne bouge. C'est
 * aussi ce qui rend les routes testables sans base.
 *
 * Trois opérations, et pas une de plus :
 *
 * - `handle` **délègue la requête telle quelle**. C'est la surface pass-through,
 *   réservée aux points d'entrée dont la sécurité ne dépend pas du corps ;
 * - `changePassword` est explicitement **hors** de cette surface : son corps
 *   porte un drapeau (`revokeOtherSessions`) dont dépend une exigence du socle.
 *   Laisser le client le fournir reviendrait à lui laisser décider si ses
 *   autres sessions survivent à un changement de mot de passe ;
 * - `resolveSession` est le crochet que le registre attend (s03).
 */
export interface AuthService {
  handle(request: Request): Promise<Response>
  changePassword(input: {
    readonly request: Request
    readonly currentPassword: string
    readonly newPassword: string
  }): Promise<Response>
  resolveSession(request: Request): Promise<ModuleSession | null>
  readonly useCases: AuthUseCases
  readonly policy: AuthPolicy
}

/** Ce que le module n'est pas encore : un service configuré. */
export class AuthNotConfiguredError extends Error {
  constructor() {
    super(
      'Le module « auth » n’est pas configuré : le point de composition de ' +
        'l’application doit appeler configureAuth() avant de servir une requête.',
    )
    this.name = 'AuthNotConfiguredError'
  }
}
