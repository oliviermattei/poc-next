import type { PublicUrl, PublicUrlContribution } from '@repo/core'

import { docsNavigationTree, type DocsCatalog } from '../application/docs-catalog'

/**
 * **Ce que la documentation donne à indexer** (ADR 054, quinzième clé du
 * contrat, livrée par s53).
 *
 * Le catalogue n'existe pas à l'import de ce module : il est lu sur le disque
 * par le point de composition de l'application (`apps/web/lib/docs.ts`), qui
 * seul connaît le répertoire de contenu et les langues **servies**. Le module
 * reçoit donc un accès **différé**, exactement comme `blog` et `marketing` —
 * ce fichier est chargé par `config/features.ts`, donc par `pnpm ks list` et
 * `pnpm db:generate`, qui n'ont pas de disque de contenu.
 */
export interface DocsContent {
  readonly catalog: DocsCatalog
}

let provider: (() => DocsContent) | null = null

export class DocsContentNotProvidedError extends Error {
  constructor() {
    super(
      'Le contenu du module « docs » n’a pas été fourni : le point de composition ' +
        'de l’application doit appeler provideDocsContent() avant de servir le plan de site.',
    )
    this.name = 'DocsContentNotProvidedError'
  }
}

/** Dit **où** lire le catalogue, sans le lire. Appelé par `apps/web/lib/docs.ts`. */
export function provideDocsContent(factory: () => DocsContent): void {
  provider = factory
}

/** Remet le module à son état non fourni. Réservé aux suites de tests. */
export function resetDocsContent(): void {
  provider = null
}

/**
 * Le contenu, ou un refus **nommé**.
 *
 * Lever plutôt que rendre un catalogue vide : une documentation silencieusement
 * sans page est indiscernable d'une documentation coupée, et le plan de site
 * perdrait ses URL sans qu'aucune commande ne le dise.
 */
export function requireDocsContent(): DocsContent {
  if (provider === null) {
    throw new DocsContentNotProvidedError()
  }

  return provider()
}

/**
 * Les pages, **une par emplacement dans l'arbre**, dans toutes les langues
 * servies.
 *
 * C'est **l'inverse du blog**, et la différence n'est pas cosmétique : un
 * article traduit dans une seule langue n'est annoncé que dans celle-là, parce
 * que l'autre URL répondrait 404. Une page de documentation, elle, est servie
 * dans **toutes** les langues — non traduite, elle retombe sur la langue par
 * défaut avec une mention. Annoncer moins de langues qu'on n'en sert priverait
 * un moteur des URL qui existent.
 *
 * L'entrée de la documentation elle-même est déclarée, et non déduite de
 * l'entrée de navigation du module : `public` est un niveau de **protection**,
 * pas une décision d'indexation (ADR 054).
 */
export const docsPublicUrls: PublicUrlContribution = (context) => {
  const { catalog } = requireDocsContent()

  if (catalog.index === null) {
    // Le module n'est pas monté : ses écrans répondent 404, et il n'y a rien à
    // annoncer. La même donnée décide des deux, jamais un identifiant de module.
    return []
  }

  /*
   * **Dérivé de l'arbre**, et pas de l'ordre où le disque a rendu les fichiers :
   * ce qui est annoncé est exactement ce qui est navigable, dans le même ordre.
   * Deux dérivations donneraient deux listes, et c'est celle du plan de site que
   * personne ne regarde.
   */
  return [
    { path: catalog.index.path, locales: context.locales },
    ...docsNavigationTree(catalog, catalog.index.defaultLocale).flatMap((section) =>
      section.pages.map((page): PublicUrl => ({ path: page.href, locales: context.locales })),
    ),
  ]
}
