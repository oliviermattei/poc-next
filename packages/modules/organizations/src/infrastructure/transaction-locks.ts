import { sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

/**
 * **La sérialisation d'une écriture qui compte avant d'agir.**
 *
 * Un prédicat qui compte les propriétaires dans la même instruction que le
 * `delete` ferme la fenêtre d'une requête **isolée** — et rien de plus. Sous
 * l'isolation par défaut de PostgreSQL, deux retraits en vol évaluent chacun la
 * sous-requête sur l'état d'avant l'autre : mesuré ici, dix courses sur dix
 * laissaient l'organisation **sans aucun membre**, à partir d'une seule session
 * et de deux clics rapprochés (revue de s16, constat F1). Aucune route de s16 ne
 * promeut un membre : l'état est irrécupérable dans le produit.
 *
 * Ce fichier existe pour que ce soit fermé **sans lire une table dans le chemin
 * d'écriture**. `pg_advisory_xact_lock` est un verrou consultatif porté par la
 * transaction : il ne verrouille aucune ligne, ne lit aucune donnée, et tombe
 * avec le `commit` ou le `rollback` — il n'y a pas de déverrouillage à oublier.
 * Deux retraits sur la **même** organisation attendent l'un l'autre ; le second
 * réévalue alors son prédicat sur l'état commis par le premier, et refuse.
 *
 * **Pourquoi la porte de lecture s'élargit ici, et de combien.** `pnpm lint`
 * refuse `select`, `from` et `execute` dans tout le module hors de
 * `infrastructure/scoped-reads.ts` (revue de s15, F2). Ce fichier obtient
 * `execute`, et **lui seul** : `select` et `from` y restent refusés, si bien
 * qu'aucune lecture de table ne peut s'y glisser. `tests/lint-rules.test.ts`
 * éprouve les trois : `execute` permis ici, `select` refusé ici, `execute`
 * toujours refusé ailleurs dans le module.
 *
 * **Ce que ce verrou ne tient pas**, dit plutôt que sous-entendu : `hashtext`
 * rend 32 bits, donc deux organisations peuvent partager une clé de verrou.
 * La conséquence est une attente inutile entre deux organisations, jamais une
 * correction manquée. Et la portée est **une base** : deux processus de
 * l'application partagent le verrou parce qu'ils partagent PostgreSQL, ce qui
 * n'est pas vrai d'un verrou tenu en mémoire.
 */

/** Ce dont un verrou a besoin, et rien de plus : une transaction en cours. */
export type LockableExecutor = Pick<PgDatabase<PgQueryResultHKT>, 'execute'>

/**
 * Sérialise, **pour la transaction en cours**, les écritures d'une organisation.
 *
 * L'appelant doit être dans une transaction : hors transaction, le verrou serait
 * pris et relâché aussitôt, et ne sérialiserait rien.
 */
export async function lockOrganizationMembership(
  executor: LockableExecutor,
  organizationId: string,
): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtext(${organizationId}))`)
}
