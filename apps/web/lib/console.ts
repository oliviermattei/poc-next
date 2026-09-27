import type { RegistryNavigationEntry } from '@repo/core'
import {
  ADMIN_USERS_SCREEN_PATH,
  CONSOLE_SCREEN_PATH,
  type AdminRevenueView,
  type BackOfficeView,
} from '@repo/module-admin'
import { ADMIN_REVENUE_SCREEN_PATH } from '@repo/module-billing'
import { ADMIN_SUBSCRIPTIONS_SCREEN_PATH } from '@repo/module-marketing'
import { ADMIN_ORGANIZATIONS_SCREEN_PATH } from '@repo/module-organizations'

import { admin } from './admin'

/**
 * **Le tableau de bord de la console** (s60) : une tuile par écran de la
 * console, et le chiffre que sa lecture rend.
 *
 * **Aucun nom de module n'est écrit ici**, et c'est la règle que
 * `pnpm test:minimal-profile` suppose : les tuiles sont les entrées de la
 * surface `console` **visibles** — le registre n'agrège que les modules
 * activés, donc une tuile disparaît avec son module, comme l'entrée de la barre
 * latérale. Ce qui relie une entrée à sa lecture est son **adresse**, comparée
 * aux constantes de chemin que les modules exportent déjà — celles que les
 * écrans de la console importent. Une entrée dont l'adresse n'est pas connue
 * ici donne une tuile sans chiffre, avec son seul lien.
 */

/** Les lectures que le tableau de bord sait poser — celles de `lib/admin.ts`. */
export type ConsoleRead = 'accounts' | 'organizations' | 'revenue' | 'subscriptions'

const READ_OF_SCREEN: ReadonlyMap<string, ConsoleRead> = new Map([
  [ADMIN_USERS_SCREEN_PATH, 'accounts'],
  [ADMIN_ORGANIZATIONS_SCREEN_PATH, 'organizations'],
  [ADMIN_REVENUE_SCREEN_PATH, 'revenue'],
  [ADMIN_SUBSCRIPTIONS_SCREEN_PATH, 'subscriptions'],
])

/**
 * La description de chaque chiffre, par lecture — une clé du catalogue du
 * module `admin`, qui n'est rendu qu'avec lui (la console répond 404 sans).
 */
const DESCRIPTION_OF_READ: Readonly<Record<ConsoleRead, string>> = {
  accounts: 'admin.dashboard.tile.accounts',
  organizations: 'admin.dashboard.tile.organizations',
  revenue: 'admin.dashboard.tile.revenue',
  subscriptions: 'admin.dashboard.tile.subscriptions',
}

/** Une tuile avant lecture : l'entrée, et la lecture qui lui donne son chiffre. */
export interface ConsoleTileSlot {
  /** Le module porte la clé, comme dans la navigation : deux entrées peuvent se nommer pareil. */
  readonly key: string
  /** Chemin **interne** de l'écran. */
  readonly href: string
  readonly labelKey: string
  readonly read: ConsoleRead | null
  /** Ce que le chiffre compte, ou `null` pour une tuile sans lecture. */
  readonly descriptionKey: string | null
}

export const consoleTileSlots = (
  entries: readonly RegistryNavigationEntry[],
): readonly ConsoleTileSlot[] =>
  entries
    // Le tableau de bord ne se met pas en tuile : il est l'écran qui les rend.
    .filter((entry) => entry.href !== CONSOLE_SCREEN_PATH)
    .map((entry) => {
      const read = READ_OF_SCREEN.get(entry.href) ?? null

      return {
        key: `${entry.moduleId}:${entry.id}`,
        href: entry.href,
        labelKey: entry.labelKey,
        read,
        descriptionKey: read === null ? null : DESCRIPTION_OF_READ[read],
      }
    })

