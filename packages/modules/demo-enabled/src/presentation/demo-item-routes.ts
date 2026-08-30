import type { ModuleRoute, NavigationEntry } from '@repo/core'
import { z } from 'zod'

import { InvalidDemoItemError } from '../domain/demo-item'
import type { DemoItemUseCases } from '../application/demo-items'

/**
 * Routes et navigation du module.
 *
 * Chaque route déclare son **niveau de protection** : c'est le contrat qui rend
 * le §3 du socle de sécurité vérifiable par le registre plutôt que par
 * relecture. Le répartiteur refuse avant d'appeler le gestionnaire — une route
 * `authenticated` n'est jamais exécutée sans session.
 */

/** Zod à la frontière (socle de sécurité §4) : le corps entrant n'est pas de confiance. */
const createItemBodySchema = z.object({ title: z.string() })

const badRequest = (reason: string): Response =>
  Response.json({ error: 'invalid_request', reason }, { status: 400 })

export function createDemoItemRoutes(useCases: DemoItemUseCases): readonly ModuleRoute[] {
  return [
    {
      method: 'GET',
      path: '/demo-enabled/items',
      protection: { level: 'public' },
      handler: async () => Response.json({ items: await useCases.listDemoItems() }),
    },
    {
      method: 'POST',
      path: '/demo-enabled/items',
      protection: { level: 'authenticated' },
      handler: async (request, context) => {
        // Le répartiteur a déjà refusé l'appel anonyme ; sans session ici, c'est
        // le montage qui est cassé, et servir la requête serait pire que
        // d'échouer.
        if (context.session === null) {
          return badRequest('session absente')
        }

        const body: unknown = await request.json().catch(() => null)
        const parsed = createItemBodySchema.safeParse(body)

        if (!parsed.success) {
          return badRequest('titre manquant')
        }

        try {
          const item = await useCases.addDemoItem({
            ownerId: context.session.userId,
            title: parsed.data.title,
          })

          return Response.json({ item }, { status: 201 })
        } catch (error) {
          if (error instanceof InvalidDemoItemError) {
            return badRequest(error.message)
          }

          throw error
        }
      },
    },
    {
      method: 'GET',
      path: '/demo-enabled/admin/report',
      protection: { level: 'role', role: 'admin' },
      handler: async () => Response.json({ count: (await useCases.listDemoItems()).length }),
    },
  ]
}

export const demoItemNavigation: readonly NavigationEntry[] = [
  {
    id: 'items',
    href: '/demo-enabled/items',
    labelKey: 'navigation.items',
    order: 10,
    protection: { level: 'public' },
  },
]
