import { buildRegistry, visibleNavigation } from '@repo/core'
import { adminModule, type AdminRevenueView } from '@repo/module-admin'
import { authModule } from '@repo/module-auth'
import { billingModule } from '@repo/module-billing'
import { marketingModule } from '@repo/module-marketing'
import { organizationsModule } from '@repo/module-organizations'
import { describe, expect, it, vi } from 'vitest'

import { appLocales } from '../config/i18n'

/**
 * **La console** (s60, ADR 070 et 071).
 *
 * Ce que ce fichier prouve sans navigateur :
 *
 * 1. **la garde du layout** — elle s'ajoute à celle de chaque lecture, si bien
 *    qu'aucun parcours navigateur ne la voit seule : un écran gardé par sa
 *    lecture rend le même 404 qu'elle. Elle est donc éprouvée ici, sur le
 *    layout lui-même, avec ses quatre appelants ;
 * 2. **les tuiles du tableau de bord** — dérivées des entrées `console`
 *    visibles, jamais d'un nom de module : un module coupé retire sa tuile,
 *    le revenu reste une ligne par devise, et une lecture en échec ne touche
 *    que sa tuile. Les registres sont construits comme dans
 *    `tests/admin.test.ts`, en coupant **réellement** les modules.
 *
 * Les deux points de composition qu'elle lit — le module monté, l'appelant —
 * sont doublés : ce sont du contexte de requête et de configuration, pas la
 * règle. La règle, c'est l'ordre et la conjonction des refus, écrits dans le
 * layout.
 */

const state = vi.hoisted(() => ({
  available: true,
  session: null as { readonly userId: string; readonly roles: readonly string[] } | null,
  impersonatedBy: null as string | null,
  superadmins: new Set<string>(),
  /** Ce que la garde a demandé : un refus qui lit plus loin est une fuite. */
  asked: [] as string[],
}))

vi.mock('../apps/web/lib/admin', () => ({
  admin: {
    get available() {
      return state.available
    },
    isSuperadmin: (userId: string) => {
      state.asked.push(`isSuperadmin:${userId}`)

      return Promise.resolve(state.superadmins.has(userId))
    },
  },
}))

vi.mock('../apps/web/lib/auth', () => ({
  currentViewer: () => {
    state.asked.push('currentViewer')

    return Promise.resolve({
      session: state.session,
      account: null,
      impersonatedBy: state.impersonatedBy,
    })
  },
}))

/** Les en-têtes de la requête, pour le nonce que le layout relit. */
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }))

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404/

const renderLayout = async (): Promise<unknown> => {
  const { default: ConsoleLayout } = await import('../apps/web/app/(console)/layout')

  return await ConsoleLayout({ children: 'contenu' })
}

const given = (input: Partial<Omit<typeof state, 'asked' | 'superadmins'>> & {
  readonly superadmin?: boolean
}): void => {
  state.available = input.available ?? true
  state.session = input.session === undefined ? { userId: 'usr_1', roles: [] } : input.session
  state.impersonatedBy = input.impersonatedBy ?? null
  state.superadmins = new Set(input.superadmin === true ? ['usr_1'] : [])
  state.asked = []
}

const digestOf = async (): Promise<string | null> =>
  await renderLayout().then(
    () => null,
    (error: unknown) => String((error as { digest?: unknown }).digest ?? error),
  )

describe('la garde du layout de la console', () => {
  it('rend la console au superadmin', async () => {
    given({ superadmin: true })

    // Le témoin positif : sans lui, chaque refus ci-dessous serait vrai parce
    // que le layout refuse tout le monde.
    expect(await digestOf()).toBeNull()
  })

  it('répond 404 à tout le monde quand le module est coupé, sans lire la session', async () => {
    given({ available: false, superadmin: true })

    expect(await digestOf()).toMatch(NOT_FOUND)
    // Refusé **avant** la session : une zone qui n'existe pas n'ouvre aucune
    // lecture pour le dire.
    expect(state.asked).toEqual([])
  })

  it('répond 404 à un visiteur anonyme, sans redirection vers la connexion', async () => {
    given({ session: null })

    const digest = await digestOf()

    expect(digest).toMatch(NOT_FOUND)
    expect(digest).not.toMatch(/NEXT_REDIRECT/)
  })

  it('répond 404 à une session empruntée, même quand l’emprunteur est superadmin', async () => {
    given({ superadmin: true, impersonatedBy: 'usr_emprunteur' })

    expect(await digestOf()).toMatch(NOT_FOUND)
  })

  it('répond 404 à un compte qui n’est pas superadmin', async () => {
    given({ superadmin: false })

    expect(await digestOf()).toMatch(NOT_FOUND)
    expect(state.asked).toContain('isSuperadmin:usr_1')
  })
})

const ALL = ['auth', 'admin', 'organizations', 'billing', 'marketing'] as const

