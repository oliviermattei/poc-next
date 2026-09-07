import { MODULE_ROUTE_PREFIX, navigationSurfaceOf } from '@repo/core'
import { adminRoutePath, SUPERADMIN_ROLE } from '@repo/module-admin'
import { expect, test, type Page } from '@playwright/test'

import { marketingSubscriptions } from '../apps/web/lib/marketing'
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

/**
 * **Les inscriptions publiques et leur export, sur le vrai chemin HTTP** (s37c).
 *
 * **Ce qu'il porte en propre**, et ce qui est déjà tenu ailleurs — la nuance
 * compte, un cas de navigateur coûte cher :
 *
 * - le **404 d'un compte connecté qui n'administre pas**, sur l'écran comme sur
 *   la route de téléchargement. La *décision* est déjà mesurée, sur le
 *   répartiteur, par `tests/admin.test.ts` (« répond 404 au téléchargement d'un
 *   compte qui n'administre pas ») ; ce qui est propre à ce cas, c'est le
 *   **statut réellement servi** au bout du vrai chemin HTTP, avec un cookie de
 *   session réel. Le balayage de `e2e/modules.spec.ts` couvre bien ce `GET`,
 *   mais **pour l'appel anonyme** : l'appelant qui a une session et pas le rôle
 *   est une autre décision ;
 * - l'entrée de navigation **dérivée du registre** *et cliquable* : rien
 *   d'autre ne la clique — les cas de `tests/rendered-text.test.ts` rendent
 *   l'écran, ils n'y naviguent pas ;
 * - le filtre par source dérivé des lignes **réellement présentes en base**,
 *   là où `tests/admin.test.ts` les fait venir d'un port doublé ;
 * - **le fichier tel qu'un navigateur le reçoit** : ses en-têtes de remise et
 *   son contenu assaini. `tests/admin.test.ts` mesure la réponse du
 *   répartiteur ; ici, ce sont les octets servis.
 *
 * **Il ne s'exécute que là où les inscriptions existent.** Sa préparation écrit
 * dans `public_subscription`, une table du module du site public : coupé, la
 * table n'a jamais migré et la préparation échouerait sur une configuration
 * parfaitement valide — c'est la branche `socle` de la matrice de CI. La
 * condition est **dérivée** de la même donnée que l'écran lit (`lib/marketing.ts`),
 * jamais d'un identifiant recopié ; c'est la forme de `e2e/storage.spec.ts` et
 * de `e2e/marketing.spec.ts`.
 *
 * **Ce que la coupure garantit, et par quoi.** Plus de **route** : c'est mesuré,
 * par le balayage du registre de `e2e/modules.spec.ts` et par `pnpm test:socle`.
 * Plus d'**entrée** : c'est *structurel*, pas mesuré — `backOfficeNavigation`
 * n'agrège que les modules du registre, qui n'agrège que les modules activés,
 * si bien qu'un module coupé ne peut pas déclarer d'entrée. Aucune exécution ne
 * rend la navigation du back-office avec le site public coupé, et le balayage
 * d'entrées de `pnpm test:minimal-profile` porte sur la surface principale, où
 * une entrée `surface: 'admin'` n'apparaît de toute façon jamais.
 */
const SUBSCRIPTIONS_SCREEN = '/admin/subscriptions'

/** Une adresse hostile : un tableur l'exécuterait à l'ouverture du fichier. */
const HOSTILE_EMAIL = '=HYPERLINK("http://pirate.test")@example.test'

const givenSubscriptions = async (): Promise<void> => {
  await onDatabase(async (connection) => {
    const { sql } = await import('drizzle-orm')

    await connection.db.execute(
      sql`delete from public_subscription where id like ${'s37c-e2e-%'}`,
    )

    for (const [id, email, source] of [
      ['s37c-e2e-1', 'ada.s37c@example.test', 'newsletter'],
      ['s37c-e2e-2', HOSTILE_EMAIL, 'newsletter'],
      ['s37c-e2e-3', 'grace.s37c@example.test', 's37c-autre-source'],
    ] as const) {
      await connection.db.execute(
        sql`insert into public_subscription (id, email, source, locale)
            values (${id}, ${email}, ${source}, 'fr')
            on conflict (source, email) do nothing`,
      )
    }
  })
}

