import {
  MODULE_ROUTE_PREFIX,
  type ModuleRoute,
  type ModuleRouteContext,
  type NavigationEntry,
} from '@repo/core'

import type { AdminService } from '../application/admin-service'
import { parseAccountTarget } from '../domain/platform-role'

/**
 * Les routes du module, **énumérées une par une**, avec leur niveau de
 * protection (ADR 007). Ce qui n'est pas dans cette liste n'existe pas : le
 * répartiteur répond 404 sans atteindre le module, et un module coupé n'a
 * aucune de ces routes dans la table de routage.
 *
 * ## Pourquoi `authenticated` et non `role`
 *
 * `RouteProtection.level: 'role'` existe et interroge `ModuleSession.roles`.
 * Le répartiteur y répond **403** quand la session ne porte pas le rôle
 * (`packages/core/src/registry.ts`), et un 403 confirme que le back-office
 * existe — ce que les critères 3 et 4 de la story refusent explicitement. Les
 * routes sont donc déclarées `authenticated`, et la garde de superadmin est
 * **ici**, où elle peut répondre 404.
 *
 * Elle relit le rôle en base à chaque requête : le pouvoir suit la ligne, pas
 * le jeton de session (ADR 030). Une révocation mord donc à l'instant, sans
 * reconnexion.
 *
 * **Ce que cette forme ne cache pas, et il faut le savoir** : un appelant
 * **anonyme** reçoit 401 du répartiteur, comme sur toute route authentifiée du
 * dépôt. L'existence d'un chemin sous `/admin/` se lit donc sans compte. Ce qui
 * est fermé, et que la story demande, est la distinction entre « ce compte-ci
 * administre » et « ce compte-là n'administre pas » : les deux reçoivent la
 * même réponse qu'une URL inventée.
 *
 * ## L'ordre : autorisation, **puis** validation
 *
 * La garde passe avant Zod, comme aux six portes du module `organizations`
 * (revue de s17, F5). L'inverse laisserait un non-superadmin distinguer un
 * corps valide d'un corps invalide, c'est-à-dire apprendre quelque chose du
 * back-office sans y avoir droit.
 */

const PATHS = {
  grantSuperadmin: '/admin/superadmins/grant',
  revokeSuperadmin: '/admin/superadmins/revoke',
  banAccount: '/admin/accounts/ban',
  unbanAccount: '/admin/accounts/unban',
  startImpersonation: '/admin/impersonation/start',
  stopImpersonation: '/admin/impersonation/stop',
} as const

/** Le chemin public d'une route du module, préfixe de montage compris. */
export const adminRoutePath = (path: keyof typeof PATHS): string =>
  `${MODULE_ROUTE_PREFIX}${PATHS[path]}`

/**
 * **Ce que reçoit qui n'administre pas** — et c'est la réponse du répartiteur
 * pour une route qui n'existe pas, au corps près.
 *
 * 404, jamais 403 (`docs/security.md` §3) : un 403 confirmerait que le
 * back-office existe et que ce compte n'y a pas droit. Le même refus sert aux
 * deux cas de la story — un compte qui n'est pas superadmin, et une plateforme
 * où aucun superadmin n'est configuré.
 */
const notFound = (): Response => Response.json({ error: 'not_found' }, { status: 404 })

const badRequest = (reason: string): Response =>
  Response.json({ error: 'invalid_request', reason }, { status: 400 })

const conflict = (reason: string): Response =>
  Response.json({ error: 'refused', reason }, { status: 409 })

/**
 * Une réponse qui **pose la session**, et rien d'autre.
 *
 * Le jeton n'est pas dans le corps : il est dans le cookie, `HttpOnly`, formé
 * par le socle. Un jeton rendu à un écran annule `HttpOnly` — c'est la règle
 * que les routes du second facteur appliquent déjà (`auth-routes.ts`).
 */
const withSession = (setCookie: string, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': setCookie },
  })

