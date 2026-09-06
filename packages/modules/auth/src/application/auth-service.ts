import type { ModuleSession } from '@repo/core'

import type { AuthPolicy } from '../domain/auth-policy'
import type { AnyOAuthProviderId } from '../domain/oauth'
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
  /**
   * Le rappel d'un fournisseur externe, **sous échéance**.
   *
   * Distinct de `handle` parce que c'est le seul point d'entrée du module qui
   * déclenche des appels réseau sortants, et que `docs/reliability.md` §3 ne
   * souffre pas d'exception : « tout appel réseau sortant porte un délai
   * d'attente explicite ». L'échéance dépassée rend le refus générique du
   * module, jamais une exception.
   */
  handleOAuthCallback(request: Request): Promise<Response>
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
   * **Emprunte la session d'un compte** (s37b1) — l'élévation de privilège du
   * back-office.
   *
   * Elle est ici, et non dans les cas d'usage, pour la raison qui vaut déjà
   * pour `changePassword` et `digestBackupCode` : ce qui manque aux cas d'usage
   * est le **cookie**, dont le nom, les attributs et la signature appartiennent
   * à la bibliothèque. Le droit d'emprunter, lui, a été jugé par le module
   * `admin` avant l'appel — ce port n'autorise rien.
   *
   * La session de l'appelant est **remplacée** : `docs/security.md` §2 impose la
   * rotation à toute élévation de privilège, et une élévation qui laisserait
   * l'ancien identifiant valable n'en serait pas une.
   */
  startImpersonation(input: {
    readonly request: Request
    readonly actorId: string
    readonly userId: string
  }): Promise<ImpersonationHandover>
  /**
   * **Rend la main** : la session empruntée meurt, l'emprunteur en reçoit une
   * neuve. Refusé quand la session de l'appelant n'est pas un emprunt.
   */
  stopImpersonation(input: { readonly request: Request }): Promise<ImpersonationHandover>
  /**
   * **Qui emprunte la session de cet appelant**, `null` quand elle est
   * ordinaire — ou qu'il n'y en a pas.
   *
   * C'est la lecture qui permet au back-office de refuser une session
   * empruntée. Une absence de session n'est pas un emprunt : qui est
   * l'appelant est décidé par le répartiteur, cette question-ci ne porte que
   * sur la nature de sa session.
   */
  borrowerOf(request: Request): Promise<string | null>
  /**
   * La langue dans laquelle un email part à qui a fait **cette** requête.
   *
   * `null` est le destinataire dont rien n'est connu — invitation, guest
   * checkout, liste d'attente : il reçoit la locale par défaut du site. La règle
   * est la même dans les deux cas, et c'est celle de `@repo/core`.
   */
  localeOf(request: Request | null): string
  /**
   * L'empreinte d'un code de secours saisi (s13).
   *
   * Sur cette surface parce que la route en a besoin **avant** de transmettre
   * la saisie : la base ne contient que des empreintes, et la comparaison de
   * la bibliothèque porte sur ce qu'elle reçoit. Le poivre, lui, ne quitte
   * jamais `infrastructure/` — `presentation/` reçoit une fonction, pas une
   * clé.
   */
  digestBackupCode(code: string): string
  /**
   * **Prend le compteur du code TOTP qui vient d'être accepté** (s13, C3).
   *
   * Rend `false` quand ce compteur a déjà servi : le code est un rejeu, et la
   * route doit défaire ce que la bibliothèque a fait. Un code accepté reste
   * sinon valable jusqu'à quatre-vingt-dix secondes, sur autant de défis
   * neufs qu'on veut — ce que le critère 4 de la story refuse.
   *
   * Sur cette surface, et non dans les cas d'usage, pour la même raison que
   * `digestBackupCode` : y répondre demande le secret du compte, chiffré par
   * la clé de l'application, et cette clé ne quitte pas `infrastructure/`.
   */
  claimTotpStep(input: {
    readonly userId: string
    readonly code: string
  }): Promise<boolean>
  /**
   * Les fournisseurs externes **réellement montés** (s12).
   *
   * C'est cette liste qui décide de tout : les boutons affichés, les rappels
   * joignables, et le refus d'un fournisseur qu'on ne connaît pas. Le module ne
   * lit aucune variable d'environnement — il reçoit cette liste du point de
   * composition, qui est le seul à savoir ce qui est configuré.
   */
  readonly oauthProviders: readonly AnyOAuthProviderId[]
  readonly useCases: AuthUseCases
  readonly policy: AuthPolicy
}

/**
 * Le passage de main d'un emprunt de session, dans un sens comme dans l'autre.
 *
 * `setCookie` est l'en-tête **déjà formé** : le jeton ne sort jamais autrement,
 * et surtout jamais dans un corps de réponse (`HttpOnly` n'existe que pour
 * ça). Les deux identifiants sortent, eux : c'est ce que le journal nomme aux
 * deux bouts.
 */
export type ImpersonationHandover =
  | {
      readonly ok: true
      readonly setCookie: string
      /** Le compte que la session désigne désormais. */
      readonly userId: string
      /** Le superadmin qui emprunte — ou qui vient de rendre la main. */
      readonly actorId: string
    }
  | { readonly ok: false; readonly error: 'unknown_account' | 'not_impersonating' }

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
