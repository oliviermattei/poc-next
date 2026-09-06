import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

import { localeRouting } from '../apps/web/lib/locale-routing'
import { flatMessagesFor } from '../apps/web/lib/messages'
import { defaultLocale } from '../config/i18n'
import { CONTRAST_THRESHOLD, contrastRatio } from '../scripts/contrast-rules'
import { painted } from './support/painted'

/**
 * **Les cinq écrans d'authentification, tels qu'un navigateur les rend** (s46).
 *
 * Ce fichier ne remplace pas `e2e/auth.spec.ts` : celui-là mesure les
 * parcours — inscription, vérification, connexion, refus indiscernables — et
 * **ses assertions n'ont pas bougé d'une ligne** en s46. Celui-ci mesure ce que
 * l'habillage pouvait casser sans qu'aucun parcours ne le voie : un
 * débordement horizontal, et un texte illisible.
 *
 * ## Ce qui est mesuré ici, et pourquoi ça ne se regarde pas
 *
 * 1. **Le débordement horizontal**, `scrollWidth - clientWidth`, à 380 px,
 *    dans les deux thèmes et dans **chaque langue servie** — une traduction
 *    plus longue est la façon la plus courante de faire déborder une colonne,
 *    et c'est invisible sur un poste qui n'ouvre qu'une langue. Les langues
 *    sont dérivées de `localeRouting`, jamais recopiées : le fichier passe dans
 *    les deux états du module `i18n` ;
 * 2. **le contraste de ce que ces écrans peignent** — étiquettes, champs,
 *    boutons, titres, liens et textes atténués —, mesuré dans le navigateur,
 *    fonds empilés compris.
 *
 * ## Ce que `pnpm test:contrast` ne dit pas, et que ce fichier dit
 *
 * La commande ne mesure **que** l'`Alert` : ses paires sont dérivées de
 * `packages/ui/src/components/alert.tsx`, et elle *suppose* que le fond est la
 * carte. Elle ne dit rien d'un champ, d'un bouton, d'un libellé ni d'un lien.
 * Une commande verte ne couvrait donc **aucun** des textes que s46 livre :
 * c'est ce trou-ci que le second cas ferme, dans le seul endroit où il peut
 * l'être — un navigateur, qui compose réellement les fonds.
 *
 * ## Ce qui reste non mesuré, et qu'il ne faut pas croire couvert
 *
 * Les **états** : focus (`focus-visible:ring-ring`), survol, bouton éteint
 * avant hydratation. Les **éléments non textuels** : bordures de champ et de
 * carte, anneau de focus, séparateurs — leur seuil est 3 : 1, et rien ici ne
 * les mesure. Et **un seul navigateur**, Chromium, celui de la suite.
 */

/** 380 px : la largeur du critère de s46, plus étroite que les 400 px de s08. */
const NARROW = { width: 380, height: 900 }

const APP_DIRECTORY = fileURLToPath(new URL('../apps/web/app', import.meta.url))

/**
 * **La famille des écrans d'authentification, dérivée du disque.**
 *
 * La liste était écrite, et `/two-factor` n'y était pas — un écran de la même
 * famille, laissé hors du balayage sans que rien ne le dise (constat F4 de la
 * revue de s46). Le critère d'appartenance est donc **lu dans le code** : un
 * écran qui appelle une route du module d'authentification en est. Un septième
 * écran entre dans le balayage le jour où son fichier existe, au lieu
 * d'hériter du silence.
 *
 * Ce que ce critère attrape, et ce qu'il n'attrape pas : il voit tout
 * `page.tsx` sous `apps/web/app` qui cite `authRoutePath(`. Un écran
 * d'authentification qui n'appellerait aucune route du module — il n'en existe
 * aucun aujourd'hui — lui échapperait.
 */
const authFamily = (): readonly string[] =>
  readdirSync(APP_DIRECTORY, { recursive: true })
    .map((entry) => String(entry).split(sep).join('/'))
    .filter((file) => file.endsWith('page.tsx'))
    .filter((file) => readFileSync(join(APP_DIRECTORY, file), 'utf8').includes('authRoutePath('))
    .map((file) => `/${dirname(file)}`)
    .sort()

/**
 * Les écrans de la famille que ce balayage **n'ouvre pas**, chacun avec sa
 * raison écrite — la forme que `pnpm test:socle` impose à ses exclusions.
 */
const EXCLUDED: Readonly<Record<string, string>> = {
  '/account':
    'l’écran de compte : il est servi derrière une session, un visiteur anonyme y reçoit une redirection et non un écran. Il appartient à s08 et s34b, pas à la famille que s46 habille.',
}

/**
 * Les **états supplémentaires** qui changent la mise en page d'un écran : un
 * lien de réinitialisation incomplet ne rend pas de formulaire, un lien de
 * vérification expiré rend une alerte. Mesurer la seule forme nominale
 * laisserait ces deux-là hors du balayage.
 */
const EXTRA_STATES: Readonly<Record<string, readonly string[]>> = {
  '/reset-password': ['?token=s46-jeton-de-mesure'],
  '/verify-email': ['?error=1'],
}

