import { visibleNavigation } from '@repo/core'
import { DEFAULT_SIGNED_IN_PATH } from '@repo/module-auth'
import { expect, test } from '@playwright/test'

import { marketingSite } from '../apps/web/lib/marketing'
import { moduleRegistry } from '../apps/web/lib/module-registry'
import {
  aSignedInAccount,
  anEmail,
  closeOnboardingCourse,
  linkSentTo,
  PASSWORD,
  signIn,
  signUp,
} from './support/account'
import { publicPath, signInRedirectedFrom, sitePage, urlOf } from './support/locale'

/**
 * Le shell applicatif, dans un vrai navigateur.
 *
 * Ce que ce fichier prouve et qu'aucun test Vitest ne peut prouver : la classe
 * de thème réellement posée sur `<html>` et sa persistance d'une visite à
 * l'autre, l'absence de débordement horizontal à une largeur donnée, la
 * navigation qui devient un panneau, et la révocation d'une session vue depuis
 * **deux** navigateurs.
 */

const NARROW = { width: 380, height: 800 }

/** La largeur réellement défilable du document, comparée à celle du cadre. */
const horizontalOverflow = async (page: import('@playwright/test').Page): Promise<number> =>
  await page.evaluate<number>(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  )

test.describe('thème', () => {
  // Le système est en clair : le commutateur doit pouvoir le contredire.
  test.use({ colorScheme: 'light' })

  test('le choix contredit le système et survit à un rechargement', async ({ page }) => {
    await page.goto('/')

    const html = page.locator('html')

    await expect(html).not.toHaveClass(/dark/)

    await page.getByRole('button', { name: 'Thème' }).click()
    await page.getByRole('menuitem', { name: 'Sombre' }).click()

    await expect(html).toHaveClass(/dark/)

    // La persistance : c'est le critère de la story — « persiste entre deux
    // sessions ». Un rechargement complet, pas une navigation côté client.
    await page.reload()
    await expect(html).toHaveClass(/dark/)

    // Et le retour au système rend la main à la préférence, ici « clair ».
    await page.getByRole('button', { name: 'Thème' }).click()
    await page.getByRole('menuitem', { name: 'Système' }).click()
    await expect(html).not.toHaveClass(/dark/)
  })

  test('aucun clignotement : la page arrive déjà sombre après un choix', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Thème' }).click()
    await page.getByRole('menuitem', { name: 'Sombre' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    // La classe est posée par le script de `next-themes` **avant** le premier
    // rendu : au tout premier instant de la page suivante, elle est déjà là.
    // Sans ce script, la page s'affiche claire puis bascule — c'est le
    // clignotement que la story interdit.
    await page.goto('/account')

    const classAtFirstPaint = await page.evaluate<string>(
      'document.documentElement.className',
    )

    expect(classAtFirstPaint).toContain('dark')
  })
})

test.describe('sous 400 px', () => {
  test.use({ viewport: NARROW })

  test('aucun écran ne déborde horizontalement', async ({ page }) => {
    const email = await aSignedInAccount(page, 's08-narrow')

    // Les trois gabarits (s61) : le site et l'application connecté, puis
    // l'authentification en anonyme — un connecté sur `/sign-in` est renvoyé.
    for (const path of [sitePage(), DEFAULT_SIGNED_IN_PATH, '/account']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      expect(await horizontalOverflow(page), `${path} déborde à ${NARROW.width} px`).toBeLessThanOrEqual(0)
    }

    await page.context().clearCookies()

    for (const path of [sitePage(), '/sign-in']) {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      expect(await horizontalOverflow(page), `${path} déborde à ${NARROW.width} px`).toBeLessThanOrEqual(0)
    }

    // Une adresse email est le contenu le plus large de cet écran : c'est elle
    // qui pousse la page quand une boîte flexible garde son `min-width: auto`.
    expect(email.length).toBeGreaterThan(30)
  })

  test('la navigation devient un panneau, et il n’y en a qu’une', async ({ page }) => {
    await aSignedInAccount(page, 's08-panneau')
    await page.goto(DEFAULT_SIGNED_IN_PATH)

    const navigation = page.getByRole('navigation', { name: 'Modules' })

    // La colonne latérale n'est pas seulement invisible : elle n'est pas dans
    // l'arbre d'accessibilité, et le panneau n'est pas encore monté.
    await expect(navigation).toHaveCount(0)

    await page.getByRole('button', { name: 'Ouvrir la navigation' }).click()

    await expect(navigation).toHaveCount(1)
    await expect(navigation.getByRole('link', { name: 'Mon compte' })).toBeVisible()

    // Le bouton de fermeture porte un nom accessible **traduit** : c'est le
    // seul texte que la primitive `Sheet` affiche, et il était écrit en dur en
    // français dans `packages/ui` jusqu'à la revue de s09.
    await expect(page.getByRole('button', { name: 'Fermer la navigation' })).toBeVisible()
  })
})

test('le tableau de bord porte la navigation et le menu de compte', async ({ page }) => {
  const email = await aSignedInAccount(page, 's08-shell')

  await page.goto(DEFAULT_SIGNED_IN_PATH)

  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible()
  await expect(
    page.getByRole('navigation', { name: 'Modules' }).getByRole('link', { name: 'Mon compte' }),
  ).toBeVisible()

  // Le menu de compte nomme le compte : « menu de compte » seul ne dit pas
  // lequel, et c'est l'information qui compte quand on est connecté avec le
  // mauvais.
  await page.getByRole('button', { name: `Compte — ${email}` }).click()
  await expect(page.getByRole('menuitem', { name: 'Paramètres du compte' })).toBeVisible()
})

test('une session révoquée depuis un autre appareil est refusée par le serveur', async ({
  page,
  browser,
}) => {
  const email = anEmail('s08-sessions')

  await signUp(page, email)
  await page.goto(await linkSentTo(email))
  // Ce parcours mesure la révocation de session, pas l'intégration (s40) : le
  // parcours est refermé pour que la connexion atterrisse sur le tableau de
  // bord.
  await closeOnboardingCourse(email)
  await signIn(page, email)
  await expect(page).toHaveURL(urlOf(DEFAULT_SIGNED_IN_PATH))

  // Un second navigateur : deux sessions réelles, deux cookies distincts.
  const otherContext = await browser.newContext()
  const other = await otherContext.newPage()

  await other.goto('/sign-in')
  await signIn(other, email)
  await expect(other).toHaveURL(urlOf(DEFAULT_SIGNED_IN_PATH))

  await page.goto('/account')

  const sessions = page.getByRole('listitem').filter({ hasText: 'Révoquer' })

  await expect(sessions).toHaveCount(2)

  // Celle qui n'est pas la courante : on révoque l'autre appareil.
  const target = sessions.filter({ hasNotText: 'Session courante' })

  await expect(target).toHaveCount(1)
  await target.getByRole('button', { name: /Révoquer/ }).click()

  await expect(sessions).toHaveCount(1)

  // **Côté serveur** : l'autre navigateur garde son cookie, et il ne lui sert
  // plus à rien. C'est la différence entre révoquer et retirer d'une liste.
  await other.goto('/account')
  await expect(other).toHaveURL(signInRedirectedFrom('/account'))

  await otherContext.close()
})

test('changer son mot de passe depuis l’écran révoque l’autre session', async ({
  page,
  browser,
}) => {
  // Le critère de la story, par le chemin qu'emprunte un utilisateur : l'écran
  // n'a pas sa propre règle, il poste vers la route de s07 — et c'est elle qui
  // exige le mot de passe courant et impose la révocation des autres sessions.
  const email = anEmail('s08-motdepasse')

  await signUp(page, email)
  await page.goto(await linkSentTo(email))
  // Ce parcours mesure le changement de mot de passe, pas l'intégration (s40).
  await closeOnboardingCourse(email)
  await signIn(page, email)
  await expect(page).toHaveURL(urlOf(DEFAULT_SIGNED_IN_PATH))

  const otherContext = await browser.newContext()
  const other = await otherContext.newPage()

  await other.goto('/sign-in')
  await signIn(other, email)
  await expect(other).toHaveURL(urlOf(DEFAULT_SIGNED_IN_PATH))

  await page.goto('/account')

  // Un mot de passe courant faux est refusé, et rien ne change.
  await page.getByLabel('Mot de passe actuel').fill('ce-n-est-pas-le-bon')
  await page.getByLabel('Nouveau mot de passe').fill('un-tout-autre-mot-de-passe')
  await page.getByRole('button', { name: 'Changer le mot de passe' }).click()
  await expect(page.getByRole('alert')).toBeVisible()

  await page.getByLabel('Mot de passe actuel').fill(PASSWORD)
  await page.getByLabel('Nouveau mot de passe').fill('un-tout-autre-mot-de-passe')
  await page.getByRole('button', { name: 'Changer le mot de passe' }).click()
  await expect(page.getByRole('status')).toContainText('révoquées')

  // L'autre appareil est déconnecté, côté serveur.
  await other.goto('/account')
  await expect(other).toHaveURL(signInRedirectedFrom('/account'))

  await otherContext.close()
})

test('changer son nom met à jour le compte affiché', async ({ page }) => {
  await aSignedInAccount(page, 's08-profil')

  await page.goto('/account')
  await page.getByLabel('Nom affiché').fill('Olivier de Test')
  await page.getByRole('button', { name: 'Enregistrer le nom' }).click()

  await expect(page.getByRole('status')).toContainText('Nom enregistré')

  // Rechargé depuis le serveur, pas depuis l'état local du formulaire.
  await page.goto(DEFAULT_SIGNED_IN_PATH)
  await expect(page.getByText('Bonjour Olivier de Test')).toBeVisible()
})

/**
 * **Le repli natif des formulaires, JavaScript indisponible.**
 *
 * Un `<form>` sans `method` est un `GET` vers l'URL courante : c'est le défaut
 * du navigateur, et il s'applique chaque fois que le gestionnaire React n'est
 * pas encore attaché — hydratation en cours, script en échec, réseau lent. Le
 * mot de passe part alors dans la chaîne de requête, donc dans le journal
 * d'accès, dans l'historique et dans le `Referer` des requêtes suivantes
 * (`docs/security.md` §5). Mesuré en revue, sur les deux écrans.
 *
 * `retries: 0` **ici** : la même course a été rapportée « flaky » pendant toute
 * la story. Une reprise qui transforme une fuite de secret en badge jaune est
 * pire que pas de reprise du tout.
 */
test.describe('les formulaires sans JavaScript', () => {
  test.describe.configure({ retries: 0 })

  const SECRET = 'un-secret-qui-ne-doit-pas-atteindre-l-url'

  /**
   * Laisse au repli natif le temps de naviguer — s'il navigue.
   *
   * Sans JavaScript, la soumission implicite est immédiate : deux secondes sans
   * navigation signifient qu'il n'y en a pas eu.
   */
  const urlAfterNativeSubmit = async (
    page: import('@playwright/test').Page,
  ): Promise<string> => {
    await page.waitForEvent('framenavigated', { timeout: 2_000 }).catch(() => null)

    return page.url()
  }

  test('aucun secret n’atteint l’URL, ni sur le compte ni à la connexion', async ({
    page,
    browser,
  }) => {
    // Le compte est créé avec JavaScript — c'est le seul chemin d'inscription.
    // Seule la **soumission** est mesurée sans lui, avec le cookie de session.
    await aSignedInAccount(page, 's08-sans-js')

    const context = await browser.newContext({
      javaScriptEnabled: false,
      storageState: await page.context().storageState(),
    })
    const noScript = await context.newPage()

    await noScript.goto('/account')

    // Rien ne peut être soumis par un chemin que le composant ne contrôle pas :
    // l'envoi n'est actif qu'une fois React aux commandes. Sans cela, la
    // soumission qui devance l'hydratation est perdue en silence — et c'est
    // cette course, rapportée « flaky », qui a caché la fuite pendant la story.
    await expect(noScript.getByRole('button', { name: 'Changer le mot de passe' })).toBeDisabled()

    await noScript.getByLabel('Mot de passe actuel').fill(SECRET)
    await noScript.getByLabel('Nouveau mot de passe').fill(`${SECRET}-nouveau`)
    // La soumission implicite : la seule qui ne demande pas de JavaScript.
    await noScript.getByLabel('Nouveau mot de passe').press('Enter')

    expect(await urlAfterNativeSubmit(noScript), 'le mot de passe est parti dans l’URL').not.toContain(
      SECRET,
    )
    expect(new URL(noScript.url()).search).toBe('')

    // Le mécanisme derrière l'assertion ci-dessus : le repli n'est jamais un
    // `GET`. Si une soumission passe malgré tout, le secret est dans le corps.
    await expect(
      noScript.locator('form').filter({ has: noScript.getByLabel('Mot de passe actuel') }),
    ).toHaveAttribute('method', 'post')

    // Le même défaut préexiste sur l'écran de connexion de s07 : un seul
    // correctif, deux écrans. Sans session : un connecté est renvoyé de
    // `/sign-in` vers le tableau de bord (s61).
    await context.clearCookies()
    await noScript.goto('/sign-in')

    await expect(noScript.getByRole('button', { name: 'Se connecter', exact: true })).toBeDisabled()

    await noScript.getByLabel('Adresse email', { exact: true }).fill('victime@example.test')
    await noScript.getByLabel('Mot de passe', { exact: true }).fill(SECRET)
    await noScript.getByLabel('Mot de passe', { exact: true }).press('Enter')

    expect(await urlAfterNativeSubmit(noScript), 'le mot de passe est parti dans l’URL').not.toContain(
      SECRET,
    )
    expect(new URL(noScript.url()).search).toBe('')

    await expect(
      noScript.locator('form').filter({ has: noScript.getByLabel('Mot de passe', { exact: true }) }),
    ).toHaveAttribute('method', 'post')

    await context.close()
  })
})

/**
 * **Chaque zone a son gabarit** (s61, ADR 073).
 *
 * Ce que seul un navigateur voit : quelle barre entoure l'écran servi, ce que
 * son bouton annonce selon la session, et où mène une ouverture de session.
 * Les listes d'entrées sont **dérivées du registre** — surface `site` pour
 * l'en-tête, surface `app` pour la barre latérale —, jamais recopiées : c'est
 * ce qui fait passer le même parcours dans les deux configurations de la CI.
 */
test.describe('les gabarits de zone', () => {
  const siteEntries = visibleNavigation(moduleRegistry, null, 'site')

  test('le site porte son en-tête et son bouton, sans barre latérale', async ({ page }) => {
    await page.goto(sitePage())

    const header = page.getByRole('banner')

    // L'en-tête est rendu **quelles que soient les entrées visibles**
    // (critère 3) : le bouton de gabarit y est toujours.
    await expect(header.getByRole('link', { name: 'Se connecter' })).toHaveAttribute(
      'href',
      publicPath('/sign-in'),
    )

    const links = page.getByRole('navigation', { name: 'Site' }).getByRole('link')

    await expect(links).toHaveCount(siteEntries.length)

    for (const [index, entry] of siteEntries.entries()) {
      await expect(links.nth(index)).toHaveAttribute('href', publicPath(entry.href))
    }

    // **Aucune** barre latérale sur le site : ni sa navigation, ni sa colonne.
    await expect(page.getByRole('navigation', { name: 'Modules' })).toHaveCount(0)
    await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0)
  })

  test('un connecté voit le site, avec « Ouvrir l’application »', async ({ page }) => {
    await aSignedInAccount(page, 's61-site')
    await page.goto(sitePage())

    const header = page.getByRole('banner')

    await expect(header.getByRole('link', { name: 'Ouvrir l’application' })).toHaveAttribute(
      'href',
      publicPath(DEFAULT_SIGNED_IN_PATH),
    )
    await expect(header.getByRole('link', { name: 'Se connecter' })).toHaveCount(0)
    await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0)

    // `/` est le site, connecté ou non (critère 7) : jamais le tableau de bord.
    // Site public coupé, `/` n'a rien à montrer et renvoie le connecté vers
    // `/app` — les deux branches, selon la configuration jouée.
    await page.goto('/')

    if (marketingSite.sections.length > 0) {
      await expect(page).toHaveURL(urlOf('/'))
      await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toHaveCount(0)
    } else {
      await expect(page).toHaveURL(urlOf(DEFAULT_SIGNED_IN_PATH))
    }
  })

  test('l’authentification n’a ni barre latérale, ni en-tête du site, mais le consentement', async ({
    page,
  }) => {
    await page.goto('/sign-in')

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('[data-slot="sidebar"]')).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Site' })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Modules' })).toHaveCount(0)
    // Ni le bouton du site : un visiteur qui se connecte n'a rien d'autre à
    // faire ici que se connecter.
    await expect(page.getByRole('banner').getByRole('link', { name: 'Se connecter' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Thème' })).toBeVisible()
    // Le cadre commun des gabarits (`ZoneFrame`) : la bannière de consentement
    // est là, sur un écran qui n'a plus l'`AppShell` autour de lui.
    await expect(page.getByRole('region', { name: 'Consentement aux cookies' })).toBeVisible()
  })

  test('la barre latérale de l’application ne rend que la surface `app`', async ({ page }) => {
    await aSignedInAccount(page, 's61-barre')
    await page.goto(DEFAULT_SIGNED_IN_PATH)

    // Le critère 10, sur l'écran : aucun lien du site dans la barre latérale.
    // L'ensemble exact de la barre est comparé au registre dans
    // `e2e/modules.spec.ts` ; ici, l'absence des entrées du site.
    const rendered = await Promise.all(
      (await page.getByRole('navigation', { name: 'Modules' }).getByRole('link').all()).map(
        (link) => link.getAttribute('href'),
      ),
    )

    expect(rendered.length).toBeGreaterThan(0)

    for (const entry of siteEntries) {
      expect(rendered, entry.href).not.toContain(publicPath(entry.href))
    }

    // Et l'en-tête du site n'y est pas : l'application a sa propre barre.
    await expect(page.getByRole('navigation', { name: 'Site' })).toHaveCount(0)
  })
})

