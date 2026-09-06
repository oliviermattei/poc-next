import { robotsAllows, type IndexableUrl, type RobotsPolicy } from '@repo/core'
import { legalPath, marketingModule } from '@repo/module-marketing'
import { expect, test } from '@playwright/test'

import { localeRouting } from '../apps/web/lib/locale-routing'
import { marketingSite } from '../apps/web/lib/marketing'
import { flatMessagesFor } from '../apps/web/lib/messages'
import { publicUrls, servedPath } from '../apps/web/lib/public-urls'
import { defaultLocale } from '../config/i18n'
import { publicPath, urlOf } from './support/locale'

/**
 * Le site public, dans un vrai navigateur.
 *
 * Ce que ce fichier prouve et qu'aucun test Vitest ne peut prouver : le
 * `sitemap.xml` et le `robots.txt` réellement **servis** par Next — deux
 * conventions de fichier dont le nœud ne voit que la valeur de retour —, les
 * balises de titre, de description et Open Graph telles que le navigateur les
 * reçoit, le lien du pied de page réellement suivi, et l'ouverture d'une
 * question de FAQ.
 *
 * **Il doit passer dans les deux états de configuration.** Ses attentes sont
 * donc dérivées — de `marketingSite` pour les écrans, du **registre** pour ce
 * qui est publié —, jamais recopiées : même discipline que `e2e/modules.spec.ts`
 * avec le registre et `e2e/i18n.spec.ts` avec la forme des URL.
 *
 * **Et il doit passer sans être rouvert au module suivant.** La liste des URL
 * publiques a été écrite ici jusqu'à s31, qui en a ajouté une : l'intégration
 * continue est passée au rouge sur les deux branches de la matrice, dans un
 * fichier qu'aucune commande locale ne joue — ni `pnpm test`, ni
 * `pnpm test:minimal-profile`, ni `pnpm test:sans-env` ne le collectent. Une
 * liste écrite dans `e2e/` est un défaut qui attend la story suivante, et il
 * coûte un aller-retour de CI à chaque fois.
 */

const catalogue = flatMessagesFor(defaultLocale)
const publicSite = marketingSite.sections.length > 0

/**
 * **Le plan de site n'est plus celui du seul site public** (s53) : chaque
 * module activé y contribue ce qu'il publie, par la quinzième clé du contrat.
 * L'attente est donc **dérivée du registre**, et aucun module n'est nommé ici.
 *
 * Ce fichier a énuméré ses attentes module par module — la configuration
 * marketing, les articles du disque, l'arbre de la documentation — jusqu'à ce
 * que s31 en ajoute un treizième : l'intégration continue est passée au rouge
 * sur une liste écrite, sur les deux branches de la matrice, dans le seul
 * fichier qu'aucune commande locale ne joue. Le commentaire d'à côté refusait
 * déjà de figer l'**ordre** du graphe des modules ; il en figeait le contenu.
 *
 * **Ce que cette dérivation ne peut plus prouver, et où c'est prouvé.** Les
 * deux côtés de l'égalité viennent maintenant de `publicUrls()` : retirer la
 * contribution d'un module rend ce cas vert, puisque l'attente la perd aussi.
 * Ce lien-là — « ce que le module déclare correspond à ce qu'il sert » — est
 * mesuré contre les catalogues réellement lus sur le disque par
 * `tests/syndication.test.ts`, et la règle de fusion par
 * `packages/core/src/syndication.test.ts`. Ce qui ne se prouve **que** ici, et
 * qui est donc ce que ce fichier garde : le fichier est servi par Next, ses
 * `<loc>` portent la forme publique de la langue, il en porte **un par
 * contribution et rien d'autre**, et chaque adresse annoncée répond
 * réellement.
 */
const contributed = publicUrls()

/**
 * Les formes publiques d'une contribution — une par langue **servie**.
 *
 * `servedPath` et non `publicPath` : un chemin qui ne prend pas de préfixe de
 * langue (`/api…`) n'en reçoit pas ici non plus, exactement comme
 * `app/robots.ts` le construit.
 */
const servedFormsOf = (entry: IndexableUrl): readonly string[] =>
  entry.locales
    .filter((locale) => localeRouting.locales.includes(locale))
    .map((locale) => servedPath(entry.path, locale))

/** Toutes les adresses qu'un robot doit pouvoir suivre, dédoublonnées. */
const announcedPaths = [...new Set(contributed.flatMap(servedFormsOf))]

/** Le texte attendu à l'écran, lu dans le catalogue de la langue servie. */
const text = (key: string): string => {
  const value = catalogue[key]

  if (value === undefined) {
    throw new Error(`Le catalogue « ${defaultLocale} » ne livre pas « ${key} ».`)
  }

  return value
}

