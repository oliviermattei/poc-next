import { describe, expect, it } from 'vitest'

import type { DocsPage, DocsSection } from '../domain/docs-page'
import { EMPTY_DOCS_CATALOG, resolveDocsCatalog } from './docs-catalog'
import {
  DOCS_SEARCH_INDEX_MAX_BYTES,
  DocsSearchIndexTooLargeError,
  docsSearchIndex,
  searchDocsIndex,
} from './docs-search'

/**
 * L'index de recherche, et ce qu'on y trouve.
 *
 * **Les attentes de ce fichier sont écrites, jamais dérivées de la fonction
 * mesurée.** C'est le défaut majeur que la revue de s31 a trouvé sur la page du
 * changelog : le filtre de langue n'y était protégé par rien, parce que
 * l'attente était construite en appelant la fonction qu'elle prétendait juger.
 * Ici, le catalogue est écrit à la main et les titres attendus sont des
 * littéraux.
 */

const page = (
  section: string,
  slug: string,
  locale: string,
  title: string,
  description: string,
  text = '',
  order = 1,
): DocsPage => ({
  section,
  slug,
  locale,
  title,
  description,
  order,
  headings: [],
  links: [],
  text,
})

const section = (id: string, order: number, locale: string, title: string): DocsSection => ({
  section: id,
  locale,
  title,
  order,
})

/**
 * Deux sections, trois pages canoniques, **une seule traduite**.
 *
 * `reference/modules` n'existe qu'en français : c'est la page que s30 sert
 * quand même, avec sa mention, et donc le seul cas où la recherche a un
 * arbitrage à rendre.
 */
const catalog = resolveDocsCatalog({
  defaultLocale: 'fr',
  sections: [
    section('prise-en-main', 1, 'fr', 'Prise en main'),
    section('prise-en-main', 1, 'en', 'Getting started'),
    section('reference', 2, 'fr', 'Référence'),
  ],
  pages: [
    page(
      'prise-en-main',
      'installer',
      'fr',
      'Installer le dépôt',
      'Cloner et lever une base.',
      'Prérequis Node 20.10 et pnpm 10. Les modules s’activent ensuite.',
    ),
    page(
      'prise-en-main',
      'installer',
      'en',
      'Install the repository',
      'Clone it and bring a database up.',
      'Requirements Node 20.10 and pnpm 10. Modules are enabled next.',
    ),
    page(
      'reference',
      'modules',
      'fr',
      'Le contrat de module',
      'Les quinze clés.',
      'Quatre couches : domain, application, infrastructure, presentation.',
    ),
  ],
})

describe('l’index de recherche', () => {
  it('porte une entrée par page servie, dans l’ordre de l’arbre', () => {
    expect(docsSearchIndex(catalog, 'fr').map((entry) => entry.href)).toEqual([
      '/docs/prise-en-main/installer',
      '/docs/reference/modules',
    ])
  })

  it('porte ce qui est déjà public, et rien d’autre', () => {
    // `docs/security.md` : l'index est servi au visiteur. Il ne doit contenir
    // que ce que la page elle-même affiche — titre, description, corps —, et
    // aucun chemin de fichier, aucune langue non servie, aucune donnée.
    expect(docsSearchIndex(catalog, 'fr')[0]).toEqual({
      href: '/docs/prise-en-main/installer',
      section: 'Prise en main',
      title: 'Installer le dépôt',
      description: 'Cloner et lever une base.',
      text: 'Prérequis Node 20.10 et pnpm 10. Les modules s’activent ensuite.',
      translated: true,
    })
  })

  it('n’indexe rien quand le module est coupé', () => {
    // Le critère 5 : aucun index. La décision se lit sur la **donnée**, jamais
    // sur l'identifiant d'un module.
    expect(docsSearchIndex(EMPTY_DOCS_CATALOG, 'fr')).toEqual([])
  })
})

describe('l’index respecte la langue servie', () => {
  it('rend la page dans la langue demandée quand elle y existe', () => {
    /*
     * **Le défaut de s31, transposé** : un index qui ignore la locale servirait
     * les titres français sur la page anglaise. Les valeurs attendues sont des
     * littéraux du catalogue ci-dessus, pas le retour de la fonction mesurée.
     */
    const entry = docsSearchIndex(catalog, 'en')[0]

    expect(entry?.title).toBe('Install the repository')
    expect(entry?.description).toBe('Clone it and bring a database up.')
    expect(entry?.text).toBe('Requirements Node 20.10 and pnpm 10. Modules are enabled next.')
    expect(entry?.section).toBe('Getting started')
  })

  it('ne propose pas une page non traduite comme si elle l’était', () => {
    /*
     * **Le critère 4.** s30 sert la page de la langue par défaut avec une
     * mention plutôt que de la cacher — la recherche fait le même choix, et
     * c'est ce drapeau qui empêche de la faire passer pour anglaise. Le
     * cacher priverait le lecteur d'une page qui, elle, répond.
     */
    const untranslated = docsSearchIndex(catalog, 'en')[1]

    expect(untranslated?.href).toBe('/docs/reference/modules')
    expect(untranslated?.translated).toBe(false)
    // Le titre et le corps viennent du **même fichier** : un titre traduit
    // au-dessus d'un corps français serait un mensonge de plus, pas un repli.
    expect(untranslated?.title).toBe('Le contrat de module')
    expect(untranslated?.text).toBe(
      'Quatre couches : domain, application, infrastructure, presentation.',
    )
  })

  it('marque comme traduite la page qui l’est, sans quoi le drapeau ne dit rien', () => {
    // Sans ce cas, un drapeau toujours `false` passerait le cas précédent.
    expect(docsSearchIndex(catalog, 'en')[0]?.translated).toBe(true)
  })
})

