import { robotsPolicy } from '@repo/core'
import type { MetadataRoute } from 'next'

import { localeRouting } from '../lib/locale-routing'
import { publicUrls, servedPath } from '../lib/public-urls'
import { absoluteUrl, resolveSiteUrl } from '../lib/site-url'

/**
 * `robots.txt` — dérivé des **mêmes** URL que le plan de site.
 *
 * Deux listes distinctes divergeraient au premier document légal ajouté : un
 * `robots.txt` qui interdit une page que le plan de site annonce est une
 * contradiction que personne ne remarque.
 *
 * Le sens est « interdire, puis autoriser ce qui est public » : l'inverse
 * laisserait indexer chaque écran ajouté par une story suivante sans que
 * personne ne l'ait décidé. Aucun module ne contribuant, tout est interdit et
 * aucun plan de site n'est annoncé.
 *
 * **Ce fichier ne connaît aucun module** (s53, critère 4) : ce qu'il autorise
 * vient de `publicUrls()`, donc de ce que les modules activés **déclarent**
 * publier. Un écran dont la navigation est publique — `/sign-in`, `/pricing` —
 * n'y entre pas pour autant : `public` est un niveau de protection, pas une
 * décision d'indexation (ADR 054, `docs/security.md` §7).
 *
 * `force-dynamic` pour la même raison que `sitemap.ts` : `APP_URL` n'est
 * validée qu'à l'exécution.
 */
export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  const siteUrl = resolveSiteUrl()

  // Les chemins tels qu'un robot les rencontre : préfixés de leur langue quand
  // le module `i18n` est monté, nus sinon — et seulement dans les langues où la
  // page existe, un article traduit dans une seule n'ayant pas d'autre URL.
  // Dédoublonné : un chemin qui ne porte **pas** de préfixe de langue rendrait
  // la même URL une fois par langue servie, donc autant de directives `Allow`
  // identiques dans le fichier.
  const allowed = [
    ...new Set(
      publicUrls().flatMap((entry) =>
        entry.locales
          .filter((locale) => localeRouting.locales.includes(locale))
          .map((locale) => servedPath(entry.path, locale)),
      ),
    ),
  ]

  const policy = robotsPolicy({
    allowed,
    sitemapUrl: absoluteUrl('/sitemap.xml', siteUrl),
  })

  return {
    rules: {
      userAgent: policy.rules.userAgent,
      ...(policy.rules.allow === undefined ? {} : { allow: [...policy.rules.allow] }),
      disallow: [...policy.rules.disallow],
    },
    ...(policy.sitemap === undefined ? {} : { sitemap: policy.sitemap }),
  }
}
