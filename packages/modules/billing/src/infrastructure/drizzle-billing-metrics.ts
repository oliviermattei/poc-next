import { and, desc, eq, gte, isNotNull, sql, type SQL } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import { billingPurchase, billingSubscription } from '../schema'

/**
 * **Ce que la facturation sait compter dans le temps** (s60).
 *
 * Le MRR, lui, n'est pas ici : c'est un **instantané**, et il est déjà calculé
 * par la lecture de revenu du module (s38). Ce lecteur-ci ne sert que ce qui a
 * une date.
 *
 * ## Ce que ce dépôt ne sait pas dater, et qu'on n'invente pas
 *
 * `billing_subscription` ne porte **pas** de date de création : ses colonnes de
 * temps sont `last_event_at` (l'horodatage du fournisseur), `current_period_end`
 * et `updated_at`. Un graphe « abonnements créés par jour » serait donc une
 * courbe fabriquée. Ce lecteur rend deux choses distinctes plutôt qu'une
 * moyenne fausse :
 *
 * - les **achats encaissés**, qui portent `purchased_at` et un montant : ceux-là
 *   se comptent par jour et s'additionnent ;
 * - les **derniers mouvements d'abonnement**, ordonnés par l'événement du
 *   fournisseur — ce que c'est réellement, et l'écran le dit ainsi.
 *
 * Dater la création d'un abonnement demanderait une colonne, donc une migration,
 * donc une décision sur ce qu'on fait des lignes déjà en base. C'est une autre
 * story ; ce n'est pas un détail d'affichage.
 */
/**
 * **La forme de `execute`, écrite plutôt qu'empruntée.**
 *
 * `PgDatabase<PgQueryResultHKT>['execute']` rend un type que le compilateur ne
 * sait pas ouvrir — le dépôt ne lit les lignes d'une requête brute nulle part
 * ailleurs, et le `Pick` habituel n'y suffit donc pas. La forme réellement
 * consommée est déclarée ici : des lignes, et c'est tout. Le pilote rend
 * davantage ; ce lecteur n'en a pas besoin.
 */
interface RawRows {
  execute(query: SQL): Promise<{ readonly rows: readonly Record<string, unknown>[] }>
}

export type BillingMetricsDatabase = Pick<PgDatabase<PgQueryResultHKT>, 'select'> & RawRows

export interface BillingMetricsPoint {
  readonly day: string
  readonly value: number
  /** Le montant encaissé ce jour-là, en **unités mineures**. */
  readonly amount: number
}

export interface BillingRecentPurchase {
  readonly id: string
  readonly offerId: string
  readonly amount: number | null
  readonly currency: string | null
  readonly purchasedAt: Date
}

export interface BillingRecentSubscription {
  readonly id: string
  readonly offerId: string | null
  readonly status: string
  readonly quantity: number
  readonly lastEventAt: Date
}

export interface BillingMetrics {
  /** Les achats **encaissés** dans la fenêtre courte. */
  readonly purchasesSince: number
  readonly purchasesPerDay: readonly BillingMetricsPoint[]
  readonly recentPurchases: readonly BillingRecentPurchase[]
  readonly recentSubscriptions: readonly BillingRecentSubscription[]
}

export interface BillingMetricsReader {
  read(input: {
    readonly since: Date
    readonly from: Date
    readonly limit: number
  }): Promise<BillingMetrics>
}

export function createDrizzleBillingMetrics(db: BillingMetricsDatabase): BillingMetricsReader {
  return {
    read: async ({ since, from, limit }) => {
      const [recent, series, purchases, subscriptions] = await Promise.all([
        db
          .select({ value: sql<number>`count(*)::int` })
          .from(billingPurchase)
          .where(and(eq(billingPurchase.status, 'paid'), gte(billingPurchase.purchasedAt, since))),
        db.execute(
          sql`select to_char(days.day, 'YYYY-MM-DD') as day,
                     count(paid.id)::int as value,
                     coalesce(sum(paid.amount), 0)::int as amount
                from generate_series(
                       date_trunc('day', ${from.toISOString()}::timestamptz),
                       date_trunc('day', now()),
                       interval '1 day'
                     ) as days(day)
                left join (
                  select ${billingPurchase.id} as id,
                         ${billingPurchase.amount} as amount,
                         ${billingPurchase.purchasedAt} as purchased_at
                    from ${billingPurchase}
                   where ${billingPurchase.status} = 'paid'
                     and ${billingPurchase.purchasedAt} is not null
                ) as paid
                  on date_trunc('day', paid.purchased_at) = days.day
               group by days.day
               order by days.day`,
        ),
        db
          .select({
            id: billingPurchase.id,
            offerId: billingPurchase.offerId,
            amount: billingPurchase.amount,
            currency: billingPurchase.currency,
            purchasedAt: billingPurchase.purchasedAt,
          })
          .from(billingPurchase)
          .where(and(eq(billingPurchase.status, 'paid'), isNotNull(billingPurchase.purchasedAt)))
          .orderBy(desc(billingPurchase.purchasedAt))
          .limit(limit),
        db
          .select({
            id: billingSubscription.providerSubscriptionId,
            offerId: billingSubscription.offerId,
            status: billingSubscription.status,
            quantity: billingSubscription.quantity,
            lastEventAt: billingSubscription.lastEventAt,
          })
          .from(billingSubscription)
          .orderBy(desc(billingSubscription.lastEventAt))
          .limit(limit),
      ])

      return {
        purchasesSince: Number(recent[0]?.value ?? 0),
        purchasesPerDay: (
          series.rows as readonly { day: string; value: number; amount: number }[]
        ).map((row) => ({
          day: row.day,
          value: Number(row.value),
          amount: Number(row.amount),
        })),
        // `purchasedAt` est filtré non nul par la requête : le type ne le sait
        // pas, la donnée si. Écarter la ligne plutôt que de la dater à zéro.
        recentPurchases: purchases.flatMap((purchase) =>
          purchase.purchasedAt === null
            ? []
            : [{ ...purchase, purchasedAt: purchase.purchasedAt }],
        ),
        recentSubscriptions: subscriptions,
      }
    },
  }
}
