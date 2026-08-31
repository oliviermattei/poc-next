import { describe, expect, it } from 'vitest'

import type { AnyModuleDefinition, ModuleSession, NavigationEntry } from './module'
import { resolveDataOwner, visibleNavigation } from './protection'
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

/**
 * La résolution du propriétaire d'une donnée, **une seule fonction**.
 *
 * `docs/architecture.md` et `docs/security.md` §3 l'exigent nommément : selon
 * que le module `organizations` est activé ou non, une donnée appartient à une
 * organisation ou directement à un compte, et **le code appelant est identique
 * dans les deux cas**. Ces cas-là sont la preuve que l'appelant est identique :
 * un seul objet d'entrée, un seul champ qui change.
 */
describe('résolution du propriétaire d’une donnée', () => {
  const session: ModuleSession = { userId: 'usr_1', roles: [] }

  it('rattache la donnée au compte quand aucune organisation n’est active', () => {
    // C'est l'état du mode mono-utilisateur : module coupé, le point de
    // composition rend toujours `null`.
    expect(resolveDataOwner({ session, activeOrganizationId: null })).toEqual({
      kind: 'user',
      userId: 'usr_1',
    })
  })

  it('rattache la donnée à l’organisation active quand il y en a une', () => {
    expect(resolveDataOwner({ session, activeOrganizationId: 'org_1' })).toEqual({
      kind: 'organization',
      organizationId: 'org_1',
    })
  })

  it('ne mélange jamais les deux : le périmètre organisation ne porte pas de compte', () => {
    // Un périmètre qui porterait les deux laisserait l'appelant choisir lequel
    // filtrer — c'est-à-dire réintroduire la duplication que cette fonction
    // existe pour empêcher.
    expect(Object.keys(resolveDataOwner({ session, activeOrganizationId: 'org_1' })).sort()).toEqual(
      ['kind', 'organizationId'],
    )
  })
})
