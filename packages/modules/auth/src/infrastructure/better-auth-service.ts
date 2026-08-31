import { MODULE_ROUTE_PREFIX, resolveLocale } from '@repo/core'
import type { Mailer } from '@repo/ports'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { betterAuth } from 'better-auth/minimal'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { magicLink } from 'better-auth/plugins/magic-link'

import { createAuthUseCases } from '../application/auth-use-cases'
import type { AuthService } from '../application/auth-service'
import type { AuthDependencies, SecurityLog } from '../application/ports'
import { defaultAuthPolicy, type AuthPolicy } from '../domain/auth-policy'
import {
  LOCAL_OAUTH_ACCOUNT_ID,
  LOCAL_OAUTH_AUTHORIZE_PATH,
  LOCAL_OAUTH_EMAIL,
  LOCAL_OAUTH_PROVIDER_ID,
  OAUTH_ERROR_PATH,
  OAUTH_PROVIDER_TIMEOUT_REFUSAL,
  oauthProvisioningRefusal,
  type AnyOAuthProviderId,
  type OAuthProviderId,
} from '../domain/oauth'
import { tokenIdentifier } from '../domain/one-time-token'
import { sessionOf } from '../domain/session'
import { authAccount, authSession, authUser, authVerification } from '../schema'
import { consoleSecurityLog } from './console-security-log'
import {
  createDrizzleAuthAccountRepository,
  createDrizzleAuthSessionRepository,
  createDrizzleAuthUserRepository,
  createDrizzleVerificationTokenRepository,
  type AuthDatabase,
} from './drizzle-auth-repositories'
import { createGithubUserInfo } from './github-user-info'
import {
  createBoundedOAuthFetch,
  DEFAULT_OAUTH_CALLBACK_DEADLINE_MS,
  OUTBOUND_TIMED_OUT,
  withDeadline,
  type OAuthOutboundPolicy,
} from './oauth-outbound'
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
  /**
   * Les locales que le projet **sert**, et celle qui décide par défaut.
   *
   * Reçues, jamais lues : le module ne connaît ni `config/i18n.ts`, ni le
   * module `i18n`, ni le cookie qui porte le choix. Il reçoit aussi
   * `readRequestLocale`, qui dit comment lire la langue d'une requête entrante —
   * c'est le point de composition de l'application qui sait où elle est écrite.
   */
  readonly locales?: readonly string[]
  readonly defaultLocale?: string
  readonly readRequestLocale?: (request: Request) => string | null
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
  /**
   * Les fournisseurs externes, **reçus** (s12).
   *
   * Le module ne lit aucune variable d'environnement : c'est le point de
   * composition qui décide qu'un fournisseur est configuré, et qui refuse au
   * démarrage une paire incomplète. Absent, il n'y a pas de fournisseur — donc
   * pas de bouton, pas de rappel joignable, et l'application fonctionne
   * (`docs/reliability.md` §2).
   */
  readonly oauth?: OAuthConfiguration
}

/** Un fournisseur réel et ses identifiants. Les deux, ou rien. */
export interface OAuthProviderCredentials {
  readonly id: OAuthProviderId
  readonly clientId: string
  readonly clientSecret: string
}

export interface OAuthConfiguration {
  readonly providers?: readonly OAuthProviderCredentials[]
  /**
   * Monte le **fournisseur de développement**, sans aucune clé.
   *
   * C'est l'opt-in explicite du socle (`AGENTS.md` : « Every port must be
   * usable locally with no provider key — through an explicit local mode »),
   * sur le modèle d'`EMAIL_LOCAL_CAPTURE`. Il porte son propre identifiant, il
   * ouvre toujours la même adresse, et il n'emprunte l'identité d'aucun
   * fournisseur réel.
   */
  readonly localProvider?: boolean
  /**
   * Ce qui borne les appels sortants vers les fournisseurs
   * (`docs/reliability.md` §3).
   *
   * Absente, la politique par défaut s'applique — elle est écrite dans
   * `infrastructure/oauth-outbound.ts`, pas ici. Le point de composition n'a
   * rien à décider ; ce qui la reçoit est la suite, qui doit pouvoir mesurer un
   * recul sans attendre des secondes.
   */
  readonly outbound?: OAuthOutboundPolicy
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
  const locales = options.locales ?? ['fr']
  const defaultLocale = options.defaultLocale ?? locales[0] ?? 'fr'

  /**
   * La règle unique de langue d'un email, celle de `@repo/core` — la même que
   * l'écran applique à la requête. Une seconde implémentation ferait recevoir
   * un email anglais à qui lit l'application en français.
   */
  const emailLocaleFor = (knownLocale: string | null | undefined): string =>
    resolveLocale({ locales, defaultLocale, candidate: knownLocale })

