import { readdir, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import {
  CONTACT_FORM_KEYS,
  CONTACT_PATH,
  FORM_NOSCRIPT_KEY,
  NEWSLETTER_FORM_KEYS,
  marketingRoutePath,
} from '@repo/module-marketing'
import { expect, test } from '@playwright/test'

import { marketingSite } from '../apps/web/lib/marketing'
import { flatMessagesFor } from '../apps/web/lib/messages'
import { defaultLocale } from '../config/i18n'
import { publicPath } from './support/locale'

/**
 * Les deux formulaires publics, dans un vrai navigateur.
 *
 * Ce que ce fichier prouve et qu'aucun test de nœud ne peut prouver : le
 * formulaire réellement servi, soumis par un navigateur qui exécute
 * l'hydratation, et l'email réellement **capturé sur disque** par le mailer de
 * l'application — donc le port, l'adapter de capture et le rendu React Email,
 * pas une doublure.
 *
 * **Il doit passer dans les deux états de configuration.** Ses attentes sont
 * dérivées de `marketingSite`, jamais recopiées : module coupé, l'écran de
 * contact répond 404 et c'est ce qui est exigé.
 */

const catalogue = flatMessagesFor(defaultLocale)
const publicSite = marketingSite.sections.length > 0
const forms = marketingSite.forms
const hasNewsletterSection = marketingSite.sections.some((section) => section.kind === 'newsletter')

/** Le texte attendu à l'écran, lu dans le catalogue de la langue servie. */
const text = (key: string): string => {
  const value = catalogue[key]

  if (value === undefined) {
    throw new Error(`Le catalogue « ${defaultLocale} » ne livre pas « ${key} ».`)
  }

  return value
}

const MAIL_DIRECTORY = fileURLToPath(new URL('../apps/web/.mail', import.meta.url))

/** L'horodatage d'envoi, lu dans le nom du fichier de capture. */
const sentAt = (name: string): number => Number(/^local-(\d+)-/.exec(name)?.[1] ?? 0)

/**
 * Les emails capturés depuis un instant donné qui portent ce fragment.
 *
 * Un lecteur **à part** de `e2e/support/account.ts` : celui-là exige un lien
 * dans le corps, et aucun des deux emails de s11 n'en porte — la confirmation
 * d'inscription n'a délibérément pas de lien de désinscription, faute de route
 * qui le servirait. Réutiliser ce helper aurait fait attendre dix secondes puis
 * échouer sur une propriété que ces emails n'ont pas.
 */
const capturedSince = async (since: number, fragment: string): Promise<readonly string[]> => {
  const files = await readdir(MAIL_DIRECTORY).catch(() => [] as string[])

  const contents = await Promise.all(
    files
      .filter((name) => name.endsWith('.html') && sentAt(name) >= since)
      .map(async (name) => await readFile(`${MAIL_DIRECTORY}/${name}`, 'utf8')),
  )

  return contents.filter((content) => content.includes(fragment))
}

/** Attend qu'un email portant ce fragment soit capturé, et les rend tous. */
const waitForCaptured = async (since: number, fragment: string): Promise<readonly string[]> => {
  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    const found = await capturedSince(since, fragment)

    if (found.length > 0) {
      return found
    }

    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  throw new Error(`Aucun email capturé portant « ${fragment} ».`)
}

const anAddress = (prefix: string): string => `${prefix}-${randomUUID()}@example.test`

/**
 * Une adresse d'appelant **propre à chaque parcours**.
 *
 * Le seau de limitation de débit est en base et sa fenêtre dure dix minutes :
 * sans cela, deux exécutions rapprochées de ce fichier partageraient le seau de
 * `::1` et la seconde serait refusée. Ce n'est pas un contournement de la
 * limite — c'est ce qui rend la mesure reproductible, et c'est aussi la preuve
 * que l'identifiant vient bien de `x-forwarded-for`.
 */
const aClient = (): Record<string, string> => ({
  'x-forwarded-for': `198.51.100.${String(Math.floor(Math.random() * 250) + 1)}, 10.0.0.1`,
})

test.describe('les formulaires publics, site activé', () => {
  test.skip(!publicSite, 'Le module marketing est coupé : aucune page publique n’est servie.')

  test('inscrit une adresse à la newsletter, et n’envoie qu’une confirmation', async ({ page }) => {
    test.skip(
      !hasNewsletterSection,
      'La configuration ne déclare pas de section « newsletter ».',
    )

    const email = anAddress('newsletter')
    const since = Date.now()

    await page.setExtraHTTPHeaders(aClient())
    await page.goto(publicPath('/'))

    const submit = page.getByRole('button', { name: text(NEWSLETTER_FORM_KEYS.submit) })

    // Le bouton est désactivé jusqu'à l'hydratation : `toBeEnabled` est donc
    // aussi la preuve que l'affordance existe.
    await expect(submit).toBeEnabled()
    await page.getByLabel(text(NEWSLETTER_FORM_KEYS.email)).fill(email)
    await submit.click()

    await expect(page.getByRole('status')).toHaveText(text(NEWSLETTER_FORM_KEYS.success))

    const first = await waitForCaptured(since, email)

    expect(first).toHaveLength(1)

    // Rejouée à l'identique : la réponse est **la même**, et aucun second
    // email ne part (`docs/reliability.md` §1).
    await page.goto(publicPath('/'))
    await page.getByLabel(text(NEWSLETTER_FORM_KEYS.email)).fill(email)
    await page.getByRole('button', { name: text(NEWSLETTER_FORM_KEYS.submit) }).click()
    await expect(page.getByRole('status')).toHaveText(text(NEWSLETTER_FORM_KEYS.success))

    // Laisse à un éventuel second envoi le temps d'arriver avant de conclure.
    await page.waitForTimeout(1_500)

    expect(await capturedSince(since, email)).toHaveLength(1)
  })

  test('envoie un message de contact à l’adresse configurée', async ({ page }) => {
    const email = anAddress('contact')
    const since = Date.now()

    await page.setExtraHTTPHeaders(aClient())
    await page.goto(publicPath(CONTACT_PATH))

    await page.getByLabel(text(CONTACT_FORM_KEYS.name)).fill('Visiteur de passage')
    await page.getByLabel(text(CONTACT_FORM_KEYS.email)).fill(email)
    await page.getByLabel(text(CONTACT_FORM_KEYS.message)).fill('Une question sur les licences.')
    await page.getByRole('button', { name: text(CONTACT_FORM_KEYS.submit) }).click()

    await expect(page.getByRole('status')).toHaveText(text(CONTACT_FORM_KEYS.success))

    const captured = await waitForCaptured(since, email)

    // Le destinataire est celui de la **configuration**, pas l'adresse saisie :
    // c'est le piège que la story nomme.
    expect(captured[0]).toContain(forms?.contactRecipient ?? '')
  })

  test('refuse un champ invalide sans envoyer quoi que ce soit', async ({ page }) => {
    const marker = `invalide-${randomUUID()}`
    const since = Date.now()

    await page.setExtraHTTPHeaders(aClient())
    await page.goto(publicPath(CONTACT_PATH))

    await page.getByLabel(text(CONTACT_FORM_KEYS.name)).fill(marker)
    await page.getByLabel(text(CONTACT_FORM_KEYS.email)).fill('pas-une-adresse')
    await page.getByLabel(text(CONTACT_FORM_KEYS.message)).fill('Bonjour.')
    await page.getByRole('button', { name: text(CONTACT_FORM_KEYS.submit) }).click()

    // Le refus est cherché **dans le formulaire** : Next monte par ailleurs un
    // annonceur de route qui porte lui aussi `role="alert"`, et un sélecteur de
    // page entière le trouve d'abord.
    await expect(page.locator('form').getByRole('alert')).toHaveText(
      text(CONTACT_FORM_KEYS.invalid),
    )
    // Le formulaire est **toujours là** : la saisie n'est pas perdue.
    await expect(page.getByLabel(text(CONTACT_FORM_KEYS.name))).toHaveValue(marker)

    await page.waitForTimeout(1_000)

    expect(await capturedSince(since, marker)).toEqual([])
  })

  test('avale une soumission automatisée : réponse ordinaire, aucun effet', async ({ request }) => {
    // Le piège à robots, mesuré **par son absence d'effet** — c'est la seule
    // façon de le mesurer, puisque la réponse est délibérément celle d'une
    // soumission acceptée.
    const email = anAddress('robot')
    const since = Date.now()

    const response = await request.post(marketingRoutePath('newsletter'), {
      headers: aClient(),
      data: { email, website: 'https://spam.test', locale: defaultLocale },
    })

    expect(response.status()).toBe(200)

    await new Promise((resolve) => setTimeout(resolve, 1_000))

    expect(await capturedSince(since, email)).toEqual([])
  })
})

test.describe('le formulaire de contact sans JavaScript', () => {
  test.skip(!publicSite, 'Le module marketing est coupé : aucune page publique n’est servie.')

  // L'ADR 027 assume que ces formulaires exigent JavaScript. Ce qu'elle ne dit
  // nulle part, c'est que le bouton doive rester éteint **sans un mot** — mesuré
  // ainsi sous le build de production par la revue de s11 (constat F5).
  test.use({ javaScriptEnabled: false })

  test('laisse le bouton éteint, mais dit pourquoi', async ({ page }) => {
    await page.goto(publicPath(CONTACT_PATH))

    await expect(page.getByRole('button', { name: text(CONTACT_FORM_KEYS.submit) })).toBeDisabled()

    /**
     * Le contenu d'un `<noscript>` est atteint par un sélecteur de structure, et
     * il n'y a pas d'autre voie : les moteurs de texte et de rôle de Playwright
     * ignorent ce sous-arbre — mesuré, `getByText` y rend zéro alors que le bloc
     * occupe 622 × 66 pixels à l'écran. `toBeVisible` dit qu'il est réellement
     * rendu (navigateur sans JavaScript), `toHaveText` qu'il porte l'explication
     * et non un bloc vide.
     */
    const explanation = page.locator('noscript > *')

    await expect(explanation).toBeVisible()
    await expect(explanation).toHaveText(text(FORM_NOSCRIPT_KEY))
  })
})

test.describe('les formulaires publics, site coupé', () => {
  test.skip(publicSite, 'Le module marketing est activé : les pages publiques sont servies.')

  test('ne sert pas l’écran de contact', async ({ page }) => {
    const response = await page.goto(publicPath(CONTACT_PATH))

    expect(response?.status()).toBe(404)
  })

  test('ne monte aucune route de formulaire', async ({ request }) => {
    for (const path of [marketingRoutePath('contact'), marketingRoutePath('newsletter')]) {
      const response = await request.post(path, { data: {} })

      expect(response.status(), path).toBe(404)
    }
  })
})
