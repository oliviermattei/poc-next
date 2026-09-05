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
  | { readonly ok: true; readonly revokedSessions: number }
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
}

/** Ce que le point de composition de l'application donne au module. */
export interface AdminDependencies {
  readonly roles: PlatformRoleRepository
  readonly accounts: AdminAccountsPort
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
