import {
  MODULE_ROUTE_PREFIX,
  resolveLocale,
  type ModuleScope,
  type PurgeModulesOutcome,
} from '@repo/core'
import type { Analytics, AnalyticsResult, EmitJobResult, Jobs, Mailer } from '@repo/ports'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { betterAuth } from 'better-auth/minimal'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { magicLink } from 'better-auth/plugins/magic-link'
import { twoFactor } from 'better-auth/plugins/two-factor'
import { passkey } from '@better-auth/passkey'
import { createOTP } from '@better-auth/utils/otp'
import { symmetricDecrypt } from 'better-auth/crypto'
import { createHmac, randomUUID } from 'node:crypto'

import { createAuthUseCases } from '../application/auth-use-cases'
import { createDataExportTokenSigner } from './data-export-signer'
import { createDrizzleDataExportRepository } from './drizzle-data-export-repository'
import type { AuthService } from '../application/auth-service'
import type { AuthDependencies, DataExportDependencies, SecurityLog } from '../application/ports'
import { SIGN_UP_EVENT } from '../domain/analytics-events'
import { defaultAuthPolicy, type AuthPolicy } from '../domain/auth-policy'
import {
  LOCAL_OAUTH_AUTHORIZE_PATH,
  LOCAL_OAUTH_PROVIDER_ID,
  localOAuthIdentityOfCode,
  OAUTH_ERROR_PATH,
  OAUTH_PROVIDER_TIMEOUT_REFUSAL,
  oauthProvisioningRefusal,
  type AnyOAuthProviderId,
  type OAuthProviderId,
} from '../domain/oauth'
import { digestBackupCode, digestBackupCodes } from '../domain/backup-code'
import { refusesSignIn } from '../domain/ban'
import { serializeSessionCookie } from '../domain/impersonation'
import { signSessionCookieValue } from './session-cookie'
import { withTwoFactorOnEverySignIn } from './two-factor-challenge'
import { withoutBorrowedSessionRefresh } from './session-refresh-adapter'
import {
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  totpStepsToTry,
} from '../domain/two-factor'
import { describeSecurityEvent } from '../domain/security-event'
import { tokenIdentifier } from '../domain/one-time-token'
import { sessionOf } from '../domain/session'
import {
  authAccount,
  authPasskey,
  authSession,
  authTwoFactor,
  authUser,
  authVerification,
} from '../schema'
import { consoleSecurityLog } from './console-security-log'
import {
  createDrizzleAuthAccountRepository,
  createDrizzleAuthPasskeyRepository,
  createDrizzleAuthSessionRepository,
  createDrizzleAuthUserRepository,
  createDrizzleTwoFactorRepository,
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
import { withAtomicBackupCodeConsumption } from './two-factor-adapter'

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
   * **Le port d'analytique** (s39), reçu comme le mailer et le port de tâches.
   *
   * Ce module est du socle, et `analytics` est un module optionnel : il ne peut
   * donc pas l'importer sans inverser la dépendance qui fait toute la
   * modularité. Ce qu'il reçoit est le **port** (`@repo/ports`), dont
   * l'implémentation est décidée par le point de composition — le fournisseur
   * quand une clé existe, un port inerte sinon, et un port inerte aussi quand
   * le module `analytics` est coupé (critère 8).
   *
   * **Fail-closed, comme `jobs` et `purgeScope`** : sans câblage, rien n'est
   * mesuré et la valeur rendue le dit. Un défaut qui rendrait `ok: true`
   * ferait croire à une mesure qui n'a pas eu lieu.
   */
  readonly analytics?: Analytics
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
  /**
   * **L'effacement de tous les modules activés** (s34), reçu du point de
   * composition qui possède le registre.
   *
   * Facultatif ici, et **fail-closed** : absent, la suppression échoue en
   * nommant le câblage manquant plutôt qu'en effaçant à moitié. Le rendre
   * obligatoire aurait rouvert tous les appels de `configureAuth` du dépôt pour
   * une capacité qu'une suite qui mesure la connexion n'utilise pas.
   */
  readonly purgeScope?: (scope: ModuleScope) => Promise<PurgeModulesOutcome>
  /**
   * Les organisations dont un compte est le **dernier propriétaire** (critère
   * 6). Absent, aucune ne bloque : c'est l'état d'un projet dont le module
   * d'organisations est coupé.
   */
  readonly soleOwnerships?: (userId: string) => Promise<readonly string[]>
  /**
   * La revendication atomique du départ (s34, constat F1 de la troisième
   * revue). Absente, rien ne bloque et il n'y a rien à retirer : c'est l'état
   * d'un projet dont le module d'organisations est coupé.
   */
  readonly releaseOrganizations?: (userId: string) => Promise<readonly string[]>
  /**
   * **Les rôles de plateforme d'un compte** (s56), reçus du point de
   * composition qui possède le registre et le module qui les porte.
   *
   * Absente, aucun rôle n'est porté : c'est l'état d'un projet dont le module
   * `admin` est coupé, et c'est le **sens fermé** — un tableau vide refuse
   * toute route réservée à un rôle. Le sens ouvert serait de deviner.
   */
  readonly platformRolesOf?: (userId: string) => Promise<readonly string[]>
  /**
   * Le port d'émission de tâches (s33).
   *
   * **Absent, la suppression de compte est refusée** — `emit` rend
   * `{ok:false, unknown_job}`, la route répond 503, et rien n'est effacé. Ce
   * n'est **pas** le repli synchrone : celui-ci existe, mais il vit dans
   * `apps/web/lib/jobs.ts`, qui rend un port exécutant dans la requête quand le
   * module `jobs` est coupé. Le port est donc toujours fourni par le point de
   * composition, et son absence ici est un câblage manquant, pas une
   * configuration valide.
   *
   * La rédaction précédente promettait l'inverse de ce que fait le défaut, cent
   * cinquante lignes plus bas (constat F3 de la revue) : un composeur qui
   * n'aurait lu que cette surface aurait cru à un repli qui n'existe pas ici.
   */
  readonly jobs?: Jobs
  /**
   * **Ce que l'export de données ne peut pas se procurer** (s35).
   *
   * Absent, les deux routes d'export répondent 404 : la fonctionnalité n'est
   * pas montée à moitié. Le module possède sa table et sa signature ; il ne
   * possède ni le registre — donc pas l'archive —, ni l'appartenance à une
   * organisation. Le port de tâches, lui, est celui du module : `jobs`
   * ci-dessus, un seul pour l'effacement (s34) et pour l'export (s35).
   */
  readonly dataExport?: AppDataExportOptions
}

