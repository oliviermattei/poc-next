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
  surface?: NavigationEntry['surface'],
): NavigationEntry => ({
  id,
  href: `/${id}`,
  labelKey: `nav.${id}`,
  order,
  protection,
  ...(surface === undefined ? {} : { surface }),
})

const moduleWith = (entries: readonly NavigationEntry[]): AnyModuleDefinition => ({
  id: 'm',
  requires: [],
  schema: {},
  migrations: null,
  routes: [],
  navigation: entries,
  publicUrls: () => [],
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
      entry('pied', 40, { level: 'public' }, 'footer'),
      entry('pied-prive', 50, { level: 'authenticated' }, 'footer'),
    ]),
  ],
  enabled: ['m'],
  // Le module d'essai ne déclare que le français : c'est contre l'ensemble
  // reçu, et non contre le sien, que sa complétude est jugée.
  locales: ['fr'],
})

const visibleIds = (session: ModuleSession | null): readonly string[] =>
  visibleNavigation(registry, session).map((navigation) => navigation.id)

const footerIds = (session: ModuleSession | null): readonly string[] =>
  visibleNavigation(registry, session, 'footer').map((navigation) => navigation.id)

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

  /**
   * **Une entrée est déclarée pour une surface** (s31).
   *
   * Le pied de page du site public annonçait ses liens par un import nommé du
   * socle — `consentFooterLinks`, écrit dans sept fichiers de `apps/web/app`.
   * Un second module à y mettre en aurait fait un second nom aux sept mêmes
   * endroits. La surface est donc déclarée au contrat, et le pied de page se
   * dérive du registre comme la barre latérale.
   *
   * Les deux sens comptent, et le premier est celui qu'on oublie : une entrée
   * de pied de page ne doit **pas** paraître dans la barre latérale, où elle
   * mettrait un lien de service au rang des fonctionnalités du produit.
   */
  it('ne mélange pas les surfaces : le pied de page n’est pas la barre latérale', () => {
    expect(visibleIds({ userId: 'u', roles: ['admin'] })).not.toContain('pied')
    expect(footerIds(null)).toEqual(['pied'])
    expect(footerIds(null)).not.toContain('public')
  })

  it('applique la même protection sur le pied de page que sur la barre latérale', () => {
    // Sans quoi la surface serait une porte dérobée : une entrée réservée
    // deviendrait publique en changeant de surface.
    expect(footerIds({ userId: 'u', roles: [] })).toEqual(['pied', 'pied-prive'])
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
