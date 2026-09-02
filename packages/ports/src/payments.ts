/**
 * Le port `Payments` — la deuxième dépendance externe passée derrière une
 * interface dans cet arbre (ADR 008), et un héritier du gabarit posé par
 * `mailer.ts`.
 *
 * Les quatre choix de forme du gabarit sont repris tels quels et ne sont pas
 * redémontrés ici : un fichier par capacité dans un seul package de ports, un
 * résultat discriminé plutôt qu'une exception, les collaborateurs injectés, la
 * forme du journal fermée. Ce qui suit dit ce que ce port-ci ajoute.
 *
 * **Quatre opérations, et la liste se justifie.** Le critère 2 de la story en
 * nomme trois — « checkout, portail et traitement de webhook ». La quatrième,
 * `listSubscriptions`, existe parce que `docs/reliability.md` §5 exige une
 * commande de réconciliation pour « toute divergence possible avec un système
 * externe », et qu'on ne réconcilie pas sans relire. Elle est hors du chemin
 * nominal : aucun webhook ne l'appelle (ADR 034).
 *
 * **Ce port ne connaît pas les offres.** Il reçoit un identifiant de prix du
 * fournisseur, jamais un montant ni une devise : le catalogue est une affaire
 * de configuration et de domaine, et le prix fait foi chez le fournisseur. Un
 * port qui porterait un montant inviterait quelqu'un à le lui passer depuis un
 * navigateur.
 *
 * **Ce port ne décide de rien.** Il ne dit ni qui a le droit de souscrire, ni
 * ce qu'un statut donne comme accès, ni dans quel ordre appliquer deux
 * événements. Ces trois règles sont dans le `domain` du module qui les porte.
 */

/* -------------------------------------------------------------------------- *
 * Erreurs
 * -------------------------------------------------------------------------- */

/**
 * Pourquoi un appel a échoué — et, indissociablement, **s'il faut le rejouer**.
 *
 * Même règle que `MailerErrorCode` : `docs/reliability.md` §3 interdit de
 * rejouer une erreur de validation, donc un code de plus oblige à dire de quel
 * côté il tombe. C'est `isTransientPaymentsError`, chez l'implémentation, qui
 * lit cette partition.
 */
export type PaymentsErrorCode =
  /** Requête refusée par le fournisseur (prix inconnu, paramètre invalide). Définitif. */
  | 'invalid_request'
  /** Clé absente, révoquée ou sans droit. Définitif — rejouer ne la rendra pas valide. */
  | 'unauthorized'
  /**
   * Signature de webhook invalide, absente ou hors de la fenêtre de tolérance.
   *
   * Un code à part, et ce n'est pas de la coquetterie : c'est le seul échec de
   * ce port qui doive se traduire en **400 sans le moindre effet de bord**
   * (`docs/security.md` §4). Le confondre avec `invalid_request` rendrait
   * indiscernables « Stripe a refusé notre requête » et « quelqu'un a forgé un
   * événement ».
   */
  | 'invalid_signature'
  /** L'objet demandé n'existe pas chez le fournisseur. Définitif, et ce n'est pas une panne. */
  | 'not_found'
  /** Quota atteint. Transitoire. */
  | 'rate_limited'
  /** Fournisseur en panne ou injoignable. Transitoire. */
  | 'provider_unavailable'
  /** Délai d'attente dépassé (`docs/reliability.md` §3). Transitoire. */
  | 'timeout'

/**
 * L'échec, tel que l'appelant le reçoit.
 *
 * `message` est destiné à l'humain qui lit un journal : il est **assaini** par
 * l'implémentation (`docs/security.md` §5). Ni clé d'API, ni secret de webhook,
 * ni URL de session signée, ni identifiant de client ne doivent pouvoir y
 * transiter, y compris quand c'est le fournisseur qui les a mis dans le sien.
 */
export interface PaymentsError {
  readonly code: PaymentsErrorCode
  readonly message: string
  /** Nombre de tentatives réellement faites, reprises comprises. */
  readonly attempts: number
}

/* -------------------------------------------------------------------------- *
 * Checkout
 * -------------------------------------------------------------------------- */

