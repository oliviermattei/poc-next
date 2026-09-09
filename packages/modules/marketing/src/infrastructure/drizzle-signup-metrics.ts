import { gte, sql, type SQL } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import { publicSubscription } from '../schema'

/**
 * **Ce que le site public sait compter de ses inscriptions** (s60).
 *
 * Une inscription est une adresse email capturée par un formulaire public —
 * sans compte, sans paiement. Ce n'est ni un abonnement ni une vente, et le
 * tableau de bord ne les mélange jamais.
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

export type SignupMetricsDatabase = Pick<PgDatabase<PgQueryResultHKT>, 'select'> & RawRows

export interface SignupMetricsPoint {
  readonly day: string
  readonly value: number
}

export interface SignupMetrics {
  readonly since: number
  /** Les inscriptions par jour, **jours vides compris** : sinon la courbe ment. */
  readonly perDay: readonly SignupMetricsPoint[]
}

export interface SignupMetricsReader {
  read(input: { readonly since: Date; readonly from: Date }): Promise<SignupMetrics>
}

export function createDrizzleSignupMetrics(db: SignupMetricsDatabase): SignupMetricsReader {
  return {
    read: async ({ since, from }) => {
      const [recent, series] = await Promise.all([
        db
          .select({ value: sql<number>`count(*)::int` })
          .from(publicSubscription)
          .where(gte(publicSubscription.createdAt, since)),
        db.execute(
          sql`select to_char(days.day, 'YYYY-MM-DD') as day,
                     count(${publicSubscription.id})::int as value
                from generate_series(
                       date_trunc('day', ${from.toISOString()}::timestamptz),
                       date_trunc('day', now()),
                       interval '1 day'
                     ) as days(day)
                left join ${publicSubscription}
                  on date_trunc('day', ${publicSubscription.createdAt}) = days.day
               group by days.day
               order by days.day`,
        ),
      ])

      return {
        since: Number(recent[0]?.value ?? 0),
        perDay: (series.rows as readonly { day: string; value: number }[]).map((row) => ({
          day: row.day,
          value: Number(row.value),
        })),
      }
    },
  }
}
