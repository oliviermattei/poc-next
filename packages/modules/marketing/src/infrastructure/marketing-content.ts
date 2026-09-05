import type { PublicUrlContribution } from '@repo/core'

import type { MarketingSite } from '../application/marketing-site'

/**
 * **Ce que le site public donne à indexer** (s53, ADR 054).
 *
 * Le module contribue à la quinzième clé du contrat comme n'importe quel autre,
 * et c'est la décision que le plan de s53 assume : le laisser sur son chemin
 * nommé aurait gardé `app/robots.ts` et `app/sitemap.ts` important
 * `@repo/module-marketing`, c'est-à-dire un critère tenu à moitié à l'endroit
 * exact où il compte.
 *
 * Le **contenu** de la contribution ne peut pas être connu à l'import : les
 * chemins publics dérivent de `config/marketing.ts`, que le module ne lit pas
 * — c'est le point de composition de l'application qui le valide et le lui
 * donne. Même patron d'accès différé que `marketing-runtime.ts`, et pour la
 * même raison : ce fichier est chargé par `config/features.ts`, donc par
 * `pnpm ks list` et `pnpm db:generate`.
 */

let provider: (() => MarketingSite) | null = null

export class MarketingContentNotProvidedError extends Error {
  constructor() {
    super(
      'Le contenu du module « marketing » n’a pas été fourni : le point de ' +
        'composition de l’application doit appeler provideMarketingContent() avant ' +
        'de construire le plan de site ou le robots.txt.',
    )
    this.name = 'MarketingContentNotProvidedError'
  }
}

/** Dit **où** lire le site public, sans le lire. Appelé par `apps/web/lib/marketing.ts`. */
export function provideMarketingContent(factory: () => MarketingSite): void {
  provider = factory
}

/** Remet le module à son état non fourni. Réservé aux suites de tests. */
export function resetMarketingContent(): void {
  provider = null
}

/**
 * Les chemins publics du site, dans chaque langue servie.
 *
 * **Elle lève plutôt que de rendre une liste vide.** Une contribution silencieuse
 * à zéro URL est indiscernable d'un site public coupé : le `sitemap.xml` perdrait
 * ses pages et le `robots.txt` cesserait de les autoriser sans qu'aucune commande
 * ne le dise. C'est le même choix que `MarketingNotConfiguredError` pour les
 * routes.
 */
export const marketingPublicUrls: PublicUrlContribution = (context) => {
  if (provider === null) {
    throw new MarketingContentNotProvidedError()
  }

  return provider().publicPaths.map((path) => ({ path, locales: context.locales }))
}
