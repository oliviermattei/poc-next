import {
  JobFailure,
  MODULE_ROUTE_PREFIX,
  type ModuleExportPayload,
  type ModuleScope,
} from '@repo/core'
import type { SendEmailResult } from '@repo/ports'

import {
  ACCOUNT_PURGE_JOB,
  ACCOUNT_PURGE_JOB_FIELD,
  ACCOUNT_PURGE_JOB_LOCALE,
  confirmsAccount,
  parseAccountDeletion,
} from '../domain/account-deletion'
import { parseBanReason, signInBlockedAmong } from '../domain/ban'
import { impersonationExpiry } from '../domain/impersonation'
import { canUnlinkSignInMethod } from '../domain/oauth'
import { describePasskeys, type DescribedPasskey } from '../domain/passkey'
import { describeSecurityEvent } from '../domain/security-event'
import { describeSessions, type DescribedSession } from '../domain/session'
import {
  tokenIdentifier,
  tokenIdentifierPrefix,
  type TokenPurpose,
} from '../domain/one-time-token'
import { DATA_EXPORT_DOWNLOAD_PATH, DATA_EXPORT_EMAIL_TEMPLATE } from '../domain/data-export'
import { createDataExportUseCases, type DataExportUseCases } from './data-export-use-cases'
import type { AuthDependencies, PasskeyRevocationOutcome, UnlinkOutcome } from './ports'

/**
 * Un moyen de connexion, tel qu'un écran de paramètres l'affiche.
 *
 * `removable` est **la règle, pas une décoration** : elle dit ce que le serveur
 * accepterait. L'écran s'en sert pour ne pas proposer ce qui sera refusé —
 * masquer n'a jamais été une permission (`docs/security.md` §3), et c'est le
 * repository qui refuse, dans la même transaction que la suppression.
 */
/**
 * Ce que rend l'ouverture — ou la fermeture — d'un emprunt de session.
 *
 * Le **jeton** en sort, contrairement à tout le reste du module : il est la
 * session, et il n'a qu'un destinataire, le cookie signé que
 * `infrastructure/` pose. Aucune route ne le met dans un corps de réponse —
 * un jeton rendu à un écran, c'est `HttpOnly` annulé.
 */
export type ImpersonationOutcome =
  | {
      readonly ok: true
      readonly sessionId: string
      readonly token: string
      /** Le compte que la session désigne désormais. */
      readonly userId: string
      /** L'emprunteur, à la fermeture : c'est lui que le journal nomme. */
      readonly actorId?: string
    }
  | { readonly ok: false; readonly error: 'unknown_account' | 'not_impersonating' }

/** Un emprunt terminé, tel que le journal doit le nommer : les deux comptes. */
export interface EndedImpersonation {
  readonly userId: string
  readonly impersonatedBy: string
}

/** Les emprunts d'un lot de sessions effacées — les autres n'en sont pas. */
const endedImpersonationsOf = (
  sessions: readonly { readonly userId: string; readonly impersonatedBy: string | null }[],
): readonly EndedImpersonation[] =>
  sessions.flatMap((session) =>
    session.impersonatedBy === null
      ? []
      : [{ userId: session.userId, impersonatedBy: session.impersonatedBy }],
  )

export interface DescribedSignInMethod {
  readonly id: string
  readonly providerId: string
  readonly createdAt: Date
  readonly removable: boolean
}

/**
 * Les cas d'usage du module.
 *
 * Ils portent les deux règles que la bibliothèque d'authentification ne rend
 * pas :
 *
 * - **tout email part par le port `Mailer`** (s06). Better Auth ne parle à
 *   aucun fournisseur : ses crochets d'envoi arrivent ici, et il n'existe pas
 *   d'autre chemin. C'est ce qui rend le §5 du socle vérifiable — une doublure
 *   d'enregistrement voit *tous* les emails du produit ;
 * - **les jetons à usage unique** : émission, consommation atomique et
 *   invalidation des frères (`docs/security.md` §2), y compris pour les jetons
 *   que la bibliothèque émet elle-même.
 */

/** Identifiants des templates déclarés au contrat. `tests/auth.test.ts` en fige la liste. */
export const AUTH_EMAIL_TEMPLATES = {
  verification: 'verify-email',
  magicLink: 'magic-link',
  passwordReset: 'reset-password',
  /** s34 : la confirmation d'une suppression, envoyée **après** l'effacement. */
  accountDeleted: 'account-deleted',
  /** s34 : la suppression demandée qui n'a pas pu aboutir, et pourquoi. */
  accountDeletionBlocked: 'account-deletion-blocked',
  /** s35 : le lien de téléchargement d'une archive d'export. */
  dataExport: DATA_EXPORT_EMAIL_TEMPLATE,
} as const

export interface IssuedToken {
  readonly token: string
  readonly identifier: string
}

export type EmailChangeOutcome =
  | { readonly status: 'changed'; readonly userId: string; readonly email: string }
  | { readonly status: 'invalid' }

/** Ce qu'un écran de paramètres a le droit de connaître du compte. */
export interface AccountView {
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly emailVerified: boolean
  /** Le second facteur est-il actif (s13) ? L'écran de compte en dépend. */
  readonly twoFactorEnabled: boolean
}

export type VerificationOutcome =
  | { readonly status: 'verified'; readonly userId: string }
  | { readonly status: 'invalid' }

/**
 * La langue **connue du destinataire** d'un email, jointe à chaque envoi.
 *
 * `null` — ou absente — est le cas explicite du destinataire dont rien n'est
 * connu : `emailLocaleFor` rend alors la locale par défaut du site.
 *
 * **Les emails du module partent tous vers la personne qui vient de faire la
 * requête**, donc la langue connue est celle de cette requête. La confirmation
 * de suppression (s34) est le premier dont l'envoi est **différé** : la personne
 * n'est plus devant nous quand il part, et sa langue voyage donc dans la charge
 * utile de la tâche — une **référence**, comme l'identifiant du compte. Sans
 * cela elle serait perdue, et la règle retomberait sur la langue du site
 * (constat F9 de la revue). Une exécution qui n'en porte aucune — l'échéance
 * cron que le contrat impose — retombe légitimement sur celle du site, et
 * demain une invitation partira sans rien savoir de son destinataire : la même
 * règle décidera.
 */
export interface RecipientLocale {
  readonly knownLocale?: string | null
}

