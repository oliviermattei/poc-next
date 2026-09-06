import {
  createOnboardingUseCases,
  type OnboardingUseCases,
} from '../application/onboarding-use-cases'
import type { OnboardingStep } from '../domain/onboarding'
import {
  createDrizzleOnboardingRepository,
  type OnboardingDatabase,
} from './drizzle-onboarding-repository'

/**
 * Le service du module, **construit à la première requête**, pas à l'import.
 *
 * `config/features.ts` charge le contrat du module, et ce fichier est lu par
 * `pnpm ks list` comme par `pnpm db:generate`, qui n'ont pas de base. Les
 * routes reçoivent donc un accès **différé** au service, posé par le point de
 * composition de l'application (`apps/web/lib/onboarding.ts`). C'est le patron
 * d'`auth`, `organizations`, `marketing`, `storage` et `notifications`, repris
 * à l'identique.
 */

export interface ConfigureOnboardingOptions {
  /** Connexion Drizzle, fournie par le point de composition (jamais lue ici). */
  readonly db: OnboardingDatabase
  /**
   * **Les étapes proposées à un compte** — ce que le module ne peut pas savoir.
   *
   * Elles sont dérivées des modules montés *et* de la donnée réelle du compte
   * (son nom, ses appartenances, ses droits). Le module ne connaît ni `auth`,
   * ni `organizations`, ni la facturation : il reçoit la fonction, exactement
   * comme `storage` reçoit `readableScopes`.
   */
  readonly stepsOf: (userId: string) => Promise<readonly OnboardingStep[]>
  readonly now?: () => Date
}

export interface OnboardingService {
  readonly useCases: OnboardingUseCases
}

export class OnboardingNotConfiguredError extends Error {
  constructor() {
    super(
      'Le module « onboarding » n’est pas configuré : le point de composition ' +
        'de l’application doit appeler provideOnboarding() avant de servir une requête.',
    )
    this.name = 'OnboardingNotConfiguredError'
  }
}

let service: OnboardingService | null = null
let provider: (() => ConfigureOnboardingOptions) | null = null

const build = (options: ConfigureOnboardingOptions): OnboardingService => ({
  useCases: createOnboardingUseCases({
    progress: createDrizzleOnboardingRepository(options.db),
    stepsOf: options.stepsOf,
    now: options.now ?? (() => new Date()),
  }),
})

/** Construit le service **maintenant**. C'est la forme qu'une suite de tests emploie. */
export function configureOnboarding(options: ConfigureOnboardingOptions): OnboardingService {
  service = build(options)

  return service
}

/**
 * Dit **comment** construire le service, sans le construire.
 *
 * Le répartiteur de modules prépare les services à **chaque** requête, y
 * compris celles qu'aucune route ne satisfait : construire aussitôt ouvrirait
 * une connexion à la base pour répondre 404 sur un chemin inconnu.
 */
export function provideOnboarding(factory: () => ConfigureOnboardingOptions): void {
  provider = factory
}

export function requireOnboardingService(): OnboardingService {
  if (service !== null) {
    return service
  }

  if (provider === null) {
    throw new OnboardingNotConfiguredError()
  }

  service = build(provider())

  return service
}

/** Remet le module à son état non configuré. Réservé aux suites de tests. */
export function resetOnboardingService(): void {
  service = null
  provider = null
}
