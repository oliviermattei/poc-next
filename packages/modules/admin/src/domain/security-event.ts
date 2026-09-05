/**
 * Les événements de sécurité du module (`docs/security.md` §7, qui nomme
 * explicitement « changement de rôle »).
 *
 * **La forme est fermée, et c'est toute la garde** — même raison que dans
 * `organizations` : chaque champ est nommé ci-dessous, il n'existe aucun champ
 * libre où glisser un secret, et c'est le compilateur qui le tient. Recopier le
 * filtrage de valeurs d'`auth` serait ici nuisible : son motif de secret
 * (`/[A-Za-z0-9_\-+/=.]{16,}/`) attraperait les identifiants de compte de ce
 * dépôt et journaliserait `[filtré]` à la place de la cible — c'est-à-dire
 * l'information même que le §7 demande.
 *
 * **Le motif d'un bannissement n'y entre pas.** C'est un texte libre écrit par
 * un humain : il peut nommer une personne, une adresse, un numéro de dossier.
 * Le journal dit qui a banni qui, pas pourquoi ; le motif reste en base, lisible
 * du seul back-office.
 */
export type AdminSecurityEventName =
  /** Le rôle de plateforme accordé — promotion ou désignation du premier. */
  | 'admin.superadmin_granted'
  /** Le rôle retiré. */
  | 'admin.superadmin_revoked'
  /**
   * Une révocation **refusée** : c'est le garde-fou du dernier qui a mordu, ou
   * une cible qui ne portait pas le rôle. Journalisée pour la même raison que
   * `organizations.role_change_refused` — c'est le signal d'un geste qui aurait
   * rendu la plateforme inadministrable.
   */
  | 'admin.superadmin_revocation_refused'
  | 'admin.account_banned'
  /**
   * Un bannissement **refusé** : la cible est le dernier superadmin, et le
   * bannir rendrait la plateforme inadministrable. Journalisé pour la même
   * raison que le refus de révocation — c'est le signal d'un geste qui aurait
   * fermé le back-office pour de bon.
   */
  | 'admin.account_ban_refused'
  | 'admin.account_unbanned'
  /**
   * Une action d'administration tentée par un compte qui n'est pas superadmin.
   *
   * La réponse rendue, elle, est un **404** : elle ne distingue rien. Le journal
   * si — c'est le signal d'une tentative d'élévation (`docs/security.md` §7).
   */
  | 'admin.access_refused'

export interface AdminSecurityEvent {
  readonly event: AdminSecurityEventName
  /** Le compte qui agit. Un identifiant, jamais une adresse — elle nomme une personne. */
  readonly actor: string
  /**
   * Le compte visé. Un identifiant, pour la même raison.
   *
   * `null` quand le geste n'en nomme aucun de valide : l'autorisation est
   * décidée **avant** la validation du corps, donc un refus d'accès n'a pas de
   * cible connue. Le journal dit alors `null` plutôt que d'écrire tel quel ce
   * que l'appelant a envoyé.
   */
  readonly target: string | null
}

/** Le port du journal : le module écrit, il ne décide pas où. */
export type AdminSecurityLog = (event: AdminSecurityEvent) => void
