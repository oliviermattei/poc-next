import { expect, test, type Page, type Request } from '@playwright/test'

import { aSignedInAccount } from './support/account'
import { anonymousLanding, publicPath, urlOf } from './support/locale'

/**
 * Le consentement aux cookies, mesuré là où il compte : dans un navigateur, sur
 * ce qui **part réellement**.
 *
 * Ce fichier est le seul endroit du dépôt qui puisse répondre à la question de
 * la story — « le consentement conditionne le **chargement** du script, pas
 * seulement l'envoi des événements ». Un test de nœud voit un arbre React ; il
 * ne voit pas une requête sortante, et une bannière qui déclarerait ses balises
 * « inactives » lui paraîtrait conforme.
 *
 * Les deux scripts de démonstration sont déclarés par `CONSENT_SCRIPT_PROBE=1`,
 * posé dans `playwright.config.ts` — jamais dans le `.env` d'un poste. Chacun
 * **s'exécute** en poussant son identifiant dans `window.__consentProbe` : c'est
 * l'exécution, et non la présence dans le DOM, qui est assertée.
 */

const PROBE_PREFIX = '/api/consent-probe/'

/** Les requêtes de scripts non essentiels réellement émises par la page. */
const recordProbeRequests = (page: Page): string[] => {
  const seen: string[] = []

  page.on('request', (request: Request) => {
    const { pathname } = new URL(request.url())

    if (pathname.startsWith(PROBE_PREFIX)) {
      seen.push(pathname.slice(PROBE_PREFIX.length))
    }
  })

  return seen
}

/** Ce que les scripts non essentiels ont **exécuté** dans cette page. */
const executedProbes = async (page: Page): Promise<readonly string[]> =>
  await page.evaluate(() => (globalThis as { __consentProbe?: string[] }).__consentProbe ?? [])

/**
 * Attend qu'un script autorisé se soit **exécuté**.
 *
 * `expect.poll` et non une lecture directe, avec la raison à côté comme le
 * demande `playwright.config.ts` : les balises sont en **fin de document** et
 * portent `defer`, donc elles s'exécutent après l'analyse du HTML. Une
 * assertion posée juste après un contrôle de l'écran gagnait la course une fois
 * sur deux — mesuré. Le geste est rejouable, l'attente est bornée, et
 * `retries: 0` reste tenable.
 */
const expectProbesExecuted = async (page: Page, ids: readonly string[]): Promise<void> => {
  await expect
    .poll(async () => [...(await executedProbes(page))].sort())
    .toEqual([...ids].sort())
}

/**
 * Constate qu'**aucun** script non essentiel n'a été demandé ni exécuté.
 *
 * L'attente du chargement complet est ce qui donne son sens à l'absence : sans
 * elle, l'assertion serait vraie parce que la page n'a pas fini, pas parce que
 * rien n'est parti — c'est le `toHaveCount(0)` qui passe avant tout rendu, la
 * treizième prise de ce dépôt.
 */
const expectNothingLoaded = async (page: Page, requested: readonly string[]): Promise<void> => {
  await page.waitForLoadState('load')

  expect(requested).toEqual([])
  expect(await executedProbes(page)).toEqual([])
}

const banner = (page: Page) => page.getByRole('region', { name: 'Consentement aux cookies' })

/**
 * L'écran de préférences, et non la bannière.
 *
 * Les deux portent « Tout accepter » et « Tout refuser », et c'est voulu : le
 * refus est au même rang que l'acceptation aux deux endroits. Les parcours
 * désignent donc lequel des deux ils actionnent — un sélecteur ambigu ferait
 * échouer Playwright, ce qui est préférable à un clic au hasard.
 */
const preferences = (page: Page) => page.getByRole('main')

test('rien de non essentiel n’est chargé avant le choix, et refuser suffit', async ({ page }) => {
  const requested = recordProbeRequests(page)

  await page.goto(anonymousLanding())

  // La bannière est là, et **aucun** des deux scripts n'a été demandé : c'est
  // le défaut typique de ces bannières — la balise posée « au cas où », qui a
  // déjà fait partir l'adresse IP du visiteur chez un tiers.
  await expect(banner(page)).toBeVisible()
  await expectNothingLoaded(page, requested)

  // Refuser est **un clic**, au même rang qu'accepter : les deux boutons sont
  // dans la bannière, de même forme.
  await expect(banner(page).getByRole('button', { name: 'Tout accepter' })).toBeVisible()
  await banner(page).getByRole('button', { name: 'Tout refuser' }).click()

  await expect(banner(page)).toHaveCount(0)

  // Le choix survit au rechargement, et ne dépend d'aucun compte : c'est un
  // visiteur anonyme qui vient de refuser.
  await page.reload()

  await expect(banner(page)).toHaveCount(0)
  await expectNothingLoaded(page, requested)
})