const consoleEntries = (enabled: readonly string[]) =>
  visibleNavigation(
    buildRegistry({
      available: [authModule, adminModule, organizationsModule, billingModule, marketingModule],
      enabled: [...enabled],
      locales: [...appLocales],
    }),
    { userId: 'usr_1', roles: [] },
    'console',
  )

const readsOf = async (enabled: readonly string[]): Promise<readonly (string | null)[]> => {
  const { consoleTileSlots } = await import('../apps/web/lib/console')

  return consoleTileSlots(consoleEntries(enabled)).map((slot) => slot.read)
}

const revenueView = (recurring: AdminRevenueView['revenue']['recurring']): AdminRevenueView => ({
  revenue: {
    recurring,
    recurringUnvalued: 2,
    oneTime: [],
    oneTimeUnvalued: 0,
    states: [],
    periods: [],
  },
})

describe('les tuiles du tableau de bord se dérivent des entrées de la console', () => {
  it('rend une tuile par écran, sans le tableau de bord lui-même', async () => {
    // Le témoin positif : les quatre lectures, dans l'ordre du registre. Sans
    // lui, les absences ci-dessous seraient vraies sur une liste vide.
    expect(await readsOf(ALL)).toEqual(['accounts', 'organizations', 'revenue', 'subscriptions'])
  })

  it('retire la tuile de revenu avec le module de facturation, et garde les autres', async () => {
    expect(await readsOf(ALL.filter((id) => id !== 'billing'))).toEqual([
      'accounts',
      'organizations',
      'subscriptions',
    ])
  })

  it('retire la tuile des inscriptions avec le site public, et garde les autres', async () => {
    expect(await readsOf(ALL.filter((id) => id !== 'marketing'))).toEqual([
      'accounts',
      'organizations',
      'revenue',
    ])
  })

  it('rend une tuile sans nombre pour une entrée dont aucune lecture n’est connue', async () => {
    const { consoleTileSlots, consoleTiles } = await import('../apps/web/lib/console')
    const slots = consoleTileSlots([
      ...consoleEntries(['auth', 'admin']),
      {
        moduleId: 'autre',
        id: 'rapport',
        href: '/console/rapport',
        labelKey: 'autre.navigation.rapport',
        order: 90,
        protection: { level: 'authenticated' },
        surface: 'console',
      },
    ])

    const tiles = consoleTiles(slots, { accounts: { ok: true, view: { kind: 'count', total: 3 } } })

    expect(tiles?.map((tile) => [tile.href, tile.figure.kind])).toEqual([
      ['/console/users', 'count'],
      ['/console/rapport', 'link'],
    ])
  })
})

describe('les chiffres des tuiles', () => {
  it('rend le revenu récurrent en une ligne par devise, jamais en une somme', async () => {
    const { revenueFigure } = await import('../apps/web/lib/console')

    const figure = revenueFigure(
      revenueView([
        { currency: 'eur', amount: 1_248_000, subscriptions: 40 },
        { currency: 'usd', amount: 312_000, subscriptions: 10 },
      ]),
    )

    expect(figure).toEqual({
      kind: 'money',
      lines: [
        { currency: 'eur', amount: 1_248_000 },
        { currency: 'usd', amount: 312_000 },
      ],
      unvalued: 2,
    })
  })

  it('met une lecture en échec dans sa seule tuile, et garde les chiffres des autres', async () => {
    const { consoleTileSlots, consoleTiles } = await import('../apps/web/lib/console')

    const tiles = consoleTiles(consoleTileSlots(consoleEntries(ALL)), {
      accounts: { ok: true, view: { kind: 'count', total: 12 } },
      organizations: { ok: false, error: 'unavailable' },
      revenue: { ok: true, view: { kind: 'money', lines: [], unvalued: 0 } },
      subscriptions: { ok: true, view: { kind: 'count', total: 4 } },
    })

    expect(tiles?.map((tile) => tile.figure)).toEqual([
      { kind: 'count', total: 12 },
      { kind: 'error' },
      { kind: 'money', lines: [], unvalued: 0 },
      { kind: 'count', total: 4 },
    ])
  })

  it('refuse tout le tableau de bord quand une lecture répond « introuvable »', async () => {
    const { consoleTileSlots, consoleTiles } = await import('../apps/web/lib/console')

    // `not_found` est la réponse d'une lecture à qui n'administre pas : le
    // tableau de bord répond alors 404, comme chaque écran — jamais une tuile
    // en erreur qui confirmerait la console.
    expect(
      consoleTiles(consoleTileSlots(consoleEntries(ALL)), {
        accounts: { ok: false, error: 'not_found' },
        organizations: { ok: true, view: { kind: 'count', total: 1 } },
        revenue: { ok: true, view: { kind: 'money', lines: [], unvalued: 0 } },
        subscriptions: { ok: true, view: { kind: 'count', total: 1 } },
      }),
    ).toBeNull()
  })
})