  /** La langue connue d'une requête entrante, ou `null` : rien n'est deviné. */
  const localeOf = (request: Request | null | undefined): string =>
    emailLocaleFor(
      request == null ? null : (options.readRequestLocale?.(request) ?? null),
    )

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
    accounts: createDrizzleAuthAccountRepository(options.db),
    tokens: createDrizzleVerificationTokenRepository(options.db, now),
    tokenFactory,
    mailer: options.mailer,
    log: options.log ?? consoleSecurityLog,
    policy,
    appUrl: options.appUrl,
    emailLocaleFor,
    now,
  }

  const useCases = createAuthUseCases(dependencies)

  /**
   * La langue lue d'une requête que la bibliothèque nous rend.
   *
   * Elle peut être absente — un appel serveur à serveur, un test —, et c'est
   * alors le destinataire sans langue connue : la locale du site.
   */
  const readLocale = (request: Request | null | undefined): string | null =>
    request == null ? null : (options.readRequestLocale?.(request) ?? null)

  /** L'identifiant sous lequel un magic link est stocké : `magic-link:<empreinte>`. */
  const magicLinkIdentifier = async (token: string): Promise<string> =>
    tokenIdentifier('magic-link', await tokenFactory.digest(token))

  /**
   * Les fournisseurs réels, indexés par leur identifiant.
   *
   * La bibliothèque n'échoue **pas** sur un `clientId` absent : elle se contente
   * d'un avertissement dans le journal (`context/create-context.mjs`). C'est
   * donc le point de composition qui refuse une paire incomplète, au démarrage
   * et en nommant la variable — ici, un fournisseur présent est un fournisseur
   * complet.
   */
  /**
   * **Tout appel sortant du module passe par là** (`docs/reliability.md` §3) :
   * un délai explicite, des reprises qui reculent avec dispersion et plafond,
   * et uniquement sur les échecs transitoires.
   */
  const boundedFetch = createBoundedOAuthFetch(options.oauth?.outbound ?? {})

  /**
   * Les crochets qui **reprennent** les appels de profil d'un fournisseur.
   *
   * Un seul aujourd'hui, et l'absence des autres est mesurée, pas oubliée :
   * GitHub lit `options.getUserInfo` avant ses deux `betterFetch`, donc les deux
   * y passent ; Google, lui, dérive `emailVerified` d'une claim d'ID token
   * vérifiée contre le JWKS du fournisseur (`jose`, `createRemoteJWKSet`) —
   * reprendre son `getUserInfo` reviendrait à réécrire une vérification de
   * signature, ce qui coûterait bien plus qu'il ne rapporte. Ses appels sont
   * bornés par l'échéance du gestionnaire, ci-dessous.
   */
  const providerHooks: Partial<Record<OAuthProviderId, Record<string, unknown>>> = {
    github: { getUserInfo: createGithubUserInfo(boundedFetch) },
  }

  const socialProviders: Partial<
    Record<OAuthProviderId, { readonly clientId: string; readonly clientSecret: string }>
  > = {}

  for (const provider of options.oauth?.providers ?? []) {
    socialProviders[provider.id] = {
      clientId: provider.clientId,
      clientSecret: provider.clientSecret,
      ...providerHooks[provider.id],
    }
  }

  const localProviderEnabled = options.oauth?.localProvider === true
  const callbackDeadlineMs =
    options.oauth?.outbound?.callbackDeadlineMs ?? DEFAULT_OAUTH_CALLBACK_DEADLINE_MS

  /**
   * Le fournisseur de **développement**, monté par le drapeau explicite.
   *
   * `genericOAuth` de 1.7.2 passe par les points d'entrée standard
   * (`/sign-in/social`, `/callback/:id`) : il n'ajoute aucune route à la
   * bibliothèque. Ses deux crochets remplacent les **appels réseau** — il n'y a
   * donc ni point de terminaison de jeton ni `userinfo` à héberger, et la seule
   * URL réellement visitée par le navigateur est l'autorisation, servie par le
   * module.
   */
  const localOAuthPlugins = localProviderEnabled
    ? [
        genericOAuth({
          config: [
            {
              providerId: LOCAL_OAUTH_PROVIDER_ID,
              clientId: LOCAL_OAUTH_PROVIDER_ID,
              authorizationUrl: `${options.appUrl}${MODULE_ROUTE_PREFIX}${LOCAL_OAUTH_AUTHORIZE_PATH}`,
              getToken: async () => await Promise.resolve({ accessToken: LOCAL_OAUTH_ACCOUNT_ID }),
              getUserInfo: async () =>
                await Promise.resolve({
                  id: LOCAL_OAUTH_ACCOUNT_ID,
                  email: LOCAL_OAUTH_EMAIL,
                  name: LOCAL_OAUTH_EMAIL,
                  // Le fournisseur de développement atteste son adresse : elle
                  // est réservée aux tests et n'appartient à personne.
                  emailVerified: true,
                }),
            },
          ],
        }),
      ]
    : []

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
    socialProviders,
    /**
     * **Où atterrit un retour en échec dont l'état n'a pas pu être lu.**
     *
     * Sans cela, la bibliothèque redirige vers `${baseURL}/error` — une page
     * qui n'existe pas ici — avec le code d'erreur dans l'URL. La route du
     * module replie ce code sur l'une des deux classes que le visiteur a le
     * droit de connaître (`docs/security.md` §7).
     */
    onAPIError: { errorURL: `${MODULE_ROUTE_PREFIX}${OAUTH_ERROR_PATH}` },
    user: {
      ...AUTH_MODELS.user,
      /**
       * **La moitié « fournisseur » de la double preuve**, branchée au seul
       * endroit qui voit les trois actions — création, liaison, retour d'un
       * compte déjà lié (`db/internal-adapter.mjs`, `oauth2/link-account.mjs`).
       *
       * Le crochet échoue fermé : la bibliothèque traite une exception comme un
       * refus. La règle, elle, vit dans le `domain` et n'y est écrite qu'une
       * fois.
       */
      validateUserInfo: ({ user, source }) => {
        const refusal = oauthProvisioningRefusal({
          method: source.method,
          action: source.action,
          providerAssertsEmail: user.emailVerified === true,
        })

        return refusal === null ? undefined : { error: refusal }
      },
    },
    account: {
      ...AUTH_MODELS.account,
      /**
       * **La liaison de compte, épinglée** — et non laissée aux défauts.
       *
       * Les trois lignes disent la même chose sous trois angles : une adresse
       * ne prouve la propriété d'un compte que si **deux** parties l'attestent.
       *
       * - `trustedProviders: []` — aucun fournisseur n'est cru sur parole.
       *   Ajouter un identifiant ici ferait sauter l'exigence
       *   `email_verified` **de ce fournisseur** (`oauth2/link-account.mjs`) ;
       * - `requireLocalEmailVerified` — un compte mot de passe **non vérifié**
       *   ne peut pas capter une identité de fournisseur. C'est la défense
       *   contre le pré-enregistrement : l'attaquant qui inscrit l'adresse de
       *   la victime avant elle n'obtient rien ;
       * - `allowDifferentEmails: false` — une liaison ne rapproche que deux
       *   fois la même adresse.
       *
       * Les défauts de la bibliothèque coïncident aujourd'hui avec ces trois
       * valeurs, et `requireLocalEmailVerified` y est même annoncé comme
       * bientôt inconditionnel. Un défaut qu'aucun test ne tient est un défaut
       * qui change à la prochaine montée de version : ils sont donc écrits.
       *
       * **Ce qui mord, mesuré ligne par ligne** — et les deux lignes vertes ne
       * le sont **pas pour la même raison**. La version précédente de ce
       * commentaire les attribuait toutes deux au crochet « qui refuse plus
       * tôt » : relu dans le paquet installé, c'est faux dans les deux cas.
       *
       * - `requireLocalEmailVerified: false` fait rougir 1 cas — le
       *   pré-enregistrement ;
       * - `trustedProviders: ['github']` n'en fait rougir aucun **seul**, mais
       *   sa porte s'évalue **avant** le crochet, pas après : dans
       *   `oauth2/link-account.mjs`, la condition de refus est ligne ~83 et
       *   `assertValidUserInfo` ligne ~92. Ce sont deux filets indépendants,
       *   chacun suffisant ; les neutraliser **ensemble** fait rougir 2 cas ;
       * - `allowDifferentEmails: true` n'en fait rougir aucun parce que la
       *   valeur n'est lue que par `api/routes/callback.mjs:177` (branche
       *   `link` de l'état) et `api/routes/account.mjs:213` (`/link-social`) —
       *   le parcours de liaison explicite, que ce module **ne déclare pas**.
       *   Le chemin est injoignable ; le crochet, lui, ne voit jamais ce cas.
       *   La ligne reste écrite comme interdit lisible, et la story qui
       *   déclarera `/link-social` devra la couvrir par un test.
       */
      accountLinking: {
        enabled: true,
        trustedProviders: [],
        requireLocalEmailVerified: true,
        allowDifferentEmails: false,
      },
    },
    verification: AUTH_MODELS.verification,
    session: {
      ...AUTH_MODELS.session,
      expiresIn: policy.sessionTtlSeconds,
      updateAge: policy.sessionRefreshAfterSeconds,
    },
    advanced: {
      defaultCookieAttributes: SESSION_COOKIE_ATTRIBUTES,
      /**
       * **Le cookie d'état de la boucle OAuth**, et la seule exception au
       * `SameSite=Strict` du socle.
       *
       * Il est posé au départ, et **relu au retour du fournisseur** — une
       * navigation inter-sites. `Strict` l'empêcherait de partir, l'état ne
       * pourrait pas être comparé, et **toute** connexion par fournisseur
       * échouerait en `state_security_mismatch` : un refus qui ressemble à une
       * attaque alors que c'est la configuration.
       *
       * `docs/security.md` §1 le permet nommément : « `SameSite=Lax` au
       * minimum ; `SameSite=Strict` **pour la session** ». La session, elle, ne
       * bouge pas. Ce cookie ne porte aucun privilège : il ne vaut que dix
       * minutes, il est signé, il est consommé au retour, et le vérificateur
       * PKCE qu'il accompagne n'a jamais quitté le serveur.
       *
       * Les attributs de `defaultCookieAttributes` sont conservés — `httpOnly`,
       * `secure`, `path` — parce que la bibliothèque les applique avant
       * celui-ci (`cookies/index.mjs`) : seule la valeur nommée est remplacée.
       */
      cookies: { state: { attributes: { sameSite: 'lax' } } },
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
      sendResetPassword: async ({ user, token }, request) => {
        // `url` est ignorée volontairement : voir `sendPasswordResetEmail`.
        await useCases.sendPasswordResetEmail({
          to: user.email,
          token,
          userId: user.id,
          // La bibliothèque transmet la requête entrante en second argument
          // (`dist/api/routes/password.mjs`, mesuré) : c'est là que se lit la
          // langue de celui qui demande, et c'est lui le destinataire.
          knownLocale: readLocale(request),
        })
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
        sendMagicLink: async ({ email, url, token }, context) => {
          await useCases.sendMagicLinkEmail({
            to: email,
            url,
            knownLocale: readLocale(context?.request),
            siblingIdentifier: await magicLinkIdentifier(token),
            // La valeur que le greffon écrit pour un magic link : l'adresse,
            // sérialisée. C'est ce qui rassemble les liens d'un même
            // destinataire — et le parcours « deux liens, le premier refusé »
            // rougit si cette forme change.
            siblingValue: JSON.stringify({ email }),
          })
        },
      }),
      ...localOAuthPlugins,
    ],
  })

  /** Les fournisseurs réellement montés, dans l'ordre déclaré. */
  const configuredProviders = (options.oauth?.providers ?? []).map(
    (provider): AnyOAuthProviderId => provider.id,
  )
  const oauthProviders: readonly AnyOAuthProviderId[] = localProviderEnabled
    ? [...configuredProviders, LOCAL_OAUTH_PROVIDER_ID]
    : configuredProviders

  return {
    policy,
    useCases,
    oauthProviders,

    handle: (request) => auth.handler(request),

    /**
     * **Le rappel du fournisseur, sous échéance** (`docs/reliability.md` §3).
     *
     * C'est la seconde borne, et elle couvre ce que le module ne peut pas
     * borner appel par appel : l'échange de code de GitHub — dont
     * `validateAuthorizationCode` ne lit aucun crochet d'options — et la
     * vérification d'ID token de Google, faite par `jose` avec son propre
     * `fetch`. Sans elle, un point de terminaison qui pend tient la requête du
     * visiteur ouverte sans limite.
     *
     * L'échéance dépassée rend le **refus générique du module**, pas une
     * exception : le visiteur retombe sur `/sign-in?oauth=failed` comme pour
     * n'importe quel autre échec, et le code d'attente ne lui apprend rien
     * (`docs/security.md` §7).
     */
    handleOAuthCallback: async (request) => {
      const outcome = await withDeadline(auth.handler(request), callbackDeadlineMs)

      if (outcome !== OUTBOUND_TIMED_OUT) {
        return outcome
      }

      return new Response(null, {
        status: 302,
        headers: {
          location: `${MODULE_ROUTE_PREFIX}${OAUTH_ERROR_PATH}?error=${OAUTH_PROVIDER_TIMEOUT_REFUSAL}`,
        },
      })
    },

    localeOf,

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
