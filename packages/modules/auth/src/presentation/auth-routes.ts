import { MODULE_ROUTE_PREFIX, type ModuleRoute, type NavigationEntry } from '@repo/core'

import type { AuthService } from '../application/auth-service'
import { describeSecurityEvent } from '../domain/security-event'
import {
  genericSignInRefusal,
  InvalidCredentialsError,
  parseDisplayName,
  parseEmailInput,
  parseSignInInput,
  parseSignUpInput,
  SIGN_IN_REFUSAL,
} from '../domain/credentials'
import {
  parsePasskeyName,
  passkeyRefusal,
  PASSKEY_REFUSAL_STATUS,
} from '../domain/passkey'
import {
  isOAuthProviderId,
  LOCAL_OAUTH_AUTHORIZE_PATH,
  LOCAL_OAUTH_PROVIDER_ID,
  LOCAL_OAUTH_SLOT_PARAM,
  localOAuthIdentity,
  OAUTH_CALLBACK_PROVIDERS,
  OAUTH_ERROR_PATH,
  oauthFailureClass,
  oauthReturnPath,
  type AnyOAuthProviderId,
} from '../domain/oauth'
import { safeRedirectPath } from '../domain/redirect'
import { TWO_FACTOR_CHALLENGE_COOKIES } from '../domain/two-factor'
import {
  TWO_FACTOR_REFUSAL_STATUS,
  TWO_FACTOR_SCREEN,
  twoFactorRefusal,
} from '../domain/two-factor'

/**
 * Les routes du module, **énumérées une par une**.
 *
 * C'est le point de frontière n°3 de la story : une bibliothèque
 * d'authentification veut monter un routeur attrape-tout
 * (`/api/auth/[...all]`). Ici, c'est le registre qui possède les routes (ADR
 * 007 et 017) : chaque point d'entrée est déclaré, avec son chemin exact, sa
 * méthode et son **niveau de protection**. Ce qui n'est pas dans cette liste
 * n'existe pas — le répartiteur répond 404 sans jamais atteindre la
 * bibliothèque, et les dizaines d'endpoints qu'elle expose par ailleurs
 * (`/list-accounts`, `/delete-user`, `/link-social`…) ne sont pas joignables.
 * Les activer sera le travail des stories qui les demandent.
 *
 * Conséquence directe : `sign-out`, `change-password` et `change-email` sont
 * déclarées `authenticated`, donc **le répartiteur refuse avant** que la
 * bibliothèque ne soit appelée. Le refus n'atteint ni la règle, ni la base.
 */

const PATHS = {
  signInSocial: '/auth/sign-in/social',
  oauthError: OAUTH_ERROR_PATH,
  localProviderAuthorize: LOCAL_OAUTH_AUTHORIZE_PATH,
  unlinkProvider: '/auth/unlink-provider',
  signUp: '/auth/sign-up/email',
  signIn: '/auth/sign-in/email',
  magicLink: '/auth/sign-in/magic-link',
  magicLinkVerify: '/auth/magic-link/verify',
  sendVerificationEmail: '/auth/send-verification-email',
  verifyEmail: '/auth/verify-email',
  verifyEmailChange: '/auth/verify-email-change',
  requestPasswordReset: '/auth/request-password-reset',
  resetPassword: '/auth/reset-password',
  signOut: '/auth/sign-out',
  changePassword: '/auth/change-password',
  changeEmail: '/auth/change-email',
  changeName: '/auth/change-name',
  revokeSession: '/auth/revoke-session',
  // s13. Cinq chemins, et **cinq seulement** : le greffon en expose sept.
  // `two-factor/get-totp-uri` rendrait le secret d'un compte déjà activé —
  // celui-ci ne sort qu'une fois, à l'enrôlement de son propriétaire — et
  // `two-factor/send-otp` / `two-factor/verify-otp` appartiennent au facteur
  // par email, que le module ne monte pas. Non déclarés, ils répondent 404
  // sans atteindre la bibliothèque.
  twoFactorEnable: '/auth/two-factor/enable',
  twoFactorVerify: '/auth/two-factor/verify-totp',
  twoFactorBackupCode: '/auth/two-factor/verify-backup-code',
  twoFactorRegenerate: '/auth/two-factor/generate-backup-codes',
  twoFactorDisable: '/auth/two-factor/disable',
  // s14. **Quatre chemins de la bibliothèque, et quatre seulement** : le
  // greffon `passkey` en expose sept. `list-user-passkeys` rend la ligne
  // entière — clé publique, identifiant de justificatif et compteur compris —,
  // `delete-passkey` compte puis supprime hors transaction et ignore la règle
  // du dernier moyen de connexion, `update-passkey` distingue « inconnue » de
  // « pas à vous » (`requireResourceOwnership`, `forbiddenStatus:
  // "UNAUTHORIZED"`), ce que `docs/security.md` §3 refuse. Non déclarés, les
  // trois répondent 404 sans atteindre la bibliothèque, et les deux dernières
  // opérations sont **au module**, ci-dessous.
  passkeyRegisterOptions: '/auth/passkey/generate-register-options',
  passkeyRegister: '/auth/passkey/verify-registration',
  passkeyAuthenticateOptions: '/auth/passkey/generate-authenticate-options',
  passkeyAuthenticate: '/auth/passkey/verify-authentication',
  passkeyRename: '/auth/passkey/rename',
  passkeyRevoke: '/auth/passkey/revoke',
} as const

/** Le chemin public d'une route du module, préfixe de montage compris. */
export const authRoutePath = (path: keyof typeof PATHS): string =>
  `${MODULE_ROUTE_PREFIX}${PATHS[path]}`

const badRequest = (reason: string): Response =>
  Response.json({ error: 'invalid_request', reason }, { status: 400 })

/**
 * Ce que rend une session qui n'est pas celle de l'appelant.
 *
 * **404, jamais 403** (`docs/security.md` §3) : un 403 confirmerait que cet
 * identifiant de session existe. La réponse est donc la même que pour un
 * identifiant inventé, et c'est le journal — pas l'appelant — qui garde la
 * différence.
 */
const notFound = (): Response => Response.json({ error: 'not_found' }, { status: 404 })

/** Une redirection de navigateur : c'est ce qu'un lien cliqué dans un email attend. */
const redirect = (location: string): Response =>
  new Response(null, { status: 302, headers: { location } })

const jsonBody = async (request: Request): Promise<unknown> =>
  await request.json().catch(() => null)

/**
 * Le corps d'une requête, qu'elle vienne d'un `fetch` ou d'un `<form>`.
 *
 * Les boutons de fournisseur (s12) sont des formulaires **sans JavaScript** :
 * leur corps arrive en `application/x-www-form-urlencoded`, pas en JSON. Le
 * reste du module parle JSON, et rien ne change pour lui — un corps illisible
 * vaut toujours `null`.
 */
const submittedBody = async (request: Request): Promise<Record<string, unknown> | null> => {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData().catch(() => null)

    return form === null ? null : Object.fromEntries(form.entries())
  }

  const parsed = await jsonBody(request)

  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
}

/**
 * Ce que rend un chemin dont le fournisseur n'est pas configuré : **exactement
 * ce que rend un chemin non déclaré**.
 *
 * C'est la forme que prend, pour cette story, le critère « aucune route de
 * rappel » : le module `auth` est socle et ne se coupe pas, mais un fournisseur
 * absent ne doit rien laisser voir — même statut, même corps, mêmes en-têtes
 * que le 404 du répartiteur.
 */
