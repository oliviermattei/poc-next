import { MODULE_ROUTE_PREFIX, navigationSurfaceOf } from '@repo/core'
import { adminRoutePath, SUPERADMIN_ROLE } from '@repo/module-admin'
import { expect, test, type Page } from '@playwright/test'

import { moduleRegistry } from '../apps/web/lib/module-registry'
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
const onDatabase = async (
  run: (
    connection: Awaited<ReturnType<typeof openConnection>>,
  ) => Promise<void>,
): Promise<void> => {
  const connection = await openConnection()

  try {
    await run(connection)
  } finally {
    await connection.close()
  }
}

const openConnection = async () => {
  const { createDatabaseClient } = await import('@repo/db')
  const { getEnv } = await import('@repo/config')
  const { loadRootEnv } = await import('@repo/config/server')

  loadRootEnv()

  return createDatabaseClient({ connectionString: getEnv().DATABASE_URL, maxConnections: 1 })
}

/**
 * **Retire les rôles de plateforme, et rien d'autre** (s56).
 *
 * Séparé de la remise à zéro ci-dessous parce que le critère 5 en dépend :
 * effacer aussi le compte fermerait la route pour **deux** raisons — plus de
 * rôle, et plus de session —, et la mesure ne dirait plus laquelle a joué.
 */
const revokePlatformRoles = async (): Promise<void> => {
  await onDatabase(async (connection) => {
    const { sql } = await import('drizzle-orm')

    await connection.db.execute(sql`delete from admin_platform_role`)
  })
}

