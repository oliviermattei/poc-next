import type { BanRefusal, RevocationRefusal } from '../domain/platform-role'
import type { AdminSecurityLog } from '../domain/security-event'

/**
 * Les **ports** du module (ADR 006) : ce dont les cas d'usage ont besoin, dit
 * par eux, sans savoir qui l'implémente.
 *
 * **Aucun ne lève** (`AGENTS.md` racine) : chacun rend un résultat discriminé,
 * si bien que le compilateur oblige l'appelant à traiter l'échec au lieu de
 * retomber sur un 500.
 */

/** Ce que rend une promotion. */
export type GrantOutcome =
  | { readonly ok: true; readonly granted: boolean }
  | { readonly ok: false; readonly error: 'unknown_account' }

/**
 * Ce que rend une révocation.
 *
 * Le motif du refus est **le type du `domain`**, jamais un littéral recopié :
 * deux vocabulaires pour une règle divergeraient, et le premier à diverger
 * serait celui que la réponse HTTP porte.
 */
export type RevokeOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: RevocationRefusal }

export interface PlatformRoleRepository {
  /** Combien de comptes portent le rôle. C'est ce que le garde-fou du dernier compte. */
  countSuperadmins(): Promise<number>
  isSuperadmin(userId: string): Promise<boolean>
  /**
   * **Parmi ces comptes, ceux qui administrent** (s37b2).
   *
   * Une lecture pour une page entière, et non une par ligne : la colonne
   * « droits » d'une liste de vingt comptes coûterait sinon vingt ordres. Elle
   * ne lit que **la table de ce module**, celle du rôle de plateforme — aucune
   * table du socle n'est atteinte.
   */
  superadminsAmong(userIds: readonly string[]): Promise<readonly string[]>
  /**
   * **Les rôles de plateforme que ce compte porte** (s56), tels que la table
   * les porte.
   *
   * C'est la lecture que le socle consomme à chaque résolution de session, par
   * la fonction que le point de composition lui injecte : `ModuleSession.roles`
   * en sort, et le niveau de protection `role` s'y décide. Elle est donc
   * **exacte et non élargie** — les rôles de ce compte, pas ceux d'un autre, pas
   * une constante — parce que le sens du défaut y est ouvert : une lecture trop
   * large sert une route réservée à qui n'y a pas droit.
   *
   * Elle ne désigne personne au passage : la désignation du premier superadmin
   * appartient aux chemins d'administration, et la rejouer ici mettrait deux
   * lectures de plus sur le chemin le plus chaud du produit.
   */
  rolesOf(userId: string): Promise<readonly string[]>
  /**
   * Accorde le rôle. `granted: false` quand le compte le portait déjà — c'est
   * une réponse, pas un échec : la désignation du premier superadmin est
   * rejouée à chaque requête d'administration et doit rester sans effet
   * supplémentaire (`docs/reliability.md` §1).
   */
  grantSuperadmin(input: {
    readonly userId: string
    readonly grantedBy: string | null
    readonly at: Date
  }): Promise<GrantOutcome>
  /**
   * Retire le rôle, **sans jamais retirer le dernier**.
   *
   * La règle est dans le `domain` ; son application est atomique ici : compter
   * puis supprimer laisserait deux révocations simultanées observer « il en
   * reste deux » et retirer chacune la sienne.
   */
  revokeSuperadmin(userId: string): Promise<RevokeOutcome>
  /**
   * **Rompt le lien vers le compte qui a promu** (s34, constat F1 de la revue).
   *
   * `granted_by` n'a aucune clé étrangère — effacer le promoteur ne doit ni
   * emporter la promotion, ni la bloquer —, donc aucune cascade ne l'atteint.
   * Sans cette écriture, l'identifiant d'un compte effacé survivait sur chaque
   * rôle qu'il avait accordé.
   *
   * C'est une **anonymisation**, pas un effacement : la ligne reste, le promu
   * garde son rôle, et le décompte du dernier superadmin est inchangé. Rend le
   * nombre de lignes touchées ; rejouée, elle n'en touche plus aucune.
   */
  forgetGranter(userId: string): Promise<number>
  /**
   * **Bannit, sauf s'il s'agit du dernier superadmin** (revue de s37a, F2).
   *
   * Le bannissement lui-même n'appartient pas à ce module — c'est un état du
   * compte, donc du socle (ADR 058) —, mais la règle qui le refuse, si : elle
   * lit la table du rôle de plateforme. Le geste est donc **passé** au dépôt,
   * qui l'exécute sous le **même verrou** que la révocation. Un appel qui
   * déciderait ici puis bannirait dehors serait une lecture qui décide suivie
   * d'une écriture qui obéit : une révocation validée entre les deux ferait de
   * la cible le dernier superadmin, banni.
   *
   * Le résultat du geste est rendu tel quel : ce dépôt ne sait pas ce qu'il
   * enveloppe, et n'a pas à le savoir.
   */
  banUnlessLastSuperadmin<TOutcome>(input: {
    readonly userId: string
    readonly ban: () => Promise<TOutcome>
  }): Promise<
    { readonly ok: true; readonly outcome: TOutcome } | { readonly ok: false; readonly error: BanRefusal }
  >
}

