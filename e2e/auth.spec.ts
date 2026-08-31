import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

/**
 * Le parcours d'authentification, dans un vrai navigateur.
 *
 * Ce que ce fichier prouve et qu'aucun test Vitest ne peut prouver : le cookie
 * de session tel que le navigateur le stocke — et le fait que le JavaScript de
 * la page ne peut pas le lire —, la redirection d'une route protégée puis le
 * retour à l'URL demandée, et le lien de vérification suivi depuis la boîte
 * email jusqu'à la connexion.
 *
 * Les emails sont lus dans la **capture locale** (`docs/reliability.md` §2) :
 * l'application démarrée par Playwright écrit ses emails dans `apps/web/.mail`
 * au lieu de les envoyer. C'est le même chemin qu'en développement.
 */

const MAIL_DIRECTORY = fileURLToPath(new URL('../apps/web/.mail', import.meta.url))
const LINK_PATTERN = /http:\/\/localhost:\d+\/[^\s"<]+/g
const PASSWORD = 'mot-de-passe-de-test-e2e'

const anEmail = (): string => `s07-e2e-${randomUUID()}@example.test`

/** Le lien contenu dans le dernier email capturé pour ce destinataire. */
const linkSentTo = async (email: string): Promise<string> => {
  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    const files = await readdir(MAIL_DIRECTORY).catch(() => [] as string[])
    // Du plus récent au plus ancien : le nom du fichier de capture commence par
    // l'horodatage de l'envoi, et un même destinataire reçoit plusieurs emails
    // au cours d'un parcours. Prendre « un fichier qui le mentionne » rendrait
    // le cas dépendant de l'ordre de lecture du dossier.
    const contents = await Promise.all(
      files
        .filter((name) => name.endsWith('.html'))
        .sort((left, right) => right.localeCompare(left))
        .map(async (name) => await readFile(`${MAIL_DIRECTORY}/${name}`, 'utf8')),
    )

    const match = contents
      .find((content) => content.includes(email))
      ?.match(LINK_PATTERN)
      ?.at(-1)

    if (match !== undefined) {
      return match.replaceAll('&amp;', '&')
    }

    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  throw new Error(`Aucun email capturé pour ${email} dans ${MAIL_DIRECTORY}.`)
}

const signUp = async (page: Page, email: string): Promise<void> => {
  await page.goto('/sign-up')
  await page.getByLabel('Adresse email').fill(email)
  await page.getByLabel('Mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Créer le compte' }).click()
  await expect(page.getByRole('status')).toContainText('Vérifiez votre boîte email')
}

