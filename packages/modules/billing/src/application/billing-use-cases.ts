import type { ModuleExportPayload, ModuleScope } from '@repo/core'
import type { CheckoutMode, PaymentEvent, Payments, PaymentStatus } from '@repo/ports'

import {
  formatOfferPrice,
  offerById,
  offerForPrice,
  type BillingCatalogue,
  type BillingInterval,
  type BillingMode,
  type BillingOffer,
} from '../domain/offer'
import {
  grantsBillingAccess,
  purchaseGrantsAccess,
  refundRevokesPurchase,
} from '../domain/purchase'
import {
  appliesAfter,
  currentSubscriptionOf,
  displayStateOf,
  grantsAccess,
  type BillingDisplayState,
  type SubscriptionStatus,
} from '../domain/subscription'
import type {
  BillingEffect,
  BillingPermission,
  BillingRepository,
  PurchaseRecord,
  ScopeEmailResolver,
  ScopeResolver,
  SeatCounter,
  SubscriptionWrite,
} from './ports'

/**
 * Les cas d'usage de la facturation.
 *
 * Ils orchestrent : le `domain` décide (qui a accès, ce que l'écran dit, quel
 * événement s'applique), les ports exécutent. Aucun SDK, aucune requête SQL,
 * aucune connaissance de HTTP.
 *
 * **Trois invariants portés ici**, et chacun se paie s'il saute :
 *
 * 1. **le prix ne vient jamais du client.** L'appelant envoie un identifiant
 *    d'offre ; le prix, la devise et la quantité sont résolus par le serveur ;
 * 2. **le rattachement précède le checkout** (ADR 034) : la ligne client est
 *    écrite avant que l'URL ne parte au navigateur, si bien qu'un événement
 *    arrivé en désordre retrouve son propriétaire ;
 * 3. **la permission est consultée avant d'écrire ou d'appeler** : masquer un
 *    bouton n'est pas une permission (`docs/security.md` §3).
 */

/** La correspondance entre les statuts du port et ceux du domaine. */
const DOMAIN_STATUS: Readonly<Record<PaymentStatus, SubscriptionStatus>> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
  incomplete: 'incomplete',
  paused: 'paused',
}

export type CheckoutRefusal =
  | 'forbidden'
  | 'unknown_offer'
  | 'already_subscribed'
  /**
   * L'offre unique est **déjà possédée** — l'invariant central de s20.
   *
   * Distinct d'`already_subscribed`, et ce n'est pas un détail : le sixième
   * critère de la story veut qu'un abonné puisse acheter à vie et qu'un
   * acheteur à vie puisse s'abonner. Une garde unique fondée sur « ce périmètre
   * a déjà l'accès » casserait exactement ce critère.
   */
  | 'already_purchased'
  | 'provider_unavailable'

export type PortalRefusal = 'forbidden' | 'no_customer' | 'provider_unavailable'

export type RedirectOutcome<TRefusal> =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: TRefusal }

export type WebhookOutcome =
  | { readonly ok: true; readonly applied: boolean; readonly eventId: string }
  | { readonly ok: false; readonly reason: 'invalid_signature' | 'invalid_payload' }

/** Une offre, telle que l'écran la reçoit — prix déjà formaté, jamais recalculé à l'affichage. */
export interface OfferView {
  readonly id: string
  /** `subscription` ou `one_time` : l'écran ne dit pas « souscrire » à un achat. */
  readonly mode: BillingMode
  readonly price: string
  readonly interval: BillingInterval | null
  readonly trialDays: number | null
  readonly perSeat: boolean
  /** Cette offre est-elle celle de l'abonnement en cours ? */
  readonly current: boolean
  /**
   * Cette offre unique est-elle **déjà possédée** ?
   *
   * Toujours `false` pour une offre d'abonnement : ce sont deux fermetures
   * différentes, et les confondre rejouerait le défaut que le sixième critère
   * de la story interdit.
   */
  readonly owned: boolean
}

