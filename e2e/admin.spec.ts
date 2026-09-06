import { adminRoutePath } from '@repo/module-admin'
import { expect, test, type Page } from '@playwright/test'

import { E2E_SUPERADMIN_EMAIL } from '../playwright.config'
import { PASSWORD, aSignedInAccount, linkSentTo, signIn, signUp } from './support/account'
import { publicPath } from './support/locale'

/**
 * **Le back-office, vu depuis un navigateur réel** (s37b2).
 *
 * Ce que ce fichier mesure, et que rien d'autre ne peut mesurer :
 *
 * 1. **le bandeau d'impersonation survit à une navigation complète** — il vit
 *    dans la coquille applicative, pas dans une page, et cela ne se démontre
 *    qu'en allant d'un écran à un autre. Le mesurer sur un seul rendu ne
 *    prouverait rien ;
 * 2. **un compte qui n'administre pas reçoit 404**, sur l'écran comme sur les
 *    routes du module — jamais 403, qui confirmerait que le back-office existe.
 *    Le balayage générique de `e2e/modules.spec.ts` ne couvre que les `GET` ;
 *    les deux gestes de cette story sont des `POST`.
 */

/**
 * **La plateforme repart sans superadmin**, et le compte désigné est recréé.
 *
 * La désignation par `SUPERADMIN_EMAIL` ne prend effet **que** tant qu'aucun
 * superadmin capable de se connecter n'existe (s37b1) : sans ce nettoyage, une
 * seconde exécution trouverait la ligne de la première et le parcours mesurerait
 * un état qu'il n'a pas produit. Effacer le compte emporte son rôle par cascade.
 *
 * La base de cette suite lui est dédiée, comme pour le compteur de débit que le
 * préambule vide (`e2e/support/warm-up.ts`).
 */
const resetPlatformRoles = async (): Promise<void> => {
  const { createDatabaseClient } = await import('@repo/db')
  const { getEnv } = await import('@repo/config')
  const { loadRootEnv } = await import('@repo/config/server')

  loadRootEnv()

  const connection = createDatabaseClient({
    connectionString: getEnv().DATABASE_URL,
    maxConnections: 1,
  })

  try {
    const { sql } = await import('drizzle-orm')

    // Deux ordres, et pas un bloc `do $$` : un bloc anonyme n'accepte aucun
    // paramètre lié, et l'adresse en est un — l'interpoler serait la seule
    // façon de tenir dans un bloc, ce que ce dépôt ne fait nulle part.
    await connection.db.execute(sql`delete from admin_platform_role`)
    await connection.db.execute(
      sql`delete from auth_user where email = ${E2E_SUPERADMIN_EMAIL}`,
    )
  } finally {
    await connection.close()
  }
}

/** Le compte désigné, inscrit, vérifié et connecté. */
const aSignedInSuperadmin = async (page: Page): Promise<void> => {
  await signUp(page, E2E_SUPERADMIN_EMAIL)
  await page.goto(await linkSentTo(E2E_SUPERADMIN_EMAIL))
  await signIn(page, E2E_SUPERADMIN_EMAIL, PASSWORD)
}

/**
 * **En série, et une remise à zéro par cas.**
 *
 * Les deux parcours inscrivent la **même** adresse — celle que la configuration
 * désigne — et deux inscriptions concurrentes sur la même adresse se
 * refuseraient l'une l'autre. La sérialisation est donc une contrainte du sujet,
 * pas une commodité.
 */
test.describe.configure({ mode: 'serial' })

test.beforeEach(async () => {
  await resetPlatformRoles()
})

