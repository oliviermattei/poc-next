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

  return [
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
      handler: async (request) => await service().handle(request),
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
