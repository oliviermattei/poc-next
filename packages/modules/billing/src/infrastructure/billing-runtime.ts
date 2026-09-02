import { randomUUID } from 'node:crypto'

import type { Payments } from '@repo/ports'

import { createBillingUseCases, type BillingUseCases } from '../application/billing-use-cases'
import type {
  BillingPermission,
  ScopeEmailResolver,
  ScopeResolver,
  SeatCounter,
} from '../application/ports'
import type { BillingCatalogue } from '../domain/offer'
import {
  createDrizzleBillingRepository,
  type BillingDatabase,
} from './drizzle-billing-repositories'

/**
 * Le service du module, **construit à la première requête**, pas à l'import.
 *
 * `config/features.ts` charge le contrat du module, et ce fichier est lu par
 * `pnpm ks list` comme par `pnpm db:generate`, qui n'ont ni base ni fournisseur
 * de paiement. Les routes reçoivent donc un accès **différé** au service, posé
 * par le point de composition de l'application (`apps/web/lib/billing.ts`).
 *
 * C'est le patron de `auth`, `organizations` et `marketing`, repris à
 * l'identique — y compris la distinction entre `configureBilling` (construit
 * maintenant : ce qu'une suite de tests emploie) et `provideBilling` (dit
 * **comment** construire : ce que l'application emploie, pour qu'aucune
 * connexion ne s'ouvre au seul fait qu'une requête a atteint le répartiteur).
 */

export interface ConfigureBillingOptions {
  readonly db: BillingDatabase
  /** Le **port**, jamais un fournisseur : le module ignore qui l'implémente. */
  readonly payments: Payments
  /** Le catalogue **validé**. Le module ne lit pas `config/billing.ts`. */
  readonly catalogue: BillingCatalogue
  /** L'URL publique, jamais déduite d'un en-tête `Host`. */
  readonly appUrl: string
  readonly ownerOf: ScopeResolver
  readonly canManage: BillingPermission
  readonly seatsOf: SeatCounter
  readonly emailOfScope: ScopeEmailResolver
  readonly now?: () => Date
  readonly generateId?: () => string
}

export interface BillingService {
  readonly useCases: BillingUseCases
}

export class BillingNotConfiguredError extends Error {
  constructor() {
    super(
      'Le module « billing » n’est pas configuré : le point de composition ' +
        'de l’application doit appeler provideBilling() avant de servir une requête.',
    )
    this.name = 'BillingNotConfiguredError'
  }
}

let service: BillingService | null = null
let provider: (() => ConfigureBillingOptions) | null = null

const build = (options: ConfigureBillingOptions): BillingService => ({
  useCases: createBillingUseCases({
    repository: createDrizzleBillingRepository(options.db),
    payments: options.payments,
    catalogue: options.catalogue,
    appUrl: options.appUrl,
    ownerOf: options.ownerOf,
    canManage: options.canManage,
    seatsOf: options.seatsOf,
    emailOfScope: options.emailOfScope,
    now: options.now ?? (() => new Date()),
    generateId: options.generateId ?? (() => randomUUID()),
  }),
})

/** Construit le service **maintenant**. C'est la forme qu'une suite de tests emploie. */
export function configureBilling(options: ConfigureBillingOptions): BillingService {
  service = build(options)

  return service
}

/**
 * Dit **comment** construire le service, sans le construire.
 *
 * Le répartiteur de modules prépare les services à **chaque** requête, y
 * compris celles qu'aucune route ne satisfait : construire aussitôt ouvrirait
 * une connexion pour répondre 404 sur un chemin inconnu.
 */
export function provideBilling(factory: () => ConfigureBillingOptions): void {
  provider = factory
}

export function requireBillingService(): BillingService {
  if (service !== null) {
    return service
  }

  if (provider === null) {
    throw new BillingNotConfiguredError()
  }

  service = build(provider())

  return service
}

/** Remet le module à son état non configuré. Réservé aux suites de tests. */
export function resetBillingService(): void {
  service = null
  provider = null
}