/** Ce que le point de composition apporte à l'export (s35). */
export type AppDataExportOptions = Pick<
  DataExportDependencies,
  'collectArchive' | 'authorizeOrganization'
> &
  Partial<Pick<DataExportDependencies, 'requests' | 'signer' | 'generateId'>>

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
  /**
   * Le second facteur (s13). Il n'entre pas dans la configuration racine comme
   * les quatre autres — c'est le greffon qui le déclare, par
   * `schema.twoFactor.modelName`. L'option `twoFactorTable`, elle, ne
   * renommerait que la déclaration : les trois lectures du greffon
   * (`index.mjs`, `totp/index.mjs`, `backup-codes/index.mjs`) passent le
   * **nom de modèle** littéral `"twoFactor"` à l'adapter, mesuré dans 1.7.2.
   */
  twoFactor: { modelName: 'auth_two_factor' },
  /**
   * Les passkeys (s14). Comme le second facteur, c'est le greffon qui le
   * déclare — `schema.passkey.modelName` —, et ses sept points d'entrée passent
   * le **nom de modèle** littéral `"passkey"` à l'adapter. Ce greffon
   * n'ajoute **aucune** colonne aux quatre tables du socle : ni sur
   * `auth_user`, ni sur `auth_session`. C'est ce qui le distingue du greffon
   * `organization`, écarté par l'ADR 025 pour la raison inverse.
   */
  passkey: { modelName: 'auth_passkey' },
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

