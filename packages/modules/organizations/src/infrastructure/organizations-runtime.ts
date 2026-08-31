import { randomUUID } from 'node:crypto'

import {
  createOrganizationsUseCases,
  type OrganizationsUseCases,
} from '../application/organization-use-cases'
import {
  createDrizzleOrganizationRepository,
  type OrganizationsDatabase,
} from './drizzle-organization-repositories'

/**
 * Le service du module, **construit à la première requête**, pas à l'import.
 *
 * `config/features.ts` charge le contrat du module, et ce fichier est lu par
 * `pnpm ks list` comme par `pnpm db:generate`, qui n'ont pas de base. Les
 * routes reçoivent donc un accès **différé** au service, posé par le point de
 * composition de l'application. Une route appelée avant cette configuration
 * échoue en le disant, elle ne sert rien à moitié — c'est le patron du module
 * `auth`.
 */

export interface ConfigureOrganizationsOptions {
  /** Connexion Drizzle, fournie par le point de composition (jamais lue ici). */
  readonly db: OrganizationsDatabase
  /**
   * Les identifiants publics que le produit se réserve : les routes du système.
   * Le module ne les connaît pas — l'application les dérive et les transmet.
   */
  readonly reservedSlugs: ReadonlySet<string>
  /** Fabrique d'identifiants, pour que la suite puisse en poser de déterministes. */
  readonly generateId?: (prefix: string) => string
}

export interface OrganizationsService {
  readonly useCases: OrganizationsUseCases
}

export class OrganizationsNotConfiguredError extends Error {
  constructor() {
    super(
      'Le module « organizations » n’est pas configuré : le point de composition ' +
        'de l’application doit appeler configureOrganizations() avant de servir une requête.',
    )
    this.name = 'OrganizationsNotConfiguredError'
  }
}

let service: OrganizationsService | null = null
let provider: (() => ConfigureOrganizationsOptions) | null = null

const defaultIdGenerator = (prefix: string): string => `${prefix}_${randomUUID()}`

const build = (options: ConfigureOrganizationsOptions): OrganizationsService => ({
  useCases: createOrganizationsUseCases({
    repository: createDrizzleOrganizationRepository(options.db),
    reservedSlugs: options.reservedSlugs,
    generateId: options.generateId ?? defaultIdGenerator,
  }),
})

/** Construit le service **maintenant**. C'est la forme qu'une suite de tests emploie. */
export function configureOrganizations(
  options: ConfigureOrganizationsOptions,
): OrganizationsService {
  service = build(options)

  return service
}

/**
 * Dit **comment** construire le service, sans le construire.
 *
 * C'est la forme que le point de composition de l'application emploie, et la
 * différence n'est pas cosmétique : le répartiteur de modules prépare les
 * services à **chaque** requête, y compris celles qu'aucune route ne
 * satisfait. Construire aussitôt ouvrirait une connexion à la base pour
 * répondre 404 sur un chemin inconnu — mesuré, `tests/module-off.test.ts`
 * échouait faute de `DATABASE_URL` sur exactement ce cas. Rien n'est donc
 * construit tant qu'une route du module n'est pas réellement servie.
 */
export function provideOrganizations(factory: () => ConfigureOrganizationsOptions): void {
  provider = factory
}

export function requireOrganizationsService(): OrganizationsService {
  if (service !== null) {
    return service
  }

  if (provider === null) {
    throw new OrganizationsNotConfiguredError()
  }

  service = build(provider())

  return service
}

/** Remet le module à son état non configuré. Réservé aux suites de tests. */
export function resetOrganizationsService(): void {
  service = null
  provider = null
}
