import { designatesFirstSuperadmin } from '../domain/platform-role'
import type {
  AccountBanOutcome,
  AdminDependencies,
  BanAccountOutcome,
  GrantOutcome,
  RevokeOutcome,
} from './ports'

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
  /** Journalise un refus d'accès : la réponse ne distingue rien, le journal si. */
  logAccessRefused(actorId: string): void
}

export function createAdminUseCases(dependencies: AdminDependencies): AdminUseCases {
  const { roles, accounts, designatedEmail, securityLog, now } = dependencies

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

    logAccessRefused: (actorId) => {
      securityLog({ event: 'admin.access_refused', actor: actorId, target: null })
    },
  }
}
