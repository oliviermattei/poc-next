import {
  BACK_OFFICE_PAGE_SIZE,
  pageCountOf,
  pageWindowOf,
  type BackOfficeQuery,
} from '../domain/back-office'
import { designatesFirstSuperadmin } from '../domain/platform-role'
import type {
  AccountBanOutcome,
  AdminAccount,
  AdminAccountSession,
  AdminDependencies,
  AdminMembership,
  AdminOrganization,
  AdminOrganizationMember,
  BanAccountOutcome,
  GrantOutcome,
  RevokeOutcome,
} from './ports'

/**
 * **Ce que rend une lecture du back-office** (s37b2).
 *
 * Deux refus, et ils ne disent pas la même chose : `not_found` est celui d'une
 * URL inventée — c'est ce que reçoit un compte qui n'administre pas, jamais un
 * 403 (`docs/security.md` §3) —, `unavailable` est une lecture en échec, qu'un
 * écran rend en alerte plutôt qu'en liste vide.
 */
export type BackOfficeView<TView> =
  | { readonly ok: true; readonly view: TView }
  | { readonly ok: false; readonly error: 'not_found' | 'unavailable' }

/** Ce qu'une liste paginée rend, quel que soit ce qu'elle liste. */
export interface BackOfficePage {
  readonly page: number
  readonly pageCount: number
  readonly total: number
  readonly search: string | null
}

/**
 * Une ligne de la liste des comptes : ce que le socle en dit, **plus le rôle de
 * plateforme** que ce module est seul à connaître.
 */
export interface AdminAccountRow extends AdminAccount {
  readonly superadmin: boolean
}

export interface AdminAccountsView extends BackOfficePage {
  readonly accounts: readonly AdminAccountRow[]
}

export interface AdminAccountView {
  readonly account: AdminAccount
  readonly sessions: readonly AdminAccountSession[]
  /** Ce compte administre-t-il ? **Relu en base**, jamais déduit de l'appelant. */
  readonly superadmin: boolean
  readonly memberships: readonly AdminMembership[]
}

export interface AdminOrganizationsView extends BackOfficePage {
  readonly organizations: readonly AdminOrganization[]
}

export interface AdminOrganizationView {
  readonly organization: AdminOrganization
  readonly members: readonly AdminOrganizationMember[]
}

/**
 * Ce que rend une demande d'emprunt. `setCookie` est l'en-tête déjà formé : le
 * jeton de session ne traverse pas ce module, et ne va nulle part ailleurs que
 * dans un `Set-Cookie`.
 */
export type ImpersonationOutcome =
  | { readonly ok: true; readonly setCookie: string }
  | {
      readonly ok: false
      readonly error: 'superadmin_target' | 'unknown_account' | 'not_impersonating'
    }

/**
 * Les cas d'usage du module `admin` (s37a).
 *
 * Ils orchestrent : les règles sont dans le `domain`, la persistance derrière
 * les ports. Aucun ne connaît une requête HTTP, un cookie ou une table — c'est
 * `presentation/` qui traduit leurs refus en réponses, et qui décide que ce
 * refus-là est un **404** (`docs/security.md` §3).
 */
