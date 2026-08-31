import { expect, test } from '@playwright/test'

import { publicPath, urlOf } from './support/locale'

/**
 * La connexion par fournisseur externe, dans un vrai navigateur (s12).
 *
 * Le fournisseur est celui de **développement**, monté par le drapeau
 * `OAUTH_LOCAL_PROVIDER=1` que `playwright.config.ts` pose : aucune clé, aucun
 * appel sortant, et le même code de bibliothèque que Google ou GitHub —
 * `/sign-in/social`, `/callback/:id`, la décision de liaison. C'est aussi la
 * démonstration que le mode local sert à quelque chose : sans lui, ce parcours
 * n'existerait pas hors d'un poste muni d'identifiants réels.
 *
 * Ce que ce fichier prouve et qu'aucun test Vitest ne peut prouver :
 *
 * 1. le bouton fonctionne **sans JavaScript** — c'est un formulaire, et la
 *    route répond une redirection ;
 * 2. les attributs des deux cookies tels que le navigateur les stocke : l'état
 *    en `Lax` (sans quoi il ne revient pas du fournisseur), la session en
 *    `Strict` ;
 * 3. **le retour inter-sites**, qui est le seul contexte où le rebond de
 *    `/oauth/return` se justifie. Un cookie `Strict` ne repart pas sur la fin
 *    d'une chaîne de navigation venue d'un autre site : sans rebond,
 *    l'utilisateur atterrit déconnecté alors que sa session existe.
 */

const LOCAL_PROVIDER_BUTTON = /Continuer avec/

test('le bouton de fournisseur ouvre une session, sans JavaScript', async ({ browser }) => {
  // JavaScript coupé : le bouton est un `<form method="post">` et la route
  // répond `302`. C'est la différence assumée avec les formulaires
  // d'identifiants, qui eux attendent l'hydratation — ceux-là envoient un
  // secret, celui-ci n'en envoie aucun.
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()

  await page.goto('/sign-in')
  await page.getByRole('button', { name: LOCAL_PROVIDER_BUTTON }).click()

  // Sans JavaScript, le rebond du retour repose sur son `meta refresh`, que le
  // navigateur suit tout seul.
  await expect(page).toHaveURL(urlOf('/'))
  await expect(page.getByRole('button', { name: /Mon compte|Compte/ })).toBeVisible()

  const cookies = await context.cookies()
  const session = cookies.find((cookie) => cookie.name.includes('session_token'))

  expect(session?.httpOnly).toBe(true)
  expect(session?.secure).toBe(true)
  // Le socle n'est pas relâché pour faire marcher OAuth : la session reste
  // `Strict`, et c'est le rebond qui rend le retour utilisable.
  expect(session?.sameSite).toBe('Strict')

  await context.close()
})

test('le cookie d’état est envoyé au retour du fournisseur, donc `Lax`', async ({
  page,
  context,
  baseURL,
}) => {
  await page.goto('/sign-in')

  // Le formulaire est posté sans suivre la redirection : on veut voir le cookie
  // d'état **tel qu'il vient d'être posé**, avant que le rappel ne le consomme.
  //
  // L'en-tête `Origin` est celui qu'un navigateur envoie, et il est là pour
  // ressembler à un vrai formulaire — **pas** parce qu'une garde l'exigerait.
  // Mesuré, sur les trois formes essayées : `Origin` du site, `Origin:
  // https://evil.test` et **aucun** `Origin` rendent tous les trois 302 avec un
  // cookie d'état. La bibliothèque ne refuse ni l'un ni l'autre : un site tiers
  // peut donc déclencher le début d'un parcours dans le navigateur d'une
  // victime. La variante qui compte — la faire atterrir dans le compte de
  // l'attaquant — reste fermée par la liaison de l'état au cookie, et c'est le
  // cas « état d'un autre navigateur » de `tests/auth.test.ts` qui le tient.
  // `docs/security.md` ne pose pas de règle CSRF ; la fermer serait une story.
  const start = await context.request.post('/api/modules/auth/sign-in/social', {
    form: { provider: 'local' },
    headers: { origin: baseURL ?? '' },
    maxRedirects: 0,
  })

  expect(start.status()).toBe(302)

  const state = (await context.cookies()).find((cookie) => cookie.name.includes('state'))

  expect(state?.httpOnly).toBe(true)
  expect(state?.secure).toBe(true)
  // `Strict` empêcherait le navigateur de l'envoyer au retour du fournisseur —
  // une navigation inter-sites —, et **toute** connexion externe échouerait en
  // `state_security_mismatch`. `docs/security.md` §1 exige `Lax` au minimum, et
  // `Strict` pour la session seule.
  expect(state?.sameSite).toBe('Lax')
})

