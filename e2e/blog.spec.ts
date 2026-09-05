import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { blogFeedPath } from '@repo/module-blog'
import { parseFeed } from '@rowanmanning/feed-parser'

import { blogCatalog } from '../apps/web/lib/blog'
import { defaultLocale } from '../config/i18n'
import { publicPath, urlOf } from './support/locale'

/**
 * Le blog, **lu dans un navigateur**.
 *
 * Ce que ce fichier prouve et qu'aucun test Vitest ne peut prouver : que le
 * corps d'un article, compilé par le bundler (ADR 053), s'affiche **sous la
 * politique de sécurité du contenu réelle**, sans qu'une seule violation ne
 * soit signalée. C'est le point que le plan désigne comme « l'endroit où ça
 * peut être faux » — une brique qui compilerait au build *et* évaluerait à
 * l'exécution pour certaines constructions se verrait ici, et nulle part
 * ailleurs.
 *
 * Il prouve aussi le parcours que l'utilisateur fait : ouvrir la liste, réduire
 * par un tag, ouvrir un article, revenir.
 *
 * **Ce qu'il ne peut pas prouver**, et c'est dit plutôt que sous-entendu :
 * `playwright.config.ts` démarre `next dev`, où la politique porte
 * `'unsafe-eval'` (React y reconstruit ses piles serveur par `eval`). Une
 * évaluation à l'exécution ne serait donc pas *refusée* ici ; ce que ce fichier
 * constate est qu'il n'y a **aucune violation d'aucune sorte**, et
 * `tests/security-headers.test.ts` tient la politique de production.
 *
 * Les attentes sont **dérivées du contenu livré** : un article ajouté entre
 * dans la mesure sans qu'on l'y inscrive. Le fichier se saute tout entier quand
 * le module est coupé — ses écrans répondent alors 404, et c'est
 * `pnpm test:minimal-profile` qui le vérifie.
 */

const articles = blogCatalog.articles.filter((article) => article.locale === defaultLocale)
const first = articles[0]

/**
 * L'article qui porte un bloc de code, **trouvé dans le contenu livré**.
 *
 * Il est cherché plutôt que nommé : le premier article de la liste change avec
 * les dates, et figer un slug ferait rougir ce parcours pour une publication.
 */
const sourceOf = (slug: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../content/blog/${defaultLocale}/${slug}.mdx`, import.meta.url)),
    'utf8',
  )

const withCode = articles.find((article) => sourceOf(article.slug).includes('```'))

test.skip(blogCatalog.index === null || first === undefined, 'module blog coupé')

/** Les messages d'erreur de la console, violations de politique comprises. */
const consoleErrorsOf = (page: Page): string[] => {
  const found: string[] = []

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') {
      found.push(message.text())
    }
  })

  page.on('pageerror', (error) => found.push(error.message))

  return found
}

test('la liste rend un article par carte, et chaque titre y mène', async ({ page }) => {
  await page.goto(publicPath('/blog'))

  for (const article of articles) {
    await expect(page.getByRole('link', { name: article.title })).toBeVisible()
  }
})

test('un tag réduit la liste sans quitter la page', async ({ page }) => {
  // Le tag choisi est celui du **premier** article : il en existe donc au moins
  // un, et l'attente est dérivée du contenu, jamais recopiée.
  const tag = first?.tags[0] ?? ''
  const expected = articles.filter((article) => article.tags.includes(tag))

  await page.goto(publicPath('/blog'))
  await page.getByRole('link', { name: tag, exact: true }).first().click()

  await expect(page).toHaveURL(urlOf('/blog', `?tag=${encodeURIComponent(tag)}`))
  await expect(page.getByRole('link', { name: articles[0]?.title ?? '' })).toHaveCount(
    expected.some((article) => article.title === articles[0]?.title) ? 1 : 0,
  )
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(expected.length)
})

test('un tag sans article mène à un état vide qui offre la sortie', async ({ page }) => {
  await page.goto(`${publicPath('/blog')}?tag=aucun-article-ne-porte-ce-tag`)

  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(0)
  await page.getByRole('link', { name: /article/i }).last().click()

  await expect(page).toHaveURL(urlOf('/blog'))
})