export interface AuthUseCases {
  issueToken(input: {
    readonly purpose: TokenPurpose
    readonly value: string
    readonly ttlSeconds: number
  }): Promise<IssuedToken>
  sendVerificationEmail(
    input: { readonly to: string } & RecipientLocale,
  ): Promise<SendEmailResult>
  verifyEmail(token: string): Promise<VerificationOutcome>
  sendMagicLinkEmail(
    input: {
      readonly to: string
      readonly url: string
      readonly siblingIdentifier: string
      readonly siblingValue: string
    } & RecipientLocale,
  ): Promise<SendEmailResult>
  sendPasswordResetEmail(
    input: {
      readonly to: string
      readonly token: string
      readonly userId: string
    } & RecipientLocale,
  ): Promise<SendEmailResult>
  onPasswordReset(userId: string): Promise<void>
  requestEmailChange(
    input: {
      readonly userId: string
      readonly newEmail: string
    } & RecipientLocale,
  ): Promise<SendEmailResult>
  confirmEmailChange(token: string): Promise<EmailChangeOutcome>
  /** Le compte de l'appelant, tel qu'un écran l'affiche. */
  /**
   * L'acteur d'une connexion **déjà authentifiée**, à partir de son adresse
   * (s13).
   *
   * Existe pour une seule raison : quand un second facteur interrompt la
   * connexion, la bibliothèque détruit la session qu'elle venait de créer et
   * ne rend aucun compte dans son corps de réponse. Sans cette lecture, le
   * journal nommerait `anonymous` sur l'événement dont `docs/security.md` §7
   * a le plus besoin — celui qui compte les défis d'un compte.
   *
   * Ce n'est **pas** un oracle d'énumération : le seul appelant s'exécute
   * après que la bibliothèque a validé le mot de passe. Rien n'y mène depuis
   * une adresse inconnue, et aucune route ne l'expose.
   */
  identifyAccount(email: string): Promise<{ readonly userId: string } | null>
  viewAccount(userId: string): Promise<AccountView | null>
  /**
   * Les comptes de plusieurs identifiants, **en une seule lecture**.
   *
   * Un identifiant inconnu n'a pas d'entrée : l'appelant y lit « ce compte
   * n'existe plus », ce dont le centre de notifications a besoin pour afficher
   * une ligne qui nomme quelqu'un de parti (s32, R1).
   */
  viewAccounts(userIds: readonly string[]): Promise<readonly AccountView[]>
  changeName(input: { readonly userId: string; readonly name: string }): Promise<boolean>
  /** Les sessions actives du compte, la courante en tête, sans aucun jeton. */
  listSessions(input: {
    readonly userId: string
    readonly currentSessionId: string | null
  }): Promise<readonly DescribedSession[]>
  /** Révoque une session **du compte appelant**. `false` quand elle n'est pas à lui. */
  revokeSession(input: {
    readonly userId: string
    readonly sessionId: string
  }): Promise<boolean>
  /** Les moyens de connexion du compte, sans jeton ni empreinte (s12). */
  listSignInMethods(userId: string): Promise<readonly DescribedSignInMethod[]>
  /** Retire un moyen de connexion **du compte appelant**, jamais le dernier. */
  unlinkSignInMethod(input: {
    readonly userId: string
    readonly accountId: string
  }): Promise<UnlinkOutcome>
  /** Les passkeys du compte, sans clé publique ni identifiant de justificatif (s14). */
  listPasskeys(userId: string): Promise<readonly DescribedPasskey[]>
  /** Renomme une passkey **du compte appelant**. `false` quand elle n'est pas à lui. */
  renamePasskey(input: {
    readonly userId: string
    readonly passkeyId: string
    readonly name: string
  }): Promise<boolean>
  /** Révoque une passkey **du compte appelant**, jamais le dernier moyen de connexion. */
  revokePasskey(input: {
    readonly userId: string
    readonly passkeyId: string
  }): Promise<PasskeyRevocationOutcome>
  /**
   * **Bannit un compte** (s37a) : la marque, puis la révocation de ses sessions.
   *
   * L'écriture vit dans le socle et pas dans le module `admin` (ADR 058) : le
   * chemin de connexion appartient à `auth`, et il ne peut pas consulter un
   * module qui peut être coupé. C'est la **surface** qui appelle ceci — le
   * back-office — qui est optionnelle.
   *
   * Rend un résultat discriminé, jamais une exception : l'appelant est un
   * module qui doit traduire « ce compte n'existe pas » en une réponse HTTP.
   */
  banAccount(input: {
    readonly userId: string
    readonly reason: unknown
  }): Promise<BanOutcome>
  /** Lève le bannissement, et efface la marque avec lui. */
  unbanAccount(input: { readonly userId: string }): Promise<BanOutcome>
  /**
   * **Parmi ces comptes, ceux qui ne peuvent pas ouvrir de session** (s37b1).
   *
   * Elle existe pour le module `admin`, qui doit compter les superadmins
   * **capables de se connecter** sans lire une table du socle : il part d'un
   * ensemble d'identifiants qu'il possède déjà — les porteurs du rôle — et
   * demande lesquels sont fermés. Ce n'est donc pas une liste de comptes
   * bannis : rien ne se découvre ici qu'on ne nommait déjà.
   */
  signInBlockedAmong(userIds: readonly string[]): Promise<readonly string[]>
  /**
   * **Ouvre une session au nom d'un autre compte** (s37b1), marquée de son
   * emprunteur.
   *
   * Elle n'autorise rien : le droit d'emprunter appartient au module `admin`,
   * qui l'a déjà vérifié quand il appelle. Ce que le socle garantit ici est la
   * forme — une session neuve, jamais la réutilisation de celle en cours, et
   * une échéance courte.
   *
   * `rotates` porte l'identifiant de la session que l'élévation **remplace** :
   * elle est effacée dans la foulée, sans quoi l'ancien identifiant resterait
   * valable et la rotation n'en serait pas une (mesuré en s14 sur l'enrôlement
   * d'une passkey).
   */
  openImpersonation(input: {
    readonly actorId: string
    readonly userId: string
    readonly rotates: string | null
  }): Promise<ImpersonationOutcome>
  /**
   * **Rend la main** : la session empruntée meurt, une session neuve s'ouvre
   * pour l'emprunteur.
   *
   * Aucun jeton n'est conservé nulle part entre les deux — le greffon de la
   * bibliothèque range celui de l'administrateur dans un second cookie signé ;
   * une session neuve évite ce cookie, et fait tourner la session **aux deux
   * bouts** de l'emprunt.
   */
  closeImpersonation(input: { readonly sessionId: string }): Promise<ImpersonationOutcome>
  /**
   * **Les emprunts échus, effacés, et nommés** (s37b1).
   *
   * Une session d'impersonation qui expire sans sortie explicite n'émettrait
   * jamais le second événement du journal : c'est ce balayage qui la compte
   * comme une fin. Rejoué, il ne trouve plus rien et n'émet plus rien —
   * l'effacement *est* l'idempotence (`docs/reliability.md` §1).
   */
  sweepExpiredImpersonations(at: Date): Promise<readonly EndedImpersonation[]>
  /**
   * **Éteint les emprunts tenus par ce compte**, et les nomme (s37b1, revue C3).
   *
   * Appelée quand le compte cesse d'avoir le droit d'emprunter — le retrait du
   * rôle. Le bannissement, lui, passe par `banAccount`, qui ferme tout.
   */
  endBorrowsBy(userId: string): Promise<readonly EndedImpersonation[]>
  /** Qui emprunte cette session, `null` si elle est ordinaire ou inconnue. */
  borrowerOf(sessionId: string): Promise<string | null>
  /**
   * **Demande la suppression de son propre compte** (s34, critères 1, 2 et 9).
   *
   * Elle ne supprime rien : elle vérifie, puis elle **met en file**. Ce
   * découpage n'est pas une commodité, c'est le critère 9 — module de tâches
   * activé, l'effacement sort de la requête ; module coupé, le port l'exécute
   * de façon synchrone dans la requête appelante, et l'appelant ne voit pas la
   * différence.
   *
   * `userId` est **celui de la session**, jamais un identifiant reçu d'un
   * corps : aucun chemin ne supprime le compte d'un autre.
   */
  requestAccountDeletion(
    input: {
      readonly userId: string
      readonly body: unknown
    } & RecipientLocale,
  ): Promise<AccountDeletionOutcome>
  /**
   * **Efface le compte partout, puis confirme** (s34, critères 2, 3, 7 et 8).
   *
   * C'est le corps de la tâche `auth.purge-account`. Elle appelle la purge de
   * **tous** les modules activés pour le périmètre du compte ; le périmètre
   * organisation a son propre appelant, dans le module `organizations`.
   *
   * Elle lève quand la purge échoue — c'est ce que le répartiteur de tâches
   * attend pour reprendre ou pour marquer l'échec —, et elle est **rejouable** :
   * `auth` est purgé en dernier (ADR 029), donc un compte encore là est un
   * compte dont l'effacement n'a pas abouti, et un compte parti n'a plus rien à
   * effacer ni personne à prévenir.
   */
  runAccountPurge(input: { readonly userId: string } & RecipientLocale): Promise<void>
  purgeAccount(scope: ModuleScope): Promise<void>
  exportAccount(scope: ModuleScope): Promise<ModuleExportPayload>
  /**
   * **L'export de ses données** (s35), ou `null` quand rien ne le câble.
   *
   * `null` plutôt qu'une surface qui lève : les routes le lisent pour répondre
   * 404 — une fonctionnalité non montée n'existe pas, elle ne répond pas 500.
   */
  readonly dataExport: DataExportUseCases | null
  log: AuthDependencies['log']
}

