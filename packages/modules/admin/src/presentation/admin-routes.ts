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

export function createAdminRoutes(service: () => AdminService): readonly ModuleRoute[] {
  /**
   * La garde, écrite **une fois** : le répartiteur a déjà exigé une session, il
   * reste à savoir si elle administre.
   *
   * Le refus est journalisé — la réponse ne distingue rien, le journal si
   * (`docs/security.md` §7).
   */
  const asSuperadmin = async (
    context: ModuleRouteContext,
    run: (actorId: string) => Promise<Response>,
  ): Promise<Response> => {
    if (context.session === null) {
      // Le répartiteur refuse déjà l'appel anonyme ; sans session ici, c'est le
      // montage qui est cassé, et servir la requête serait pire que de refuser.
      return notFound()
    }

    const admin = service()

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
        await asSuperadmin(context, async (actorId) =>
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
        await asSuperadmin(context, async (actorId) =>
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
        await asSuperadmin(context, async (actorId) =>
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
            if (outcome.error === 'last_superadmin') {
              return conflict(outcome.error)
            }

            // Un compte que le socle ne connaît pas : 404, comme toute
            // ressource dont l'existence n'a pas à être confirmée.
            return outcome.error === 'not_found' ? notFound() : badRequest(outcome.error)
          }),
        ),
    },
    {
      method: 'POST',
      path: PATHS.unbanAccount,
      protection: { level: 'authenticated' },
      handler: async (request, context) =>
        await asSuperadmin(context, async (actorId) =>
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
