import { MODULE_ROUTE_PREFIX } from '@repo/core'
import type { Mailer } from '@repo/ports'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { betterAuth } from 'better-auth/minimal'
import { magicLink } from 'better-auth/plugins/magic-link'

import { createAuthUseCases } from '../application/auth-use-cases'
import type { AuthService } from '../application/auth-service'
import type { AuthDependencies, SecurityLog } from '../application/ports'
import { defaultAuthPolicy, type AuthPolicy } from '../domain/auth-policy'
import { tokenIdentifier } from '../domain/one-time-token'
import { sessionOf } from '../domain/session'
import { authAccount, authSession, authUser, authVerification } from '../schema'
import { consoleSecurityLog } from './console-security-log'
import {
  createDrizzleAuthSessionRepository,
  createDrizzleAuthUserRepository,
  createDrizzleVerificationTokenRepository,
  type AuthDatabase,
} from './drizzle-auth-repositories'
import { createTokenFactory } from './token-factory'

/**
 * **La frontière entre Better Auth et ce dépôt**, en un seul fichier.
 *
 * Une bibliothèque d'authentification veut posséder quatre choses : son schéma,
 * ses emails, ses routes et sa session. Chacune a déjà un propriétaire ici, et
 * ce fichier est l'endroit où on le lui dit :
 *
 * | Ce qu'elle veut posséder | Qui le possède | Comment c'est tenu |
 * |---|---|---|
 * | le schéma | le module (`src/schema.ts`), généré par le baril de s04 | `database: drizzleAdapter(db, { schema })` — elle reçoit nos tables et n'en crée aucune |
 * | les emails | le port `Mailer` de s06 | ses trois crochets d'envoi appellent les cas d'usage ; **aucun** client d'email n'existe de son côté |
 * | les routes | le registre (ADR 007) | `presentation/auth-routes.ts` énumère les chemins ; rien d'autre n'est joignable |
 * | la session | `resolveSession` du répartiteur | le crochet ci-dessous, branché par `apps/web` |
 *
 * Ces quatre lignes ne sont pas des intentions : `tests/auth.test.ts` mesure
 * les trois premières (tables réellement créées, `fetch` sortant pendant tous
 * les parcours, attributs du cookie effectivement posé).
 */

export interface ConfigureAuthOptions {
  /** Connexion Drizzle, fournie par le point de composition (jamais lue ici). */
  readonly db: AuthDatabase
  /** Le port de s06. Le seul chemin d'envoi d'email du module. */
  readonly mailer: Mailer
  /** Secret de signature des sessions et des jetons. */
  readonly secret: string
  /** URL publique de l'application : ce qui rend les liens d'email absolus. */
  readonly appUrl: string
  readonly policy?: AuthPolicy
  readonly locale?: string
  readonly log?: SecurityLog
  readonly now?: () => Date
  /**
   * Ce qui exécute un travail **hors du temps de réponse**.
   *
   * Un seul appelant aujourd'hui, et c'est une règle de sécurité :
   * `/request-password-reset` écrit un jeton puis envoie un email quand le
   * compte existe, et ne fait qu'une lecture factice quand il n'existe pas. Si
   * l'envoi reste dans la réponse, la différence est l'écart de deux appels au
   * fournisseur d'email — mesuré à 119 ms sur un mailer à 120 ms —, et
   * l'existence du compte se lit au chronomètre (`docs/security.md` §7).
   *
   * Par défaut le travail part sans être attendu, et son échec est déjà
   * journalisé par le cas d'usage (`delivery`). Un hébergeur qui gèle le
   * processus après la réponse doit fournir le sien : `waitUntil` sur Vercel,
   * `ctx.waitUntil` sur Cloudflare. C'est aussi ce que la suite injecte, pour
   * savoir quand l'email a atterri.
   */
  readonly runInBackground?: (task: Promise<unknown>) => void
}

/**
 * Les **modèles** de la bibliothèque, rattachés aux tables du module.
 *
 * Une seule déclaration, consommée deux fois : par la configuration de Better
 * Auth et par la carte de schéma de l'adapter Drizzle. `tests/auth.test.ts` s'en
 * sert pour confronter les champs attendus par la bibliothèque à ceux que le
 * module déclare — la correspondance n'est donc recopiée nulle part.
 */