test('le back-office liste les inscriptions et en sert un CSV assaini', async ({
  page,
  browser,
}) => {
  test.skip(
    !marketingSubscriptions.available,
    'Le module du site public est coupé dans cette configuration : la table des ' +
      'inscriptions n’existe pas, il n’y a rien à lister ni à exporter.',
  )

  await givenSubscriptions()
  await aSignedInSuperadmin(page)

  // L'entrée est **dérivée du registre** : elle est déclarée par le module du
  // site public, et c'est par elle qu'on arrive sur l'écran.
  await page.goto(publicPath('/admin/users'))
  await page.getByRole('link', { name: 'Inscriptions', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Inscriptions', level: 1 })).toBeVisible()
  await expect(page.getByRole('table')).toContainText('ada.s37c@example.test')

  // **Le filtre est dérivé des sources réellement présentes** : celle qui vient
  // d'être écrite est offerte sans qu'aucun fichier ne la nomme.
  const otherSource = page.getByRole('link', { name: 's37c-autre-source', exact: true })

  await expect(otherSource).toBeVisible()
  await otherSource.click()

  await expect(page).toHaveURL(/[?&]source=s37c-autre-source/)
  await expect(page.getByRole('table')).toContainText('grace.s37c@example.test')
  await expect(page.getByRole('table')).not.toContainText('ada.s37c@example.test')

  // **Le fichier, tel que le navigateur le reçoit.** La requête part du
  // contexte de la page, donc avec le cookie du superadmin.
  const file = await page.request.get(adminRoutePath('exportSubscriptions'))

  expect(file.status()).toBe(200)
  expect(file.headers()['content-type']).toContain('text/csv')
  expect(file.headers()['content-disposition']).toBe(
    'attachment; filename="inscriptions.csv"',
  )
  expect(file.headers()['cache-control']).toBe('no-store')

  const body = await file.text()

  // **L'injection de formule, mesurée sur le fichier livré** : l'adresse
  // hostile y est, et aucune cellule ne s'ouvre sur `=`.
  expect(body).toContain('ada.s37c@example.test')
  expect(body).toContain('\'=HYPERLINK(')
  expect(body).not.toContain('"=HYPERLINK(')

  // **Un autre compte, dans un autre contexte** : il n'administre pas, et il ne
  // distingue ni l'écran ni le téléchargement d'une URL inventée.
  const other = await browser.newContext()
  const stranger = await other.newPage()

  await aSignedInAccount(stranger, 's37c-intrus')

  const refusedScreen = await stranger.goto(publicPath(SUBSCRIPTIONS_SCREEN))

  expect(refusedScreen?.status()).toBe(404)
  expect(refusedScreen?.status()).not.toBe(403)

  const refusedFile = await stranger.request.get(adminRoutePath('exportSubscriptions'))

  expect(refusedFile.status()).toBe(404)
  expect(await refusedFile.json()).toEqual({ error: 'not_found' })

  await other.close()
})

/**
 * **L'autre moitié de la garde de l'écran** — la configuration où le module du
 * site public est coupé (critère 7 de la story).
 *
 * Le cas ci-dessus saute alors, et un saut sans contrepartie serait exactement
 * le défaut que la revue a relevé : une garde qui ne mord que dans une
 * configuration. Ici, la seule qui la fasse mordre.
 *
 * **Ce qu'il ajoute, mesuré et pas supposé.** Le refus lui-même est déjà tenu
 * dans cette configuration par `tests/rendered-text.test.ts` (« back-office —
 * inscriptions »), dont l'attente est dérivée de l'état des deux modules :
 * neutraliser la moitié « site public » de la garde y rougit 1 cas sous
 * `pnpm test:socle`. Ce cas-ci n'est donc pas ce qui rend la garde opposable,
 * et il ne le prétend pas.
 *
 * Ce qu'il porte en propre, c'est ce qu'un appel direct à la fonction de page
 * ne peut pas voir — la distinction mesurée en s29 : **le statut réellement
 * servi**, et le fait que le refus soit décidé *avant* la session. La requête
 * est donc **anonyme**, et c'est le sujet : un refus déplacé après la
 * résolution de session redirigerait ce visiteur vers la connexion, ce qui lui
 * apprendrait que l'écran existe — et `pnpm test:minimal-profile` lirait cette
 * redirection comme un 200, puisqu'il les suit.
 *
 * Ce que ni l'un ni l'autre ne dit : `pnpm test:minimal-profile` ne balaie que
 * les entrées de navigation des **modules coupés**, et « Inscriptions » est
 * déclarée par le site public — activé dans ce profil-là. Cette adresse n'entre
 * donc dans aucun balayage d'entrée ; elle est vérifiée ici, nommément.
 */
test('l’écran des inscriptions disparaît avec le module qui les porte', async ({ page }) => {
  test.skip(
    marketingSubscriptions.available,
    'Le module du site public est activé dans cette configuration : c’est le cas ci-dessus.',
  )

  const refused = await page.goto(publicPath(SUBSCRIPTIONS_SCREEN))

  expect(refused?.status()).toBe(404)
  // 404, et pas une redirection vers la connexion : l'écran n'existe pas, il
  // n'est pas réservé.
  expect(refused?.status()).not.toBe(403)
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
