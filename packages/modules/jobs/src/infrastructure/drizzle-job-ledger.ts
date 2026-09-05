import { createHash } from 'node:crypto'

import type { JobRunLedger } from '@repo/core'
import { and, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

import type { jobsSchema } from '../schema'
import { jobRun } from '../schema'

/**
 * L'identité d'une exécution dans le registre, **condensée**.
 *
 * La clé d'idempotence est construite par l'appelant : rien ne garantit qu'elle
 * ne porte pas un identifiant de compte, une adresse, une référence
 * d'abonnement. Le magasin n'a aucune raison de les conserver
 * (`docs/security.md` §5), et le condensat suffit à répondre à la seule question
 * qu'on lui pose : « cette exécution-là a-t-elle déjà eu lieu ? »
 *
 * La tâche entre dans le condensat : deux tâches différentes qui choisiraient la
 * même clé ne doivent pas se déduplaquer l'une l'autre.
 *
 * Elle vit **ici** et non dans `domain/` : `node:crypto` est un module de
 * plateforme, et `pnpm lint` refuse qu'une règle métier en connaisse un
 * (ADR 006). Même placement que la clé de seau de `rate-limit` (s28).
 */
export const jobRunDigest = (job: string, key: string): string =>
  createHash('sha256').update(`${job}:${key}`).digest('hex')

/**
 * **L'implémentation PostgreSQL du registre des exécutions** (s33).
 *
 * Une seule instruction atomique décide : `insert … on conflict do nothing`
 * rend une ligne quand la réservation est neuve, aucune quand elle existe déjà.
 * Deux instances qui voient la même échéance à la même minute font la même
 * requête ; la base en désigne une, et une seule. Un `select` suivi d'un
 * `insert` aurait laissé les deux passer.
 *
 * **Une panne du magasin refuse la réservation, elle ne l'accorde pas.** C'est
 * la lecture prudente : accorder ferait exécuter deux fois, ce que la story
 * existe pour empêcher ; refuser reporte l'exécution à la prochaine échéance,
 * et le répartiteur la journalise — ce qu'il fait **parce qu'il attrape ce
 * rejet**, et pas seulement parce que cette phrase le dit. La revue de s33 a
 * mesuré l'inverse (constat F4) : `claim` rejette sur le délai ci-dessous comme
 * sur toute erreur du pilote, et l'exception traversait le répartiteur sans une
 * ligne de journal. Le magasin est la base de l'application — absente, il n'y a
 * de toute façon plus grand-chose à exécuter.
 */

export type JobsDatabase = NodePgDatabase<typeof jobsSchema>

/**
 * **Toute échéance est explicite** (`docs/reliability.md` §3).
 *
 * Cinq secondes : une réservation est une écriture d'une ligne, et au-delà la
 * tâche qu'elle garde a de toute façon perdu sa fenêtre.
 */
const DEFAULT_TIMEOUT_MS = 5_000

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Le registre d’exécutions n’a pas répondu en ${timeoutMs} ms.`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

export interface DrizzleJobLedgerOptions {
  readonly db: JobsDatabase
  readonly timeoutMs?: number
}

export function createDrizzleJobLedger(options: DrizzleJobLedgerOptions): JobRunLedger {
  const { db } = options
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    async claim({ job, key, now }): Promise<boolean> {
      const reserved = await withTimeout(
        db
          .insert(jobRun)
          .values({ run: jobRunDigest(job, key), job, claimedAt: now })
          .onConflictDoNothing()
          .returning({ run: jobRun.run }),
        timeoutMs,
      )

      return reserved.length > 0
    },

    async release({ job, key }): Promise<void> {
      await withTimeout(
        db
          .delete(jobRun)
          .where(and(eq(jobRun.run, jobRunDigest(job, key)), eq(jobRun.job, job))),
        timeoutMs,
      )
    },
  }
}

/**
 * **La fenêtre de rétention du registre d'exécutions**, en jours.
 *
 * Elle se déduit de ce que la table sert, et de rien d'autre : le registre
 * n'existe que pour **dédupliquer**, donc il n'a besoin de survivre qu'au plus
 * long rejeu contre lequel il protège réellement. Trois rejeux existent, et le
 * plus long décide :
 *
 * | Rejeu | Sa durée |
 * |---|---|
 * | la reprise du répartiteur | trois tentatives, recul plafonné à 30 s — moins d'une minute |
 * | la redélivraison d'un même événement par le fournisseur | Inngest déduplique lui-même par `id` d'événement sur **24 heures** ; au-delà, c'est notre registre qui reste seul |
 * | le rejeu **opérationnel** d'une échéance ratée | ce qu'un humain fait après un incident, c'est-à-dire des heures, au pire des jours |
 *
 * **Sept jours**, donc : la fenêtre recouvre largement les 24 heures du
 * fournisseur — les deux ceintures se chevauchent au lieu de laisser un trou —
 * et couvre un incident qu'on répare la semaine suivante. Au-delà, rejouer une
 * échéance est un geste délibéré qui **doit** produire un effet : une
 * déduplication éternelle transformerait la réparation d'un incident en
 * silence.
 *
 * Ce que cela laisse en table, **avec les échéances que ce dépôt déclare
 * aujourd'hui** — et le nombre change avec elles, il n'est pas une garantie :
 * une échéance toutes les dix minutes fait 144 exécutions par jour, deux
 * échéances quotidiennes en font 2, soit environ 1 020 lignes sur sept jours.
 */
export const JOB_RUN_RETENTION_DAYS = 7

/**
 * Efface les réservations plus vieilles que la rétention demandée.
 *
 * Sans elle, `job_run` grossit sans borne — exactement le défaut que cette
 * story corrige sur `rate_limit_window`, et il serait absurde de le
 * réintroduire par la table qui le corrige. Elle rend le nombre de lignes
 * effacées, parce qu'une purge se **prouve en l'exécutant**
 * (`docs/reliability.md` §1).
 *
 * **Elle n'efface jamais la réservation de l'exécution en cours** : celle-ci
 * vient d'être prise, elle est donc dans la fenêtre. C'est ce qui permet à cette
 * tâche de se balayer elle-même sans se libérer, donc sans devenir rejouable
 * pendant qu'elle tourne.
 */
export async function sweepJobRuns(input: {
  readonly db: JobsDatabase
  readonly before: Date
}): Promise<number> {
  const removed = await input.db.execute<{ run: string }>(
    sql`delete from ${jobRun} where ${jobRun.claimedAt} < ${input.before} returning ${jobRun.run}`,
  )

  return removed.rows.length
}
