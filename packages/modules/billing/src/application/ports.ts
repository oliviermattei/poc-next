import type { ModuleScope } from '@repo/core'

import type { SubscriptionStatus } from '../domain/subscription'

/**
 * Les **ports** du module (ADR 006) : ce dont les cas d'usage ont besoin, dit
 * par eux, sans savoir qui l'implémente. `infrastructure/` les branche sur
 * Drizzle et sur le port `Payments` de s19.
 *
 * Aucun de ces ports ne connaît une requête HTTP, un en-tête ou une table.
 */

/** Le lien entre un périmètre du produit et un client du fournisseur. */
export interface BillingCustomerRecord {
  readonly id: string
  readonly scopeKind: ModuleScope['kind']
  readonly scopeId: string
  readonly providerCustomerId: string
}

/** L'abonnement tel que le cache local le connaît. */
export interface SubscriptionRecord {
  readonly providerSubscriptionId: string
  readonly billingCustomerId: string
  readonly offerId: string | null
  readonly priceId: string
  readonly status: SubscriptionStatus
  readonly quantity: number
  readonly currentPeriodEnd: Date
  readonly cancelAtPeriodEnd: boolean
  readonly trialEnd: Date | null
  readonly lastEventAt: Date
  readonly lastEventId: string
}

/** Ce qu'un événement demande d'écrire, exprimé en **données**, jamais en requêtes. */
export type BillingEffect =
  /** Rien à écrire : événement non traité, ou client inconnu. */
  | { readonly kind: 'none' }
  | { readonly kind: 'subscription'; readonly write: SubscriptionWrite }
  | {
      readonly kind: 'payment_failed'
      readonly providerSubscriptionId: string
      readonly lastEventAt: Date
      readonly lastEventId: string
    }

export interface SubscriptionWrite {
  readonly providerSubscriptionId: string
  readonly billingCustomerId: string
  readonly offerId: string | null
  readonly priceId: string
  readonly status: SubscriptionStatus
  readonly quantity: number
  readonly currentPeriodEnd: Date
  readonly cancelAtPeriodEnd: boolean
  readonly trialEnd: Date | null
  readonly lastEventAt: Date
  readonly lastEventId: string
}

export interface BillingRepository {
  /** Le client du fournisseur rattaché à ce périmètre, ou `null`. */
  customerForScope(scope: ModuleScope): Promise<BillingCustomerRecord | null>

  /**
   * Rattache un client du fournisseur à un périmètre, ou rend celui qui l'est
   * déjà.
   *
   * **Une contrainte d'unicité, jamais une lecture préalable**
   * (`docs/reliability.md` §1) : deux ouvertures de checkout simultanées
   * créeraient sinon deux clients pour la même organisation, donc deux
   * abonnements payés.
   */
  linkCustomer(input: {
    readonly id: string
    readonly scope: ModuleScope
    readonly providerCustomerId: string
  }): Promise<BillingCustomerRecord>

  /** Le périmètre auquel ce client du fournisseur appartient, ou `null`. */
  customerByProviderId(providerCustomerId: string): Promise<BillingCustomerRecord | null>

  /**
   * **Tous** les abonnements de ce client, du plus récemment changé au plus
   * ancien.
   *
   * Il y en a plusieurs dès qu'un client annule puis se réabonne, et le cache
   * garde l'historique — le fournisseur le garde aussi, et la réconciliation le
   * relit. Rendre « l'abonnement du client » depuis cette couche demanderait de
   * décider lequel : c'est une règle, elle vit dans le `domain`
   * (`currentSubscriptionOf`), et ce port ne fait que **lire dans un ordre
   * total qui ne dépend pas du moteur**.
   *
   * Le défaut que cela ferme : `limit(1)` sans `order by` rendait la ligne la
   * plus anciennement insérée, donc l'abonnement annulé — « expiré » à l'écran
   * pour un client qui venait de payer (constat F1 de la revue).
   */
  subscriptionsOfCustomer(billingCustomerId: string): Promise<readonly SubscriptionRecord[]>

