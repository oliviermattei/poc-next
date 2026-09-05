import type { ModuleScope } from '@repo/core'

import type { BillingScopeKind } from '../domain/guest'
import type { PurchaseStatus } from '../domain/purchase'
import type { SubscriptionStatus } from '../domain/subscription'

/**
 * Les **ports** du module (ADR 006) : ce dont les cas d'usage ont besoin, dit
 * par eux, sans savoir qui l'implémente. `infrastructure/` les branche sur
 * Drizzle et sur le port `Payments` de s19.
 *
 * Aucun de ces ports ne connaît une requête HTTP, un en-tête ou une table.
 */

/**
 * Le lien entre un périmètre du produit et un client du fournisseur.
 *
 * `scopeKind` porte **trois** valeurs et non deux (ADR 047) : `user`,
 * `organization`, et `guest` — le périmètre d'un visiteur qui paie sans compte,
 * qui n'existe qu'au stockage. `ModuleScope` en garde deux, et
 * `accountScopeOfCustomer` (`domain/guest.ts`) est le seul passage de l'un à
 * l'autre : il refuse l'invité plutôt que d'en faire un compte imaginaire.
 */
export interface BillingCustomerRecord {
  readonly id: string
  readonly scopeKind: BillingScopeKind
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

/**
 * L'achat unique tel que le cache local le connaît (ADR 038).
 *
 * `offerId` n'est **pas** nullable, contrairement à celui d'un abonnement : il
 * est résolu du catalogue à l'ouverture du checkout, et c'est justement parce
 * que la confirmation ne le dirait pas que la ligne est écrite d'abord. Une
 * offre retirée du catalogue laisse la valeur en place ; c'est l'écran qui sait
 * dire qu'il ne la connaît plus.
 */
/**
 * Un essai qui se termine, tel que la relance a besoin de le connaître (s33).
 *
 * Il porte le **périmètre**, pas une adresse : `billing` ne connaît ni `auth` ni
 * `organizations`, et c'est le point de composition de l'application qui sait
 * résoudre un destinataire.
 */
export interface EndingTrial {
  readonly providerSubscriptionId: string
  readonly offerId: string | null
  readonly status: SubscriptionStatus
  readonly trialEnd: Date | null
  readonly scopeKind: BillingScopeKind
  readonly scopeId: string
}

export interface PurchaseRecord {
  readonly id: string
  readonly billingCustomerId: string
  readonly offerId: string
  readonly priceId: string
  readonly providerSessionId: string
  readonly providerPaymentId: string | null
  readonly status: PurchaseStatus
  /** Ce qui a été **prélevé**, connu à la confirmation seulement. */
  readonly amount: number | null
  readonly currency: string | null
  readonly purchasedAt: Date | null
  readonly refundedAt: Date | null
  readonly lastEventAt: Date | null
  readonly lastEventId: string | null
}

/**
 * Ce que la réconciliation a **lu** du fournisseur pour une session donnée.
 *
 * Des faits, pas une décision : le statut qu'ils imposent — ou l'absence de
 * statut quand ils n'en imposent aucun — est tranché par
 * `reconciledPurchaseStatus`, dans le `domain`, qui a besoin de l'état stocké
 * pour le faire. Porter ici un statut déjà décidé obligeait l'appelant à
 * trancher sans cet état, et c'est ce qui a fait ré-accorder un achat remboursé
 * dont la charge était introuvable (constat m1 de la revue de s20).
 */
export interface PurchaseReconcileWrite {
  readonly providerSessionId: string
  readonly providerPaymentId: string | null
  /** Le paiement est-il encaissé chez le fournisseur ? */
  readonly paid: boolean
  /** La charge relue, ou `null` quand le fournisseur ne la donne pas. */
  readonly chargedAmount: number | null
  readonly amountRefunded: number
  readonly amount: number | null
  readonly currency: string | null
  readonly at: Date
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
  /**
   * La **promotion** d'un achat en attente (ADR 038 §1).
   *
   * Une mise à jour, jamais une insertion : la ligne existe depuis l'ouverture
   * du checkout, et c'est elle qui porte l'offre. Une session inconnue n'écrit
   * rien — l'événement reste journalisé, donc non rejoué.
   */
  | {
      readonly kind: 'purchase_paid'
      readonly providerSessionId: string
      readonly providerPaymentId: string | null
      readonly amount: number | null
      readonly currency: string | null
      readonly paidAt: Date
      readonly lastEventAt: Date
      readonly lastEventId: string
    }
  /**
   * La **révocation** d'un achat remboursé, retrouvé par son paiement — la
   * charge ne porte jamais la session.
   *
   * Elle n'est produite que lorsque le domaine a jugé le remboursement total
   * (`refundRevokesPurchase`) : un geste partiel journalise et n'écrit rien.
   */
  | {
      readonly kind: 'purchase_refunded'
      readonly providerPaymentId: string
      readonly refundedAt: Date
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

  /**
   * Rattache un client du fournisseur à un périmètre **invité** (ADR 047).
   *
   * Distincte de `linkCustomer`, et la distinction est le point : `linkCustomer`
   * prend un `ModuleScope`, qui n'a que deux formes et n'en aura pas de
   * troisième. Le périmètre invité n'existe qu'ici, en deux colonnes de texte.
   *
   * Elle est appelée **à l'ouverture du tunnel**, comme sa voisine : c'est ce
   * qui préserve la garantie d'ordre de l'ADR 034 pour un visiteur qui n'a pas
   * encore de compte.
   */
  linkGuestCustomer(input: {
    readonly id: string
    readonly guestScopeId: string
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
   * **Les essais qui se terminent dans cette fenêtre**, avec le périmètre à qui
   * ils appartiennent (s33, critère 7).
   *
   * C'est la seule lecture de ce port qui ne parte pas d'un client : la relance
   * d'essai est une tâche planifiée, elle n'a ni session ni périmètre en entrée.
   * Elle rend le périmètre pour que l'appelant sache **à qui** écrire, sans que
   * ce module ait à connaître `auth` ni `organizations` (ADR 034).
   *
   * La fenêtre est bornée des deux côtés — jamais « avant telle date » : une
   * borne unique ramènerait tous les essais passés à chaque exécution, et la
   * relance partirait en boucle.
   */
  trialsEndingBetween(input: {
    readonly from: Date
    readonly to: Date
  }): Promise<readonly EndingTrial[]>

  /**
   * **Tous** les achats uniques de ce client, du plus récemment ouvert au plus
   * ancien, dans un ordre **total** qui ne dépend pas du moteur — la même
   * discipline que `subscriptionsOfCustomer` (ADR 037).
   */
  purchasesOfCustomer(billingCustomerId: string): Promise<readonly PurchaseRecord[]>

  /**
   * Ouvre — ou rouvre — l'achat d'une offre pour ce client, et rend la ligne.
   *
   * **Une contrainte d'unicité, jamais une lecture préalable**
   * (`docs/reliability.md` §1) : `(billing_customer_id, offer_id)` est unique,
   * si bien que deux ouvertures simultanées du même achat convergent sur une
   * ligne. C'est l'invariant central de la story, et il est tenu par le moteur.
   *
   * Une ligne **déjà payée n'est jamais rétrogradée** : le refus applicatif
   * (`already_purchased`) est au-dessus, mais une course entre une confirmation
   * et une seconde ouverture ne doit pas effacer un achat encaissé.
   */
  openPurchase(input: {
    readonly id: string
    readonly billingCustomerId: string
    readonly offerId: string
    readonly priceId: string
    readonly providerSessionId: string
  }): Promise<PurchaseRecord>

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
    /**
     * La **promotion** d'une ligne invitée vers un compte (ADR 047), appliquée
     * dans la **même transaction** que le journal et l'effet.
     *
     * Elle s'ajoute à l'effet plutôt que d'en être un : un achat unique invité
     * porte les deux à la fois — la ligne d'achat passe à « payé » *et* la
     * ligne client change de périmètre —, et un événement ne journalise qu'une
     * fois.
     */
    readonly promotion?: GuestPromotion | null
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

  /**
   * Réécrit l'état des achats **déjà connus** d'un client, et rend le nombre de
   * lignes réellement changées.
   *
   * Elle ne crée rien : une session que nous n'avons pas ouverte n'a pas
   * d'offre, et il n'y en a aucune à deviner (ADR 038). Elle n'efface pas
   * davantage — une lecture partielle du fournisseur ne doit pas couper un
   * client qui a payé.
   */
  reconcilePurchases(input: {
    readonly billingCustomerId: string
    readonly purchases: readonly PurchaseReconcileWrite[]
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
 * Le nombre de membres d'un périmètre **sans appelant** — la lecture dont la
 * réconciliation a besoin (s23).
 *
 * Distincte de `SeatCounter`, et la distinction est le point : `SeatCounter`
 * répond « les membres de l'organisation **courante de ce compte** », ce qui
 * suppose un compte. `pnpm billing:reconcile` n'en a pas : elle parcourt les
 * clients du fournisseur et doit compter les membres des organisations qu'ils
 * désignent. Fusionner les deux obligerait à inventer un appelant, ou à ouvrir
 * une lecture par identifiant sur une route — la porte que s15 ferme.
 *
 * `null` veut dire **« aucun nombre »**, jamais « zéro » : périmètre compte,
 * module `organizations` coupé, organisation inconnue. C'est
 * `billableSeats` (`domain/seats.ts`) qui en fait une quantité, ou pas.
 */
export type ScopeSeats = (scope: ModuleScope) => Promise<number | null>

/**
 * L'adresse à laquelle le fournisseur écrira, ou `null`. Sert à créer le client.
 *
 * Elle reçoit **aussi l'appelant**, comme `canManage` et `seatsOf`, et pour la
 * même raison : une organisation n'a pas d'adresse à elle, et c'est le compte
 * qui ouvre le checkout qui recevra les reçus. Le module, lui, ne sait pas d'où
 * l'adresse vient — il ne connaît ni `auth`, ni `organizations`.
 */
export type ScopeEmailResolver = (scope: ModuleScope, userId: string) => Promise<string | null>

/**
 * **La promotion d'une ligne invitée vers un compte** (ADR 047).
 *
 * Une mise à jour, jamais une insertion : la ligne existe depuis l'ouverture du
 * tunnel, et `provider_customer_id` — sur lequel tout événement résout son
 * propriétaire — ne change pas. C'est ce qui préserve intacte la garantie
 * d'ordre de l'ADR 034.
 */
export interface GuestPromotion {
  readonly providerCustomerId: string
  readonly userId: string
}

/**
 * **Le compteur partagé entre instances de la route publique de checkout**
 * (`docs/security.md` §7).
 *
 * `hit` **incrémente et rend le compte** en une seule opération : lire puis
 * écrire laisserait deux instances observer le même compte et le dépasser
 * toutes les deux. La fenêtre est décidée par l'appelant — le domaine
 * l'aligne — et l'implémentation condense la clé avant de l'écrire.
 */
export interface CheckoutThrottle {
  /**
   * `max` voyage **avec le seau**, comme chez `marketing` : cette route en a
   * deux — l'appelant et le global — et ils n'ont pas le même seuil. Le porter
   * une seule fois à la construction rendait l'un des deux faux pour qui lirait
   * le verdict du port (constat m5 de la re-revue de s28). Ce module décide avec
   * `exceedsCheckoutRateLimit` sur le compte rendu ; la valeur n'en doit pas
   * moins être juste.
   */
  hit(input: {
    readonly bucket: string
    readonly max: number
    readonly windowStart: Date
  }): Promise<number>

  /**
   * Efface les seaux dont **leur propre** fenêtre est close à cet instant.
   *
   * Le paramètre est l'**instant présent**, pas une borne : le magasin est
   * partagé depuis s28 et ses seaux n'ont pas la même durée, si bien qu'une
   * borne « efface tout ce qui précède » effaçait les seaux longs encore ouverts
   * des autres routes (constat C1 de la revue de s28). C'est la ligne qui porte
   * son échéance ; un instant passé ne peut que retarder la récupération.
   *
   * Sans lui, la table ne se vide jamais : un seau par identifiant d'appelant,
   * et l'identifiant vient d'un en-tête que le client écrit lui-même. Il rend
   * le compte parce qu'une purge se **prouve en l'exécutant**
   * (`docs/reliability.md` §1), pas en la déclarant.
   */
  sweep(now: Date): Promise<number>
}

/** Le compte auquel un paiement invité est rattaché (ADR 047). */
export interface GuestAccount {
  readonly userId: string
  /** Le compte **vient d'être créé**, ou existait déjà (critère 4 de s24). */
  readonly created: boolean
}

/**
 * **Le compte d'un paiement invité, résolu par le point de composition.**
 *
 * Le module `billing` ne déclare aucun `requires` (ADR 034) et ne connaît pas
 * `auth` : créer un compte depuis le webhook ne peut donc pas se faire ici.
 * C'est la même forme que `seatsOf` et `seatSync` (s23) — le module dit ce dont
 * il a besoin, l'application sait comment le fournir.
 *
 * `accountFor` est **idempotent par l'adresse** : un événement rejoué retrouve
 * le compte au lieu d'en fabriquer un second (critère 6). `sendAccessLink`
 * n'est appelée que lorsque la promotion a **réellement** eu lieu, et c'est
 * elle qui décide de la nature du lien — jamais le module, qui ne sait pas ce
 * qu'est un mot de passe.
 */
export interface GuestAccounts {
  accountFor(input: { readonly email: string }): Promise<GuestAccount | null>
  sendAccessLink(input: {
    readonly account: GuestAccount
    readonly email: string
  }): Promise<void>
}
