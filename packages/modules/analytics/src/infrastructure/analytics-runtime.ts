import type { Monitoring } from '@repo/ports'

import type { AnalyticsBrowserSettings } from '../domain/analytics-script'

/**
 * Le service du module, **construit à la première requête**, pas à l'import.
 *
 * Même patron que `consent`, `marketing` et `auth`, et pour la même raison :
 * `config/features.ts` charge le contrat du module, et ce fichier est lu par
 * `pnpm ks list` comme par `pnpm db:generate`, qui n'ont ni DSN ni réseau. Les
 * services viennent du point de composition de l'application
 * (`apps/web/lib/analytics.ts`), seul à savoir ce qui est configuré.
 *
 * **Un seul câblage pour les deux routes**, et c'est délibéré : le point de
 * composition en oublierait un des deux, et la revue a mesuré qu'un câblage
 * oublié ne rougissait nulle part. Ici, `tests/analytics.test.ts` prouve la
 * ligne `prepareAnalytics()` de `lib/module-services.ts` sur la réponse de la
 * route — 204 avec le câblage, **500** sans.
 */

export class AnalyticsNotConfiguredError extends Error {
  constructor() {
    super(
      'Le module « analytics » n’est pas configuré : le point de composition ' +
        'de l’application doit appeler provideAnalytics() avant de servir une requête.',
    )
    this.name = 'AnalyticsNotConfiguredError'
  }
}

/** Ce que l'application procure au module, et que rien dans une requête ne procure. */
export interface AnalyticsServices {
  /** Le port par lequel une erreur atteint le fournisseur. */
  readonly monitoring: Monitoring
  /** La configuration du navigateur, ou `null` quand aucune clé n'est posée. */
  readonly browser: AnalyticsBrowserSettings | null
}

let services: AnalyticsServices | null = null
let provider: (() => AnalyticsServices) | null = null

/**
 * Dit **comment** obtenir les services, sans les construire — la forme de
 * `provideConsent`, et pour une raison mesurée : `prepareModuleServices()` est
 * appelée à **chaque** requête, y compris celles qu'aucune route ne sert.
 * Construire ici lirait l'environnement — donc lèverait sans `DATABASE_URL` —
 * pour répondre 404 sur un chemin inconnu, ce que `tests/module-off.test.ts` et
 * `tests/organizations.test.ts` mesurent depuis s15.
 */
export function provideAnalytics(factory: () => AnalyticsServices): void {
  provider = factory
}

const requireServices = (): AnalyticsServices => {
  if (services !== null) {
    return services
  }

  if (provider === null) {
    throw new AnalyticsNotConfiguredError()
  }

  services = provider()

  return services
}

export function requireMonitoring(): Monitoring {
  return requireServices().monitoring
}

export function requireBrowserSettings(): AnalyticsBrowserSettings | null {
  return requireServices().browser
}

/** Remet le module à son état non configuré. Réservé aux suites de tests. */
export function resetAnalyticsService(): void {
  services = null
  provider = null
}