/** Ce qu'une lecture rend, réduit au chiffre qu'une tuile affiche. */
export type ConsoleFigure =
  | { readonly kind: 'count'; readonly total: number }
  | {
      readonly kind: 'money'
      /** **Une ligne par devise**, en unités mineures — jamais une somme (s38). */
      readonly lines: readonly { readonly currency: string; readonly amount: number }[]
      /** Les abonnements comptés dont le prix n'est plus au catalogue. */
      readonly unvalued: number
    }

/** Le chiffre d'une tuile, ou pourquoi elle n'en a pas. */
export type ConsoleTileFigure =
  | ConsoleFigure
  | { readonly kind: 'error' }
  | { readonly kind: 'link' }

export interface ConsoleTile extends ConsoleTileSlot {
  readonly figure: ConsoleTileFigure
}

export type ConsoleReadings = Partial<Record<ConsoleRead, BackOfficeView<ConsoleFigure>>>

/**
 * **Le revenu récurrent estimé, une ligne par devise** (s38) : additionner des
 * euros et des dollars rendrait un nombre qui ne vaut rien. Seul le récurrent
 * entre dans la tuile — il ne dépend d'aucune période, là où le constaté en
 * demande une que la tuile n'a pas.
 */
export const revenueFigure = (view: AdminRevenueView): ConsoleFigure => ({
  kind: 'money',
  lines: view.revenue.recurring.map(({ currency, amount }) => ({ currency, amount })),
  unvalued: view.revenue.recurringUnvalued,
})

/**
 * Les tuiles, **ou `null`** quand une lecture répond « introuvable » : c'est la
 * réponse d'une lecture à qui n'administre pas, et le tableau de bord répond
 * alors 404 comme chaque écran de la console — une tuile en erreur
 * confirmerait la zone. Une lecture **en échec**, elle, ne touche que sa tuile.
 */
export const consoleTiles = (
  slots: readonly ConsoleTileSlot[],
  readings: ConsoleReadings,
): readonly ConsoleTile[] | null => {
  const refused = slots.some((slot) => {
    const reading = slot.read === null ? undefined : readings[slot.read]

    return reading !== undefined && !reading.ok && reading.error === 'not_found'
  })

  if (refused) {
    return null
  }

  return slots.map((slot) => {
    const reading = slot.read === null ? undefined : readings[slot.read]

    if (reading === undefined) {
      return { ...slot, figure: { kind: 'link' } }
    }

    return { ...slot, figure: reading.ok ? reading.view : { kind: 'error' } }
  })
}

const countOf = <TView extends { readonly total: number }>(
  outcome: BackOfficeView<TView>,
): BackOfficeView<ConsoleFigure> =>
  outcome.ok ? { ok: true, view: { kind: 'count', total: outcome.view.total } } : outcome

/**
 * **Les lectures des tuiles, en parallèle** — celles de `lib/admin.ts`, qui
 * portent chacune la garde du module. Quatre lectures pour quatre chiffres :
 * chacune charge aussi sa première page, un coût accepté à cette échelle
 * (décision du plan de s60, aucun port ne change).
 */
export async function readConsoleTiles(
  slots: readonly ConsoleTileSlot[],
  viewerId: string,
): Promise<ConsoleReadings> {
  const read = async (
    kind: ConsoleRead,
  ): Promise<readonly [ConsoleRead, BackOfficeView<ConsoleFigure>]> => {
    const input = { viewerId, parameters: {} }

    switch (kind) {
      case 'accounts':
        return [kind, countOf(await admin.accounts(input))]
      case 'organizations':
        return [kind, countOf(await admin.organizations(input))]
      case 'subscriptions':
        return [kind, countOf(await admin.subscriptions(input))]
      case 'revenue': {
        const outcome = await admin.revenue(input)

        return [kind, outcome.ok ? { ok: true, view: revenueFigure(outcome.view) } : outcome]
      }
    }
  }

  const kinds = [
    ...new Set(slots.flatMap((slot) => (slot.read === null ? [] : [slot.read]))),
  ]

  return Object.fromEntries(await Promise.all(kinds.map(read))) as ConsoleReadings
}
