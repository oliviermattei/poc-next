import { randomUUID } from 'node:crypto'

import type { Payments, RateLimiter } from '@repo/ports'

import { createBillingUseCases, type BillingUseCases } from '../application/billing-use-cases'
import type {
  BillingPermission,
  GuestAccounts,
  ScopeEmailResolver,
  ScopeResolver,
  ScopeSeats,
  SeatCounter,
} from '../application/ports'
import { GUEST_CHECKOUT_RATE_LIMIT } from '../domain/checkout-throttle'
import type { BillingCatalogue } from '../domain/offer'
import {
  createDrizzleBillingRepository,
  type BillingDatabase,
} from './drizzle-billing-repositories'
import { createGuestScopeIdGenerator } from './guest-scope-id'
import { createSharedCheckoutThrottle } from './shared-checkout-throttle'

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
  /**
   * Le compteur **partagé** du dépôt (s28, ADR 050).
   *
   * Obligatoire : facultatif, il aurait laissé un point de composition retomber
   * silencieusement sur un compteur local, c'est-à-dire sur la duplication que
   * cette story supprime.
   */
  readonly rateLimiter: RateLimiter
  /** Le catalogue **validé**. Le module ne lit pas `config/billing.ts`. */
  readonly catalogue: BillingCatalogue
  /** L'URL publique, jamais déduite d'un en-tête `Host`. */
  readonly appUrl: string
  readonly ownerOf: ScopeResolver
  readonly canManage: BillingPermission
  readonly seatsOf: SeatCounter
  /**
   * Le nombre de membres d'un périmètre, **sans appelant** (s23).
   *
   * Obligatoire, jamais optionnelle avec un repli : un point de composition qui
   * l'oublierait laisserait `pnpm billing:reconcile` incapable de corriger une
   * quantité, et cette dérive ne se découvre qu'à la facture du client.
   */
  readonly seatsOfScope: ScopeSeats
  readonly emailOfScope: ScopeEmailResolver
  /**
   * **Le compte d'un paiement invité** (s24, ADR 047).
   *
   * Obligatoire, jamais optionnelle avec un repli : un point de composition qui
   * l'oublierait laisserait la route publique de checkout ouverte et le webhook
   * incapable de rattacher le paiement à qui que ce soit — un client prélevé
   * sans compte, et rien pour le dire.
   */
  readonly guestAccounts: GuestAccounts
  /**
   * **Où repart un visiteur quand le canal anonyme est saturé** (constat F3 de
   * la revue de s24).
   *
   * Obligatoire pour la même raison que la précédente : un point de
   * composition qui l'oublierait laisserait la seule dégradation de la route
   * publique sans destination, et le seau global ne pourrait plus que refuser.
   */
  readonly guestFallbackUrl: (input: {
    readonly offerId: string
    readonly locale: string | null
  }) => string
  readonly now?: () => Date
  readonly generateId?: () => string
  /**
   * L'identifiant d'un périmètre invité (ADR 047).
   *
   * Par défaut, **un tirage cryptographique de trente-deux octets**. Il est
   * distinct de `generateId` — que les suites remplacent volontiers par un
   * compteur — parce qu'un identifiant invité prévisible permettrait de viser
   * la ligne d'un autre, et de faire promouvoir son paiement vers son propre
   * compte.
   */
  readonly generateGuestScopeId?: () => string
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
    seatsOfScope: options.seatsOfScope,
    emailOfScope: options.emailOfScope,
    // s28 : le compteur est celui du port partagé. `billing_checkout_throttle`
    // n'est plus écrite — la règle des deux seaux, elle, reste ici.
    throttle: createSharedCheckoutThrottle({
      limiter: options.rateLimiter,
      windowSeconds: GUEST_CHECKOUT_RATE_LIMIT.windowSeconds,
    }),
    guestFallbackUrl: options.guestFallbackUrl,
    guestAccounts: options.guestAccounts,
    now: options.now ?? (() => new Date()),
    generateId: options.generateId ?? (() => randomUUID()),
    generateGuestScopeId: options.generateGuestScopeId ?? createGuestScopeIdGenerator(),
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