/**
 * Des chemins que **rien** ne doit ouvrir à un robot, quel que soit l'état du
 * module : ils ne sont pas publics, et le dernier porte un jeton de
 * réinitialisation. L'inventaire exhaustif des écrans est le sujet de
 * `tests/marketing.test.ts`, qui les balaie sur le disque ; ici, trois témoins
 * sur le fichier réellement servi.
 */
const PRIVATE_PATHS = ['/account', '/sign-in', '/reset-password?token=jeton-de-reinitialisation']

test('le plan de site référence exactement les pages publiques', async ({ request }) => {
  const response = await request.get('/sitemap.xml')

  expect(response.status()).toBe(200)

  const body = await response.text()
  const locations = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1] ?? '')
  const servedPaths = locations.map((url) => new URL(url).pathname)

  // **Une adresse par contribution, et rien d'autre.** Ni l'ordre — il suit
  // celui du graphe des modules —, ni la liste ne sont figés ici : les deux se
  // dérivent du registre, si bien qu'un module de plus n'ouvre pas ce fichier.
  expect(servedPaths).toHaveLength(contributed.length)

  for (const entry of contributed) {
    const forms = servedFormsOf(entry)

    // **Une** des formes servies, jamais laquelle : désigner la canonique
    // reviendrait à recopier la règle de `sitemapEntries`, qui est éprouvée
    // chez elle (un article traduit dans une seule langue n'a pas d'URL dans
    // l'autre, et la donner pour canonique annoncerait un 404).
    expect(
      servedPaths.filter((pathname) => forms.includes(pathname)),
      entry.path,
    ).toHaveLength(1)
  }

  for (const pathname of servedPaths) {
    expect(announcedPaths, pathname).toContain(pathname)
  }

  // Aucun module ne publie rien : le fichier ne référence **rien**. La
  // condition est dérivée elle aussi — l'écrire « site public coupé, blog
  // coupé, documentation coupée » était la même liste, un cran plus bas.
  if (contributed.length === 0) {
    expect(locations).toEqual([])
  }
})

test('chaque adresse annoncée est réellement servie', async ({ request }) => {
  // **Le balayage vide se dit**, il ne passe pas en vert : une configuration qui
  // ne publie rien rendrait ce cas vrai sur zéro adresse, et le rapport le
  // montrerait « passé ». Sauté, il se lit.
  test.skip(announcedPaths.length === 0, 'Aucun module activé ne publie d’adresse.')

  // Ce que le plan de site engage : ce qu'il donne à un moteur existe. Un
  // chemin contribué que l'application ne sert pas — préfixe de langue de
  // travers, page retirée sans sa contribution — n'apparaît nulle part
  // ailleurs : le nœud ne voit pas le routeur de Next, et la comparaison
  // ci-dessus dérive des deux côtés du même registre. C'est la seule assertion
  // de ce fichier qu'un défaut de contribution fait rougir.
  //
  // **Redirections suivies**, et c'est une mesure : `/fr/docs` répond 307 vers
  // la première page de l'arbre (s30). Ce qui est engagé n'est donc pas « cette
  // adresse répond 200 du premier coup » mais « elle mène à une page » — un
  // chemin contribué que personne ne sert finit en 404, redirections comprises.
  //
  // En parallèle : ces adresses se comptent en dizaines, et les demander une à
  // une ferait de ce cas le plus lent du fichier pour rien — le serveur les
  // sert déjà de front.
  const served = await Promise.all(
    announcedPaths.map(async (pathname) => ({
      pathname,
      status: (await request.get(pathname)).status(),
    })),
  )

  expect(served.filter((entry) => entry.status !== 200)).toEqual([])
})

/**
 * Le fichier servi, relu comme un robot le lit.
 *
 * Chercher `Allow: /fr` dans le corps ne dit rien de ce que le fichier
 * autorise : la correspondance d'un `robots.txt` est par préfixe, et c'est
 * ainsi qu'un `Allow: /fr` ouvrant `/fr/reset-password?token=…` a été livré
 * sous un test qui portait le nom contraire. Le corps est donc analysé, puis
 * interrogé par la règle du module.
 */
const parseRobots = (body: string): RobotsPolicy => {
  const values = (directive: string): string[] =>
    body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.toLowerCase().startsWith(`${directive.toLowerCase()}:`))
      .map((line) => line.slice(directive.length + 1).trim())

  return {
    rules: { userAgent: '*', allow: values('Allow'), disallow: values('Disallow') },
  }
}