export interface AdminUseCases {
  /**
   * **La garde du back-office**, et le point d'entrée de la désignation.
   *
   * Elle est appelée à chaque requête d'administration, et relit le rôle en
   * base à chaque fois : le pouvoir suit la ligne, pas le jeton de session
   * (ADR 030). Une révocation mord donc à l'instant, sans reconnexion.
   */
  isSuperadmin(userId: string): Promise<boolean>
  grantSuperadmin(input: {
    readonly actorId: string
    readonly userId: string
  }): Promise<GrantOutcome>
  revokeSuperadmin(input: {
    readonly actorId: string
    readonly userId: string
  }): Promise<RevokeOutcome>
  /**
   * **Oublie qui a promu** (s34, constat F1 de la revue).
   *
   * C'est la purge du module, et sa catégorie de rétention est `anonymize` :
   * `granted_by` nomme un compte sans clé étrangère vers lui, donc aucune
   * cascade ne l'atteint, et l'identifiant d'un compte effacé y survivait sur
   * chaque rôle qu'il avait accordé. La ligne est **conservée** — le promu garde
   * son rôle —, seul le lien est rompu.
   */
  forgetGranter(userId: string): Promise<number>
  /**
   * **Bannit un compte, sauf le dernier superadmin** (revue de s37a, F2).
   *
   * Le refus n'est pas une commodité d'écran : sans lui, le superadmin unique
   * qui se bannit garde sa ligne dans la table du rôle — le décompte rend donc
   * 1, la désignation par `SUPERADMIN_EMAIL` ne se redéclenche jamais, et
   * **aucune commande ne répare** la plateforme.
   */
  banAccount(input: {
    readonly actorId: string
    readonly userId: string
    readonly reason: string | null
  }): Promise<BanAccountOutcome>
  unbanAccount(input: {
    readonly actorId: string
    readonly userId: string
  }): Promise<AccountBanOutcome>
  /**
   * **Emprunte la session d'un compte** (s37b1).
   *
   * Deux refus, et le second n'est pas ici : emprunter un **superadmin** est
   * refusé par ce cas d'usage — ce serait s'accorder les droits d'un pair sans
   * qu'aucun changement de rôle ne soit écrit ; emprunter **depuis** une session
   * déjà empruntée est refusé plus haut, par la garde du back-office, qui ne
   * laisse aucune session empruntée administrer.
   */
  startImpersonation(input: {
    readonly request: Request
    readonly actorId: string
    readonly userId: string
  }): Promise<ImpersonationOutcome>
  /** Rend la main. Le seul geste du back-office qu'une session empruntée puisse faire. */
  stopImpersonation(input: { readonly request: Request }): Promise<ImpersonationOutcome>
  /**
   * **La garde du back-office, écrite une fois** (s37b2).
   *
   * Les routes du module et ses écrans posent la **même** question, et deux
   * copies de cette règle divergeraient au premier acteur ajouté : celle-ci est
   * l'unique. Elle refuse une session empruntée avant de juger le rôle, relit le
   * rôle en base, et journalise le refus — la réponse, elle, ne distingue rien.
   */
  authorizeBackOffice(input: {
    readonly request: Request
    readonly userId: string
  }): Promise<boolean>
  /** La page de comptes du back-office : recherche, pagination, quatre états. */
  viewAccounts(input: {
    readonly request: Request
    readonly viewerId: string
    readonly query: BackOfficeQuery
  }): Promise<BackOfficeView<AdminAccountsView>>
  /** Le détail d'un compte : ses organisations, ses droits, ses sessions actives. */
  viewAccount(input: {
    readonly request: Request
    readonly viewerId: string
    readonly userId: string
  }): Promise<BackOfficeView<AdminAccountView>>
  viewOrganizations(input: {
    readonly request: Request
    readonly viewerId: string
    readonly query: BackOfficeQuery
  }): Promise<BackOfficeView<AdminOrganizationsView>>
  viewOrganization(input: {
    readonly request: Request
    readonly viewerId: string
    readonly organizationId: string
  }): Promise<BackOfficeView<AdminOrganizationView>>
  /**
   * **Révoque une session du compte visé** (critère 3).
   *
   * `revoked: false` ne distingue pas « pas à ce compte » de « n'existe pas » :
   * la condition est dans l'écriture, et l'appelant ne peut pas s'en servir pour
   * apprendre à qui appartient un identifiant de session.
   */
  revokeAccountSession(input: {
    readonly actorId: string
    readonly userId: string
    readonly sessionId: string
  }): Promise<{ readonly ok: true; readonly revoked: boolean } | { readonly ok: false }>
  /** Déclenche une réinitialisation de mot de passe pour le compte visé. */
  sendPasswordReset(input: {
    readonly actorId: string
    readonly userId: string
  }): Promise<{ readonly ok: true; readonly sent: boolean } | { readonly ok: false }>
  /**
   * **Compte les emprunts échus comme des fins** (s37b1), et les journalise.
   *
   * Rend le nombre d'emprunts terminés. Rejouée, elle n'en trouve plus aucun :
   * l'effacement de la session *est* l'idempotence (`docs/reliability.md` §1).
   */
  endExpiredImpersonations(at: Date): Promise<number>
}

