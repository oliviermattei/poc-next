import type { ModuleScope } from '@repo/core'
import { and, desc, eq, gte, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type {
  BillingCustomerRecord,
  BillingRepository,
  EndingTrial,
  PlatformPurchaseRow,
  PlatformSubscriptionRow,
  PurchaseReconcileWrite,
  PurchaseRecord,
  SubscriptionRecord,
  SubscriptionWrite,
} from '../application/ports'
import { GUEST_SCOPE_KIND } from '../domain/guest'
import { reconciledPurchaseStatus, type PurchaseStatus } from '../domain/purchase'
import type { SubscriptionStatus } from '../domain/subscription'
import {
  billingCustomer,
  billingPurchase,
  billingPurchaseSession,
  billingRefundedPayment,
  billingSubscription,
  billingWebhookEvent,
} from '../schema'

/**
 * Le repository du module, sur **ses** tables.
 *
 * La connexion est **injectée** : ce package ne dépend pas de `@repo/db`, et
 * c'est ce qui empêche le cycle `@repo/db` → agrégat généré → module (ADR 020).
 * Le type est réduit aux opérations employées, comme dans `auth`,
 * `organizations` et `marketing` : un `NodePgDatabase<TSchema>` complet
 * porterait le schéma des autres modules dans son type.
 */

/**
 * **L'ordre de lecture des abonnements d'un client, écrit une seule fois.**
 *
 * Il est exporté parce qu'un second appelant en a besoin, et un seul :
 * `tests/billing.test.ts` le passe à `EXPLAIN` pour vérifier que l'index
 * `billing_subscription_customer_idx` le **sert** — le plan portait un `Sort`
 * par-dessus l'index, l'ordre des `NULL` ne correspondant pas (constat m1 de la
 * seconde revue). Le réécrire là-bas ferait deux vérités, et la première à
 * diverger serait celle qui mesure.
 */
export const subscriptionReadOrder = [
  desc(billingSubscription.lastEventAt),
  desc(billingSubscription.currentPeriodEnd),
  desc(billingSubscription.providerSubscriptionId),
]

/**
 * **L'ordre de lecture des achats d'un client, écrit une seule fois.**
 *
 * Deux clés, dont la dernière est la clé primaire : l'ordre est **total**, et
 * il correspond exactement à `billing_purchase_customer_idx`. Exporté pour la
 * même raison que celui des abonnements — `tests/billing.test.ts` le passe à
 * `EXPLAIN` pour vérifier que l'index le sert, et le réécrire là-bas ferait
 * deux vérités.
 */
export const purchaseReadOrder = [desc(billingPurchase.createdAt), desc(billingPurchase.id)]

/**
 * **Le prédicat d'ordre d'un achat**, en SQL — ce que `appliesAfter` nomme dans
 * le `domain` (ADR 034 §2).
 *
 * `last_event_at` est **nullable** ici, contrairement à celui d'un abonnement :
 * une ligne en attente ne vient d'aucun événement. `NULL <= x` vaut `NULL`,
 * donc faux, et sans ce `or` la toute première promotion n'écrirait jamais
 * rien. C'est exactement `appliesAfter(null, …) === true`, dit une seconde fois
 * parce qu'il y a deux mécanismes.
 */
const purchaseAppliesAfter = (occurredAt: Date): SQL | undefined =>
  or(isNull(billingPurchase.lastEventAt), lte(billingPurchase.lastEventAt, occurredAt))

/**
 * **L'achat auquel une session de checkout appartient** — l'index inverse
 * d'abord, l'ancien emplacement **à défaut**.
 *
 * `billing_purchase.provider_session_id` ne porte que la dernière ouverture ;
 * `billing_purchase_session` les porte toutes. Un paiement encaissé sur une
 * session supplantée par une reprise est donc rattaché à son achat au lieu de
 * se perdre — c'est le constat C1 de la revue de s20, et c'est la raison d'être
 * de l'index inverse.
 *
 * **Le repli sur la colonne est transitoire, et il est obligatoire** (constat
 * C4). `docs/reliability.md` demande qu'une migration soit rétrocompatible avec
 * la version qui sert encore : pendant la bascule, l'ancienne version continue
 * d'ouvrir des checkouts **sans** écrire dans l'index inverse, que le
 * rattrapage de la migration `0004` ne pouvait pas connaître — il ne reporte
 * que les sessions présentes à l'instant où il passe. Lire les deux
 * emplacements est ce que « ajouter avant de lire » exige ; sans ce repli, une
 * session ouverte dans cette fenêtre et payée après la bascule rejouerait C1
 * mot pour mot, pendant le déploiement censé le refermer.
 *
 * Les deux branches ne peuvent pas désigner deux achats différents : la colonne
 * est unique, et `openPurchase` écrit les deux emplacements pour la même ligne.
 *
 * **À retirer** une fois l'ancienne version hors ligne — c'est le « cesser
 * d'écrire avant de supprimer » de la même section, et il demande un tour
 * ultérieur, pas une décision d'ici.
 *
 * Un seul prédicat pour les **deux** lecteurs — la confirmation et la
 * réconciliation. Deux formulations feraient deux vérités, et la seconde revue
 * a mesuré ce que coûte la moitié non prouvée (constat C3).
 *
 * Écrit en sous-requête plutôt qu'en jointure : une transaction de ce module
 * **n'a pas le droit de lire** (voir `TransactionalWriter`), et une lecture
 * suivie d'une décision rouvrirait la fenêtre de concurrence que
 * `docs/reliability.md` §1 refuse.
 */
const purchaseOfSession = (providerSessionId: string): SQL =>
  sql`(${billingPurchase.id} = (
    select ${billingPurchaseSession.billingPurchaseId}
    from ${billingPurchaseSession}
    where ${billingPurchaseSession.providerSessionId} = ${providerSessionId}
  ) or ${billingPurchase.providerSessionId} = ${providerSessionId})`

/**
 * Ce qu'une transaction de ce module fait, et rien de plus : elle journalise et
 * elle écrit. Elle ne lit pas — la décision d'ordre est dans le prédicat de
 * l'écriture, pas dans une lecture préalable.
 */
type TransactionalWriter = Pick<PgDatabase<PgQueryResultHKT>, 'insert' | 'update'>

export type BillingDatabase = Pick<
  PgDatabase<PgQueryResultHKT>,
  'select' | 'insert' | 'update' | 'delete'
> & {
  /**
   * La transaction, **réduite à ce qu'on en fait**.
   *
   * Reprendre la signature de `PgDatabase` rendrait le type invariant sur le
   * schéma : une connexion construite avec les tables de plusieurs modules
   * n'est pas assignable à une connexion typée sans schéma — mesuré en s15, et
   * de nouveau ici. Un module n'a pas à connaître les tables des autres pour
   * recevoir une connexion.
   */
  transaction<T>(run: (writer: TransactionalWriter) => Promise<T>): Promise<T>
}

const scopeColumns = (scope: ModuleScope): { kind: ModuleScope['kind']; id: string } =>
  scope.kind === 'organization'
    ? { kind: 'organization', id: scope.organizationId }
    : { kind: 'user', id: scope.userId }

/**
 * Le statut d'un achat encaissé, écrit une fois — et **tiré du vocabulaire du
 * domaine**, jamais d'un littéral libre : un mot recopié ici divergerait du
 * jour où l'union en changerait.
 */
const PAID_PURCHASE_STATUS: PurchaseStatus = 'paid'

const CUSTOMER_COLUMNS = {
  id: billingCustomer.id,
  scopeKind: billingCustomer.scopeKind,
  scopeId: billingCustomer.scopeId,
  providerCustomerId: billingCustomer.providerCustomerId,
}

const SUBSCRIPTION_COLUMNS = {
  providerSubscriptionId: billingSubscription.providerSubscriptionId,
  billingCustomerId: billingSubscription.billingCustomerId,
  offerId: billingSubscription.offerId,
  priceId: billingSubscription.priceId,
  status: billingSubscription.status,
  quantity: billingSubscription.quantity,
  currentPeriodEnd: billingSubscription.currentPeriodEnd,
  cancelAtPeriodEnd: billingSubscription.cancelAtPeriodEnd,
  trialEnd: billingSubscription.trialEnd,
  lastEventAt: billingSubscription.lastEventAt,
  lastEventId: billingSubscription.lastEventId,
}

const asCustomer = (row: Record<string, unknown> | undefined): BillingCustomerRecord | null =>
  row === undefined ? null : (row as unknown as BillingCustomerRecord)

const asSubscription = (row: Record<string, unknown> | undefined): SubscriptionRecord | null =>
  row === undefined ? null : (row as unknown as SubscriptionRecord)

const PURCHASE_COLUMNS = {
  id: billingPurchase.id,
  billingCustomerId: billingPurchase.billingCustomerId,
  offerId: billingPurchase.offerId,
  priceId: billingPurchase.priceId,
  providerSessionId: billingPurchase.providerSessionId,
  providerPaymentId: billingPurchase.providerPaymentId,
  status: billingPurchase.status,
  amount: billingPurchase.amount,
  currency: billingPurchase.currency,
  purchasedAt: billingPurchase.purchasedAt,
  refundedAt: billingPurchase.refundedAt,
  lastEventAt: billingPurchase.lastEventAt,
  lastEventId: billingPurchase.lastEventId,
}

const asPurchase = (row: Record<string, unknown> | undefined): PurchaseRecord | null =>
  row === undefined ? null : (row as unknown as PurchaseRecord)

/** Les colonnes qu'une réconciliation d'achat compare. Le reste est technique. */
const purchaseDiffers = (
  stored: PurchaseRecord,
  write: PurchaseReconcileWrite,
  status: PurchaseStatus,
): boolean =>
  stored.status !== status ||
  stored.providerPaymentId !== write.providerPaymentId ||
  stored.amount !== write.amount ||
  stored.currency !== write.currency

/** Les colonnes qu'une réconciliation compare. Le reste est dérivé ou technique. */
const differs = (stored: SubscriptionRecord, write: SubscriptionWrite): boolean =>
  stored.status !== write.status ||
  stored.quantity !== write.quantity ||
  stored.priceId !== write.priceId ||
  stored.offerId !== write.offerId ||
  stored.cancelAtPeriodEnd !== write.cancelAtPeriodEnd ||
  stored.currentPeriodEnd.getTime() !== write.currentPeriodEnd.getTime() ||
  (stored.trialEnd?.getTime() ?? null) !== (write.trialEnd?.getTime() ?? null)

export function createDrizzleBillingRepository(db: BillingDatabase): BillingRepository {
  const customerForScope = async (
    connection: BillingDatabase,
    scope: ModuleScope,
  ): Promise<BillingCustomerRecord | null> => {
    const { kind, id } = scopeColumns(scope)
    const rows = await connection
      .select(CUSTOMER_COLUMNS)
      .from(billingCustomer)
      .where(and(eq(billingCustomer.scopeKind, kind), eq(billingCustomer.scopeId, id)))
      .limit(1)

    return asCustomer(rows[0])
  }

  /**
   * Le remboursement **déjà reçu** pour ce paiement, ou `null`.
   *
   * Lu, et non appliqué dans le prédicat d'une écriture, parce que le seul
   * appelant est la réconciliation : elle n'est pas concurrente — elle est
   * lancée à la main ou par un ordonnanceur —, et elle lit déjà l'état stocké
   * avant de le comparer. La promotion, elle, reste sans lecture : elle rejoue
   * le journal par une sous-requête, dans sa transaction.
   */
  const refundedPayment = async (
    providerPaymentId: string,
  ): Promise<{ readonly refundedAt: Date } | null> => {
    const rows = await db
      .select({ refundedAt: billingRefundedPayment.refundedAt })
      .from(billingRefundedPayment)
      .where(eq(billingRefundedPayment.providerPaymentId, providerPaymentId))
      .limit(1)

    return rows[0] ?? null
  }

  return {
    customerForScope: async (scope) => await customerForScope(db, scope),

    /**
     * **Une contrainte d'unicité, jamais une lecture préalable**
     * (`docs/reliability.md` §1).
     *
     * `onConflictDoNothing` sur `(scope_kind, scope_id)` rend une liste vide
     * quand la ligne existait : on relit alors celle qui est là. Deux ouvertures
     * de checkout simultanées passeraient toutes les deux un `select` ; elles ne
     * passent pas cette contrainte, et le périmètre ne se retrouve pas avec deux
     * clients — donc deux abonnements payés.
     */
    linkCustomer: async ({ id, scope, providerCustomerId }) => {
      const { kind, id: scopeId } = scopeColumns(scope)
      const rows = await db
        .insert(billingCustomer)
        .values({ id, scopeKind: kind, scopeId, providerCustomerId })
        .onConflictDoNothing({ target: [billingCustomer.scopeKind, billingCustomer.scopeId] })
        .returning(CUSTOMER_COLUMNS)

      const inserted = asCustomer(rows[0])

      if (inserted !== null) {
        return inserted
      }

      const existing = await customerForScope(db, scope)

      if (existing === null) {
        // Inatteignable par construction : le conflit signifie qu'une ligne
        // existe. Levé plutôt que replié, pour qu'un défaut de schéma se voie.
        throw new Error('billing_customer : conflit sur un périmètre introuvable')
      }

      return existing
    },

    /**
     * **Le client d'un périmètre invité** (ADR 047).
     *
     * La même contrainte d'unicité que `linkCustomer`, et la même raison : deux
     * ouvertures simultanées ne doivent pas produire deux clients. Le périmètre
     * étant tiré au hasard à chaque ouverture, le conflit ne peut venir que
     * d'un rejeu de la **même** ouverture — et il converge alors sur la ligne
     * déjà écrite.
     */
    linkGuestCustomer: async ({ id, guestScopeId, providerCustomerId }) => {
      const rows = await db
        .insert(billingCustomer)
        .values({
          id,
          scopeKind: GUEST_SCOPE_KIND,
          scopeId: guestScopeId,
          providerCustomerId,
        })
        .onConflictDoNothing({ target: [billingCustomer.scopeKind, billingCustomer.scopeId] })
        .returning(CUSTOMER_COLUMNS)

      const inserted = asCustomer(rows[0])

      if (inserted !== null) {
        return inserted
      }

      const existing = await db
        .select(CUSTOMER_COLUMNS)
        .from(billingCustomer)
        .where(
          and(
            eq(billingCustomer.scopeKind, GUEST_SCOPE_KIND),
            eq(billingCustomer.scopeId, guestScopeId),
          ),
        )
        .limit(1)

      const found = asCustomer(existing[0])

      if (found === null) {
        // Inatteignable par construction : le conflit signifie qu'une ligne
        // existe. Levé plutôt que replié, pour qu'un défaut de schéma se voie.
        throw new Error('billing_customer : conflit sur un périmètre invité introuvable')
      }

      return found
    },

    customerByProviderId: async (providerCustomerId) => {
      const rows = await db
        .select(CUSTOMER_COLUMNS)
        .from(billingCustomer)
        .where(eq(billingCustomer.providerCustomerId, providerCustomerId))
        .limit(1)

      return asCustomer(rows[0])
    },

    /**
     * **Un ordre total, et il est écrit ici.**
     *
     * Sans `order by`, PostgreSQL rend l'ordre d'insertion — donc l'abonnement
     * **annulé** en premier chez un client qui s'est réabonné, et l'écran
     * disait « expiré » à quelqu'un qui venait de payer (constat F1).
     *
     * Les trois clés en font un ordre **total**, jamais ambigu : l'horodatage
     * d'événement d'abord, la fin de période ensuite — la réconciliation pose
     * le même instant sur toutes les lignes d'un client —, et l'identifiant du
     * fournisseur en dernier, qui est unique par construction. Deux lectures
     * successives rendent donc la même liste, quoi que fasse le moteur.
     *
     * Elle ne choisit pas : `currentSubscriptionOf` (dans le `domain`) décide
     * lequel est *le* sien, parce que celui qui donne l'accès l'emporte sur le
     * plus récent.
     */
    subscriptionsOfCustomer: async (billingCustomerId) =>
      (await db
        .select(SUBSCRIPTION_COLUMNS)
        .from(billingSubscription)
        .where(eq(billingSubscription.billingCustomerId, billingCustomerId))
        .orderBy(...subscriptionReadOrder)) as readonly SubscriptionRecord[],

    /**
     * **Les essais qui se terminent dans la fenêtre**, joints à leur périmètre
     * (s33). La borne haute n'est pas décorative : sans elle, la relance
     * ramènerait tous les essais passés à chaque exécution.
     */
    trialsEndingBetween: async ({ from, to }) =>
      (await db
        .select({
          providerSubscriptionId: billingSubscription.providerSubscriptionId,
          offerId: billingSubscription.offerId,
          status: billingSubscription.status,
          trialEnd: billingSubscription.trialEnd,
          scopeKind: billingCustomer.scopeKind,
          scopeId: billingCustomer.scopeId,
        })
        .from(billingSubscription)
        .innerJoin(billingCustomer, eq(billingSubscription.billingCustomerId, billingCustomer.id))
        .where(
          and(
            eq(billingSubscription.status, 'trialing'),
            gte(billingSubscription.trialEnd, from),
            lte(billingSubscription.trialEnd, to),
          ),
        )
        .orderBy(billingSubscription.providerSubscriptionId)) as readonly EndingTrial[],

    /**
     * **Les achats d'un client, dans un ordre total.** La règle qui décide
     * lequel donne l'accès vit dans le `domain` ; ce port ne fait que lire.
     */
    purchasesOfCustomer: async (billingCustomerId) =>
      (await db
        .select(PURCHASE_COLUMNS)
        .from(billingPurchase)
        .where(eq(billingPurchase.billingCustomerId, billingCustomerId))
        .orderBy(...purchaseReadOrder)) as readonly PurchaseRecord[],

    /**
     * **Toute la plateforme** (s38) — la seule lecture de ce dépôt qui ne porte
     * aucune condition de client.
     *
     * Le périmètre est quand même son **premier paramètre** : il ne restreint
     * rien ici, il dit d'où vient le droit de tout lire — du back-office, jamais
     * d'une requête (`PlatformScope`). Les colonnes sont énumérées, comme
     * partout : ce qui sort d'ici est ce qu'un écran affichera, et aucune
     * référence du fournisseur n'en fait partie.
     */
    platformSubscriptions: async (_scope) =>
      (await db
        .select({
          priceId: billingSubscription.priceId,
          status: billingSubscription.status,
          quantity: billingSubscription.quantity,
          currentPeriodEnd: billingSubscription.currentPeriodEnd,
          cancelAtPeriodEnd: billingSubscription.cancelAtPeriodEnd,
          trialEnd: billingSubscription.trialEnd,
        })
        .from(billingSubscription)) as readonly PlatformSubscriptionRow[],

    /**
     * **Les achats encaissés**, et le filtre est dans la requête.
     *
     * `paid` est le seul statut qui dit qu'un montant a été prélevé
     * (`purchaseGrantsAccess`) : `pending` n'a rien encaissé, `refunded` a été
     * rendu. Filtrer après coup laisserait la porte ouverte à un appelant qui
     * oublierait de le faire.
     */
    platformPaidPurchases: async (_scope, since) =>
      (await db
        .select({ amount: billingPurchase.amount, currency: billingPurchase.currency })
        .from(billingPurchase)
        .where(
          // **La période est dans la requête**, à côté du statut : la borner
          // après la lecture laisserait un appelant l'oublier, et le chiffre
          // resterait plausible. `null` — « depuis le début » — n'ajoute aucune
          // condition, plutôt qu'une date sentinelle que personne ne relit.
          since === null
            ? eq(billingPurchase.status, PAID_PURCHASE_STATUS)
            : and(
                eq(billingPurchase.status, PAID_PURCHASE_STATUS),
                gte(billingPurchase.purchasedAt, since),
              ),
        )) as readonly PlatformPurchaseRow[],

    /**
     * Ouvre — ou rouvre — l'achat d'une offre, **sous la contrainte d'unicité**.
     *
     * `(billing_customer_id, offer_id)` est unique : deux ouvertures
     * simultanées du même achat convergent sur une ligne, et le périmètre ne
     * peut pas se retrouver avec deux achats de la même offre. C'est
     * l'invariant central de s20, et c'est le moteur qui le tient — pas une
     * lecture suivie d'une décision (`docs/reliability.md` §1).
     *
     * `setWhere` refuse de rétrograder une ligne **déjà payée** : une course
     * entre la confirmation d'un achat et une seconde ouverture ne doit pas
     * effacer un encaissement. Le `returning` est alors vide, et on relit la
     * ligne en place.
     *
     * **La reprise repart à zéro**, et pas seulement sur la session : le
     * paiement, le montant, la devise, la date d'achat, la date de
     * remboursement et l'horodatage d'événement du cycle précédent sont
     * remis à `null`. Sans cela, un « payé → remboursé → racheté → payé »
     * rendait un achat `paid` **portant une date de remboursement** : l'écran
     * n'en montrait rien, mais l'export RGPD mentait (constat m2).
     *
     * **La session est aussi écrite dans l'index inverse**, et c'est ce qui
     * rend l'écrasement ci-dessus inoffensif : la session précédente reste
     * rattachée à cet achat, donc payable sans perte (constat C1).
     */
    openPurchase: async ({ id, billingCustomerId, offerId, priceId, providerSessionId }) => {
      const rows = await db
        .insert(billingPurchase)
        .values({
          id,
          billingCustomerId,
          offerId,
          priceId,
          providerSessionId,
          status: 'pending' satisfies PurchaseStatus,
        })
        .onConflictDoUpdate({
          target: [billingPurchase.billingCustomerId, billingPurchase.offerId],
          set: {
            providerSessionId,
            priceId,
            status: 'pending' satisfies PurchaseStatus,
            providerPaymentId: null,
            amount: null,
            currency: null,
            purchasedAt: null,
            refundedAt: null,
            lastEventAt: null,
            lastEventId: null,
            updatedAt: new Date(),
          },
          setWhere: ne(billingPurchase.status, 'paid' satisfies PurchaseStatus),
        })
        .returning(PURCHASE_COLUMNS)

      const written = asPurchase(rows[0])

      if (written !== null) {
        await db
          .insert(billingPurchaseSession)
          .values({ providerSessionId, billingPurchaseId: written.id })
          .onConflictDoNothing({ target: billingPurchaseSession.providerSessionId })

        return written
      }

      const existing = await db
        .select(PURCHASE_COLUMNS)
        .from(billingPurchase)
        .where(
          and(
            eq(billingPurchase.billingCustomerId, billingCustomerId),
            eq(billingPurchase.offerId, offerId),
          ),
        )
        .limit(1)

      const found = asPurchase(existing[0])

      if (found === null) {
        // Inatteignable par construction : le conflit signifie qu'une ligne
        // existe. Levé plutôt que replié, pour qu'un défaut de schéma se voie.
        throw new Error('billing_purchase : conflit sur un achat introuvable')
      }

      // La ligne était déjà payée, donc pas rétrogradée — mais la session que
      // nous venons d'ouvrir existe chez le fournisseur et reste payable. Elle
      // est rattachée elle aussi : un encaissement ne doit jamais tomber sur un
      // achat introuvable.
      await db
        .insert(billingPurchaseSession)
        .values({ providerSessionId, billingPurchaseId: found.id })
        .onConflictDoNothing({ target: billingPurchaseSession.providerSessionId })

      return found
    },

    /**
     * Le journal **et** l'effet, dans une seule transaction.
     *
     * Deux propriétés, et elles sont indissociables :
     *
     * 1. **l'idempotence vient de la clé primaire.** `onConflictDoNothing` rend
     *    une liste vide sur un rejeu, et l'effet n'est alors pas appliqué. Une
     *    lecture préalable laisserait la fenêtre où deux livraisons simultanées
     *    passent toutes les deux ;
     * 2. **l'ordre est dans le prédicat de l'écriture**, pas dans une lecture
     *    suivie d'une décision : `setWhere` compare l'horodatage enregistré à
     *    celui de l'événement. C'est la règle que `appliesAfter` **nomme** dans
     *    le `domain` (ADR 034) ; ici elle **refuse**. Les deux disent `>=` — le
     *    domaine l'énonce, ce prédicat l'applique, et `tests/billing.test.ts` le
     *    prouve contre la base.
     *
     * Un effet en échec annule aussi le journal : le rejeu du fournisseur reste
     * possible. Sans cela, un événement à demi traité serait refusé pour
     * toujours.
     *
     * **Ce que ce `return false` n'est tenu par aucune commande** (constat F5
     * de la revue de s24, à l'intention de la story qui reprendra le journal —
     * s28 pour la limitation de débit, ou celle qui touchera au rejeu) : le
     * déplacer **après** la promotion et les effets ne fait rougir aucun cas à
     * ce jour. L'inertie du rejeu ne s'écroule pas pour autant — elle est
     * portée en propre par les deux gardes de l'écriture juste en dessous
     * (`scope_kind = 'guest'` et `not exists`), et par les `onConflictDoUpdate`
     * des effets, toutes prouvées rouges par mutation. Autrement dit : ce
     * `return` est une **économie**, pas la garantie ; `docs/reliability.md` §1
     * s'appuie pourtant sur ce journal, et le jour où un effet non idempotent
     * entrera dans cette transaction, il faudra le tenir par un cas — mesurer
     * qu'un rejeu n'applique rien, et pas seulement qu'il rend `applied: false`.
     */
    applyEvent: async ({ eventId, type, effect, promotion }) =>
      await db.transaction(async (tx) => {
        const journal = await tx
          .insert(billingWebhookEvent)
          .values({ eventId, type })
          .onConflictDoNothing({ target: billingWebhookEvent.eventId })
          .returning({ eventId: billingWebhookEvent.eventId })

        if (journal.length === 0) {
          return false
        }

        if (promotion !== undefined && promotion !== null) {
          /**
           * **La promotion d'une ligne invitée** (ADR 047), dans la
           * transaction du journal.
           *
           * Trois clauses, et aucune n'est décorative :
           *
           * - `provider_customer_id` désigne la ligne. Il ne change **pas** :
           *   c'est ce qui préserve la garantie d'ordre de l'ADR 034 ;
           * - `scope_kind = 'guest'` est **la** garde. Sans elle, un second
           *   `checkout.session.completed` sur le même client — avec une autre
           *   adresse — repointerait vers un autre compte la ligne d'une
           *   personne déjà promue : sa facturation, ses abonnements et son
           *   droit d'accès changeraient de propriétaire. Elle est aussi ce qui
           *   rend le rejeu inerte au niveau de la base, et pas seulement au
           *   niveau du code ;
           * - le `not exists` évite la **violation d'unicité** quand ce compte
           *   a déjà une ligne client — un visiteur qui paie deux fois sans se
           *   connecter en produit une seconde. Sans lui, l'index
           *   `(scope_kind, scope_id)` ferait lever le webhook, donc un 400
           *   rejoué indéfiniment par le fournisseur, ce que
           *   `docs/reliability.md` §1 interdit. La ligne reste alors invitée,
           *   et son paiement n'est pas perdu : il est chez le fournisseur, et
           *   la réconciliation le voit.
           */
          await tx
            .update(billingCustomer)
            .set({ scopeKind: 'user', scopeId: promotion.userId })
            .where(
              and(
                eq(billingCustomer.providerCustomerId, promotion.providerCustomerId),
                eq(billingCustomer.scopeKind, GUEST_SCOPE_KIND),
                sql`not exists (select 1 from ${billingCustomer} as taken where taken.scope_kind = 'user' and taken.scope_id = ${promotion.userId})`,
              ),
            )
        }

        if (effect.kind === 'subscription') {
          const { write } = effect

          await tx
            .insert(billingSubscription)
            .values({ ...write, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: billingSubscription.providerSubscriptionId,
              set: {
                billingCustomerId: write.billingCustomerId,
                offerId: write.offerId,
                priceId: write.priceId,
                status: write.status,
                quantity: write.quantity,
                currentPeriodEnd: write.currentPeriodEnd,
                cancelAtPeriodEnd: write.cancelAtPeriodEnd,
                trialEnd: write.trialEnd,
                lastEventAt: write.lastEventAt,
                lastEventId: write.lastEventId,
                updatedAt: new Date(),
              },
              // L'ordre, dans le prédicat : un événement plus ancien n'écrase
              // rien. L'égalité passe — deux événements de la même seconde
              // décrivent le même instant (ADR 034).
              setWhere: lte(billingSubscription.lastEventAt, write.lastEventAt),
            })
        }

        if (effect.kind === 'purchase_paid') {
          // **Une mise à jour, jamais une insertion** (ADR 038 §1) : la ligne
          // a été écrite à l'ouverture du checkout, et c'est elle qui porte
          // l'offre. Une session que nous n'avons pas ouverte n'écrit rien —
          // l'événement reste journalisé, donc non rejoué.
          //
          // La ligne est retrouvée par **l'index inverse des sessions**, et à
          // défaut par la colonne de l'achat : une session supplantée par une
          // reprise reste rattachée, et son paiement accorde le droit (constat
          // C1). Le repli sur la colonne est **transitoire** — il couvre les
          // achats ouverts par la version encore en ligne pendant la bascule,
          // qui n'ont pas de ligne de session (constat C4), et se retire quand
          // cette version est hors ligne.
          //
          // `ne(status, 'refunded')` couvre un ordre, et un seul : une
          // confirmation livrée **après** un remboursement déjà appliqué sur
          // cette ligne ne doit pas la rouvrir. L'ordre inverse — le
          // remboursement livré avant la confirmation qu'il annule — ne peut
          // pas passer par cette garde, puisque la ligne n'était alors pas
          // encore marquée : il est rejoué juste en dessous, depuis
          // `billing_refunded_payment` (constat C2).
          await tx
            .update(billingPurchase)
            .set({
              providerPaymentId: effect.providerPaymentId,
              status: 'paid' satisfies PurchaseStatus,
              amount: effect.amount,
              currency: effect.currency,
              purchasedAt: effect.paidAt,
              lastEventAt: effect.lastEventAt,
              lastEventId: effect.lastEventId,
              updatedAt: new Date(),
            })
            .where(
              and(
                purchaseOfSession(effect.providerSessionId),
                ne(billingPurchase.status, 'refunded' satisfies PurchaseStatus),
                purchaseAppliesAfter(effect.lastEventAt),
              ),
            )

          // **Le remboursement arrivé trop tôt, rejoué dans la même
          // transaction.** Rien ici si aucun remboursement n'a été reçu pour ce
          // paiement : le `where` ne trouve alors aucune ligne. Le prédicat
          // n'est pas décoratif — c'est lui qui empêche d'accorder un accès sur
          // un achat intégralement remboursé.
          if (effect.providerPaymentId !== null) {
            await tx
              .update(billingPurchase)
              .set({
                status: 'refunded' satisfies PurchaseStatus,
                refundedAt: sql`(select ${billingRefundedPayment.refundedAt} from ${billingRefundedPayment} where ${billingRefundedPayment.providerPaymentId} = ${effect.providerPaymentId})`,
                lastEventAt: sql`(select ${billingRefundedPayment.lastEventAt} from ${billingRefundedPayment} where ${billingRefundedPayment.providerPaymentId} = ${effect.providerPaymentId})`,
                lastEventId: sql`(select ${billingRefundedPayment.lastEventId} from ${billingRefundedPayment} where ${billingRefundedPayment.providerPaymentId} = ${effect.providerPaymentId})`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(billingPurchase.providerPaymentId, effect.providerPaymentId),
                  sql`exists (select 1 from ${billingRefundedPayment} where ${billingRefundedPayment.providerPaymentId} = ${effect.providerPaymentId})`,
                ),
              )
          }
        }

        if (effect.kind === 'purchase_refunded') {
          // **Écrit d'abord sous la seule clé que le remboursement porte.**
          // `charge.refunded` ne transporte jamais la session de checkout
          // (recherche §2.3), et une ligne encore en attente n'a pas de
          // paiement : sans cette trace, un remboursement livré avant sa
          // confirmation était journalisé — donc jamais rejoué — et perdu
          // (constat C2). La promotion la relit et l'applique.
          await tx
            .insert(billingRefundedPayment)
            .values({
              providerPaymentId: effect.providerPaymentId,
              refundedAt: effect.refundedAt,
              lastEventAt: effect.lastEventAt,
              lastEventId: effect.lastEventId,
            })
            .onConflictDoNothing({ target: billingRefundedPayment.providerPaymentId })

          // Retrouvé **par le paiement**, quand la ligne le porte déjà.
          await tx
            .update(billingPurchase)
            .set({
              status: 'refunded' satisfies PurchaseStatus,
              refundedAt: effect.refundedAt,
              lastEventAt: effect.lastEventAt,
              lastEventId: effect.lastEventId,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(billingPurchase.providerPaymentId, effect.providerPaymentId),
                purchaseAppliesAfter(effect.lastEventAt),
              ),
            )
        }

        if (effect.kind === 'payment_failed') {
          await tx
            .update(billingSubscription)
            .set({
              status: 'past_due' satisfies SubscriptionStatus,
              lastEventAt: effect.lastEventAt,
              lastEventId: effect.lastEventId,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(billingSubscription.providerSubscriptionId, effect.providerSubscriptionId),
                lte(billingSubscription.lastEventAt, effect.lastEventAt),
              ),
            )
        }

        return true
      }),

    listCustomers: async () =>
      (await db.select(CUSTOMER_COLUMNS).from(billingCustomer)) as readonly BillingCustomerRecord[],

    /**
     * La réconciliation : elle **compare avant d'écrire**, et rend le nombre de
     * lignes réellement changées.
     *
     * Lire puis écrire est acceptable ici — et seulement ici : cette commande
     * n'est pas concurrente, elle est lancée à la main ou par un ordonnanceur.
     * Le compte est ce qui rend l'idempotence **observable** : une seconde
     * exécution rend zéro (`docs/reliability.md` §1).
     */
    replaceSubscriptions: async ({ billingCustomerId, subscriptions }) => {
      let changed = 0

      for (const write of subscriptions) {
        const rows = await db
          .select(SUBSCRIPTION_COLUMNS)
          .from(billingSubscription)
          .where(eq(billingSubscription.providerSubscriptionId, write.providerSubscriptionId))
          .limit(1)

        const stored = asSubscription(rows[0])

        if (stored !== null && !differs(stored, write)) {
          continue
        }

        await db
          .insert(billingSubscription)
          .values({ ...write, billingCustomerId, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: billingSubscription.providerSubscriptionId,
            set: {
              billingCustomerId,
              offerId: write.offerId,
              priceId: write.priceId,
              status: write.status,
              quantity: write.quantity,
              currentPeriodEnd: write.currentPeriodEnd,
              cancelAtPeriodEnd: write.cancelAtPeriodEnd,
              trialEnd: write.trialEnd,
              lastEventAt: write.lastEventAt,
              lastEventId: write.lastEventId,
              updatedAt: new Date(),
            },
          })

        changed += 1
      }

      return changed
    },

    /**
     * La réconciliation des achats : elle **compare avant d'écrire**, et rend
     * le nombre de lignes réellement changées.
     *
     * Elle ne crée rien — une session que nous n'avons pas ouverte n'a pas
     * d'offre — et n'efface rien. Le compte est ce qui rend l'idempotence
     * **observable** : une seconde exécution rend zéro
     * (`docs/reliability.md` §1).
     */
    reconcilePurchases: async ({ billingCustomerId, purchases }) => {
      let changed = 0
      /**
       * **Les achats déjà tranchés pendant ce passage** (constat m7).
       *
       * Plusieurs sessions désignent le même achat depuis l'index inverse, et
       * deux d'entre elles peuvent être payées — deux onglets, deux sessions
       * vivantes, deux prélèvements. Elles se départagent alors sur le
       * paiement, et chaque passage réécrivait l'une puis l'autre : `changed`
       * ne retombait jamais à zéro, ce que `docs/reliability.md` §1 refuse.
       *
       * La première lecture qui **tranche** l'emporte, dans l'ordre rendu par
       * le fournisseur — un ordre stable, pas un tirage. Une session que le
       * fournisseur dit impayée ne tranche pas : elle ne consomme pas la place.
       */
      const decided = new Set<string>()

      for (const write of purchases) {
        // **Le même prédicat que la confirmation** : l'index inverse, et
        // l'ancien emplacement à défaut. C'est ici que la réconciliation
        // *répare* ce que le constat C1 déclarait irréparable — retrouver
        // l'achat d'une session supplantée —, et c'est ici que la fenêtre de
        // bascule est couverte (constat C4).
        const rows = await db
          .select(PURCHASE_COLUMNS)
          .from(billingPurchase)
          .where(
            and(
              eq(billingPurchase.billingCustomerId, billingCustomerId),
              purchaseOfSession(write.providerSessionId),
            ),
          )
          .limit(1)

        const stored = asPurchase(rows[0])

        if (stored === null) {
          continue
        }

        // **La décision appartient au `domain`** : il rend `null` quand la
        // lecture n'impose rien — une session impayée parmi plusieurs, ou une
        // charge introuvable sur une ligne déjà remboursée (constat m1). Écrire
        // sur un `null` ré-accorderait un achat rendu.
        const read = reconciledPurchaseStatus({
          stored: stored.status,
          paid: write.paid,
          chargedAmount: write.chargedAmount,
          amountRefunded: write.amountRefunded,
        })

        if (read === null) {
          continue
        }

        if (decided.has(stored.id)) {
          continue
        }

        decided.add(stored.id)

        // **Le journal des remboursements, rejoué ici aussi** (constat m6).
        // C'est l'autre chemin qui pose un `provider_payment_id`, et il ne le
        // consultait pas : un remboursement livré avant une confirmation qui ne
        // vient jamais, plus une charge introuvable — le cas **permanent** du
        // mode local —, et la réconciliation accordait l'accès sur un achat
        // intégralement remboursé. Le journal l'emporte sur le silence de la
        // charge : il porte un événement **reçu** du fournisseur, la charge
        // introuvable ne porte rien.
        const journalled =
          write.providerPaymentId === null ? null : await refundedPayment(write.providerPaymentId)

        const status = journalled === null ? read : ('refunded' satisfies PurchaseStatus)

        if (!purchaseDiffers(stored, write, status)) {
          continue
        }

        await db
          .update(billingPurchase)
          .set({
            providerPaymentId: write.providerPaymentId,
            status,
            amount: write.amount,
            currency: write.currency,
            ...(status === 'paid' && stored.purchasedAt === null
              ? { purchasedAt: write.at }
              : {}),
            ...(status === 'refunded' && stored.refundedAt === null
              ? // L'instant du **remboursement**, quand le journal le connaît ;
                // celui de la lecture sinon.
                { refundedAt: journalled?.refundedAt ?? write.at }
              : {}),
            // La réconciliation vient de la **source de vérité** : elle pose
            // l'instant de la lecture, ce qui la rend plus récente que tout
            // événement déjà appliqué (ADR 034 §3).
            lastEventAt: write.at,
            lastEventId: `reconcile:${write.at.toISOString()}`,
            updatedAt: new Date(),
          })
          .where(eq(billingPurchase.id, stored.id))

        changed += 1
      }

      return changed
    },

    /**
     * La purge du périmètre.
     *
     * Les abonnements **et les achats** partent par la clé étrangère
     * (`on delete cascade`), qui
     * reste **à l'intérieur du module** : ADR 018 n'autorise une référence que
     * vers un requis déclaré, et `billing` n'en a aucun. Le journal
     * d'événements n'est pas touché : il ne porte que des identifiants
     * d'événements du fournisseur, aucune donnée personnelle, et l'effacer
     * rouvrirait le rejeu d'événements déjà traités.
     */
    deleteScope: async (scope) => {
      const { kind, id } = scopeColumns(scope)
      const rows = await db
        .delete(billingCustomer)
        .where(and(eq(billingCustomer.scopeKind, kind), eq(billingCustomer.scopeId, id)))
        .returning({ id: billingCustomer.id })

      return rows.length
    },
  }
}

/**
 * **`billing_checkout_throttle` n'est plus écrite** (s28).
 *
 * `createDrizzleCheckoutThrottle` vivait ici et y écrivait. Le compteur a
 * convergé vers le port partagé (`shared-checkout-throttle.ts`), et la table
 * reste en place, **vide et inerte**. L'en-tête de son `pgTable` porte la
 * consigne d'origine et dit pourquoi elle n'a pas été suivie :
 * `docs/reliability.md` impose de cesser d'écrire avant de retirer une table, et
 * la version encore en ligne l'écrit pendant un basculement. C'est une story
 * ultérieure (ADR 050). Ne la faites pas ici, et n'écrivez pas un second
 * compteur.
 */
