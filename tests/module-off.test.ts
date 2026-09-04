import {
  buildRegistry,
  exportModules,
  MODULE_ROUTE_PREFIX,
  purgeModules,
} from '@repo/core'
import { demoDisabledModule, demoNoteUseCases } from '@repo/module-demo-disabled'
import { demoItemUseCases } from '@repo/module-demo-enabled'
import { describe, expect, it } from 'vitest'

import { GET } from '../apps/web/app/api/modules/[...path]/route'
import { moduleRegistry } from '../apps/web/lib/module-registry'
import { availableModules, enabledModules } from '../config/features'
import { appLocales } from '../config/i18n'
import { dispatchAllowingRateLimit } from './fixtures/rate-limit'

/**
 * Ce que devient un module que la configuration ne nomme pas.
 *
 * Toutes les assertions de ce fichier sont vraies **quelle que soit** la
 * configuration du dépôt, et elles le sont par construction : ce qui doit
 * observer un module exclu construit son propre registre, au lieu d'observer
 * celui de l'application et d'espérer que `config/features.ts` n'a pas bougé.
 * Un test qui n'est vrai que dans l'état courant du dépôt ne prouve rien sur la
 * modularité — et il obligerait la recette de s26, qui exécute cette suite sous
 * plusieurs configurations, à porter une liste d'exceptions.
 *
 * Le registre de l'application n'est observé que là où l'assertion est
 * elle-même dérivée de la configuration (`enabledModules`), donc vraie dans
 * tous les états.
 */

const requestTo = (path: string): Request =>
  new Request(`http://localhost${MODULE_ROUTE_PREFIX}${path}`)

/**
 * Une configuration où `demo-disabled` est exclu **par le test**. C'est ce qui
 * rend les assertions ci-dessous indépendantes de `config/features.ts` : elles
 * portent sur l'exclusion, pas sur l'état du dépôt.
 */
const withoutDemoDisabled = buildRegistry({
  available: [...availableModules],
  enabled: ['demo-enabled'],
  locales: [...appLocales],
})

describe('un module non activé', () => {
  it('déclare pourtant bien une route et une entrée de navigation', () => {
    // Sans cette garde, tout ce fichier serait vide de sens : un module qui ne
    // déclare rien n'expose rien, et la démonstration serait un tour de passe-passe.
    expect(demoDisabledModule.routes.length).toBeGreaterThan(0)
    expect(demoDisabledModule.navigation.length).toBeGreaterThan(0)
  })

  it('n’expose aucune route : l’URL déclarée répond 404', async () => {
    const declared = demoDisabledModule.routes[0]?.path ?? ''

    const response = await dispatchAllowingRateLimit(withoutDemoDisabled, requestTo(declared))

    expect(response.status).toBe(404)
    // Et surtout : pas la charge utile du module. Un 404 qui aurait exécuté le
    // gestionnaire serait une route exposée qui ment sur son code de retour.
    await expect(response.json()).resolves.not.toHaveProperty('notes')
  })

  it('n’apparaît dans aucune entrée de navigation', () => {
    const entries = withoutDemoDisabled.navigation

    expect(entries.map((entry) => entry.moduleId)).not.toContain(demoDisabledModule.id)
    expect(entries.map((entry) => entry.href)).not.toContain(
      demoDisabledModule.navigation[0]?.href,
    )
  })

  it('ne laisse aucune traduction dans le catalogue de l’application', () => {
    const keys = Object.values(withoutDemoDisabled.messages).flatMap((catalog) =>
      Object.keys(catalog),
    )

    expect(keys.filter((key) => key.startsWith(`${demoDisabledModule.id}.`))).toEqual([])
  })

  it('ne voit ni sa purge ni son export appelés, et cela ne lève rien', async () => {
    const registry = withoutDemoDisabled
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
      buildRegistry({
        available: [...availableModules],
        enabled: ['demo-disabled'],
        locales: [...appLocales],
      }),
    ).toThrowError(/« demo-disabled » requiert « demo-enabled »/)
  })
})

describe('le registre monté par l’application', () => {
  it('ne contient que les modules nommés par config/features.ts', () => {
    // Vrai dans les deux états, et c'est ce qui rend le basculement observable :
    // la liste vient de la configuration, jamais de l'annuaire.
    //
    // Comparaison d'**ensembles**, pas de suites : `moduleIds` vient du graphe
    // des requis, pas de l'ordre de déclaration. Le jour où la configuration
    // listera légitimement un module avant son requis, une égalité de tableaux
    // rougirait sans qu'aucune régression n'ait eu lieu (revue de s03, F7).
    // L'ordre dérivé du graphe est vérifié pour lui-même dans
    // `tests/module-registry.test.ts`.
    expect(new Set(moduleRegistry.moduleIds)).toEqual(new Set(enabledModules))
  })

  it('ne monte aucune route hors des modules activés', () => {
    // **Inclusion**, et non égalité : un module activé a le droit de ne
    // déclarer aucune route — `i18n` n'en déclare aucune, il apporte la forme
    // des URL et le sélecteur. L'égalité disait « tout module activé monte au
    // moins une route », ce qui n'est écrit nulle part et rougissait sur une
    // addition légitime. Ce qui compte est l'inverse, et il est conservé :
    // aucune route ne vient d'ailleurs que des modules activés.
    const mounted = new Set(moduleRegistry.routes.map((route) => route.moduleId))

    expect(mounted.size).toBeGreaterThan(0)

    for (const moduleId of mounted) {
      expect(moduleRegistry.moduleIds).toContain(moduleId)
    }
  })

  it('répond 404 sur un chemin d’aucun module', async () => {
    expect((await GET(requestTo('/inexistant'))).status).toBe(404)
  })
})