  /**
   * Journalise l'événement **et** applique son effet, dans la même transaction.
   *
   * Rend `false` quand l'identifiant était déjà journalisé : c'est un rejeu, et
   * il ne produit aucun effet supplémentaire. La décision vient d'une contrainte
   * d'unicité en base, pas d'une lecture — la lecture laisserait la fenêtre où
   * deux livraisons simultanées passent toutes les deux.
   *
   * Une même transaction pour les deux : un effet en échec annule aussi le
   * journal, et le rejeu du fournisseur reste possible. Sans cela, un événement
   * à demi traité serait refusé pour toujours.
   */
  applyEvent(input: {
    readonly eventId: string
    readonly type: string
    readonly effect: BillingEffect
  }): Promise<boolean>

  /** Tous les clients connus. Point d'entrée de la réconciliation. */
  listCustomers(): Promise<readonly BillingCustomerRecord[]>

  /**
   * Réécrit l'état d'un client depuis ce que le fournisseur détient, et rend le
   * nombre de lignes **réellement** changées.
   *
   * Le compte n'est pas décoratif : c'est lui qui rend la réconciliation
   * observable comme idempotente — une seconde exécution rend zéro
   * (`docs/reliability.md` §1).
   *
   * **Elle ajoute et met à jour ; elle n'efface jamais.** Une liste vide ne
   * vide pas le cache, et c'est délibéré : le fournisseur peut répondre
   * partiellement, une lecture peut échouer à moitié, et une réconciliation qui
   * effacerait sur un silence transformerait une panne de tiers en perte
   * d'accès pour un client qui paie. Retirer un abonnement est le travail d'un
   * événement `customer.subscription.deleted`, qui dit ce qui s'est passé.
   */
  replaceSubscriptions(input: {
    readonly billingCustomerId: string
    readonly subscriptions: readonly SubscriptionWrite[]
  }): Promise<number>

  /** Efface les données de facturation d'un périmètre. Rend le nombre de clients effacés. */
  deleteScope(scope: ModuleScope): Promise<number>
}

/**
 * Le périmètre propriétaire de la donnée, résolu par **la fonction unique** de
 * l'application (`docs/architecture.md`, `docs/security.md` §3).
 *
 * Injecté : selon que le module `organizations` est activé, une donnée
 * appartient à une organisation ou à un compte, et le module `billing` ne doit
 * pas connaître la différence. C'est aussi ce qui rend impossible de viser le
 * périmètre d'un autre : aucune route n'accepte d'identifiant de périmètre.
 */
export type ScopeResolver = (session: {
  readonly userId: string
  readonly roles: readonly string[]
}) => Promise<ModuleScope | null>

/**
 * Qui a le droit de gérer la facturation de ce périmètre (ADR 034).
 *
 * Injecté pour la même raison : la matrice rôle × action appartient au module
 * `organizations`, et elle s'écrit **une fois**. Module coupé, le compte est
 * propriétaire de sa donnée et tout lui est permis.
 */
export type BillingPermission = (scope: ModuleScope, userId: string) => Promise<boolean>

/**
 * Le nombre de sièges d'un périmètre, résolu **côté serveur**.
 *
 * Jamais reçu du navigateur : une quantité pilotée par le client est un prix
 * piloté par le client. Périmètre compte, ou module `organizations` coupé : 1.
 *
 * Elle reçoit aussi l'appelant, et ce n'est pas une commodité : le module
 * `organizations` répond « les membres de l'organisation courante **de ce
 * compte** », jamais « les membres de l'organisation numéro X ». Demander la
 * seconde forme ouvrirait une lecture par identifiant, c'est-à-dire exactement
 * le chemin de fuite que la porte de lecture de s15 ferme.
 */
export type SeatCounter = (scope: ModuleScope, userId: string) => Promise<number>

/**
 * L'adresse à laquelle le fournisseur écrira, ou `null`. Sert à créer le client.
 *
 * Elle reçoit **aussi l'appelant**, comme `canManage` et `seatsOf`, et pour la
 * même raison : une organisation n'a pas d'adresse à elle, et c'est le compte
 * qui ouvre le checkout qui recevra les reçus. Le module, lui, ne sait pas d'où
 * l'adresse vient — il ne connaît ni `auth`, ni `organizations`.
 */
export type ScopeEmailResolver = (scope: ModuleScope, userId: string) => Promise<string | null>