test('le retour venu d’un autre site atterrit connecté', async ({ page, context, baseURL }) => {
  // Le parcours est conduit jusqu'au rappel par le client HTTP du contexte —
  // qui partage le bocal à cookies du navigateur —, puis **le dernier saut est
  // fait par un clic depuis une origine tierce** : c'est exactement ce que fait
  // un fournisseur OAuth, et c'est la seule façon de reproduire la chaîne
  // inter-sites.
  const start = await context.request.post('/api/modules/auth/sign-in/social', {
    form: { provider: 'local' },
    headers: { origin: baseURL ?? '' },
    maxRedirects: 0,
  })

  expect(start.status()).toBe(302)

  const authorize = start.headers().location ?? ''
  const authorized = await context.request.get(authorize, { maxRedirects: 0 })
  const callback = new URL(authorized.headers().location ?? '', baseURL)

  await page.route('http://fournisseur.test/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html lang="fr"><body><a id="retour" href="${callback.toString()}">retour</a></body></html>`,
    })
  })

  await page.goto('http://fournisseur.test/')
  await page.getByRole('link', { name: 'retour' }).click()

  // La session est réellement utilisable après le retour : le rebond a provoqué
  // une seconde navigation same-site, et c'est celle-là qui porte le cookie.
  await expect(page).toHaveURL(urlOf('/'))
  await expect(page.getByRole('button', { name: /Mon compte|Compte/ })).toBeVisible()

  await page.goto('/account')
  await expect(page.getByRole('heading', { name: 'Mon compte' })).toBeVisible()
  await expect(page.getByText('Connexions externes')).toBeVisible()
})

test('le refus du fournisseur ramène à la connexion, sans session et sans oracle', async ({
  page,
  context,
}) => {
  // Ce que le fournisseur renvoie quand la personne refuse l'autorisation
  // (RFC 6749 §4.1.2.1), et ce que la bibliothèque en fait : une redirection
  // vers la route de normalisation du module.
  await page.goto(`/api/modules/auth/oauth-error?error=access_denied`)

  await expect(page).toHaveURL(urlOf('/sign-in', '?oauth=denied'))
  // `getByRole('alert')` en attraperait deux : Next monte son propre annonceur
  // de route, vide, avec ce rôle.
  await expect(page.locator('[data-slot="alert"]')).toContainText('refusé')

  // Un code qui nomme l'état du compte ne franchit pas la route : il ressort en
  // « échec », et l'URL elle-même ne le porte plus.
  await page.goto(`/api/modules/auth/oauth-error?error=account_not_linked`)

  await expect(page).toHaveURL(urlOf('/sign-in', '?oauth=failed'))
  expect(page.url()).not.toContain('account_not_linked')
  expect(
    (await context.cookies()).some((cookie) => cookie.name.includes('session_token')),
  ).toBe(false)
})

test('le fournisseur n’est proposé qu’une fois, et la page de rebond ne redirige que vers ce site', async ({
  page,
}) => {
  await page.goto('/sign-in')

  // Un bouton par fournisseur monté : ici le fournisseur de développement, et
  // lui seul — aucune clé Google ou GitHub n'est posée par la configuration des
  // parcours.
  await expect(page.getByRole('button', { name: LOCAL_PROVIDER_BUTTON })).toHaveCount(1)

  // La destination du rebond est **revalidée** : elle arrive dans l'URL.
  await page.goto(`${publicPath('/oauth/return')}?next=${encodeURIComponent('https://evil.test')}`)
  await expect(page).toHaveURL(urlOf('/'))
})
