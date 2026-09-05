import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * **Le registre des exécutions déjà faites** (s33) — la table qui rend le rejeu
 * inoffensif.
 *
 * `docs/reliability.md` §1 exige qu'« anything triggered from outside is
 * replayable with no extra effect », et que ce soit **prouvé en rejouant**. Une
 * ligne par exécution réservée : la première émission d'une clé l'insère, la
 * seconde échoue sur la clé primaire et le répartiteur saute l'exécution.
 *
 * Elle est **partagée entre instances**, et c'est tout son intérêt : deux
 * conteneurs derrière un répartiteur de charge voient la même échéance cron à la
 * même minute. Un ensemble en mémoire de processus laisserait chacun l'exécuter,
 * et personne ne s'en apercevrait — le même défaut qu'un compteur de limitation
 * en mémoire (s28).
 *
 * **`run` est un condensat**, comme la clé de seau de `rate_limit_window` et
 * pour la même raison : la clé d'idempotence est construite par l'appelant, et
 * rien ne garantit qu'elle ne porte pas un identifiant de compte ou une adresse.
 * Condensée, cette table ne détient **aucune** donnée personnelle — c'est ce qui
 * lui permet de ne déclarer aucune catégorie au contrat, donc de n'avoir ni
 * purge ni export à faire.
 *
 * `job` reste en clair : c'est un identifiant de code (`<module>.<tâche>`), il ne
 * désigne personne, et sans lui on ne saurait pas ce que la table contient.
 */
export const jobRun = pgTable(
  'job_run',
  {
    /** Condensat de `<tâche>:<clé d'idempotence>`. */
    run: text('run').primaryKey(),
    /** L'identifiant qualifié de la tâche : `<module>.<tâche>`. */
    job: text('job').notNull(),
    /** L'instant où l'exécution a été réservée. */
    claimedAt: timestamp('claimed_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    // Les exploitants lisent « qu'a fait cette tâche », et une rétention future
    // effacerait par ancienneté : sans index, les deux balaieraient la table.
    index('job_run_job_idx').on(table.job),
    index('job_run_claimed_idx').on(table.claimedAt),
  ],
)

/** Les tables du module, telles que le contrat les déclare. */
export const jobsSchema = { jobRun } as const
