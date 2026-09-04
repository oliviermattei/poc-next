import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

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

test('un article qui n’existe pas répond 404, sans rien annoncer', async ({ request }) => {
  const response = await request.get(publicPath('/blog/aucun-article-de-ce-nom'))

  expect(response.status()).toBe(404)
  expect(await response.text()).not.toContain(first?.title ?? '')
})
