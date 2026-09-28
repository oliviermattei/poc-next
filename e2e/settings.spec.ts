import { visibleNavigation } from '@repo/core'
import { expect, test, type Page } from '@playwright/test'

import { LEGACY_SCREEN_PATHS, legacyScreenTarget } from '../apps/web/lib/legacy-paths'
import { moduleRegistry } from '../apps/web/lib/module-registry'
import { aSignedInAccount } from './support/account'
import { publicPath, settingsPath } from './support/locale'

/**
 * **La zone Réglages** (s62a, ADR 075), dans un vrai navigateur.
 *
 * Deux choses qu'aucun test Vitest ne voit : la réponse **réelle** du serveur
 * à un ancien chemin — le proxy de Next, pas la fonction appelée à la main —,
 * et la sous-navigation rendue, avec son entrée courante.
 *
 * Tout est dérivé de la configuration : un ancien chemin dont le module est
 * coupé doit répondre 404 et non 308, et la sous-navigation porte les seules
 * entrées des modules activés.
 */

/** Les réglages qu'un compte connecté voit, dans cette configuration. */
const settingsEntries = () =>
  visibleNavigation(moduleRegistry, { userId: 'e2e', roles: [] }, 'settings')

const hrefsOf = async (page: Page, name: string): Promise<string[]> =>
  (
    await Promise.all(
      (await page.getByRole('navigation', { name }).getByRole('link').all()).map((link) =>
        link.getAttribute('href'),
      ),
    )
  ).filter((href): href is string => href !== null)

test.describe('les anciens chemins', () => {
  test('`/account?x=1` répond 308 vers le compte, requête conservée', async ({ request }) => {
    const response = await request.get('/account?x=1', { maxRedirects: 0 })

    // Un seul saut : la table est lue avant la redirection de langue.
    expect(response.status()).toBe(308)

    const location = new URL(response.headers()['location'] ?? '', 'http://localhost')

    expect(location.pathname).toBe(publicPath(settingsPath('account')))
    expect(location.search).toBe('?x=1')
  })

  test('l’ancien chemin de l’organisation, préfixé, garde sa langue — ou 404 module coupé', async ({
    request,
  }) => {
    const legacy = Object.keys(LEGACY_SCREEN_PATHS).find(
      (path) => LEGACY_SCREEN_PATHS[path] === settingsPath('organization'),
    )

    expect(legacy).toBeDefined()

    const response = await request.get(publicPath(legacy ?? ''), { maxRedirects: 0 })

    if (legacyScreenTarget(legacy ?? '', moduleRegistry) === null) {
      expect(response.status()).toBe(404)

      return
    }

    expect(response.status()).toBe(308)
    expect(new URL(response.headers()['location'] ?? '', 'http://localhost').pathname).toBe(
      publicPath(settingsPath('organization')),
    )
  })
})

test('la sous-navigation porte les réglages visibles et marque l’écran ouvert', async ({ page }) => {
  await aSignedInAccount(page, 's62a-reglages')

  const entries = settingsEntries()
  // Facturation quand le module est là, le compte sinon : l'écran ouvert est
  // toujours l'un de ceux que la configuration sert.
  const opened =
    entries.find((entry) => entry.href === settingsPath('billing')) ??
    entries.find((entry) => entry.href === settingsPath('account'))

  expect(opened).toBeDefined()

  await page.goto(publicPath(opened?.href ?? ''))

  await expect(page.getByRole('heading', { name: 'Réglages', level: 1 })).toBeVisible()

  const navigation = page.getByRole('navigation', { name: 'Rubriques des réglages' })

  await expect(navigation).toBeVisible()
  expect((await hrefsOf(page, 'Rubriques des réglages')).sort()).toEqual(
    entries.map((entry) => publicPath(entry.href)).sort(),
  )
  await expect(navigation.locator('[aria-current="page"]')).toHaveAttribute(
    'href',
    publicPath(opened?.href ?? ''),
  )

  // Et la barre latérale du produit n'en porte aucune.
  const sidebar = await hrefsOf(page, 'Modules')

  for (const entry of entries) {
    expect(sidebar).not.toContain(publicPath(entry.href))
  }
})
