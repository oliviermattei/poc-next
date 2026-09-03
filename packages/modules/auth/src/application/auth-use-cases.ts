import { MODULE_ROUTE_PREFIX, type ModuleExportPayload, type ModuleScope } from '@repo/core'
import type { SendEmailResult } from '@repo/ports'

import { canUnlinkSignInMethod } from '../domain/oauth'
import { describePasskeys, type DescribedPasskey } from '../domain/passkey'
import { describeSecurityEvent } from '../domain/security-event'
import { describeSessions, type DescribedSession } from '../domain/session'
import {
  tokenIdentifier,
  tokenIdentifierPrefix,
  type TokenPurpose,
} from '../domain/one-time-token'
import type { AuthDependencies, PasskeyRevocationOutcome, UnlinkOutcome } from './ports'

/**
 * Un moyen de connexion, tel qu'un écran de paramètres l'affiche.
 *
 * `removable` est **la règle, pas une décoration** : elle dit ce que le serveur
 * accepterait. L'écran s'en sert pour ne pas proposer ce qui sera refusé —
 * masquer n'a jamais été une permission (`docs/security.md` §3), et c'est le
 * repository qui refuse, dans la même transaction que la suppression.
 */
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
 * connu : `emailLocaleFor` rend alors la locale par défaut du site. Aujourd'hui
 * les quatre emails du module partent vers la personne qui vient de faire la
 * requête, donc la langue connue est celle de cette requête ; demain une
 * invitation partira sans rien savoir de son destinataire, et la même règle
 * décidera.
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
  purgeAccount(scope: ModuleScope): Promise<void>
  exportAccount(scope: ModuleScope): Promise<ModuleExportPayload>
  log: AuthDependencies['log']
}

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