const resetPlatformRoles = async (): Promise<void> => {
  await revokePlatformRoles()
  await onDatabase(async (connection) => {
    const { sql } = await import('drizzle-orm')

    // Un ordre paramétré, et pas un bloc `do $$` : un bloc anonyme n'accepte
    // aucun paramètre lié, et l'adresse en est un — l'interpoler serait la
    // seule façon de tenir dans un bloc, ce que ce dépôt ne fait nulle part.
    await connection.db.execute(
      sql`delete from auth_user where email = ${E2E_SUPERADMIN_EMAIL}`,
    )
  })
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

/**
 * **L'écran de revenus, sur le vrai chemin HTTP** (s38).
 *
 * Deux choses que rien d'autre ne mesure : le **404** d'un compte qui
 * n'administre pas — sur une page, pas sur une route de module —, et le fait
 * que l'écran dise **à l'écran** ce que valent ses deux chiffres, avec les
 * textes réellement livrés. Les cas de `tests/admin.test.ts` rendent des clés ;
 * ici, c'est la phrase que lit un être humain.
 */
test('le back-office sert les revenus au compte désigné, en disant ce qu’ils valent', async ({
  page,
  browser,
}) => {
  await aSignedInSuperadmin(page)

  // L'entrée est **dérivée du registre** : elle est déclarée par le module de
  // facturation, et c'est par elle qu'on arrive sur l'écran.
  await page.goto(publicPath('/admin/users'))
  await page.getByRole('link', { name: 'Revenus', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Revenus', level: 1 })).toBeVisible()

  // **Le statut des deux chiffres**, mot pour mot : l'un est dérivé d'une
  // déclaration locale, l'autre est ce qui a été prélevé.
  await expect(page.getByText('config/billing.ts')).toBeVisible()
  await expect(page.getByText(/réellement prélevés/)).toBeVisible()

  // **La période est une adresse** (critère 4) : elle se clique, elle change
  // l'URL, et elle survit à un rechargement. C'est ce que mesure un parcours et
  // qu'aucun rendu en mémoire ne dit — le lien est rendu par le module, mais
  // l'adresse qu'il porte vient de la page.
  await page.getByRole('link', { name: '30 derniers jours' }).click()

  await expect(page).toHaveURL(/[?&]period=30d/)
  await expect(page.getByRole('link', { name: '30 derniers jours' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  // Et le récurrent porte toujours ce que la période ne lui fait pas.
  await expect(page.getByText(/ne s’applique pas à ce chiffre/)).toBeVisible()

  // **Un autre compte, dans un autre contexte** : il n'administre pas, et il ne
  // distingue pas cet écran d'une URL inventée.
  const other = await browser.newContext()
  const stranger = await other.newPage()

  await aSignedInAccount(stranger, 's38-intrus')

  const refused = await stranger.goto(publicPath('/admin/revenue'))

  expect(refused?.status()).toBe(404)
  // 404, et pas 403 : le second confirmerait que l'écran existe.
  expect(refused?.status()).not.toBe(403)

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

/**
 * **Le niveau de protection `role`, exercé de bout en bout** (s56, critères 2 à
 * 5).
 *
 * Ce que ce parcours mesure, et qu'aucun test unitaire ne peut mesurer : la
 * chaîne entière — cookie réel → session résolue par le socle → rôles lus dans
 * la table du module `admin` → répartiteur → réponse HTTP —, plus le **rendu**
 * de l'entrée de navigation, que le registre ne prouve pas.
 *
 * Tout y est **dérivé du registre** : la route et l'entrée viennent des modules
 * activés, jamais d'un chemin recopié. Un produit qui ne déclarerait aucune
 * protection `role` n'a rien à exercer, et le parcours le dit plutôt que de
 * passer en silence.
 */
const roleRoute = moduleRegistry.routes.find(
  (route) => route.method === 'GET' && route.protection.level === 'role',
)
const roleEntry = moduleRegistry.navigation.find((entry) => entry.protection.level === 'role')

/**
 * **Le témoin d'anti-vacuité de l'absence mesurée plus bas** (revue de s56,
 * constat 3).
 *
 * `locator.all()` **n'attend pas** : une barre latérale qui n'aurait pas encore
 * rendu — ou pas du tout — renvoie `[]`, et « l'entrée réservée n'y est pas »
 * devient vrai pour la pire des raisons. Une entrée que **toute** session
 * authentifiée voit — dérivée du registre, jamais recopiée — prouve que la
 * barre est là avant qu'on y cherche une absence.
 */
const alwaysVisibleEntry = moduleRegistry.navigation.find(
  (entry) => navigationSurfaceOf(entry) === 'app' && entry.protection.level !== 'role',
)

test('une route réservée à un rôle sert son porteur, et 404 aux autres', async ({
  page,
  browser,
}) => {
  test.skip(
    roleRoute === undefined || roleEntry === undefined || alwaysVisibleEntry === undefined,
    'aucun module activé ne déclare de protection « role », ou aucune entrée de navigation ' +
      'visible de tous ne peut témoigner du rendu : il n’y a rien à exercer',
  )

  if (roleRoute === undefined || roleEntry === undefined || alwaysVisibleEntry === undefined) return

  /**
   * **Le seul rôle que le produit sache accorder.** La désignation par
   * `SUPERADMIN_EMAIL` et la promotion du back-office n'en écrivent pas d'autre
   * dans `admin_platform_role` ; une route qui en exigerait un autre serait
   * inatteignable, ce que cette story existe pour corriger. La comparaison est
   * ici plutôt que sous-entendue : elle rougit au lieu de sauter.
   */
  expect(roleRoute.protection.level === 'role' && roleRoute.protection.role).toBe(SUPERADMIN_ROLE)

  const path = `${MODULE_ROUTE_PREFIX}${roleRoute.path}`

  await aSignedInSuperadmin(page)

  // La désignation a lieu à la première requête d'administration : c'est elle
  // qui nomme le premier superadmin sur une plateforme qui n'en a aucun.
  await page.goto(publicPath('/admin/users'))
  await expect(page.getByRole('heading', { name: 'Comptes', level: 1 })).toBeVisible()

  // **Servie au porteur du rôle** — la session est la même, aucune reconnexion.
  const served = await page.request.get(path)

  expect(served.status()).toBe(200)

  // **Et l'entrée de navigation suit, mesurée sur le rendu** (critère 3) : le
  // registre la déclare pour tout le monde, seul le rendu distingue.
  await page.goto(publicPath('/account'))

  const linksFor = async (target: Page): Promise<readonly (string | null)[]> =>
    await Promise.all(
      (await target.getByRole('navigation', { name: 'Modules' }).getByRole('link').all()).map(
        (link) => link.getAttribute('href'),
      ),
    )

  expect(await linksFor(page)).toContain(publicPath(roleEntry.href))

  // **Un compte qui ne porte pas le rôle**, dans un autre contexte.
  const other = await browser.newContext()
  const stranger = await other.newPage()

  await aSignedInAccount(stranger, 's56-sans-role')

  const refused = await stranger.request.get(path)

  // 404, et jamais 403 : le second confirmerait que la route existe.
  expect(refused.status()).toBe(404)
  expect(refused.status()).not.toBe(403)
  expect(await refused.json()).toEqual({ error: 'not_found' })

  await stranger.goto(publicPath('/account'))

  const strangerLinks = await linksFor(stranger)

  // Le témoin d'abord : sans lui, une barre non rendue rendrait l'absence
  // suivante verte sans avoir rien mesuré.
  expect(strangerLinks).toContain(publicPath(alwaysVisibleEntry.href))
  expect(strangerLinks).not.toContain(publicPath(roleEntry.href))

  await other.close()

  // **Le rôle retiré ferme, sans nouvelle connexion** (critère 5) : la table
  // est vidée, la session du navigateur est inchangée, et la route qui servait
  // à l'instant répond 404. C'est ce qui interdit de porter les rôles dans le
  // jeton.
  await revokePlatformRoles()

  const closed = await page.request.get(path)

  expect(closed.status()).toBe(404)
  expect(await closed.json()).toEqual({ error: 'not_found' })
})
