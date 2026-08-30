import type { DemoNote } from '../domain/demo-note'
import type { DemoNoteRepository } from '../application/demo-notes'

/** Implémentation en mémoire du port, en attendant les migrations de s04. */
export function createInMemoryDemoNoteRepository(): DemoNoteRepository {
  const notes = new Map<string, DemoNote>()

  return {
    list: () => Promise.resolve([...notes.values()]),

    listOwnedBy: (ownerId) =>
      Promise.resolve([...notes.values()].filter((note) => note.ownerId === ownerId)),

    add: (note) => {
      notes.set(note.id, note)

      return Promise.resolve()
    },

    removeOwnedBy: (ownerId) => {
      const owned = [...notes.values()].filter((note) => note.ownerId === ownerId)

      for (const note of owned) {
        notes.delete(note.id)
      }

      return Promise.resolve(owned.length)
    },
  }
}

export function createSequentialIdGenerator(prefix: string): () => string {
  let counter = 0

  return () => {
    counter += 1

    return `${prefix}-${counter}`
  }
}