/** Un achat unique, tel que l'historique des paiements l'affiche. */
export interface PurchaseView {
  /**
   * L'offre achetée, ou `null` si elle n'est **plus au catalogue**.
   *
   * Nullable comme celle d'un abonnement, et pour la même raison : retirer une
   * offre de `config/billing.ts` laisse ses achats en base, et rendre son
   * identifiant à l'écran ferait composer une clé de traduction qui n'existe
   * pas — or le traducteur **lève** sur une clé absente depuis s09. L'écran
   * dirait donc 500 au lieu de « offre retirée du catalogue ».
   */
  readonly offerId: string | null
  /** Le montant **réellement prélevé**, déjà formaté, ou `null` s'il est inconnu. */
  readonly price: string | null
  readonly purchasedAt: Date | null
  readonly refunded: boolean
}

export interface SubscriptionView {
  readonly offerId: string | null
  readonly quantity: number
  readonly renewsAt: Date
  readonly cancelAtPeriodEnd: boolean
  readonly trialEnd: Date | null
}

export interface BillingView {
  readonly state: BillingDisplayState
  /**
   * **Le droit d'accès consolidé** — abonnement *ou* achat payé (critère 3).
   *
   * C'est cette valeur que le gating de s21 lira ; elle ne dit **pas** si le
   * catalogue d'abonnements doit se fermer, ce que dit `hasSubscription`.
   */
  readonly hasAccess: boolean
  /**
   * Un abonnement **vivant** donne-t-il l'accès ?
   *
   * Séparé de `hasAccess` parce qu'un acheteur à vie doit pouvoir s'abonner
   * (critère 6) : fermer le catalogue d'abonnements sur l'accès consolidé le
   * lui interdirait.
   */
  readonly hasSubscription: boolean
  readonly offers: readonly OfferView[]
  readonly subscription: SubscriptionView | null
  /** L'historique des paiements uniques — les achats en attente n'en sont pas. */
  readonly purchases: readonly PurchaseView[]
  /** L'appelant peut-il souscrire ou ouvrir le portail ? L'écran l'affiche quand même. */
  readonly canManage: boolean
  /** Un client existe chez le fournisseur : le portail a une destination. */
  readonly hasCustomer: boolean
  /**
   * Le portail a-t-il quelque chose à gérer ? (critère 4, ADR 038 §4)
   *
   * Ce qu'il sert — moyen de paiement, changement d'offre, résiliation —
   * n'existe que pour un abonnement. Un acheteur unique pur n'y a rien à faire,
   * et son historique de paiements est servi par l'application.
   */
  readonly canOpenPortal: boolean
}

export const EMPTY_BILLING_VIEW: BillingView = {
  state: 'none',
  hasAccess: false,
  hasSubscription: false,
  offers: [],
  subscription: null,
  purchases: [],
  canManage: false,
  hasCustomer: false,
  canOpenPortal: false,
}

export interface BillingDependencies {
  readonly repository: BillingRepository
  readonly payments: Payments
  readonly catalogue: BillingCatalogue
  /** L'URL publique de l'application. Jamais déduite d'un en-tête `Host`. */
  readonly appUrl: string
  readonly ownerOf: ScopeResolver
  readonly canManage: BillingPermission
  readonly seatsOf: SeatCounter
  readonly emailOfScope: ScopeEmailResolver
  readonly now: () => Date
  readonly generateId: () => string
}

export interface BillingUseCases {
  openCheckout(input: {
    readonly session: { readonly userId: string; readonly roles: readonly string[] }
    readonly offerId: string
    readonly locale: string | null
  }): Promise<RedirectOutcome<CheckoutRefusal>>
  openPortal(input: {
    readonly session: { readonly userId: string; readonly roles: readonly string[] }
  }): Promise<RedirectOutcome<PortalRefusal>>
  handleWebhook(input: {
    readonly payload: string
    readonly signature: string
  }): Promise<WebhookOutcome>
  view(input: {
    readonly session: { readonly userId: string; readonly roles: readonly string[] }
    readonly locale: string
  }): Promise<BillingView>
  /** Réconcilie le cache avec le fournisseur. Rend le nombre de lignes changées. */
  reconcile(): Promise<{ readonly customers: number; readonly changed: number }>
  purge(scope: ModuleScope): Promise<void>
  export(scope: ModuleScope): Promise<ModuleExportPayload>
}

