import type { DemoItem } from '../domain/demo-item'
import type { DemoItemRepository } from '../application/demo-items'

/**
 * Implémentation du port de persistance, en mémoire.
 *
 * Le module déclare bien sa table Drizzle (`src/schema.ts`) — c'est le contrat —
 * mais **jouer** ses migrations est le sujet de s04. Tant que ses tables
 * n'existent pas en base, un repository Drizzle serait un mensonge : celui-ci
 * fait le même travail sans dépendre d'une base, et s04 le remplacera par
 * l'implémentation Drizzle sans toucher ni au `domain`, ni à l'`application`.
 * C'est précisément ce que la règle de dépendance des couches achète.
 */
export function createInMemoryDemoItemRepository(): DemoItemRepository {
  const items = new Map<string, DemoItem>()

  return {
    list: () => Promise.resolve([...items.values()]),

    listOwnedBy: (ownerId) =>
      Promise.resolve([...items.values()].filter((item) => item.ownerId === ownerId)),

    add: (item) => {
      items.set(item.id, item)

      return Promise.resolve()
    },

    removeOwnedBy: (ownerId) => {
      const owned = [...items.values()].filter((item) => item.ownerId === ownerId)

      for (const item of owned) {
        items.delete(item.id)
      }

      return Promise.resolve(owned.length)
    },
  }
}

/**
 * Attribution des identifiants, déterministe.
 *
 * Un compteur plutôt qu'un identifiant aléatoire : l'identité est une décision
 * de la persistance, et un test qui n'a pas besoin de figer un générateur
 * aléatoire est un test de moins à rendre instable.
 */
export function createSequentialIdGenerator(prefix: string): () => string {
  let counter = 0

  return () => {
    counter += 1

    return `${prefix}-${counter}`
  }
}