export function createAdminUseCases(dependencies: AdminDependencies): AdminUseCases {
  const { roles, accounts, organizations, designatedEmail, securityLog, now } = dependencies

  /**
   * **Une fin d'emprunt se journalise là où le début l'a été**, avec les deux
   * mêmes identifiants — quelle que soit la manière dont elle est arrivée :
   * sortie explicite, expiration, bannissement, retrait du rôle.
   */
  const logEndedImpersonations = (
    ended: readonly { readonly userId: string; readonly impersonatedBy: string }[],
  ): void => {
    for (const borrow of ended) {
      securityLog({
        event: 'admin.impersonation_ended',
        actor: borrow.impersonatedBy,
        target: borrow.userId,
      })
    }
  }

  /**
   * **La désignation du premier superadmin** (critère 1), rejouée à chaque
   * requête d'administration et sans effet supplémentaire.
   *
   * Elle est ici plutôt qu'au démarrage pour une raison de fait : sur une base
   * vierge, le compte que la variable nomme **n'existe pas encore** — personne
   * ne s'est inscrit. Une désignation faite une fois au démarrage ne trouverait
   * rien et ne se rejouerait jamais.
   *
   * Elle ne lit le compte que si la base ne porte **aucun** superadmin :
   * l'adresse n'est donc consultée qu'une fois dans la vie de l'installation,
   * et jamais à partir d'une valeur reçue d'une requête.
   */
  const designateFirstSuperadmin = async (): Promise<void> => {
    if (designatedEmail === null) {
      return
    }

    if (
      !designatesFirstSuperadmin({
        superadminCount: await roles.countSuperadmins(),
        designatedEmail,
        // La candidature est celle de la configuration elle-même : c'est le
        // compte de **cette** adresse qui devient le premier superadmin, quel
        // que soit l'appelant.
        candidateEmail: designatedEmail,
      })
    ) {
      return
    }

    const found = await accounts.findIdByEmail(designatedEmail)

    // Le port ne lève pas : une lecture en échec, ou une adresse sans compte,
    // ne désigne personne. Le back-office répond alors 404 — le sens fermé.
    if (!found.ok || found.userId === null) {
      return
    }

    const granted = await roles.grantSuperadmin({
      userId: found.userId,
      // Aucun acteur : la désignation vient de la configuration, pas d'un
      // superadmin. C'est ce qui la distingue d'une promotion dans le journal.
      grantedBy: null,
      at: now(),
    })

    if (granted.ok && granted.granted) {
      securityLog({
        event: 'admin.superadmin_granted',
        actor: 'configuration',
        target: found.userId,
      })
    }
  }

  /** Les deux refus, écrits une fois : deux littéraux recopiés divergeraient. */
  const NOT_FOUND = { ok: false, error: 'not_found' } as const
  const UNAVAILABLE = { ok: false, error: 'unavailable' } as const

  /**
   * **La garde du back-office**, et le seul endroit où elle est écrite.
   *
   * Elle sert les routes du module (`presentation/admin-routes.ts`) *et* ses
   * écrans : deux copies auraient divergé, et la seconde aurait été celle qui
   * laisse entrer. L'ordre compte — une session **empruntée** n'administre
   * jamais, quel que soit le rôle du compte emprunté (s37b1) —, et l'échec de
   * lecture est fermé.
   */
  const authorize = async (input: {
    readonly request: Request
    readonly userId: string
  }): Promise<boolean> => {
    const borrowed = await accounts.borrowerOf(input.request)

    if (!borrowed.ok || borrowed.impersonatedBy !== null) {
      securityLog({ event: 'admin.access_refused', actor: input.userId, target: null })

      return false
    }

    // La désignation est rejouée ici comme sur les routes : sur une base
    // vierge, le premier écran demandé est ce qui nomme le premier superadmin.
    await designateFirstSuperadmin()

    if (!(await roles.isSuperadmin(input.userId))) {
      securityLog({ event: 'admin.access_refused', actor: input.userId, target: null })

      return false
    }

    return true
  }

  return {
    isSuperadmin: async (userId) => {
      await designateFirstSuperadmin()

      return await roles.isSuperadmin(userId)
    },

    grantSuperadmin: async ({ actorId, userId }) => {
      const outcome = await roles.grantSuperadmin({
        userId,
        grantedBy: actorId,
        at: now(),
      })

      if (outcome.ok && outcome.granted) {
        securityLog({ event: 'admin.superadmin_granted', actor: actorId, target: userId })
      }

      return outcome
    },

    forgetGranter: async (userId) => await roles.forgetGranter(userId),

    revokeSuperadmin: async ({ actorId, userId }) => {
      const outcome = await roles.revokeSuperadmin(userId)

      if (outcome.ok) {
        // **Le rôle retiré ferme les emprunts en cours** (revue s37b1, C3) : un
        // compte qui n'administre plus ne garde pas ouverte la session d'un
        // client. Le bannissement ferme par le socle ; ici, c'est le droit qui
        // disparaît, et le socle ne le sait pas.
        const ended = await accounts.endBorrowsBy(userId)

        if (ended.ok) {
          logEndedImpersonations(ended.ended)
        }
      }

      securityLog({
        event: outcome.ok
          ? 'admin.superadmin_revoked'
          : 'admin.superadmin_revocation_refused',
        actor: actorId,
        target: userId,
      })

      return outcome
    },

    banAccount: async ({ actorId, userId, reason }) => {
      // Le bannissement est écrit par le **socle** : l'état appartient au compte
      // (ADR 058), et c'est lui qui révoque les sessions dans la foulée. Le
      // geste est **passé** au dépôt du rôle de plateforme, qui l'exécute sous
      // son verrou : le garde-fou du dernier superadmin ne peut pas être
      // contourné par une révocation concurrente.
      const guarded = await roles.banUnlessLastSuperadmin({
        userId,
        ban: async (): Promise<AccountBanOutcome> => await accounts.ban({ userId, reason }),
      })

      if (!guarded.ok) {
        // Refusé **avant** d'atteindre le socle : rien n'est écrit, aucune
        // session n'est révoquée. Le journal le dit, comme pour la révocation.
        securityLog({ event: 'admin.account_ban_refused', actor: actorId, target: userId })

        return guarded
      }

      if (guarded.outcome.ok) {
        securityLog({ event: 'admin.account_banned', actor: actorId, target: userId })

        // **Le bannissement ferme aussi des emprunts** — ceux du compte visé, et
        // ceux qu'il tenait chez autrui (revue s37b1, C3). Chacun est une fin,
        // et une fin se journalise : sinon le journal a un début sans fin.
        logEndedImpersonations(guarded.outcome.endedImpersonations)
      }

      return guarded.outcome
    },

    unbanAccount: async ({ actorId, userId }) => {
      const outcome = await accounts.unban({ userId })

      if (outcome.ok) {
        securityLog({ event: 'admin.account_unbanned', actor: actorId, target: userId })
      }

      return outcome
    },

    startImpersonation: async ({ request, actorId, userId }) => {
      // **Le refus qui compte** : un superadmin ne s'emprunte pas. Le rôle est
      // relu en base, comme la garde d'accès — le pouvoir suit la ligne, pas le
      // jeton (ADR 030).
      if (await roles.isSuperadmin(userId)) {
        securityLog({ event: 'admin.impersonation_refused', actor: actorId, target: userId })

        return { ok: false, error: 'superadmin_target' }
      }

      const opened = await accounts.startImpersonation({ request, actorId, userId })

      if (!opened.ok) {
        return { ok: false, error: opened.error }
      }

      securityLog({ event: 'admin.impersonation_started', actor: actorId, target: userId })

      return { ok: true, setCookie: opened.setCookie }
    },

    stopImpersonation: async ({ request }) => {
      const closed = await accounts.stopImpersonation({ request })

      if (!closed.ok) {
        return { ok: false, error: closed.error }
      }

      // **Le second bout du journal**, avec les deux mêmes identifiants que le
      // premier : l'emprunteur reste l'acteur, l'emprunté reste la cible.
      securityLog({
        event: 'admin.impersonation_ended',
        actor: closed.actorId,
        target: closed.userId,
      })

      return { ok: true, setCookie: closed.setCookie }
    },

    authorizeBackOffice: async ({ request, userId }) => await authorize({ request, userId }),

    viewAccounts: async ({ request, viewerId, query }) => {
      if (!(await authorize({ request, userId: viewerId }))) {
        return NOT_FOUND
      }

      const window = pageWindowOf({ page: query.page, pageSize: BACK_OFFICE_PAGE_SIZE })
      const read = await accounts.listAccounts({ search: query.search, ...window })

      // Une lecture en échec **refuse** : « aucun compte » est une réponse,
      // pas une panne, et les confondre ferait mentir le back-office.
      if (!read.ok) {
        return UNAVAILABLE
      }

      // **Une lecture pour la page entière** : la colonne « droits » d'une
      // liste de vingt comptes coûterait sinon vingt ordres. Elle ne touche que
      // la table de ce module.
      const administrators = new Set(
        await roles.superadminsAmong(read.accounts.map((account) => account.userId)),
      )

      return {
        ok: true,
        view: {
          accounts: read.accounts.map((account) => ({
            ...account,
            superadmin: administrators.has(account.userId),
          })),
          total: read.total,
          page: query.page,
          pageCount: pageCountOf({ total: read.total, pageSize: BACK_OFFICE_PAGE_SIZE }),
          search: query.search,
        },
      }
    },

    viewAccount: async ({ request, viewerId, userId }) => {
      if (!(await authorize({ request, userId: viewerId }))) {
        return NOT_FOUND
      }

      const read = await accounts.describeAccount(userId)

      if (!read.ok) {
        return UNAVAILABLE
      }

      // Un compte que le socle ne connaît pas : **404**, comme une URL inventée.
      if (read.detail === null) {
        return NOT_FOUND
      }

      const memberships = await organizations.membershipsOf(userId)

      if (!memberships.ok) {
        return UNAVAILABLE
      }

      return {
        ok: true,
        view: {
          account: read.detail.account,
          sessions: read.detail.sessions,
          // Relu en base : le pouvoir suit la ligne, pas le jeton (ADR 030).
          superadmin: await roles.isSuperadmin(userId),
          memberships: memberships.memberships,
        },
      }
    },

    viewOrganizations: async ({ request, viewerId, query }) => {
      if (!(await authorize({ request, userId: viewerId }))) {
        return NOT_FOUND
      }

      const window = pageWindowOf({ page: query.page, pageSize: BACK_OFFICE_PAGE_SIZE })
      const read = await organizations.listOrganizations({ search: query.search, ...window })

      if (!read.ok) {
        return UNAVAILABLE
      }

      return {
        ok: true,
        view: {
          organizations: read.organizations,
          total: read.total,
          page: query.page,
          pageCount: pageCountOf({ total: read.total, pageSize: BACK_OFFICE_PAGE_SIZE }),
          search: query.search,
        },
      }
    },

    viewOrganization: async ({ request, viewerId, organizationId }) => {
      if (!(await authorize({ request, userId: viewerId }))) {
        return NOT_FOUND
      }

      const read = await organizations.describeOrganization(organizationId)

      if (!read.ok) {
        return UNAVAILABLE
      }

      return read.detail === null ? NOT_FOUND : { ok: true, view: read.detail }
    },

    revokeAccountSession: async ({ actorId, userId, sessionId }) => {
      const revoked = await accounts.revokeSession({ userId, sessionId })

      if (!revoked.ok) {
        return { ok: false }
      }

      if (revoked.revoked) {
        securityLog({ event: 'admin.session_revoked', actor: actorId, target: userId })
      }

      return revoked
    },

    sendPasswordReset: async ({ actorId, userId }) => {
      const asked = await accounts.sendPasswordReset({ userId })

      if (asked.ok && asked.sent) {
        securityLog({ event: 'admin.password_reset_sent', actor: actorId, target: userId })
      }

      return asked
    },

    endExpiredImpersonations: async (at) => {
      const swept = await accounts.sweepExpiredImpersonations(at)

      if (!swept.ok) {
        return 0
      }

      logEndedImpersonations(swept.ended)

      return swept.ended.length
    },
  }
}