/**
 * **L'emprunteur porté par la ligne de session que la bibliothèque vient de
 * lire** (revue de s37b2, F3).
 *
 * `impersonated_by` est une colonne de **ce dépôt** (ADR 064) : Better Auth ne
 * la déclare pas, et son type de session ne la connaît donc pas. Elle traverse
 * quand même — mesuré en 1.7.2 : l'adapter rend la ligne, et le champ est
 * présent quand il vaut quelque chose, absent sinon.
 *
 * On lit donc ce que la bibliothèque **rend**, sans lui redemander la ligne :
 * c'est la lecture de trop qu'une page authentifiée payait à chaque rendu. Ce
 * qui n'est pas une chaîne non vide vaut « aucun emprunt » — et
 * `tests/admin.test.ts` mesure l'inverse contre une vraie base, si bien qu'une
 * version de la bibliothèque qui cesserait de rendre la colonne fait rougir un
 * cas, au lieu d'éteindre le bandeau d'emprunt en silence.
 */
const borrowerOnRow = (row: object): string | null => {
  const borrower = (row as { readonly impersonatedBy?: unknown }).impersonatedBy

  return typeof borrower === 'string' && borrower !== '' ? borrower : null
}

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

  const twoFactorRepository = createDrizzleTwoFactorRepository(options.db)

  const dependencies: AuthDependencies = {
    users: createDrizzleAuthUserRepository(options.db),
    sessions: createDrizzleAuthSessionRepository(options.db),
    accounts: createDrizzleAuthAccountRepository(options.db),
    passkeys: createDrizzleAuthPasskeyRepository(options.db),
    tokens: createDrizzleVerificationTokenRepository(options.db, now),
    tokenFactory,
    mailer: options.mailer,
    log: options.log ?? consoleSecurityLog,
    policy,
    appUrl: options.appUrl,
    emailLocaleFor,
    now,
    /**
     * **Fail-closed** : sans câblage, la purge ne fait rien et le dit. Une
     * valeur par défaut qui rendrait `ok: true` ferait croire à un effacement
     * qui n'a pas eu lieu, et l'email de confirmation partirait.
     */
    purgeScope:
      options.purgeScope ??
      ((): Promise<PurgeModulesOutcome> =>
        Promise.resolve({
          ok: false,
          purged: [],
          failed: 'auth',
          message:
            'purgeScope n’a pas été fourni : le point de composition de l’application ' +
            'doit brancher purgeModules() sur configureAuth().',
        })),
    soleOwnerships: options.soleOwnerships ?? ((): Promise<readonly string[]> => Promise.resolve([])),
    releaseOrganizations:
      options.releaseOrganizations ?? ((): Promise<readonly string[]> => Promise.resolve([])),
    /**
     * **Le sens fermé, par la valeur** : sans câblage, un compte ne porte aucun
     * rôle et aucune route réservée à un rôle ne s'ouvre.
     */
    platformRolesOf:
      options.platformRolesOf ?? ((): Promise<readonly string[]> => Promise.resolve([])),
    /**
     * **Fail-closed, comme `purgeScope`.** Le repli synchrone existe déjà et
     * n'est pas ici : `lib/jobs.ts` rend un port qui exécute dans la requête
     * quand le module `jobs` est coupé (s33). Le port est donc **toujours**
     * fourni par le point de composition, et son absence est un câblage
     * manquant — pas une configuration valide.
     */
    /**
     * **Fail-closed, comme `jobs`.** Le port est toujours fourni par le point de
     * composition, qui rend un port inerte quand aucune clé n'est configurée ou
     * quand le module `analytics` est coupé. Son absence ici est donc un câblage
     * manquant, pas une configuration valide.
     */
    analytics: options.analytics ?? {
      track: (): Promise<AnalyticsResult> =>
        Promise.resolve({
          ok: false,
          error: {
            code: 'not_configured',
            message:
              'Le port d’analytique n’a pas été fourni : le point de composition de ' +
              'l’application doit brancher appAnalytics() sur configureAuth().',
          },
        }),
      page: (): Promise<AnalyticsResult> =>
        Promise.resolve({
          ok: false,
          error: { code: 'not_configured', message: 'Le port d’analytique n’a pas été fourni.' },
        }),
    },
    jobs: options.jobs ?? {
      emit: (): Promise<EmitJobResult> =>
        Promise.resolve({
          ok: false,
          error: {
            code: 'unknown_job',
            message:
              'Le port de tâches n’a pas été fourni : le point de composition de ' +
              'l’application doit brancher appJobs() sur configureAuth().',
          },
        }),
    },
    /**
     * **L'export de ses données** (s35) — monté seulement si l'application le
     * câble, parce qu'il traverse des modules que `auth` ne connaît pas.
     *
     * Ce qui est construit ici est ce qui appartient à ce module : le magasin
     * sur sa table, et la signature du lien, qui dérive du **secret de
     * l'application** — aucune variable d'environnement de plus. Ce qui vient
     * du point de composition est ce que `auth` ne peut pas savoir : comment
     * construire l'archive de tous les modules activés, qui a le droit
     * d'exporter une organisation, et par où passent les tâches de fond.
     */
    ...(options.dataExport === undefined
      ? {}
      : {
          dataExport: {
            requests: createDrizzleDataExportRepository({ db: options.db }),
            signer: createDataExportTokenSigner(options.secret),
            generateId: () => `dex_${randomUUID()}`,
            ...options.dataExport,
          },
        }),
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

  /**
   * L'empreinte d'un code de secours (s13).
   *
   * HMAC-SHA256 **poivré par le secret de l'application**, et non un SHA-256
   * nu : un code de dix caractères de `a-zA-Z0-9` porte environ 59 bits
   * d'entropie — assez pour se passer d'un dérivateur lent, pas assez pour
   * qu'une table d'empreintes non poivrée soit sans intérêt. Le poivre ne
   * quitte jamais le processus ; il n'est ni stocké à côté de l'empreinte, ni
   * dérivable d'elle.
   *
   * `node:crypto` est ici, dans `infrastructure/`, jamais dans le `domain` —
   * la règle qui décide *quoi* hacher y vit, la primitive est reçue.
   */
  const backupCodeHash = (value: string): string =>
    createHmac('sha256', options.secret).update(value).digest('hex')

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
              // **Le code transporte le créneau d'identité** (s52) : c'est le
              // seul canal entre la route d'autorisation, qui l'a validé, et le
              // profil que la bibliothèque lira. Un jeton fixe rendrait tous les
              // créneaux à la même identité, ce qui est exactement la course
              // que les créneaux suppriment.
              getToken: async ({ code }) => await Promise.resolve({ accessToken: code }),
              getUserInfo: async (tokens) => {
                const identity = localOAuthIdentityOfCode(tokens.accessToken ?? '')

                // Un code que ce fournisseur n'a pas émis n'a pas de profil :
                // `null` fait échouer le retour, il ne se replie pas sur
                // l'identité par défaut.
                return await Promise.resolve(
                  identity === null
                    ? null
                    : {
                        id: identity.accountId,
                        email: identity.email,
                        name: identity.email,
                        // Le fournisseur de développement atteste son adresse :
                        // elle est réservée aux tests et n'appartient à personne.
                        emailVerified: true,
                      },
                )
              },
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
    // **La consommation d'un code de secours passe par une enveloppe** : la
    // comparaison-et-échange de la bibliothèque n'est pas atomique sur
    // PostgreSQL, et deux consommations simultanées du même code réussissaient
    // toutes les deux — mesuré. Voir `infrastructure/two-factor-adapter.ts`.
    // Deux enveloppes, chacune pour **une** forme d'écriture précise : la
    // consommation atomique d'un code de secours (s13), et le renouvellement de
    // fenêtre glissante, qui ne doit jamais prolonger une session empruntée
    // (s37b1, revue C2). Tout le reste passe intact à l'adapter.
    database: withoutBorrowedSessionRefresh(
      options.db,
      withAtomicBackupCodeConsumption(options.db, drizzleAdapter(options.db, {
      provider: 'pg',
      // Les tables du **module**, indexées par le nom de modèle attendu.
      schema: {
        [AUTH_MODELS.user.modelName]: authUser,
        [AUTH_MODELS.session.modelName]: authSession,
        [AUTH_MODELS.account.modelName]: authAccount,
        [AUTH_MODELS.verification.modelName]: authVerification,
        [AUTH_MODELS.twoFactor.modelName]: authTwoFactor,
        [AUTH_MODELS.passkey.modelName]: authPasskey,
      },
      // La consommation atomique d'un jeton s'exécute dans une transaction :
      // sans cela, deux clics simultanés sur le même lien passent tous les deux.
      transaction: true,
    }))),
    socialProviders,
    /**
     * **Le compte banni n'ouvre aucune session** (s37a), et la garde est posée
     * au seul endroit que **tous** les parcours traversent : la création de la
     * ligne de session. Mot de passe, magic link, rappel de fournisseur,
     * passkey, et tout parcours écrit demain y passent — une garde posée dans
     * le gestionnaire de `/sign-in/email` aurait laissé les quatre autres
     * ouverts.
     *
     * Deux différences avec le greffon `admin` de la bibliothèque, que ce dépôt
     * n'adopte pas (ADR 058) :
     *
     * - **le compte est relu par le repository du module**, jamais par
     *   `ctx.context.internalAdapter`. Le greffon commence par
     *   `if (!ctx) return` : sans contexte d'endpoint, il **laisse passer**.
     *   Ici il n'y a pas de contexte à avoir, donc pas de branche ouverte ;
     * - **le refus ne dit pas pourquoi.** Le greffon rend « You have been
     *   banned from this application » : c'est un oracle d'énumération de
     *   comptes, que `docs/security.md` §7 refuse. `UNAUTHORIZED` est réécrit
     *   par la route en `SIGN_IN_REFUSAL`, le refus unique du `domain`, celui
     *   d'un compte inconnu.
     */
    databaseHooks: {
      /**
       * **L'événement de démonstration de s39** : une inscription **réussie**.
       *
       * Il est posé sur `user.create.after`, et cet endroit-là n'est pas un
       * détail : c'est le seul que la bibliothèque atteint **après** que le
       * compte est écrit. Un `before`, ou un appel depuis la route, mesurerait
       * aussi les inscriptions refusées — un mot de passe trop court, une
       * adresse déjà prise —, et l'événement suivrait alors un compte qui
       * n'existe pas.
       *
       * **Il ne porte que l'identifiant.** Ni l'adresse, ni le nom : la charge
       * utile part chez un tiers et y est conservée (`docs/security.md` §5), et
       * l'implémentation du port filtre par-dessus, au dernier point avant le
       * réseau.
       *
       * **Il quitte le temps de réponse** (`runInBackground`), pour la raison
       * qui a fait sortir l'email de réinitialisation : le coût d'un appel
       * réseau ne doit pas s'ajouter à celui d'une inscription. Son échec est
       * une valeur que personne ne lit — un tiers absent dégrade
       * (`docs/reliability.md` §2), il ne casse pas une inscription réussie.
       */
      user: {
        create: {
          after: async (user: { readonly id: string }): Promise<void> => {
            runInBackground(
              dependencies.analytics.track({
                name: SIGN_UP_EVENT,
                distinctId: user.id,
                properties: {},
              }),
            )

            return await Promise.resolve()
          },
        },
      },
      session: {
        create: {
          before: async (session: { readonly userId: string }) => {
            if (refusesSignIn({ banned: await dependencies.users.isBanned(session.userId) })) {
              throw new APIError('UNAUTHORIZED', { message: 'Invalid email or password' })
            }
          },
        },
      },
    },
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
      /**
       * **Le second facteur** (s13), et les quatre valeurs qui ne sont pas
       * héritées d'un défaut.
       *
       * - `schema.twoFactor.modelName` — le nom de la table du module.
       *   L'option `twoFactorTable` ne conviendrait pas : elle renomme la
       *   *déclaration*, mais les trois lectures du greffon
       *   (`index.mjs`, `totp/index.mjs`, `backup-codes/index.mjs`) passent le
       *   nom de **modèle** littéral `"twoFactor"` à l'adapter (mesuré, 1.7.2) ;
       * - `totpOptions` — six chiffres, période de trente secondes, et la
       *   **fenêtre de vérification vaut ±1 période**. Ce n'est pas un choix
       *   ouvert : `totp/index.mjs` appelle `.verify(code)` sans second
       *   argument, et `@better-auth/utils@0.4.2` y met `window = 1` par
       *   défaut. Quatre-vingt-dix secondes d'acceptation, ce que la RFC 6238
       *   §5.2 prévoit pour absorber la dérive d'horloge d'un téléphone. Les
       *   deux bords sont éprouvés dans `tests/auth.test.ts` ;
       * - `backupCodeOptions.storeBackupCodes` — **le stockage haché**. Le
       *   défaut de la bibliothèque est `'encrypted'`, donc réversible : qui
       *   lit la base et connaît le secret retrouve dix mots de passe à usage
       *   unique. `decrypt` est l'identité — la base contient déjà des
       *   empreintes — et la **saisie** est hachée par la route avant
       *   d'arriver ici, si bien que la comparaison de `verifyBackupCode`
       *   porte empreinte contre empreinte. `docs/decisions/028-…` ;
       * - `twoFactorCookieMaxAge` — la durée du défi, prise dans `AuthPolicy`
       *   comme toutes les durées de vie du module, jamais écrite en dur.
       *
       * `skipVerificationOnEnable` reste **faux** (le défaut) : c'est lui qui
       * rend vrai le critère « l'activation exige un code valide pour être
       * confirmée ». Et `otpOptions` reste absent : sans `sendOTP`, le facteur
       * par email n'est jamais proposé, et ses trois points d'entrée ne sont
       * de toute façon pas déclarés par le module.
       */
      withTwoFactorOnEverySignIn(twoFactor({
        schema: { twoFactor: AUTH_MODELS.twoFactor },
        twoFactorCookieMaxAge: policy.twoFactorChallengeTtlSeconds,
        totpOptions: { digits: TOTP_DIGITS, period: TOTP_PERIOD_SECONDS },
        backupCodeOptions: {
          amount: 10,
          length: 10,
          storeBackupCodes: {
            encrypt: (payload) => Promise.resolve(digestBackupCodes(payload, backupCodeHash)),
            decrypt: (stored) => Promise.resolve(stored),
          },
        },
      }), {
        // Le défi posé sur le magic link et sur les rappels de fournisseur est
        // journalisé **ici** : c'est le seul point qui connaisse encore le
        // compte, la réponse n'en portant plus rien. Les routes journalisent
        // les leurs, celle du mot de passe comprise.
        onChallenge: ({ userId, method }) =>
          useCases.log(
            describeSecurityEvent({
              event: 'auth.two_factor_challenged',
              actor: { userId },
              details: { method },
            }),
          ),
      }),
      /**
       * **Les passkeys** (s14), et les trois valeurs qui ne sont pas héritées
       * d'un défaut.
       *
       * - `origin` — **la seule qui ferme une brèche**. Sans elle,
       *   `opts.origin` vaut `null` et les deux vérifications prennent
       *   l'origine attendue dans `ctx.headers.get("origin")`, c'est-à-dire
       *   dans une valeur que l'appelant écrit : la comparaison
       *   `clientDataJSON.origin === expectedOrigin` devient une chaîne du
       *   client contre une autre chaîne du client, et ne peut plus échouer.
       *   `docs/security.md` §4 veut une liste blanche, jamais un paramètre
       *   non validé — ici, l'URL publique de l'application, la même que
       *   `trustedOrigins` ;
       * - `rpID` — l'hôte de cette même URL. C'est déjà ce que
       *   `getRpID(options, baseURL)` calcule par défaut, donc l'écrire ne
       *   ferme rien aujourd'hui : c'est un défaut épinglé, comme les trois
       *   lignes d'`accountLinking` de s12. Le retirer ne fait rougir aucun
       *   cas, et la raison n'est pas « la bibliothèque devine juste » : ce
       *   fichier **épingle** `baseURL` à `appUrl` (plus haut), et le repli lit
       *   `baseURL`. Le vrai repli de la bibliothèque — l'en-tête `Host` et les
       *   en-têtes de proxy, `better-auth/dist/auth/base.mjs` — ne s'arme que
       *   si `baseURL` disparaît, ce qui casserait aussi `trustedOrigins`, les
       *   liens envoyés par email et les URI de rappel OAuth. Ce qui **mord**
       *   est la vérification elle-même — une assertion dont le `rpIdHash` est
       *   celui d'un autre domaine est refusée, et `tests/auth.test.ts` le
       *   mesure ;
       * - `schema.passkey.modelName` — la table du module.
       *
       * **Changer l'hôte d'`APP_URL` invalide toutes les passkeys déjà
       * enregistrées** : le `rpID` est scellé dans le justificatif à
       * l'enrôlement, et le navigateur refuse une cérémonie dont le `rpId`
       * attendu a changé — sans message, et sans migration possible. Avant de
       * déplacer un domaine, prévenir, s'assurer que l'autre moyen de connexion
       * reste utilisable, et faire réenregistrer. Le détail et ce qu'il ne faut
       * pas tenter est dans `packages/modules/auth/AGENTS.md`, section s14.
       *
       * **Ce que ce greffon ne permet pas, et qu'il ne faut pas croire acquis :
       * la vérification de l'utilisateur.** Les deux appels à
       * `@simplewebauthn/server` portent `requireUserVerification: false`, en
       * dur, sans option pour y toucher (1.7.2). Le drapeau `UV` est écrit par
       * l'authentificateur et jamais exigé : une passkey prouve la
       * **possession**, et rien de plus. C'est ce fait-là qui décide de
       * l'ADR 031 — une passkey est un premier facteur, et un compte à second
       * facteur actif reste défié après elle.
       *
       * Aucun appel réseau sortant : la vérification WebAuthn est locale. La
       * porte bornée du module (`oauth-outbound.ts`) n'a rien à couvrir ici.
       */
      passkey({
        rpID: new URL(options.appUrl).hostname,
        rpName: 'killer-saas',
        origin: options.appUrl,
        schema: { passkey: AUTH_MODELS.passkey },
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

  /**
   * L'en-tête `Set-Cookie` d'une session de ce produit.
   *
   * Le **nom** et les **attributs** viennent de la bibliothèque
   * (`auth.$context`), jamais d'une constante recopiée : un cookie de session
   * dont le nom diverge est une session que le résolveur ne voit pas. Seule la
   * signature est reproduite, et un cas la mesure.
   */
  const sessionCookie = async (token: string, maxAgeSeconds: number): Promise<string> => {
    const context = await auth.$context

    return serializeSessionCookie({
      name: context.authCookies.sessionToken.name,
      value: signSessionCookieValue({ token, secret: options.secret }),
      maxAgeSeconds,
      attributes: context.authCookies.sessionToken.attributes,
    })
  }

  const service: AuthService = {
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

    digestBackupCode: (code) => digestBackupCode(code, backupCodeHash),

    /**
     * **La garde de rejeu d'un code TOTP** (revue s13, C3).
     *
     * Appelée après que la bibliothèque a accepté le code : elle ne le vérifie
     * pas une seconde fois, elle lui rend son **compteur**, puis prend ce
     * compteur en base si personne ne l'a pris. Deux faits la rendent exacte :
     *
     * - le secret est déchiffré avec la même clé que le greffon
     *   (`symmetricDecrypt`, `ctx.context.secretConfig` valant le secret quand
     *   il est donné en clair, `context/create-context.mjs:80`) ;
     * - le HOTP est calculé par **la primitive de la bibliothèque elle-même**
     *   (`@better-auth/utils@0.4.2`, version épinglée par `better-auth@1.7.2`),
     *   avec les mêmes `digits` et la même période. Une seconde implémentation
     *   ici pourrait diverger, et une divergence refuserait toutes les
     *   connexions.
     *
     * Aucun compteur trouvé ⇒ `false`. C'est un refus **fermé** : cela veut
     * dire que le code n'appartient à aucune des quatre positions possibles,
     * donc qu'un fait supposé du paquet a changé. Mieux vaut une connexion
     * refusée qu'une garde muette.
     */
    claimTotpStep: async ({ userId, code }) => {
      const stored = await twoFactorRepository.findByUserId(userId)

      if (stored === null) {
        return false
      }

      const secret = await symmetricDecrypt({ key: options.secret, data: stored.secret })
      const otp = createOTP(secret, { digits: TOTP_DIGITS, period: TOTP_PERIOD_SECONDS })

      for (const step of totpStepsToTry(now())) {
        if ((await otp.hotp(step)) === code) {
          return await twoFactorRepository.claimTotpStep({ userId, step })
        }
      }

      return false
    },

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

    /**
     * **Le cookie de l'emprunt**, posé avec le nom et les attributs de la
     * bibliothèque.
     *
     * Rien n'est inventé : `auth.$context` rend `authCookies.sessionToken`,
     * c'est-à-dire exactement le cookie que toutes les autres sessions du
     * produit emploient — donc `HttpOnly`, `Secure` et `SameSite=Strict` du
     * socle. Seule la **signature** est reproduite (`session-cookie.ts`), et un
     * cas la mesure contre le résolveur de la bibliothèque.
     */
    startImpersonation: async ({ request, actorId, userId }) => {
      const opened = await useCases.openImpersonation({
        actorId,
        userId,
        // La session en cours est **remplacée**, pas conservée : c'est la
        // rotation qu'exige `docs/security.md` §2.
        rotates: await service.resolveSessionId(request),
      })

      if (!opened.ok) {
        return { ok: false, error: opened.error }
      }

      return {
        ok: true,
        setCookie: await sessionCookie(opened.token, policy.impersonationTtlSeconds),
        userId: opened.userId,
        actorId,
      }
    },

    stopImpersonation: async ({ request }) => {
      const sessionId = await service.resolveSessionId(request)

      if (sessionId === null) {
        return { ok: false, error: 'not_impersonating' }
      }

      const closed = await useCases.closeImpersonation({ sessionId })

      if (!closed.ok) {
        return { ok: false, error: closed.error }
      }

      return {
        ok: true,
        setCookie: await sessionCookie(closed.token, policy.sessionTtlSeconds),
        // Le compte **emprunté**, et l'emprunteur : le journal les nomme tous
        // les deux, à la fin comme au début.
        userId: closed.userId,
        actorId: closed.actorId ?? '',
      }
    },

    borrowerOf: async (request) => {
      const sessionId = await service.resolveSessionId(request)

      return sessionId === null ? null : await useCases.borrowerOf(sessionId)
    },

    /**
     * **La réinitialisation demandée depuis le back-office** (s37b2).
     *
     * L'adresse est **relue du compte**, à partir de son identifiant : c'est ce
     * qui garde le back-office hors du chemin « je choisis vers quelle boîte
     * part le lien ». Le reste est le parcours ordinaire — le même point
     * d'entrée que le formulaire « mot de passe oublié », donc le même jeton, la
     * même échéance et le même email.
     */
    requestPasswordResetFor: async (userId) => {
      const account = await useCases.describeAccount(userId)

      if (account === null) {
        return false
      }

      // **Le point d'entrée de la bibliothèque, appelé directement** : c'est
      // lui qui fabrique le jeton, pose son échéance et déclenche
      // `sendResetPassword`. Aucune requête n'est forgée — une requête forgée
      // vers une route du module aurait été un répartiteur de plus dans
      // l'application (`tests/module-registry.test.ts`), et un import de la
      // couche `presentation` depuis `infrastructure`, que le lint refuse.
      //
      // **Aucune requête, donc aucune langue de l'appelant** : l'email part
      // dans la langue du site. C'est le bon défaut ici — le destinataire est le
      // titulaire du compte, pas le superadmin qui demande.
      await auth.api.requestPasswordReset({ body: { email: account.email } })

      return true
    },

    /**
     * **La seule lecture de session de ce fichier** (revue de s37b2, F3).
     *
     * Les deux méthodes qui suivent en sont dérivées : elles appelaient chacune
     * `getSession`, si bien qu'une coquille qui pose trois questions payait
     * trois lectures. Une seule les porte.
     */
    resolveActiveSession: async (request) => {
      const resolved = await auth.api.getSession({ headers: request.headers })

      if (resolved === null) {
        return null
      }

      return {
        /**
         * La règle vit dans le `domain` : un compte non vérifié n'a pas de
         * session. Les **rôles de plateforme**, eux, sont **reçus** (s56) : ce
         * module ne connaît pas la table qui les porte, et le point de
         * composition branche la lecture — ou la liste vide, quand aucun module
         * activé ne déclare de protection `role`.
         *
         * Ils sont relus à chaque résolution, jamais portés par le jeton : une
         * révocation mord à l'instant, sans reconnexion.
         */
        session: sessionOf({
          userId: resolved.user.id,
          emailVerified: resolved.user.emailVerified,
          roles: await dependencies.platformRolesOf(resolved.user.id),
        }),
        sessionId: resolved.session.id,
        impersonatedBy: borrowerOnRow(resolved.session),
      }
    },

    resolveSessionId: async (request) =>
      (await service.resolveActiveSession(request))?.sessionId ?? null,

    resolveSession: async (request) =>
      (await service.resolveActiveSession(request))?.session ?? null,
  }

  return service
}
