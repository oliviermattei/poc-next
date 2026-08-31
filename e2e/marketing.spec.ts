import {
  legalPath,
  marketingModule,
  robotsAllows,
  type RobotsPolicy,
} from '@repo/module-marketing'
import { expect, test } from '@playwright/test'

import { marketingSite } from '../apps/web/lib/marketing'
import { flatMessagesFor } from '../apps/web/lib/messages'
import { defaultLocale } from '../config/i18n'
import { publicPath, urlOf } from './support/locale'

/**
 * Le site public, dans un vrai navigateur.
 *
 * Ce que ce fichier prouve et qu'aucun test Vitest ne peut prouver : le
 * `sitemap.xml` et le `robots.txt` réellement **servis** par Next — deux
 * conventions de fichier dont le nœud ne voit que la valeur de retour —, les
 * balises de titre, de description et Open Graph telles que le navigateur les
 * reçoit, le lien du pied de page réellement suivi, et l'ouverture d'une
 * question de FAQ.
 *
 * **Il doit passer dans les deux états de configuration.** Ses attentes sont
 * donc dérivées de `marketingSite`, jamais recopiées — même discipline que
 * `e2e/modules.spec.ts` avec le registre et `e2e/i18n.spec.ts` avec la forme
 * des URL.
 */

const catalogue = flatMessagesFor(defaultLocale)
const publicSite = marketingSite.sections.length > 0

/** Le texte attendu à l'écran, lu dans le catalogue de la langue servie. */
const text = (key: string): string => {
  const value = catalogue[key]

  if (value === undefined) {
    throw new Error(`Le catalogue « ${defaultLocale} » ne livre pas « ${key} ».`)
  }

  return value
}

/** Les URL publiques attendues, dans la langue par défaut. */
const publicUrls = marketingSite.publicPaths.map((pathname) => publicPath(pathname))

/**
 * Des chemins que **rien** ne doit ouvrir à un robot, quel que soit l'état du
 * module : ils ne sont pas publics, et le dernier porte un jeton de
 * réinitialisation. L'inventaire exhaustif des écrans est le sujet de
 * `tests/marketing.test.ts`, qui les balaie sur le disque ; ici, trois témoins
 * sur le fichier réellement servi.
 */
const PRIVATE_PATHS = ['/account', '/sign-in', '/reset-password?token=jeton-de-reinitialisation']

test('le plan de site référence exactement les pages publiques', async ({ request }) => {
  const response = await request.get('/sitemap.xml')

  expect(response.status()).toBe(200)

  const body = await response.text()
  const locations = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1] ?? '')

  expect(locations.map((url) => new URL(url).pathname)).toEqual(
    publicUrls.map((pathname) => (pathname === '/' ? '/' : pathname)),
  )

  // Site public coupé, il ne référence **rien** : c'est le critère 6.
  if (!publicSite) {
    expect(locations).toEqual([])
  }
})

/**
 * Le fichier servi, relu comme un robot le lit.
 *
 * Chercher `Allow: /fr` dans le corps ne dit rien de ce que le fichier
 * autorise : la correspondance d'un `robots.txt` est par préfixe, et c'est
 * ainsi qu'un `Allow: /fr` ouvrant `/fr/reset-password?token=…` a été livré
 * sous un test qui portait le nom contraire. Le corps est donc analysé, puis
 * interrogé par la règle du module.
 */
const parseRobots = (body: string): RobotsPolicy => {
  const values = (directive: string): string[] =>
    body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.toLowerCase().startsWith(`${directive.toLowerCase()}:`))
      .map((line) => line.slice(directive.length + 1).trim())

  return {
    rules: { userAgent: '*', allow: values('Allow'), disallow: values('Disallow') },
  }
}

test('le robots.txt n’ouvre que les pages publiques', async ({ request }) => {
  const response = await request.get('/robots.txt')

  expect(response.status()).toBe(200)

  const body = await response.text()
  const policy = parseRobots(body)

  // Garde contre l'inertie de l'analyse : sans directive lue, tout serait
  // « autorisé par défaut » et la boucle suivante passerait à l'envers.
  expect(policy.rules.disallow).toEqual(['/'])

  // Ce qu'aucune configuration ne doit ouvrir : l'espace applicatif, et surtout
  // une URL portant un jeton. Vrai dans les **deux** états du module.
  for (const pathname of PRIVATE_PATHS) {
    expect(robotsAllows(policy, publicPath(pathname)), pathname).toBe(false)
  }

  if (publicSite) {
    for (const pathname of publicUrls) {
      expect(robotsAllows(policy, pathname), pathname).toBe(true)
    }

    expect(body).toContain('Sitemap:')
  } else {
    for (const pathname of ['/', publicPath('/')]) {
      expect(robotsAllows(policy, pathname), pathname).toBe(false)
    }

    // Aucun plan de site annoncé : publier une adresse qui ne référence rien
    // n'aurait aucun sens.
    expect(body).not.toContain('Sitemap:')
  }
})