/**
 * **La destination d'une ouverture de session** (s61, critères 8 et 10).
 *
 * Le repli est la constante du module `auth` ; un `?next=` n'est honoré qu'à
 * travers `safeRedirectPath`. Les parcours par méthode de connexion vivent dans
 * leurs fichiers (`auth`, `oauth`, `passkeys`, `two-factor`), qui atterrissent
 * par `signedInLanding()` ; ce fichier tient les deux écrans qui ne sont pas
 * des méthodes.
 */
test.describe('l’atterrissage sur l’application', () => {
  test('un anonyme sur /app passe par la connexion et revient sur /app', async ({ page }) => {
    const email = anEmail('s61-retour')

    await signUp(page, email)
    await page.goto(await linkSentTo(email))
    await closeOnboardingCourse(email)
    await page.context().clearCookies()

    await page.goto(DEFAULT_SIGNED_IN_PATH)
    await expect(page).toHaveURL(signInRedirectedFrom(DEFAULT_SIGNED_IN_PATH))

    await signIn(page, email)
    await expect(page).toHaveURL(urlOf(DEFAULT_SIGNED_IN_PATH))
    await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible()
  })

  test('un connecté sur /sign-in ou /sign-up part vers son next filtré, sinon vers /app', async ({
    page,
  }) => {
    await aSignedInAccount(page, 's61-deja')

    await page.goto('/sign-in')
    await expect(page).toHaveURL(urlOf(DEFAULT_SIGNED_IN_PATH))

    await page.goto('/sign-up')
    await expect(page).toHaveURL(urlOf(DEFAULT_SIGNED_IN_PATH))

    // Un `next` de même origine est honoré, requête comprise.
    const invitation = '/invitations/accept?token=x'

    // Les deux écrans servent chacun leur propre redirection : chacun est
    // mesuré, un filtre contourné sur l'un seul resterait sinon vert (revue
    // s61, M1).
    for (const screen of ['/sign-in', '/sign-up']) {
      await page.goto(`${screen}?next=${encodeURIComponent(invitation)}`)
      await expect(page).toHaveURL(urlOf('/invitations/accept', '?token=x'))

      // Un `next` qui sort du site retombe sur la constante — y compris déguisé
      // par un caractère de contrôle que le navigateur retire avant de lire
      // `//evil.test` (revue s61, C1 : reproduit avec `i18n` coupé). CR et LF
      // faisaient en plus lever une 500 à l'écriture de l'en-tête `Location`.
      for (const outside of ['//evil.test', '/\t/evil.test', '/\n/evil.test', '/\r/evil.test']) {
        const response = await page.goto(`${screen}?next=${encodeURIComponent(outside)}`)

        expect(response?.status(), `${screen} ${JSON.stringify(outside)}`).toBeLessThan(500)
        await expect(page).toHaveURL(urlOf(DEFAULT_SIGNED_IN_PATH))
      }
    }
  })
})
