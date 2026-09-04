import type { BlogArticle } from '../domain/article'

/** Le chemin interne de la liste. Écrit une fois, lu par l'écran et par la navigation. */
export const BLOG_PATH = '/blog'

/** Le chemin interne d'un article. Écrit une fois, lu par l'écran et par les cartes. */
export const articlePath = (slug: string): string => `${BLOG_PATH}/${slug}`

/**
 * Ce que le blog est quand il est monté : un chemin et une taille de page.
 *
 * `null` sur le catalogue est ce qui remplace une condition « si le module est
 * activé » : la page lit cette donnée, et répond 404 quand elle manque. C'est
 * le motif `EMPTY_MARKETING_SITE` de s10, à l'identique.
 */
export interface BlogIndex {
  readonly path: string
  readonly pageSize: number
}

/**
 * Le blog, tel que l'application le lit — **de forme identique dans les deux
 * états**.
 */
export interface BlogCatalog {
  readonly articles: readonly BlogArticle[]
  readonly index: BlogIndex | null
}

/** L'état « aucun blog » : celui du module coupé, écrit une fois. */
export const EMPTY_BLOG_CATALOG: BlogCatalog = { articles: [], index: null }

export interface ResolveBlogCatalogInput {
  readonly articles: readonly BlogArticle[]
  readonly pageSize: number
}

export function resolveBlogCatalog({ articles, pageSize }: ResolveBlogCatalogInput): BlogCatalog {
  return { articles, index: { path: BLOG_PATH, pageSize } }
}

/** Ce qu'un écran de liste affiche, une fois la locale, le tag et la page appliqués. */
export interface BlogListView {
  readonly articles: readonly BlogArticle[]
  /** Les tags de la locale servie, dédoublonnés et triés. */
  readonly tags: readonly string[]
  readonly activeTag: string | null
  readonly page: number
  readonly pageCount: number
  /** Le nombre d'articles retenus, avant découpe en pages. */
  readonly total: number
}

export interface BlogListQuery {
  readonly locale: string
  readonly tag: string | null
  readonly page: number
}

const inLocale = (catalog: BlogCatalog, locale: string): readonly BlogArticle[] =>
  catalog.articles.filter((article) => article.locale === locale)

/**
 * La liste, filtrée et paginée.
 *
 * Le filtre de locale vient **avant** tout le reste, et c'est le critère i18n :
 * un article non traduit n'apparaît pas dans cette langue, ni dans la liste, ni
 * dans les tags proposés. Un tag qui n'existe que dans une autre langue ne doit
 * pas être offert au clic.
 *
 * La page est **bornée**, jamais refusée : une URL forgée `?page=99` rend la
 * dernière page. Rendre un 404 sur un numéro de page ferait d'un lien périmé
 * une erreur, alors que le contenu, lui, existe.
 */
export function blogListView(catalog: BlogCatalog, query: BlogListQuery): BlogListView {
  const local = inLocale(catalog, query.locale)
  const tags = [...new Set(local.flatMap((article) => article.tags))].sort((left, right) =>
    left.localeCompare(right),
  )
  const activeTag = query.tag
  const retained =
    activeTag === null ? local : local.filter((article) => article.tags.includes(activeTag))
  const pageSize = catalog.index?.pageSize ?? retained.length
  // Au moins une page, même vide : « page 1 sur 0 » n'a pas de sens à l'écran.
  const pageCount = Math.max(1, Math.ceil(retained.length / Math.max(1, pageSize)))
  const page = Math.min(Math.max(1, Math.trunc(query.page)), pageCount)

  return {
    articles: retained.slice((page - 1) * pageSize, page * pageSize),
    tags,
    activeTag,
    page,
    pageCount,
    total: retained.length,
  }
}

export interface ArticleQuery {
  readonly locale: string
  readonly slug: string
}

/**
 * L'article d'un slug **dans une locale**, ou `null`.
 *
 * `null` est ce qui fera un 404, et c'est le seul comportement correct : servir
 * la version française sur une URL anglaise ferait de deux pages une seule pour
 * un moteur, et mentirait à l'utilisateur sur la langue qu'il a demandée.
 */
export function articleOf(catalog: BlogCatalog, query: ArticleQuery): BlogArticle | null {
  return (
    catalog.articles.find(
      (article) => article.locale === query.locale && article.slug === query.slug,
    ) ?? null
  )
}