const notDeclared = (): Response => Response.json({ error: 'not_found' }, { status: 404 })

/**
 * La réponse de la bibliothèque, rendue **utilisable par un navigateur**.
 *
 * `/sign-in/social` répond `200` avec l'URL d'autorisation dans le corps *et*
 * dans un en-tête `Location` : c'est fait pour un client JavaScript qui lit
 * `url` et navigue lui-même. Un formulaire sans JavaScript, lui, afficherait le
 * JSON. La redirection est donc **faite ici**, et les cookies posés par la
 * bibliothèque — dont l'état de la boucle OAuth — sont recopiés : les perdre
 * rendrait le retour invérifiable.
 */
const asBrowserRedirect = (response: Response): Response => {
  const location = response.headers.get('location')

  if (!response.ok || location === null) {
    return response
  }

  const headers = new Headers({ location })

  for (const cookie of response.headers.getSetCookie()) {
    headers.append('set-cookie', cookie)
  }

  return new Response(null, { status: 302, headers })
}

/**
 * Une requête identique, corps remplacé.
 *
 * Le corps validé est réinjecté plutôt que transmis tel quel : la validation du
 * `domain` ne doit pas pouvoir être contournée par un champ que la
 * bibliothèque lirait et que nous n'aurions pas regardé.
 */
const withBody = (request: Request, body: unknown): Request =>
  new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: JSON.stringify(body),
  })

/**
 * Le même remplacement de corps, mais en **imposant le type de contenu**.
 *
 * Un formulaire envoie `application/x-www-form-urlencoded` ; recopier cet
 * en-tête sur un corps JSON ferait lire à la bibliothèque une chaîne qui n'en
 * est pas une. Les autres en-têtes — dont les cookies — sont conservés.
 */
const withJsonBody = (request: Request, body: unknown): Request => {
  const headers = new Headers(request.headers)

  headers.set('content-type', 'application/json')

  return new Request(request.url, { method: request.method, headers, body: JSON.stringify(body) })
}

/**
 * Les couples `nom=valeur` que la réponse vient de poser, en un en-tête `Cookie`.
 *
 * Aucun **nom** de cookie n'est écrit ici, et c'est délibéré : le nom du cookie
 * de session appartient à la bibliothèque, qui le préfixe. Tous les couples
 * sont rendus tels quels, et c'est le résolveur de session qui reconnaît le
 * sien.
 */
const cookiesSetBy = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((header) => header.split(';')[0]?.trim() ?? '')
    .filter((pair) => pair !== '' && !pair.endsWith('='))
    .join('; ')

/**
 * **L'acteur d'une connexion que la bibliothèque vient d'ouvrir.**
 *
 * Écrit une fois, appelé par les quatre points d'entrée qui ouvrent une session
 * sans corps JSON à relire : les trois rappels de fournisseur et le lien de
 * connexion par email. Rend `null` quand aucune session n'a été posée — c'est
 * alors un échec de connexion, journalisé sans acteur (`docs/security.md` §7 :
 * le journal ne nomme pas un compte que le refus ne reconnaît pas).
 *
 * La session est relue par le **service**, jamais devinée d'un corps ou d'un
 * nom de cookie : une seconde lecture ailleurs serait une seconde vérité.
 */
const actorOfSessionSetBy = async (
  auth: AuthService,
  request: Request,
  response: Response,
): Promise<{ userId: string } | null> => {
  const cookie = cookiesSetBy(response)

  if (cookie === '') {
    return null
  }

  const session = await auth.resolveSession(new Request(request.url, { headers: { cookie } }))

  return session === null ? null : { userId: session.userId }
}

/**
 * **Défait la session que la réponse vient d'ouvrir.**
 *
 * Appelé quand une vérification que la bibliothèque a acceptée est refusée
 * *ensuite* par une règle du module — le rejeu d'un code TOTP. Ne pas recopier
 * les cookies suffirait à ce que le navigateur n'ait rien ; laisser la ligne
 * de session derrière serait une session que personne n'a demandée
 * (`docs/security.md` §2 : la révocation est côté serveur, pas dans une
 * liste).
 */
const revokeSessionSetBy = async (
  auth: AuthService,
  request: Request,
  response: Response,
): Promise<void> => {
  const cookie = cookiesSetBy(response)

  if (cookie === '') {
    return
  }

  const probe = new Request(request.url, { headers: { cookie } })
  const session = await auth.resolveSession(probe)
  const sessionId = await auth.resolveSessionId(probe)

  if (session === null || sessionId === null) {
    return
  }

  await auth.useCases.revokeSession({ userId: session.userId, sessionId })
}

/**
 * Cette connexion a-t-elle été **interrompue par un second facteur** ?
 *
 * La réponse est clonée : la lire consommerait le flux que l'appelant doit
 * encore recevoir. Le marqueur est celui de la bibliothèque
 * (`twoFactorRedirect`), lu **ici et nulle part ailleurs** — il ne ressort
 * jamais tel quel.
 */
const isTwoFactorChallenge = async (response: Response): Promise<boolean> => {
  // 200 pour le formulaire de mot de passe, **302 pour les deux voies qui
  // redirigent** : le magic link et les rappels de fournisseur lancent leur
  // redirection après avoir posé la session, et le crochet du greffon remplace
  // le corps sans changer le statut. Se limiter à `response.ok` laissait ces
  // deux-là passer pour des connexions abouties.
  if (!response.ok && response.status !== 302) {
    return false
  }

  const payload = (await response
    .clone()
    .json()
    .catch(() => null)) as { readonly twoFactorRedirect?: unknown } | null

  return payload?.twoFactorRedirect === true
}

/**
 * Ce que devient une **redirection** interrompue par un second facteur.
 *
 * Les cookies sont recopiés — le défi vient d'être posé et la session vient
 * d'être effacée, perdre l'un ou l'autre rendrait la vérification impossible —
 * et la destination devient l'écran de vérification. La destination d'origine
 * y est reportée en `?next=`, **filtrée deux fois** : une fois ici contre
 * l'origine de la requête, une fois par l'écran (`docs/security.md` §4). Une
 * destination hors du site ne repart donc pas d'ici.
 */
const twoFactorChallengeRedirect = (request: Request, response: Response): Response => {
  const origin = new URL(request.url).origin
  const location = response.headers.get('location') ?? ''
  // `new URL` plutôt que `URL.parse` : ce dernier n'existe qu'à partir de
  // Node 22, et le dépôt déclare `>=20.10.0`. Une destination illisible n'est
  // pas une erreur ici — elle retombe sur le tableau de bord.
  const parsed = (): URL | null => {
    try {
      return location === '' ? null : new URL(location, origin)
    } catch {
      return null
    }
  }

  const requested = parsed()
  const next =
    requested !== null && requested.origin === origin
      ? safeRedirectPath(`${requested.pathname}${requested.search}`, '/')
      : '/'

  return withCookiesOf(
    response,
    redirect(`${TWO_FACTOR_SCREEN}?next=${encodeURIComponent(next)}`),
  )
}

/** Une réponse à nous, portant les cookies que la bibliothèque vient de poser. */
const withCookiesOf = (source: Response, target: Response): Response => {
  const headers = new Headers(target.headers)

  for (const cookie of source.headers.getSetCookie()) {
    headers.append('set-cookie', cookie)
  }

  return new Response(target.body, { status: target.status, headers })
}

