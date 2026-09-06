import type { ModuleExportPayload, ModuleScope } from '@repo/core'
import type {
  CheckoutMode,
  PaymentEvent,
  Payments,
  PaymentStatus,
  PaymentSubscription,
} from '@repo/ports'

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
  checkoutWindowStartOf,
  exceedsCheckoutRateLimit,
  guestCheckoutBucket,
  GUEST_CHECKOUT_GLOBAL_BUCKET,
  GUEST_CHECKOUT_RATE_LIMIT,
} from '../domain/checkout-throttle'
import {
  accountScopeOfCustomer,
  guestPaymentEmailOf,
  guestScopeReference,
  isGuestScopeKind,
} from '../domain/guest'
import { billableSeats, exceedsSeatLimit, offerSeatLimit, offerSyncsSeats } from '../domain/seats'
import {
  entitledOfferIds,
  grantsBillingAccess,
  purchaseGrantsAccess,
  refundRevokesPurchase,
} from '../domain/purchase'
import {
  appliesAfter,
  currentSubscriptionOf,
  displayStateOf,
  grantsAccess,
  trialDaysFor,
  type BillingDisplayState,
  type SubscriptionStatus,
} from '../domain/subscription'
import type {
  BillingEffect,
  BillingPermission,
  BillingRepository,
  CheckoutThrottle,
  GuestAccount,
  GuestAccounts,
  GuestPromotion,
  PurchaseRecord,
  BillingCustomerRecord,
  ScopeEmailResolver,
  ScopeResolver,
  ScopeSeats,
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

/**
 * Les refus du checkout **invité** (s24).
 *
 * Trois, et aucun n'est `forbidden` : la route est publique, il n'y a personne
 * à autoriser. `rate_limited` est le seul refus neuf du dépôt sur un chemin de
 * paiement — c'est le prix d'ouvrir une route publique qui appelle un tiers.
 */
export type GuestCheckoutRefusal = 'unknown_offer' | 'rate_limited' | 'provider_unavailable'

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

/**
 * Ce que la synchronisation d'une quantité de sièges rend (s23).
 *
 * **Aucun nombre écrit ici** : la phrase disait « trois issues » alors qu'il y
 * en avait quatre depuis s47, et aucune commande ne tenait ce compte. La liste
 * ci-dessous est vérifiable, elle.
 *
 * La distinction qui porte tout l'enjeu est celle entre `not_applicable` et les
 * deux refus : `not_applicable` laisse l'écriture locale se valider, `failed`
 * et `over_limit` l'annulent.
 */
/**
 * Ce que rend une annulation d'abonnements (s34).
 *
 * `cancelled` compte ce qui a été annulé **avant** l'échec, pour que le journal
 * de l'appelant dise où l'opération s'est arrêtée — la même raison que
 * `purgeModules`, qui rend les modules effectivement purgés.
 */
export type CancelSubscriptionsOutcome =
  | { readonly status: 'cancelled'; readonly cancelled: number }
  | { readonly status: 'not_applicable' }
  | { readonly status: 'failed'; readonly cancelled: number }

export type SeatSyncOutcome =
  | { readonly status: 'synced'; readonly quantity: number }
  | { readonly status: 'not_applicable' }
  | { readonly status: 'failed' }
  /**
   * **Le plafond de l'offre est atteint** (s47) — ni `failed` ni
   * `not_applicable`.
   *
   * Pas `failed` : rien n'est en panne, et l'action à conseiller n'est pas
   * « réessayez ». Pas `not_applicable` : l'écriture doit être annulée.
   *
   * **Elle ne porte pas le plafond, et c'est délibéré** (constat M2 de la revue
   * de s47). Elle l'a porté : `{ limit: number }`, avec un commentaire qui
   * annonçait « le message qui le nomme est composé plus haut ». Ce message
   * n'existait pas. Le nombre était lu **nulle part** —
   * `apps/web/lib/seat-sync.ts` le laissait tomber un étage plus haut, et aucun
   * texte n'interpole de nombre. Le porter donnait à lire un câblage qui
   * n'était pas là.
   *
   * Le nombre ne sort donc pas du module aujourd'hui. Le rendre au
   * propriétaire demande un canal que cette story n'a pas — une notification
   * dans l'application, c'est `s32-notifications-inapp` —, et le jour où ce
   * canal existe, le champ se repose ici, à la ligne qui construit cette
   * issue : c'est le seul endroit qui connaisse l'offre.
   */
  | { readonly status: 'over_limit' }

export interface BillingDependencies {
  readonly repository: BillingRepository
  readonly payments: Payments
  readonly catalogue: BillingCatalogue
  /** L'URL publique de l'application. Jamais déduite d'un en-tête `Host`. */
  readonly appUrl: string
  readonly ownerOf: ScopeResolver
  readonly canManage: BillingPermission
  readonly seatsOf: SeatCounter
  /**
   * Le nombre de membres d'un périmètre **sans appelant** (s23) : ce dont la
   * réconciliation a besoin, et que `seatsOf` ne sait pas donner.
   */
  readonly seatsOfScope: ScopeSeats
  readonly emailOfScope: ScopeEmailResolver
  /**
   * **Le compteur partagé** de la route publique de checkout (s24,
   * `docs/security.md` §7). En base, jamais en mémoire de processus.
   */
  readonly throttle: CheckoutThrottle
  /**
   * **Où repart un visiteur quand le canal anonyme est saturé** (constat F3 de
   * la revue de s24).
   *
   * Le seau global ne refuse pas, il dégrade : au-delà du seuil, le tunnel
   * n'est pas ouvert et le navigateur part vers cette adresse. Elle est fournie
   * par le point de composition parce que ce module ne connaît pas `auth` et
   * ignore ce qu'est un écran de connexion — la même raison que
   * `guestAccounts`. L'offre voyage avec, pour être reposée au retour
   * (ADR 045).
   */
  readonly guestFallbackUrl: (input: {
    readonly offerId: string
    readonly locale: string | null
  }) => string
  /**
   * **Le compte d'un paiement invité**, résolu par le point de composition
   * (s24, ADR 047) : ce module ne connaît pas `auth`.
   */
  readonly guestAccounts: GuestAccounts
  readonly now: () => Date
  readonly generateId: () => string
  /**
   * L'identifiant d'un périmètre invité — **un tirage cryptographique**
   * (ADR 047), distinct de `generateId` pour qu'aucune suite ne puisse le
   * remplacer par un compteur sans le dire.
   */
  readonly generateGuestScopeId: () => string
}

export interface BillingUseCases {
  openCheckout(input: {
    readonly session: { readonly userId: string; readonly roles: readonly string[] }
    readonly offerId: string
    readonly locale: string | null
  }): Promise<RedirectOutcome<CheckoutRefusal>>
  /**
   * **Ouvrir un tunnel sans compte** (s24, critère 1).
   *
   * Une entrée **voisine** d'`openCheckout`, jamais un assouplissement de
   * celle-ci : `openCheckout` exige une session et une permission, et affaiblir
   * cette garde pour servir l'anonyme mettrait en danger le chemin authentifié.
   *
   * `client` est ce que le serveur croit savoir de l'appelant — un en-tête,
   * donc falsifiable. Il ne sert qu'au seau de limitation de débit, jamais à
   * une autorisation.
   *
   * L'URL rendue est **la destination suivante du navigateur**, et ce n'est pas
   * toujours celle du fournisseur : quand le seau global est saturé, c'est
   * celle de `guestFallbackUrl` — la connexion, avec l'offre en poche. Rien
   * n'est alors ouvert ni écrit.
   */
  openGuestCheckout(input: {
    readonly offerId: string
    readonly locale: string | null
    readonly client: string
  }): Promise<RedirectOutcome<GuestCheckoutRefusal>>
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
  /**
   * **Les offres que ce périmètre détient** (s21, ADR 043).
   *
   * C'est tout ce que le module de facturation dit au gating : *quelles offres*
   * — jamais *quelle fonctionnalité*, qui est la question de `config/gating.ts`
   * et de `@repo/core`. La séparation est ce qui permet au gating de répondre
   * quand ce module est coupé.
   *
   * Elle rend une liste et non une vue : la vue formate des prix dans une
   * locale et lit le catalogue entier, alors que la question posée à chaque
   * requête de route réservée doit rester une lecture.
   */
  /**
   * **L'offre et l'état d'abonnement d'un périmètre** (s37b2), sans session ni
   * locale.
   *
   * Elle existe pour le back-office, qui affiche une colonne « état
   * d'abonnement » sur des organisations dont il n'est membre d'aucune : `view`
   * part d'une session et résout le périmètre depuis elle, ce qui ne peut pas
   * répondre à cette question. Le **périmètre est donné**, comme pour `purge` et
   * `export` — jamais lu d'un corps de requête.
   *
   * Elle ne rend ni prix ni catalogue : formater une offre demanderait une
   * locale, et l'état affiché est celui que `BillingDisplayState` nomme déjà —
   * un vocabulaire fermé, que l'appelant n'a pas à réinventer.
   */
  subscriptionOf(scope: ModuleScope): Promise<{
    readonly offerId: string | null
    readonly state: BillingDisplayState
  }>
  entitledOffers(input: {
    readonly session: { readonly userId: string; readonly roles: readonly string[] }
  }): Promise<readonly string[]>
  /**
   * **Porte la quantité facturée au nombre de membres visé** (s23, ADR 046).
   *
   * Appelée par le point de composition **à l'intérieur** de la transaction qui
   * vient d'ajouter ou de retirer une appartenance, et avant qu'elle soit
   * validée : `failed` annule cette transaction, si bien qu'un fournisseur muet
   * n'ajoute ni ne retire personne (critère 6).
   *
   * `seats` est une **cible**, jamais un delta, et la clé d'idempotence en
   * dérive : un rejeu converge au lieu de compter deux fois
   * (`docs/reliability.md` §1).
   *
   * `not_applicable` n'est pas un échec — c'est le forfait : pas de client, pas
   * d'abonnement vivant, une offre qui n'est pas facturée au siège, ou un
   * périmètre compte. Ne rien avoir à faire ne doit annuler aucune écriture.
   */
  syncSeats(input: {
    readonly scope: ModuleScope
    readonly seats: number
    /**
     * **Cette écriture ajoute-t-elle un membre ?** (s47)
     *
     * Le plafond ne s'oppose qu'aux ajouts. Un retrait qui laisse encore
     * l'effectif au-dessus d'un plafond abaissé doit passer : le refuser
     * enfermerait l'organisation au-dessus de son plafond, en lui interdisant
     * le seul geste qui l'en rapprocherait — et le critère 4 interdit par
     * ailleurs de retirer qui que ce soit d'office.
     *
     * Facultatif, et **`false` par défaut** : les appelants qui ne changent pas
     * l'effectif (la réconciliation, une correction de quantité) ne peuvent pas
     * déclencher un plafond par omission.
     */
    readonly adds?: boolean
  }): Promise<SeatSyncOutcome>
  /** Réconcilie le cache avec le fournisseur. Rend le nombre de lignes changées. */
  /**
   * **Annule les abonnements d'un périmètre chez le fournisseur** (s34, critère
   * 5).
   *
   * Appelée à la suppression d'une organisation, par le module qui la porte —
   * lequel ne connaît pas ce module et reçoit une fonction (le patron de
   * `seatSync`, ADR 034).
   *
   * `not_applicable` couvre « il n'y avait rien à annuler » : pas de client
   * chez le fournisseur, aucun abonnement vivant. Confondre ce cas avec un
   * échec rendrait toute organisation gratuite indélébile.
   *
   * Elle n'efface **aucune ligne locale** : c'est la purge du module qui le
   * fait, et l'ordre est celui de la suppression — annuler d'abord, effacer
   * ensuite.
   */
  cancelSubscriptions(scope: ModuleScope): Promise<CancelSubscriptionsOutcome>
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

/**
 * Le périmètre que désigne une ligne client — **jamais reçu d'une requête**, et
 * `null` pour un invité.
 *
 * Il est reconstruit depuis ce que nous avons écrit à l'ouverture du checkout,
 * pour la seule commande qui parcourt les clients sans appelant :
 * `pnpm billing:reconcile`. La règle vit dans le `domain` (`accountScopeOfCustomer`)
 * parce que c'est la règle d'ADR 047 : une ligne invitée n'est le périmètre
 * d'aucun compte, et la reconstruire en `user:<jeton>` fabriquerait un compte
 * que personne n'a créé.
 */
const scopeOfCustomer = (customer: BillingCustomerRecord): ModuleScope | null =>
  accountScopeOfCustomer(customer)

/**
 * **La clé d'idempotence d'une correction de quantité** (s23, ADR 046).
 *
 * Elle est dérivée d'un **état visé** — le périmètre, l'abonnement, la
 * quantité —, exactement comme `checkout:…` l'est du périmètre et de l'offre.
 * Une clé qui porterait un compteur, un instant ou un delta ferait de deux
 * appels identiques deux écritures : le rejeu compterait deux fois au lieu de
 * converger, et c'est précisément ce que `docs/reliability.md` §1 interdit.
 */
const seatIdempotencyKey = (
  scope: ModuleScope,
  providerSubscriptionId: string,
  quantity: number,
): string => `seats:${referenceOf(scope)}:${providerSubscriptionId}:${quantity}`

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
    seatsOfScope,
    emailOfScope,
    throttle,
    guestFallbackUrl,
    guestAccounts,
    now,
    generateId,
    generateGuestScopeId,
  } = dependencies

  const returnUrl = (query: string): string => `${appUrl}/billing${query}`

  /**
   * **Ramène la quantité du fournisseur au nombre de membres**, ou laisse
   * l'abonnement tel quel (s23, ADR 046).
   *
   * Quatre raisons de ne rien écrire, et la première est celle qui compte :
   * `billableSeats` refuse une lecture qui n'a rien rendu, si bien qu'aucune
   * facture ne baisse sur un silence. Les trois autres — offre au forfait,
   * offre inconnue du catalogue, abonnement qui n'accorde plus rien — sont des
   * abonnements qu'il n'y a pas lieu de corriger.
   *
   * L'écriture en échec n'est pas fatale : elle laisse l'abonnement dans l'état
   * que le fournisseur a dit, la commande continue, et le prochain passage
   * réessaiera. Une réconciliation qui s'arrêterait au premier client
   * injoignable n'en réconcilierait jamais aucun autre.
   */
  const alignSeats = async (
    subscription: PaymentSubscription,
    scope: ModuleScope,
    members: number | null,
    at: Date,
  ): Promise<{
    readonly subscription: PaymentSubscription
    readonly written: boolean
  }> => {
    const quantity = billableSeats(members)
    const offer = offerForPrice(catalogue, subscription.priceId)

    if (quantity === null || offer === null || !offerSyncsSeats(offer)) {
      return { subscription, written: false }
    }

    const snapshot = {
      status: DOMAIN_STATUS[subscription.status],
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      trialEnd: subscription.trialEnd,
    }

    if (quantity === subscription.quantity || !grantsAccess(snapshot, at)) {
      return { subscription, written: false }
    }

    const written = await payments.updateSubscriptionQuantity({
      subscriptionId: subscription.id,
      quantity,
      // **La même clé que celle de la synchronisation à l'écriture** : une
      // correction et une acceptation qui visent la même quantité sont le même
      // appel, et le rejeu converge.
      idempotencyKey: seatIdempotencyKey(scope, subscription.id, quantity),
    })

    return written.ok
      ? { subscription: written.subscription, written: true }
      : { subscription, written: false }
  }

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

  /**
   * **Le retour d'un paiement invité** — la page publique de tarifs.
   *
   * Pas `/billing` : cet écran-là exige une session, et le visiteur n'en a
   * aucune. Le paramètre n'accorde rien et n'ouvre rien ; l'état vient de la
   * base, écrite par le webhook, et il se lit une fois la personne connectée
   * par le lien reçu — c'est la discipline que s19 a posée pour `/billing`
   * (« un `?checkout=success` forgé n'affiche qu'un bandeau »), étendue au
   * parcours invité (critère 7).
   */
  const guestReturnUrl = (query: string): string => `${appUrl}/pricing${query}`

  /**
   * **La promotion d'une ligne invitée**, décidée avant d'ouvrir la
   * transaction (ADR 047).
   *
   * Trois refus, et chacun laisse l'événement journalisé sans rien promouvoir :
   * pas de client chez nous, une ligne qui n'est pas invitée — donc déjà
   * promue, ou celle d'un compte —, une adresse que la frontière refuse.
   *
   * Le compte est résolu **par le point de composition**, et cette résolution
   * est idempotente par l'adresse : un rejeu retrouve le compte au lieu d'en
   * créer un second (critère 6). C'est là, hors de la contrainte d'unicité de
   * `provider_customer_id`, qu'un second compte pourrait naître — et c'est pour
   * cela que l'idempotence y est une exigence écrite, pas un espoir.
   */
  const guestPromotionFor = async (
    customerId: string | null,
    email: unknown,
  ): Promise<{ readonly promotion: GuestPromotion; readonly email: string; readonly account: GuestAccount } | null> => {
    if (customerId === null) {
      return null
    }

    const customer = await repository.customerByProviderId(customerId)

    if (customer === null || !isGuestScopeKind(customer.scopeKind)) {
      return null
    }

    const address = guestPaymentEmailOf(email)

    if (address === null) {
      return null
    }

    const account = await guestAccounts.accountFor({ email: address })

    return account === null
      ? null
      : { promotion: { providerCustomerId: customerId, userId: account.userId }, email: address, account }
  }

  return {
    /**
     * **Le tunnel d'un visiteur sans compte** (s24, critères 1 et 5).
     *
     * L'ordre des trois écritures est celui de l'ADR 034, et il ne se
     * réarrange pas : limitation de débit, puis appel au fournisseur, puis
     * **ligne client écrite avant que l'URL ne parte**. Un
     * `customer.subscription.created` arrivé avant le
     * `checkout.session.completed` retrouve donc son propriétaire — un
     * périmètre invité, mais un propriétaire.
     *
     * Ce qu'un paiement **abandonné** laisse : cette ligne invitée, orpheline.
     * Ni un compte, ni un droit d'accès — c'est le critère 5, et c'est la
     * conséquence assumée de l'ADR 047.
     */
    openGuestCheckout: async ({ offerId, locale, client }) => {
      const at = now()
      const windowStart = checkoutWindowStartOf(at, GUEST_CHECKOUT_RATE_LIMIT.windowSeconds)
      const hits = await throttle.hit({
        bucket: guestCheckoutBucket(client),
        max: GUEST_CHECKOUT_RATE_LIMIT.maxPerClient,
        windowStart,
      })

      // Les fenêtres closes n'ont plus de lecteur : sans ce balayage, la table
      // garde un seau par identifiant d'appelant pour l'éternité.
      await throttle.sweep(windowStart)

      if (exceedsCheckoutRateLimit(hits, GUEST_CHECKOUT_RATE_LIMIT.maxPerClient)) {
        return { ok: false, reason: 'rate_limited' }
      }

      // **Le prix ne vient pas du client** : la même règle qu'au chemin
      // authentifié, et elle vaut d'autant plus ici qu'il n'y a personne
      // derrière l'appel.
      const offer: BillingOffer | null = offerById(catalogue, offerId)

      if (offer === null) {
        return { ok: false, reason: 'unknown_offer' }
      }

      /**
       * **Le second seau, celui qui borne le coût total** (constat F3 de la
       * revue de s24).
       *
       * Il est compté **après** les deux refus, et jamais avant : le seau
       * global ne doit contenir que ce qui allait réellement coûter quelque
       * chose. Y compter les martèlements refusés rendrait à un seul appelant
       * le pouvoir d'envoyer tous les autres visiteurs à la connexion.
       *
       * Saturé, il **dégrade** au lieu de refuser : le tunnel anonyme n'est pas
       * ouvert — donc rien n'est créé, ni chez le fournisseur, ni ici — et le
       * visiteur repart par la connexion avec son offre en poche, ce qui était
       * le comportement d'avant s24. Où mène cette porte est décidé par le
       * point de composition : ce module ne connaît pas `auth` et ne sait pas
       * ce qu'est un écran de connexion.
       */
      const globalHits = await throttle.hit({
        bucket: GUEST_CHECKOUT_GLOBAL_BUCKET,
        max: GUEST_CHECKOUT_RATE_LIMIT.maxGlobal,
        windowStart,
      })

      if (exceedsCheckoutRateLimit(globalHits, GUEST_CHECKOUT_RATE_LIMIT.maxGlobal)) {
        return { ok: true, url: guestFallbackUrl({ offerId: offer.id, locale }) }
      }

      const guestScopeId = generateGuestScopeId()
      const reference = guestScopeReference(guestScopeId)
      const mode: CheckoutMode = offer.mode === 'one_time' ? 'payment' : 'subscription'

      const checkout = await payments.createCheckout({
        priceId: offer.priceId,
        mode,
        // **Jamais de siège pour un invité** : il n'a pas d'organisation, et une
        // quantité reçue du navigateur serait un prix reçu du navigateur.
        quantity: 1,
        customerId: null,
        // **Aucune adresse** : nous n'en avons pas. C'est le fournisseur qui la
        // collecte, et c'est elle qui reviendra dans l'événement.
        customerEmail: null,
        reference,
        successUrl: guestReturnUrl('?checkout=success'),
        cancelUrl: guestReturnUrl('?checkout=cancelled'),
        // **L'essai entier** : ce périmètre n'a aucun abonnement, puisqu'il
        // vient de naître (ADR 044).
        trialPeriodDays: trialDaysFor(offer.trialDays, []),
        locale,
        idempotencyKey: `checkout:${reference}:${offer.id}`,
      })

      if (!checkout.ok) {
        return { ok: false, reason: 'provider_unavailable' }
      }

      const customer = await repository.linkGuestCustomer({
        id: generateId(),
        guestScopeId,
        providerCustomerId: checkout.checkout.customerId,
      })

      if (offer.mode === 'one_time') {
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
      // **Les abonnements du périmètre, lus une fois**, et deux décisions en
      // dépendent : la fermeture du catalogue (s20) et les jours d'essai
      // (s21). Une seconde lecture ferait deux vérités.
      const subscriptions =
        existing === null ? [] : await repository.subscriptionsOfCustomer(existing.id)

      if (existing !== null && offer.mode === 'subscription') {
        const at = now()
        const current = currentSubscriptionOf(subscriptions, at)

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
        // **L'essai commence une fois par périmètre** (s21, ADR 044). Le
        // fournisseur n'en garde aucune mémoire : c'est ce nombre-ci, posé à
        // chaque ouverture, qui rouvrait quatorze jours indéfiniment. La règle
        // est dans le `domain`, la trace est dans le cache.
        trialPeriodDays: trialDaysFor(offer.trialDays, subscriptions),
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

      /**
       * **La promotion d'une ligne invitée** (s24, ADR 047).
       *
       * Les deux formes de complétion la portent : `checkout_completed` pour un
       * abonnement, `purchase_paid` pour un achat unique. C'est la **seule**
       * différence entre le parcours invité et le parcours authentifié à la
       * réception d'un événement — la ligne client, elle, existe depuis
       * l'ouverture du tunnel dans les deux cas (ADR 034).
       */
      const promoted =
        event.kind === 'checkout_completed' || event.kind === 'purchase_paid'
          ? await guestPromotionFor(event.customerId, event.customerEmail)
          : null

      const applied = await repository.applyEvent({
        eventId: event.id,
        type: event.kind === 'unhandled' ? event.type : event.kind,
        effect: await effectOf(event),
        promotion: promoted?.promotion ?? null,
      })

      /**
       * **Le lien part une fois, et seulement si la promotion a eu lieu.**
       *
       * `applied` vaut `false` sur un rejeu — l'identifiant d'événement était
       * déjà journalisé —, et un second email pour un paiement déjà traité est
       * exactement ce que le critère 6 refuse. La nature du lien est décidée
       * par le point de composition : ce module ne sait pas ce qu'est un mot de
       * passe.
       */
      if (applied && promoted !== null) {
        await guestAccounts.sendAccessLink({ account: promoted.account, email: promoted.email })
      }

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
     * **Ce que le gating interroge**, et rien de plus (s21, ADR 043).
     *
     * Aucune permission n'est consultée, et c'est délibéré : `canManage` dit
     * qui a le droit de **gérer** la facturation — souscrire, ouvrir le
     * portail —, pas qui a le droit d'**utiliser** ce que le périmètre a payé.
     * Un `member` d'une organisation abonnée doit accéder aux fonctionnalités
     * de l'offre sans pouvoir la résilier ; confondre les deux ferait payer
     * l'organisation pour une seule personne.
     *
     * Périmètre non résolu, ou aucun client chez le fournisseur : aucune offre,
     * et **aucune lecture inutile**.
     */
    subscriptionOf: async (scope) => {
      const at = now()
      const customer = await repository.customerForScope(scope)
      const subscriptions =
        customer === null ? [] : await repository.subscriptionsOfCustomer(customer.id)
      // **La même règle que la vue** : « lequel est *le* sien » est une
      // décision du `domain`, pas une requête, et deux copies divergeraient.
      const subscription = currentSubscriptionOf(subscriptions, at)

      return {
        offerId: subscription?.offerId ?? null,
        state: displayStateOf(subscription, at),
      }
    },

    entitledOffers: async ({ session }) => {
      const scope = await ownerOf(session)

      if (scope === null) {
        return []
      }

      const customer = await repository.customerForScope(scope)

      if (customer === null) {
        return []
      }

      return entitledOfferIds(
        await repository.subscriptionsOfCustomer(customer.id),
        await repository.purchasesOfCustomer(customer.id),
        now(),
      )
    },

    /**
     * **La quantité facturée, portée au nombre de membres visé** (s23, ADR 046).
     *
     * Elle est appelée dans la transaction qui vient d'écrire l'appartenance et
     * *avant* sa validation : c'est ce qui rend le critère 6 vrai — un
     * fournisseur en panne n'ajoute personne. Le prix de cet ordre est écrit là
     * où il se paie, dans
     * `packages/modules/organizations/src/infrastructure/drizzle-organization-repositories.ts`.
     *
     * Quatre raisons de ne rien faire, et aucune n'est un échec : périmètre
     * compte, pas de client, pas d'abonnement vivant, offre qui ne suit pas les
     * sièges. Les confondre avec un échec annulerait des écritures parfaitement
     * légitimes.
     */
    syncSeats: async ({ scope, seats, adds = false }) => {
      // **Le forfait** (critère 8) : un périmètre compte n'a pas de membres, et
      // le module `organizations` peut être coupé. Rien à synchroniser.
      if (scope.kind !== 'organization') {
        return { status: 'not_applicable' }
      }

      const quantity = billableSeats(seats)

      if (quantity === null) {
        return { status: 'not_applicable' }
      }

      const customer = await repository.customerForScope(scope)

      if (customer === null) {
        return { status: 'not_applicable' }
      }

      const at = now()
      const current = currentSubscriptionOf(
        await repository.subscriptionsOfCustomer(customer.id),
        at,
      )

      // Un abonnement qui n'accorde plus rien ne se corrige pas : le facturer
      // au nombre de membres rouvrirait une ligne annulée.
      if (current === null || !grantsAccess(current, at)) {
        return { status: 'not_applicable' }
      }

      const offer = offerForPrice(catalogue, current.priceId)

      if (offer === null) {
        return { status: 'not_applicable' }
      }

      /**
       * **Le plafond, et il passe avant `offerSyncsSeats`** (s47, décision 2).
       *
       * L'ordre est la décision. `offerSyncsSeats` est faux sur une offre au
       * forfait — elle n'a aucune quantité à corriger —, si bien que placer le
       * plafond après lui rendrait **illimitée** toute offre au forfait. Or
       * plafonner un forfait est l'emploi le plus courant d'un plafond :
       * « jusqu'à cinq membres », prix fixe. Les deux règles répondent à deux
       * questions, elles n'ont pas la même condition.
       *
       * Le plafond ne mord que sur un **ajout**, et seulement quand une offre
       * courante existe : sans abonnement vivant, la fonction est déjà sortie
       * plus haut en `not_applicable`, et c'est voulu — faire dépendre l'ajout
       * d'un membre d'un état de facturation transitoire (essai expiré,
       * abonnement clos) coûterait plus cher que le plafond ne rapporte.
       */
      const limit = offerSeatLimit(offer)

      if (limit !== null && adds && exceedsSeatLimit(quantity, limit)) {
        // Le plafond reste **ici** : c'est le seul endroit qui connaisse
        // l'offre, et rien au-dessus ne sait encore quoi en faire (M2).
        return { status: 'over_limit' }
      }

      if (!offerSyncsSeats(offer)) {
        return { status: 'not_applicable' }
      }

      const written = await payments.updateSubscriptionQuantity({
        subscriptionId: current.providerSubscriptionId,
        // **La cible, jamais un delta.**
        quantity,
        idempotencyKey: seatIdempotencyKey(scope, current.providerSubscriptionId, quantity),
      })

      // L'échec est une **valeur**, et le compilateur oblige à la regarder :
      // c'est elle qui annule la transaction de l'appelant.
      return written.ok ? { status: 'synced', quantity } : { status: 'failed' }
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
    cancelSubscriptions: async (scope) => {
      const customer = await repository.customerForScope(scope)

      if (customer === null) {
        return { status: 'not_applicable' }
      }

      const at = now()
      const subscriptions = await repository.subscriptionsOfCustomer(customer.id)
      // Ceux qui **accordent encore quelque chose** : un abonnement déjà annulé
      // ou expiré n'a rien à annuler, et le rejouer chez le fournisseur
      // rendrait `not_found` sur une ligne d'historique.
      const live = subscriptions.filter((subscription) => grantsAccess(subscription, at))

      let cancelled = 0

      for (const subscription of live) {
        const outcome = await payments.cancelSubscription({
          subscriptionId: subscription.providerSubscriptionId,
          // **Dérivée de la cible**, comme celle de la quantité : deux
          // annulations du même abonnement sont le même appel, et un rejeu
          // converge au lieu d'échouer.
          idempotencyKey: `cancel:${subscription.providerSubscriptionId}`,
        })

        if (!outcome.ok) {
          // **L'échec interrompt** (`docs/reliability.md` §3) : l'appelant
          // n'efface rien, et l'opération se rejoue. Les annulations déjà
          // faites sont idempotentes, le rejeu ne les compte pas deux fois.
          return { status: 'failed', cancelled }
        }

        cancelled += 1
      }

      return cancelled === 0 ? { status: 'not_applicable' } : { status: 'cancelled', cancelled }
    },

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

        /**
         * **Ici le sens de la vérité s'inverse, et pour ce seul champ**
         * (ADR 046).
         *
         * Partout ailleurs dans cette commande, le fournisseur fait foi et le
         * cache est réécrit (ADR 034). Pour la quantité d'une offre facturée au
         * siège, c'est **le nombre de membres** qui fait foi : la quantité est
         * une valeur dérivée, et un écart est une erreur *chez le
         * fournisseur*, pas chez nous. Réécrire le nombre de membres avec la
         * quantité Stripe propagerait l'erreur au lieu de la corriger.
         *
         * La lecture des membres **peut lever**, et on la laisse faire : un
         * silence de notre base interrompt la commande, il ne réduit pas une
         * facture. C'est la même prudence que « la réconciliation n'efface
         * jamais », appliquée au sens opposé.
         */
        /**
         * `null` pour une ligne **invitée** (ADR 047) : un paiement dont le
         * webhook n'a pas encore promu la ligne n'appartient à aucun compte.
         * Ses abonnements se réconcilient quand même — ils sont bien à ce
         * client —, mais aucun nombre de membres ne les concerne, et lui
         * fabriquer un `user:<jeton>` ferait interroger le compteur de sièges
         * sur un compte qui n'existe pas.
         */
        const scope = scopeOfCustomer(customer)
        const seats = scope === null ? null : await seatsOfScope(scope)
        const aligned: PaymentSubscription[] = []

        for (const subscription of listed.subscriptions) {
          const corrected =
            scope === null
              ? { subscription, written: false }
              : await alignSeats(subscription, scope, seats, at)

          aligned.push(corrected.subscription)
          changed += corrected.written ? 1 : 0
        }

        changed += await repository.replaceSubscriptions({
          billingCustomerId: customer.id,
          subscriptions: aligned.map((subscription) =>
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
