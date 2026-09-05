import { MODULE_ROUTE_PREFIX, type ModuleRoute, type NavigationEntry } from '@repo/core'
import { z } from 'zod'

import type { NotificationUseCases } from '../application/notification-use-cases'
import { NOTIFICATIONS_SCREEN_PATH, type NotificationScope } from '../domain/notification'

/**
 * Les routes du module, **énumérées une par une**, avec leur niveau de
 * protection (ADR 007 et 017). Ce qui n'est pas dans cette liste n'existe pas :
 * le répartiteur répond 404 sans atteindre le module, et un module coupé n'a
 * aucune de ces routes dans la table de routage.
 *
 * **Les cinq sont `authenticated`** : le répartiteur refuse donc avant
 * d'appeler le gestionnaire, et le refus n'atteint ni la règle, ni la base. Un
 * centre de notifications n'a aucune surface publique — c'est aussi pourquoi le
 * module rend `publicUrls: () => []` : rien de ce qu'il sert n'a vocation à
 * être indexé (ADR 054).
 *
 * **Aucune n'est limitée en débit au-delà du défaut.** Le répartiteur limite
 * d'office toute route publique ; celles-ci ne le sont pas, et aucune ne
 * consomme de ressource chez un tiers — ni email, ni objet réservé. C'est la
 * différence avec l'invitation et le téléversement, qui déclarent une politique
 * parce qu'un compte légitime suffit à en faire des milliers.
 *
 * ## Pourquoi des formulaires natifs, et pas du `fetch`
 *
 * Les trois écritures répondent **303 vers l'écran**, comme celles du module
 * `organizations` : les formulaires de l'écran sont des `<form method="post">`
 * ordinaires, sans composant client, donc il n'y a aucune fenêtre
 * pré-hydratation à couvrir. C'est aussi ce qui fait que **le badge se met à
 * jour après lecture, à la navigation** — la redirection recharge l'écran, et
 * le compteur est relu du serveur. Aucun intervalle de rafraîchissement,
 * aucun websocket : le temps réel est au cimetière du PRD.
 *
 * La destination est une **constante de ce fichier**, et son origine vient de
 * la requête entrante : aucune redirection n'est pilotée par un paramètre
 * (`docs/security.md` §4).
 */

const PATHS = {
  list: '/notifications/list',
  read: '/notifications/read',
  readAll: '/notifications/read-all',
  preferences: '/notifications/preferences',
  setPreference: '/notifications/preferences/set',
} as const

/** Le chemin public d'une route du module, préfixe de montage compris. */
export const notificationRoutePath = (path: keyof typeof PATHS): string =>
  `${MODULE_ROUTE_PREFIX}${PATHS[path]}`

/**
 * Ce que rend une notification que l'appelant n'a pas le droit de voir.
 *
 * **404, jamais 403** (`docs/security.md` §3) : un 403 confirmerait que cette
 * notification existe. La réponse est exactement celle d'un identifiant
 * inventé, et le repository ne sait même pas les distinguer — le périmètre est
 * dans le `where`.
 */
const notFound = (): Response => Response.json({ error: 'not_found' }, { status: 404 })

/** Une entrée que Zod refuse : ni détail, ni chemin, ni nom de champ. */
const invalidRequest = (): Response =>
  Response.json({ error: 'invalid_request' }, { status: 400 })

/**
 * Le corps d'une soumission, quelle que soit sa forme.
 *
 * Un formulaire natif poste en `application/x-www-form-urlencoded`, un appel
 * programmatique en JSON. Les deux arrivent au même endroit, et Zod valide
 * ensuite — c'est lui la frontière, pas ce décodage.
 */
const submittedBody = async (request: Request): Promise<unknown> => {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return await request.json().catch(() => null)
  }

  return await request
    .formData()
    .then((form) => Object.fromEntries(form.entries()))
    .catch(() => null)
}

/** Le retour à l'écran après une écriture. 303 : un rechargement ne repostera pas. */
const backToScreen = (request: Request): Response =>
  new Response(null, {
    status: 303,
    headers: { location: new URL(NOTIFICATIONS_SCREEN_PATH, request.url).toString() },
  })

/**
 * **Zod à chaque frontière** (`docs/security.md` §4) — y compris sur un
 * paramètre d'URL.
 *
 * Une page absente vaut 1 ; une page qui n'est pas un entier est **refusée**,
 * jamais lue comme 1 : un paramètre illisible est une requête fautive, et la
 * borner en silence masquerait un appelant cassé.
 */
const PAGE = z.coerce.number().int().min(1)

const READ = z.object({ id: z.string().min(1).max(128) })

