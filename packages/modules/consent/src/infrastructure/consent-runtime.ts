import {
  createConsentUseCases,
  type ConsentDependencies,
  type ConsentUseCases,
} from '../application/consent-use-cases'

/**
 * Le service du module, **construit à la première requête**, pas à l'import.
 *
 * Même patron que `marketing`, `auth` et `organizations`, et pour la même
 * raison : `config/features.ts` charge le contrat du module, et ce fichier est
 * lu par `pnpm ks list` comme par `pnpm db:generate`, qui ne connaissent aucun
 * script non essentiel. La liste vient du point de composition de l'application
 * (`apps/web/lib/consent.ts`), qui seul sait quels modules sont activés.
 */

export interface ConsentService {
  readonly useCases: ConsentUseCases
}

export class ConsentNotConfiguredError extends Error {
  constructor() {
    super(
      'Le module « consent » n’est pas configuré : le point de composition ' +
        'de l’application doit appeler provideConsent() avant de servir une requête.',
    )
    this.name = 'ConsentNotConfiguredError'
  }
}

let service: ConsentService | null = null
let provider: (() => ConsentDependencies) | null = null

const build = (dependencies: ConsentDependencies): ConsentService => ({
  useCases: createConsentUseCases(dependencies),
})

/** Construit le service **maintenant**. C'est la forme qu'une suite de tests emploie. */
export function configureConsent(dependencies: ConsentDependencies): ConsentService {
  service = build(dependencies)

  return service
}

/** Dit **comment** construire le service, sans le construire. */
export function provideConsent(factory: () => ConsentDependencies): void {
  provider = factory
}

export function requireConsentService(): ConsentService {
  if (service !== null) {
    return service
  }

  if (provider === null) {
    throw new ConsentNotConfiguredError()
  }

  service = build(provider())

  return service
}

/** Remet le module à son état non configuré. Réservé aux suites de tests. */
export function resetConsentService(): void {
  service = null
  provider = null
}
