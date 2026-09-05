import { sitemapEntries } from '@repo/core'
import type { MetadataRoute } from 'next'

import { localeRouting } from '../lib/locale-routing'
import { publicUrls, servedPath } from '../lib/public-urls'
import { absoluteUrl, resolveSiteUrl } from '../lib/site-url'

/**
 * `sitemap.xml` — les pages publiques, et **rien d'autre**.
 *
 * **Ce fichier ne connaît aucun module** (s53, critère 4), et c'est le point de
 * la story : il lit `publicUrls()`, que le registre dérive de la quinzième clé
 * du contrat. Un module de contenu ajouté demain entre dans le plan de site
 * sans qu'une ligne d'ici ne bouge ; un module coupé n'est pas dans le
 * registre, donc ne contribue rien — le fichier ne référence alors rien, sans
 * qu'aucune condition ne porte sur un identifiant de module.
 *
 * `force-dynamic` n'est pas une commodité. Ce fichier est un route handler que
 * Next met en cache par défaut, donc **évalué pendant `next build`** — où
 * `getEnv()` rend l'environnement sans le valider et où la CI ne pose aucune
 * `APP_URL` (`.github/workflows/ci.yml`). Un plan de site figé au build
 * porterait donc `undefined` dans chacune de ses URL, et gèlerait le catalogue
 * d'articles avec elles. Évalué à la requête, il lit une variable réellement
 * validée.
 */
export const dynamic = 'force-dynamic'

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = resolveSiteUrl()

  return sitemapEntries({
    entries: publicUrls(),
    defaultLocale: localeRouting.defaultLocale,
    // Le chemin passe par la **même** mise en forme que les liens de l'écran :
    // module `i18n` coupé, `publicPath` est l'identité et le plan de site ne
    // porte qu'une langue, sans qu'une ligne ici ne le sache.
    url: (pathname, locale) => absoluteUrl(servedPath(pathname, locale), siteUrl),
  }).map((entry) => ({
    url: entry.url,
    alternates: { languages: entry.alternates },
    // La date du frontmatter quand le module en donne une : `lastModified` est
    // un champ que le format prévoit, et une page qui ne change pas n'a rien à
    // en dire.
    ...(entry.lastModified === undefined ? {} : { lastModified: entry.lastModified }),
  }))
}