/**
 * La réponse d'une vérification de second facteur, **débarrassée de son corps**.
 *
 * Les cookies posés par la bibliothèque sont recopiés — c'est là que vit la
 * session rotée, les perdre reviendrait à ne pas connecter la personne. Le
 * corps, lui, est remplacé : celui de la bibliothèque porte le `token` de la
 * session (`verify-two-factor.mjs`, les deux branches de `valid()`), et un
 * jeton rendu à un écran annule `HttpOnly`.
 */
const withoutSessionToken = (response: Response, body: unknown): Response => {
  const headers = new Headers({ 'content-type': 'application/json' })

  for (const cookie of response.headers.getSetCookie()) {
    headers.append('set-cookie', cookie)
  }

  return new Response(JSON.stringify(body), { status: response.status, headers })
}

/**
 * Ce que devient une vérification de second facteur — **un seul endroit pour
 * les deux facteurs et les deux moments**.
 *
 * Quatre issues, et elles ne se ressemblent pas :
 *
 * | Session à l'entrée | Réponse de la bibliothèque | Ce que c'est |
 * |---|---|---|
 * | oui | succès | une **activation** confirmée : le compte vient d'élever son privilège |
 * | oui | refus | un code faux pendant l'enrôlement |
 * | non | succès | une **connexion** achevée : la session n'existe qu'à partir d'ici |
 * | non | refus | un code faux, ou un défi qui n'existe plus |
 *
 * Le refus est replié sur les deux classes du `domain` : aucun des cinq codes
 * du greffon n'atteint le navigateur (`docs/security.md` §7).
 */
const settleTwoFactorVerification = async (input: {
  readonly auth: AuthService
  readonly request: Request
  readonly response: Response
  readonly session: { readonly userId: string } | null
  readonly method: 'totp' | 'backup_code'
  /** Le code saisi — seul le facteur TOTP en a besoin, pour sa garde de rejeu. */
  readonly code: string
}): Promise<Response> => {
  const { auth, request, response, session, method, code } = input
  const refusal = twoFactorRefusal(response.status)

  if (refusal !== null) {
    auth.useCases.log(
      describeSecurityEvent({
        event: 'auth.two_factor_failed',
        actor: session,
        details: { method, class: refusal.body.error },
      }),
    )

    return Response.json(refusal.body, { status: refusal.status })
  }

  // L'acteur : la session de l'appelant s'il en avait une, sinon celle que la
  // réponse vient de poser — jamais devinée d'un corps ni d'un nom de cookie.
  const actor = session ?? (await actorOfSessionSetBy(auth, request, response))

  // **Un code TOTP ne sert qu'une fois** (critère 4 de la story). La
  // bibliothèque ne mémorise aucun compteur : le code qu'elle vient d'accepter
  // reste valable jusqu'à quatre-vingt-dix secondes, donc rejouable sur un
  // défi neuf par qui l'a vu une fois — épaule, relais d'hameçonnage, capture.
  // Le module prend donc le compteur, et un compteur déjà pris est un refus.
  if (method === 'totp' && actor !== null) {
    const claimed = await auth.claimTotpStep({ userId: actor.userId, code })

    if (!claimed) {
      // La bibliothèque a déjà ouvert la session : elle est défaite ici, et
      // ses cookies ne sont pas recopiés. Sur le chemin de l'enrôlement
      // (session à l'entrée), il n'y a rien à défaire — la première
      // confirmation trouve toujours le compteur libre.
      if (session === null) {
        await revokeSessionSetBy(auth, request, response)
      }

      auth.useCases.log(
        describeSecurityEvent({
          event: 'auth.two_factor_failed',
          actor,
          details: { method, class: 'used', reason: 'replayed_step' },
        }),
      )

      // **Le refus dit la vérité.** Le code présenté est juste ; ce qui le
      // refuse est son compteur, déjà pris. Le confondre avec un code faux
      // faisait afficher « ce code n'est pas valide » à quelqu'un qui lit le
      // bon code sur son téléphone — deuxième connexion dans les mêmes trente
      // secondes, ré-enrôlement dans la même période, horloge reculée — et lui
      // faisait croire à une compromission (revue s13, C12/C13/C14).
      //
      // Ce n'est pas un oracle pour autant : le **statut** est celui de tous
      // les refus, et on n'atteint cette ligne qu'avec un défi ouvert ou une
      // session — donc après avoir prouvé le premier facteur, sur son propre
      // compte (`docs/security.md` §7).
      return Response.json({ error: 'used' }, { status: TWO_FACTOR_REFUSAL_STATUS })
    }
  }

  if (session !== null) {
    // Une session à l'entrée **et le facteur d'application** : c'est
    // l'enrôlement qui se confirme. C'est ici que le second facteur devient
    // actif — pas à `enable`, qui n'écrit qu'un secret non vérifié —, donc
    // c'est ici que `docs/security.md` §7 veut son « changement de second
    // facteur ». Un **code de secours** consommé en session n'active rien : la
    // route est publique, ce chemin existe donc, et le nommer « activation »
    // ferait mentir le journal.
    auth.useCases.log(
      describeSecurityEvent({
        event: method === 'totp' ? 'auth.two_factor_enabled' : 'auth.two_factor_verified',
        actor: session,
        details: { method },
      }),
    )

    return withoutSessionToken(response, { status: true })
  }

  // Pas de session à l'entrée : c'est une connexion qui s'achève.
  auth.useCases.log(
    describeSecurityEvent({
      event: 'auth.two_factor_verified',
      actor,
      details: { method },
    }),
  )

  return withoutSessionToken(response, { status: true })
}

