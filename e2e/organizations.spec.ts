import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { flatMessagesFor } from '../apps/web/lib/messages'
import { organizations } from '../apps/web/lib/organizations'
import { defaultLocale } from '../config/i18n'
import { aSignedInAccount, linkSentTo, signIn, signUp } from './support/account'
import { publicPath, urlOf } from './support/locale'

/**
 * Les organisations, dans un vrai navigateur.
 *
 * Ce que ce fichier prouve et qu'aucun test de nœud ne peut prouver : la
 * soumission **native** des formulaires — aucun JavaScript de notre part —, la
 * redirection 303 suivie par le navigateur, le sélecteur d'organisation
 * réellement ouvert, et surtout la **persistance de l'organisation courante
 * entre deux sessions** : un contexte de navigation neuf, une reconnexion, elle
 * est toujours là.
 *
 * **Il doit passer dans les deux états de configuration.** Ses attentes sont
 * donc dérivées de `organizations.available`, jamais recopiées — la même
 * discipline que `e2e/marketing.spec.ts` avec `marketingSite`.
 *
 * Les deux formulaires de l'écran portent les mêmes libellés de champ (« Nom »,
 * « Identifiant ») : ils sont donc désignés par le **nom accessible de leur
 * formulaire**, pas par un index. Deux formulaires anonymes sur un même écran
 * seraient indiscernables pour une aide technique comme pour ce parcours.
 */

const catalogue = flatMessagesFor(defaultLocale)
const mounted = organizations.available

/** Le texte attendu à l'écran, lu dans le catalogue de la langue servie. */
const text = (key: string): string => {
  const value = catalogue[key]

  if (value === undefined) {
    throw new Error(`Le catalogue « ${defaultLocale} » ne livre pas « ${key} ».`)
  }

  return value
}

const aSlug = (): string => `e2e-${randomUUID().slice(0, 8)}`

/** Le formulaire de création, désigné par son nom accessible. */
const createForm = (page: Page) =>
  page.getByRole('form', { name: text('organizations.create.title') })

/** Le formulaire de paramètres, désigné par le sien. */
const settingsForm = (page: Page) =>
  page.getByRole('form', { name: text('organizations.settings.title') })

const submitCreation = async (page: Page, name: string, slug: string): Promise<void> => {
  const form = createForm(page)

  await form.getByLabel(text('organizations.create.nameLabel')).fill(name)
  await form.getByLabel(text('organizations.create.slugLabel')).fill(slug)
  await form.getByRole('button', { name: text('organizations.create.submit') }).click()
}

test('module coupé, l’écran des organisations n’existe pas', async ({ page }) => {
  test.skip(mounted, 'Le module est activé dans cette configuration.')

  await aSignedInAccount(page, 's15-off')

  const response = await page.goto(publicPath('/organizations'))

  expect(response?.status()).toBe(404)
})

test('crée une organisation, la renomme, et la retrouve à la session suivante', async ({
  page,
  browser,
}) => {
  test.skip(!mounted, 'Le module est coupé dans cette configuration.')

  const email = await aSignedInAccount(page, 's15')

  await page.goto(publicPath('/organizations'))

  // L'état vide dit ce qu'il faut faire : un tableau vide sans action est un
  // écran cassé (`docs/design-system.md`).
  await expect(page.getByText(text('organizations.empty.title'))).toBeVisible()

  await submitCreation(page, 'Studio Martin', aSlug())

  await expect(page).toHaveURL(urlOf('/organizations'))
  // Le déclencheur du sélecteur porte le nom de l'organisation courante.
  await expect(page.getByRole('button', { name: 'Studio Martin' })).toBeVisible()
  // Le créateur en est **propriétaire** (critère 4), et le rôle est traduit.
  await expect(page.getByText(text('organizations.role.owner'), { exact: true })).toBeVisible()

  // Le renommage passe par le formulaire de paramètres (critère 5).
  await settingsForm(page).getByLabel(text('organizations.settings.nameLabel')).fill('Atelier Nord')
  await settingsForm(page)
    .getByRole('button', { name: text('organizations.settings.submit') })
    .click()

  await expect(page.getByRole('button', { name: 'Atelier Nord' })).toBeVisible()

  // Un identifiant réservé est refusé, et le message ne dit pas **pourquoi** :
  // le même que pour un identifiant déjà pris (`docs/security.md` §7).
  await submitCreation(page, 'Compte', 'account')

  await expect(page.getByRole('alert')).toHaveText(text('organizations.error.slug_unavailable'))

  // **Le critère 2** : l'organisation courante survit à la session. Un contexte
  // neuf n'a ni cookie ni stockage — c'est bien une seconde session.
  const second = await browser.newContext({ locale: 'fr-FR' })
  const reopened = await second.newPage()

  await reopened.goto(publicPath('/sign-in'))
  await signIn(reopened, email)
  // La connexion navigue : attendre son atterrissage avant de demander l'écran
  // suivant, sans quoi la seconde navigation annule la première.
  await expect(reopened).toHaveURL(urlOf('/'))
  await reopened.goto(publicPath('/organizations'))

  await expect(reopened.getByRole('button', { name: 'Atelier Nord' })).toBeVisible()

  await second.close()
})