export function createAdminRoutes(service: () => AdminService): readonly ModuleRoute[] {
  /**
   * La garde, écrite **une fois** : le répartiteur a déjà exigé une session, il
   * reste à savoir si elle administre.
   *
   * Le refus est journalisé — la réponse ne distingue rien, le journal si
   * (`docs/security.md` §7).
   */
  const asSuperadmin = async (
    request: Request,
    context: ModuleRouteContext,
    run: (actorId: string) => Promise<Response>,
  ): Promise<Response> => {
    if (context.session === null) {
      // Le répartiteur refuse déjà l'appel anonyme ; sans session ici, c'est le
      // montage qui est cassé, et servir la requête serait pire que de refuser.
      return notFound()
    }

    const admin = service()

    // **Une session empruntée n'administre jamais** (s37b1), quel que soit le
    // rôle du compte emprunté. Le chemin se découvre en production : le compte
    // emprunté est promu pendant l'emprunt, et sa session ouvrirait alors le
    // back-office à qui l'a empruntée — donc l'enchaînement d'un emprunt depuis
    // un emprunt, et un journal dont l'acteur n'est plus celui qui agit.
    //
    // Le refus est le même 404 : il ne distingue rien de plus qu'une URL
    // inventée.
    if (await admin.useCases.isBorrowedSession(request)) {
      admin.useCases.logAccessRefused(context.session.userId)

      return notFound()
    }

    if (!(await admin.useCases.isSuperadmin(context.session.userId))) {
      admin.useCases.logAccessRefused(context.session.userId)

      return notFound()
    }

    return await run(context.session.userId)
  }

  /** Le corps, lu **après** la garde, et validé par Zod dans le `domain`. */
  const withTarget = async (
    request: Request,
    run: (target: { userId: string; reason: string | null }) => Promise<Response>,
  ): Promise<Response> => {
    const body: unknown = await request.json().catch(() => null)
    const target = parseAccountTarget(body)

    return target === null ? badRequest('compte visé manquant') : await run(target)
  }

  return [
    {
      method: 'POST',
      path: PATHS.grantSuperadmin,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await asSuperadmin(request, context, async (actorId) =>
          await withTarget(request, async (target) => {
            const outcome = await service().useCases.grantSuperadmin({
              actorId,
              userId: target.userId,
            })

            return outcome.ok
              ? Response.json({ granted: outcome.granted })
              : badRequest('compte inconnu')
          }),
        ),
    },
    {
      method: 'POST',
      path: PATHS.revokeSuperadmin,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await asSuperadmin(request, context, async (actorId) =>
          await withTarget(request, async (target) => {
            const outcome = await service().useCases.revokeSuperadmin({
              actorId,
              userId: target.userId,
            })

            // **409, et pas 404** : l'appelant est superadmin, il voit la liste,
            // il connaît la cible. Le refus lui dit ce qui l'empêche — c'est le
            // dernier superadmin — au lieu de lui mentir sur l'existence.
            return outcome.ok ? Response.json({ revoked: true }) : conflict(outcome.error)
          }),
        ),
    },
    {
      method: 'POST',
      path: PATHS.banAccount,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await asSuperadmin(request, context, async (actorId) =>
          await withTarget(request, async (target) => {
            const outcome = await service().useCases.banAccount({
              actorId,
              userId: target.userId,
              reason: target.reason,
            })

            if (outcome.ok) {
              // Le nombre de sessions révoquées est rendu : c'est ce qui rend
              // « bannir révoque les sessions » observable du back-office.
              return Response.json({ revokedSessions: outcome.revokedSessions })
            }

            // **409 pour le dernier superadmin**, comme à la révocation :
            // l'appelant administre, il connaît la cible, et le refus lui dit
            // ce qui l'empêche plutôt que de lui mentir sur l'existence.
            //
            // `accounts_unavailable` y est **avec** lui (s37b1) : c'est un refus
            // du même garde-fou, prononcé parce que l'état des comptes n'a pas
            // pu être lu. Le rendre en 400 dirait « votre demande est mal
            // formée » d'une panne de lecture, et inviterait à la réessayer
            // autrement.
            if (outcome.error === 'last_superadmin' || outcome.error === 'accounts_unavailable') {
              return conflict(outcome.error)
            }

            // Un compte que le socle ne connaît pas : 404, comme toute
            // ressource dont l'existence n'a pas à être confirmée.
            return outcome.error === 'not_found' ? notFound() : badRequest(outcome.error)
          }),
        ),
    },
    {
      /**
       * **L'emprunt de session** (s37b1) : une élévation de privilège, donc une
       * rotation de session (`docs/security.md` §2). Le corps ne porte que la
       * cible ; le jeton, lui, ne sort que dans un cookie `HttpOnly`.
       */
      method: 'POST',
      path: PATHS.startImpersonation,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await asSuperadmin(request, context, async (actorId) =>
          await withTarget(request, async (target) => {
            const outcome = await service().useCases.startImpersonation({
              request,
              actorId,
              userId: target.userId,
            })

            if (outcome.ok) {
              return withSession(outcome.setCookie, { impersonating: target.userId })
            }

            // **409 pour un superadmin visé**, comme les autres refus de ce
            // module : l'appelant administre, il connaît la cible.
            return outcome.error === 'unknown_account' ? notFound() : conflict(outcome.error)
          }),
        ),
    },
    {
      /**
       * **La sortie**, et la seule route de ce module qui ne passe pas par la
       * garde de superadmin.
       *
       * Elle ne le peut pas : elle est appelée **depuis la session empruntée**,
       * qui désigne le compte emprunté et que la garde refuse par principe. Son
       * autorisation est le cookie lui-même — porter une session marquée d'un
       * emprunteur est ce qui donne le droit d'y mettre fin, et rien d'autre
       * n'est décidé ici.
       *
       * Module coupé, une impersonation en cours ne peut plus être rendue à la
       * main : elle expire, et le balayage compte son expiration comme une fin.
       */
      method: 'POST',
      path: PATHS.stopImpersonation,
      protection: { level: 'authenticated' },
      handler: async (request, context) => {
        if (context.session === null) {
          return notFound()
        }

        const outcome = await service().useCases.stopImpersonation({ request })

        return outcome.ok
          ? withSession(outcome.setCookie, { stopped: true })
          : notFound()
      },
    },
    {
      method: 'POST',
      path: PATHS.unbanAccount,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await asSuperadmin(request, context, async (actorId) =>
          await withTarget(request, async (target) => {
            const outcome = await service().useCases.unbanAccount({
              actorId,
              userId: target.userId,
            })

            return outcome.ok
              ? Response.json({ unbanned: true })
              : outcome.error === 'not_found'
                ? notFound()
                : badRequest(outcome.error)
          }),
        ),
    },
  ]
}

/**
 * **Aucune entrée de navigation à cette tranche.**
 *
 * Une entrée doit mener à quelque chose que l'application sert
 * (`packages/core/src/module.ts`) : les écrans du back-office sont `s37b`, et
 * une entrée qui pointerait vers une route d'API rendrait du JSON brut au
 * premier clic — le défaut relevé en revue de s21. Elle arrivera avec l'écran.
 */
export const adminNavigation: readonly NavigationEntry[] = []