test('un article rend son corps sous la politique servie, console vide', async ({ page }) => {
  const errors = consoleErrorsOf(page)

  const article = withCode ?? first

  await page.goto(publicPath('/blog'))
  await page.getByRole('link', { name: article?.title ?? '' }).click()

  await expect(page).toHaveURL(urlOf(`/blog/${article?.slug ?? ''}`))
  await expect(page.getByRole('heading', { level: 1, name: article?.title ?? '' })).toBeVisible()

  // Le corps compilé : un titre interne et un bloc de code, c'est-à-dire deux
  // constructions que le MDX produit et qu'aucune donnée de frontmatter ne
  // pourrait fabriquer. Le second n'est exigé que si le contenu livré en porte
  // un — sinon ce parcours mesurerait la rédaction, pas le pipeline.
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible()

  if (withCode !== undefined) {
    await expect(page.locator('article pre code').first()).toBeVisible()
  }

  expect(errors, errors.join(' ;; ')).toEqual([])

  // Le retour de pied ramène à la liste.
  await page.getByRole('link', { name: /article/i }).last().click()
  await expect(page).toHaveURL(urlOf('/blog'))
})

/**
 * **Cas intermittent de s52, cause non établie** — `read ECONNRESET` sur ce
 * `GET`, vu une fois en revue de s53, vert au rejeu isolé et au second passage
 * complet.
 *
 * Ce qu'on en sait : `e2e/health.spec.ts` porte le **même** symptôme sous
 * `pnpm test:socle`, et les deux sont des `request.get` tirés du pool de
 * connexions persistantes de Playwright — d'où l'hypothèse d'une connexion
 * réutilisée à l'instant où le serveur la ferme. Ce qu'on n'en sait pas : rien
 * ne l'établit. Aucun des deux n'a été reproduit sur cette branche (une suite
 * complète à vide, une sous huit boucles de calcul, zéro rouge).
 *
 * Le cas reste donc **ouvert et nommé**, sans reprise ni délai posé au hasard :
 * une reprise sur `ECONNRESET` rendrait ce rouge invisible sans rien apprendre,
 * et c'est précisément ce que `retries: 0` refuse.
 */
test('un article qui n’existe pas répond 404, sans rien annoncer', async ({ request }) => {
  const response = await request.get(publicPath('/blog/aucun-article-de-ce-nom'))

  expect(response.status()).toBe(404)
  expect(await response.text()).not.toContain(first?.title ?? '')
})

test('le flux est servi, valide, et annoncé par la liste', async ({ request, page }) => {
  // Ce qu'aucun test de nœud ne voit : le document que **Next sert
  // réellement** sur la route montée du module, avec son type de contenu, et le
  // lien qui le rend découvrable dans le `<head>` de la liste.
  const response = await request.get(blogFeedPath())

  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('application/rss+xml')

  const body = await response.text()
  const feed = parseFeed(body)

  // L'auteur est nommé en `dc:creator`, espace de noms déclaré : RSS 2.0 réserve
  // `<item><author>` à une **adresse email**, et le frontmatter n'en porte pas.
  // Mesuré sur le document **servi**, parce que c'est lui qu'un agrégateur lit.
  expect(body).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"')
  expect(body).toContain('<dc:creator>')
  expect(body).not.toContain('<author>')

  expect(feed.items.map((item) => new URL(item.url ?? '').pathname)).toEqual(
    // Du plus récent au plus ancien, et seulement la langue servie par défaut.
    [...articles]
      .sort((left, right) => right.date.localeCompare(left.date))
      .map((article) => publicPath(`/blog/${article.slug}`)),
  )

  await page.goto(publicPath('/blog'))

  // Next rend l'URL **absolue** contre `metadataBase` (`APP_URL`) : c'est ce qui
  // fait qu'un agrégateur suit le bon serveur, et c'est la raison pour laquelle
  // s53 a posé `metadataBase` — sans elle, Next publie `http://localhost:3000`.
  const announced = await page
    .locator('link[rel="alternate"][type="application/rss+xml"]')
    .getAttribute('href')

  // L'origine annoncée est celle **du serveur**, pas celle par laquelle Next se
  // rabat quand `metadataBase` manque (`http://localhost:3000`) : c'est la
  // seule chose que cette assertion attrape, et c'est pour elle que s53 pose
  // `metadataBase` depuis `APP_URL`.
  expect(announced).toBe(new URL(blogFeedPath(), page.url()).toString())
})

test('le robots.txt autorise le blog, et le plan de site le référence', async ({ request }) => {
  // Le critère 1 de la story, sur les fichiers **réellement servis** : s29 a
  // livré le blog activé et interdit.
  const robots = await (await request.get('/robots.txt')).text()
  const sitemap = await (await request.get('/sitemap.xml')).text()
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => new URL(match[1] ?? '').pathname,
  )

  expect(robots).toContain(`Allow: ${publicPath('/blog')}$`)
  expect(locations).toContain(publicPath('/blog'))

  for (const article of articles) {
    expect(locations).toContain(publicPath(`/blog/${article.slug}`))
  }
})
