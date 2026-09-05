import { InvalidDocsPageError, type DocsPage, type DocsSection } from '../domain/docs-page'

/** Le chemin interne de la documentation. Écrit une fois, lu par l'écran et par la navigation. */
export const DOCS_PATH = '/docs'

/** Le chemin interne d'une page. Écrit une fois, lu par l'écran, l'arbre et le plan de site. */
export const docsPagePath = (section: string, slug: string): string =>
  `${DOCS_PATH}/${section}/${slug}`

/**
 * Ce que la documentation est quand elle est montée.
 *
 * `null` sur l'index est ce qui remplace une condition « si le module est
 * activé » : la page lit cette donnée, et répond 404 quand elle manque. C'est le
 * motif `EMPTY_MARKETING_SITE` de s10 et `EMPTY_BLOG_CATALOG` de s29, à
 * l'identique.
 */
export interface DocsIndex {
  readonly path: string
  /**
   * La locale de l'arbre **canonique**.
   *
   * Elle est portée par la donnée et non lue d'une configuration : le repli
   * i18n de cette story a besoin de savoir de quelle langue une page retombe,
   * et l'écran n'a alors rien à connaître de `config/i18n.ts`.
   */
  readonly defaultLocale: string
}

/** La documentation, telle que l'application la lit — **de forme identique dans les deux états**. */
export interface DocsCatalog {
  readonly pages: readonly DocsPage[]
  readonly sections: readonly DocsSection[]
  readonly index: DocsIndex | null
}

/** L'état « aucune documentation » : celui du module coupé, écrit une fois. */
export const EMPTY_DOCS_CATALOG: DocsCatalog = { pages: [], sections: [], index: null }

export interface ResolveDocsCatalogInput {
  readonly pages: readonly DocsPage[]
  readonly sections: readonly DocsSection[]
  /** La locale de `config/i18n.ts`, transmise par le point de composition. */
  readonly defaultLocale: string
}

/**
 * Le catalogue, et les deux refus qui le rendent honnête.
 *
 * **L'arbre canonique est celui de la locale par défaut.** C'est ce qui rend le
 * repli possible — une page non traduite retombe sur *quelque chose* —, et cela
 * a deux conséquences qu'il vaut mieux refuser que subir :
 *
 * 1. une section sans manifeste n'a ni titre ni rang : elle serait rendue sous
 *    son slug, à une place arbitraire ;
 * 2. une page écrite **seulement** dans une traduction ne figure pas dans
 *    l'arbre, donc n'est jamais servie — et rien ne le dirait à son auteur.
 *
 * Les deux lèvent pendant `pnpm build`, en nommant le fautif, comme un
 * frontmatter invalide.
 */
export function resolveDocsCatalog({
  pages,
  sections,
  defaultLocale,
}: ResolveDocsCatalogInput): DocsCatalog {
  const canonical = new Set(
    pages
      .filter((page) => page.locale === defaultLocale)
      .map((page) => `${page.section}/${page.slug}`),
  )
  const declared = new Set(
    sections.filter((section) => section.locale === defaultLocale).map((section) => section.section),
  )

  for (const page of pages) {
    if (!declared.has(page.section)) {
      throw new InvalidDocsPageError(
        `Documentation refusée — section « ${page.section} » : aucun manifeste « section.json » ` +
          `dans la langue par défaut (${defaultLocale}). Sans lui, la section n’a ni titre ni rang.`,
      )
    }

    if (!canonical.has(`${page.section}/${page.slug}`)) {
      throw new InvalidDocsPageError(
        `Documentation refusée — ${page.section}/${page.slug}.mdx (${page.locale}) : cette page ` +
          `n’existe pas dans la langue par défaut (${defaultLocale}), elle ne serait donc jamais ` +
          'servie. L’arborescence servie est celle de la langue par défaut.',
      )
    }
  }

  return { pages, sections, index: { path: DOCS_PATH, defaultLocale } }
}

/** Une page, telle que la navigation latérale et le fil d'Ariane la nomment. */
export interface DocsNavigationPage {
  readonly section: string
  readonly slug: string
  readonly title: string
  readonly href: string
}

/** Une section, telle que la navigation latérale la replie. */
export interface DocsNavigationSection {
  readonly section: string
  readonly title: string
  readonly pages: readonly DocsNavigationPage[]
}

const byOrder = <T extends { readonly order: number }>(key: (item: T) => string) =>
  (left: T, right: T): number =>
    left.order - right.order || key(left).localeCompare(key(right))

