import { describe, expect, it } from 'vitest'

import type { DocsPage, DocsSection } from '../domain/docs-page'
import {
  DOCS_PATH,
  EMPTY_DOCS_CATALOG,
  docsNavigationTree,
  docsPagePath,
  docsPageView,
  firstDocsPage,
  resolveDocsCatalog,
} from './docs-catalog'

/**
 * L'arborescence **est** la navigation : c'est le critère 1 de la story, et il
 * se prouve en déposant une page de plus dans une fixture sans l'inscrire nulle
 * part ailleurs.
 */

const page = (
  section: string,
  slug: string,
  order: number,
  locale = 'fr',
  title = `${section}/${slug}`,
): DocsPage => ({
  section,
  slug,
  locale,
  title,
  description: 'x',
  order,
  headings: [],
})

const section = (id: string, order: number, locale = 'fr', title = id): DocsSection => ({
  section: id,
  locale,
  title,
  order,
})

const catalog = (pages: readonly DocsPage[], sections: readonly DocsSection[]) =>
  resolveDocsCatalog({ pages, sections, defaultLocale: 'fr' })

describe('l’arborescence devient des sections', () => {
  it('range les sections par leur ordre déclaré, et les pages dans chacune', () => {
    /*
     * **Les rangs contredisent l'alphabet, et c'est tout l'intérêt de la
     * fixture.** Écrite avec `prise-en-main` (rang 1) et `reference` (rang 2),
     * elle attendait un ordre que le rang **et** l'alphabet produisent tous les
     * deux : remplacer le tri par un `localeCompare` sur le slug laissait ce cas
     * vert, et la propriété n'était protégée par rien. `api` au rang 2 tranche —
     * le rang le met en second, l'alphabet le mettrait en premier.
     */
    const tree = docsNavigationTree(
      catalog(
        [
          page('api', 'contrat', 1),
          page('prise-en-main', 'installer', 2),
          page('prise-en-main', 'demarrer', 1),
        ],
        [section('api', 2), section('prise-en-main', 1)],
      ),
      'fr',
    )

    expect(tree.map((entry) => entry.section)).toEqual(['prise-en-main', 'api'])
    expect(tree[0]?.pages.map((entry) => entry.slug)).toEqual(['demarrer', 'installer'])
  })

  it('donne à chaque page son chemin, dérivé de sa place dans l’arbre', () => {
    const tree = docsNavigationTree(
      catalog([page('prise-en-main', 'installer', 1)], [section('prise-en-main', 1)]),
      'fr',
    )

    expect(tree[0]?.pages[0]?.href).toBe(`${DOCS_PATH}/prise-en-main/installer`)
    expect(docsPagePath('prise-en-main', 'installer')).toBe(`${DOCS_PATH}/prise-en-main/installer`)
  })

  it('fait apparaître une page déposée sans l’inscrire ailleurs', () => {
    const before = catalog([page('guide', 'a', 1)], [section('guide', 1)])
    const after = catalog([page('guide', 'a', 1), page('guide', 'b', 2)], [section('guide', 1)])

    expect(docsNavigationTree(before, 'fr')[0]?.pages).toHaveLength(1)
    expect(docsNavigationTree(after, 'fr')[0]?.pages.map((entry) => entry.slug)).toEqual(['a', 'b'])
  })

  it('titre une section et une page dans la locale servie quand elle existe', () => {
    const tree = docsNavigationTree(
      catalog(
        [
          page('guide', 'a', 1, 'fr', 'Démarrer'),
          page('guide', 'a', 1, 'en', 'Get started'),
        ],
        [section('guide', 1, 'fr', 'Guide'), section('guide', 1, 'en', 'Handbook')],
      ),
      'en',
    )

    expect(tree[0]?.title).toBe('Handbook')
    expect(tree[0]?.pages[0]?.title).toBe('Get started')
  })

  it('retombe sur le titre de la locale par défaut quand la traduction manque', () => {
    const tree = docsNavigationTree(
      catalog([page('guide', 'a', 1, 'fr', 'Démarrer')], [section('guide', 1, 'fr', 'Guide')]),
      'en',
    )

    expect(tree[0]?.title).toBe('Guide')
    expect(tree[0]?.pages[0]?.title).toBe('Démarrer')
  })

  it('n’a ni index ni arbre quand le module est coupé', () => {
    // Motif `EMPTY_BLOG_CATALOG` / `EMPTY_MARKETING_SITE` : la même **donnée**
    // décide de la route et de la navigation, jamais un identifiant de module.
    expect(EMPTY_DOCS_CATALOG.index).toBeNull()
    expect(docsNavigationTree(EMPTY_DOCS_CATALOG, 'fr')).toEqual([])
  })

  it('refuse une section sans manifeste, en la nommant', () => {
    // Sans manifeste, la section n'a ni titre ni rang : elle serait rendue sous
    // son slug, à une place arbitraire, et personne ne saurait pourquoi.
    expect(() => catalog([page('orpheline', 'a', 1)], [])).toThrow(/orpheline/)
  })

  it('refuse une page traduite qui n’existe pas dans la locale par défaut', () => {
    // L'arbre canonique est celui de la locale par défaut : une page écrite
    // seulement en anglais n'y figurerait pas, donc ne serait jamais servie —
    // et rien ne le dirait à son auteur.
    expect(() =>
      catalog(
        [page('guide', 'a', 1, 'fr'), page('guide', 'orpheline', 2, 'en')],
        [section('guide', 1, 'fr')],
      ),
    ).toThrow(/orpheline/)
  })
})