test.describe('site public activé', () => {
  test.skip(!publicSite, 'Le module marketing est coupé dans cette configuration.')

  test('la racine sert l’accueil, ses métadonnées et ses balises de partage', async ({ page }) => {
    const response = await page.goto('/')

    expect(response?.status()).toBe(200)
    await expect(page).toHaveURL(urlOf('/'))

    const first = marketingSite.sections[0]

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      text(`marketing.section.${first?.id ?? ''}.title`),
    )

    await expect(page).toHaveTitle(text('marketing.home.title'))
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      text('marketing.home.description'),
    )
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      text('marketing.home.title'),
    )
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website')
  })

  test('le pied de page mène aux mentions légales, qui portent leurs propres balises', async ({
    page,
  }) => {
    await page.goto('/')

    const document = marketingSite.legalDocuments[0]
    const slug = document?.slug ?? ''

    await page
      .getByRole('navigation', { name: text('marketing.footer.label') })
      .getByRole('link', { name: text(`marketing.legal.${slug}.title`) })
      .click()

    await expect(page).toHaveURL(urlOf(legalPath(slug)))
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      text(`marketing.legal.${slug}.title`),
    )
    await expect(page).toHaveTitle(text(`marketing.legal.${slug}.title`))
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article')

    // Chaque section déclarée est rendue.
    for (const section of document?.sections ?? []) {
      await expect(
        page.getByRole('heading', { name: text(`marketing.legal.${slug}.section.${section}.title`) }),
      ).toBeVisible()
    }
  })

  test('un document légal non déclaré répond 404', async ({ request }) => {
    const response = await request.get(publicPath('/legal/inexistant'), { maxRedirects: 0 })

    expect(response.status()).toBe(404)
  })

  test('une question de la FAQ s’ouvre et révèle sa réponse', async ({ page }) => {
    const faq = marketingSite.sections.find((section) => section.kind === 'faq')

    test.skip(faq === undefined, 'Cette configuration ne déclare pas de FAQ.')

    const item = faq?.items[0] ?? ''
    const question = text(`marketing.section.${faq?.id ?? ''}.item.${item}.title`)
    const answer = text(`marketing.section.${faq?.id ?? ''}.item.${item}.body`)

    await page.goto('/')

    const trigger = page.getByRole('button', { name: question })

    // Fermée, la réponse n'est pas seulement invisible : le contenu n'est pas
    // dans l'arbre d'accessibilité.
    await expect(page.getByText(answer)).toHaveCount(0)
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await trigger.click()

    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByText(answer)).toBeVisible()
  })
})

test.describe('site public coupé', () => {
  test.skip(publicSite, 'Le module marketing est activé dans cette configuration.')

  test('la racine redirige un visiteur anonyme vers la connexion', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveURL(urlOf('/sign-in'))
  })

  test('aucune page légale n’est servie', async ({ request }) => {
    for (const slug of ['privacy', 'terms']) {
      const response = await request.get(publicPath(legalPath(slug)), { maxRedirects: 0 })

      expect(response.status(), slug).toBe(404)
    }
  })
})

test('le lien de navigation du module suit son activation', async ({ page }) => {
  // Vrai dans les deux états, et dérivé : le module déclare une entrée publique
  // vers l'accueil, qui disparaît avec lui. Le libellé est lu **dans le module**
  // et non dans le catalogue de l'application — coupé, ses clés n'y sont plus,
  // et c'est précisément ce que ce cas mesure.
  const label = marketingModule.messages[defaultLocale]?.['navigation.home'] ?? ''

  expect(label).not.toBe('')

  await page.goto(publicPath('/sign-in'))

  const home = page
    .getByRole('navigation', { name: 'Modules' })
    .getByRole('link', { name: label })

  await expect(home).toHaveCount(publicSite ? 1 : 0)
})
