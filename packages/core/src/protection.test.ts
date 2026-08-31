import { describe, expect, it } from 'vitest'

import type { AnyModuleDefinition, ModuleSession, NavigationEntry } from './module'
import { visibleNavigation } from './protection'
import { buildRegistry } from './registry'

/**
 * Qui voit quoi dans la navigation.
 *
 * La règle vit ici, et elle est énumérée ici : les trois niveaux de protection
 * face aux trois appelants possibles. Ses appelants — la navigation de
 * `apps/web`, plus tard un écran de module — n'ont qu'à prouver qu'ils
 * l'appellent, pas à rejouer la matrice.
 */

const entry = (
  id: string,
  order: number,
  protection: NavigationEntry['protection'],
): NavigationEntry => ({
  id,
  href: `/${id}`,
  labelKey: `nav.${id}`,
  order,
  protection,
})

const moduleWith = (entries: readonly NavigationEntry[]): AnyModuleDefinition => ({
  id: 'm',
  requires: [],
  schema: {},
  migrations: null,
  routes: [],
  navigation: entries,
  messages: {
    fr: Object.fromEntries(entries.map((navigation) => [navigation.labelKey, navigation.id])),
  },
  emails: [],
  webhooks: [],
  jobs: [],
  dataCategories: [],
  retention: {},
  purge: () => Promise.resolve(),
  export: () => Promise.resolve({}),
})

const registry = buildRegistry({
  available: [
    moduleWith([
      entry('public', 10, { level: 'public' }),
      entry('membre', 20, { level: 'authenticated' }),
      entry('admin', 30, { level: 'role', role: 'admin' }),
    ]),
  ],
  enabled: ['m'],
  // Le module d'essai ne déclare que le français : c'est contre l'ensemble
  // reçu, et non contre le sien, que sa complétude est jugée.
  locales: ['fr'],
})

const visibleIds = (session: ModuleSession | null): readonly string[] =>
  visibleNavigation(registry, session).map((navigation) => navigation.id)

describe('navigation visible selon la protection déclarée', () => {
  it('ne montre à un visiteur anonyme que les entrées publiques', () => {
    // Afficher l'entrée d'un écran auquel on n'a pas accès divulgue son
    // existence et promet ce qu'on refusera ensuite (`docs/security.md` §3).
    expect(visibleIds(null)).toEqual(['public'])
  })

  it('montre les entrées authentifiées à une session, pas celles d’un rôle qu’elle n’a pas', () => {
    expect(visibleIds({ userId: 'u', roles: [] })).toEqual(['public', 'membre'])
  })

  it('montre l’entrée réservée à un rôle à la session qui le porte', () => {
    expect(visibleIds({ userId: 'u', roles: ['admin'] })).toEqual(['public', 'membre', 'admin'])
  })
})
