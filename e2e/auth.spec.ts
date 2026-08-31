import { expect, test } from '@playwright/test'

import { anEmail as anAddress, linkSentTo, PASSWORD, signIn, signUp } from './support/account'
import { anonymousLanding, signInRedirectedFrom, urlOf } from './support/locale'

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
 *
 * Les gestes communs — inscrire, lire la boîte, se connecter — viennent de
 * `support/account.ts`. Ils y ont été extraits par s08 ; ce fichier en gardait
 * une copie, et les deux ont divergé : la copie lisait « le dernier email
 * écrit » sans condition d'ordre, ce qui rendait le parcours « mot de passe
 * oublié » instable. Une seule lecture de la boîte, donc, corrigée une fois.
 */

const anEmail = (): string => anAddress('s07-e2e')

test('inscription, vérification, connexion, écran protégé, déconnexion', async ({ page, context }) => {
  const email = anEmail()

  await signUp(page, email)

  // Le lien de vérification, suivi depuis la « boîte email ».
  await page.goto(await linkSentTo(email))
  await expect(page).toHaveURL(urlOf('/sign-in', '?verified=1'))
  await expect(page.getByRole('status')).toContainText('vérifiée')

  // La connexion aboutit au **tableau de bord** : c'est le critère 1 de s08.
  // s07 repliait sur `/account`, faute de tableau de bord à atteindre.
  await signIn(page, email)
  await expect(page).toHaveURL(urlOf('/'))

  await page.goto('/account')
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
    // Déconnecté, l'appelant est anonyme : il atteint l'accueil public, ou
    // l'écran de connexion si le site public est coupé. L'attente est dérivée.
    await expect(page).toHaveURL(urlOf(anonymousLanding()), { timeout: 2_000 })
  }).toPass({ timeout: 20_000 })

  // La session est révoquée **côté serveur** : reposer le cookie ne la
  // ressuscite pas.
  await context.addCookies([cookie ?? { name: 'x', value: 'x', url: 'http://localhost' }])
  await page.goto('/account')
  await expect(page).toHaveURL(signInRedirectedFrom('/account'))
})

test('une route protégée redirige vers la connexion, puis ramène à l’URL demandée', async ({
  page,
}) => {
  const email = anEmail()

  await signUp(page, email)
  await page.goto(await linkSentTo(email))

  await page.goto('/account')
  await expect(page).toHaveURL(signInRedirectedFrom('/account'))

  await signIn(page, email)

  // **L'origine fait partie de l'assertion.** Sans elle, le motif `/\/account$/`
  // est déjà satisfait par l'URL de départ — `/sign-in?next=/account` se termine
  // par `/account` — donc l'assertion passe *avant* la redirection et ne peut
  // pas échouer. Mesuré en revue de s08 : neutraliser complètement la prise en
  // compte de `?next=` laissait les vingt parcours verts. C'est le seul endroit
  // du dépôt qui tient cette propriété ; le repli, lui, est tenu par les
  // assertions `/localhost:\d+\/$/` des autres parcours.
  await expect(page).toHaveURL(urlOf('/account'))
})

test('compte inconnu, mot de passe invalide et adresse non vérifiée affichent le même message', async ({
  page,
}) => {
  const email = anEmail()
  const unverified = anEmail()

  await signUp(page, email)
  await page.goto(await linkSentTo(email))

  // Un compte inscrit dont le lien n'est **pas** suivi : c'est l'état que la
  // bibliothèque distinguait par un `403`, jusqu'à ce que la route ramène tous
  // les refus au même. Le formulaire n'a donc plus de branche à lui.
  await signUp(page, unverified)

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

  await page.goto('/sign-in')
  await page.getByLabel('Adresse email', { exact: true }).fill(unverified)
  await page.getByLabel('Mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()

  await expect(refusal).toBeVisible()

  const notVerified = await refusal.innerText()

  expect(wrongPassword).toBe(unknownAccount)
  expect(notVerified).toBe(unknownAccount)
  expect(unknownAccount).toContain('Identifiants invalides')

  // Il y avait ici un `toHaveURL(/\/sign-in$/)`, commenté « la page protégée
  // n'est pas atteinte ». Il ne pouvait pas échouer : la page **part** de
  // `/sign-in`, donc le motif est satisfait par l'URL de départ, avant toute
  // navigation — la même forme que le finding M2 de la revue, en négatif. La
  // propriété qu'il prétendait tenir est tenue ailleurs, et pour de vrai : un
  // refus qui aurait navigué ferait déjà rougir les trois `expect(refusal)`
  // ci-dessus, et la redirection d'une route protégée a son propre parcours
  // (« une route protégée redirige vers la connexion »). Une assertion qui ne
  // peut pas rougir est pire que pas d'assertion : elle occupe la place.
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

  // L'instant de la demande : le lien attendu est celui d'**après**, jamais
  // celui de la vérification, déjà consommé plus haut.
  const requestedAt = Date.now()

  await page.getByRole('button', { name: 'Recevoir un lien' }).click()
  await expect(page.getByRole('status')).toBeVisible()

  // Le lien est **suivi**, pas seulement lu : c'est ce qui attrape un lien
  // mort, et c'est ainsi qu'on a vu que celui de la bibliothèque pointait sur
  // une route qu'aucun module ne déclare.
  await page.goto(await linkSentTo(email, { since: requestedAt }))
  await expect(page.getByRole('heading', { name: 'Réinitialiser le mot de passe' })).toBeVisible()

  await page.getByLabel('Nouveau mot de passe').fill(newPassword)
  await page.getByRole('button', { name: 'Changer le mot de passe' }).click()
  await expect(page).toHaveURL(urlOf('/sign-in', '?reset=1'))

  await page.getByLabel('Adresse email', { exact: true }).fill(email)
  await page.getByLabel('Mot de passe').fill(newPassword)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(urlOf('/'))
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
  await expect(page).toHaveURL(urlOf('/'))

  await expect(navigation.getByRole('link', { name: 'Mon compte' })).toHaveCount(1)
})