const FAMILY = authFamily()
const SWEPT = FAMILY.filter((screen) => EXCLUDED[screen] === undefined)
const SCREENS = SWEPT.flatMap((screen) => [
  screen,
  ...(EXTRA_STATES[screen] ?? []).map((search) => `${screen}${search}`),
])

/** Le texte attendu à l'écran, lu dans le catalogue de la langue servie. */
const catalogue = flatMessagesFor(defaultLocale)
const text = (key: string): string => {
  const value = catalogue[key]

  if (value === undefined) {
    throw new Error(`Le catalogue « ${defaultLocale} » ne livre pas « ${key} ».`)
  }

  return value
}

const THEMES = [
  { label: 'clair', colorScheme: 'light' as const, dark: false },
  { label: 'sombre', colorScheme: 'dark' as const, dark: true },
]

/** L'URL d'un écran dans une langue servie, préfixe compris quand il y en a un. */
const urlIn = (screen: string, locale: string): string => {
  const [pathname = screen, search] = screen.split('?')

  return `${localeRouting.publicPath(pathname, locale)}${search === undefined ? '' : `?${search}`}`
}

/** La largeur réellement défilable du document, comparée à celle du cadre. */
const horizontalOverflow = async (page: Page): Promise<number> =>
  await page.evaluate<number>(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )

const applyTheme = async (page: Page, theme: (typeof THEMES)[number]): Promise<void> => {
  await page.emulateMedia({ colorScheme: theme.colorScheme })

  const html = page.locator('html')

  // Sans cette assertion, les deux thèmes pourraient être la même mesure faite
  // deux fois — le défaut relevé en revue de s49, côté commande.
  if (theme.dark) {
    await expect(html).toHaveClass(/dark/)
  } else {
    await expect(html).not.toHaveClass(/dark/)
  }
}

test('chaque écran de la famille est balayé, ou exclu avec sa raison écrite', () => {
  // Garde contre l'inertie : un critère qui cesserait de correspondre rendrait
  // tout ce fichier vert en n'ouvrant aucun écran. Six écrans le jour de s46 ;
  // le plancher dit « le balayage n'est pas vide », pas « ils sont six ».
  expect(FAMILY.length, FAMILY.join(', ')).toBeGreaterThanOrEqual(6)
  expect(SWEPT.length).toBeGreaterThanOrEqual(FAMILY.length - Object.keys(EXCLUDED).length)

  // Une exclusion ne s'hérite pas : elle désigne un écran qui existe, et elle
  // dit pourquoi. Une raison vide serait le silence qu'on vient de fermer.
  for (const [screen, reason] of Object.entries(EXCLUDED)) {
    expect(FAMILY, screen).toContain(screen)
    expect(reason.length, screen).toBeGreaterThan(20)
  }

  // Et un état déclaré pour un écran disparu serait du poids mort qui ne
  // mesure plus rien.
  for (const screen of Object.keys(EXTRA_STATES)) {
    expect(SWEPT, screen).toContain(screen)
  }
})

test.describe('à 380 px', () => {
  test.use({ viewport: NARROW })

  test('aucun écran d’authentification ne déborde, dans les deux thèmes et chaque langue', async ({
    page,
  }) => {
    // Garde contre l'inertie : une configuration sans langue servie rendrait
    // toute la boucle vraie sur zéro rendu.
    expect(localeRouting.locales.length).toBeGreaterThan(0)

    let rendered = 0

    for (const locale of localeRouting.locales) {
      for (const screen of SCREENS) {
        await page.goto(urlIn(screen, locale))

        for (const theme of THEMES) {
          await applyTheme(page, theme)

          // L'écran est bien arrivé : un 404 ne déborde jamais.
          await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

          const overflow = await horizontalOverflow(page)

          test.info().annotations.push({
            type: 'largeur',
            description: `${locale} ${screen} — ${theme.label} : débordement ${overflow} px`,
          })

          expect(
            overflow,
            `${locale} ${screen} — ${theme.label} déborde de ${overflow} px à ${NARROW.width} px`,
          ).toBeLessThanOrEqual(0)

          rendered += 1
        }
      }
    }

    expect(rendered).toBe(SCREENS.length * THEMES.length * localeRouting.locales.length)
  })
})

