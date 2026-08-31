import { expect, test } from '@playwright/test'

import { localeRouting } from '../apps/web/lib/locale-routing'
import { defaultLocale } from '../config/i18n'
import { anEmail, mailSentTo } from './support/account'
import { urlOf } from './support/locale'

/**
 * La langue, vue depuis un navigateur réellement démarré.
 *
 * Ce que ce fichier prouve et qu'aucun test Vitest ne peut prouver : la forme
 * des URL servies, la persistance du choix d'une visite à l'autre (donc un
 * cookie réellement posé et relu), l'attribut `lang` du document, et la langue
 * d'un email tel qu'il part.
 *
 * **Il doit passer dans les deux états de configuration.** Ses attentes sont
 * donc dérivées de `localeRouting`, jamais recopiées : un parcours qui adapte
 * ses attentes à la configuration ne prouve plus rien sur la configuration.
 */

const OTHER_LOCALE = localeRouting.locales.find((locale) => locale !== defaultLocale)
const servesOneLanguage = localeRouting.locales.length < 2

test('les mêmes écrans sont servis, préfixe de locale ou non', async ({ page }) => {
  // Le critère qui décide de la forme de toutes les routes du dépôt : les URL
  // d'origine répondent dans les deux états. Elles redirigent vers leur forme
  // canonique quand le module est activé, elles sont servies telles quelles
  // sinon — dans les deux cas, l'écran arrive.
  for (const pathname of ['/', '/sign-in', '/sign-up', '/forgot-password', '/verify-email']) {
    const response = await page.goto(pathname)

    expect(response?.status(), pathname).toBe(200)
    await expect(page).toHaveURL(urlOf(pathname))
  }
})

test('les routes de module n’héritent d’aucun préfixe de locale', async ({ request }) => {
  // Elles sont montées sous `/api/modules/…` et servent les liens envoyés par
  // email : les préfixer les casserait toutes.
  const response = await request.post('/api/modules/auth/sign-in/email', {
    data: {},
    failOnStatusCode: false,
  })

  expect(response.status()).not.toBe(404)
})

test('une clé de traduction absente fait échouer la requête', async ({ request }) => {
  // Le critère 9, mesuré **au bout de la chaîne**. Le refus vit dans
  // `apps/web/i18n/request-config.ts` et un test de nœud l'exécute ; ce que lui
  // seul ne peut pas dire, c'est que `i18n/request.ts` le branche encore. La
  // revue de s09 l'a mesuré : ramener ce fichier au repli silencieux laissait
  // toute la suite verte. Ici, la même mutation rend 200 avec « app.probe.absent »
  // dans le corps, et ce parcours rougit.
  const response = await request.get('/api/i18n-probe', { failOnStatusCode: false })

  expect(response.status(), await response.text()).toBe(500)
})

test('la page annonce la langue qu’elle sert', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('html')).toHaveAttribute('lang', defaultLocale)
})

test('le sélecteur n’apparaît que si plusieurs langues sont servies', async ({ page }) => {
  await page.goto('/')

  // Une seule langue : rien à choisir, donc aucun sélecteur. Deux : il est là.
  // La condition porte sur les langues servies, jamais sur un identifiant de
  // module — d'où un parcours unique pour les deux états.
  const switcher = page.getByRole('button', { name: 'Langue' })

  await expect(switcher).toHaveCount(servesOneLanguage ? 0 : 1)
})

test('changer de langue traduit l’écran et persiste entre deux sessions', async ({
  page,
  context,
}) => {
  test.skip(servesOneLanguage, 'Le module i18n est coupé : une seule langue est servie.')

  await page.goto('/sign-in')
  await expect(page.getByRole('heading', { name: 'Se connecter', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: 'Langue' }).click()
  await page.getByRole('menuitem', { name: 'English' }).click()

  // Le sélecteur mène à l'accueil de la langue choisie : c'est un lien, donc il
  // fonctionne sans JavaScript, et l'URL porte la langue.
  await expect(page).toHaveURL(new RegExp(`localhost:\\d+\\/${OTHER_LOCALE ?? ''}$`))
  await expect(page.locator('html')).toHaveAttribute('lang', OTHER_LOCALE ?? '')
  // Un texte que seule la version anglaise porte : « Créer un compte » et
  // « Create an account » ne peuvent pas être vrais en même temps.
  await expect(page.getByRole('link', { name: 'Create an account' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Créer un compte' })).toHaveCount(0)

  // La persistance : une **nouvelle** page du même navigateur, sur une URL sans
  // préfixe. Sans cookie, la négociation retomberait sur `fr-FR` que
  // `playwright.config.ts` demande — c'est ce qui rend ce cas discriminant.
  const revisit = await context.newPage()

  await revisit.goto('/sign-in')

  await expect(revisit).toHaveURL(/\/en\/sign-in$/)
  await expect(revisit.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible()

  // Le cookie tel que le **navigateur** le stocke, et non tel que le proxy
  // prétend l'écrire : `docs/security.md` §1 vaut pour tout cookie, pas pour
  // le seul cookie de session. Même geste que `e2e/auth.spec.ts` sur la
  // session, sur le premier cookie hors session du dépôt.
  const cookie = (await context.cookies()).find((candidate) => candidate.name === 'app_locale')

  expect(cookie?.httpOnly).toBe(true)
  expect(cookie?.secure).toBe(true)
  expect(cookie?.sameSite).toBe('Lax')

  // Et ce que le JavaScript de la page en voit : rien.
  await expect(revisit.evaluate<string>('document.cookie')).resolves.not.toContain('app_locale')
})

test('l’email part dans la langue du destinataire, et non dans celle du site', async ({
  browser,
}) => {
  test.skip(servesOneLanguage, 'Le module i18n est coupé : une seule langue est servie.')

  // Un navigateur qui demande l'anglais, sans jamais toucher au sélecteur : la
  // langue du destinataire est celle dans laquelle il vient de faire sa
  // demande. Le sujet et le corps viennent du template déclaré au contrat par
  // le module, dans cette locale.
  const english = await browser.newContext({ locale: 'en-GB' })
  const page = await english.newPage()
  const email = anEmail('locale')
  const requestedAt = Date.now()

  await page.goto('/sign-up')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill('mot-de-passe-de-test-e2e')
  await page.getByRole('button', { name: 'Create the account' }).click()
  await expect(page.getByRole('status')).toBeVisible()

  const captured = await mailSentTo(email, { since: requestedAt })

  // Le texte est celui que **le module** déclare au contrat pour cette locale
  // (`packages/modules/auth/src/emails/verification.ts`). L'absence de la
  // version française est la moitié qui compte : sans elle, un email bilingue
  // passerait au vert.
  expect(captured).toContain('Confirm your address to activate your account')
  expect(captured).not.toContain('Confirmez votre adresse pour activer votre compte')

  await english.close()
})