/** Ce que rend un bannissement demandé au socle. */
export type AccountBanOutcome =
  | {
      readonly ok: true
      readonly revokedSessions: number
      /**
       * **Les emprunts que ce bannissement vient de terminer** (revue s37b1,
       * C3) : ceux du compte visé, et ceux qu'il tenait chez autrui.
       *
       * Le socle les ferme — il possède les sessions — mais c'est ici qu'est le
       * journal des emprunts. Sans cette liste, une fin arriverait sans que rien
       * ne l'écrive, et le journal n'aurait que des débuts.
       */
      readonly endedImpersonations: readonly EndedImpersonation[]
    }
  | { readonly ok: false; readonly error: 'not_found' | 'invalid_reason' }

/**
 * Ce que rend le cas d'usage — le résultat du socle, **plus** le refus que ce
 * module ajoute.
 *
 * Le refus n'est pas dans `AccountBanOutcome` : le socle ne connaît pas le rôle
 * de plateforme, et lui prêter un motif qu'il ne peut pas rendre ferait un type
 * qui ment sur le port.
 */
export type BanAccountOutcome =
  | AccountBanOutcome
  | { readonly ok: false; readonly error: BanRefusal }

/**
 * **Ce que le module d'administration sait des comptes**, et rien de plus.
 *
 * Trois opérations, toutes servies par le point de composition de
 * l'application, qui les délègue au module `auth`. Ce module ne lit **jamais**
 * les tables de `auth` — sa seule dépendance est la clé étrangère de
 * `src/schema.ts` (ADR 018).
 *
 * `findIdByEmail` n'est appelée qu'avec l'adresse **de la configuration**,
 * jamais avec une adresse reçue d'une requête : ce n'est pas un point d'entrée
 * d'énumération de comptes, et aucune route ne l'expose (`docs/security.md`
 * §7).
 */