const SET_PREFERENCE = z.object({
  type: z.string().min(1).max(128),
  channel: z.string().min(1).max(32),
  // Un formulaire natif poste `"true"` ou `"false"` ; un appel JSON poste un
  // booléen. Les deux sont acceptés, et rien d'autre.
  enabled: z.union([z.boolean(), z.enum(['true', 'false']).transform((raw) => raw === 'true')]),
})

export interface NotificationRouteService {
  readonly useCases: NotificationUseCases
  /**
   * Le périmètre de lecture d'un compte, **donné par l'application**.
   *
   * Le module ne connaît ni `auth`, ni `organizations` : il reçoit
   * l'appartenance, comme `storage` reçoit ses périmètres lisibles.
   */
  readonly scopeOf: (userId: string) => Promise<NotificationScope>
}

export function createNotificationRoutes(
  service: () => NotificationRouteService,
): readonly ModuleRoute[] {
  const list: ModuleRoute = {
    method: 'GET',
    path: PATHS.list,
    protection: { level: 'authenticated' },
    handler: async (request, context) => {
      if (context.session === null) {
        return notFound()
      }

      const raw = new URL(request.url).searchParams.get('page')
      const page = raw === null ? { success: true as const, data: 1 } : PAGE.safeParse(raw)

      if (!page.success) {
        return invalidRequest()
      }

      const current = service()
      const view = await current.useCases.view({
        // Le périmètre vient de la **session**, jamais du corps ni de l'URL :
        // aucun chemin ne laisse lire au nom d'un autre (`docs/security.md` §3).
        scope: await current.scopeOf(context.session.userId),
        page: page.data,
      })

      return Response.json({
        notifications: view.notifications.map((entry) => ({
          id: entry.id,
          type: entry.type,
          organizationId: entry.organizationId,
          payload: entry.payload,
          createdAt: entry.createdAt.toISOString(),
          read: entry.read,
        })),
        unreadCount: view.unreadCount,
        page: view.page,
        pageCount: view.pageCount,
      })
    },
  }

  const read: ModuleRoute = {
    method: 'POST',
    path: PATHS.read,
    protection: { level: 'authenticated' },
    handler: async (request, context) => {
      if (context.session === null) {
        return notFound()
      }

      const body = READ.safeParse(await submittedBody(request))

      if (!body.success) {
        return invalidRequest()
      }

      const current = service()
      const outcome = await current.useCases.markRead(
        await current.scopeOf(context.session.userId),
        body.data.id,
      )

      return outcome === 'not_found' ? notFound() : backToScreen(request)
    },
  }

  const readAll: ModuleRoute = {
    method: 'POST',
    path: PATHS.readAll,
    protection: { level: 'authenticated' },
    handler: async (request, context) => {
      if (context.session === null) {
        return notFound()
      }

      const current = service()

      await current.useCases.markAllRead(await current.scopeOf(context.session.userId))

      return backToScreen(request)
    },
  }

  const preferences: ModuleRoute = {
    method: 'GET',
    path: PATHS.preferences,
    protection: { level: 'authenticated' },
    handler: async (_request, context) => {
      if (context.session === null) {
        return notFound()
      }

      const current = service()
      const view = await current.useCases.view({
        scope: await current.scopeOf(context.session.userId),
        page: 1,
      })

      return Response.json({ preferences: view.preferences })
    },
  }

  const setPreference: ModuleRoute = {
    method: 'POST',
    path: PATHS.setPreference,
    protection: { level: 'authenticated' },
    handler: async (request, context) => {
      if (context.session === null) {
        return notFound()
      }

      const body = SET_PREFERENCE.safeParse(await submittedBody(request))

      if (!body.success) {
        return invalidRequest()
      }

      const outcome = await service().useCases.setPreference({
        userId: context.session.userId,
        type: body.data.type,
        channel: body.data.channel,
        enabled: body.data.enabled,
      })

      if (outcome === 'unknown_type') {
        // Un type que le catalogue ne déclare pas n'existe pas : **404**, comme
        // une ressource inconnue. Le catalogue est du socle, pas un secret,
        // mais rien n'oblige à confirmer ce qui n'y est pas.
        return notFound()
      }

      // Un canal que **ce type** ne déclare pas est une requête fautive, pas
      // une ressource absente : le type, lui, existe.
      return outcome === 'unknown_channel' ? invalidRequest() : backToScreen(request)
    },
  }

  return [list, read, readAll, preferences, setPreference]
}

/**
 * La navigation du module : **une entrée**, le centre lui-même.
 *
 * `authenticated` pour la même raison que les routes : afficher l'entrée d'un
 * écran auquel on n'a pas accès divulgue son existence et promet ce qu'on
 * refusera ensuite.
 */
export const notificationsNavigation: readonly NavigationEntry[] = [
  {
    id: 'notifications',
    href: NOTIFICATIONS_SCREEN_PATH,
    labelKey: 'navigation.notifications',
    order: 30,
    protection: { level: 'authenticated' },
  },
]