/**
 * L'arbre servi dans une langue — **dérivé**, jamais déclaré.
 *
 * Rien n'inscrit une page ni une section : les deux sont l'arborescence de la
 * langue par défaut, ordonnée par les rangs que chaque fichier déclare. Déposer
 * un `.mdx` le fait apparaître ; c'est le critère 1 de la story.
 *
 * Les **titres** viennent de la langue servie quand elle les porte, et de la
 * langue par défaut sinon. C'est déjà le repli de la story, appliqué à la
 * navigation : un sommaire à trous serait pire qu'un sommaire dans la mauvaise
 * langue, puisqu'il masquerait des pages qui, elles, se servent.
 */
export function docsNavigationTree(
  catalog: DocsCatalog,
  locale: string,
): readonly DocsNavigationSection[] {
  if (catalog.index === null) {
    return []
  }

  const { defaultLocale } = catalog.index
  const titled = <T extends { readonly locale: string }>(
    candidates: readonly T[],
    matches: (item: T) => boolean,
  ): T | undefined =>
    candidates.find((item) => matches(item) && item.locale === locale) ??
    candidates.find((item) => matches(item) && item.locale === defaultLocale)

  return catalog.sections
    .filter((section) => section.locale === defaultLocale)
    .sort(byOrder((section) => section.section))
    .map((section) => ({
      section: section.section,
      title: titled(catalog.sections, (item) => item.section === section.section)?.title ?? section.title,
      pages: catalog.pages
        .filter((page) => page.locale === defaultLocale && page.section === section.section)
        .sort(byOrder((page) => page.slug))
        .map((page) => ({
          section: page.section,
          slug: page.slug,
          title:
            titled(
              catalog.pages,
              (item) => item.section === page.section && item.slug === page.slug,
            )?.title ?? page.title,
          href: docsPagePath(page.section, page.slug),
        })),
    }))
}

export interface DocsPageQuery {
  readonly locale: string
  readonly section: string
  readonly slug: string
}

/** La page servie, et **dans quelle langue** — la seconde moitié est le critère 3. */
export interface DocsPageResolution {
  readonly page: DocsPage
  /**
   * `false` quand la page rendue est celle de la langue par défaut faute de
   * traduction. L'écran s'en sert pour porter la mention explicite ; sans ce
   * drapeau, il servirait du français sous un titre anglais sans un mot.
   */
  readonly translated: boolean
}

/**
 * La page d'un chemin **dans une langue**, ou `null`.
 *
 * **C'est l'inverse du blog, et l'inversion est le critère.** `articleOf` rend
 * `null` quand un article n'existe pas dans la langue demandée : servir la
 * version française sur une URL anglaise ferait de deux pages une seule pour un
 * moteur. Une documentation absente, elle, vaut moins qu'une documentation dans
 * la mauvaise langue — la page de la langue par défaut est donc servie, et la
 * mention le dit.
 *
 * `null` est réservé à ce que l'arbre ne porte pas : c'est ce qui fera un 404.
 * Le repli est linguistique, jamais inventif.
 */
export function docsPageView(
  catalog: DocsCatalog,
  query: DocsPageQuery,
): DocsPageResolution | null {
  if (catalog.index === null) {
    return null
  }

  const { defaultLocale } = catalog.index
  const matches = (page: DocsPage): boolean =>
    page.section === query.section && page.slug === query.slug
  const canonical = catalog.pages.find(
    (page) => matches(page) && page.locale === defaultLocale,
  )

  if (canonical === undefined) {
    return null
  }

  const translated = catalog.pages.find(
    (page) => matches(page) && page.locale === query.locale,
  )

  return translated === undefined
    ? { page: canonical, translated: false }
    : { page: translated, translated: true }
}

/**
 * La première page de l'arbre — celle vers laquelle `/docs` mène.
 *
 * La documentation n'a pas de « liste » au sens du blog : l'arborescence **est**
 * la navigation, et une page d'accueil qui répéterait la première page lui
 * ferait deux URL pour un même contenu. `/docs` redirige donc, et cette fonction
 * dit vers où — depuis la même donnée que la navigation, jamais depuis un chemin
 * écrit à la main.
 */
export function firstDocsPage(
  catalog: DocsCatalog,
  locale: string,
): DocsNavigationPage | null {
  return docsNavigationTree(catalog, locale).flatMap((section) => section.pages)[0] ?? null
}