test('accepter charge le script, et la personnalisation respecte chaque catégorie', async ({
  page,
}) => {
  const requested = recordProbeRequests(page)

  await page.goto(publicPath('/cookies'))

  // Les deux catégories sont proposées, et aucune n'est décidée.
  await expect(preferences(page).getByRole('checkbox', { name: /Mesure d’audience/ })).not.toBeChecked()
  await expect(preferences(page).getByRole('checkbox', { name: /Publicité/ })).not.toBeChecked()

  await preferences(page).getByRole('checkbox', { name: /Mesure d’audience/ }).check()
  await preferences(page).getByRole('button', { name: 'Enregistrer mes choix' }).click()

  await expect(page).toHaveURL(urlOf('/cookies'))
  // L'état enregistré est **visible** : c'est le seul retour de succès de
  // l'écran, et il distingue accepté, refusé et en attente.
  await expect(preferences(page).getByRole('checkbox', { name: /Mesure d’audience/ })).toBeChecked()
  await expect(preferences(page).getByRole('checkbox', { name: /Publicité/ })).not.toBeChecked()

  // Une catégorie accordée, une refusée : **un seul** script est demandé, et un
  // seul s'exécute. Un mécanisme tout-ou-rien passerait le reste du fichier.
  await expectProbesExecuted(page, ['demo-analytics'])
  expect(requested).toEqual(['demo-analytics'])

  // La bannière ne revient pas : les deux catégories sont décidées.
  await page.goto(anonymousLanding())
  await expect(banner(page)).toHaveCount(0)
})

test('le retrait depuis les paramètres de compte empêche le chargement suivant', async ({
  page,
}) => {
  // Le second point d'accès (finding F57) : celui qui ne dépend pas du module
  // `marketing`. C'est lui qui rend le retrait possible sur une installation
  // « site public coupé, analytique activée ».
  await aSignedInAccount(page, 'consent')

  await page.goto(publicPath('/cookies'))
  await preferences(page).getByRole('button', { name: 'Tout accepter' }).click()
  await expect(preferences(page).getByRole('checkbox', { name: /Publicité/ })).toBeChecked()

  const afterConsent = recordProbeRequests(page)
  await page.goto(publicPath('/account'))
  await expectProbesExecuted(page, ['demo-advertising', 'demo-analytics'])
  expect([...afterConsent].sort()).toEqual(['demo-advertising', 'demo-analytics'])

  // Le point d'accès des paramètres de compte, suivi comme un utilisateur le
  // suivrait — pas une URL écrite à la main.
  await preferences(page).getByRole('link', { name: 'Gérer mes cookies' }).click()
  await expect(page).toHaveURL(urlOf('/cookies'))

  await preferences(page).getByRole('button', { name: 'Tout refuser' }).click()
  await expect(preferences(page).getByRole('checkbox', { name: /Publicité/ })).not.toBeChecked()

  const afterWithdrawal = recordProbeRequests(page)
  await page.goto(publicPath('/account'))

  // Le retrait empêche l'injection **au chargement suivant** : c'est le
  // critère 4 de la story, et il ne se mesure qu'après une navigation.
  await expectNothingLoaded(page, afterWithdrawal)
})

test.describe('sans JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('la bannière fonctionne, et le choix est enregistré', async ({ page }) => {
    // Refuser des cookies ne peut pas dépendre du script qu'on refuse. Toute la
    // surface de ce module est un formulaire natif, et c'est le seul endroit du
    // dépôt qui puisse le prouver — s11 a livré un bouton mort faute de l'avoir
    // mesuré.
    const requested = recordProbeRequests(page)

    await page.goto(anonymousLanding())
    await expect(banner(page)).toBeVisible()

    await banner(page).getByRole('button', { name: 'Tout refuser' }).click()

    await expect(banner(page)).toHaveCount(0)
    // Pas d'`executedProbes` ici : sans JavaScript, il n'y a rien à évaluer
    // dans la page. Ce que ce cas mesure est le **réseau**, qui reste observable.
    await page.waitForLoadState('load')
    expect(requested).toEqual([])
  })

  test('la personnalisation par catégorie fonctionne aussi', async ({ page }) => {
    await page.goto(publicPath('/cookies'))

    await preferences(page).getByRole('checkbox', { name: /Publicité/ }).check()
    await preferences(page).getByRole('button', { name: 'Enregistrer mes choix' }).click()

    await expect(page).toHaveURL(urlOf('/cookies'))
    await expect(preferences(page).getByRole('checkbox', { name: /Publicité/ })).toBeChecked()
    await expect(preferences(page).getByRole('checkbox', { name: /Mesure d’audience/ })).not.toBeChecked()
  })
})

test('une soumission venue d’un autre site n’enregistre aucun choix', async ({ page }) => {
  // `SameSite=Lax` empêche le cookie d'être **lu** ailleurs, pas d'être
  // **écrit** par une requête venue d'ailleurs : un consentement forgé est pire
  // qu'un refus perdu.
  await page.goto(anonymousLanding())

  const response = await page.request.post('/api/modules/consent/decide', {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://evil.test',
      referer: 'https://evil.test/piege',
    },
    form: { decision: 'accept-all' },
    maxRedirects: 0,
  })

  expect(response.status()).toBe(403)

  await page.reload()
  await expect(banner(page)).toBeVisible()
})
