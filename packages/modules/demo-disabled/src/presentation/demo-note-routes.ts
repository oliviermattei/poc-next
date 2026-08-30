import { MODULE_ROUTE_PREFIX, type ModuleRoute, type NavigationEntry } from '@repo/core'

import type { DemoNoteUseCases } from '../application/demo-notes'

/**
 * Les routes et la navigation d'un module qui n'est **pas** activé.
 *
 * Elles existent dans le dépôt, complètes et protégées comme celles de
 * n'importe quel module. Ce qui les rend invisibles n'est ni un `if`, ni un
 * `notFound()` : c'est que le registre ne les agrège pas. Aucun chemin de
 * l'application ne mène ici tant que `config/features.ts` ne nomme pas ce
 * module.
 */
export function createDemoNoteRoutes(useCases: DemoNoteUseCases): readonly ModuleRoute[] {
  return [
    {
      method: 'GET',
      path: '/demo-disabled/notes',
      protection: { level: 'public' },
      handler: async () => Response.json({ notes: await useCases.listDemoNotes() }),
    },
  ]
}

export const demoNoteNavigation: readonly NavigationEntry[] = [
  {
    id: 'notes',
    href: `${MODULE_ROUTE_PREFIX}/demo-disabled/notes`,
    labelKey: 'navigation.notes',
    order: 20,
    protection: { level: 'public' },
  },
]