export function createAuthRoutes(service: () => AuthService): readonly ModuleRoute[] {
  const refuseInvalid = async (
    run: () => Promise<Response>,
  ): Promise<Response> => {
    try {
      return await run()
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        return badRequest(error.message)
      }

      throw error
    }
  }

  /**
   * Les rappels OAuth, **un chemin par fournisseur connu**.
   *
   * Le répartiteur apparie les chemins exactement (ADR 017) : le `/callback/:id`
   * de la bibliothèque n'a donc pas de segment dynamique à déclarer, et
   * l'énumération ferme la porte à un identifiant inventé — `/callback/inconnu`
   * n'est dans aucune table.
   *
   * Un fournisseur connu mais **non configuré** garde son chemin et le refuse :
   * la bibliothèque ne trouve pas le fournisseur et renvoie vers la route de
   * normalisation, qui rend le même message générique que n'importe quel autre
   * échec. Aucune session ne s'ouvre — et la réponse est **identique**, statut
   * et destination, à celle du même rappel configuré recevant un état
   * inutilisable : l'état de configuration ne se lit pas de l'extérieur, et
   * `tests/auth.test.ts` compare les deux.
   *
   * Ce qui reste énumérable, et qu'il faut savoir : les identifiants que ce
   * code **connaît**. `/callback/github` a un chemin même sans clé,
   * `/callback/invente` n'en a pas. Le fermer demanderait de construire cette
   * liste depuis les fournisseurs **configurés** — impossible sans changer le
   * montage : `authModule.routes` est matérialisé à l'import de
   * `config/features.ts`, donc par `pnpm ks`, `pnpm db:generate` et le
   * processus Playwright, dont aucun n'a l'environnement validé de
   * l'application. La démonstration est dans
   * `docs/reviews/s12-oauth-signin.md`.
   *
   * Ce n'est pas ce que le plan annonçait — il prévoyait un 404 identique à un
   * chemin non déclaré. La mesure a tranché : `e2e/modules.spec.ts` exige
   * qu'une route publique d'un module activé soit **servie**, et un 404
   * conditionné par la configuration violait cette garde. Assouplir la garde
   * pour faire passer une propriété que la story ne demande pas (le module
   * `auth` est socle, il n'a pas d'état « non activé ») aurait été le mauvais
   * arbitrage : c'est la propriété qui cède.
   */
  const oauthCallbacks: readonly ModuleRoute[] = OAUTH_CALLBACK_PROVIDERS.map(
    (provider: AnyOAuthProviderId) => ({
      method: 'GET',
      path: `/auth/callback/${provider}`,
      protection: { level: 'public' },
      handler: async (request: Request): Promise<Response> => {
        const auth = service()
        // **Sous échéance** : c'est le seul point d'entrée du module qui
        // déclenche des appels sortants (`docs/reliability.md` §3).
        const response = await auth.handleOAuthCallback(request)

        // Même règle que le magic link : le fournisseur atteste l'adresse, il
        // n'atteste pas le second facteur (revue s13, C2).
        if (await isTwoFactorChallenge(response)) {
          return twoFactorChallengeRedirect(request, response)
        }

        // Le retour du fournisseur est **une connexion** : §7 la veut
        // journalisée avec son acteur, comme celle par mot de passe, et son
        // échec sans acteur. Le fournisseur est le seul détail retenu — il
        // n'identifie personne, et c'est lui qui manque quand on cherche
        // pourquoi un moyen de connexion échoue en série.
        const actor = await actorOfSessionSetBy(auth, request, response)

        auth.useCases.log(
          describeSecurityEvent({
            event: actor === null ? 'auth.sign_in_failed' : 'auth.sign_in_succeeded',
            actor,
            details: { provider, method: 'oauth' },
          }),
        )

        return response
      },
    }),
  )

  return [
    ...oauthCallbacks,
    {
      method: 'POST',
      path: PATHS.signInSocial,
      protection: { level: 'public' },
      handler: async (request) => {
        const auth = service()
        const body = await submittedBody(request)
        const provider = body?.provider

        // Un fournisseur inconnu **ou non configuré** n'existe pas : c'est la
        // même réponse qu'un chemin non déclaré, et elle ne dit pas lequel des
        // deux cas s'applique.
        if (!isOAuthProviderId(provider) || !auth.oauthProviders.includes(provider)) {
          // Journalisé, et la **réponse** ne dit toujours rien : c'est le
          // journal qui garde la différence, pas l'appelant (§7). Le nom du
          // fournisseur n'est retenu que s'il est l'un des nôtres — recopier
          // une chaîne reçue du client dans un journal, c'est l'y laisser
          // écrire.
          auth.useCases.log(
            describeSecurityEvent({
              event: 'auth.oauth_refused',
              actor: null,
              details: {
                provider: isOAuthProviderId(provider) ? provider : 'unknown',
                stage: 'start',
              },
            }),
          )

          return notDeclared()
        }

        const destination = safeRedirectPath(
          typeof body?.next === 'string' ? body.next : null,
          '/',
        )

        // **Le corps est reconstruit, jamais transmis.** Celui de la
        // bibliothèque accepte `idToken` — qui ouvre une session sans
        // redirection —, `callbackURL` et `errorCallbackURL`, qui décident où
        // le navigateur atterrit. Les trois valeurs qui comptent sont posées
        // ici : la destination est filtrée par la liste blanche
        // (`docs/security.md` §4), et les deux retours sont des chemins de ce
        // site.
        const response = await auth.handle(
          withJsonBody(request, {
            provider,
            callbackURL: oauthReturnPath(destination),
            errorCallbackURL: `${MODULE_ROUTE_PREFIX}${OAUTH_ERROR_PATH}`,
          }),
        )

        return asBrowserRedirect(response)
      },
    },
    {
      method: 'GET',
      path: PATHS.oauthError,
      protection: { level: 'public' },
      handler: (request) => {
        // **Le code de la bibliothèque s'arrête ici.** `account_not_linked`
        // dirait qu'un compte existe à cette adresse, `email_not_found` dirait
        // le contraire : deux oracles d'énumération dans une URL publique
        // (`docs/security.md` §7). Seules les deux classes du `domain` en
        // sortent.
        const code = new URL(request.url).searchParams.get('error')
        const failure = oauthFailureClass(code)

        // C'est ici que **tout** refus de parcours converge, y compris ceux que
        // la bibliothèque redirige d'elle-même (`onAPIError.errorURL`). Seule
        // la classe est journalisée : le code d'origine dirait l'état du compte,
        // et un journal n'est pas une raison de le garder.
        service().useCases.log(
          describeSecurityEvent({
            event: 'auth.oauth_refused',
            actor: null,
            details: { class: failure, stage: 'return' },
          }),
        )

        return redirect(`/sign-in?oauth=${failure}`)
      },
    },
    {
      method: 'GET',
      path: PATHS.localProviderAuthorize,
      protection: { level: 'public' },
      handler: (request) => {
        const auth = service()

        if (!auth.oauthProviders.includes(LOCAL_OAUTH_PROVIDER_ID)) {
          return notDeclared()
        }

        // **Ici le 404 est conservé**, contrairement aux rappels : cette route
        // est la porte du mode développement — celle qui ouvre une session sur
        // l'identité de test —, et elle ne doit pas exister quand le drapeau
        // n'est pas posé. La garde de `e2e/modules.spec.ts` reste satisfaite
        // parce que `playwright.config.ts` pose ce drapeau ; c'est écrit ici
        // pour que celui qui l'enlèverait sache pourquoi la garde rougit.
        //
        // L'autorisation du fournisseur de développement : aucune question, et
        // **le `redirect_uri` reçu est ignoré**. Le reprendre ferait de cette
        // route une redirection ouverte que le drapeau suffirait à armer.
        //
        // Le **créneau** d'identité (s52) est la seule chose que l'appelant
        // choisisse ici, et il ne choisit pas une adresse : `localOAuthIdentity`
        // compose la sienne dans le domaine réservé. Une étiquette hors forme
        // est refusée, jamais repliée sur l'identité par défaut.
        const url = new URL(request.url)
        const state = url.searchParams.get('state') ?? ''
        const identity = localOAuthIdentity(url.searchParams.get(LOCAL_OAUTH_SLOT_PARAM))

        if (identity === null) {
          return badRequest(
            `créneau d’identité local invalide : ${LOCAL_OAUTH_SLOT_PARAM} attend une étiquette ` +
              'de seize caractères au plus, minuscules et chiffres',
          )
        }

        return redirect(
          `${MODULE_ROUTE_PREFIX}/auth/callback/${LOCAL_OAUTH_PROVIDER_ID}` +
            `?code=${identity.accountId}&state=${encodeURIComponent(state)}`,
        )
      },
    },
    {
      method: 'POST',
      path: PATHS.unlinkProvider,
      protection: { level: 'authenticated' },
      handler: async (request, context) => {
        const auth = service()
        const body = await submittedBody(request)

        if (context.session === null) {
          return badRequest('session absente')
        }

        if (typeof body?.accountId !== 'string' || body.accountId === '') {
          return badRequest('moyen de connexion à retirer manquant')
        }

        // Le compte est **celui de la session**, jamais un identifiant reçu du
        // client : le seul moyen de délier le fournisseur d'un autre serait
        // d'ouvrir sa session.
        const outcome = await auth.useCases.unlinkSignInMethod({
          userId: context.session.userId,
          accountId: body.accountId,
        })

        if (outcome === 'unlinked') {
          return Response.json({ status: true })
        }

        // Le dernier moyen de connexion est un refus **de règle**, dit à son
        // propriétaire : il n'y a rien à cacher à qui possède déjà le compte.
        // Un moyen qui n'est pas le sien, en revanche, répond 404 comme un
        // identifiant inventé (`docs/security.md` §3).
        return outcome === 'last-method'
          ? Response.json({ error: 'last_sign_in_method' }, { status: 400 })
          : notFound()
      },
    },
    {
      method: 'POST',
      path: PATHS.signUp,
      protection: { level: 'public' },
      rateLimit: { policy: 'signUp', subjectField: 'email' },
      handler: async (request) =>
        await refuseInvalid(async () => {
          const auth = service()
          const input = parseSignUpInput(await jsonBody(request), auth.policy)
          const response = await auth.handle(
            withBody(request, { ...input, name: input.email }),
          )

          if (!response.ok) {
            return response
          }

          // L'email de vérification part **ici**, et son échec est dit :
          // `docs/reliability.md` §2 — « sans service d'email, l'inscription
          // échoue proprement en le disant ». Le compte existe malgré tout, et
          // un nouvel envoi reste possible : l'opération est reprenable.
          const sent = await auth.useCases.sendVerificationEmail({
            to: input.email,
            // Le destinataire est celui qui vient de s'inscrire : sa langue est
            // celle de la requête. Un destinataire sans langue connue
            // retomberait sur celle du site, par la même règle.
            knownLocale: auth.localeOf(request),
          })

          if (!sent.ok) {
            return Response.json(
              { error: 'verification_email_not_sent', code: sent.error.code },
              { status: 502 },
            )
          }

          return response
        }),
    },
    {
      method: 'POST',
      path: PATHS.signIn,
      protection: { level: 'public' },
      rateLimit: { policy: 'signIn', subjectField: 'email' },
      handler: async (request) =>
        await refuseInvalid(async () => {
          const auth = service()
          const input = parseSignInInput(await jsonBody(request))

          const response = await auth.handle(withBody(request, input))

          // **Un troisième cas** depuis s13, et il n'est ni l'un ni l'autre :
          // le mot de passe est bon, mais le greffon de second facteur a
          // détruit la session que la bibliothèque venait de créer
          // (`plugins/two-factor/index.mjs`, crochet `after` sur
          // `/sign-in/email`). Le compter comme une connexion réussie ferait
          // mentir le journal sur le seul point qui l'intéresse — aucune
          // session n'existe —, et `actorOf` y trouverait `anonymous`, ce
          // corps ne portant pas de compte.
          if (await isTwoFactorChallenge(response)) {
            // L'acteur est relu par son adresse, déjà validée par la
            // bibliothèque : on n'arrive ici qu'avec le bon mot de passe.
            const actor = await auth.useCases.identifyAccount(input.email)

            auth.useCases.log(
              describeSecurityEvent({
                event: 'auth.two_factor_challenged',
                actor,
                details: { method: 'password' },
              }),
            )

            // Les cookies sont recopiés — le défi vient d'être posé, et la
            // session vient d'être effacée —, le corps est remplacé.
            // `twoFactorMethods` énumère les facteurs du compte ; l'écran n'a
            // besoin que de savoir qu'il doit en demander un.
            return withoutSessionToken(response, { twoFactor: true })
          }

          // Le **journal** garde le statut réel de la bibliothèque : c'est
          // l'exploitant qui a besoin de distinguer un mot de passe faux d'une
          // adresse non vérifiée, jamais l'appelant anonyme.
          auth.useCases.log(
            describeSecurityEvent({
              event: response.ok ? 'auth.sign_in_succeeded' : 'auth.sign_in_failed',
              actor: response.ok ? await actorOf(response) : null,
              details: { status: response.status },
            }),
          )

          // Et l'appelant reçoit le refus unique du `domain`. La bibliothèque
          // rend `401 INVALID_EMAIL_OR_PASSWORD` pour un compte inconnu comme
          // pour un mot de passe faux — elle hache un mot de passe factice
          // dans le premier cas pour que les deux durent aussi longtemps —,
          // mais `403 EMAIL_NOT_VERIFIED` quand l'adresse n'est pas prouvée.
          // Rendre sa réponse telle quelle rendait donc l'état du compte
          // lisible dans le statut. Le refus est réécrit ici, une fois, pour
          // tous les états.
          const refusal = genericSignInRefusal(response.status)

          return refusal === null
            ? response
            : Response.json(refusal.body, { status: refusal.status })
        }),
    },
    {
      method: 'POST',
      path: PATHS.magicLink,
      protection: { level: 'public' },
      rateLimit: { policy: 'magicLink', subjectField: 'email' },
      handler: async (request) =>
        await refuseInvalid(async () => {
          const auth = service()
          const body = (await jsonBody(request)) as { readonly callbackURL?: unknown }
          const email = parseEmailInput(body)

          return await auth.handle(
            withBody(request, {
              email,
              // La destination de retour est filtrée avant d'atteindre la
              // bibliothèque : un paramètre non validé pilote sinon une
              // redirection (`docs/security.md` §4).
              callbackURL: safeRedirectPath(
                typeof body?.callbackURL === 'string' ? body.callbackURL : null,
                '/account',
              ),
            }),
          )
        }),
    },
    {
      method: 'GET',
      path: PATHS.magicLinkVerify,
      protection: { level: 'public' },
      rateLimit: { policy: 'magicLink' },
      handler: async (request) => {
        const auth = service()
        const response = await auth.handle(request)

        // **Le second facteur s'applique ici aussi** (revue s13, C2). Le
        // greffon ne couvre que `/sign-in/email` ; le module étend son crochet
        // aux deux voies qui redirigent, et la personne est envoyée à l'écran
        // de vérification au lieu de sa destination. Le journal de ce cas est
        // écrit là où le compte est encore connu — `infrastructure/`.
        if (await isTwoFactorChallenge(response)) {
          return twoFactorChallengeRedirect(request, response)
        }

        // Le lien **ouvre une session** : §7 ne fait pas d'exception pour un
        // moyen de connexion sans mot de passe. La lacune est antérieure à s12,
        // et elle se ferme ici avec le même utilitaire que les rappels.
        const actor = await actorOfSessionSetBy(auth, request, response)

        auth.useCases.log(
          describeSecurityEvent({
            event: actor === null ? 'auth.sign_in_failed' : 'auth.sign_in_succeeded',
            actor,
            details: { method: 'magic_link' },
          }),
        )

        return response
      },
    },
    {
      method: 'POST',
      path: PATHS.sendVerificationEmail,
      protection: { level: 'public' },
      rateLimit: { policy: 'emailVerification', subjectField: 'email' },
      handler: async (request) =>
        await refuseInvalid(async () => {
          const auth = service()
          const email = parseEmailInput(await jsonBody(request))
          const sent = await auth.useCases.sendVerificationEmail({
            to: email,
            knownLocale: auth.localeOf(request),
          })

          // La réponse ne dépend **pas** de l'existence du compte : le lien
          // n'est utile qu'à qui reçoit l'email.
          return sent.ok
            ? Response.json({ status: true })
            : Response.json(
                { error: 'verification_email_not_sent', code: sent.error.code },
                { status: 502 },
              )
        }),
    },
    {
      method: 'GET',
      path: PATHS.verifyEmail,
      protection: { level: 'public' },
      rateLimit: { policy: 'emailVerification' },
      handler: async (request) => {
        const token = new URL(request.url).searchParams.get('token') ?? ''
        const outcome = await service().useCases.verifyEmail(token)

        return outcome.status === 'verified'
          ? redirect('/sign-in?verified=1')
          : redirect('/verify-email?error=invalid_token')
      },
    },
    {
      method: 'GET',
      path: PATHS.verifyEmailChange,
      protection: { level: 'public' },
      rateLimit: { policy: 'emailVerification' },
      handler: async (request) => {
        const token = new URL(request.url).searchParams.get('token') ?? ''
        const outcome = await service().useCases.confirmEmailChange(token)

        return outcome.status === 'changed'
          ? redirect('/sign-in?email_changed=1')
          : redirect('/verify-email?error=invalid_token')
      },
    },
    {
      method: 'POST',
      path: PATHS.requestPasswordReset,
      protection: { level: 'public' },
      rateLimit: { policy: 'passwordReset', subjectField: 'email' },
      handler: async (request) =>
        await refuseInvalid(async () => {
          const auth = service()
          const email = parseEmailInput(await jsonBody(request))

          return await auth.handle(withBody(request, { email }))
        }),
    },
    {
      method: 'POST',
      path: PATHS.resetPassword,
      protection: { level: 'public' },
      rateLimit: { policy: 'passwordReset' },
      handler: async (request) => await service().handle(request),
    },
    {
      method: 'POST',
      path: PATHS.signOut,
      protection: { level: 'authenticated' },
      handler: async (request, context) => {
        const auth = service()
        const response = await auth.handle(request)

        auth.useCases.log(
          describeSecurityEvent({
            event: 'auth.sign_out',
            actor: context.session === null ? null : { userId: context.session.userId },
          }),
        )

        return response
      },
    },
    {
      method: 'POST',
      path: PATHS.changePassword,
      protection: { level: 'authenticated' },
      handler: async (request) =>
        await refuseInvalid(async () => {
          const auth = service()
          const body = (await jsonBody(request)) as {
            readonly currentPassword?: unknown
            readonly newPassword?: unknown
          }

          if (typeof body?.currentPassword !== 'string') {
            return badRequest('mot de passe courant manquant')
          }

          // Le nouveau mot de passe passe par la règle du `domain` : la
          // longueur minimale ne peut pas dépendre du point d'entrée.
          const { password } = parseSignUpInput(
            { email: 'placeholder@example.test', password: body?.newPassword },
            auth.policy,
          )

          return await auth.changePassword({
            request,
            currentPassword: body.currentPassword,
            newPassword: password,
          })
        }),
    },
    {
      method: 'POST',
      path: PATHS.changeName,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await refuseInvalid(async () => {
          const auth = service()
          const name = parseDisplayName(await jsonBody(request))

          if (context.session === null) {
            return badRequest('session absente')
          }

          // Le compte modifié est **celui de la session**, jamais un
          // identifiant reçu du client : le seul moyen de changer le nom d'un
          // autre serait d'ouvrir sa session.
          const changed = await auth.useCases.changeName({
            userId: context.session.userId,
            name,
          })

          if (changed) {
            auth.useCases.log(
              describeSecurityEvent({
                event: 'auth.profile_changed',
                actor: { userId: context.session.userId },
                details: { field: 'name' },
              }),
            )
          }

          return changed ? Response.json({ status: true }) : notFound()
        }),
    },
    {
      method: 'POST',
      path: PATHS.revokeSession,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await refuseInvalid(async () => {
          const auth = service()
          const body = (await jsonBody(request)) as { readonly sessionId?: unknown }

          if (context.session === null) {
            return badRequest('session absente')
          }

          if (typeof body?.sessionId !== 'string' || body.sessionId === '') {
            return badRequest('session à révoquer manquante')
          }

          const revoked = await auth.useCases.revokeSession({
            userId: context.session.userId,
            sessionId: body.sessionId,
          })

          return revoked ? Response.json({ status: true }) : notFound()
        }),
    },
    {
      method: 'POST',
      path: PATHS.twoFactorEnable,
      protection: { level: 'authenticated' },
      handler: async (request, context) => {
        const auth = service()
        const body = (await jsonBody(request)) as { readonly password?: unknown } | null

        if (context.session === null) {
          return badRequest('session absente')
        }

        if (typeof body?.password !== 'string' || body.password === '') {
          return badRequest('mot de passe courant manquant')
        }

        // **Le corps est reconstruit.** Celui de la bibliothèque accepte
        // `method` — `'otp'` activerait le second facteur *immédiatement*, sans
        // qu'aucun code n'ait été confirmé — et `issuer`, qui décide du nom
        // affiché par l'application d'authentification : y écrire « votre
        // banque » est un hameçonnage à un champ.
        const response = await auth.handle(
          withBody(request, { password: body.password, method: 'totp' }),
        )

        if (!response.ok) {
          // Le mot de passe est faux, ou le compte n'en a pas — un compte créé
          // par un fournisseur externe seul n'a pas de premier facteur à
          // renforcer. Le refus est le même dans les deux cas : c'est son
          // propriétaire qui appelle, il n'y a rien à lui apprendre, et rien
          // à lui distinguer non plus.
          return badRequest('preuve refusée')
        }

        const payload = (await response.json()) as {
          readonly totpURI?: unknown
          readonly backupCodes?: unknown
        }

        // **La réponse est réécrite, jamais relayée.** Celle de la
        // bibliothèque porte `method` en plus des deux champs utiles.
        // Correction de la revue (C9) : sur le chemin TOTP elle ne porte
        // **pas** de `token` — `enableTwoFactor` ne repose de session que sous
        // `skipVerificationOnEnable` ou `method: 'otp'`, et le module n'active
        // ni l'un ni l'autre. La réécriture reste la règle du module (aucun
        // corps de bibliothèque ne sort tel quel) ; c'est sa justification qui
        // était fausse. Deux champs sortent, et deux seulement — le secret sous
        // forme d'URI, et les dix codes en clair, **la seule fois** où ils
        // existent ailleurs qu'en empreinte.
        return Response.json({
          totpURI: payload.totpURI,
          backupCodes: payload.backupCodes,
        })
      },
    },
    {
      method: 'POST',
      // **Publique**, et c'est le même point d'entrée pour deux moments : la
      // confirmation d'un enrôlement, qui a une session, et la vérification à
      // la connexion, qui n'en a pas encore — elle ne porte que le cookie de
      // défi. Déclarer la route `authenticated` fermerait la seconde.
      path: PATHS.twoFactorVerify,
      protection: { level: 'public' },
      rateLimit: { policy: 'twoFactor', subjectCookies: TWO_FACTOR_CHALLENGE_COOKIES },
      handler: async (request, context) => {
        const auth = service()
        const body = (await jsonBody(request)) as { readonly code?: unknown } | null

        if (typeof body?.code !== 'string' || body.code === '') {
          return badRequest('code manquant')
        }

        // Corps reconstruit : `trustDevice` de la bibliothèque poserait un
        // cookie de trente jours qui **saute** le second facteur aux
        // connexions suivantes. Ce n'est pas ce que la story livre, et le
        // laisser au client reviendrait à lui laisser désarmer sa propre
        // protection depuis un poste qu'il ne maîtrise pas.
        const response = await auth.handle(withBody(request, { code: body.code }))

        return await settleTwoFactorVerification({
          auth,
          request,
          response,
          session: context.session,
          method: 'totp',
          code: body.code,
        })
      },
    },
    {
      method: 'POST',
      // Publique, pour la même raison que la vérification TOTP : c'est un
      // moyen de **terminer une connexion**, et il n'y a pas encore de session.
      path: PATHS.twoFactorBackupCode,
      protection: { level: 'public' },
      rateLimit: { policy: 'twoFactor', subjectCookies: TWO_FACTOR_CHALLENGE_COOKIES },
      handler: async (request, context) => {
        const auth = service()
        const body = (await jsonBody(request)) as { readonly code?: unknown } | null

        if (typeof body?.code !== 'string' || body.code === '') {
          return badRequest('code manquant')
        }

        // **La saisie est hachée avant d'atteindre la bibliothèque.** La base
        // ne contient que des empreintes (`domain/backup-code.ts`), et
        // `verifyBackupCode` compare ce qu'elle reçoit à ce qu'elle lit : sans
        // cette ligne, la comparaison porterait un code en clair contre une
        // empreinte, et aucun code ne fonctionnerait jamais. C'est aussi ce
        // qui rend le stockage haché possible — la bibliothèque, seule, exige
        // un magasin réversible.
        //
        // `disableSession` et `trustDevice` du corps de la bibliothèque ne
        // sont pas repris : le premier ouvrirait un chemin qui valide un code
        // sans connecter, le second sauterait le second facteur pendant trente
        // jours.
        const response = await auth.handle(
          withBody(request, { code: auth.digestBackupCode(body.code) }),
        )

        return await settleTwoFactorVerification({
          auth,
          request,
          response,
          session: context.session,
          method: 'backup_code',
          code: body.code,
        })
      },
    },
    {
      method: 'POST',
      path: PATHS.twoFactorRegenerate,
      protection: { level: 'authenticated' },
      handler: async (request, context) => {
        const auth = service()
        const body = (await jsonBody(request)) as { readonly password?: unknown } | null

        if (context.session === null) {
          return badRequest('session absente')
        }

        if (typeof body?.password !== 'string' || body.password === '') {
          return badRequest('mot de passe courant manquant')
        }

        const response = await auth.handle(withBody(request, { password: body.password }))

        if (!response.ok) {
          return badRequest('preuve refusée')
        }

        const payload = (await response.json()) as { readonly backupCodes?: unknown }

        auth.useCases.log(
          describeSecurityEvent({
            event: 'auth.two_factor_backup_codes_regenerated',
            actor: context.session,
          }),
        )

        // Les dix nouveaux codes, **et rien d'autre** : la réponse de la
        // bibliothèque porte aussi `status`, et l'ancien jeu vient d'être
        // remplacé en base par les empreintes de celui-ci.
        return Response.json({ backupCodes: payload.backupCodes })
      },
    },
    {
      method: 'POST',
      path: PATHS.twoFactorDisable,
      protection: { level: 'authenticated' },
      handler: async (request, context) => {
        const auth = service()
        const body = (await jsonBody(request)) as { readonly password?: unknown } | null

        if (context.session === null) {
          return badRequest('session absente')
        }

        // **La preuve est le mot de passe courant**, et elle n'est pas
        // facultative : sans elle, un vol de session suffirait à retirer le
        // second facteur, c'est-à-dire à défaire en une requête ce que la
        // story existe pour poser.
        //
        // Le critère de la story dit « un code valide **ou** le mot de passe
        // courant ». Seule la seconde moitié est livrée, et c'est mesuré, pas
        // choisi : `disableTwoFactor` appelle `validatePassword` avant tout
        // (`utils/password.mjs`, `shouldRequirePassword` rend `true` dès que
        // `allowPasswordless` n'est pas posé), et aucun crochet n'y substitue
        // une autre preuve. La reproduire ici voudrait dire réécrire la
        // rotation de session hors de la bibliothèque — précisément ce que la
        // frontière du module lui confie. Voir `docs/plans/s13-two-factor.md`.
        if (typeof body?.password !== 'string' || body.password === '') {
          return badRequest('mot de passe courant manquant')
        }

        const response = await auth.handle(withBody(request, { password: body.password }))

        if (!response.ok) {
          return badRequest('preuve refusée')
        }

        auth.useCases.log(
          describeSecurityEvent({
            event: 'auth.two_factor_disabled',
            actor: context.session,
          }),
        )

        // Les cookies sont recopiés : la bibliothèque vient de faire tourner
        // la session, comme à l'activation. Le corps, lui, ne sort pas — il
        // porte le jeton de cette nouvelle session.
        return withoutSessionToken(response, { status: true })
      },
    },
    {
      method: 'GET',
      path: PATHS.passkeyRegisterOptions,
      protection: { level: 'authenticated' },
      handler: async (request) => {
        const auth = service()

        // **La requête d'URL est jetée, jamais transmise.** Celle de la
        // bibliothèque accepte `name` — qui devient le `userName` de la
        // cérémonie, donc le libellé qu'un gestionnaire de mots de passe
        // affiche —, `authenticatorAttachment` et `context`. Le premier est un
        // hameçonnage à un champ ; le nom d'une passkey se donne ici par le
        // renommage, sur son propre compte.
        const stripped = new URL(request.url)

        stripped.search = ''

        const response = await auth.handle(
          new Request(stripped, { method: 'GET', headers: request.headers }),
        )
        const refusal = passkeyRefusal(response.status)

        return refusal === null
          ? response
          : Response.json(refusal.body, { status: refusal.status })
      },
    },
    {
      method: 'POST',
      path: PATHS.passkeyRegister,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await refuseInvalid(async () => {
          const auth = service()
          const body = (await jsonBody(request)) as { readonly response?: unknown } | null

          if (context.session === null) {
            return badRequest('session absente')
          }

          if (body === null || typeof body !== 'object') {
            return badRequest('réponse d’enrôlement manquante')
          }

          // Le nom passe par la règle du `domain` : absent, la passkey n'en a
          // pas — l'écran affichera un libellé de son catalogue, le module ne
          // fabrique aucun nom.
          const name = parsePasskeyName(body)
          // **La session précédente, lue avant l'appel.** La rotation qui suit
          // en crée une nouvelle ; sans révoquer celle-ci, l'ancien
          // identifiant resterait valable et la « rotation » n'en serait pas
          // une (`docs/security.md` §2).
          const previousSessionId = await auth.resolveSessionId(request)

          const response = await auth.handle(
            withBody(request, {
              response: body.response,
              ...(name === null ? {} : { name }),
              // **Imposé, jamais lu du corps.** C'est ce qui fait tourner la
              // session à l'élévation de privilège — ajouter un moyen de
              // connexion en est une. Laisser le client le fournir
              // reviendrait à lui laisser désarmer la rotation.
              createSession: true,
            }),
          )

          if (!response.ok) {
            auth.useCases.log(
              describeSecurityEvent({
                event: 'auth.passkey_registration_refused',
                actor: context.session,
                details: { status: response.status },
              }),
            )

            const refusal = passkeyRefusal(response.status)

            return refusal === null
              ? response
              : Response.json(refusal.body, { status: refusal.status })
          }

          if (previousSessionId !== null) {
            await auth.useCases.revokeSession({
              userId: context.session.userId,
              sessionId: previousSessionId,
            })
          }

          auth.useCases.log(
            describeSecurityEvent({
              event: 'auth.passkey_registered',
              actor: context.session,
            }),
          )

          // **Le corps de la bibliothèque ne sort pas.** Le sien porte la ligne
          // entière — `publicKey`, `credentialID`, `counter`, `aaguid` — plus
          // la session et le compte. Les cookies, eux, sont recopiés : c'est là
          // que vit la session rotée.
          return withoutSessionToken(response, { status: true })
        }),
    },
    {
      method: 'GET',
      // **Publique**, et elle ne peut pas être autre chose : on y arrive avant
      // toute session. Elle ne prend **aucun paramètre** et ne consulte
      // l'existence d'aucun compte — le navigateur propose les passkeys qu'il
      // détient. Il n'y a donc rien à révéler (`docs/security.md` §7).
      path: PATHS.passkeyAuthenticateOptions,
      protection: { level: 'public' },
      rateLimit: { policy: 'passkey' },
      handler: async (request) => {
        const stripped = new URL(request.url)

        stripped.search = ''

        return await service().handle(
          new Request(stripped, { method: 'GET', headers: request.headers }),
        )
      },
    },
    {
      method: 'POST',
      path: PATHS.passkeyAuthenticate,
      protection: { level: 'public' },
      rateLimit: { policy: 'passkey' },
      handler: async (request) => {
        const auth = service()
        const body = (await jsonBody(request)) as { readonly response?: unknown } | null

        if (body === null || typeof body !== 'object') {
          return badRequest('assertion manquante')
        }

        const response = await auth.handle(withBody(request, { response: body.response }))

        // **Le second facteur s'applique ici aussi** (ADR 031). Une passkey de
        // ce montage prouve la possession, et rien de plus : le greffon
        // vérifie avec `requireUserVerification: false`, en dur. Le chemin
        // n'est donc **pas** exempté du crochet, et la connexion d'un compte
        // protégé s'arrête ici. Le journal de ce cas est écrit là où le compte
        // est encore connu — `infrastructure/two-factor-challenge.ts`.
        if (await isTwoFactorChallenge(response)) {
          return withoutSessionToken(response, { twoFactor: true })
        }

        const actor = await actorOfSessionSetBy(auth, request, response)

        auth.useCases.log(
          describeSecurityEvent({
            event: actor === null ? 'auth.sign_in_failed' : 'auth.sign_in_succeeded',
            actor,
            details: { method: 'passkey' },
          }),
        )

        // **Le refus est celui de toutes les connexions.** La bibliothèque
        // distingue `PASSKEY_NOT_FOUND` (justificatif inconnu) de
        // `AUTHENTICATION_FAILED` (signature fausse) : le premier dirait à un
        // visiteur anonyme si un justificatif est connu du serveur. Un seul
        // refus sort, le même que celui du mot de passe.
        if (!response.ok) {
          return Response.json(SIGN_IN_REFUSAL.body, { status: SIGN_IN_REFUSAL.status })
        }

        // Et le succès ne relaie rien : le corps de la bibliothèque porte la
        // session et le compte.
        return withoutSessionToken(response, { status: true })
      },
    },
    {
      method: 'POST',
      path: PATHS.passkeyRename,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await refuseInvalid(async () => {
          const auth = service()
          const body = (await jsonBody(request)) as { readonly passkeyId?: unknown } | null

          if (context.session === null) {
            return badRequest('session absente')
          }

          if (typeof body?.passkeyId !== 'string' || body.passkeyId === '') {
            return badRequest('passkey à renommer manquante')
          }

          const name = parsePasskeyName(body)

          if (name === null) {
            return badRequest('nom manquant')
          }

          // Le compte est **celui de la session**, jamais un identifiant reçu
          // du client. Une passkey qui n'est pas la sienne répond 404 comme un
          // identifiant inventé (`docs/security.md` §3).
          const renamed = await auth.useCases.renamePasskey({
            userId: context.session.userId,
            passkeyId: body.passkeyId,
            name,
          })

          return renamed ? Response.json({ status: true }) : notFound()
        }),
    },
    {
      method: 'POST',
      path: PATHS.passkeyRevoke,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await refuseInvalid(async () => {
          const auth = service()
          const body = (await jsonBody(request)) as { readonly passkeyId?: unknown } | null

          if (context.session === null) {
            return badRequest('session absente')
          }

          if (typeof body?.passkeyId !== 'string' || body.passkeyId === '') {
            return badRequest('passkey à révoquer manquante')
          }

          const outcome = await auth.useCases.revokePasskey({
            userId: context.session.userId,
            passkeyId: body.passkeyId,
          })

          if (outcome === 'revoked') {
            return Response.json({ status: true })
          }

          // Le dernier moyen de connexion est un refus **de règle**, dit à son
          // propriétaire — il n'y a rien à cacher à qui possède déjà le
          // compte. Une passkey qui n'est pas la sienne, en revanche, répond
          // 404. Même forme que le déliement de s12.
          return outcome === 'last-method'
            ? Response.json({ error: 'last-method' }, { status: PASSKEY_REFUSAL_STATUS })
            : notFound()
        }),
    },
    {
      method: 'POST',
      path: PATHS.changeEmail,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await refuseInvalid(async () => {
          const auth = service()
          const email = parseEmailInput(await jsonBody(request))

          if (context.session === null) {
            return badRequest('session absente')
          }

          const sent = await auth.useCases.requestEmailChange({
            userId: context.session.userId,
            newEmail: email,
            knownLocale: auth.localeOf(request),
          })

          return sent.ok
            ? Response.json({ status: true })
            : Response.json(
                { error: 'verification_email_not_sent', code: sent.error.code },
                { status: 502 },
              )
        }),
    },
  ]
}

