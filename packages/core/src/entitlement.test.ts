import { describe, expect, it } from 'vitest'

import {
  FeatureGateError,
  allowsFeature,
  assertGatesCoverRoutes,
  entitledFeatureIds,
  entitlementFeatureOf,
  parseFeatureGates,
} from './entitlement'
import type { AnyModuleDefinition, ModuleRoute, NavigationEntry } from './module'
import { satisfiesProtection } from './protection'
import { buildRegistry } from './registry'

/**
 * **Ce qu'une fonctionnalité réservée ouvre, et à qui** — la règle du gating,
 * éprouvée là où elle vit (ADR 043).
 *
 * Elle est dans `@repo/core` et non dans le module de facturation pour une
 * raison exécutable : elle doit répondre quand ce module est **coupé**. C'est la
 * même raison qui a mis `resolveDataOwner` ici.
 */

const GATES = [
  { id: 'premium-report', offers: ['pro-monthly', 'pro-yearly', 'lifetime'] },
  { id: 'exports', offers: ['pro-yearly'] },
] as const

describe('la déclaration des fonctionnalités réservées', () => {
  it('accepte une déclaration bien formée et la rend telle quelle', () => {
    expect(parseFeatureGates([...GATES])).toEqual([...GATES])
  })

  /**
   * **Chaque refus nomme la déclaration et le champ fautifs.** Un message qui
   * dit « configuration invalide » oblige à relire toute la liste, et c'est
   * exactement le moment où quelqu'un désactive la validation
   * (`docs/security.md` §5).
   */
  const refusals: readonly { readonly why: string; readonly value: unknown; readonly names: string }[] = [
    { why: 'une liste qui n’en est pas une', value: { id: 'x' }, names: 'config/gating.ts' },
    {
      why: 'un identifiant qui n’est pas en kebab-case',
      value: [{ id: 'Premium Report', offers: ['pro-monthly'] }],
      names: 'Premium Report',
    },
    {
      why: 'une fonctionnalité sans aucune offre',
      value: [{ id: 'premium-report', offers: [] }],
      names: 'offers',
    },
    {
      why: 'une offre qui n’est pas une chaîne',
      value: [{ id: 'premium-report', offers: [42] }],
      names: 'offers',
    },
    {
      why: 'un identifiant déclaré deux fois',
      value: [
        { id: 'premium-report', offers: ['pro-monthly'] },
        { id: 'premium-report', offers: ['pro-yearly'] },
      ],
      names: 'premium-report',
    },
  ]

  for (const refusal of refusals) {
    it(`refuse ${refusal.why}, en nommant ce qui cloche`, () => {
      expect(() => parseFeatureGates(refusal.value)).toThrow(FeatureGateError)
      expect(() => parseFeatureGates(refusal.value)).toThrow(refusal.names)
    })
  }

  /**
   * Une offre inconnue est une **faute de configuration**, pas une
   * fonctionnalité que personne n'ouvre : elle rendrait la fonctionnalité
   * inaccessible pour toujours, en silence, à qui a pourtant payé.
   */
  it('refuse une offre qui n’est pas au catalogue, en la nommant', () => {
    expect(() =>
      parseFeatureGates([{ id: 'premium-report', offers: ['pro-monthly', 'pro-quarterly'] }], {
        offers: ['pro-monthly', 'lifetime'],
      }),
    ).toThrow('pro-quarterly')
  })

  it('accepte les offres présentes au catalogue', () => {
    expect(
      parseFeatureGates([{ id: 'premium-report', offers: ['pro-monthly'] }], {
        offers: ['pro-monthly', 'lifetime'],
      }),
    ).toHaveLength(1)
  })
})

describe('ce qu’une offre détenue ouvre', () => {
  it('ouvre la fonctionnalité dès qu’une des offres déclarées est détenue', () => {
    expect(allowsFeature(GATES[0], ['lifetime'])).toBe(true)
  })

  it('ne l’ouvre pas sur une offre qui ne la déclare pas', () => {
    expect(allowsFeature(GATES[1], ['pro-monthly'])).toBe(false)
  })

  it('n’ouvre rien à qui ne détient aucune offre', () => {
    expect(allowsFeature(GATES[0], [])).toBe(false)
  })

  it('rend l’ensemble des fonctionnalités ouvertes par les offres détenues', () => {
    expect([...entitledFeatureIds([...GATES], ['pro-yearly'])].sort()).toEqual([
      'exports',
      'premium-report',
    ])
    expect([...entitledFeatureIds([...GATES], ['lifetime'])]).toEqual(['premium-report'])
  })
})

