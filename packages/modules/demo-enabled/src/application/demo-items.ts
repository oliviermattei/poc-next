import type { ModuleExportPayload, ModuleScope } from '@repo/core'

import { createDemoItem, type DemoItem } from '../domain/demo-item'

/**
 * Cas d'usage et **ports** du module (ADR 006).
 *
 * Cette couche ne connaît ni la base, ni le transport : elle déclare ce dont
 * elle a besoin (`DemoItemRepository`, `generateId`) et `infrastructure/` en
 * fournit une implémentation. C'est ce qui rend la règle testable sans base ni
 * réseau, et le module portable d'un provider à l'autre.
 */

/** Port de persistance des éléments. */
export interface DemoItemRepository {
  list(): Promise<readonly DemoItem[]>
  listOwnedBy(ownerId: string): Promise<readonly DemoItem[]>
  add(item: DemoItem): Promise<void>
  removeOwnedBy(ownerId: string): Promise<number>
}

/**
 * Le propriétaire d'une donnée est résolu par une fonction **unique**
 * (`docs/architecture.md`) : le code appelant est identique que la donnée
 * appartienne à une organisation ou directement à un utilisateur.
 */
export function ownerIdOf(scope: ModuleScope): string {
  return scope.kind === 'user' ? scope.userId : scope.organizationId
}

export interface DemoItemUseCases {
  listDemoItems: () => Promise<readonly DemoItem[]>
  addDemoItem: (input: { ownerId: string; title: string }) => Promise<DemoItem>
  purgeDemoItems: (scope: ModuleScope) => Promise<void>
  exportDemoItems: (scope: ModuleScope) => Promise<ModuleExportPayload>
}

export function createDemoItemUseCases(dependencies: {
  readonly repository: DemoItemRepository
  readonly generateId: () => string
}): DemoItemUseCases {
  const { repository, generateId } = dependencies

  return {
    listDemoItems: () => repository.list(),

    addDemoItem: async (input) => {
      // La règle est appliquée **avant** toute écriture : un titre refusé ne
      // doit rien laisser en persistance.
      const item = createDemoItem({
        id: generateId(),
        ownerId: input.ownerId,
        title: input.title,
      })

      await repository.add(item)

      return item
    },

    purgeDemoItems: async (scope) => {
      await repository.removeOwnedBy(ownerIdOf(scope))
    },

    exportDemoItems: async (scope) => ({
      items: await repository.listOwnedBy(ownerIdOf(scope)),
    }),
  }
}
