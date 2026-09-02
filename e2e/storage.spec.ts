import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { flatMessagesFor } from '../apps/web/lib/messages'
import { organizations } from '../apps/web/lib/organizations'
import { storage } from '../apps/web/lib/storage'
import { defaultLocale } from '../config/i18n'
import { aSignedInAccount } from './support/account'
import { publicPath } from './support/locale'

/**
 * L'avatar, dans un vrai navigateur.
 *
 * Ce que ce fichier prouve et qu'aucun test de nœud ne peut prouver :
 *
 * 1. **le téléversement direct** — le `PUT` part du navigateur vers l'URL
 *    présignée, et il n'est pas refusé par la politique de sécurité du contenu.
 *    C'est la moitié que `connect-src 'self'` gouverne, et un test de nœud ne
 *    voit aucune politique ;
 * 2. **l'image réellement chargée** — un `<img>` dont le navigateur a demandé la
 *    source, sous `img-src 'self'`. Si l'avatar était servi par le domaine d'un
 *    seau, cette requête serait bloquée et l'`Avatar` retomberait sur les
 *    initiales sans que rien d'autre ne le dise ;
 * 3. **le repli sur les initiales**, avant tout téléversement et après retrait.
 *
 * **Il doit passer dans les deux états de configuration.** Ses attentes sont
 * donc dérivées de `storage.available`, jamais recopiées — la discipline de
 * `e2e/organizations.spec.ts` et de `e2e/marketing.spec.ts`.
 */

const catalogue = flatMessagesFor(defaultLocale)
const mounted = storage.available

/** Le texte attendu à l'écran, lu dans le catalogue de la langue servie. */
const text = (key: string): string => {
  const value = catalogue[key]

  if (value === undefined) {
    throw new Error(`Le catalogue « ${defaultLocale} » ne livre pas « ${key} ».`)
  }

  return value
}

/** Une image PNG réelle de 1 × 1 : le navigateur doit pouvoir la décoder. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

/** Un document HTML **déguisé** en PNG : le piège que la story nomme. */
const HOSTILE = Buffer.from('<html><script>document.title="pris"</script></html>', 'utf8')

const avatarImage = (page: Page) => page.getByRole('img', { name: /Photo de profil/ })

const chooseButton = (page: Page) =>
  page.getByRole('button', { name: text('storage.avatar.choose') })

/** Le champ de fichier est masqué : c'est le bouton qui l'ouvre, pas lui. */
const fileInput = (page: Page) => page.locator('input[type="file"]')

/**
 * Crée une organisation, qui devient **courante** (s15).
 *
 * Les libellés viennent du catalogue du module `organizations` : ce parcours ne
 * s'exécute que lorsqu'il est monté, et le `test.skip` qui le garde est ce qui
 * rend cette lecture sûre dans les deux configurations.
 */
const createAnOrganization = async (page: Page, name: string): Promise<void> => {
  await page.goto(publicPath('/organizations'))

  const form = page.getByRole('form', { name: text('organizations.create.title') })

  await form.getByLabel(text('organizations.create.nameLabel')).fill(name)
  await form
    .getByLabel(text('organizations.create.slugLabel'))
    .fill(`e2e-${randomUUID().slice(0, 8)}`)
  await form.getByRole('button', { name: text('organizations.create.submit') }).click()

  await expect(page.getByRole('button', { name })).toBeVisible()
}

const goToAccount = async (page: Page): Promise<void> => {
  await page.goto(publicPath('/account'))
  await expect(page.getByRole('heading', { name: text('storage.avatar.title') })).toBeVisible()
}

