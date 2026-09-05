import { randomUUID } from 'node:crypto'

import { BILLING_KEYS, PRICING_SCREEN_PATH } from '@repo/module-billing'
import { CONTACT_FORM_KEYS, CONTACT_PATH } from '@repo/module-marketing'
import { expect, test, type Locator, type Page } from '@playwright/test'

import { billing } from '../apps/web/lib/billing'
import { marketingFormsAvailable, marketingSite } from '../apps/web/lib/marketing'
import { flatMessagesFor } from '../apps/web/lib/messages'
import { defaultLocale } from '../config/i18n'
import { CONTRAST_THRESHOLD, contrastRatio, type Rgb } from '../scripts/contrast-rules'
import { publicPath } from './support/locale'

/**
 * **Le contraste des `Alert`, mesuré par le navigateur lui-même** (s49).
 *
 * `pnpm test:contrast` mesure les jetons **sur le papier** : elle lit la feuille
 * de style, convertit l'OKLCH avec son propre convertisseur, et **suppose** que
 * le fond effectif est la carte. Ce fichier mesure autre chose, et c'est le seul
 * endroit où il peut l'être : ce que Chromium a réellement peint — sa conversion
 * de couleur, sa composition des fonds empilés, sa cascade de thème.
 *
 * La chaîne est donc bien celle qu'un visiteur voit : Tailwind a généré
 * l'utilitaire depuis `@theme inline`, `.dark` l'a redéfini, le navigateur a
 * composé `bg-<sem>/10` sur les fonds qui sont réellement dessous. Rien ici ne
 * rejoue le convertisseur du dépôt — les couleurs sont sorties d'un `canvas`,
 * qui est le convertisseur du navigateur. Seule l'arithmétique WCAG est reprise
 * de `scripts/contrast-rules.ts`, et elle est éprouvée à part sur des
 * références extérieures au dépôt (`tests/contrast.test.ts`).
 *
 * **Ce qui est balayé** : les quatre sémantiques de l'`Alert`, dans les deux
 * thèmes, sur les écrans qui les emploient déjà — le refus d'un retour de
 * fournisseur (`destructive`), les deux bandeaux de retour de paiement (`info`
 * et `warning`), la confirmation d'un formulaire public (`success`). Ce sont
 * quatre écrans, pas les vingt-cinq appelants d'`Alert` : ce qui est mesuré est
 * la paire jeton × thème, et elle ne dépend pas de l'appelant tant que la
 * surface sous l'alerte est la même — ce que ces quatre écrans confirment
 * justement, chacun avec sa propre pile de fonds.
 *
 * **Ce qui ne l'est pas** : la variante `default`, les bordures `border-<sem>/50`
 * (seuil 3 : 1 des éléments non textuels), les icônes, les états de focus. Et
 * un seul navigateur — Chromium, celui de la suite.
 */

const catalogue = flatMessagesFor(defaultLocale)

/** Le texte attendu à l'écran, lu dans le catalogue de la langue servie. */
const text = (key: string): string => {
  const value = catalogue[key]

  if (value === undefined) {
    throw new Error(`Le catalogue « ${defaultLocale} » ne livre pas « ${key} ».`)
  }

  return value
}

const publicSite = marketingSite.sections.length > 0

/**
 * Une adresse d'appelant propre à chaque parcours — même raison que dans
 * `e2e/public-forms.spec.ts` : le seau de limitation de débit est en base et sa
 * fenêtre dure dix minutes, donc deux exécutions rapprochées partageraient le
 * seau de `::1` et la seconde serait refusée. Ce n'est pas un contournement :
 * c'est ce qui rend la mesure reproductible.
 */
const aClient = (): Record<string, string> => ({
  'x-forwarded-for': `198.51.100.${String(Math.floor(Math.random() * 250) + 1)}, 10.0.0.1`,
})

type Painted = {
  /** La couleur du texte, telle que le navigateur l'a peinte, en sRGB [0, 1]. */
  readonly text: Rgb
  /** Le fond effectif sous ce texte, tous calques composés. */
  readonly background: Rgb
  readonly textHex: string
  readonly backgroundHex: string
}

/**
 * **Ce que le navigateur a peint sous ce texte**, et non ce qu'un convertisseur
 * en déduit.
 *
 * Les fonds sont empilés de la racine vers l'alerte dans un `canvas` de un
 * pixel : c'est Chromium qui lit `oklch(…)` ou le `color-mix` que Tailwind
 * émet, c'est lui qui compose l'alpha, et la lecture du pixel rend le sRGB à
 * huit bits — celui de l'écran. Une couleur que le navigateur ne saurait pas
 * repeindre **arrête** la mesure au lieu d'en rendre une fausse.
 */