const signIn = async (page: Page, email: string): Promise<void> => {
  await page.getByLabel('Adresse email', { exact: true }).fill(email)
  await page.getByLabel('Mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
}

test('inscription, vérification, connexion, écran protégé, déconnexion', async ({ page, context }) => {
  const email = anEmail()

  await signUp(page, email)

  // Le lien de vérification, suivi depuis la « boîte email ».
  await page.goto(await linkSentTo(email))
  await expect(page).toHaveURL(/\/sign-in\?verified=1$/)
  await expect(page.getByRole('status')).toContainText('vérifiée')

  await signIn(page, email)
  await expect(page).toHaveURL(/\/account$/)
  await expect(page.getByRole('heading', { name: 'Mon compte' })).toBeVisible()

  // Le cookie de session, tel que le navigateur le stocke.
  const cookie = (await context.cookies()).find((candidate) => candidate.name.includes('session_token'))

  expect(cookie?.httpOnly).toBe(true)
  expect(cookie?.secure).toBe(true)
  expect(cookie?.sameSite).toBe('Strict')

  // Et ce que le JavaScript de la page en voit : rien.
  const readableByScript = await page.evaluate<string>('document.cookie')

  expect(readableByScript).not.toContain('session_token')

  // Le clic est **rejoué jusqu'à ce qu'il prenne** : un bouton rendu par le
  // serveur mais pas encore hydraté avale le premier clic sans rien faire, et
  // Playwright n'y voit qu'un clic réussi. Mesuré : une exécution sur dix
  // partait en échec sur cette ligne, ce qui fait d'un test un bruit et non
  // une garde. Une déconnexion rejouée reste sans effet supplémentaire.
  await expect(async () => {
    await page.getByRole('button', { name: 'Se déconnecter' }).click()
    await expect(page).toHaveURL(/\/$/, { timeout: 2_000 })
  }).toPass({ timeout: 20_000 })

  // La session est révoquée **côté serveur** : reposer le cookie ne la
  // ressuscite pas.
  await context.addCookies([cookie ?? { name: 'x', value: 'x', url: 'http://localhost' }])
  await page.goto('/account')
  await expect(page).toHaveURL(/\/sign-in\?next=(%2F|\/)account$/)
})

test('une route protégée redirige vers la connexion, puis ramène à l’URL demandée', async ({
  page,
}) => {
  const email = anEmail()

  await signUp(page, email)
  await page.goto(await linkSentTo(email))

  await page.goto('/account')
  await expect(page).toHaveURL(/\/sign-in\?next=(%2F|\/)account$/)

  await signIn(page, email)
  await expect(page).toHaveURL(/\/account$/)
})

test('compte inconnu et mot de passe invalide affichent le même message', async ({ page }) => {
  const email = anEmail()

  await signUp(page, email)
  await page.goto(await linkSentTo(email))

  await page.goto('/sign-in')
  await page.getByLabel('Adresse email', { exact: true }).fill(anEmail())
  await page.getByLabel('Mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()

  // Le refus est cherché **dans la page**, pas n'importe où : le serveur de
  // développement de Next injecte son propre élément `role="alert"`.
  const refusal = page.getByRole('main').getByRole('alert')

  await expect(refusal).toBeVisible()

  const unknownAccount = await refusal.innerText()

  await page.goto('/sign-in')
  await page.getByLabel('Adresse email', { exact: true }).fill(email)
  await page.getByLabel('Mot de passe').fill('un-autre-mot-de-passe')
  await page.getByRole('button', { name: 'Se connecter' }).click()

  await expect(refusal).toBeVisible()

  const wrongPassword = await refusal.innerText()

  expect(unknownAccount).toBe(wrongPassword)
  expect(unknownAccount).toContain('Identifiants invalides')
})

test('mot de passe oublié : le lien reçu mène à l’écran, et le nouveau mot de passe ouvre une session', async ({
  page,
}) => {
  const email = anEmail()
  const newPassword = 'un-tout-autre-mot-de-passe'

  await signUp(page, email)
  await page.goto(await linkSentTo(email))

  await page.goto('/forgot-password')
  await page.getByLabel('Adresse email').fill(email)
  await page.getByRole('button', { name: 'Recevoir un lien' }).click()
  await expect(page.getByRole('status')).toBeVisible()

  // Le lien est **suivi**, pas seulement lu : c'est ce qui attrape un lien
  // mort, et c'est ainsi qu'on a vu que celui de la bibliothèque pointait sur
  // une route qu'aucun module ne déclare.
  await page.goto(await linkSentTo(email))
  await expect(page.getByRole('heading', { name: 'Réinitialiser le mot de passe' })).toBeVisible()

  await page.getByLabel('Nouveau mot de passe').fill(newPassword)
  await page.getByRole('button', { name: 'Changer le mot de passe' }).click()
  await expect(page).toHaveURL(/\/sign-in\?reset=1$/)

  await page.getByLabel('Adresse email', { exact: true }).fill(email)
  await page.getByLabel('Mot de passe').fill(newPassword)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(/\/account$/)
})

test('la navigation montre « Mon compte » une fois connecté, jamais avant', async ({ page }) => {
  const email = anEmail()

  await signUp(page, email)
  await page.goto(await linkSentTo(email))

  const navigation = page.getByRole('navigation', { name: 'Modules' })

  await page.goto('/')
  await expect(navigation.getByRole('link', { name: 'Mon compte' })).toHaveCount(0)

  await page.goto('/sign-in')
  await signIn(page, email)
  await expect(page).toHaveURL(/\/account$/)

  await expect(navigation.getByRole('link', { name: 'Mon compte' })).toHaveCount(1)
})
