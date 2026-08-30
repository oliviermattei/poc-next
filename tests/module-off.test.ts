import { buildRegistry, exportModules, MODULE_ROUTE_PREFIX, purgeModules } from '@repo/core'
import { demoDisabledModule, demoNoteUseCases } from '@repo/module-demo-disabled'
import { demoItemUseCases } from '@repo/module-demo-enabled'
import { describe, expect, it } from 'vitest'

import { GET } from '../apps/web/app/api/modules/[...path]/route'
import { moduleRegistry } from '../apps/web/lib/module-registry'
import { availableModules, enabledModules } from '../config/features'

/**
 * Ce que devient un module que la configuration ne nomme pas.
 *
 * Toutes les assertions de ce fichier sont vraies **dans les deux états** de
 * `config/features.ts` — module de démonstration activé ou non. C'est la
 * condition pour que « la suite passe dans les deux états » veuille dire
 * quelque chose : une suite qui adapte ses attentes à la configuration ne
 * prouve plus rien sur la configuration.
 */

const requestTo = (path: string): Request =>
  new Request(`http://localhost${MODULE_ROUTE_PREFIX}${path}`)

describe('un module non activé', () => {
  it('déclare pourtant bien une route et une entrée de navigation', () => {
    // Sans cette garde, tout ce fichier serait vide de sens : un module qui ne
    // déclare rien n'expose rien, et la démonstration serait un tour de passe-passe.
    expect(demoDisabledModule.routes.length).toBeGreaterThan(0)
    expect(demoDisabledModule.navigation.length).toBeGreaterThan(0)
  })

  it('n’expose aucune route : l’URL déclarée répond 404', async () => {
    const declared = demoDisabledModule.routes[0]?.path ?? ''

    const response = await GET(requestTo(declared))

    expect(response.status).toBe(404)
    // Et surtout : pas la charge utile du module. Un 404 qui aurait exécuté le
    // gestionnaire serait une route exposée qui ment sur son code de retour.
    await expect(response.json()).resolves.not.toHaveProperty('notes')
  })

  it('n’apparaît dans aucune entrée de navigation', () => {
    const entries = moduleRegistry.navigation

    expect(entries.map((entry) => entry.moduleId)).not.toContain(demoDisabledModule.id)
    expect(entries.map((entry) => entry.href)).not.toContain(
      demoDisabledModule.navigation[0]?.href,
    )
  })

  it('ne laisse aucune traduction dans le catalogue de l’application', () => {
    const keys = Object.values(moduleRegistry.messages).flatMap((catalog) =>
      Object.keys(catalog),
    )

    expect(keys.filter((key) => key.startsWith(`${demoDisabledModule.id}.`))).toEqual([])
  })

  it('ne voit ni sa purge ni son export appelés, et cela ne lève rien', async () => {
    const registry = buildRegistry({ available: [...availableModules], enabled: ['demo-enabled'] })
    const scope = { kind: 'user', userId: 'u-purge' } as const

    await demoItemUseCases.addDemoItem({ ownerId: scope.userId, title: 'À effacer' })
    await demoNoteUseCases.addDemoNote({ ownerId: scope.userId, body: 'À conserver' })

    const exported = await exportModules(registry, scope)
    const purged = await purgeModules(registry, scope)

    expect(purged).toEqual(['demo-enabled'])
    expect(Object.keys(exported)).toEqual(['demo-enabled'])

    const items = await demoItemUseCases.listDemoItems()
    const notes = await demoNoteUseCases.listDemoNotes()

    expect(items.filter((item) => item.ownerId === scope.userId)).toEqual([])
    // La purge du module non activé n'a pas eu lieu : ses données sont intactes.
    // Observé sur les données, pas sur une doublure — une doublure prouverait
    // qu'on ne l'a pas appelée, pas qu'il n'y avait rien à appeler.
    expect(notes.filter((note) => note.ownerId === scope.userId)).toHaveLength(1)
  })

  it('refuse d’être activé sans son module requis, en le nommant', () => {
    expect(() =>
      buildRegistry({ available: [...availableModules], enabled: ['demo-disabled'] }),
    ).toThrowError(/« demo-disabled » requiert « demo-enabled »/)
  })
})

describe('le registre monté par l’application', () => {
  it('ne contient que les modules nommés par config/features.ts', () => {
    // Vrai dans les deux états, et c'est ce qui rend le basculement observable :
    // la liste vient de la configuration, jamais de l'annuaire.
    expect(moduleRegistry.moduleIds).toEqual([...enabledModules])
  })

  it('ne monte aucune route hors des modules activés', () => {
    expect(new Set(moduleRegistry.routes.map((route) => route.moduleId))).toEqual(
      new Set(moduleRegistry.moduleIds),
    )
  })

  it('répond 404 sur un chemin d’aucun module', async () => {
    expect((await GET(requestTo('/inexistant'))).status).toBe(404)
  })
})