const painted = async (alert: Locator): Promise<Painted> =>
  await alert.evaluate((node: HTMLElement) => {
    const layers: string[] = []

    for (let current: Element | null = node; current !== null; current = current.parentElement) {
      layers.push(window.getComputedStyle(current).backgroundColor)
    }

    const canvas = document.createElement('canvas')

    canvas.width = 1
    canvas.height = 1

    const context = canvas.getContext('2d')

    if (context === null) {
      throw new Error('Aucun contexte 2d : le navigateur ne peut pas rendre sa propre mesure.')
    }

    const SENTINEL = '#010203'

    const paint = (colour: string): void => {
      context.fillStyle = SENTINEL
      context.fillStyle = colour

      if (context.fillStyle === SENTINEL && colour !== SENTINEL) {
        throw new Error(
          `Le navigateur n’a pas su repeindre « ${colour} » : la mesure serait fausse, ` +
            'donc elle n’a pas lieu.',
        )
      }

      context.fillRect(0, 0, 1, 1)
    }

    const sample = (): readonly [number, number, number, number] => {
      const data = context.getImageData(0, 0, 1, 1).data

      return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0]
    }

    const hex = (channels: readonly number[]): string =>
      `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`

    // De la racine vers l'alerte : l'ordre dans lequel le navigateur empile ses
    // fonds. `body` porte `--background`, opaque, donc la pile se ferme.
    for (const layer of [...layers].reverse()) {
      paint(layer)
    }

    const [br, bg, bb, ba] = sample()

    if (ba !== 255) {
      throw new Error(
        `Le fond composé sous l’alerte n’est pas opaque (alpha ${ba}) : aucun calque de la pile ` +
          'ne ferme le fond, et le rapport mesuré serait celui d’un fond inventé.',
      )
    }

    paint(window.getComputedStyle(node).color)

    const [tr, tg, tb] = sample()

    return {
      text: [tr / 255, tg / 255, tb / 255] as const,
      background: [br / 255, bg / 255, bb / 255] as const,
      textHex: hex([tr, tg, tb]),
      backgroundHex: hex([br, bg, bb]),
    }
  })

const THEMES = [
  { label: 'clair', colorScheme: 'light' as const, dark: false },
  { label: 'sombre', colorScheme: 'dark' as const, dark: true },
]

/**
 * Mesure une alerte **dans les deux thèmes**, et laisse la trace de ce qui a
 * été vu : les rapports sont annotés, donc ils sortent du rapport de la suite
 * au lieu de vivre dans la tête de qui l'a lancée.
 *
 * Le thème est celui du système, et l'assertion de classe est ce qui empêche de
 * mesurer deux fois le même : `next-themes` est en `defaultTheme="system"`, et
 * si la bascule n'était pas suivie, les deux lignes seraient des copies — le
 * défaut exact que la revue de s49 a trouvé côté commande.
 */
const measureBothThemes = async (
  page: Page,
  alert: Locator,
  variant: string,
): Promise<void> => {
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme.colorScheme })

    const html = page.locator('html')

    if (theme.dark) {
      await expect(html).toHaveClass(/dark/)
    } else {
      await expect(html).not.toHaveClass(/dark/)
    }

    const colours = await painted(alert)
    const ratio = contrastRatio(colours.text, colours.background)

    test
      .info()
      .annotations.push({
        type: 'contraste',
        description: `${variant} — ${theme.label} : ${ratio.toFixed(2)} : 1 (texte ${
          colours.textHex
        } sur ${colours.backgroundHex})`,
      })

    expect(
      ratio,
      `${variant} — ${theme.label} : ${ratio.toFixed(2)} : 1, texte ${colours.textHex} sur ${
        colours.backgroundHex
      }`,
    ).toBeGreaterThanOrEqual(CONTRAST_THRESHOLD)
  }
}

/** L'alerte du composant, repérée par son marqueur — jamais par sa classe. */
const alertOf = (page: Page): Locator => page.locator('[data-slot="alert"]')

test.describe('le contraste des alertes, tel que le navigateur les peint', () => {
  test('le refus d’un retour de fournisseur reste lisible (destructive)', async ({ page }) => {
    await page.goto(`${publicPath('/sign-in')}?oauth=denied`)

    const alert = alertOf(page)

    await expect(alert).toHaveText(text('app.auth.oauth.error.denied'))

    await measureBothThemes(page, alert, 'destructive')
  })

  test('les deux bandeaux de retour de paiement restent lisibles (info, warning)', async ({
    page,
  }) => {
    test.skip(!billing.available, 'module de facturation coupé')

    await page.goto(`${publicPath(PRICING_SCREEN_PATH)}?checkout=success`)

    const alert = alertOf(page)

    await expect(alert).toHaveText(text(BILLING_KEYS.pricing.returnSuccess))

    await measureBothThemes(page, alert, 'info')

    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto(`${publicPath(PRICING_SCREEN_PATH)}?checkout=cancelled`)

    await expect(alert).toHaveText(text(BILLING_KEYS.pricing.returnCancelled))

    await measureBothThemes(page, alert, 'warning')
  })

  test('la confirmation d’un formulaire public reste lisible (success)', async ({ page }) => {
    test.skip(!publicSite || !marketingFormsAvailable, 'aucun formulaire public servi')

    await page.setExtraHTTPHeaders(aClient())
    await page.goto(publicPath(CONTACT_PATH))

    await page.getByLabel(text(CONTACT_FORM_KEYS.name)).fill('Visiteur de passage')
    await page
      .getByLabel(text(CONTACT_FORM_KEYS.email))
      .fill(`contraste-${randomUUID()}@example.test`)
    await page.getByLabel(text(CONTACT_FORM_KEYS.message)).fill('Une question sur les licences.')
    await page.getByRole('button', { name: text(CONTACT_FORM_KEYS.submit) }).click()

    const alert = alertOf(page)

    await expect(alert).toHaveText(text(CONTACT_FORM_KEYS.success))

    await measureBothThemes(page, alert, 'success')
  })
})
