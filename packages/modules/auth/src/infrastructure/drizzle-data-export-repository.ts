import { and, eq, isNotNull, lt, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type {
  DataExportRepository,
  DataExportRequestRecord,
  StoredDataExportRequest,
} from '../application/ports'
import { authDataExportRequest } from '../schema'

/**
 * Le magasin des demandes d'export (s35).
 *
 * Ce fichier porte **la revendication**, c'est-à-dire le critère 7 : « une
 * demande déjà en cours n'en déclenche pas une seconde ». Ce n'est pas une
 * lecture suivie d'une écriture — deux lectures concurrentes se voient l'une
 * l'autre, et c'est ce que la revue de s34 a établi par mesure, au prix d'un
 * constat critique. C'est une **transaction courte sous verrou consultatif**,
 * qui revendique ou refuse.
 */

/** Ce dont ce magasin a besoin : quatre opérations, une transaction, un verrou. */
export type DataExportDatabase = Pick<
  PgDatabase<PgQueryResultHKT>,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
> & {
  transaction<TResult>(
    run: (
      transaction: Pick<
        PgDatabase<PgQueryResultHKT>,
        'select' | 'insert' | 'update' | 'delete' | 'execute'
      >,
    ) => Promise<TResult>,
  ): Promise<TResult>
}

const COLUMNS = {
  id: authDataExportRequest.id,
  scopeKind: authDataExportRequest.scopeKind,
  scopeId: authDataExportRequest.scopeId,
  requestedBy: authDataExportRequest.requestedBy,
  status: authDataExportRequest.status,
  requestedAt: authDataExportRequest.requestedAt,
  completedAt: authDataExportRequest.completedAt,
  expiresAt: authDataExportRequest.expiresAt,
  tokenDigest: authDataExportRequest.tokenDigest,
  archive: authDataExportRequest.archive,
  failedModuleId: authDataExportRequest.failedModuleId,
}

const toRecord = (row: {
  id: string
  scopeKind: string
  scopeId: string
  requestedBy: string
  status: string
  requestedAt: Date
  completedAt: Date | null
  expiresAt: Date | null
  tokenDigest: string | null
  archive: unknown
  failedModuleId: string | null
}): StoredDataExportRequest => ({
  id: row.id,
  scope:
    row.scopeKind === 'organization'
      ? { kind: 'organization', organizationId: row.scopeId }
      : { kind: 'user', userId: row.scopeId },
  requestedBy: row.requestedBy,
  status: row.status === 'ready' || row.status === 'failed' ? row.status : 'pending',
  requestedAt: row.requestedAt,
  completedAt: row.completedAt,
  expiresAt: row.expiresAt,
  tokenDigest: row.tokenDigest,
  archive: row.archive ?? null,
  failedModuleId: row.failedModuleId,
})

const scopeColumns = (
  scope: DataExportRequestRecord['scope'],
): { readonly kind: string; readonly id: string } =>
  scope.kind === 'user'
    ? { kind: 'user', id: scope.userId }
    : { kind: 'organization', id: scope.organizationId }

export function createDrizzleDataExportRepository(options: {
  readonly db: DataExportDatabase
}): DataExportRepository {
  const { db } = options

  return {
    claim: async (input) => {
      const scope = scopeColumns(input.scope)

      return await db.transaction(async (transaction) => {
        /**
         * **Le verrou, avant la lecture.**
         *
         * `pg_advisory_xact_lock` ne verrouille aucune ligne, ne lit aucune
         * table et tombe avec la transaction : il n'y a pas de déverrouillage à
         * oublier. C'est le mécanisme d'`organizations` et de `storage`, repris
         * avec sa limite — `hashtext` rend 32 bits, donc deux périmètres
         * peuvent partager une clé. La conséquence est une attente inutile,
         * jamais une seconde demande acceptée.
         *
         * Sans lui, sous l'isolation par défaut de PostgreSQL, deux
         * revendications en vol évaluent chacune « aucune demande en cours » sur
         * l'état d'avant l'autre, et deux archives partent — dont deux liens
         * signés vers toutes les données d'une personne.
         */
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`data-export:${scope.kind}:${scope.id}`}))`,
        )

        const [pending] = await transaction
          .select({ id: authDataExportRequest.id })
          .from(authDataExportRequest)
          .where(
            and(
              eq(authDataExportRequest.scopeKind, scope.kind),
              eq(authDataExportRequest.scopeId, scope.id),
              eq(authDataExportRequest.status, 'pending'),
            ),
          )
          .limit(1)

        if (pending !== undefined) {
          return 'already-pending'
        }

        await transaction.insert(authDataExportRequest).values({
          id: input.id,
          scopeKind: scope.kind,
          scopeId: scope.id,
          requestedBy: input.requestedBy,
          status: 'pending',
          requestedAt: input.at,
        })

        return 'claimed'
      })
    },

    findById: async (id) => {
      const [row] = await db
        .select(COLUMNS)
        .from(authDataExportRequest)
        .where(eq(authDataExportRequest.id, id))
        .limit(1)

      return row === undefined ? null : toRecord(row)
    },

    markReady: async (input) => {
      await db
        .update(authDataExportRequest)
        .set({
          status: 'ready',
          tokenDigest: input.tokenDigest,
          expiresAt: input.expiresAt,
          archive: input.archive,
          completedAt: input.at,
          failedModuleId: null,
        })
        // La condition porte l'état de départ : une demande déjà servie n'est
        // pas réécrite, si bien qu'un rejeu de la tâche ne produit aucun effet
        // supplémentaire (`docs/reliability.md` §1).
        .where(
          and(eq(authDataExportRequest.id, input.id), eq(authDataExportRequest.status, 'pending')),
        )
    },

    markFailed: async (input) => {
      await db
        .update(authDataExportRequest)
        .set({ status: 'failed', failedModuleId: input.moduleId, completedAt: input.at })
        .where(
          and(eq(authDataExportRequest.id, input.id), eq(authDataExportRequest.status, 'pending')),
        )
    },

    listPending: async (before) => {
      const rows = await db
        .select(COLUMNS)
        .from(authDataExportRequest)
        .where(
          and(
            eq(authDataExportRequest.status, 'pending'),
            lt(authDataExportRequest.requestedAt, before),
          ),
        )

      return rows.map(toRecord)
    },

    listForScope: async (scope) => {
      const columns = scopeColumns(scope)
      const rows = await db
        .select({
          requestedAt: authDataExportRequest.requestedAt,
          status: authDataExportRequest.status,
          expiresAt: authDataExportRequest.expiresAt,
        })
        .from(authDataExportRequest)
        .where(
          and(
            eq(authDataExportRequest.scopeKind, columns.kind),
            eq(authDataExportRequest.scopeId, columns.id),
          ),
        )

      return rows.map((row) => ({
        requestedAt: row.requestedAt.toISOString(),
        status: row.status,
        expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
      }))
    },

    /**
     * **Efface l'archive expirée, pas la trace de la demande.**
     *
     * L'archive est la donnée personnelle ; la ligne qui dit « une demande a eu
     * lieu ce jour-là » est ce que l'export de la personne rend, et elle part
     * avec le compte.
     *
     * **L'empreinte du jeton reste**, et c'est délibéré : elle ne donne accès à
     * rien — l'échéance est vérifiée avant elle —, et la garder est ce qui
     * permet de répondre « ce lien a expiré » (410) plutôt que « ce lien n'a
     * jamais existé » (404) à quelqu'un qui rouvre son email trois jours plus
     * tard. Mesuré : sans elle, le second téléchargement rendait 404.
     */
    forgetExpiredArchives: async (at) => {
      const rows = await db
        .update(authDataExportRequest)
        .set({ archive: null })
        .where(
          and(
            isNotNull(authDataExportRequest.archive),
            isNotNull(authDataExportRequest.expiresAt),
            lt(authDataExportRequest.expiresAt, at),
          ),
        )
        .returning({ id: authDataExportRequest.id })

      return rows.length
    },

    deleteScope: async (scope) => {
      const columns = scopeColumns(scope)

      await db
        .delete(authDataExportRequest)
        .where(
          and(
            eq(authDataExportRequest.scopeKind, columns.kind),
            eq(authDataExportRequest.scopeId, columns.id),
          ),
        )
    },
  }
}