/**
 * L'acteur d'une connexion réussie, lu dans la réponse de la bibliothèque.
 *
 * La réponse est **clonée** : la lire consommerait le flux que l'appelant doit
 * encore recevoir. Seul l'identifiant est retenu — le corps porte aussi le
 * jeton de session, qui n'a rien à faire dans un journal.
 */
async function actorOf(response: Response): Promise<{ userId: string } | null> {
  const payload = (await response.clone().json().catch(() => null)) as {
    readonly user?: { readonly id?: unknown }
  } | null
  const id = payload?.user?.id

  return typeof id === 'string' ? { userId: id } : null
}

/**
 * La navigation du module.
 *
 * Deux entrées, deux protections : « Connexion » est publique, « Mon compte »
 * ne s'affiche que pour une session. C'est `visibleNavigation` qui décide, avec
 * le prédicat qui décide aussi du sort des routes — le composant de navigation
 * n'a aucune condition.
 */
export const authNavigation: readonly NavigationEntry[] = [
  {
    id: 'sign-in',
    href: '/sign-in',
    labelKey: 'navigation.signIn',
    order: 1,
    protection: { level: 'public' },
  },
  {
    id: 'account',
    href: '/account',
    labelKey: 'navigation.account',
    order: 2,
    protection: { level: 'authenticated' },
  },
]