/**
 * Ce que rend un bannissement ou sa levée.
 *
 * `revokedSessions` n'est pas décoratif : c'est ce qui rend « bannir révoque
 * les sessions » observable par l'appelant, et par la suite de tests.
 */
export type BanOutcome =
  | {
      readonly ok: true
      readonly revokedSessions: number
      /**
       * Les emprunts que cette révocation vient de terminer (s37b1, revue C3).
       *
       * Le socle ne journalise pas les emprunts — c'est le module `admin` qui
       * tient ce journal —, mais il est le seul à savoir lesquels il a fermés.
       * Les taire ferait un journal avec des débuts sans fin.
       */
      readonly endedImpersonations: readonly EndedImpersonation[]
    }
  | { readonly ok: false; readonly error: 'not_found' | 'invalid_reason' }

/**
 * Ce que rend une demande de suppression.
 *
 * `queued` est **la seule issue heureuse**, et le mot est exact : la mise en
 * file a réussi. Elle ne dit pas que le compte est parti — avec un
 * ordonnanceur, il ne l'est pas encore ; sans lui, il l'est déjà. L'appelant
 * n'a pas à connaître la différence, et une réponse qui prétendrait
 * « supprimé » mentirait dans la moitié des configurations.
 *
 * `sole_owner` porte **les organisations qui bloquent**, nommées : le critère 6
 * demande que le message précise ce qu'il faut faire, et « transférez ou
 * supprimez » sans dire laquelle ne le précise pas.
 */
export type AccountDeletionOutcome =
  | { readonly status: 'queued' }
  | { readonly status: 'invalid_request' }
  | { readonly status: 'confirmation_mismatch' }
  | { readonly status: 'not_found' }
  | { readonly status: 'sole_owner'; readonly organizations: readonly string[] }
  | { readonly status: 'unavailable' }

/** Sépare le sujet d'un changement d'email : compte et adresse visée. */
const EMAIL_CHANGE_SEPARATOR = ' '