export interface AdminAccountsPort {
  findIdByEmail(email: string): Promise<
    { readonly ok: true; readonly userId: string | null } | { readonly ok: false }
  >
  ban(input: {
    readonly userId: string
    readonly reason: string | null
  }): Promise<AccountBanOutcome>
  unban(input: { readonly userId: string }): Promise<AccountBanOutcome>
  /**
   * **Parmi ces comptes, ceux qui ne peuvent pas ouvrir de session** (s37b1).
   *
   * C'est ce qui permet de compter les superadmins **capables de se connecter**
   * sans que ce module lise `auth_user` : il donne les identifiants qu'il tient
   * déjà de sa propre table, et reçoit lesquels sont fermés. La jointure aurait
   * été le correctif évident ; elle franchirait la borne d'import de
   * `src/schema.ts`, posée pour que les lectures de comptes restent derrière ce
   * port (`docs/security.md` §7).
   *
   * `ok: false` est une lecture **en échec**, pas « personne n'est bloqué » :
   * l'appelant refuse alors le geste destructeur au lieu de le décider sur un
   * décompte qu'il n'a pas.
   */
  signInBlockedAmong(userIds: readonly string[]): Promise<
    { readonly ok: true; readonly blocked: readonly string[] } | { readonly ok: false }
  >
  /**
   * **Ouvre une session au nom du compte visé** (s37b1), marquée de son
   * emprunteur, et **fait tourner** celle de l'appelant.
   *
   * La requête y entre parce que la session est un **cookie** : qui appelle et
   * quelle session il présente ne se lisent pas autrement, et le socle est le
   * seul à savoir signer celui qu'il rend. Ce module ne fabrique aucun cookie
   * et ne lit aucune table de sessions.
   *
   * Le **droit** d'emprunter est jugé ici, avant l'appel : ce port n'autorise
   * rien.
   */
  startImpersonation(input: {
    readonly request: Request
    readonly actorId: string
    readonly userId: string
  }): Promise<AccountImpersonation>
  /** Rend la main : la session empruntée meurt, l'emprunteur en reçoit une neuve. */
  stopImpersonation(input: { readonly request: Request }): Promise<AccountImpersonation>
  /**
   * **Éteint les emprunts tenus par ce compte** (revue s37b1, C3).
   *
   * Appelée quand il cesse d'avoir le droit d'emprunter : le retrait du rôle.
   * Un compte qui n'administre plus ne garde pas ouverte la session d'un client.
   */
  endBorrowsBy(userId: string): Promise<
    { readonly ok: true; readonly ended: readonly EndedImpersonation[] } | { readonly ok: false }
  >
  /**
   * **Qui emprunte la session de l'appelant**, `null` quand elle est ordinaire.
   *
   * `ok: false` est une lecture en échec : le back-office **refuse** alors,
   * comme il refuse un décompte qu'il n'a pas pu faire.
   */
  borrowerOf(request: Request): Promise<
    { readonly ok: true; readonly impersonatedBy: string | null } | { readonly ok: false }
  >
  /**
   * **Les emprunts échus, effacés et nommés** (s37b1) : c'est ce qui fait de
   * l'expiration une **fin**, et donc du second événement du journal un
   * événement qui arrive toujours.
   */
  sweepExpiredImpersonations(at: Date): Promise<
    { readonly ok: true; readonly ended: readonly EndedImpersonation[] } | { readonly ok: false }
  >
  /**
   * **Une page de comptes, avec sa recherche** (s37b2) — le troisième
   * élargissement de ce port, et il suit la même porte que les deux premiers.
   *
   * La jointure vers `auth_user` aurait été le raccourci évident ; elle
   * franchirait la borne d'import de `src/schema.ts`, posée pour que les
   * lectures de comptes restent **ici**, derrière un port, et derrière un
   * identifiant plutôt qu'une adresse (`docs/security.md` §7).
   *
   * `ok: false` est une lecture **en échec**, jamais « aucun compte » : un
   * back-office qui afficherait un état vide sur une panne mentirait à celui
   * qui administre.
   */
  listAccounts(input: {
    readonly search: string | null
    readonly limit: number
    readonly offset: number
  }): Promise<
    | { readonly ok: true; readonly accounts: readonly AdminAccount[]; readonly total: number }
    | { readonly ok: false }
  >
  /**
   * **Un compte et ses sessions**, à partir de son identifiant.
   *
   * `detail: null` est un compte que le socle ne connaît pas : le back-office
   * rend alors 404, comme pour n'importe quelle ressource inconnue.
   */
  describeAccount(userId: string): Promise<
    { readonly ok: true; readonly detail: AdminAccountDetail | null } | { readonly ok: false }
  >
  /**
   * **Révoque une session du compte visé** (critère 3), côté serveur.
   *
   * Le compte fait partie de la condition d'écriture, il n'est pas vérifié
   * avant : `revoked: false` ne distingue donc pas « cette session n'est pas à
   * ce compte » de « elle n'existe pas ».
   */
  revokeSession(input: {
    readonly userId: string
    readonly sessionId: string
  }): Promise<{ readonly ok: true; readonly revoked: boolean } | { readonly ok: false }>
  /**
   * **Déclenche une réinitialisation de mot de passe** pour le compte visé.
   *
   * L'adresse n'entre pas ici : elle est **relue de l'identifiant** par le
   * point de composition, qui poste ensuite sur la route publique du socle. Ce
   * module ne manipule aucune adresse reçue d'une requête.
   */
  sendPasswordReset(input: {
    readonly userId: string
  }): Promise<{ readonly ok: true; readonly sent: boolean } | { readonly ok: false }>
}

/** Une organisation, telle que le back-office la liste (s37b2). */
export interface AdminOrganization {
  readonly organizationId: string
  readonly name: string
  readonly slug: string
  readonly memberCount: number
  /** L'offre détenue, ou `null` — module de facturation coupé compris. */
  readonly offerId: string | null
  /**
   * L'état d'abonnement, tel que la facturation le nomme.
   *
   * Une **chaîne** et non une énumération de ce module : le vocabulaire
   * appartient au module `billing`, et le recopier ici en ferait une seconde
   * vérité qui divergerait au premier état ajouté.
   */
  readonly subscriptionState: string | null
}

