import { marketingSitemapEntries } from '@repo/module-marketing'
import type { MetadataRoute } from 'next'

import { localeRouting } from '../lib/locale-routing'
import { marketingSite } from '../lib/marketing'
import { absoluteUrl, resolveSiteUrl } from '../lib/site-url'

/**
 * `sitemap.xml` — les pages publiques, et **rien d'autre**.
 *
 * Site public coupé, `marketingSite.publicPaths` est vide : le fichier ne
 * référence rien. C'est le sixième critère de la story, et il est obtenu sans
 * condition sur un module — la liste vide fait tout le travail.
 *
 * `force-dynamic` n'est pas une commodité. Ce fichier est un route handler que
 * Next met en cache par défaut, donc **évalué pendant `next build`** — où
 * `getEnv()` rend l'environnement sans le valider et où la CI ne pose aucune
 * `APP_URL` (`.github/workflows/ci.yml`). Un plan de site figé au build
 * porterait donc `undefined` dans chacune de ses URL. Évalué à la requête, il
 * lit une variable réellement validée.
 */
export const dynamic = 'force-dynamic'

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = resolveSiteUrl()

  return marketingSitemapEntries({
    paths: marketingSite.publicPaths,
    locales: localeRouting.locales,
    defaultLocale: localeRouting.defaultLocale,
    // Le chemin passe par la **même** mise en forme que les liens de l'écran :
    // module `i18n` coupé, `publicPath` est l'identité et le plan de site ne
    // porte qu'une langue, sans qu'une ligne ici ne le sache.
    url: (pathname, locale) => absoluteUrl(localeRouting.publicPath(pathname, locale), siteUrl),
  }).map((entry) => ({
    url: entry.url,
    alternates: { languages: entry.alternates },
  }))
}