/**
 * Le quatrième niveau de protection déclaré.
 *
 * `satisfiesProtection` n'en répond que la **moitié session** : elle est
 * synchrone, et savoir quelles offres un périmètre détient demande une lecture.
 * L'autre moitié est celle du répartiteur, et elle est fail-closed.
 */
describe('le niveau de protection « entitlement »', () => {
  it('nomme la fonctionnalité qu’une route réserve, et rien sur les trois autres niveaux', () => {
    expect(entitlementFeatureOf({ level: 'entitlement', feature: 'premium-report' })).toBe(
      'premium-report',
    )
    expect(entitlementFeatureOf({ level: 'public' })).toBeNull()
    expect(entitlementFeatureOf({ level: 'authenticated' })).toBeNull()
    expect(entitlementFeatureOf({ level: 'role', role: 'admin' })).toBeNull()
  })

  it('exige une session, comme une route authentifiée', () => {
    const protection = { level: 'entitlement', feature: 'premium-report' } as const

    expect(satisfiesProtection(protection, null)).toBe(false)
    expect(satisfiesProtection(protection, { userId: 'u', roles: [] })).toBe(true)
  })
})

/**
 * **Une fonctionnalité réservée que rien ne déclare n'est ouverte par
 * personne.** C'est le pendant de la leçon de s17 : « une action qui n'a pas de
 * ligne dans la matrice n'est refusée par personne » — ici, c'est l'inverse
 * exact, et c'est pire : elle serait refusée à tout le monde pour toujours, sans
 * qu'aucune commande ne le dise. Le démarrage la nomme.
 */
describe('la couverture des routes réservées par les déclarations', () => {
  const route = (protection: ModuleRoute['protection']): ModuleRoute => ({
    method: 'GET',
    path: '/m/premium',
    protection,
    handler: () => Promise.resolve(Response.json({})),
  })

  const navigation = (protection: NavigationEntry['protection']): NavigationEntry => ({
    id: 'premium',
    href: '/m/premium',
    labelKey: 'navigation.premium',
    order: 10,
    protection,
  })

  const registryWith = (
    routes: readonly ModuleRoute[],
    entries: readonly NavigationEntry[],
  ): ReturnType<typeof buildRegistry> => {
    const module: AnyModuleDefinition = {
      id: 'm',
      requires: [],
      schema: {},
      migrations: null,
      routes,
      navigation: entries,
      publicUrls: () => [],
      messages: { fr: Object.fromEntries(entries.map((entry) => [entry.labelKey, entry.id])) },
      emails: [],
      webhooks: [],
      jobs: [],
      dataCategories: [],
      retention: {},
      purge: () => Promise.resolve(),
      export: () => Promise.resolve({}),
    }

    return buildRegistry({ available: [module], enabled: ['m'], locales: ['fr'] })
  }

  it('accepte un dépôt dont chaque route réservée nomme une fonctionnalité déclarée', () => {
    expect(() =>
      assertGatesCoverRoutes(
        registryWith([route({ level: 'entitlement', feature: 'premium-report' })], []),
        [...GATES],
      ),
    ).not.toThrow()
  })

  it('refuse une route qui réserve une fonctionnalité que personne ne déclare', () => {
    expect(() =>
      assertGatesCoverRoutes(registryWith([route({ level: 'entitlement', feature: 'ghost' })], []), [
        ...GATES,
      ]),
    ).toThrow('ghost')
  })

  it('refuse aussi une entrée de navigation réservée sans déclaration', () => {
    expect(() =>
      assertGatesCoverRoutes(
        registryWith([], [navigation({ level: 'entitlement', feature: 'ghost' })]),
        [...GATES],
      ),
    ).toThrow(FeatureGateError)
  })
})
