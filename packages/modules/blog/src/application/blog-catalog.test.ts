import { describe, expect, it } from 'vitest'

import type { BlogArticle } from '../domain/article'
import {
  EMPTY_BLOG_CATALOG,
  articleOf,
  articlePath,
  blogListView,
  resolveBlogCatalog,
} from './blog-catalog'

/**
 * Le catalogue d'articles, tel que les écrans le lisent.
 *
 * Il a **la même forme dans les deux états** — module activé, module coupé —
 * comme `MarketingSite` (s10) et `LocaleRouting` (s09). C'est ce qui évite à la
 * page de porter une condition « si le blog existe » : elle lit `index`, qui
 * est `null` quand le module n'est pas monté, et répond 404. Une condition sur
 * l'identifiant d'un module dans du code appelant serait un défaut, pas une
 * précaution (`apps/web/AGENTS.md`).
 */
const anArticle = (
  slug: string,
  locale: string,
  date: string,
  tags: readonly string[],
): BlogArticle => ({
  slug,
  locale,
  title: `Titre de ${slug}`,
  description: `Description de ${slug}`,
  date,
  author: 'Olivier Mattei',
  tags,
})

const ARTICLES: readonly BlogArticle[] = [
  anArticle('un', 'fr', '2026-03-12', ['ingénierie']),
  anArticle('deux', 'fr', '2026-03-11', ['ingénierie', 'coulisses']),
  anArticle('trois', 'fr', '2026-03-10', ['produit']),
  anArticle('quatre', 'fr', '2026-03-09', ['produit']),
  anArticle('cinq', 'fr', '2026-03-08', ['coulisses']),
  anArticle('un', 'en', '2026-03-12', ['engineering']),
]

const catalog = resolveBlogCatalog({ articles: ARTICLES, pageSize: 2 })

const view = (input: { locale: string; tag?: string | null; page?: number }) =>
  blogListView(catalog, { locale: input.locale, tag: input.tag ?? null, page: input.page ?? 1 })

describe('le catalogue d’articles', () => {
  it('n’est pas un blog quand le module n’est pas monté', () => {
    // `index` à `null` est une **donnée**, pas une condition : c'est elle qui
    // fait répondre 404 à `/blog` et à `/blog/<slug>`, sans qu'aucune ligne
    // d'écran ne nomme un module.
    expect(EMPTY_BLOG_CATALOG.index).toBeNull()
    expect(EMPTY_BLOG_CATALOG.articles).toEqual([])
  })

  it('est un blog quand il est monté, même sans aucun article', () => {
    // La distinction que le design demande : « aucun article pour l'instant »
    // est un `EmptyState`, pas un 404.
    expect(resolveBlogCatalog({ articles: [], pageSize: 2 }).index).not.toBeNull()
  })

  describe('la liste', () => {
    it('ne rend que les articles de la locale servie', () => {
      expect(view({ locale: 'en' }).articles.map((found) => found.slug)).toEqual(['un'])
    })

    it('ne rend rien dans une locale où rien n’est traduit', () => {
      // Le critère i18n vu par l'utilisateur : la liste est plus courte, elle
      // n'est pas en panne. Zéro article dans cette locale est un état vide
      // légitime, pas une erreur.
      expect(view({ locale: 'de' }).articles).toEqual([])
      expect(view({ locale: 'de' }).total).toBe(0)
    })

    it('borne la page à la première quand on demande en-deçà', () => {
      expect(view({ locale: 'fr', page: 0 }).page).toBe(1)
      expect(view({ locale: 'fr', page: -3 }).articles.map((found) => found.slug)).toEqual([
        'un',
        'deux',
      ])
    })

    it('borne la page à la dernière quand on demande au-delà', () => {
      const found = view({ locale: 'fr', page: 99 })

      expect(found.page).toBe(3)
      expect(found.pageCount).toBe(3)
      expect(found.articles.map((article) => article.slug)).toEqual(['cinq'])
    })

    it('découpe en pages de la taille demandée', () => {
      expect(view({ locale: 'fr', page: 2 }).articles.map((found) => found.slug)).toEqual([
        'trois',
        'quatre',
      ])
    })

    it('garde une page quand il n’y a aucun article', () => {
      // `pageCount: 0` ferait une pagination « page 1 sur 0 ».
      expect(view({ locale: 'de' }).pageCount).toBe(1)
    })

    it('propose les tags de la locale servie, dédoublonnés et triés', () => {
      expect(view({ locale: 'fr' }).tags).toEqual(['coulisses', 'ingénierie', 'produit'])
      expect(view({ locale: 'en' }).tags).toEqual(['engineering'])
    })

    it('réduit la liste au tag demandé, et le compte avec', () => {
      const found = view({ locale: 'fr', tag: 'produit' })

      expect(found.articles.map((article) => article.slug)).toEqual(['trois', 'quatre'])
      expect(found.total).toBe(2)
      expect(found.activeTag).toBe('produit')
    })

    it('rend une liste vide pour un tag que personne n’a écrit', () => {
      // Le second état vide du design : « aucun article dans ce tag ». Il doit
      // être atteignable, y compris par une URL forgée.
      const found = view({ locale: 'fr', tag: 'inconnu' })

      expect(found.articles).toEqual([])
      expect(found.activeTag).toBe('inconnu')
    })

    it('pagine à l’intérieur du tag, pas à côté', () => {
      expect(
        blogListView(resolveBlogCatalog({ articles: ARTICLES, pageSize: 1 }), {
          locale: 'fr',
          tag: 'ingénierie',
          page: 2,
        }).articles.map((found) => found.slug),
      ).toEqual(['deux'])
    })
  })

  describe('un article', () => {
    it('se trouve par son slug dans sa locale', () => {
      expect(articleOf(catalog, { locale: 'fr', slug: 'deux' })?.title).toBe('Titre de deux')
    })

    it('n’existe pas dans une locale où il n’est pas traduit', () => {
      // C'est la moitié « article » du critère i18n : `deux` n'existe qu'en
      // français, et l'URL anglaise doit répondre 404, jamais servir le
      // français à la place.
      expect(articleOf(catalog, { locale: 'en', slug: 'deux' })).toBeNull()
    })

    it('n’existe pas quand le module n’est pas monté', () => {
      expect(articleOf(EMPTY_BLOG_CATALOG, { locale: 'fr', slug: 'un' })).toBeNull()
    })

    it('porte un chemin dérivé de son slug', () => {
      expect(articlePath('un-test-vert')).toBe('/blog/un-test-vert')
    })
  })
})
