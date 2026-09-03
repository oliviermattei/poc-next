import { MODULE_ROUTE_PREFIX } from '@repo/core'
import {
  PRICING_SCREEN_PATH,
  billingRoutePath,
  formatOfferPrice,
} from '@repo/module-billing'
import { demoEnabledModule, DEMO_PREMIUM_SCREEN_PATH } from '@repo/module-demo-enabled'
import { expect, test } from '@playwright/test'

import { billing } from '../apps/web/lib/billing'
import { billingOffers } from '../config/billing'
import { defaultLocale } from '../config/i18n'
import { aSignedInAccount, anEmail, linkSentTo, signIn, signUp } from './support/account'
import { publicPath, signInRedirectedFrom, urlOf } from './support/locale'

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

/**
 * Le chemin de la route réservée, **dérivé du contrat du module** : le recopier
 * ferait un parcours qui reste vert quand la route déménage.
 */
const PREMIUM_ROUTE =
  demoEnabledModule.routes.find((route) => route.protection.level === 'entitlement')?.path ?? ''

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
   *
   * **Depuis s24, un anonyme n'est plus refusé d'office** : c'est lui que sert
   * le tunnel invité. Le refus tient donc à la nature de la session — la porte
   * invitée ne termine que les sessions dont le périmètre s'écrit `guest:`, et
   * `billingScopeReference` n'en produit jamais. Le statut, lui, n'a pas
   * changé : 404, indiscernable d'une session inconnue.
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


  /**
   * s21 — **la fonctionnalité réservée, des deux côtés du mur**.
   *
   * Le second critère de la story porte sur les deux surfaces à la fois : la
   * route de l'API refuse en **403**, l'écran affiche une **invitation à
   * souscrire**. Ce parcours est le seul endroit du dépôt où la vraie session,
   * la vraie base et le vrai répartiteur se rencontrent : c'est donc lui qui
   * tient le câblage du résolveur de droits sur la route montée
   * (`apps/web/app/api/modules/[...path]/route.ts`).
   *
   * Et il mesure l'essai : l'offre livrée en déclare quatorze jours, si bien que
   * le checkout simulé ouvre un abonnement **en essai** — un droit d'accès que
   * personne n'a payé, et qui ouvre pourtant la fonctionnalité (critère 4).
   */
  test('réserve une fonctionnalité à une offre, et l’ouvre dès l’essai', async ({ page }) => {
    test.skip(!mounted, 'module de facturation coupé')

    await aSignedInAccount(page, 's21')

    // **L'écran invite, il ne masque pas.** Une fonctionnalité qu'on ne voit
    // pas ne s'achète pas, et masquer n'a jamais été une permission.
    await page.goto('/premium')
    await expect(page.getByText('Réservé aux offres payantes')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Voir les offres' })).toBeVisible()

    // **Et la route refuse en 403**, session comprise : c'est la garde qui
    // compte, celle que l'écran ne peut pas contourner.
    const refused = await page.request.get(`${MODULE_ROUTE_PREFIX}${PREMIUM_ROUTE}`)

    expect(refused.status()).toBe(403)
    expect(await refused.json()).toEqual({ error: 'forbidden' })

    // Souscrire : l'offre livrée porte quatorze jours d'essai, donc l'accès
    // vient d'un essai, pas d'un paiement.
    await page.goto('/billing')
    await page.getByRole('button', { name: 'Souscrire' }).first().click()
    await expect(page).toHaveURL(urlOf('/billing', '?checkout=success'))
    await expect(page.getByText('Période d’essai').first()).toBeVisible()

    await page.goto('/premium')
    await expect(page.getByText('Accès ouvert')).toBeVisible()

    const served = await page.request.get(`${MODULE_ROUTE_PREFIX}${PREMIUM_ROUTE}`)

    expect(served.status()).toBe(200)
    expect(await served.json()).toHaveProperty('count')
  })

  /**
   * **Le mur est le même pour tout le monde tant que rien n'est payé.**
   *
   * Un visiteur anonyme est renvoyé vers la connexion — il n'y a pas de
   * périmètre dont parler —, et la route répond 401 sans dire ce qui existe.
   */
  test('renvoie un visiteur anonyme vers la connexion, et refuse la route en 401', async ({
    page,
    request,
  }) => {
    await page.goto('/premium')

    await expect(page).toHaveURL(signInRedirectedFrom('/premium'))

    const response = await request.get(`${MODULE_ROUTE_PREFIX}${PREMIUM_ROUTE}`)

    expect(response.status()).toBe(401)
  })

  /**
   * **L'entrée visible mène à un écran, pas à du JSON nu** (constat m6 de la
   * revue).
   *
   * L'ADR 043 justifie la visibilité de l'entrée de navigation par
   * l'invitation à souscrire : une fonctionnalité qu'on ne voit pas ne s'achète
   * pas. Une entrée qui rendait `{"error":"forbidden"}` au clic n'invitait
   * personne — elle affichait le refus de l'API, pédagogie nulle, et l'écran
   * qui porte l'invitation n'était atteignable qu'en tapant son URL.
   *
   * **Aucun `skip` ici** : l'entrée appartient à `demo-enabled` et l'écran rend
   * dans les deux configurations. C'est le seul parcours de la story qui mesure
   * quelque chose quand le module de facturation est coupé.
   */
  test('mène de la navigation à l’écran de la fonctionnalité réservée', async ({ page }) => {
    await aSignedInAccount(page, 's21-navigation')

    await page.goto('/')
    await page
      .getByRole('navigation', { name: 'Modules' })
      .getByRole('link', { name: 'Rapport détaillé' })
      .click()

    await expect(page).toHaveURL(urlOf(DEMO_PREMIUM_SCREEN_PATH))
    // Un écran, avec son titre — et non un corps JSON servi par la route du
    // module.
    await expect(
      page.getByRole('heading', { name: 'Rapport détaillé', exact: true, level: 1 }),
    ).toBeVisible()
  })

  /* ------------------------------------------------------------------------ *
   * s22 — la page **publique** de tarifs, dans un vrai navigateur.
   *
   * Ce que ce parcours prouve et qu'aucun test de nœud ne peut prouver : la
   * page est servie sans session, l'entrée de navigation y mène pour un
   * visiteur anonyme, et le choix d'offre survit à l'aller-retour par la
   * connexion.
   * ------------------------------------------------------------------------ */
  /**
   * **s24 — payer sans créer de compte d'abord**, de bout en bout.
   *
   * Ce que ce parcours prouve et qu'aucun test de nœud ne peut prouver : un
   * visiteur **sans session** part de la page publique, traverse le tunnel,
   * revient sur un écran public, et son compte est créé **par le webhook** —
   * la route de simulation fait passer les événements par la vraie route du
   * module, signature comprise.
   *
   * Il prouve aussi les deux interdits : **aucune session** n'est ouverte au
   * retour — le visiteur reste anonyme, la navigation ne lui montre pas de menu
   * de compte —, et le seul chemin vers le compte est le **lien reçu par
   * email**.
   */
  test('paie sans compte, et le compte naît du webhook — pas du retour', async ({ page }) => {
    test.skip(!mounted, 'module de facturation coupé')

    // L'entrée est **publique** : un visiteur sans session la voit, et elle
    // mène à un écran — pas à du JSON.
    await page.goto('/')
    await page
      .getByRole('navigation', { name: 'Modules' })
      .getByRole('link', { name: 'Tarifs' })
      .click()

    await expect(page).toHaveURL(urlOf(PRICING_SCREEN_PATH))
    await expect(page.getByRole('heading', { name: 'Nos offres', level: 1 })).toBeVisible()

    // Une carte par offre du catalogue, et les libellés **dérivés** de leur
    // mode : « Souscrire » pour un abonnement, « Acheter » pour un achat unique.
    const subscriptions = billingOffers.filter((offer) => offer.mode === 'subscription')
    const purchases = billingOffers.filter((offer) => offer.mode === 'one_time')

    await expect(page.getByRole('button', { name: 'Souscrire' })).toHaveCount(subscriptions.length)
    await expect(page.getByRole('button', { name: 'Acheter' })).toHaveCount(purchases.length)

    // Le prix affiché est celui du catalogue, dans la langue servie.
    for (const offer of billingOffers) {
      await expect(
        page.getByText(formatOfferPrice(offer, defaultLocale), { exact: true }),
        offer.id,
      ).toBeVisible()
    }

    const sentSince = Date.now()
    // L'aller vers la page hébergée simulée porte l'identifiant de session, et
    // c'est de lui que le simulateur dérive l'adresse qu'une vraie page aurait
    // collectée. Il faut donc l'attraper au passage : le retour, lui, est une
    // URL publique qui ne porte rien.
    const hosted = page.waitForRequest((request) =>
      request.url().includes('/api/billing-local-checkout'),
    )

    await page.getByRole('button', { name: 'Souscrire' }).first().click()

    const sessionId = new URL((await hosted).url()).searchParams.get('session') ?? ''

    expect(sessionId).not.toBe('')

    // **Le retour est public**, et il ne dit qu'une chose : la suite se passe
    // dans la boîte mail. Il n'affirme **pas** que le paiement a abouti — cet
    // écran ne lit rien (constat F7 de la revue).
    await page.waitForURL(/\/pricing\?checkout=success/)
    await expect(
      page.getByRole('status').filter({ hasText: 'le lien qui ouvre votre compte' }),
    ).toBeVisible()

    // **Aucune session ouverte depuis la page de retour** (critère 7) : le
    // visiteur est toujours anonyme, et `/billing` le renvoie à la connexion
    // comme n'importe quel anonyme.
    await page.goto('/billing')
    await expect(page).toHaveURL(signInRedirectedFrom('/billing'))

    // Le compte, lui, existe : il a été créé par le **webhook**. Le seul chemin
    // qui y mène est le lien envoyé à l'adresse du paiement — ici celle que la
    // page hébergée simulée a collectée.
    const link = await linkSentTo(`${sessionId}@guest.local`, { since: sentSince })

    expect(link).toContain('/reset-password?token=')
  })

  /**
   * s22 / ADR 045 — **l'offre reposée reprend le focus**, et il n'y a qu'un
   * endroit où cela s'observe : un vrai navigateur.
   *
   * La revue de s22 a mesuré ici un `document.activeElement` resté sur `BODY`
   * pendant que trois textes affirmaient le contraire — l'`autoFocus` de React
   * ne pose rien sur un bouton **désactivé** (il l'est jusqu'à l'hydratation) ni
   * sur un `<a>`. Le focus est donc posé par l'écran, après l'hydratation, et ce
   * parcours est la commande qui rougit s'il disparaît.
   *
   * Les deux branches, dans la même exécution : le lien du visiteur anonyme,
   * puis le bouton de la personne qui revient de la connexion — c'est celle-ci
   * que l'ADR sert.
   */
  test('rend le focus au bouton de l’offre reposée, avant et après la connexion', async ({
    page,
  }) => {
    test.skip(!mounted, 'module de facturation coupé')

    const chosen = billingOffers.find((offer) => offer.mode === 'subscription')?.id ?? ''
    // Un compte vérifié, **pas encore connecté** : la première moitié du cas
    // part bien d'un visiteur anonyme.
    const email = anEmail('s22-resume')

    await signUp(page, email)
    await page.goto(await linkSentTo(email))

    await page.goto(`${publicPath(PRICING_SCREEN_PATH)}?offer=${chosen}`)

    // La carte reposée se **nomme** : c'est elle qui porte le déclencheur
    // attendu, et non la carte mise en avant, qui est une autre offre.
    const resumed = page.locator('[aria-current="true"]')

    // **Anonyme** : le déclencheur est le même bouton que pour un compte depuis
    // s24 — il vise la route publique —, et il reçoit le focus une fois allumé.
    await expect(resumed.getByRole('button', { name: 'Souscrire' })).toBeFocused()
    await expect(resumed.getByRole('button', { name: 'Souscrire' })).toBeEnabled()
    // **Et rien n'a été acheté** : l'URL est celle de la page de tarifs, pas
    // celle d'une session de paiement. C'est tout l'ADR 045 — le paramètre
    // repose le choix, le geste reste celui de la personne.
    await expect(page).toHaveURL(urlOf(PRICING_SCREEN_PATH, `?offer=${chosen}`))

    await page.goto('/sign-in')
    await signIn(page, email)
    await page.goto(`${publicPath(PRICING_SCREEN_PATH)}?offer=${chosen}`)

    // **Connecté** : même mise en évidence, même focus, et toujours aucun achat.
    await expect(page).toHaveURL(urlOf(PRICING_SCREEN_PATH, `?offer=${chosen}`))
    await expect(resumed.getByRole('button', { name: 'Souscrire' })).toBeFocused()
    await expect(resumed.getByRole('button', { name: 'Souscrire' })).toBeEnabled()
  })

  test('la page de tarifs n’existe pas quand le module est coupé', async ({ page }) => {
    test.skip(mounted, 'module de facturation activé')

    const response = await page.goto(PRICING_SCREEN_PATH)

    expect(response?.status()).toBe(404)
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

/**
 * s22 — la page de tarifs **sous 400 px**, comme tout écran livré depuis s08.
 *
 * Trois cartes côte à côte est exactement la mise en page qui déborde quand une
 * boîte flexible garde son `min-width: auto`, et un prix est un contenu qui ne
 * se coupe pas.
 */
test.describe('les tarifs sous 400 px', () => {
  test.use({ viewport: { width: 380, height: 800 } })

  test('ne débordent pas horizontalement', async ({ page }) => {
    test.skip(!billing.available, 'module de facturation coupé')

    await page.goto(PRICING_SCREEN_PATH)
    await expect(page.getByRole('heading', { name: 'Nos offres', level: 1 })).toBeVisible()

    const overflow = await page.evaluate<number>(
      'document.documentElement.scrollWidth - document.documentElement.clientWidth',
    )

    expect(overflow, 'la page de tarifs déborde à 380 px').toBeLessThanOrEqual(0)
  })
})
