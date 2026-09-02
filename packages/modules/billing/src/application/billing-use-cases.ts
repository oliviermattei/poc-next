import type { ModuleExportPayload, ModuleScope } from '@repo/core'
import type { PaymentEvent, Payments, PaymentStatus } from '@repo/ports'

import {
  formatOfferPrice,
  offerById,
  offerForPrice,
  type BillingCatalogue,
  type BillingInterval,
  type BillingOffer,
} from '../domain/offer'
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
  | 'unsupported_mode'
  | 'already_subscribed'
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
  readonly price: string
  readonly interval: BillingInterval | null
  readonly trialDays: number | null
  readonly perSeat: boolean
  /** Cette offre est-elle celle de l'abonnement en cours ? */
  readonly current: boolean
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
  readonly hasAccess: boolean
  readonly offers: readonly OfferView[]
  readonly subscription: SubscriptionView | null
  /** L'appelant peut-il souscrire ou ouvrir le portail ? L'écran l'affiche quand même. */
  readonly canManage: boolean
  /** Un client existe chez le fournisseur : le portail a une destination. */
  readonly hasCustomer: boolean
}

export const EMPTY_BILLING_VIEW: BillingView = {
  state: 'none',
  hasAccess: false,
  offers: [],
  subscription: null,
  canManage: false,
  hasCustomer: false,
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

      if (offer.mode !== 'subscription') {
        // s19 ne livre que l'abonnement. Ouvrir un chemin `payment` non éprouvé
        // serait pire que de le refuser : c'est la story s20.
        return { ok: false, reason: 'unsupported_mode' }
      }

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
      if (existing !== null) {
        const at = now()
        const current = currentSubscriptionOf(
          await repository.subscriptionsOfCustomer(existing.id),
          at,
        )

        if (grantsAccess(current, at)) {
          return { ok: false, reason: 'already_subscribed' }
        }
      }

      const checkout = await payments.createCheckout({
        priceId: offer.priceId,
        mode: 'subscription',
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
      await repository.linkCustomer({
        id: existing?.id ?? generateId(),
        scope,
        providerCustomerId: checkout.checkout.customerId,
      })

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
      // **Lequel est *le* sien** est une règle, pas une requête : un client qui
      // s'est réabonné en a plusieurs, et c'est celui qui donne l'accès qui
      // compte (constat F1 de la revue).
      const subscription =
        customer === null
          ? null
          : currentSubscriptionOf(await repository.subscriptionsOfCustomer(customer.id), at)

      return {
        state: displayStateOf(subscription, at),
        hasAccess: grantsAccess(subscription, at),
        offers: catalogue.map((offer) => ({
          id: offer.id,
          price: formatOfferPrice(offer, locale),
          interval: offer.interval,
          trialDays: offer.trialDays,
          perSeat: offer.perSeat,
          current: subscription?.offerId === offer.id,
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
        canManage: await canManage(scope, session.userId),
        hasCustomer: customer !== null,
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
        const listed = await payments.listSubscriptions({
          customerId: customer.providerCustomerId,
        })

        if (!listed.ok) {
          continue
        }

        const at = now()

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

      return {
        subscriptions: subscriptions.map((subscription) => ({
          offerId: subscription.offerId,
          status: subscription.status,
          quantity: subscription.quantity,
          currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
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
