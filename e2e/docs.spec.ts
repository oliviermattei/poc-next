import { expect, test } from '@playwright/test'
import { DOCS_PATH, docsNavigationTree } from '@repo/module-docs'

import { docsCatalog } from '../apps/web/lib/docs'
import { defaultLocale } from '../config/i18n'
import { publicPath, urlOf } from './support/locale'

/**
 * La documentation, **lue dans un navigateur**.
 *
 * Ce que ce fichier prouve et qu'aucun test Vitest ne peut prouver :
 *
 * 1. que le corps d'une page, compilé par le bundler (ADR 053), s'affiche
 *    **sous la politique de sécurité du contenu réelle**, sans qu'une seule
 *    violation ne soit signalée ;
 * 2. que la navigation latérale s'ouvre **sous `lg`**, où elle entre dans un
 *    `Sheet` — un rendu statique ne monte pas le contenu d'un panneau fermé ;
 * 3. que le sommaire **suit le défilement** : `IntersectionObserver` n'existe
 *    que dans un navigateur ;
 * 4. qu'un chemin inconnu répond **404**, et pas 200 avec une coquille. C'est la
 *    garde que s29 a payée pour apprendre : sans elle, un `loading.tsx` posé un
 *    jour sur ce segment ferait passer le refus en 200 sans que rien ne rougisse.
 *
 * Les attentes sont **dérivées du contenu livré** : une page ajoutée entre dans
 * la mesure sans qu'on l'y inscrive. Le fichier se saute tout entier quand le
 * module est coupé — ses écrans répondent alors 404, et c'est
 * `pnpm test:minimal-profile` qui le vérifie.
 */

const tree = docsNavigationTree(docsCatalog, defaultLocale)
const first = tree[0]?.pages[0]

/** Une page portant au moins deux titres : sans elle, le sommaire n'a rien à suivre. */
const withHeadings = docsCatalog.pages.find(
  (page) => page.locale === defaultLocale && page.headings.length >= 2,
)

test.describe('la documentation', () => {
  test.skip(
    docsCatalog.index === null || first === undefined,
    'Module « docs » coupé : ses écrans répondent 404, ce que pnpm test:minimal-profile vérifie.',
  )

  test('mène de l’entrée à la première page, avec sa navigation et son sommaire', async ({
    page,
  }) => {
    const violations: string[] = []

    page.on('console', (message) => {
      if (message.text().includes('Content Security Policy')) {
        violations.push(message.text())
      }
    })

    // `/docs` ne rend rien : l'arborescence **est** la navigation, et cette
    // adresse mène à la première page plutôt que d'en répéter le contenu.
    await page.goto(publicPath(DOCS_PATH))
    await expect(page).toHaveURL(urlOf(first?.href ?? ''))

    await expect(page.getByRole('heading', { level: 1, name: first?.title ?? '' })).toBeVisible()

    // La navigation latérale, dérivée de l'arborescence : toutes les sections y
    // sont, et la page servie y est marquée.
    const sidebar = page.getByRole('navigation', { name: /section/i })

    for (const section of tree) {
      await expect(sidebar.getByText(section.title, { exact: true })).toBeVisible()
    }

    await expect(sidebar.locator('a[aria-current="page"]')).toHaveAttribute(
      'href',
      publicPath(first?.href ?? ''),
    )

    // Le fil d'Ariane : la section, puis la page courante — qui n'est pas un lien.
    await expect(page.getByRole('navigation', { name: /ariane|breadcrumb/i })).toContainText(
      first?.title ?? '',
    )

    expect(violations, violations.join(' ;; ')).toEqual([])
  })

  test('suit le défilement dans le sommaire, et y navigue au clic', async ({ page }) => {
    test.skip(withHeadings === undefined, 'Aucune page livrée ne porte deux titres.')

    const target = withHeadings?.headings.at(-1)

    await page.goto(publicPath(`${DOCS_PATH}/${withHeadings?.section}/${withHeadings?.slug}`))

    const toc = page.getByRole('navigation', { name: /page/i }).last()
    const entry = toc.getByRole('link', { name: target?.text ?? '' })

    // Avant tout défilement, la dernière entrée n'est pas la position courante.
    await expect(entry).not.toHaveAttribute('aria-current', 'location')

    await entry.click()

    // Le clic déplace la page **et** la position courante : c'est le lien entre
    // l'ancre dérivée de la source et l'`id` posé au rendu qui est mesuré ici.
    await expect(page).toHaveURL(new RegExp(`#${target?.id ?? ''}$`))
    await expect(entry).toHaveAttribute('aria-current', 'location')
  })

  test('ouvre sa navigation dans un panneau sous `lg`', async ({ page }) => {
    // 390 px : le petit écran de référence du dépôt. La colonne latérale y est en
    // `display: none`, donc il n'existe qu'**une** navigation de documentation à
    // la fois dans l'arbre d'accessibilité — sans quoi le sélecteur par rôle et
    // nom en trouverait deux.
    await page.setViewportSize({ width: 390, height: 780 })
    await page.goto(publicPath(first?.href ?? ''))

    await expect(page.getByRole('navigation', { name: /section/i })).toBeHidden()

    await page.getByRole('button', { name: /sommaire de la documentation/i }).click()

    const sidebar = page.getByRole('navigation', { name: /section/i })

    await expect(sidebar).toBeVisible()

    const other = tree.flatMap((section) => section.pages).find((page) => page.href !== first?.href)

    test.skip(other === undefined, 'Une seule page livrée : rien vers quoi naviguer.')

    await sidebar.getByRole('link', { name: other?.title ?? '' }).click()

    await expect(page).toHaveURL(urlOf(other?.href ?? ''))
    // Le panneau se ferme en suivant un lien : sans cela il resterait ouvert
    // par-dessus la page qu'on vient d'ouvrir.
    await expect(page.getByRole('navigation', { name: /section/i })).toBeHidden()
  })

  test('ne déborde pas horizontalement à 390 px, blocs de code compris', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 })
    await page.goto(publicPath(first?.href ?? ''))

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )

    // Le défilement horizontal est réservé aux blocs de code, **dans leur
    // cadre** : c'est ce que `min-w-0` sur chaque colonne rend possible. Un
    // document qui défile est le défaut n°1 sous 400 px.
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('répond 404 sur un chemin de documentation inconnu', async ({ page }) => {
    /*
     * **Le statut, pas le rendu.** C'est la garde que s29 a payée pour
     * apprendre : un `loading.tsx` posé sur ce segment ferait vider la coquille
     * avant que la page ne décide, et ce refus arriverait en **200** — avec le
     * bon contenu à l'écran. Un `expect(...).toBeVisible()` ne le verrait pas.
     */
    const inconnu = await page.goto(publicPath(`${DOCS_PATH}/${first?.section}/page-inventee`))

    expect(inconnu?.status()).toBe(404)

    const section = await page.goto(publicPath(`${DOCS_PATH}/section-inventee/une-page`))

    expect(section?.status()).toBe(404)
  })
})
