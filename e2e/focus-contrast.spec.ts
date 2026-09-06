import { expect, test, type ElementHandle, type Page } from '@playwright/test'

import { CONTRAST_THRESHOLDS, contrastRatio } from '../scripts/contrast-rules'
import { publicPath } from './support/locale'
import { paintedRing } from './support/painted'

/**
 * **L'anneau de focus, tel que le navigateur le peint** (s57).
 *
 * `pnpm test:contrast` mesure `--ring` **sur le papier** : elle lit la feuille
 * de style, convertit l'OKLCH avec son propre convertisseur, et le compare aux
 * surfaces qu'elle **dérive** des classes de base des composants. Elle ne peut
 * pas voir ce qu'il y a réellement derrière un champ à l'écran — c'est
 * exactement l'hypothèse que s57 lui retire, et qu'un seul endroit peut
 * confirmer : un navigateur.
 *
 * Ce fichier mesure donc l'autre moitié :
 *
 * 1. la **couleur peinte** de l'anneau, extraite du calque étalé du `box-shadow`
 *    calculé puis repeinte dans un `canvas`, donc résolue par Chromium et non
 *    par le convertisseur du dépôt — mesuré : il la sérialise en
 *    `lab(48.496 0 0)`, qu'aucune lecture de `rgb(…)` ne verrait ;
 * 2. le **fond réellement composé** sous l'élément focalisé, empilé de la
 *    racine jusqu'à son parent — l'anneau de Tailwind est posé **hors** de
 *    l'élément, il tombe sur la surface du parent, jamais sur son propre fond.
 *
 * Le seuil est celui d'un **élément non textuel** : 3 : 1 (WCAG SC 1.4.11), et
 * non les 4,5 : 1 du texte. C'est la moitié du critère 3 de la story.
 *
 * **Ce que ce fichier ne prouve pas.** Qu'un anneau se *voie* : la revue de s46
 * l'a écrit, le focus ne se lit pas sur une capture, et c'est la mesure du
 * jeton qui fait foi. Il ne dit rien non plus de l'épaisseur ni du décalage de
 * l'anneau, ni des écrans qu'il ne visite pas — un seul, celui de connexion,
 * qui porte des champs, des boutons et des liens —, ni d'un autre navigateur
 * que Chromium.
 */

const THEMES = [
  { label: 'clair', colorScheme: 'light' as const, dark: false },
  { label: 'sombre', colorScheme: 'dark' as const, dark: true },
]

/**
 * Le nombre de tabulations parcourues. Il est **borné** : un écran qui
 * gagnerait une boucle de focus ferait tourner ce cas indéfiniment.
 */
const TAB_STOPS = 14

/**
 * **Le plancher anti-balayage-vide.** Un sélecteur, une classe ou une
 * hydratation qui cesserait de correspondre rendrait ce cas vert en ne mesurant
 * aucun anneau — le défaut trouvé en s26 puis en s48. L'écran de connexion
 * porte trois champs, plusieurs boutons et des liens : trois arrêts qui peignent
 * un anneau est une borne basse, pas un compte.
 */
const MINIMUM_RINGS = 3

const applyTheme = async (page: Page, theme: (typeof THEMES)[number]): Promise<void> => {
  await page.emulateMedia({ colorScheme: theme.colorScheme })

  const html = page.locator('html')

  if (theme.dark) {
    await expect(html).toHaveClass(/dark/)
  } else {
    await expect(html).not.toHaveClass(/dark/)
  }
}

const activeElement = async (page: Page): Promise<ElementHandle<HTMLElement> | null> =>
  (await page.evaluateHandle(() => document.activeElement)).asElement() as ElementHandle<HTMLElement> | null

test.describe('le contraste de l’anneau de focus, tel que le navigateur le peint', () => {
  for (const theme of THEMES) {
    test(`chaque arrêt de tabulation garde un anneau lisible — ${theme.label}`, async ({
      page,
    }) => {
      await page.goto(publicPath('/sign-in'))
      await applyTheme(page, theme)

      // **L'hydratation d'abord** : le bouton d'envoi reste éteint tant que
      // React n'a pas repris la main, et un élément désactivé ne prend pas le
      // focus. Mesurer avant, c'est mesurer un autre écran.
      await expect(page.locator('button[type="submit"]').first()).toBeEnabled()

      let measured = 0
      const withoutRing: string[] = []

      for (let stop = 0; stop < TAB_STOPS; stop += 1) {
        await page.keyboard.press('Tab')

        const focused = await activeElement(page)

        if (focused === null) {
          continue
        }

        const described = await focused.evaluate((node: HTMLElement) => ({
          name: `${node.tagName.toLowerCase()}${
            node.getAttribute('data-slot') === null ? '' : `[${node.getAttribute('data-slot')}]`
          }`,
          shadow: window.getComputedStyle(node).boxShadow,
          root: node === document.body || node.parentElement === null,
        }))

        if (described.root) {
          continue
        }

        if (described.shadow === 'none' || described.shadow === '') {
          withoutRing.push(described.name)

          continue
        }

        const colours = await paintedRing(focused)
        const ratio = contrastRatio(colours.ring, colours.background)
        const label = `${described.name} — ${theme.label}`

        test.info().annotations.push({
          type: 'contraste',
          description: `${label} : ${ratio.toFixed(2)} : 1 (anneau ${colours.ringHex} sur ${
            colours.backgroundHex
          })`,
        })

        expect(
          ratio,
          `${label} : ${ratio.toFixed(2)} : 1, anneau ${colours.ringHex} sur ${
            colours.backgroundHex
          }`,
        ).toBeGreaterThanOrEqual(CONTRAST_THRESHOLDS.indicateur)

        measured += 1
      }

      expect(
        measured,
        `arrêts sans anneau peint : ${withoutRing.join(', ') || 'aucun'}`,
      ).toBeGreaterThanOrEqual(MINIMUM_RINGS)
    })
  }
})
