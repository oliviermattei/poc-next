import { renderFeed, type FeedItem } from '@repo/core'

/**
 * Le flux du blog — **une enveloppe**, depuis s31.
 *
 * Le constructeur lui-même a quitté ce fichier pour `@repo/core`
 * (`syndication.ts`, ADR 065) : le changelog en avait besoin, et le laisser ici
 * lui aurait imposé `requires: ['blog']`. Ce qui reste ici est le vocabulaire
 * du blog — un *article* a un auteur —, et rien de la mécanique RSS.
 *
 * L'extraction se mesure à ce que `tests/blog.test.ts` n'a pas bougé : les cas
 * de s53 valent tels quels, analyseur de flux tiers compris. S'ils avaient dû
 * changer, l'extraction aurait changé le comportement.
 */

export interface FeedArticle extends FeedItem {
  /** Un article a toujours un auteur, là où `FeedItem` le rend facultatif. */
  readonly author: string
}

export interface BlogFeedInput {
  readonly title: string
  readonly description: string
  readonly locale: string
  /** L'URL absolue de la liste, dans la langue du flux. */
  readonly siteUrl: string
  /** L'URL absolue du flux lui-même : RSS demande qu'il se désigne (`atom:link`). */
  readonly feedUrl: string
  readonly articles: readonly FeedArticle[]
}

export function renderBlogFeed(input: BlogFeedInput): string {
  const { articles, ...channel } = input

  return renderFeed({ ...channel, items: articles })
}
