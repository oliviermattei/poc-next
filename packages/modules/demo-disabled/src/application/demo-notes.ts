import type { ModuleExportPayload, ModuleScope } from '@repo/core'

import { createDemoNote, type DemoNote } from '../domain/demo-note'

/** Port de persistance des notes. */
export interface DemoNoteRepository {
  list(): Promise<readonly DemoNote[]>
  listOwnedBy(ownerId: string): Promise<readonly DemoNote[]>
  add(note: DemoNote): Promise<void>
  removeOwnedBy(ownerId: string): Promise<number>
}

/** Le propriétaire d'une donnée est résolu par une fonction unique. */
export function ownerIdOf(scope: ModuleScope): string {
  return scope.kind === 'user' ? scope.userId : scope.organizationId
}

export interface DemoNoteUseCases {
  listDemoNotes: () => Promise<readonly DemoNote[]>
  addDemoNote: (input: { ownerId: string; body: string }) => Promise<DemoNote>
  purgeDemoNotes: (scope: ModuleScope) => Promise<void>
  exportDemoNotes: (scope: ModuleScope) => Promise<ModuleExportPayload>
}

export function createDemoNoteUseCases(dependencies: {
  readonly repository: DemoNoteRepository
  readonly generateId: () => string
}): DemoNoteUseCases {
  const { repository, generateId } = dependencies

  return {
    listDemoNotes: () => repository.list(),

    addDemoNote: async (input) => {
      const note = createDemoNote({
        id: generateId(),
        ownerId: input.ownerId,
        body: input.body,
      })

      await repository.add(note)

      return note
    },

    // Ces deux fonctions ne doivent **jamais** être appelées tant que le module
    // n'est pas activé : c'est ce que `tests/module-off.test.ts` observe, sans
    // doublure — une purge qui n'a pas eu lieu se voit aux données restées en
    // place.
    purgeDemoNotes: async (scope) => {
      await repository.removeOwnedBy(ownerIdOf(scope))
    },

    exportDemoNotes: async (scope) => ({
      notes: await repository.listOwnedBy(ownerIdOf(scope)),
    }),
  }
}
