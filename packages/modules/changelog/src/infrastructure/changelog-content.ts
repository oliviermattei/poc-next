import type { PublicUrl, PublicUrlContribution } from '@repo/core'

import type { ChangelogCatalog } from '../application/changelog-catalog'

/**
 * **Ce que le changelog donne à indexer et à syndiquer** (ADR 054).
 *
 * Le catalogue n'existe pas à l'import de ce module : il est lu sur le disque
 * par le point de composition de l'application (`apps/web/lib/changelog.ts`),
 * qui seul connaît le répertoire de contenu et les langues **servies**. Le
 * module reçoit donc un accès **différé**, comme le blog — ce fichier est
 * chargé par `config/features.ts`, donc par `pnpm ks list` et
 * `pnpm db:generate`, qui n'ont ni disque de contenu ni `APP_URL`.
 */
export interface ChangelogContent {
  readonly catalog: ChangelogCatalog
  /** Les langues **servies** par l'application, dans l'ordre de `config/i18n.ts`. */
  readonly locales: readonly string[]
  readonly defaultLocale: string
  /** L'URL absolue d'un chemin interne dans une langue. */
  readonly url: (pathname: string, locale: string) => string
}

let provider: (() => ChangelogContent) | null = null

export class ChangelogContentNotProvidedError extends Error {
  constructor() {
    super(
      'Le contenu du module « changelog » n’a pas été fourni : le point de composition ' +
        'de l’application doit appeler provideChangelogContent() avant de servir le flux ' +
        'ou le plan de site.',
    )
    this.name = 'ChangelogContentNotProvidedError'
  }
}

/** Dit **où** lire le catalogue, sans le lire. Appelé par `apps/web/lib/changelog.ts`. */
export function provideChangelogContent(factory: () => ChangelogContent): void {
  provider = factory
}

/** Remet le module à son état non fourni. Réservé aux suites de tests. */
export function resetChangelogContent(): void {
  provider = null
}

/**
 * Le contenu, ou un refus **nommé**.
 *
 * Lever plutôt que rendre un catalogue vide : un changelog silencieusement sans
 * entrée est indiscernable d'un changelog coupé, et le plan de site perdrait son
 * URL sans qu'aucune commande ne le dise.
 */
export function requireChangelogContent(): ChangelogContent {
  if (provider === null) {
    throw new ChangelogContentNotProvidedError()
  }

  return provider()
}

/**
 * **Une seule URL : la page**, et les langues où elle a quelque chose à dire.
 *
 * Les entrées n'ont pas d'adresse propre — elles sont toutes sur la même page,
 * ce qui est la façon dont un changelog se lit. Annoncer une URL par entrée
 * publierait des adresses qui répondent 404.
 *
 * `lastModified` est la date de l'entrée la plus récente : c'est la dernière
 * fois que **cette page** a changé, quelle que soit la langue par laquelle on
 * l'atteint.
 */
export const changelogPublicUrls: PublicUrlContribution = (context) => {
  const { catalog } = requireChangelogContent()

  if (catalog.index === null) {
    // Le changelog n'est pas monté : sa page répond 404, et il n'y a rien à
    // annoncer. La même donnée décide des deux, jamais un identifiant de module.
    return []
  }

  const served = catalog.entries.filter((entry) => context.locales.includes(entry.locale))

  if (served.length === 0) {
    return []
  }

  const url: PublicUrl = {
    path: catalog.index.path,
    locales: context.locales.filter((locale) =>
      served.some((entry) => entry.locale === locale),
    ),
    lastModified: served
      .map((entry) => entry.date)
      .reduce((latest, date) => (date > latest ? date : latest)),
  }

  return [url]
}
