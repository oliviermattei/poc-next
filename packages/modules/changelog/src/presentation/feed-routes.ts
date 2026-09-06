import { MODULE_ROUTE_PREFIX, renderFeed, type FeedItem, type ModuleRoute } from '@repo/core'
import { z } from 'zod'

import { CHANGELOG_PATH, type ChangelogCatalog } from '../application/changelog-catalog'
import { CHANGELOG_MODULE_ID } from '../domain/message-keys'

/**
 * **Le flux des nouveautés, en route de module.**
 *
 * C'est ce qui rend le critère « module coupé, aucun flux » **dérivé** plutôt
 * que conditionnel : la route n'est dans aucune table de routage quand le module
 * n'est pas activé, et le répartiteur répond 404 comme sur un chemin inventé,
 * sans qu'une ligne ne nomme un module.
 *
 * `GET`, et **publique** : un flux se lit sans compte. Publique veut aussi dire
 * **limitée** — `dispatchModuleRequest` applique la politique `default` à toute
 * route publique, qu'elle le déclare ou non (ADR 050).
 *
 * Le document est construit par `renderFeed` de `@repo/core` (ADR 065), le même
 * primitif que celui du blog : le changelog ne dépend pas du blog, et les deux
 * flux ne peuvent pas diverger sur l'échappement.
 */

const FEED_PATH = `/${CHANGELOG_MODULE_ID}/feed.xml`

/** Le chemin **monté** du flux. Écrit une fois, lu par l'écran et par les tests. */
export const changelogFeedPath = (): string => `${MODULE_ROUTE_PREFIX}${FEED_PATH}`

/**
 * Ce que le flux a besoin de savoir, et que le module ne peut pas se procurer.
 *
 * `messages` sont les catalogues **du module** : le titre et la description du
 * flux sont ceux de la page, et les traduire une seconde fois ici les ferait
 * diverger de l'écran.
 */
export interface ChangelogFeedDependencies {
  readonly content: () => {
    readonly catalog: ChangelogCatalog
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

export function createChangelogFeedRoutes(
  dependencies: ChangelogFeedDependencies,
): readonly ModuleRoute[] {
  return [
    {
      method: 'GET',
      path: FEED_PATH,
      protection: { level: 'public' },
      /**
       * **Aucune garde « module coupé » ici, et c'est le même constat qu'en
       * s53** : coupée, cette route n'est dans aucune table de routage et le
       * répartiteur a déjà répondu 404. Une condition de plus serait une branche
       * inatteignable, donc un cas de test décoratif.
       */
      handler: (request) => {
        const { catalog, locales, defaultLocale, url } = dependencies.content()

        const locale = requestedLocale(request, locales, defaultLocale)
        const catalogue = dependencies.messages[locale] ?? {}
        const pageUrl = url(CHANGELOG_PATH, locale)
        /**
         * **Chaque entrée pointe vers la page, avec son ancre.**
         *
         * Le changelog n'a qu'une page : donner à toutes les entrées la même URL
         * ferait dédoublonner le flux par un lecteur, qui n'en afficherait
         * qu'une (le `guid` **est** l'adresse). L'ancre est l'identifiant de
         * l'entrée, celui que l'écran pose sur son article.
         */
        const items: readonly FeedItem[] = catalog.entries
          .filter((entry) => entry.locale === locale)
          .map((entry) => ({
            title: entry.title,
            description: entry.description,
            url: `${pageUrl}#${entry.slug}`,
            date: entry.date,
          }))

        const body = renderFeed({
          title: catalogue['list.title'] ?? CHANGELOG_MODULE_ID,
          description: catalogue['list.description'] ?? '',
          locale,
          siteUrl: pageUrl,
          // Le flux **se désigne exactement** : le chemin monté ne porte aucun
          // préfixe de langue (`/api…` n'en reçoit pas), c'est donc le paramètre
          // qui distingue les deux documents.
          feedUrl: `${url(changelogFeedPath(), locale)}${
            locale === defaultLocale ? '' : `?locale=${locale}`
          }`,
          items,
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
