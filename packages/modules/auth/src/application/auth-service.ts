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
  /**
   * L'identifiant de la session de l'appelant, quand il en a une.
   *
   * Distinct de `resolveSession` : `ModuleSession` est le contrat du registre,
   * commun à tous les modules, et il ne porte que ce dont l'autorisation a
   * besoin — un compte et des rôles. Y ajouter un identifiant de session
   * rouvrirait le contrat de module pour un besoin d'un seul écran : savoir
   * laquelle, dans la liste, est celle qu'on utilise en ce moment.
   */
  resolveSessionId(request: Request): Promise<string | null>
  /**
   * La langue dans laquelle un email part à qui a fait **cette** requête.
   *
   * `null` est le destinataire dont rien n'est connu — invitation, guest
   * checkout, liste d'attente : il reçoit la locale par défaut du site. La règle
   * est la même dans les deux cas, et c'est celle de `@repo/core`.
   */
  localeOf(request: Request | null): string
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