export const AUTH_MODELS = {
  user: { modelName: 'auth_user' },
  session: { modelName: 'auth_session' },
  account: { modelName: 'auth_account' },
  verification: { modelName: 'auth_verification' },
} as const

/**
 * Les attributs du cookie de session, **imposés** (`docs/security.md` §1 et §2).
 *
 * Better Auth pose par défaut `HttpOnly`, `SameSite=Lax` et `Secure` seulement
 * en production. Le socle est plus strict sur les deux derniers points :
 * `SameSite=Strict` pour la session, et `Secure` partout — un cookie de session
 * qui voyage en clair sur un réseau de développement est un cookie qu'on
 * apprend à envoyer en clair.
 *
 * `Secure` sur `http://localhost` n'empêche rien : les navigateurs traitent
 * localhost comme une origine sûre, et le parcours Playwright le prouve.
 */
const SESSION_COOKIE_ATTRIBUTES = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
} as const

export function createBetterAuthService(options: ConfigureAuthOptions): AuthService {
  const policy = options.policy ?? defaultAuthPolicy
  const tokenFactory = createTokenFactory()
  const now = options.now ?? (() => new Date())
  const runInBackground =
    options.runInBackground ??
    ((task: Promise<unknown>) => {
      // Le résultat de l'envoi est déjà journalisé par le cas d'usage ; ce
      // `catch` n'est là que pour ne pas laisser un rejet non traité tomber le
      // processus, faute d'appelant pour l'attendre.
      void task.catch(() => {})
    })

  const dependencies: AuthDependencies = {
    users: createDrizzleAuthUserRepository(options.db),
    sessions: createDrizzleAuthSessionRepository(options.db),
    tokens: createDrizzleVerificationTokenRepository(options.db, now),
    tokenFactory,
    mailer: options.mailer,
    log: options.log ?? consoleSecurityLog,
    policy,
    appUrl: options.appUrl,
    locale: options.locale ?? 'fr',
    now,
  }

  const useCases = createAuthUseCases(dependencies)

  /** L'identifiant sous lequel un magic link est stocké : `magic-link:<empreinte>`. */
  const magicLinkIdentifier = async (token: string): Promise<string> =>
    tokenIdentifier('magic-link', await tokenFactory.digest(token))

  const auth = betterAuth({
    appName: 'killer-saas',
    secret: options.secret,
    baseURL: options.appUrl,
    // Le module est monté par le registre, pas par un fichier de route à lui :
    // son chemin de base est celui du répartiteur.
    basePath: `${MODULE_ROUTE_PREFIX}/auth`,
    trustedOrigins: [options.appUrl],
    // Aucun appel sortant : ce dépôt n'envoie pas de télémétrie, et le §5 du
    // socle interdit qu'un secret y transite. Le désactiver explicitement vaut
    // mieux qu'hériter d'un défaut.
    telemetry: { enabled: false },
    database: drizzleAdapter(options.db, {
      provider: 'pg',
      // Les tables du **module**, indexées par le nom de modèle attendu.
      schema: {
        [AUTH_MODELS.user.modelName]: authUser,
        [AUTH_MODELS.session.modelName]: authSession,
        [AUTH_MODELS.account.modelName]: authAccount,
        [AUTH_MODELS.verification.modelName]: authVerification,
      },
      // La consommation atomique d'un jeton s'exécute dans une transaction :
      // sans cela, deux clics simultanés sur le même lien passent tous les deux.
      transaction: true,
    }),
    user: AUTH_MODELS.user,
    account: AUTH_MODELS.account,
    verification: AUTH_MODELS.verification,
    session: {
      ...AUTH_MODELS.session,
      expiresIn: policy.sessionTtlSeconds,
      updateAge: policy.sessionRefreshAfterSeconds,
    },
    advanced: {
      defaultCookieAttributes: SESSION_COOKIE_ATTRIBUTES,
      // Sans ce crochet, `runInBackgroundOrAwait` **attend** la promesse
      // (`dist/context/create-context.mjs`) : l'envoi de l'email de
      // réinitialisation entre alors dans le temps de réponse, et seul le
      // compte existant le paie. La bibliothèque nomme elle-même cette option
      // comme le moyen de différer une « timing-attack mitigation ».
      backgroundTasks: { handler: runInBackground },
    },
    emailAndPassword: {
      enabled: true,
      // Un compte non vérifié n'obtient pas de session : ni à l'inscription
      // (`autoSignIn`), ni à la connexion (`requireEmailVerification`).
      autoSignIn: false,
      requireEmailVerification: true,
      minPasswordLength: policy.passwordMinLength,
      maxPasswordLength: policy.passwordMaxLength,
      resetPasswordTokenExpiresIn: policy.passwordResetTtlSeconds,
      // Réinitialiser un mot de passe révoque les sessions : c'est le sens
      // même du parcours — on le fait quand on a perdu la maîtrise du compte.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        // `url` est ignorée volontairement : voir `sendPasswordResetEmail`.
        await useCases.sendPasswordResetEmail({ to: user.email, token, userId: user.id })
      },
      onPasswordReset: async ({ user }) => {
        await useCases.onPasswordReset(user.id)
      },
    },
    // `emailVerification.sendVerificationEmail` reste **absent**, et c'est un
    // choix de frontière : le jeton de vérification de la bibliothèque est un
    // JWT signé, ni stocké ni consommable — un lien déjà utilisé y répond
    // « c'est bon » au lieu de « ce lien a déjà servi », et rien ne l'invalide
    // avant son expiration. La vérification d'email est donc entièrement à
    // nous (`application/auth-use-cases.ts`), sur le magasin de jetons à usage
    // unique du module.
    emailVerification: { sendOnSignUp: false, sendOnSignIn: false },
    plugins: [
      magicLink({
        expiresIn: policy.magicLinkTtlSeconds,
        // L'inscription passe par le parcours mot de passe : un magic link ne
        // crée pas de compte. Le lien part malgré tout pour une adresse
        // inconnue, sans quoi la réponse distinguerait un compte existant.
        disableSignUp: true,
        // Le jeton est stocké haché, sous le préfixe du module : c'est ce
        // préfixe qui permet d'invalider les jetons frères sans toucher à ceux
        // d'un autre parcours.
        storeToken: { type: 'custom-hasher', hash: magicLinkIdentifier },
        sendMagicLink: async ({ email, url, token }) => {
          await useCases.sendMagicLinkEmail({
            to: email,
            url,
            siblingIdentifier: await magicLinkIdentifier(token),
            // La valeur que le greffon écrit pour un magic link : l'adresse,
            // sérialisée. C'est ce qui rassemble les liens d'un même
            // destinataire — et le parcours « deux liens, le premier refusé »
            // rougit si cette forme change.
            siblingValue: JSON.stringify({ email }),
          })
        },
      }),
    ],
  })

  return {
    policy,
    useCases,

    handle: (request) => auth.handler(request),

    changePassword: async ({ request, currentPassword, newPassword }) =>
      await auth.api.changePassword({
        // `revokeOtherSessions` est imposé ici et **jamais lu du corps** : le
        // socle exige qu'un changement de mot de passe révoque les autres
        // sessions (§2). Transmettre le corps du client lui laisserait décider
        // du contraire.
        body: { currentPassword, newPassword, revokeOtherSessions: true },
        headers: request.headers,
        asResponse: true,
      }),

    resolveSessionId: async (request) => {
      const session = await auth.api.getSession({ headers: request.headers })

      return session === null ? null : session.session.id
    },

    resolveSession: async (request) => {
      const session = await auth.api.getSession({ headers: request.headers })

      if (session === null) {
        return null
      }

      // La règle vit dans le `domain` : un compte non vérifié n'a pas de
      // session, et les rôles arriveront avec s17 sans que ce fichier bouge.
      return sessionOf({
        userId: session.user.id,
        emailVerified: session.user.emailVerified,
        roles: [],
      })
    },
  }
}