test('le back-office sert la liste des comptes au compte désigné, et 404 aux autres', async ({
  page,
  browser,
}) => {
  await aSignedInSuperadmin(page)

  // La première requête servie déclenche la désignation : c'est elle qui nomme
  // le premier superadmin, sur une plateforme qui n'en avait aucun.
  await page.goto(publicPath('/admin/users'))

  await expect(page.getByRole('heading', { name: 'Comptes', level: 1 })).toBeVisible()
  // La table est là, avec le compte désigné dedans — et son droit de plateforme.
  await expect(
    page.getByRole('link', { name: E2E_SUPERADMIN_EMAIL, exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('table')).toContainText('Superadministrateur')

  // La recherche est une **adresse** : elle se copie et fonctionne sans script.
  await page.getByLabel('Rechercher').fill('aucun-compte-ne-porte-ceci')
  await page.getByRole('button', { name: 'Rechercher' }).click()
  await expect(page.getByText('Aucun compte ne correspond', { exact: true })).toBeVisible()

  // **Un autre compte, dans un autre contexte** : il n'administre pas, et il ne
  // distingue pas le back-office d'une URL inventée.
  const other = await browser.newContext()
  const stranger = await other.newPage()

  await aSignedInAccount(stranger, 's37b2-intrus')

  const refused = await stranger.goto(publicPath('/admin/users'))

  expect(refused?.status()).toBe(404)
  // 404, et pas 403 : le second confirmerait que l'écran existe.
  expect(refused?.status()).not.toBe(403)

  // Les routes du module répondent le même refus, et ce sont des `POST` — que
  // le balayage générique de `e2e/modules.spec.ts` ne couvre pas.
  for (const path of ['revokeAccountSession', 'sendPasswordReset'] as const) {
    const response = await stranger.request.post(adminRoutePath(path), {
      data: { userId: 'peu-importe', sessionId: 'peu-importe' },
    })

    expect(response.status(), path).toBe(404)
    expect(await response.json()).toEqual({ error: 'not_found' })
  }

  await other.close()
})

test('le bandeau d’impersonation survit à une navigation complète', async ({ page, browser }) => {
  await aSignedInSuperadmin(page)
  await page.goto(publicPath('/admin/users'))
  await expect(page.getByRole('heading', { name: 'Comptes', level: 1 })).toBeVisible()

  // La cible : un compte ordinaire, inscrit dans un autre contexte pour que sa
  // session ne remplace pas celle du superadmin dans ce navigateur-ci.
  const targetContext = await browser.newContext()
  const targetPage = await targetContext.newPage()
  const targetEmail = await aSignedInAccount(targetPage, 's37b2-cible')

  await targetContext.close()

  // Le compte visé, retrouvé **par la liste** : le back-office ne connaît un
  // compte que par son identifiant, et c'est l'écran qui le porte.
  await page.getByLabel('Rechercher').fill(targetEmail)
  await page.getByRole('button', { name: 'Rechercher' }).click()

  const link = page.getByRole('link', { name: targetEmail, exact: true })

  await expect(link).toBeVisible()

  const detail = await link.getAttribute('href')
  const targetId = (detail ?? '').split('/').at(-1) ?? ''

  expect(targetId).not.toBe('')

  // L'emprunt est ouvert par la route de `s37b1` — cette story rend le bandeau,
  // elle n'ajoute pas de déclencheur (le design ne l'a pas dessiné). La requête
  // part du **contexte du navigateur**, donc avec le cookie du superadmin, et la
  // réponse fait tourner sa session.
  const opened = await page.request.post(adminRoutePath('startImpersonation'), {
    data: { userId: targetId },
  })

  expect(opened.status()).toBe(200)

  // **Premier écran.** Le bandeau est là, et il porte sa sortie.
  await page.goto(publicPath('/account'))

  const banner = page.getByRole('alert').filter({ hasText: 'Session empruntée' })

  await expect(banner).toBeVisible()
  // **Il nomme le compte emprunté** (design de la story, revue F8) : « vous
  // agissez au nom d'un autre » sans dire duquel laisse l'emprunteur deviner sur
  // quel dossier il travaille — et le back-office sert précisément à en ouvrir
  // plusieurs de suite.
  await expect(banner).toContainText(targetEmail)
  await expect(banner.getByRole('button', { name: 'Rendre la main' })).toBeVisible()

  // **Second écran, navigation complète.** C'est ce que la coquille garantit et
  // qu'une page ne garantirait pas : le mesurer sur un seul rendu ne prouverait
  // rien.
  await page.goto(publicPath('/organizations'))
  await expect(page.getByRole('alert').filter({ hasText: 'Session empruntée' })).toBeVisible()

  // Et la sortie rend la main : le bandeau disparaît, sur la coquille comme sur
  // la page.
  await page.getByRole('button', { name: 'Rendre la main' }).click()
  await expect(page.getByText('Session empruntée')).toHaveCount(0)
})