test('bascule d’organisation, et refuse celle d’un autre compte', async ({ page, browser }) => {
  test.skip(!mounted, 'Le module est coupé dans cette configuration.')

  await aSignedInAccount(page, 's15-switch')
  await page.goto(publicPath('/organizations'))

  for (const name of ['Première', 'Seconde']) {
    await submitCreation(page, name, aSlug())
    await expect(page).toHaveURL(urlOf('/organizations'))
  }

  // La bascule est une **soumission**, pas un lien : basculer change un état
  // serveur. Le menu se désigne par son nom accessible, ses options par le leur.
  const option = page.getByRole('menuitem', { name: 'Première' })

  // **Ouvrir le menu demande que React ait pris la main** : un clic qui devance
  // l'hydratation ne fait rien, et le reste de l'écran, lui, fonctionne sans
  // JavaScript. Le geste est idempotent — ouvrir un menu déjà ouvert ne change
  // rien —, donc il est rejouable, et c'est la seule raison pour laquelle
  // `toPass` est employé ici (`playwright.config.ts`, `retries: 0`).
  await expect(async () => {
    await page.getByRole('button', { name: 'Seconde' }).click()
    await expect(option).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })

  await option.click()

  await expect(page).toHaveURL(urlOf('/organizations'))
  await expect(page.getByRole('button', { name: 'Première' })).toBeVisible()

  // L'identifiant de l'organisation courante, tel que l'écran le pose dans son
  // formulaire de paramètres : c'est lui qu'un autre compte va tenter.
  const organizationId = await settingsForm(page)
    .locator('input[name="organizationId"]')
    .inputValue()

  const other = await browser.newContext({ locale: 'fr-FR' })
  const stranger = await other.newPage()
  const strangerEmail = `s15-stranger-${randomUUID()}@example.test`

  await signUp(stranger, strangerEmail)
  await stranger.goto(await linkSentTo(strangerEmail))
  await signIn(stranger, strangerEmail)
  // La connexion doit avoir atterri : sans session, le répartiteur répondrait
  // 401, et le cas ne prouverait plus rien du périmètre organisationnel.
  await expect(stranger).toHaveURL(urlOf('/'))

  // **404, jamais 403** : un 403 confirmerait que cette organisation existe.
  const refused = await stranger.request.post('/api/modules/organizations/switch', {
    form: { organizationId },
    maxRedirects: 0,
  })

  expect(refused.status()).toBe(404)

  await other.close()
})

/**
 * **La bascule sans JavaScript** (arbitrage 3 de la revue de s15).
 *
 * Le menu du sélecteur est portalisé : Radix ne monte son contenu qu'à
 * l'ouverture, et l'ouverture est un état React. Sans script, le déclencheur
 * est donc un bouton qui ne fait rien, et la revue relevait qu'un visiteur sans
 * JavaScript voyait ses organisations sans pouvoir en changer.
 *
 * Le repli tient dans le formulaire qui existait déjà : les mêmes options, en
 * boutons de soumission natifs, dans un `<noscript>`. Aucun composant nouveau,
 * aucun jeton nouveau — et le navigateur les masque dès que le script tourne.
 *
 * Ce parcours est le seul endroit du dépôt qui puisse le prouver : `pnpm test`
 * rend le balisage mais n'a pas de moteur qui décide d'afficher un `<noscript>`.
 */
test('bascule d’organisation sans JavaScript', async ({ page, browser }) => {
  test.skip(!mounted, 'Le module est coupé dans cette configuration.')

  await aSignedInAccount(page, 's15-nojs')
  await page.goto(publicPath('/organizations'))

  for (const name of ['Alpha', 'Bêta']) {
    await submitCreation(page, name, aSlug())
    await expect(page).toHaveURL(urlOf('/organizations'))
  }

  // La session est reprise telle quelle ; seul le script est coupé.
  const withoutScript = await browser.newContext({
    locale: 'fr-FR',
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  })
  const silent = await withoutScript.newPage()

  await silent.goto(publicPath('/organizations'))

  // Le déclencheur porte l'organisation courante, et il ne s'ouvrira pas.
  await expect(silent.getByRole('button', { name: 'Bêta' })).toBeVisible()

  // L'option, elle, est un bouton de soumission du formulaire — pas un élément
  // de menu : sans script, il n'y a pas de menu.
  await silent.getByRole('button', { name: 'Alpha' }).click()

  await expect(silent).toHaveURL(urlOf('/organizations'))
  await expect(silent.getByRole('button', { name: 'Alpha' })).toBeVisible()

  await withoutScript.close()
})