test('le robots.txt n’ouvre que les pages publiques', async ({ request }) => {
  const response = await request.get('/robots.txt')

  expect(response.status()).toBe(200)

  const body = await response.text()
  const policy = parseRobots(body)

  // Garde contre l'inertie de l'analyse : sans directive lue, tout serait
  // « autorisé par défaut » et la boucle suivante passerait à l'envers.
  expect(policy.rules.disallow).toEqual(['/'])

  // Ce qu'aucune configuration ne doit ouvrir : l'espace applicatif, et surtout
  // une URL portant un jeton. Vrai dans les **deux** états du module.
  for (const pathname of PRIVATE_PATHS) {
    expect(robotsAllows(policy, publicPath(pathname)), pathname).toBe(false)
  }

  for (const pathname of announcedPaths) {
    expect(robotsAllows(policy, pathname), pathname).toBe(true)
  }

  if (!publicSite) {
    // Le site public coupé, sa racine reste interdite — **que le blog soit
    // activé ou non** : ce sont deux contributions séparées.
    for (const pathname of ['/', publicPath('/')]) {
      expect(robotsAllows(policy, pathname), pathname).toBe(false)
    }
  }

  // La ligne `Sitemap:` suit ce qui est publié, plus le seul site public : dès
  // qu'un module contribue une URL, elle réapparaît (s53, ADR 054). Sans
  // contribution, publier une adresse qui ne référence rien n'aurait aucun sens.
  expect(body.includes('Sitemap:')).toBe(announcedPaths.length > 0)
})

test.describe('site public activé', () => {
  test.skip(!publicSite, 'Le module marketing est coupé dans cette configuration.')

  test('la racine sert l’accueil, ses métadonnées et ses balises de partage', async ({ page }) => {
    const response = await page.goto('/')

    expect(response?.status()).toBe(200)
    await expect(page).toHaveURL(urlOf('/'))

    const first = marketingSite.sections[0]

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      text(`marketing.section.${first?.id ?? ''}.title`),
    )

    await expect(page).toHaveTitle(text('marketing.home.title'))
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      text('marketing.home.description'),
    )
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      'content',
      text('marketing.home.title'),
    )
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website')
  })

  test('le pied de page mène aux mentions légales, qui portent leurs propres balises', async ({
    page,
  }) => {
    await page.goto('/')

    const document = marketingSite.legalDocuments[0]
    const slug = document?.slug ?? ''

    await page
      .getByRole('navigation', { name: text('marketing.footer.label') })
      .getByRole('link', { name: text(`marketing.legal.${slug}.title`) })
      .click()

    await expect(page).toHaveURL(urlOf(legalPath(slug)))
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      text(`marketing.legal.${slug}.title`),
    )
    await expect(page).toHaveTitle(text(`marketing.legal.${slug}.title`))
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article')

    // Chaque section déclarée est rendue.
    for (const section of document?.sections ?? []) {
      await expect(
        page.getByRole('heading', { name: text(`marketing.legal.${slug}.section.${section}.title`) }),
      ).toBeVisible()
    }
  })

  test('un document légal non déclaré répond 404', async ({ request }) => {
    const response = await request.get(publicPath('/legal/inexistant'), { maxRedirects: 0 })

    expect(response.status()).toBe(404)
  })

  test('une question de la FAQ s’ouvre et révèle sa réponse', async ({ page }) => {
    const faq = marketingSite.sections.find((section) => section.kind === 'faq')

    test.skip(faq === undefined, 'Cette configuration ne déclare pas de FAQ.')

    const item = faq?.items[0] ?? ''
    const question = text(`marketing.section.${faq?.id ?? ''}.item.${item}.title`)
    const answer = text(`marketing.section.${faq?.id ?? ''}.item.${item}.body`)

    await page.goto('/')

    const trigger = page.getByRole('button', { name: question })

    // Fermée, la réponse n'est pas seulement invisible : le contenu n'est pas
    // dans l'arbre d'accessibilité.
    await expect(page.getByText(answer)).toHaveCount(0)
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await trigger.click()

    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByText(answer)).toBeVisible()
  })
})

test.describe('site public coupé', () => {
  test.skip(publicSite, 'Le module marketing est activé dans cette configuration.')

  test('la racine redirige un visiteur anonyme vers la connexion', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveURL(urlOf('/sign-in'))
  })

  test('aucune page légale n’est servie', async ({ request }) => {
    for (const slug of ['privacy', 'terms']) {
      const response = await request.get(publicPath(legalPath(slug)), { maxRedirects: 0 })

      expect(response.status(), slug).toBe(404)
    }
  })
})

test('le lien de navigation du module suit son activation', async ({ page }) => {
  // Vrai dans les deux états, et dérivé : le module déclare une entrée publique
  // vers l'accueil, qui disparaît avec lui. Le libellé est lu **dans le module**
  // et non dans le catalogue de l'application — coupé, ses clés n'y sont plus,
  // et c'est précisément ce que ce cas mesure.
  const label = marketingModule.messages[defaultLocale]?.['navigation.home'] ?? ''

  expect(label).not.toBe('')

  await page.goto(publicPath('/sign-in'))

  const home = page
    .getByRole('navigation', { name: 'Modules' })
    .getByRole('link', { name: label })

  await expect(home).toHaveCount(publicSite ? 1 : 0)
})
