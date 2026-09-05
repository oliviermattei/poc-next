import { MODULE_ROUTE_PREFIX, type ModuleRoute } from '@repo/core'
import { z } from 'zod'

import { articlePath, BLOG_PATH, type BlogCatalog } from '../application/blog-catalog'
import { renderBlogFeed, type FeedArticle } from '../domain/feed'
import { BLOG_MODULE_ID } from '../domain/message-keys'

/**
 * **Le flux, en route de module** (s53).
 *
 * C'est ce qui rend le critère « module coupé, aucun flux » **dérivé** plutôt
 * que conditionnel : la route n'est dans aucune table de routage quand le
 * module n'est pas activé, et le répartiteur répond 404 comme sur un chemin
 * inventé, sans qu'une ligne ne nomme un module. Le blog déclarait `routes: []`
 * jusqu'ici ; c'est sa première.
 *
 * `GET`, et **publique** : un flux se lit sans compte. Publique veut aussi dire
 * **limitée** — `dispatchModuleRequest` applique la politique `default` à toute
 * route publique, qu'elle le déclare ou non (ADR 050).
 *
 * La route reçoit un **accès différé** au contenu, comme les formulaires
 * publics de `marketing` reçoivent le leur : ce fichier est atteint par
 * `config/features.ts`, donc par `pnpm ks list` et `pnpm db:generate`, qui n'ont
 * ni catalogue d'articles ni `APP_URL`.
 */

const FEED_PATH = `/${BLOG_MODULE_ID}/feed.xml`

/** Le chemin **monté** du flux. Écrit une fois, lu par l'écran et par les tests. */
export const blogFeedPath = (): string => `${MODULE_ROUTE_PREFIX}${FEED_PATH}`

/**
 * Ce que le flux a besoin de savoir, et que le module ne peut pas se procurer.
 *
 * `messages` sont les catalogues **du module**, ceux que le contrat déclare :
 * le titre et la description du flux sont ceux de la liste, et les traduire une
 * seconde fois ici les ferait diverger de l'écran.
 */
export interface BlogFeedDependencies {
  readonly content: () => {
    readonly catalog: BlogCatalog
    readonly locales: readonly string[]
    readonly defaultLocale: string
    readonly url: (pathname: string, locale: string) => string
  }
  readonly messages: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/**
 * La langue demandée — **une entrée, donc validée** (`docs/security.md` §4).
 *
 * Elle est confrontée aux langues **servies**, jamais crue : une valeur
 * arbitraire entrerait sinon dans le document rendu (balise `<language>`) et
 * dans les URL construites. Ce qui n'est pas servi retombe sur la langue par
 * défaut plutôt que de refuser : un lien de flux périmé n'a pas à casser.
 */
const requestedLocale = (request: Request, served: readonly string[], fallback: string): string => {
  const asked = new URL(request.url).searchParams.get('locale')
  const parsed = z
    .string()
    .refine((value) => served.includes(value))
    .safeParse(asked)

  return parsed.success ? parsed.data : fallback
}

export function createBlogFeedRoutes(
  dependencies: BlogFeedDependencies,
): readonly ModuleRoute[] {
  return [
    {
      method: 'GET',
      path: FEED_PATH,
      protection: { level: 'public' },
      /**
       * **Aucune garde « module coupé » ici, et c'est mesuré.**
       *
       * La première écriture en portait une (`catalog.index === null` → 404).
       * La mutation qui la retire laisse les 19 cas de `tests/blog.test.ts`
       * verts, parce que la branche est **inatteignable** : coupée, cette route
       * n'est dans aucune table de routage et le répartiteur a déjà répondu 404
       * — c'est exactement ce que le critère demande, et une condition de plus
       * ne l'aurait pas rendu plus vrai. Elle a donc été retirée plutôt que
       * couverte par un cas décoratif.
       */
      handler: (request) => {
        const { catalog, locales, defaultLocale, url } = dependencies.content()

        const locale = requestedLocale(request, locales, defaultLocale)
        const catalogue = dependencies.messages[locale] ?? {}
        const articles: readonly FeedArticle[] = catalog.articles
          .filter((article) => article.locale === locale)
          .map((article) => ({
            title: article.title,
            description: article.description,
            url: url(articlePath(article.slug), locale),
            date: article.date,
            author: article.author,
          }))

        const body = renderBlogFeed({
          // Les mêmes textes que l'écran de liste, pris dans le catalogue du
          // module : un flux qui s'intitulerait autrement que sa page serait
          // deux produits pour un lecteur.
          title: catalogue['list.title'] ?? BLOG_MODULE_ID,
          description: catalogue['list.description'] ?? '',
          locale,
          siteUrl: url(BLOG_PATH, locale),
          // Le flux **se désigne exactement** : le chemin monté ne porte aucun
          // préfixe de langue (`/api…` n'en reçoit pas), c'est donc le
          // paramètre qui distingue les deux documents. Un `atom:link` qui
          // pointerait vers l'autre langue ferait suivre le mauvais flux à un
          // agrégateur.
          feedUrl: `${url(blogFeedPath(), locale)}${locale === defaultLocale ? '' : `?locale=${locale}`}`,
          articles,
        })

        return new Response(body, {
          status: 200,
          headers: {
            // `charset` explicite : le document déclare UTF-8 dans son prologue,
            // et un analyseur qui suivrait l'en-tête HTTP sans jeu de caractères
            // retomberait sur le sien.
            'content-type': 'application/rss+xml; charset=utf-8',
          },
        })
      },
    },
  ]
}