test('le texte de l’écran de connexion tient le seuil AA, tel que le navigateur le peint', async ({
  page,
}) => {
  await page.goto(urlIn('/sign-in', localeRouting.locales[0] ?? ''))

  // Le `<main>` de la page, pas celui de la coquille : ce que la story livre.
  const screen = page.locator('main').last()

  /**
   * **L'hydratation d'abord, et le témoin est le bouton lui-même** : il est
   * éteint tant que React n'a pas repris la main (`app/use-hydrated.ts`), et le
   * bouton de passkey n'est même pas rendu avant. Mesurer plus tôt, c'est
   * mesurer un écran qui n'est pas celui qu'on croit.
   */
  await expect(screen.locator('button[type="submit"]').first()).toBeEnabled()

  /**
   * **Des poignées, prises une fois.** Filtrer par `evaluateAll` puis mesurer
   * par `nth(i)` lit le DOM deux fois : le second est un autre document dès
   * qu'un rendu arrive entre les deux, et l'indice ne désigne plus le même
   * nœud. Mesuré en s46 — un séparateur mesuré à la place d'un lien, une
   * exécution sur deux.
   */
  const handles = await screen
    .locator('h1, h2, p, a, div, [data-slot="label"], [data-slot="input"], [data-slot="button"]')
    .elementHandles()

  /**
   * Les éléments qui **peignent réellement du texte** : un nœud de texte propre
   * non vide, ou un champ de saisie — vide, mais dont la couleur est celle de
   * ce qu'on y tapera. Rien n'est nommé ici : le balayage suit l'écran.
   */
  const described = await Promise.all(
    handles.map(async (handle) =>
      handle.evaluate((node: HTMLElement) => ({
        slot: `${node.tagName.toLowerCase()}:${node.getAttribute('data-slot') ?? ''}`,
        paints:
          node.tagName === 'INPUT' ||
          [...node.childNodes].some(
            (child) => child.nodeType === 3 && (child.textContent ?? '').trim() !== '',
          ),
      })),
    ),
  )

  const measured = handles
    .map((handle, index) => ({ handle, ...(described[index] ?? { slot: '', paints: false }) }))
    .filter((candidate) => candidate.paints)

  // **Le plancher anti-balayage-vide.** Un sélecteur qui cesse de correspondre
  // rendrait ce cas vert en ne mesurant rien — le défaut trouvé en s26 puis en
  // s48. L'écran de connexion porte au moins un titre, trois étiquettes, trois
  // champs, quatre boutons et trois liens.
  expect(measured.length).toBeGreaterThanOrEqual(10)

  // Et il porte bien les familles que la story habille : sans elles, le
  // plancher ci-dessus serait franchi par dix paragraphes.
  for (const family of ['label', 'input', 'button']) {
    expect(
      measured.some((candidate) => candidate.slot.endsWith(family)),
      family,
    ).toBe(true)
  }

  expect(measured.some((candidate) => candidate.slot.startsWith('a:'))).toBe(true)

  for (const theme of THEMES) {
    await applyTheme(page, theme)

    for (const candidate of measured) {
      const colours = await painted(candidate.handle)
      const ratio = contrastRatio(colours.text, colours.background)
      const label = `${candidate.slot} — ${theme.label}`

      test.info().annotations.push({
        type: 'contraste',
        description: `${label} : ${ratio.toFixed(2)} : 1 (texte ${colours.textHex} sur ${
          colours.backgroundHex
        })`,
      })

      expect(
        ratio,
        `${label} : ${ratio.toFixed(2)} : 1, texte ${colours.textHex} sur ${colours.backgroundHex}`,
      ).toBeGreaterThanOrEqual(CONTRAST_THRESHOLD)
    }
  }
})

/**
 * **Sans JavaScript, un bouton éteint dit pourquoi** (`apps/web/AGENTS.md`).
 *
 * Ces formulaires envoient par `fetch` : leur bouton reste éteint tant que
 * React n'a pas repris la main, donc **pour toujours** quand il ne vient
 * jamais. `app/public-form.tsx` et `app/billing-actions.tsx` portaient déjà le
 * `<noscript>` qui l'explique ; les écrans d'authentification, non — et s46
 * venait d'en faire des boutons primaires proéminents. L'écran avait l'air
 * fini et ne l'était pas (constat F5 de la revue).
 *
 * **La règle est comptée, pas illustrée** : autant d'explications rendues que
 * de boutons éteints. Les boutons de fournisseur externe, eux, ne sont pas
 * éteints — leur formulaire est une redirection du serveur, il marche sans
 * JavaScript — et ils ne demandent donc aucune explication.
 *
 * `noscript > *` est un sélecteur de **structure**, et c'est la seule exception
 * du dépôt à la recherche par rôle et par nom accessible : les moteurs de texte
 * et de rôle de Playwright ignorent ce sous-arbre.
 */
test.describe('sans JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('chaque bouton éteint des écrans d’authentification dit pourquoi', async ({ page }) => {
    let explained = 0

    for (const screen of SCREENS) {
      await page.goto(urlIn(screen, localeRouting.locales[0] ?? ''))

      const main = page.locator('main').last()
      const stuck = await main.locator('button[disabled]').count()
      const explanations = main.locator('noscript > *')

      await expect(explanations, screen).toHaveCount(stuck)

      for (let index = 0; index < stuck; index += 1) {
        await expect(explanations.nth(index), screen).toBeVisible()
        await expect(explanations.nth(index), screen).toHaveText(text('app.auth.noscript'))
      }

      explained += stuck
    }

    // Garde contre l'inertie : zéro bouton éteint partout rendrait l'égalité
    // ci-dessus vraie sur rien du tout. Mesuré à 8 le jour de s46 — le plancher
    // dit « le balayage rencontre des boutons éteints », pas « ils sont huit ».
    expect(explained, 'boutons éteints rencontrés').toBeGreaterThanOrEqual(6)
  })
})
