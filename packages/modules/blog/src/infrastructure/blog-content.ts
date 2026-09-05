import type { PublicUrl, PublicUrlContribution } from '@repo/core'

import { articlePath, type BlogCatalog } from '../application/blog-catalog'

/**
 * **Ce que le blog donne à indexer et à syndiquer** (s53, ADR 054).
 *
 * Le catalogue n'existe pas à l'import de ce module : il est lu sur le disque
 * par le point de composition de l'application (`apps/web/lib/blog.ts`), qui
 * seul connaît le répertoire de contenu et les langues **servies**. Le module
 * reçoit donc un accès **différé**, exactement comme `marketing` reçoit le
 * sien pour ses routes — ce fichier est chargé par `config/features.ts`, donc
 * par `pnpm ks list` et `pnpm db:generate`, qui n'ont ni disque de contenu ni
 * `APP_URL`.
 *
 * `url` est une fonction et non une chaîne : elle appelle `resolveSiteUrl()` à
 * l'invocation, et `APP_URL` n'est validée qu'à l'exécution. Une URL de site
 * capturée à la construction du contenu serait celle du build, c'est-à-dire
 * `undefined` en intégration continue.
 */
export interface BlogContent {
  readonly catalog: BlogCatalog
  /** Les langues **servies** par l'application, dans l'ordre de `config/i18n.ts`. */
  readonly locales: readonly string[]
  readonly defaultLocale: string
  /** L'URL absolue d'un chemin interne dans une langue. */
  readonly url: (pathname: string, locale: string) => string
}

let provider: (() => BlogContent) | null = null

export class BlogContentNotProvidedError extends Error {
  constructor() {
    super(
      'Le contenu du module « blog » n’a pas été fourni : le point de composition ' +
        'de l’application doit appeler provideBlogContent() avant de servir le flux, ' +
        'le plan de site ou le robots.txt.',
    )
    this.name = 'BlogContentNotProvidedError'
  }
}

/** Dit **où** lire le catalogue, sans le lire. Appelé par `apps/web/lib/blog.ts`. */
export function provideBlogContent(factory: () => BlogContent): void {
  provider = factory
}

/** Remet le module à son état non fourni. Réservé aux suites de tests. */
export function resetBlogContent(): void {
  provider = null
}

/**
 * Le contenu, ou un refus **nommé**.
 *
 * Lever plutôt que rendre un catalogue vide : un blog silencieusement sans
 * article est indiscernable d'un blog coupé, et le plan de site perdrait ses
 * URL sans qu'aucune commande ne le dise.
 */
export function requireBlogContent(): BlogContent {
  if (provider === null) {
    throw new BlogContentNotProvidedError()
  }

  return provider()
}

/**
 * La liste et les articles, **un par slug**, avec les langues où ils existent.
 *
 * La liste est déclarée ici et non déduite de l'entrée de navigation du module :
 * `public` est un niveau de **protection**, pas une décision d'indexation, et
 * trois des cinq entrées publiques du dépôt (`/sign-in`, `/pricing`, une route
 * d'API) n'ont rien à faire dans un index (ADR 054). Le module dit ce qu'il
 * publie.
 *
 * Les articles, eux, sont la moitié de la story qu'aucune clé existante ne
 * pouvait porter : ils n'existent qu'après lecture du contenu.
 *
 * Un slug traduit dans une seule langue n'est annoncé que dans celle-là :
 * publier l'autre URL reviendrait à référencer une page qui répond 404 — la
 * page d'article ne sert jamais la version d'une autre langue à la place de
 * celle qui manque.
 */
export const blogPublicUrls: PublicUrlContribution = (context) => {
  const { catalog } = requireBlogContent()

  if (catalog.index === null) {
    // Le blog n'est pas monté : ses deux écrans répondent 404, et il n'y a rien
    // à annoncer. La même donnée décide des deux, jamais un identifiant de module.
    return []
  }

  const bySlug = new Map<string, { locales: string[]; lastModified: string }>()

  for (const article of catalog.articles) {
    if (!context.locales.includes(article.locale)) {
      continue
    }

    const seen = bySlug.get(article.slug)

    if (seen === undefined) {
      bySlug.set(article.slug, { locales: [article.locale], lastModified: article.date })

      continue
    }

    seen.locales.push(article.locale)
    // La plus récente des traductions : c'est la dernière fois que **cette
    // page** a changé, quelle que soit la langue par laquelle on l'atteint.
    seen.lastModified =
      article.date > seen.lastModified ? article.date : seen.lastModified
  }

  return [
    { path: catalog.index.path, locales: context.locales },
    ...[...bySlug.entries()].map(
      ([slug, entry]): PublicUrl => ({
        path: articlePath(slug),
        locales: entry.locales,
        lastModified: entry.lastModified,
      }),
    ),
  ]
}