export function createAuthUseCases(dependencies: AuthDependencies): AuthUseCases {
  const {
    users,
    sessions,
    accounts,
    passkeys,
    tokens,
    tokenFactory,
    mailer,
    log,
    policy,
    appUrl,
    emailLocaleFor,
    now,
    purgeScope,
    soleOwnerships,
    releaseOrganizations,
    jobs,
  } = dependencies

  /**
   * Une URL absolue vers une route **du module**.
   *
   * Le préfixe vient du registre (`@repo/core`), jamais recopié : c'est lui qui
   * décide où les routes des modules sont montées, et un lien d'email qui le
   * devinerait se casserait le jour où il change.
   */
  const moduleUrl = (path: string): string =>
    new URL(`${MODULE_ROUTE_PREFIX}/auth${path}`, appUrl).toString()

  /** Une URL absolue vers un **écran** de l'application. */
  const screenUrl = (path: string): string => new URL(path, appUrl).toString()

  /**
   * L'export de ses données (s35), **monté seulement s'il est câblé**.
   *
   * Le module ne sait pas construire une archive : elle traverse tous les
   * modules activés, et seul le registre sait lesquels le sont. Sans ce
   * câblage, les routes d'export répondent 404 plutôt que de servir à moitié.
   */
  const dataExport =
    dependencies.dataExport === undefined
      ? null
      : createDataExportUseCases({
          dataExport: dependencies.dataExport,
          jobs: dependencies.jobs,
          users,
          mailer,
          log,
          emailLocaleFor,
          downloadUrl: (token) =>
            new URL(
              `${MODULE_ROUTE_PREFIX}${DATA_EXPORT_DOWNLOAD_PATH}?token=${encodeURIComponent(token)}`,
              appUrl,
            ).toString(),
          now,
        })

  const issueToken: AuthUseCases['issueToken'] = async ({ purpose, value, ttlSeconds }) => {
    const token = tokenFactory.generate()
    const identifier = tokenIdentifier(purpose, await tokenFactory.digest(token))

    await tokens.create({
      identifier,
      value,
      expiresAt: new Date(now().getTime() + ttlSeconds * 1_000),
    })

    return { token, identifier }
  }

  /**
   * Consomme un jeton, puis invalide ses frères.
   *
   * L'ordre est la garantie : consommer d'abord rend l'opération atomique — un
   * second appel concurrent ne trouve plus rien. Invalider ensuite ferme la
   * fenêtre où deux liens du même parcours resteraient valides.
   */
  const consume = async (purpose: TokenPurpose, token: string) => {
    const identifier = tokenIdentifier(purpose, await tokenFactory.digest(token))
    const consumed = await tokens.consume(identifier)

    if (consumed === null) {
      return null
    }

    await tokens.invalidateSiblings({
      prefix: tokenIdentifierPrefix(purpose),
      value: consumed.value,
    })

    return consumed
  }

  return {
    log,

    issueToken,

    sendVerificationEmail: async ({ to, knownLocale }) => {
      const { token } = await issueToken({
        purpose: 'email-verification',
        value: to,
        ttlSeconds: policy.emailVerificationTtlSeconds,
      })

      const url = moduleUrl(`/verify-email?token=${encodeURIComponent(token)}`)
      const result = await mailer.send({
        to,
        template: `auth.${AUTH_EMAIL_TEMPLATES.verification}`,
        // La **seule** règle de langue : celle du destinataire quand elle est
        // connue, celle du site sinon (`docs/stories.md`, critères 5 et 6).
        locale: emailLocaleFor(knownLocale),
        data: { url },
      })

      log(
        describeSecurityEvent({
          event: 'auth.sign_up_succeeded',
          actor: null,
          details: { delivery: result.ok ? 'sent' : result.error.code },
        }),
      )

      return result
    },

    verifyEmail: async (token) => {
      const consumed = await consume('email-verification', token)

      if (consumed === null) {
        log(
          describeSecurityEvent({
            event: 'auth.email_verification_failed',
            actor: null,
            details: { reason: 'invalid_or_consumed' },
          }),
        )

        return { status: 'invalid' }
      }

      const user = await users.findByEmail(consumed.value)

      if (user === null || !(await users.markEmailVerified(user.id))) {
        log(
          describeSecurityEvent({
            event: 'auth.email_verification_failed',
            actor: null,
            details: { reason: 'unknown_account' },
          }),
        )

        return { status: 'invalid' }
      }

      log(describeSecurityEvent({ event: 'auth.email_verified', actor: { userId: user.id } }))

      return { status: 'verified', userId: user.id }
    },

    sendMagicLinkEmail: async ({ to, url, siblingIdentifier, siblingValue, knownLocale }) => {
      // Le magic link est émis par la bibliothèque ; l'invalidation des frères
      // ne l'est pas. Demander un nouveau lien périme les précédents : sans
      // cela, chaque demande laisse un lien vivant de plus dans une boîte.
      await tokens.invalidateSiblings({
        prefix: tokenIdentifierPrefix('magic-link'),
        value: siblingValue,
        exceptIdentifier: siblingIdentifier,
      })

      const result = await mailer.send({
        to,
        template: `auth.${AUTH_EMAIL_TEMPLATES.magicLink}`,
        // La **seule** règle de langue : celle du destinataire quand elle est
        // connue, celle du site sinon (`docs/stories.md`, critères 5 et 6).
        locale: emailLocaleFor(knownLocale),
        data: { url },
      })

      log(
        describeSecurityEvent({
          event: 'auth.magic_link_requested',
          actor: null,
          details: { delivery: result.ok ? 'sent' : result.error.code },
        }),
      )

      return result
    },

    sendPasswordResetEmail: async ({ to, token, userId, knownLocale }) => {
      // **Le lien est reconstruit ici**, il n'est pas celui que la bibliothèque
      // propose : le sien passe par `/reset-password/<jeton>`, un segment
      // dynamique que le contrat de module ne sait pas déclarer (ADR 017) et
      // que le répartiteur refuserait en 404. Le jeton voyage donc en paramètre
      // de requête vers l'écran, qui le repasse à la route déclarée. Le
      // parcours complet est suivi dans `e2e/auth.spec.ts` — c'est ce qui a
      // fait apparaître le lien mort.
      const url = screenUrl(`/reset-password?token=${encodeURIComponent(token)}`)

      const result = await mailer.send({
        to,
        template: `auth.${AUTH_EMAIL_TEMPLATES.passwordReset}`,
        // La **seule** règle de langue : celle du destinataire quand elle est
        // connue, celle du site sinon (`docs/stories.md`, critères 5 et 6).
        locale: emailLocaleFor(knownLocale),
        data: { url },
      })

      log(
        describeSecurityEvent({
          event: 'auth.password_reset_requested',
          actor: { userId },
          details: { delivery: result.ok ? 'sent' : result.error.code },
        }),
      )

      return result
    },

    onPasswordReset: async (userId) => {
      // Le lien consommé invalide les autres liens en cours : la bibliothèque
      // ne supprime que celui qu'elle vient d'utiliser.
      const invalidated = await tokens.invalidateSiblings({
        prefix: tokenIdentifierPrefix('reset-password'),
        value: userId,
      })

      /**
       * **Consommer ce lien prouve la possession de la boîte** — donc l'adresse
       * est vérifiée (s24).
       *
       * Le lien de réinitialisation ne part que vers l'adresse du compte ; le
       * consommer demande de l'avoir lue. C'est exactement la preuve que
       * `verifyEmail` exige, obtenue par un autre chemin, et le greffon
       * magic-link fait déjà de même à la connexion
       * (`revokeUnprovenAccountAccess`, `better-auth@1.7.2`).
       *
       * Sans cela, un compte créé sans que personne ne s'inscrive — celui d'un
       * paiement invité (ADR 047) — resterait non vérifié après avoir défini
       * son mot de passe, et `requireEmailVerification` refuserait sa
       * connexion : un lien qui ne mène nulle part. Le marquage ne peut que
       * rendre une adresse prouvée, jamais l'inverse.
       *
       * **Ce qui rend la phrase ci-dessus vraie est le jeu de greffons monté,
       * et rien d'autre** (constat F1 de la revue de s24). Relevé le
       * 3 septembre 2026 dans `better-auth@1.7.2` en lisant la bibliothèque,
       * `onPasswordReset` a **trois** appelants :
       *
       * | Appelant | Ce qui prouve la possession | Monté ici ? |
       * |---|---|---|
       * | `dist/api/routes/password.mjs:172` | un lien envoyé à l'**adresse** | oui |
       * | `dist/plugins/email-otp/routes.mjs:601` | un code envoyé à l'**adresse** | non |
       * | `dist/plugins/phone-number/routes.mjs:484` | un code envoyé à un **numéro** | non |
       *
       * Le troisième ne prouve rien de la boîte mail. Le jour où une story
       * monte `phoneNumber`, une réinitialisation par téléphone marquerait
       * l'adresse vérifiée, ce commentaire deviendrait faux et **rien ne
       * rougirait** : le cas de `tests/auth.test.ts` passe par le premier
       * appelant. Monter un greffon de réinitialisation supplémentaire oblige
       * donc à rouvrir cette ligne — au minimum pour distinguer la preuve
       * apportée.
       */
      await users.markEmailVerified(userId)

      log(
        describeSecurityEvent({
          event: 'auth.password_reset_succeeded',
          actor: { userId },
          details: { siblingsInvalidated: invalidated },
        }),
      )
    },

    requestEmailChange: async ({ userId, newEmail, knownLocale }) => {
      const { token } = await issueToken({
        purpose: 'email-change',
        value: `${userId}${EMAIL_CHANGE_SEPARATOR}${newEmail}`,
        ttlSeconds: policy.emailVerificationTtlSeconds,
      })

      const url = moduleUrl(`/verify-email-change?token=${encodeURIComponent(token)}`)
      const result = await mailer.send({
        to: newEmail,
        template: `auth.${AUTH_EMAIL_TEMPLATES.verification}`,
        // La **seule** règle de langue : celle du destinataire quand elle est
        // connue, celle du site sinon (`docs/stories.md`, critères 5 et 6).
        locale: emailLocaleFor(knownLocale),
        data: { url },
      })

      log(
        describeSecurityEvent({
          event: 'auth.email_change_requested',
          actor: { userId },
          details: { delivery: result.ok ? 'sent' : result.error.code },
        }),
      )

      return result
    },

    confirmEmailChange: async (token) => {
      const consumed = await consume('email-change', token)

      if (consumed === null) {
        return { status: 'invalid' }
      }

      const [userId, email] = consumed.value.split(EMAIL_CHANGE_SEPARATOR)

      if (userId === undefined || email === undefined || !(await users.changeEmail(userId, email))) {
        return { status: 'invalid' }
      }

      // Changement d'email ⇒ révocation des **autres** sessions
      // (`docs/security.md` §2). Toutes, y compris celle qui a demandé le
      // changement : l'adresse de connexion vient de changer, et rien ne dit
      // que la session en cours est encore celle du propriétaire.
      //
      // **Depuis s37b1, « toutes » inclut les emprunts que ce compte tient**
      // chez autrui : changer son adresse met donc fin à une impersonation en
      // cours, et `sessionsRevoked` la compte. C'est cohérent — le geste dit
      // « je ne suis plus sûr de qui tient cette session » — mais ce n'est pas
      // évident, d'où cette ligne. La fin n'est pas journalisée dans le journal
      // des emprunts : le module `admin` n'est pas dans ce chemin.
      const revoked = await sessions.revokeAllForUser(userId)

      log(
        describeSecurityEvent({
          event: 'auth.email_changed',
          actor: { userId },
          details: { sessionsRevoked: revoked.length },
        }),
      )

      return { status: 'changed', userId, email }
    },

    identifyAccount: async (email) => {
      const user = await users.findByEmail(email)

      return user === null ? null : { userId: user.id }
    },

    viewAccount: async (userId) => {
      const user = await users.findById(userId)

      return user === null
        ? null
        : {
            userId: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            twoFactorEnabled: user.twoFactorEnabled,
          }
    },

    viewAccounts: async (userIds) =>
      (await users.findByIds(userIds)).map((user) => ({
        userId: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
      })),

    changeName: async ({ userId, name }) => await users.changeName(userId, name),

    listSessions: async ({ userId, currentSessionId }) =>
      describeSessions(await sessions.listForUser(userId), currentSessionId),

    listSignInMethods: async (userId) => {
      const methods = await accounts.listForUser(userId)
      // La règle est **une seule** : celle du `domain`. L'écran la reçoit déjà
      // appliquée, il ne la rejoue pas — et le repository la réapplique sous
      // verrou au moment de supprimer.
      //
      // Depuis s14, son entrée compte **aussi les passkeys** : une passkey est
      // un moyen de connexion, et un compte qui n'a qu'un fournisseur plus une
      // passkey doit pouvoir retirer l'un des deux. Aucune seconde règle n'a
      // été écrite ; c'est la même, mieux renseignée.
      const removable = canUnlinkSignInMethod(methods.length + (await passkeys.countForUser(userId)))

      return methods.map((method) => ({ ...method, removable }))
    },

    listPasskeys: async (userId) => {
      const stored = await passkeys.listForUser(userId)
      const removable = canUnlinkSignInMethod(
        stored.length + (await accounts.listForUser(userId)).length,
      )

      return describePasskeys(stored, { removable })
    },

    renamePasskey: async ({ userId, passkeyId, name }) => {
      const renamed = await passkeys.renameForUser({ userId, passkeyId, name })

      log(
        describeSecurityEvent({
          event: renamed ? 'auth.passkey_renamed' : 'auth.passkey_rename_refused',
          actor: { userId },
        }),
      )

      return renamed
    },

    revokePasskey: async ({ userId, passkeyId }) => {
      const outcome = await passkeys.revokeForUser({ userId, passkeyId })

      log(
        describeSecurityEvent({
          event: outcome === 'revoked' ? 'auth.passkey_revoked' : 'auth.passkey_revoke_refused',
          actor: { userId },
          details: { outcome },
        }),
      )

      return outcome
    },

    unlinkSignInMethod: async ({ userId, accountId }) => {
      const outcome = await accounts.unlinkForUser({ userId, accountId })

      log(
        describeSecurityEvent({
          event:
            outcome === 'unlinked' ? 'auth.provider_unlinked' : 'auth.provider_unlink_refused',
          actor: { userId },
          details: { outcome },
        }),
      )

      return outcome
    },

    revokeSession: async ({ userId, sessionId }) => {
      // La révocation est **une suppression de ligne**, portée par le
      // repository avec le propriétaire dans la condition : ce cas d'usage ne
      // relit pas la session pour vérifier à qui elle est, il demande une
      // suppression qui ne peut pas toucher celle d'un autre.
      const revoked = await sessions.revokeForUser({ userId, sessionId })

      log(
        describeSecurityEvent({
          event: revoked ? 'auth.session_revoked' : 'auth.session_revocation_refused',
          actor: { userId },
        }),
      )

      return revoked
    },

    /**
     * **Le bannissement** (s37a), et son ordre — qui est la garantie.
     *
     * 1. la marque est écrite **et commise** : à partir de cet instant, le
     *    crochet de création de session refuse toute nouvelle session, sur tous
     *    les parcours ;
     * 2. les sessions en cours sont révoquées.
     *
     * L'ordre inverse laisserait une fenêtre où une connexion ouverte entre les
     * deux écritures survivrait au bannissement. Révoquer sans marquer serait
     * pire encore : la personne se reconnecte à la seconde suivante.
     */
    banAccount: async ({ userId, reason }) => {
      const parsed = parseBanReason(reason)

      // **Refusé, jamais tronqué** : un motif trop long est une erreur d'usage
      // qui doit remonter à qui l'écrit, pas une valeur que la base raccourcit.
      if (!parsed.ok) {
        return { ok: false, error: 'invalid_reason' }
      }

      const marked = await users.setBanned({
        userId,
        banned: true,
        at: now(),
        reason: parsed.reason,
      })

      if (!marked) {
        return { ok: false, error: 'not_found' }
      }

      // La révocation emporte aussi les emprunts que ce compte **tenait** chez
      // autrui (revue s37b1, C3) : elle rend les lignes, et l'appelant en tire
      // les fins à journaliser.
      const revoked = await sessions.revokeAllForUser(userId)

      return {
        ok: true,
        revokedSessions: revoked.length,
        endedImpersonations: endedImpersonationsOf(revoked),
      }
    },

    openImpersonation: async ({ actorId, userId, rotates }) => {
      const at = now()
      const session = {
        id: tokenFactory.generate(),
        token: tokenFactory.generate(),
        userId,
        impersonatedBy: actorId,
        expiresAt: impersonationExpiry({ at, ttlSeconds: policy.impersonationTtlSeconds }),
        at,
      }

      if (!(await sessions.create(session))) {
        // La clé étrangère a refusé : le compte visé n'existe pas (ou plus).
        return { ok: false, error: 'unknown_account' }
      }

      // **La rotation**, et elle vient après l'ouverture : l'ordre inverse
      // laisserait l'appelant sans aucune session si la création échouait.
      if (rotates !== null) {
        await sessions.deleteById(rotates)
      }

      return { ok: true, sessionId: session.id, token: session.token, userId }
    },

    closeImpersonation: async ({ sessionId }) => {
      const borrowed = await sessions.findById(sessionId)

      if (borrowed === null || borrowed.impersonatedBy === null) {
        return { ok: false, error: 'not_impersonating' }
      }

      const at = now()
      const restored = {
        id: tokenFactory.generate(),
        token: tokenFactory.generate(),
        userId: borrowed.impersonatedBy,
        impersonatedBy: null,
        expiresAt: new Date(at.getTime() + policy.sessionTtlSeconds * 1000),
        at,
      }

      if (!(await sessions.create(restored))) {
        return { ok: false, error: 'unknown_account' }
      }

      await sessions.deleteById(sessionId)

      return {
        ok: true,
        sessionId: restored.id,
        token: restored.token,
        userId: borrowed.userId,
        actorId: borrowed.impersonatedBy,
      }
    },

    sweepExpiredImpersonations: async (at) =>
      (await sessions.deleteExpiredImpersonations(at)).flatMap((session) =>
        session.impersonatedBy === null
          ? []
          : [{ userId: session.userId, impersonatedBy: session.impersonatedBy }],
      ),

    endBorrowsBy: async (userId) => endedImpersonationsOf(await sessions.revokeBorrowsBy(userId)),

    borrowerOf: async (sessionId) => (await sessions.findById(sessionId))?.impersonatedBy ?? null,

    signInBlockedAmong: async (userIds) =>
      // La règle est dans le `domain`, et elle décide aussi du cas qui n'est
      // pas dans la lecture : un identifiant introuvable est **bloqué**.
      signInBlockedAmong({ requested: userIds, accounts: await users.findByIds(userIds) }),

    unbanAccount: async ({ userId }) => {
      const lifted = await users.setBanned({
        userId,
        banned: false,
        at: now(),
        reason: null,
      })

      // Aucune session à révoquer : lever une sanction ne déconnecte personne.
      return lifted
        ? { ok: true, revokedSessions: 0, endedImpersonations: [] }
        : { ok: false, error: 'not_found' }
    },

    /**
     * La rétention du module (ADR 007).
     *
     * Le compte est **effacé**, pas anonymisé : un compte anonyme resterait un
     * moyen de connexion. Un périmètre d'organisation n'efface rien ici — les
     * comptes appartiennent aux personnes, et le module organisations (s15)
     * possède les appartenances.
     */
    requestAccountDeletion: async ({ userId, body, knownLocale }) => {
      // **Zod d'abord, à la frontière** (`docs/security.md` §4) : ce qui suit ne
      // compare que des chaînes bornées.
      const parsed = parseAccountDeletion(body)

      if (!parsed.ok) {
        return { status: 'invalid_request' }
      }

      const user = await users.findById(userId)

      if (user === null) {
        return { status: 'not_found' }
      }

      // **La comparaison est ici, côté serveur.** L'écran peut la refaire pour
      // ne pas promettre ce qui sera refusé ; elle ne remplace pas celle-ci.
      if (!confirmsAccount(parsed.input.confirmation, user.email)) {
        log(
          describeSecurityEvent({
            event: 'auth.account_deletion_refused',
            actor: { userId },
            details: { reason: 'confirmation_mismatch' },
          }),
        )

        return { status: 'confirmation_mismatch' }
      }

      /**
       * **Le dernier propriétaire d'une organisation ne part pas seul**
       * (critère 6). La liste vient du point de composition : ce module ne
       * connaît pas les organisations, et le module qui les porte peut être
       * coupé — auquel cas il n'y a rien à bloquer.
       */
      const blocking = await soleOwnerships(userId)

      if (blocking.length > 0) {
        log(
          describeSecurityEvent({
            event: 'auth.account_deletion_refused',
            actor: { userId },
            details: { reason: 'sole_owner', organizations: blocking.length },
          }),
        )

        return { status: 'sole_owner', organizations: blocking }
      }

      /**
       * **La charge utile ne porte qu'une référence** (`docs/security.md` §5 et
       * la règle posée par la revue de s32) : l'identifiant du compte, jamais
       * son adresse. Elle est écrite chez le fournisseur, relue à l'exécution et
       * souvent journalisée en chemin.
       *
       * La clé d'idempotence est le compte : deux clics ne suppriment pas deux
       * fois. Elle est libérée par le répartiteur quand l'exécution échoue
       * définitivement, ce qui laisse l'opération rejouable.
       */
      const emitted = await jobs.emit({
        job: `auth.${ACCOUNT_PURGE_JOB}`,
        key: `${ACCOUNT_PURGE_JOB}:${userId}`,
        data: {
          [ACCOUNT_PURGE_JOB_FIELD]: userId,
          // **La langue de la demande, retenue ici et pas ailleurs** : c'est le
          // dernier endroit où le destinataire est devant nous. Un code de
          // langue est une référence, il ne nomme personne (constat F9).
          [ACCOUNT_PURGE_JOB_LOCALE]: emailLocaleFor(knownLocale),
        },
      })

      if (!emitted.ok) {
        log(
          describeSecurityEvent({
            event: 'auth.account_deletion_refused',
            actor: { userId },
            details: { reason: emitted.error.code },
          }),
        )

        // Rien n'a été effacé et rien ne le sera : le dire vaut mieux que rendre
        // un accusé de réception pour un travail que personne ne fera.
        return { status: 'unavailable' }
      }

      log(
        describeSecurityEvent({
          event: 'auth.account_deletion_requested',
          actor: { userId },
        }),
      )

      return { status: 'queued' }
    },

    runAccountPurge: async ({ userId, knownLocale }) => {
      /**
       * **L'adresse est retenue avant l'effacement, l'email part après.**
       *
       * La décision est ici parce que c'est ici qu'elle s'exécute, et les deux
       * autres formes ont été écartées :
       *
       * - envoyer **avant** l'effacement enverrait un accusé de réception pour
       *   une opération qui peut encore échouer — le critère 2 impose justement
       *   qu'elle puisse échouer et être rejouée ;
       * - lire l'adresse **après** est impossible : la ligne du compte n'existe
       *   plus, et rien dans le produit ne la porte encore.
       *
       * C'est le précédent de `organizations.purge` (s16, constat F6) appliqué
       * au même problème : lire ce qui désigne une personne **tant que le
       * compte est là**, agir ensuite.
       */
      const user = await users.findById(userId)

      if (user === null) {
        // **Le rejeu, et la preuve qu'il ne fait rien de plus.** `auth` est
        // purgé en dernier (ADR 029) : un compte absent est un compte dont
        // l'effacement a abouti — il n'y a ni purge à refaire, ni second email
        // à envoyer.
        return
      }

      const email = user.email

      /**
       * **Le contrôle du dernier propriétaire est rejoué ici, à l'effacement**
       * (critique de la seconde revue).
       *
       * Il était fait à la **demande**, et là seulement. Or l'effacement est
       * différé — c'est le mécanisme du critère 9, et l'état livré active le
       * module de tâches —, si bien que le monde change entre les deux :
       * demander sa suppression, créer une organisation, puis laisser la tâche
       * s'exécuter laissait une organisation sans aucun propriétaire, que plus
       * personne ne peut administrer et qu'aucune commande ne répare.
       *
       * **Pourquoi refuser plutôt que promouvoir quelqu'un**, puisque les deux
       * fermaient la fenêtre : le critère 6 dit que la personne « doit d'abord
       * transférer ou supprimer », et promouvoir automatiquement prendrait cette
       * décision à sa place **et** à celle du membre promu — qui hériterait sans
       * l'avoir demandé d'une organisation, de sa facturation et de ses données.
       * Ce serait inventer une règle que la story n'a pas.
       *
       * **Ce que la personne vit**, et c'est la contrepartie qu'il fallait
       * payer : sa demande a été acceptée, elle ne sera pas honorée, et elle
       * doit l'apprendre. Un email le lui dit — refuser en silence sur un chemin
       * de droit à l'effacement est le pire des deux mondes.
       */
      const refuseSoleOwnership = async (organizations: readonly string[]): Promise<never> => {
        const notified = await mailer.send({
          to: email,
          template: `auth.${AUTH_EMAIL_TEMPLATES.accountDeletionBlocked}`,
          locale: emailLocaleFor(knownLocale),
          data: {},
        })

        log(
          describeSecurityEvent({
            event: 'auth.account_deletion_refused',
            actor: { userId },
            details: {
              reason: 'sole_owner',
              organizations: organizations.length,
              delivery: notified.ok ? 'sent' : notified.error.code,
            },
          }),
        )

        /**
         * **Définitif, jamais transitoire** (`docs/reliability.md` §3) : rien
         * dans un rejeu ne transfère une organisation à la place de la
         * personne. Le rejouer jusqu'au plafond multiplierait l'échec et
         * l'email.
         */
        throw new JobFailure(
          'invalid_event',
          `le compte est le dernier propriétaire de ${organizations.length} organisation(s) : ` +
            'il doit d’abord les transférer ou les supprimer.',
        )
      }

      /**
       * **Une revendication, pas une lecture** — et c'est ce qui ferme la
       * course (constat F1 de la troisième revue).
       *
       * Une relecture de `soleOwnerships` ici laissait passer **les deux**
       * appelants d'un départ simultané : chacun voit deux propriétaires. Le
       * refus n'arrivait alors qu'à l'intérieur de la purge, dans le module des
       * organisations — c'est-à-dire **après** les modules purgés plus tôt dans
       * l'ordre inverse. Les fichiers du perdant étaient déjà effacés du
       * fournisseur de stockage, définitivement, pendant que son compte
       * survivait et qu'un email lui annonçait que rien n'avait été effacé.
       *
       * `releaseOrganizations` retire les appartenances **ou** refuse, en une
       * transaction, sous le verrou de chaque organisation possédée. Le second
       * appelant recompte sur l'état commis par le premier, se découvre dernier
       * propriétaire, et refuse avant que la purge ne commence.
       *
       * **Ce que cela coûte, dit plutôt que tu**: un effacement qui échoue
       * **après** cette revendication laisse la personne retirée de ses
       * organisations alors que son compte existe encore, jusqu'au rejeu. C'est
       * une étape de la suppression qu'elle a demandée, franchie plus tôt que
       * les autres ; la purge n'a jamais été transactionnelle entre modules, et
       * c'est le rejeu qui répare.
       */
      const blocking = await releaseOrganizations(userId)

      if (blocking.length > 0) {
        await refuseSoleOwnership(blocking)
      }

      const outcome = await purgeScope({ kind: 'user', userId })

      if (!outcome.ok) {
        /**
         * **L'échec interrompt et se nomme.** `JobFailure` est ce qui distingue
         * « réessaye » de « ne réessaye pas » (`docs/reliability.md` §3) : une
         * purge qui échoue pour une autre raison est presque toujours une
         * indisponibilité — base, stockage, fournisseur de paiement —, donc
         * transitoire.
         */
        throw new JobFailure(
          'provider_unavailable',
          `la purge du module « ${outcome.failed} » a échoué : ${outcome.message}`,
        )
      }

      const sent = await mailer.send({
        to: email,
        template: `auth.${AUTH_EMAIL_TEMPLATES.accountDeleted}`,
        // **La langue de la demande**, transportée par la charge utile de la
        // tâche. La règle unique du module décide encore : une exécution qui
        // n'en porte aucune — l'échéance cron que le contrat impose — retombe
        // sur celle du site.
        locale: emailLocaleFor(knownLocale),
        data: {},
      })

      log(
        describeSecurityEvent({
          event: 'auth.account_deleted',
          actor: { userId },
          details: {
            modules: outcome.purged.length,
            delivery: sent.ok ? 'sent' : sent.error.code,
          },
        }),
      )
    },

    purgeAccount: async (scope) => {
      /**
       * **Les demandes d'export du périmètre partent d'abord**, et pour les
       * deux formes de périmètre.
       *
       * La cascade de `requested_by` emporte déjà les demandes d'un compte
       * effacé ; elle n'emporte pas celles d'une **organisation** effacée, dont
       * le périmètre n'est lié à aucune clé étrangère (ADR 018 : `auth` ne
       * référence pas un module qu'il ne requiert pas). L'archive d'une
       * organisation supprimée survivrait donc à sa suppression, et c'est la
       * forme exacte de trou que s34 a fermée trois fois.
       */
      if (dataExport !== null) {
        await dataExport.purgeDataExports(scope)
      }

      if (scope.kind !== 'user') {
        return
      }

      /**
       * **L'adresse d'abord, tant que le compte existe** — le précédent de
       * `organizations.purge` (s16, constat F6), appliqué à la table que la
       * cascade n'atteint pas.
       *
       * `auth_verification` ne référence pas `auth_user` : ses lignes sont
       * désignées par une adresse, pas par un identifiant. Effacer le compte
       * seul laissait donc un jeton de vérification portant l'adresse d'une
       * personne partie — trouvé par le balayage de s34, sur une table que
       * personne n'aurait pensé à citer.
       */
      const user = await users.findById(scope.userId)

      /**
       * **Une fin d'emprunt qui n'est journalisée nulle part, et c'est dit**
       * (seconde revue de s37b1, MINOR-2).
       *
       * Depuis que cette révocation emporte aussi les emprunts que le compte
       * **tient** chez autrui, effacer le compte d'un administrateur en cours
       * d'emprunt y met fin — et le résultat est ici **jeté**, donc aucun
       * `admin.impersonation_ended` ne part. C'est délibéré : ce chemin est une
       * purge, il efface le compte que l'événement nommerait comme acteur, et
       * la cascade de `auth_user` ferme de toute façon les mêmes lignes sans
       * passer par ce code.
       *
       * Ce que le journal des emprunts couvre, et ce qu'il ne couvre pas, se lit
       * dans `packages/modules/admin/AGENTS.md`.
       */
      await sessions.revokeAllForUser(scope.userId)

      if (user !== null) {
        // L'identifiant **et** l'adresse : la valeur d'un changement d'email en
        // attente porte les deux.
        await tokens.deleteNaming({ userId: scope.userId, email: user.email })
      }

      await users.deleteById(scope.userId)
    },

    exportAccount: async (scope) => {
      // La trace des demandes d'export **est** une donnée personnelle : elle
      // dit qui a demandé quoi, et quand. Elle est donc dans l'archive, et la
      // catégorie `data-export` du contrat n'est pas une exception.
      const dataExports = dataExport === null ? [] : await dataExport.listDataExportTraces(scope)

      if (scope.kind !== 'user') {
        return { account: null, dataExports }
      }

      const user = await users.findById(scope.userId)

      return {
        account:
          user === null
            ? null
            : { id: user.id, email: user.email, emailVerified: user.emailVerified },
        activeSessions: await sessions.countForUser(scope.userId),
        dataExports,
      }
    },

    dataExport,
  }
}
