import { marketingRobotsPolicy } from '@repo/module-marketing'
import type { MetadataRoute } from 'next'

import { localeRouting } from '../lib/locale-routing'
import { marketingSite } from '../lib/marketing'
import { absoluteUrl, resolveSiteUrl } from '../lib/site-url'

/**
 * `robots.txt` — dérivé des **mêmes** chemins publics que le plan de site.
 *
 * Deux listes distinctes divergeraient au premier document légal ajouté : un
 * `robots.txt` qui interdit une page que le plan de site annonce est une
 * contradiction que personne ne remarque.
 *
 * Le sens est « interdire, puis autoriser ce qui est public » : l'inverse
 * laisserait indexer chaque écran ajouté par une story suivante sans que
 * personne ne l'ait décidé. Site public coupé, tout est interdit et aucun plan
 * de site n'est annoncé.
 *
 * `force-dynamic` pour la même raison que `sitemap.ts` : `APP_URL` n'est
 * validée qu'à l'exécution.
 */
export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  const siteUrl = resolveSiteUrl()

  // Les chemins tels qu'un robot les rencontre : préfixés de leur langue quand
  // le module `i18n` est monté, nus sinon.
  const allowed = marketingSite.publicPaths.flatMap((pathname) =>
    localeRouting.locales.map((locale) => localeRouting.publicPath(pathname, locale)),
  )

  const policy = marketingRobotsPolicy({
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