describe('le repli i18n — l’inverse de celui du blog', () => {
  /*
   * Le blog **retire** un article non traduit de sa langue : servir le français
   * sur une URL anglaise ferait de deux pages une seule pour un moteur. Une
   * documentation absente vaut moins qu'une documentation dans la mauvaise
   * langue, donc la page **est servie**, et la mention le dit.
   *
   * Ne pas copier le mécanisme de s29 sans le retourner : `articleOf` rend
   * `null`, `docsPageView` rend la page de la langue par défaut.
   */
  const bilingual = catalog(
    [page('guide', 'traduite', 1, 'fr'), page('guide', 'traduite', 1, 'en'), page('guide', 'seule', 2, 'fr')],
    [section('guide', 1, 'fr'), section('guide', 1, 'en')],
  )

  it('sert la page de la langue demandée quand elle existe', () => {
    const view = docsPageView(bilingual, { locale: 'en', section: 'guide', slug: 'traduite' })

    expect(view?.page.locale).toBe('en')
    expect(view?.translated).toBe(true)
  })

  it('sert la page de la langue par défaut quand la traduction manque, et le dit', () => {
    const view = docsPageView(bilingual, { locale: 'en', section: 'guide', slug: 'seule' })

    // Les deux, et pas seulement la page : sans le drapeau, l'écran servirait
    // du français sous un titre anglais sans qu'aucune mention ne paraisse.
    expect(view?.page.locale).toBe('fr')
    expect(view?.translated).toBe(false)
  })

  it('ne mentionne rien quand la langue servie **est** la langue par défaut', () => {
    // Module `i18n` coupé : une seule langue servie, et c'est celle de l'arbre.
    // Une mention y serait absurde.
    const view = docsPageView(bilingual, { locale: 'fr', section: 'guide', slug: 'seule' })

    expect(view?.translated).toBe(true)
  })

  it('rend `null` sur une page ou une section que l’arbre ne porte pas', () => {
    // C'est ce qui fera un 404, et c'est le seul comportement correct : le
    // repli est linguistique, pas inventif.
    expect(docsPageView(bilingual, { locale: 'fr', section: 'guide', slug: 'inconnue' })).toBeNull()
    expect(docsPageView(bilingual, { locale: 'fr', section: 'inconnue', slug: 'traduite' })).toBeNull()
  })

  it('n’a rien à servir quand le module est coupé', () => {
    expect(docsPageView(EMPTY_DOCS_CATALOG, { locale: 'fr', section: 'guide', slug: 'a' })).toBeNull()
    expect(firstDocsPage(EMPTY_DOCS_CATALOG, 'fr')).toBeNull()
  })

  it('désigne la première page de l’arbre, celle vers laquelle `/docs` mène', () => {
    expect(firstDocsPage(bilingual, 'fr')?.slug).toBe('traduite')
  })
})