/**
 * Le périmètre, sous la forme que le fournisseur porte à titre de diagnostic.
 *
 * **Exportée** parce qu'un second appelant en a besoin : la route du checkout
 * simulé (`apps/web/app/api/billing-local-checkout/route.ts`) doit vérifier que
 * la session qu'on lui présente a bien été ouverte par le périmètre de
 * l'appelant. La recomposer là-bas ferait deux écritures de la même forme, et
 * la première à diverger serait celle qui garde la porte.
 */
export const billingScopeReference = (scope: ModuleScope): string =>
  scope.kind === 'organization' ? `organization:${scope.organizationId}` : `user:${scope.userId}`

const referenceOf = billingScopeReference

const writeFrom = (
  subscription: {
    readonly id: string
    readonly priceId: string
    readonly quantity: number
    readonly status: PaymentStatus
    readonly currentPeriodEnd: Date
    readonly cancelAtPeriodEnd: boolean
    readonly trialEnd: Date | null
  },
  context: {
    readonly billingCustomerId: string
    readonly catalogue: BillingCatalogue
    readonly lastEventAt: Date
    readonly lastEventId: string
  },
): SubscriptionWrite => ({
  providerSubscriptionId: subscription.id,
  billingCustomerId: context.billingCustomerId,
  // `null` quand le prix n'est plus au catalogue : une offre retirée de
  // `config/billing.ts` laisse des abonnements en cours, et l'écran doit
  // pouvoir le dire au lieu de nommer une offre au hasard.
  offerId: offerForPrice(context.catalogue, subscription.priceId)?.id ?? null,
  priceId: subscription.priceId,
  status: DOMAIN_STATUS[subscription.status],
  quantity: subscription.quantity,
  currentPeriodEnd: subscription.currentPeriodEnd,
  cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  trialEnd: subscription.trialEnd,
  lastEventAt: context.lastEventAt,
  lastEventId: context.lastEventId,
})

/**
 * L'historique des paiements, tel que l'écran le reçoit.
 *
 * **Les achats en attente n'en sont pas** : un checkout ouvert puis abandonné
 * n'est pas un paiement, et l'afficher annoncerait un encaissement qui n'a pas
 * eu lieu.
 *
 * Le prix affiché est celui qui a été **prélevé**, pas celui du catalogue : une
 * offre dont le prix change ne réécrit pas le passé (ADR 038 §4).
 */
const purchaseViews = (
  purchases: readonly PurchaseRecord[],
  catalogue: BillingCatalogue,
  locale: string,
): readonly PurchaseView[] =>
  purchases
    .filter((purchase) => purchase.status !== 'pending')
    .map((purchase) => ({
      // `null` quand l'offre n'est plus au catalogue : l'écran sait le dire,
      // et il ne compose pas une clé de traduction qui ferait lever.
      offerId: offerById(catalogue, purchase.offerId) === null ? null : purchase.offerId,
      price:
        purchase.amount === null || purchase.currency === null
          ? null
          : formatOfferPrice({ amount: purchase.amount, currency: purchase.currency }, locale),
      purchasedAt: purchase.purchasedAt,
      refunded: purchase.status === 'refunded',
    }))

