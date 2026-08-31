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
} from '../domain/credentials'
import {
  isOAuthProviderId,
  LOCAL_OAUTH_ACCOUNT_ID,
  LOCAL_OAUTH_AUTHORIZE_PATH,
  LOCAL_OAUTH_PROVIDER_ID,
  OAUTH_CALLBACK_PROVIDERS,
  OAUTH_ERROR_PATH,
  oauthFailureClass,
  oauthReturnPath,
  type AnyOAuthProviderId,
} from '../domain/oauth'
import { safeRedirectPath } from '../domain/redirect'

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
        // L'autorisation du fournisseur de développement : aucune question,
        // aucun choix d'identité, et **le `redirect_uri` reçu est ignoré**. Le
        // reprendre ferait de cette route une redirection ouverte que le
        // drapeau suffirait à armer.
        const state = new URL(request.url).searchParams.get('state') ?? ''

        return redirect(
          `${MODULE_ROUTE_PREFIX}/auth/callback/${LOCAL_OAUTH_PROVIDER_ID}` +
            `?code=${LOCAL_OAUTH_ACCOUNT_ID}&state=${encodeURIComponent(state)}`,
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
      handler: async (request) =>
        await refuseInvalid(async () => {
          const auth = service()
          const input = parseSignInInput(await jsonBody(request))

          const response = await auth.handle(withBody(request, input))

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
      handler: async (request) => {
        const auth = service()
        const response = await auth.handle(request)
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
