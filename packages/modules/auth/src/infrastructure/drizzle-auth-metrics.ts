import { and, gte, sql, type SQL } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import { authSession, authUser } from '../schema'

/**
 * **Ce que le socle sait compter de ses comptes** (s60), pour le tableau de
 * bord du back-office.
 *
 * Il est ici, et pas dans le module d'administration, pour la raison de tous les
 * autres chiffres qu'il affiche : `admin` ne déclare pas `auth` dans ses
 * `requires`, il ne peut ni importer ces tables ni les joindre (ADR 018). Le
 * point de composition de l'application tient les deux bouts.
 *
 * **Les fenêtres sont glissantes, et c'est une décision** : « les 24 dernières
 * heures » n'a pas de fuseau horaire, « aujourd'hui » en a un. Un tableau de
 * bord dont les chiffres changent de sens à minuit selon le serveur qui les
 * calcule ne se compare pas d'un jour à l'autre.
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

export type AuthMetricsDatabase = Pick<PgDatabase<PgQueryResultHKT>, 'select'> & RawRows

export interface AuthMetricsPoint {
  /** Le jour, en date ISO (`2026-09-10`), calculé **en UTC**. */
  readonly day: string
  readonly value: number
}

export interface AuthMetrics {
  readonly accountsTotal: number
  readonly accountsSince: number
  /** Les comptes créés par jour sur la fenêtre longue, **jours vides compris**. */
  readonly accountsPerDay: readonly AuthMetricsPoint[]
  /**
   * Les **connexions** de la fenêtre courte : des sessions ouvertes, jamais des
   * utilisateurs actifs. Un compte déjà connecté qui travaille toute la journée
   * n'en ouvre aucune, et rien dans ce dépôt n'enregistre sa dernière requête.
   */
  readonly signInsSince: number
}

export interface AuthMetricsReader {
  read(input: { readonly since: Date; readonly from: Date }): Promise<AuthMetrics>
}

/**
 * **La série est complétée en SQL, pas en JavaScript.**
 *
 * `generate_series` produit un jour par jour de la fenêtre, y compris ceux où
 * personne ne s'est inscrit. Sans elle, un graphe de trente jours dont trois
 * portent une inscription rendrait trois barres collées — c'est-à-dire une
 * courbe fausse, pas une courbe creuse.
 */
const perDay = (
  db: AuthMetricsDatabase,
  from: Date,
): Promise<readonly AuthMetricsPoint[]> =>
  db
    .execute(
      sql`select to_char(days.day, 'YYYY-MM-DD') as day,
                 count(${authUser.id})::int as value
            from generate_series(
                   date_trunc('day', ${from.toISOString()}::timestamptz),
                   date_trunc('day', now()),
                   interval '1 day'
                 ) as days(day)
            left join ${authUser}
              on date_trunc('day', ${authUser.createdAt}) = days.day
           group by days.day
           order by days.day`,
    )
    .then((result) =>
      (result.rows as readonly { day: string; value: number }[]).map((row) => ({
        day: row.day,
        value: Number(row.value),
      })),
    )

export function createDrizzleAuthMetrics(db: AuthMetricsDatabase): AuthMetricsReader {
  return {
    read: async ({ since, from }) => {
      const [total, recent, series, signIns] = await Promise.all([
        db.select({ value: sql<number>`count(*)::int` }).from(authUser),
        db
          .select({ value: sql<number>`count(*)::int` })
          .from(authUser)
          .where(gte(authUser.createdAt, since)),
        perDay(db, from),
        db
          .select({ value: sql<number>`count(*)::int` })
          .from(authSession)
          .where(and(gte(authSession.createdAt, since))),
      ])

      return {
        accountsTotal: Number(total[0]?.value ?? 0),
        accountsSince: Number(recent[0]?.value ?? 0),
        accountsPerDay: series,
        signInsSince: Number(signIns[0]?.value ?? 0),
      }
    },
  }
}