/**
 * Ce que le code métier demande pour ouvrir un paiement.
 *
 * `priceId` et `quantity` viennent du **serveur** : le premier du catalogue
 * typé, la seconde d'une résolution serveur (nombre de sièges). Ce qui vient du
 * navigateur est un identifiant d'offre, et il ne franchit pas cette frontière.
 *
 * `customerId` est **nullable et rendu en retour** : c'est le mécanisme qui
 * ferme le désordre des événements (ADR 034). L'appelant qui n'a pas encore de
 * client en obtient un, l'écrit, et tout événement ultérieur retrouve son
 * propriétaire quel que soit son ordre d'arrivée.
 *
 * `reference` est posé sur la session à fin de **diagnostic**. Il n'autorise
 * rien : une valeur modifiable depuis le tableau de bord du fournisseur ne peut
 * pas décider de qui accède à quoi.
 */
export interface CreateCheckoutInput {
  readonly priceId: string
  /** Seul `subscription` est livré par s19 ; `payment` est la story s20. */
  readonly mode: 'subscription'
  readonly quantity: number
  readonly customerId: string | null
  /** Sert à créer le client quand il n'existe pas encore. Jamais affiché. */
  readonly customerEmail: string | null
  readonly reference: string
  readonly successUrl: string
  readonly cancelUrl: string
  /** Période d'essai, en jours, ou `null`. Vient du catalogue, jamais du client. */
  readonly trialPeriodDays: number | null
  /** Langue de la page hébergée, ou `null` pour laisser le fournisseur décider. */
  readonly locale: string | null
  /**
   * Clé d'idempotence de **cet** appel, injectée.
   *
   * Injectée et non tirée par l'implémentation : c'est ce qui permet à un
   * appelant de rejouer le même checkout sans en ouvrir deux, et à un test de
   * compter les tirages. Une seule clé vaut pour toutes les tentatives d'un
   * appel (`docs/reliability.md` §1).
   */
  readonly idempotencyKey: string
}

/** Où envoyer le navigateur, et le client auquel ce paiement est rattaché. */
export interface Checkout {
  readonly url: string
  readonly customerId: string
}

export type CreateCheckoutResult =
  | { readonly ok: true; readonly checkout: Checkout }
  | { readonly ok: false; readonly error: PaymentsError }

/* -------------------------------------------------------------------------- *
 * Portail client
 * -------------------------------------------------------------------------- */

export interface CreatePortalSessionInput {
  readonly customerId: string
  readonly returnUrl: string
}

export interface PortalSession {
  readonly url: string
}

export type CreatePortalSessionResult =
  | { readonly ok: true; readonly session: PortalSession }
  | { readonly ok: false; readonly error: PaymentsError }

/* -------------------------------------------------------------------------- *
 * Abonnement
 * -------------------------------------------------------------------------- */

/**
 * L'état d'un abonnement, **union fermée**.
 *
 * Le fournisseur, lui, ne ferme pas la sienne : `stripe@22.6.0` déclare
 * `status: … | OtherString` (relevé dans le paquet installé). L'implémentation
 * **retombe fermé** — un statut qu'elle ne connaît pas devient `incomplete`,
 * qui n'accorde aucun accès. Un repli ouvert accorderait un droit sur une
 * valeur que personne n'a lue.
 */
export type PaymentStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'paused'

/**
 * Un abonnement, normalisé.
 *
 * `currentPeriodEnd` est **la fin de la période payée**, et c'est le champ le
 * plus dangereux de ce fichier : depuis la version d'API du paquet installé, il
 * ne vit plus sur l'objet abonnement du fournisseur mais sur ses **lignes**
 * (recherche §2.2). Le normaliser ici est ce qui empêche chaque appelant de
 * refaire l'erreur.
 */
export interface PaymentSubscription {
  readonly id: string
  readonly customerId: string
  readonly priceId: string
  readonly quantity: number
  readonly status: PaymentStatus
  readonly currentPeriodEnd: Date
  readonly cancelAtPeriodEnd: boolean
  readonly trialEnd: Date | null
}

export interface ListSubscriptionsInput {
  readonly customerId: string
}