/** Un membre d'une organisation, et son rôle. */
export interface AdminOrganizationMember {
  readonly userId: string
  readonly email: string
  readonly role: string
}

/** L'appartenance d'un compte, telle que son détail l'affiche. */
export interface AdminMembership {
  readonly organizationId: string
  readonly name: string
  readonly role: string
}

/**
 * **Ce que le back-office sait des organisations** (s37b2) — un second port, et
 * pour la même raison que le premier.
 *
 * Le module `admin` ne déclare pas `organizations` dans ses `requires` et ne
 * peut donc ni l'importer, ni joindre ses tables. Il reçoit ce port du point de
 * composition de l'application, qui sait, lui, si ce module est monté.
 *
 * **Aucune méthode ne dit si le module existe**, et c'est délibéré : module
 * coupé, les lectures rendent des listes vides, et aucun écran ne porte de
 * condition sur un identifiant de module. Ce qui disparaît alors est l'**entrée
 * de navigation**, dérivée du registre (ADR 066, `surface: 'admin'`).
 */
export interface AdminOrganizationsPort {
  listOrganizations(input: {
    readonly search: string | null
    readonly limit: number
    readonly offset: number
  }): Promise<
    | {
        readonly ok: true
        readonly organizations: readonly AdminOrganization[]
        readonly total: number
      }
    | { readonly ok: false }
  >
  describeOrganization(organizationId: string): Promise<
    | {
        readonly ok: true
        readonly detail: {
          readonly organization: AdminOrganization
          readonly members: readonly AdminOrganizationMember[]
        } | null
      }
    | { readonly ok: false }
  >
  /** Les appartenances d'un compte : la première carte de son détail. */
  membershipsOf(userId: string): Promise<
    { readonly ok: true; readonly memberships: readonly AdminMembership[] } | { readonly ok: false }
  >
}

/**
 * **Ce qu'une liste d'administration montre d'un compte** (s37b2).
 *
 * Le socle le remplit ; ce module ne fait que l'afficher. **Aucun jeton, aucun
 * secret** : ce type *est* la liste de ce qui sort, et un champ ajouté ici est
 * un champ qu'un écran rendra.
 */
export interface AdminAccount {
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly emailVerified: boolean
  readonly banned: boolean
  readonly createdAt: Date
}

/**
 * Une session active d'un compte, telle que le back-office l'affiche.
 *
 * **Le jeton n'en fait pas partie**, comme dans la liste de sessions qu'un
 * compte voit de lui-même (`docs/security.md` §2) : un jeton rendu à un écran
 * annule `HttpOnly`, et l'écran d'un superadmin n'y fait pas exception.
 */
export interface AdminAccountSession {
  readonly sessionId: string
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly ipAddress: string | null
  readonly userAgent: string | null
}

/** Le compte et ses sessions, en une seule lecture du socle. */
export interface AdminAccountDetail {
  readonly account: AdminAccount
  readonly sessions: readonly AdminAccountSession[]
}

/** Un emprunt terminé : les deux comptes, parce que le journal nomme les deux. */
export interface EndedImpersonation {
  readonly userId: string
  readonly impersonatedBy: string
}

/**
 * Ce que rend un passage de main. `setCookie` est l'en-tête **déjà formé** : le
 * jeton de session ne traverse jamais ce module.
 */
export type AccountImpersonation =
  | {
      readonly ok: true
      readonly setCookie: string
      readonly userId: string
      readonly actorId: string
    }
  | { readonly ok: false; readonly error: 'unknown_account' | 'not_impersonating' }

/** Ce que le point de composition de l'application donne au module. */
export interface AdminDependencies {
  readonly roles: PlatformRoleRepository
  readonly accounts: AdminAccountsPort
  /** Ce que le back-office sait des organisations (s37b2). Vide quand le module est coupé. */
  readonly organizations: AdminOrganizationsPort
  /**
   * L'adresse du **premier** superadmin, telle que la configuration la nomme.
   *
   * `null` quand la variable n'est pas renseignée : le module ne lit aucune
   * variable d'environnement (`docs/security.md` §5), il reçoit la réponse.
   */
  readonly designatedEmail: string | null
  readonly securityLog: AdminSecurityLog
  readonly now: () => Date
}