test.describe('la photo de profil', () => {
  test.skip(!mounted, 'Le module « storage » est coupé dans cette configuration.')

  test('téléverse, affiche, remplace et retire', async ({ page }) => {
    await aSignedInAccount(page, 'e2e-avatar')
    await goToAccount(page)

    // **L'ordre compte.** Le bouton n'est actionnable qu'une fois React aux
    // commandes (règle de s08) : l'attendre d'abord est ce qui distingue « il
    // n'y a pas d'avatar » de « la page n'a pas fini de se rendre ». Un
    // `toHaveCount(0)` posé avant l'hydratation passerait de toute façon, et ne
    // prouverait rien — c'est le piège relevé plusieurs fois dans ce dépôt.
    await expect(chooseButton(page)).toBeEnabled()

    // Avant tout téléversement : le repli, et **aucun bouton « Retirer »** —
    // il n'est pas masqué, il n'est pas rendu.
    await expect(avatarImage(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: text('storage.avatar.remove') })).toHaveCount(0)

    // **Le téléversement complet** : présigner, `PUT` direct depuis le
    // navigateur, confirmer. Le champ masqué reçoit le fichier, comme un
    // sélecteur de fichier le ferait.
    const uploaded = page.waitForResponse(
      (response) =>
        response.url().includes('/api/modules/storage/avatar/confirm') && response.status() === 200,
    )

    await fileInput(page).setInputFiles({ name: 'moi.png', mimeType: 'image/png', buffer: PNG })
    await uploaded

    const image = avatarImage(page)

    await expect(image).toBeVisible()

    const first = await image.getAttribute('src')

    // **L'image est réellement chargée par le navigateur**, sous `img-src
    // 'self'`. Une image bloquée par la politique aurait `naturalWidth === 0`,
    // et `Avatar` retomberait silencieusement sur les initiales.
    await expect
      .poll(async () => await image.evaluate((node: HTMLImageElement) => node.naturalWidth))
      .toBeGreaterThan(0)
    expect(first).toContain('/api/modules/storage/file?id=')

    // **Le remplacement** : une nouvelle clé, donc une nouvelle URL.
    const replaced = page.waitForResponse(
      (response) =>
        response.url().includes('/api/modules/storage/avatar/confirm') && response.status() === 200,
    )

    await fileInput(page).setInputFiles({ name: 'moi.png', mimeType: 'image/png', buffer: PNG })
    await replaced
    await expect
      .poll(async () => await avatarImage(page).getAttribute('src'))
      .not.toBe(first)

    // **Le retrait** : l'image disparaît, et les initiales reviennent.
    await page.getByRole('button', { name: text('storage.avatar.remove') }).click()
    await expect(avatarImage(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: text('storage.avatar.remove') })).toHaveCount(0)
  })

  test('reste la photo du compte quand une organisation est courante', async ({ page }) => {
    test.skip(
      !organizations.available,
      'Le module « organizations » est coupé : aucune organisation ne peut être courante.',
    )

    await aSignedInAccount(page, 'e2e-avatar-org')

    // **Créer une organisation la rend courante** (s15). C'est l'état dans
    // lequel le constat F1 de la revue a été mesuré : le téléversement partait
    // dans le périmètre de l'organisation, l'écran lisait celui du compte, et
    // l'avatar ne changeait jamais.
    await createAnOrganization(page, 'Atelier de la photo')

    await goToAccount(page)
    await expect(chooseButton(page)).toBeEnabled()

    const uploaded = page.waitForResponse(
      (response) =>
        response.url().includes('/api/modules/storage/avatar/confirm') && response.status() === 200,
    )

    await fileInput(page).setInputFiles({ name: 'moi.png', mimeType: 'image/png', buffer: PNG })
    await uploaded

    const source = await avatarImage(page).getAttribute('src')

    expect(source).not.toBeNull()

    // **Basculer d'organisation ne change pas ma photo.** Une seconde
    // organisation devient courante ; l'avatar est celui de la **personne**,
    // donc il est toujours là, et c'est le même fichier. Rattaché au périmètre
    // de l'organisation, il disparaîtrait ici sans qu'aucune erreur ne le dise.
    await createAnOrganization(page, 'Atelier du son')
    await goToAccount(page)

    await expect(avatarImage(page)).toBeVisible()
    expect(await avatarImage(page).getAttribute('src')).toBe(source)

    // Et « Retirer » retire **cette** photo-là, pas celle d'un autre périmètre.
    await page.getByRole('button', { name: text('storage.avatar.remove') }).click()
    await expect(avatarImage(page)).toHaveCount(0)
  })

  test('un envoi rejoué ne dit pas le contraire de ce qui s’est passé', async ({ page }) => {
    await aSignedInAccount(page, 'e2e-avatar-rejeu')
    await goToAccount(page)
    await expect(chooseButton(page)).toBeEnabled()

    // La clé d'attente du premier envoi, lue **dans la réponse du serveur**.
    // L'écran ne permet pas de rejouer une confirmation — le bouton est
    // désactivé pendant l'envoi —, donc le rejeu est fabriqué ici : c'est la
    // situation d'un envoi soumis deux fois, pas une réponse inventée.
    const presigned = page.waitForResponse(
      (response) =>
        response.url().includes('/api/modules/storage/avatar/presign') && response.status() === 200,
    )
    const uploaded = page.waitForResponse(
      (response) =>
        response.url().includes('/api/modules/storage/avatar/confirm') && response.status() === 200,
    )

    await fileInput(page).setInputFiles({ name: 'moi.png', mimeType: 'image/png', buffer: PNG })

    const firstKey = ((await (await presigned).json()) as { key: string }).key

    await uploaded
    await expect(avatarImage(page)).toBeVisible()

    const source = await avatarImage(page).getAttribute('src')

    // **Le rejeu.** Le second envoi confirme la clé du premier, que la
    // promotion a déjà consommée. Le serveur refuse — 404, ADR 033 — mais
    // l'avatar de la personne a bel et bien changé : « Cet envoi n'est plus
    // valide » serait faux, et c'était le message affiché.
    await page.route('**/api/modules/storage/avatar/confirm', async (route) => {
      await route.continue({ postData: JSON.stringify({ key: firstKey }) })
    })

    const replayed = page.waitForResponse(
      (response) =>
        response.url().includes('/api/modules/storage/avatar/confirm') && response.status() === 404,
    )

    await fileInput(page).setInputFiles({ name: 'moi.png', mimeType: 'image/png', buffer: PNG })
    await replayed

    // Le bouton redevient actionnable **après** que l'écran a décidé quoi
    // afficher : l'attendre est ce qui distingue « aucune alerte » de « la
    // réponse n'est pas encore rendue ». Le piège est celui du cas précédent,
    // retourné.
    await expect(chooseButton(page)).toBeEnabled()
    await expect(
      page.getByRole('alert').filter({ hasText: text('storage.avatar.error.invalid_key') }),
    ).toHaveCount(0)

    // Et la photo est toujours là, inchangée : c'est bien celle du premier
    // envoi que la ligne porte.
    await expect(avatarImage(page)).toBeVisible()
    expect(await avatarImage(page).getAttribute('src')).toBe(source)
  })

  test('refuse un fichier qui n’est pas l’image qu’il prétend être', async ({ page }) => {
    await aSignedInAccount(page, 'e2e-avatar-hostile')
    await goToAccount(page)
    await expect(chooseButton(page)).toBeEnabled()

    const refused = page.waitForResponse(
      (response) =>
        response.url().includes('/api/modules/storage/avatar/confirm') && response.status() === 422,
    )

    // Le client annonce `image/png` ; les octets sont du HTML. Le serveur relit
    // l'objet stocké et refuse — c'est le seul contrôle qui compte.
    await fileInput(page).setInputFiles({
      name: 'piege.png',
      mimeType: 'image/png',
      buffer: HOSTILE,
    })
    await refused

    // Le refus est **annoncé** : `role="alert"`, avec le motif traduit. Le
    // filtre par texte est nécessaire — Next pose son propre `role="alert"`
    // vide (l'annonceur de route), et un sélecteur non filtré en trouve deux.
    await expect(
      page.getByRole('alert').filter({ hasText: text('storage.avatar.error.content_mismatch') }),
    ).toBeVisible()
    await expect(avatarImage(page)).toHaveCount(0)
  })

  test('ne sert le fichier d’un compte à personne d’autre', async ({ page, browser }) => {
    await aSignedInAccount(page, 'e2e-avatar-owner')
    await goToAccount(page)
    await expect(chooseButton(page)).toBeEnabled()

    const uploaded = page.waitForResponse(
      (response) =>
        response.url().includes('/api/modules/storage/avatar/confirm') && response.status() === 200,
    )

    await fileInput(page).setInputFiles({ name: 'moi.png', mimeType: 'image/png', buffer: PNG })
    await uploaded

    const source = await avatarImage(page).getAttribute('src')

    expect(source).not.toBeNull()

    // Un **autre navigateur**, donc une autre session : le fichier existe, il
    // ne lui est pas servi. 404, jamais 403 — et jamais l'image.
    const other = await browser.newContext({ locale: 'fr-FR' })

    try {
      const stranger = await other.newPage()

      await aSignedInAccount(stranger, 'e2e-avatar-stranger')

      const response = await stranger.request.get(source ?? '')

      expect(response.status()).toBe(404)
    } finally {
      await other.close()
    }
  })
})

test.describe('le module coupé', () => {
  test.skip(mounted, 'Le module « storage » est activé dans cette configuration.')

  test('n’affiche aucune carte de photo de profil, et aucune route ne répond', async ({ page }) => {
    await aSignedInAccount(page, 'e2e-avatar-off')
    await page.goto(publicPath('/account'))

    // L'écran est bien rendu — c'est la carte qui n'y est pas. Le catalogue du
    // module n'est **pas** consulté ici : ses clés n'existent pas dans cette
    // configuration, et les citer ferait échouer ce parcours pour une raison
    // qui n'est pas celle qu'il porte.
    await expect(
      page.getByRole('button', { name: text('app.account.profile.submit') }),
    ).toBeVisible()
    await expect(page.locator('input[type="file"]')).toHaveCount(0)

    const presign = await page.request.post('/api/modules/storage/avatar/presign', {
      data: { contentType: 'image/png', size: 10 },
      failOnStatusCode: false,
    })

    // 404 et non 401 : la route n'est pas protégée, elle **n'est pas montée**.
    expect(presign.status()).toBe(404)
  })
})