export type ListSubscriptionsResult =
  | { readonly ok: true; readonly subscriptions: readonly PaymentSubscription[] }
  | { readonly ok: false; readonly error: PaymentsError }

/* -------------------------------------------------------------------------- *
 * Webhook
 * -------------------------------------------------------------------------- */

/**
 * Ce qu'un événement entrant devient une fois vérifié — **et rien de plus**.
 *
 * Quatre formes, dont une pour ce qu'on ne traite pas. `unhandled` est
 * délibérément une **valeur** et non une absence : un événement qu'on ne traite
 * pas doit quand même être journalisé par son identifiant, sinon un rejeu le
 * ferait retraverser la chaîne pour rien, et le fournisseur en enverra toujours
 * plus qu'on n'en a demandé.
 *
 * `occurredAt` est l'horodatage de l'événement chez le fournisseur. C'est lui
 * qui ordonne (ADR 034), pas l'heure d'arrivée : deux événements livrés en
 * désordre arrivent dans le désordre, ils n'ont pas été *créés* dans le
 * désordre.
 */
export type PaymentEvent =
  | {
      readonly kind: 'checkout_completed'
      readonly id: string
      readonly occurredAt: Date
      readonly reference: string | null
      readonly customerId: string | null
      readonly subscriptionId: string | null
    }
  | {
      readonly kind: 'subscription_changed'
      readonly id: string
      readonly occurredAt: Date
      readonly subscription: PaymentSubscription
    }
  | {
      readonly kind: 'payment_failed'
      readonly id: string
      readonly occurredAt: Date
      readonly customerId: string | null
      readonly subscriptionId: string | null
    }
  | {
      readonly kind: 'unhandled'
      readonly id: string
      readonly occurredAt: Date
      readonly type: string
    }

/**
 * Ce que l'implémentation reçoit pour vérifier une signature.
 *
 * `payload` est le corps **brut**, tel qu'il est arrivé. Le reparser puis le
 * resérialiser change un octet et invalide la signature : c'est l'erreur que le
 * message d'erreur du fournisseur nomme lui-même.
 */
export interface VerifyWebhookInput {
  readonly payload: string
  readonly signature: string
}

export type VerifyWebhookResult =
  | { readonly ok: true; readonly event: PaymentEvent }
  | { readonly ok: false; readonly error: PaymentsError }

/* -------------------------------------------------------------------------- *
 * Le port
 * -------------------------------------------------------------------------- */

/** Les opérations du port, nommées — c'est ce que le journal a le droit de dire. */
export type PaymentsOperation =
  | 'create_checkout'
  | 'create_portal_session'
  | 'verify_webhook'
  | 'list_subscriptions'

/**
 * La seule surface que le code métier appelle pour parler au fournisseur de
 * paiement.
 *
 * Aucune méthode ne lève : l'échec est une valeur. Un port qui lèverait
 * laisserait l'appelant rendre un 500 sur une panne de tiers, là où
 * `docs/reliability.md` §2 demande une dégradation.
 */
export interface Payments {
  createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>
  createPortalSession(input: CreatePortalSessionInput): Promise<CreatePortalSessionResult>
  verifyWebhook(input: VerifyWebhookInput): Promise<VerifyWebhookResult>
  listSubscriptions(input: ListSubscriptionsInput): Promise<ListSubscriptionsResult>
}

/**
 * Ce qu'une implémentation a le droit de journaliser d'un échec.
 *
 * La forme est fermée, et c'est la première ligne de défense de
 * `docs/security.md` §5 : il n'y a **aucun champ** où mettre une clé d'API, un
 * secret de webhook, une URL de session, un identifiant de client ou un
 * montant. Le compilateur refuse de les journaliser ; il ne peut rien pour
 * `message`, qui vient du fournisseur — d'où l'assainissement, prouvé par
 * mutation côté adaptateur.
 */
export interface PaymentsLogRecord {
  readonly event: 'payments.call_failed' | 'payments.call_retried'
  readonly operation: PaymentsOperation
  readonly code: PaymentsErrorCode
  readonly attempts: number
  readonly message: string
}

/** Le journal, injecté. Une fonction plutôt qu'une interface : il n'écrit que. */
export type PaymentsLogger = (record: PaymentsLogRecord) => void
