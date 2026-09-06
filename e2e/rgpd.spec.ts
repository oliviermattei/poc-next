import { expect, test } from '@playwright/test'

import { aSignedInAccount, linkSentTo, PASSWORD } from './support/account'
import { urlOf } from './support/locale'

/**
 * **Les deux droits RGPD, exercés depuis un vrai navigateur** (s34b, critère 7).
 *
 * C'est la garantie qui manquait le plus : `s34` a livré la suppression et `s35`
 * l'export, tous deux mesurés côté serveur — et **aucun des deux n'avait de
 * parcours**. Leurs preuves de revue n'étaient donc pas rejouables par la CI, et
 * rien ne disait qu'un écran les atteignait.
 *
 * Ce que ce fichier prouve et qu'aucun test Vitest ne peut prouver — la suite
 * tourne en environnement `node`, sans DOM (`vitest.config.ts`) :
 *
 * - la saisie de confirmation part réellement vers la route du module, et le
 *   refus affiché est **celui du serveur** : l'attente porte sur la réponse HTTP,
 *   donc un écran qui déciderait localement ferait expirer le parcours au lieu
 *   de le faire passer ;
 * - la session est révoquée **côté serveur** après la suppression, et une
 *   reconnexion est impossible ;
 * - le **jeton d'export** n'est ni dans la page, ni dans l'URL, alors qu'il vient
 *   d'être émis et qu'il est lisible dans l'email capturé.
 */

const DELETE_BUTTON = 'Supprimer définitivement mon compte'
const EXPORT_BUTTON = 'Demander l’export'

test('la suppression de compte : la saisie est jugée par le serveur, puis la session est révoquée', async ({
  page,
}) => {
  const email = await aSignedInAccount(page, 's34b-delete')

  await page.goto('/account')

  const confirmation = page.getByLabel(/Saisissez/)

  await confirmation.fill('pas-la-bonne-adresse@example.test')

  /**
   * **L'attente porte sur la réponse du serveur, et c'est le point du cas.**
   *
   * Un écran qui comparerait la saisie lui-même n'émettrait aucune requête : le
   * message affiché serait le même, et un parcours qui ne regarderait que le
   * texte passerait. Ici, la comparaison de `s34` (`confirmsAccount`, dans le
   * `domain`) est bien celle qui refuse — le 400 en est la trace.
   */
  const refused = page.waitForResponse(
    (response) => response.url().includes('/auth/delete-account') && response.status() === 400,
  )

  await page.getByRole('button', { name: DELETE_BUTTON }).click()
  await refused

  const refusal = page.getByRole('main').getByRole('alert')

  await expect(refusal).toContainText('ne correspond pas')

  // Le compte est toujours là : un refus ne supprime rien.
  await page.reload()
  // `exact` : le titre de la zone dangereuse — « Supprimer mon compte » —
  // contient celui de la page, et une correspondance partielle en désigne deux.
  await expect(page.getByRole('heading', { name: 'Mon compte', exact: true })).toBeVisible()

  // La saisie exacte, cette fois. L'atterrissage est l'écran de connexion : la
  // session ne survit pas à sa propre suppression.
  await page.getByLabel(/Saisissez/).fill(email)
  await page.getByRole('button', { name: DELETE_BUTTON }).click()
  await expect(page).toHaveURL(urlOf('/sign-in'))

  /**
   * **La reconnexion est impossible**, et l'attente est reprise jusqu'à ce que
   * la purge ait eu lieu : l'effacement quitte la requête quand le module
   * `jobs` est activé (s33), donc le compte peut survivre quelques
   * millisecondes à la réponse.
   */
  await expect(async () => {
    await page.goto('/sign-in')
    await page.getByLabel('Adresse email', { exact: true }).fill(email)
    await page.getByLabel('Mot de passe').fill(PASSWORD)
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click()

    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'Identifiants invalides',
      { timeout: 2_000 },
    )
  }).toPass({ timeout: 20_000 })
})

test('l’export de ses données : la demande est posée, son état s’affiche, et le jeton n’atteint jamais l’écran', async ({
  page,
}) => {
  const email = await aSignedInAccount(page, 's34b-export')
  const since = Date.now()

  await page.goto('/account')

  const request = page.getByRole('button', { name: EXPORT_BUTTON })

  await expect(request).toBeVisible()

  const accepted = page.waitForResponse(
    (response) => response.url().includes('/auth/data-export') && response.status() === 202,
  )

  await request.click()
  await accepted

  // **L'action disparaît au profit de l'état** : le serveur refuse une seconde
  // demande tant que la première est en cours (409, critère 7 de s35), donc
  // reproposer le bouton serait promettre un refus.
  await expect(page.getByRole('main')).toContainText('Demande enregistrée')
  await expect(request).toHaveCount(0)

  /**
   * **Le lien arrive par email, et par là seulement.** Il est lu ici pour
   * pouvoir chercher son jeton dans la page : sans le connaître, l'assertion
   * qui suit ne vérifierait rien.
   */
  const link = await linkSentTo(email, { since })
  const token = new URL(link).searchParams.get('token') ?? ''

  expect(token).not.toBe('')

  await page.goto('/account')

  // L'état vient du **serveur** : la demande est rendue avec sa date et
  // l'échéance de son lien.
  await expect(page.getByRole('main')).toContainText('Archive prête')

  /**
   * **Le jeton n'est nulle part** (critère de la story, tâche 8). Sa route est
   * **publique** et il donne accès à l'ensemble des données d'une personne :
   * l'écran doit montrer l'état d'une demande, jamais son lien. La signature —
   * la moitié qui prouve l'origine — est cherchée séparément, pour qu'un jeton
   * découpé ne passe pas au travers.
   */
  const html = await page.content()
  const signature = token.slice(token.lastIndexOf('.') + 1)

  expect(html).not.toContain(token)
  expect(html).not.toContain(signature)
  expect(page.url()).not.toContain(signature)
})