describe('le plafond de taille de l’index', () => {
  /*
   * **Le critère n'en fixe aucun, et c'est précisément le problème.** L'index
   * est téléchargé par **chaque visiteur** : sans plafond mesuré, la promesse
   * « sans service externe » se paie sur le réseau du lecteur, et rien ne le
   * dirait. Le refus arrive là où le catalogue est résolu, donc pendant
   * `pnpm build`, comme un frontmatter invalide.
   */
  const bloated = (pages: number) =>
    resolveDocsCatalog({
      defaultLocale: 'fr',
      sections: [section('prise-en-main', 1, 'fr', 'Prise en main')],
      pages: Array.from({ length: pages }, (_, index) =>
        page(
          'prise-en-main',
          `page-${index}`,
          'fr',
          `Page ${index}`,
          'x',
          'lorem ipsum '.repeat(400),
          index,
        ),
      ),
    })

  it('refuse un index qui dépasse le plafond, en donnant la mesure et le plafond', () => {
    let message = ''

    try {
      docsSearchIndex(bloated(40), 'fr')
    } catch (error) {
      expect(error).toBeInstanceOf(DocsSearchIndexTooLargeError)
      message = (error as Error).message
    }

    expect(message).toContain(String(DOCS_SEARCH_INDEX_MAX_BYTES))
    // La mesure, pas seulement le verdict : « trop gros » n'aide personne à
    // décider quoi couper. Elle est forcément **au-dessus** du plafond, ce
    // qu'un message ne citant que le plafond ne peut pas produire.
    const numbers = [...message.matchAll(/\d+/g)].map((match) => Number(match[0]))

    expect(numbers.some((value) => value > DOCS_SEARCH_INDEX_MAX_BYTES)).toBe(true)
  })

  it('laisse passer un index qui tient sous le plafond', () => {
    // Sans ce cas, un refus inconditionnel passerait le précédent.
    expect(() => docsSearchIndex(bloated(1), 'fr')).not.toThrow()
  })
})

describe('la recherche dans l’index', () => {
  const index = docsSearchIndex(catalog, 'fr')
  const found = (query: string) => searchDocsIndex(index, query).map((entry) => entry.href)

  it('trouve une page par son titre', () => {
    expect(found('contrat')).toEqual(['/docs/reference/modules'])
  })

  it('trouve une page par son corps — c’est ce que « plein texte » veut dire', () => {
    // Sans le corps, la recherche ne serait qu'un filtre sur des titres, et le
    // critère 1 tomberait sans que rien ne rougisse.
    expect(found('pnpm')).toEqual(['/docs/prise-en-main/installer'])
  })

  it('ignore les accents et la casse', () => {
    // « prerequis » au clavier doit trouver « Prérequis » : sinon la recherche
    // ne sert que ceux qui savent déjà comment le mot s'écrit.
    expect(found('PREREQUIS')).toEqual(['/docs/prise-en-main/installer'])
  })

  it('exige tous les mots de la requête, pas un seul', () => {
    // Un « ou » rendrait toute la documentation sur deux mots communs.
    expect(found('quatre couches')).toEqual(['/docs/reference/modules'])
    expect(found('quatre pnpm')).toEqual([])
  })

  it('ne rend rien quand rien ne correspond', () => {
    expect(found('kubernetes')).toEqual([])
  })

  it('ne rend pas tout sur une requête qu’aucun caractère latin ne compose', () => {
    /*
     * **« Tout correspond » est une pire réponse que « rien ne correspond ».**
     * Une découpe sur `[^a-z0-9]` ne produit aucun jeton pour du cyrillique, du
     * grec ou du japonais ; une requête sans jeton est alors traitée comme une
     * requête vide, et l'index entier revient. Dans un dépôt destiné à être
     * localisé, l'alphabet du lecteur ne peut pas décider du sens de la
     * réponse.
     */
    expect(found('кубернетес')).toEqual([])
    expect(found('日本語')).toEqual([])
  })

  it('trouve une page écrite dans un autre alphabet', () => {
    /*
     * Sans ce cas, rendre `[]` pour toute requête non latine passerait le
     * précédent : la découpe doit **produire un jeton**, pas en supprimer un.
     */
    const cyrillique = resolveDocsCatalog({
      defaultLocale: 'fr',
      sections: [section('prise-en-main', 1, 'fr', 'Начало')],
      pages: [page('prise-en-main', 'installer', 'fr', 'Установка', 'Начало работы')],
    })

    expect(
      searchDocsIndex(docsSearchIndex(cyrillique, 'fr'), 'установка').map((entry) => entry.href),
    ).toEqual(['/docs/prise-en-main/installer'])
  })

  it('rend l’index entier sur une requête vide', () => {
    // L'état d'ouverture de la palette : parcourir, plutôt qu'un « aucun
    // résultat » qui serait faux.
    expect(found('   ')).toEqual([
      '/docs/prise-en-main/installer',
      '/docs/reference/modules',
    ])
  })

  it('classe le titre avant le corps', () => {
    /*
     * « module » est dans le **titre** de `reference/modules` et dans le
     * **corps** de `prise-en-main/installer` : les deux correspondent, et
     * l'ordre de l'arbre mettrait la seconde devant. Sans classement, ce cas
     * rougit.
     */
    expect(searchDocsIndex(index, 'module').map((entry) => entry.href)).toEqual([
      '/docs/reference/modules',
      '/docs/prise-en-main/installer',
    ])
  })

  it('borne le nombre de résultats', () => {
    expect(searchDocsIndex(index, '', 1)).toHaveLength(1)
  })
})
