import { MODULE_ROUTE_PREFIX, type ModuleExportPayload, type ModuleScope } from '@repo/core'
import type { SendEmailResult } from '@repo/ports'

import { describeSecurityEvent } from '../domain/security-event'
import { describeSessions, type DescribedSession } from '../domain/session'
import {
  tokenIdentifier,
  tokenIdentifierPrefix,
  type TokenPurpose,
} from '../domain/one-time-token'
import type { AuthDependencies } from './ports'

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

/** Identifiants des trois templates déclarés au contrat. */
export const AUTH_EMAIL_TEMPLATES = {
  verification: 'verify-email',
  magicLink: 'magic-link',
  passwordReset: 'reset-password',
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
}

export type VerificationOutcome =
  | { readonly status: 'verified'; readonly userId: string }
  | { readonly status: 'invalid' }

export interface AuthUseCases {
  issueToken(input: {
    readonly purpose: TokenPurpose
    readonly value: string
    readonly ttlSeconds: number
  }): Promise<IssuedToken>
  sendVerificationEmail(input: { readonly to: string }): Promise<SendEmailResult>
  verifyEmail(token: string): Promise<VerificationOutcome>
  sendMagicLinkEmail(input: {
    readonly to: string
    readonly url: string
    readonly siblingIdentifier: string
    readonly siblingValue: string
  }): Promise<SendEmailResult>
  sendPasswordResetEmail(input: {
    readonly to: string
    readonly token: string
    readonly userId: string
  }): Promise<SendEmailResult>
  onPasswordReset(userId: string): Promise<void>
  requestEmailChange(input: {
    readonly userId: string
    readonly newEmail: string
  }): Promise<SendEmailResult>
  confirmEmailChange(token: string): Promise<EmailChangeOutcome>
  /** Le compte de l'appelant, tel qu'un écran l'affiche. */
  viewAccount(userId: string): Promise<AccountView | null>
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
  purgeAccount(scope: ModuleScope): Promise<void>
  exportAccount(scope: ModuleScope): Promise<ModuleExportPayload>
  log: AuthDependencies['log']
}

/** Sépare le sujet d'un changement d'email : compte et adresse visée. */
const EMAIL_CHANGE_SEPARATOR = ' '

export function createAuthUseCases(dependencies: AuthDependencies): AuthUseCases {
  const { users, sessions, tokens, tokenFactory, mailer, log, policy, appUrl, locale, now } =
    dependencies

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

    sendVerificationEmail: async ({ to }) => {
      const { token } = await issueToken({
        purpose: 'email-verification',
        value: to,
        ttlSeconds: policy.emailVerificationTtlSeconds,
      })

      const url = moduleUrl(`/verify-email?token=${encodeURIComponent(token)}`)
      const result = await mailer.send({
        to,
        template: `auth.${AUTH_EMAIL_TEMPLATES.verification}`,
        locale,
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

    sendMagicLinkEmail: async ({ to, url, siblingIdentifier, siblingValue }) => {
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
        locale,
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

    sendPasswordResetEmail: async ({ to, token, userId }) => {
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
        locale,
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

      log(
        describeSecurityEvent({
          event: 'auth.password_reset_succeeded',
          actor: { userId },
          details: { siblingsInvalidated: invalidated },
        }),
      )
    },

    requestEmailChange: async ({ userId, newEmail }) => {
      const { token } = await issueToken({
        purpose: 'email-change',
        value: `${userId}${EMAIL_CHANGE_SEPARATOR}${newEmail}`,
        ttlSeconds: policy.emailVerificationTtlSeconds,
      })

      const url = moduleUrl(`/verify-email-change?token=${encodeURIComponent(token)}`)
      const result = await mailer.send({
        to: newEmail,
        template: `auth.${AUTH_EMAIL_TEMPLATES.verification}`,
        locale,
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
      const revoked = await sessions.revokeAllForUser(userId)

      log(
        describeSecurityEvent({
          event: 'auth.email_changed',
          actor: { userId },
          details: { sessionsRevoked: revoked },
        }),
      )

      return { status: 'changed', userId, email }
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
          }
    },

    changeName: async ({ userId, name }) => await users.changeName(userId, name),

    listSessions: async ({ userId, currentSessionId }) =>
      describeSessions(await sessions.listForUser(userId), currentSessionId),

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
     * La rétention du module (ADR 007).
     *
     * Le compte est **effacé**, pas anonymisé : un compte anonyme resterait un
     * moyen de connexion. Un périmètre d'organisation n'efface rien ici — les
     * comptes appartiennent aux personnes, et le module organisations (s15)
     * possède les appartenances.
     */
    purgeAccount: async (scope) => {
      if (scope.kind !== 'user') {
        return
      }

      await sessions.revokeAllForUser(scope.userId)
      await users.deleteById(scope.userId)
    },

    exportAccount: async (scope) => {
      if (scope.kind !== 'user') {
        return { account: null }
      }

      const user = await users.findById(scope.userId)

      return {
        account:
          user === null
            ? null
            : { id: user.id, email: user.email, emailVerified: user.emailVerified },
        activeSessions: await sessions.countForUser(scope.userId),
      }
    },
  }
}