export function createBillingUseCases(dependencies: BillingDependencies): BillingUseCases {
  const {
    repository,
    payments,
    catalogue,
    appUrl,
    ownerOf,
    canManage,
    seatsOf,
    emailOfScope,
    now,
    generateId,
  } = dependencies

  const returnUrl = (query: string): string => `${appUrl}/billing${query}`

  /**
   * L'effet d'un événement vérifié.
   *
   * Rendre un effet **avant** d'ouvrir la transaction est ce qui garde
   * l'écriture courte : le journal et l'effet partagent une transaction, et
   * aucune lecture longue ne s'y attarde.
   */
  const effectOf = async (event: PaymentEvent): Promise<BillingEffect> => {
    if (event.kind === 'subscription_changed') {
      const customer = await repository.customerByProviderId(event.subscription.customerId)

      // Client inconnu : l'événement est journalisé — donc pas rejoué — mais
      // n'écrit rien.
      //
      // **Et la réconciliation ne le rattrapera pas** : elle part de
      // `listCustomers()`, c'est-à-dire des clients que *nous* connaissons.
      // Un client créé de toutes pièces dans le tableau de bord du fournisseur
      // n'y figure pas, et rien ne le rattachera jamais à un périmètre — il n'y
      // en a aucun à trouver. Ce qui est bien rattrapé, c'est un abonnement
      // ajouté à la main sur un client **déjà** rattaché (constat F6 de la
      // revue : la phrase précédente ne distinguait pas les deux).
      return customer === null
        ? { kind: 'none' }
        : {
            kind: 'subscription',
            write: writeFrom(event.subscription, {
              billingCustomerId: customer.id,
              catalogue,
              lastEventAt: event.occurredAt,
              lastEventId: event.id,
            }),
          }
    }

    if (event.kind === 'purchase_paid') {
      // **Aucune insertion** (ADR 038 §1) : la ligne existe depuis l'ouverture
      // du checkout, sous cet identifiant de session, et c'est elle qui porte
      // l'offre — que la charge utile ne dit pas. Une session que nous n'avons
      // pas ouverte est journalisée et n'écrit rien.
      return {
        kind: 'purchase_paid',
        providerSessionId: event.sessionId,
        providerPaymentId: event.paymentId,
        amount: event.amountTotal,
        currency: event.currency,
        paidAt: event.occurredAt,
        lastEventAt: event.occurredAt,
        lastEventId: event.id,
      }
    }

    if (event.kind === 'purchase_refunded') {
      // **La règle est dans le domaine** (ADR 038 §3) : le fournisseur émet le
      // même événement pour un geste partiel et pour un remboursement total.
      // Un partiel est journalisé — donc non rejoué — et n'écrit rien.
      return refundRevokesPurchase({ amount: event.amount, amountRefunded: event.amountRefunded })
        ? {
            kind: 'purchase_refunded',
            providerPaymentId: event.paymentId,
            refundedAt: event.occurredAt,
            lastEventAt: event.occurredAt,
            lastEventId: event.id,
          }
        : { kind: 'none' }
    }

    if (event.kind === 'payment_failed' && event.subscriptionId !== null) {
      return {
        kind: 'payment_failed',
        providerSubscriptionId: event.subscriptionId,
        lastEventAt: event.occurredAt,
        lastEventId: event.id,
      }
    }

    // `checkout_completed` n'écrit **rien** : le rattachement a déjà eu lieu à
    // l'ouverture du checkout (ADR 034), et l'état vient des événements
    // d'abonnement. Le journaliser reste nécessaire — un rejeu ne doit pas
    // retraverser la chaîne.
    return { kind: 'none' }
  }

  return {
    openCheckout: async ({ session, offerId, locale }) => {
      const scope = await ownerOf(session)

      if (scope === null || !(await canManage(scope, session.userId))) {
        return { ok: false, reason: 'forbidden' }
      }

      // **Le prix ne vient pas du client.** L'appelant a envoyé un identifiant ;
      // le montant, la devise et la périodicité sortent du catalogue typé.
      const offer: BillingOffer | null = offerById(catalogue, offerId)

      if (offer === null) {
        return { ok: false, reason: 'unknown_offer' }
      }

      // **Le mode vient du catalogue**, jamais de la requête : le navigateur
      // n'envoie qu'un identifiant d'offre, et c'est ici que « offre unique »
      // devient « paiement » chez le fournisseur.
      const mode: CheckoutMode = offer.mode === 'one_time' ? 'payment' : 'subscription'
      const existing = await repository.customerForScope(scope)

      // **Un abonnement vivant ferme le catalogue** (constat M3 de la seconde
      // revue). `checkout.sessions.create({ mode: 'subscription' })` crée
      // *toujours* un abonnement de plus chez le fournisseur — le SDK n'offre
      // aucun paramètre de remplacement —, si bien qu'un abonné qui cliquait une
      // autre offre était prélevé deux fois, et que l'écran, qui n'affiche que
      // *son* abonnement, ne montrait pas le second.
      //
      // Le sixième critère de la story confie le changement d'offre au
      // **portail**, qui sait remplacer et proratiser. Ce refus est la moitié
      // serveur de cette décision ; masquer le bouton n'en est pas une
      // (`docs/security.md` §3).
      //
      // **« Vivant » veut dire `grantsAccess`**, la même règle que l'écran :
      // un abonnement terminé rouvre le catalogue, et c'est exactement le
      // parcours « annuler puis se réabonner » du constat F1.
      //
      // **Deux fermetures, et elles ne se regardent pas** (critère 6, ADR 038
      // §2) : la garde d'abonnement ne lit que les abonnements, la garde
      // d'achat ne lit que les achats. Une garde unique sur l'accès consolidé
      // interdirait à un abonné d'acheter à vie, et à un acheteur à vie de
      // s'abonner.
      if (existing !== null && offer.mode === 'subscription') {
        const at = now()
        const current = currentSubscriptionOf(
          await repository.subscriptionsOfCustomer(existing.id),
          at,
        )

        if (grantsAccess(current, at)) {
          return { ok: false, reason: 'already_subscribed' }
        }
      }

      // **L'invariant central de s20** : on ne facture pas deux fois le même
      // acte d'achat. Le refus dit pourquoi ; c'est l'unicité
      // `(billing_customer_id, offer_id)` qui le tient sous concurrence.
      if (existing !== null && offer.mode === 'one_time') {
        const owned = (await repository.purchasesOfCustomer(existing.id)).find(
          (candidate) => candidate.offerId === offer.id,
        )

        if (purchaseGrantsAccess(owned ?? null)) {
          return { ok: false, reason: 'already_purchased' }
        }
      }

      const checkout = await payments.createCheckout({
        priceId: offer.priceId,
        mode,
        // Résolue **côté serveur**. Une quantité reçue du navigateur est un prix
        // reçu du navigateur.
        quantity: offer.perSeat ? await seatsOf(scope, session.userId) : 1,
        customerId: existing?.providerCustomerId ?? null,
        // L'adresse **seulement à la création** : un client déjà rattaché a la
        // sienne chez le fournisseur, et la renvoyer l'écraserait.
        customerEmail: existing === null ? await emailOfScope(scope, session.userId) : null,
        reference: referenceOf(scope),
        successUrl: returnUrl('?checkout=success'),
        cancelUrl: returnUrl('?checkout=cancelled'),
        trialPeriodDays: offer.trialDays,
        locale,
        idempotencyKey: `checkout:${referenceOf(scope)}:${offer.id}`,
      })

      if (!checkout.ok) {
        return { ok: false, reason: 'provider_unavailable' }
      }

      // **Écrit avant de rendre l'URL** : c'est ce qui ferme le désordre des
      // événements (ADR 034). Un `customer.subscription.updated` arrivé avant le
      // `checkout.session.completed` retrouve son propriétaire ici.
      const customer = await repository.linkCustomer({
        id: existing?.id ?? generateId(),
        scope,
        providerCustomerId: checkout.checkout.customerId,
      })

      if (offer.mode === 'one_time') {
        // **La seconde écriture avant l'URL**, et c'est celle qui rend l'achat
        // rattachable (ADR 038 §1) : la confirmation ne porte pas le prix payé,
        // donc l'offre doit être écrite ici, sous l'identifiant de session.
        await repository.openPurchase({
          id: generateId(),
          billingCustomerId: customer.id,
          offerId: offer.id,
          priceId: offer.priceId,
          providerSessionId: checkout.checkout.sessionId,
        })
      }

      return { ok: true, url: checkout.checkout.url }
    },

    openPortal: async ({ session }) => {
      const scope = await ownerOf(session)

      if (scope === null || !(await canManage(scope, session.userId))) {
        return { ok: false, reason: 'forbidden' }
      }

      const customer = await repository.customerForScope(scope)

      if (customer === null) {
        return { ok: false, reason: 'no_customer' }
      }

      const portal = await payments.createPortalSession({
        customerId: customer.providerCustomerId,
        returnUrl: returnUrl(''),
      })

      return portal.ok
        ? { ok: true, url: portal.session.url }
        : { ok: false, reason: 'provider_unavailable' }
    },

    /**
     * **La signature d'abord, tout le reste ensuite** (`docs/security.md` §4).
     *
     * Aucune lecture, aucune écriture avant que le port n'ait accepté la
     * signature. Un événement forgé ne touche donc ni la base, ni le journal.
     */
    handleWebhook: async ({ payload, signature }) => {
      const verified = await payments.verifyWebhook({ payload, signature })

      if (!verified.ok) {
        return {
          ok: false,
          reason: verified.error.code === 'invalid_signature' ? 'invalid_signature' : 'invalid_payload',
        }
      }

      const event = verified.event
      const applied = await repository.applyEvent({
        eventId: event.id,
        type: event.kind === 'unhandled' ? event.type : event.kind,
        effect: await effectOf(event),
      })

      return { ok: true, applied, eventId: event.id }
    },

    view: async ({ session, locale }) => {
      const scope = await ownerOf(session)

      if (scope === null) {
        return EMPTY_BILLING_VIEW
      }

      const at = now()
      const customer = await repository.customerForScope(scope)
      const subscriptions =
        customer === null ? [] : await repository.subscriptionsOfCustomer(customer.id)
      const purchases = customer === null ? [] : await repository.purchasesOfCustomer(customer.id)
      // **Lequel est *le* sien** est une règle, pas une requête : un client qui
      // s'est réabonné en a plusieurs, et c'est celui qui donne l'accès qui
      // compte (constat F1 de la revue).
      const subscription = currentSubscriptionOf(subscriptions, at)
      const ownedOffers = new Set(
        purchases.filter((entry) => purchaseGrantsAccess(entry)).map((entry) => entry.offerId),
      )

      return {
        state: displayStateOf(subscription, at),
        hasAccess: grantsBillingAccess(subscription, purchases, at),
        hasSubscription: grantsAccess(subscription, at),
        offers: catalogue.map((offer) => ({
          id: offer.id,
          mode: offer.mode,
          price: formatOfferPrice(offer, locale),
          interval: offer.interval,
          trialDays: offer.trialDays,
          perSeat: offer.perSeat,
          current: subscription?.offerId === offer.id,
          owned: offer.mode === 'one_time' && ownedOffers.has(offer.id),
        })),
        subscription:
          subscription === null
            ? null
            : {
                offerId: subscription.offerId,
                quantity: subscription.quantity,
                renewsAt: subscription.currentPeriodEnd,
                cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
                trialEnd: subscription.trialEnd,
              },
        purchases: purchaseViews(purchases, catalogue, locale),
        canManage: await canManage(scope, session.userId),
        hasCustomer: customer !== null,
        // Le portail ne sert **que** l'abonnement (critère 4). Un périmètre qui
        // n'a jamais eu d'abonnement n'y a rien à gérer, même s'il a un client
        // chez le fournisseur — c'est le cas de l'acheteur unique pur.
        canOpenPortal: subscriptions.length > 0,
      }
    },

    /**
     * **La commande de réconciliation** (`docs/reliability.md` §5).
     *
     * Ce que nous stockons est un cache : il diverge quand un webhook se perd,
     * quand deux événements partagent une seconde, ou quand un abonnement est
     * créé depuis le tableau de bord du fournisseur. Cette commande relit et
     * réécrit ; une seconde exécution ne change rien, et c'est le compte rendu
     * qui le prouve.
     */
    reconcile: async () => {
      const customers = await repository.listCustomers()
      let changed = 0

      for (const customer of customers) {
        const at = now()
        // **Les deux lectures sont indépendantes**, et c'est délibéré : un
        // fournisseur qui échoue sur les abonnements ne doit pas emporter la
        // réconciliation des achats, ni l'inverse. Une lecture en échec ne
        // dégrade rien — la réconciliation n'efface jamais (ADR 034 §3).
        const purchases = await payments.listPurchases({
          customerId: customer.providerCustomerId,
        })

        if (purchases.ok) {
          changed += await repository.reconcilePurchases({
            billingCustomerId: customer.id,
            // **Des faits, pas une décision** : ce que le fournisseur a dit de
            // cette session, transmis tel quel. Le statut qu'il impose — ou
            // l'absence de statut — est tranché par le `domain`, qui seul voit
            // aussi ce qui est stocké (constat m1).
            purchases: purchases.purchases.map((purchase) => ({
              providerSessionId: purchase.sessionId,
              providerPaymentId: purchase.paymentId,
              paid: purchase.paid,
              chargedAmount: purchase.chargedAmount,
              amountRefunded: purchase.amountRefunded,
              amount: purchase.amountTotal,
              currency: purchase.currency,
              at,
            })),
          })
        }

        const listed = await payments.listSubscriptions({
          customerId: customer.providerCustomerId,
        })

        if (!listed.ok) {
          continue
        }

        changed += await repository.replaceSubscriptions({
          billingCustomerId: customer.id,
          subscriptions: listed.subscriptions.map((subscription) =>
            writeFrom(subscription, {
              billingCustomerId: customer.id,
              catalogue,
              // La réconciliation ne vient d'aucun événement : elle pose
              // l'instant de la lecture, ce qui la rend **plus récente** que
              // tout événement déjà appliqué. C'est voulu — elle fait autorité,
              // puisqu'elle vient de la source de vérité.
              lastEventAt: at,
              lastEventId: `reconcile:${at.toISOString()}`,
            }),
          ),
        })
      }

      return { customers: customers.length, changed }
    },

    purge: async (scope) => {
      await repository.deleteScope(scope)
    },

    export: async (scope) => {
      const customer = await repository.customerForScope(scope)

      if (customer === null) {
        return { subscriptions: [] }
      }

      // **Tout ce que le périmètre possède**, pas seulement l'abonnement
      // courant (constat m3 de la seconde revue). Le contrat dit « rend les
      // données du périmètre » (`packages/core/src/module.ts`) : un client qui
      // s'est réabonné a plusieurs lignes, et n'en rendre qu'une inventerait un
      // filtre que personne n'a décidé — c'est son historique de facturation.
      //
      // L'ordre est celui de la **lecture** — le plus récemment changé
      // d'abord —, et non celui de `currentSubscriptionOf` : quand l'ancien
      // abonnement est annulé *après* la souscription du neuf, c'est
      // l'annulation qui ouvre la liste. L'export rend l'historique, il ne
      // désigne pas l'abonnement en cours ; l'écran, lui, le désigne.
      const subscriptions = await repository.subscriptionsOfCustomer(customer.id)

      // Les achats uniques sont **aussi** les données du périmètre : ne rendre
      // que les abonnements inventerait un filtre que personne n'a décidé, et
      // c'est le même raisonnement que le constat m3 de la seconde revue.
      const purchases = await repository.purchasesOfCustomer(customer.id)

      return {
        subscriptions: subscriptions.map((subscription) => ({
          offerId: subscription.offerId,
          status: subscription.status,
          quantity: subscription.quantity,
          currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        })),
        purchases: purchases.map((purchase) => ({
          offerId: offerById(catalogue, purchase.offerId) === null ? null : purchase.offerId,
          status: purchase.status,
          amount: purchase.amount,
          currency: purchase.currency,
          purchasedAt: purchase.purchasedAt?.toISOString() ?? null,
          refundedAt: purchase.refundedAt?.toISOString() ?? null,
        })),
      }
    },
  }
}

/**
 * Réexporté pour que `infrastructure/` applique **la même règle d'ordre** que le
 * domaine nomme (ADR 034).
 *
 * Le prédicat SQL et cette fonction doivent dire la même chose. Le premier est
 * éprouvé contre la base (`tests/billing.test.ts` : un événement plus ancien
 * n'écrase pas), la seconde dans le `domain`. Deux preuves, parce qu'il y a deux
 * mécanismes — et c'est la même discipline que le module `organizations`, où la
 * règle nomme et le prédicat refuse.
 */
export { appliesAfter }
