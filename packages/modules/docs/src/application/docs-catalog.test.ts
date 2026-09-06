import { describe, expect, it } from 'vitest'

import { InvalidDocsPageError, type DocsPage, type DocsSection } from '../domain/docs-page'
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
  links: readonly string[] = [],
): DocsPage => ({
  section,
  slug,
  locale,
  title,
  description: 'x',
  order,
  headings: [],
  links,
  text: '',
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

/* ------------------------------------------------------------------------- *
 * La passe croisée (s54).
 *
 * **Ce n'est pas le premier refus qui traverse deux fichiers**, et les cas
 * ci-dessus le montrent : « une section sans manifeste » et « une page écrite
 * seulement dans une traduction » (s30) confrontent déjà une page à d'autres
 * fichiers. Ce qui est neuf est la **nature** de la relation — ces deux-là
 * cherchent un fichier que les coordonnées de la page désignent, là où un lien
 * est une référence **écrite par l'auteur**, de cible arbitraire, résolue
 * contre le catalogue entier.
 *
 * Elle porte sur le **catalogue**, pas sur le disque : les pages sont déjà lues
 * et validées, et un second balayage divergerait du premier au premier
 * changement de règle.
 * ------------------------------------------------------------------------- */

describe('les liens internes, croisés sur l’ensemble du contenu', () => {
  const linking = (from: readonly string[], locale = 'fr') =>
    catalog(
      [
        page('prise-en-main', 'installer', 1, locale, 'Installer', from),
        ...(locale === 'fr' ? [] : [page('prise-en-main', 'installer', 1)]),
        page('reference', 'modules', 1),
      ],
      [section('prise-en-main', 1), section('reference', 2)],
    )

  it('accepte un lien vers une page que l’arbre porte', () => {
    expect(() => linking(['/docs/reference/modules'])).not.toThrow()
  })

  it('refuse un lien vers une page que l’arbre ne porte pas', () => {
    expect(() => linking(['/docs/reference/inexistante'])).toThrow(InvalidDocsPageError)
    // Une section entière qui n'existe pas est le même défaut, pas un autre.
    expect(() => linking(['/docs/inconnue/modules'])).toThrow(InvalidDocsPageError)
  })

  it('accepte l’entrée de la documentation elle-même', () => {
    // `/docs` ne désigne aucune page : il redirige vers la première. Le
    // refuser interdirait le lien de retour le plus naturel du contenu.
    expect(() => linking([DOCS_PATH])).not.toThrow()
  })

  it('ne juge pas un lien qui sort de la documentation', () => {
    /*
     * `/pricing` appartient à un module que la configuration peut couper, et ce
     * catalogue n'en sait rien. Refuser ici ferait échouer le build d'un projet
     * dont la page existe, accepter en silence est la seule réponse honnête —
     * et c'est nommé dans le commentaire de la passe, pas tu.
     */
    expect(() => linking(['/pricing'])).not.toThrow()
  })

  it('croise une traduction avec l’arbre canonique, pas avec sa seule langue', () => {
    /*
     * **La question que la recherche laissait ouverte, tranchée** : une page
     * anglaise qui cite une page écrite en français seulement pointe vers une
     * adresse qui **répond** — le repli de s30 la sert. Le lien n'est donc pas
     * mort, et le croiser avec les seules pages anglaises le déclarerait mort à
     * tort. L'arbre servi est celui de la langue par défaut : c'est lui qui
     * décide, dans toutes les langues.
     */
    expect(() => linking(['/docs/reference/modules'], 'en')).not.toThrow()
  })

  it('nomme le fichier fautif **et** la cible manquante', () => {
    /*
     * Les deux bouts, et le critère l'exige. Un refus qui ne nomme que le
     * fichier envoie relire toute la page ; un refus qui ne nomme que la cible
     * envoie la chercher dans tout le contenu.
     */
    let message = ''

    try {
      linking(['/docs/reference/inexistante'])
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain('prise-en-main/installer.mdx')
    expect(message).toContain('/docs/reference/inexistante')
  })

  it('cite la cible telle qu’elle est écrite, fragment compris', () => {
    // Le fragment n'est pas jugé — le critère parle d'une page inexistante —,
    // mais l'auteur doit retrouver dans son fichier la chaîne que le refus
    // affiche.
    let message = ''

    try {
      linking(['/docs/reference/inexistante#une-ancre'])
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).toContain('/docs/reference/inexistante#une-ancre')
  })
})
