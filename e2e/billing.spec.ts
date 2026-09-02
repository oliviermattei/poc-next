import { billingRoutePath } from '@repo/module-billing'
import { expect, test } from '@playwright/test'

import { billing } from '../apps/web/lib/billing'
import { aSignedInAccount } from './support/account'
import { signInRedirectedFrom, urlOf } from './support/locale'

/**
 * Le parcours de souscription, **de bout en bout et sans un octet vers
 * l'extérieur**.
 *
 * `PAYMENTS_LOCAL_MODE=1` monte la simulation : le checkout est servi par
 * l'application, elle fabrique les événements que le fournisseur enverrait, les
 * signe, et les fait passer par la **vraie** route de webhook — signature
 * vérifiée, idempotence, ordre, écriture d'état. Ce que ce parcours mesure est
 * donc la chaîne réelle, pas un raccourci.
 *
 * Les attentes sont **dérivées de la configuration** (`billing.available`),
 * jamais recopiées : le fichier doit passer que le module soit activé ou non,
 * comme `e2e/organizations.spec.ts`.
 */

const mounted = billing.available

test.describe('la facturation', () => {
  test('redirige un visiteur anonyme vers la connexion, avec son retour', async ({ page }) => {
    test.skip(!mounted, 'module de facturation coupé')

    await page.goto('/billing')

    await expect(page).toHaveURL(signInRedirectedFrom('/billing'))
  })

  test('répond 404 quand le module est coupé', async ({ page }) => {
    test.skip(mounted, 'module de facturation activé')

    const response = await page.goto('/billing')

    expect(response?.status()).toBe(404)
  })

  test('souscrit une offre, et le retour affiche l’abonnement', async ({ page }) => {
    test.skip(!mounted, 'module de facturation coupé')

    await aSignedInAccount(page, 's19')
    await page.goto('/billing')

    // **Sans abonnement**, le premier des trois états que la story exige.
    await expect(page.getByText('Aucun abonnement').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pro mensuel' })).toBeVisible()

    // Le bouton n'est actionnable qu'une fois React aux commandes : c'est
    // l'affordance du dépôt, et c'est aussi ce qui remplace une reprise.
    const subscribe = page.getByRole('button', { name: 'Souscrire' }).first()

    await expect(subscribe).toBeEnabled()
    await subscribe.click()

    // Le retour de paiement : la navigation est pilotée par le script, jamais
    // par une redirection de formulaire — `form-action 'self'` refuserait la
    // seconde (recherche §7).
    await expect(page).toHaveURL(urlOf('/billing', '?checkout=success'))
    await expect(page.getByText('Paiement enregistré.', { exact: false })).toBeVisible()

    // **L'état vient de la base**, écrite par le webhook que la simulation a
    // fait passer : l'offre déclare quatorze jours d'essai, donc l'abonnement
    // ouvre en essai. Un `?checkout=success` n'accorde rien par lui-même.
    await expect(page.getByText('Période d’essai').first()).toBeVisible()

    // **Et plus aucune offre ne se souscrit** (constat M3 de la seconde revue).
    // Le fournisseur ne remplace pas un abonnement : un second checkout en
    // ouvre un second, prélevé, dont cet écran ne montrerait rien. Le
    // changement d'offre passe par le portail, et les cartes le disent.
    await expect(page.getByRole('button', { name: 'Souscrire' })).toHaveCount(0)
    await expect(page.getByText('Pour changer d’offre', { exact: false })).toBeVisible()
    await expect(page.getByText('Offre en cours')).toBeVisible()
  })

  /**
   * s20 — **l'achat unique, de bout en bout**.
   *
   * Le même checkout simulé que l'abonnement, donc la même chaîne réelle :
   * l'achat est écrit en attente à l'ouverture, la simulation fabrique et signe
   * l'événement du fournisseur, et la **vraie** route de webhook le promeut.
   * Ce que ce parcours mesure est donc la promotion, pas un raccourci.
   */
  test('achète une fois pour toutes, et ne le propose plus', async ({ page }) => {
    test.skip(!mounted, 'module de facturation coupé')

    await aSignedInAccount(page, 's20')
    await page.goto('/billing')

    // L'offre unique dit ce qu'elle est : un paiement, pas un abonnement.
    await expect(page.getByRole('heading', { name: 'Licence à vie' })).toBeVisible()
    await expect(page.getByText('paiement unique').first()).toBeVisible()

    const buy = page.getByRole('button', { name: 'Acheter' })

    await expect(buy).toBeEnabled()
    await buy.click()

    await expect(page).toHaveURL(urlOf('/billing', '?checkout=success'))

    // **L'état vient de la base**, écrite par le webhook : l'achat apparaît
    // dans l'historique des paiements, et il n'est plus proposé.
    await expect(page.getByText('Vos achats')).toBeVisible()
    await expect(page.getByText('Payé')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Acheter' })).toHaveCount(0)
    await expect(page.getByText('Déjà acheté')).toBeVisible()

    // **Le portail n'est pas proposé** (quatrième critère) : il n'y a aucun
    // abonnement à gérer, alors qu'un client existe bien chez le fournisseur.
    await expect(page.getByRole('button', { name: 'Gérer la facturation' })).toHaveCount(0)

    // Et l'abonnement reste ouvert : un acheteur à vie peut souscrire
    // (sixième critère).
    await expect(page.getByRole('button', { name: 'Souscrire' }).first()).toBeEnabled()
  })

  test('ouvre le portail client depuis la facturation', async ({ page }) => {
    test.skip(!mounted, 'module de facturation coupé')

    await aSignedInAccount(page, 's19-portail')
    await page.goto('/billing')
    await page.getByRole('button', { name: 'Souscrire' }).first().click()
    await expect(page).toHaveURL(urlOf('/billing', '?checkout=success'))

    const manage = page.getByRole('button', { name: 'Gérer la facturation' })

    await expect(manage).toBeEnabled()
    await manage.click()

    // La simulation ramène dans l'application : elle ne rejoue pas le portail
    // du fournisseur, et `packages/payments-testing/AGENTS.md` le dit.
    await expect(page).toHaveURL(urlOf('/billing', '?portal=local'))
  })

  test('refuse un webhook dont la signature est invalide, en 400', async ({ request }) => {
    test.skip(!mounted, 'module de facturation coupé')

    const response = await request.post(billingRoutePath('webhook'), {
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=forgee' },
      data: '{"id":"evt_forge","object":"event","type":"customer.subscription.created"}',
    })

    expect(response.status()).toBe(400)
  })

  /**
   * **Le checkout simulé appartient à qui l'a ouvert.**
   *
   * L'identifiant d'une session locale est déterministe, donc devinable
   * (constat F7 de la revue) : le parcours ouvre une vraie session avec un
   * compte, puis présente son URL à un client **anonyme**. Sans la garde de
   * session, ce client-là terminait le paiement de quelqu'un d'autre.
   */
  test('refuse le checkout simulé à qui n’a pas ouvert la session', async ({ page, request }) => {
    test.skip(!mounted, 'module de facturation coupé')

    await aSignedInAccount(page, 's19-session')

    const opened = await page.request.post(billingRoutePath('checkout'), {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ offerId: 'pro-monthly' }),
    })

    expect(opened.status()).toBe(200)

    const { url } = (await opened.json()) as { url: string }

    // Le contexte `request` ne porte aucun cookie de la page : c'est un
    // visiteur anonyme, muni de l'URL exacte.
    const stolen = await request.get(url, { maxRedirects: 0 })

    expect(stolen.status()).toBe(404)

    // Et le compte qui l'a ouverte, lui, la termine.
    const legitimate = await page.request.get(url, { maxRedirects: 0 })

    expect(legitimate.status()).toBe(303)
  })

  test('refuse un checkout anonyme, sans dire ce qui existe', async ({ request }) => {
    test.skip(!mounted, 'module de facturation coupé')

    const response = await request.post(billingRoutePath('checkout'), {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ offerId: 'pro-monthly' }),
    })

    expect(response.status()).toBe(401)
  })
})
