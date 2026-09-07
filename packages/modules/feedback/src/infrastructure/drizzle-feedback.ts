import { and, desc, eq, ilike, sql, type SQL } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type { FeedbackCategory, FeedbackStatus } from '../domain/feedback'
import type { FeedbackRecord, FeedbackRepository } from '../application/ports'
import { feedback } from '../schema'

/**
 * Le repository du module, sur **sa** table.
 *
 * La connexion est **injectée** : ce package ne dépend pas de `@repo/db`, et
 * c'est ce qui empêche le cycle `@repo/db` → agrégat généré → module (ADR 020).
 * Le type est réduit aux opérations employées, comme dans `marketing` et
 * `notifications` : un `NodePgDatabase<TSchema>` complet porterait le schéma des
 * autres modules dans son type.
 */
export type FeedbackDatabase = Pick<
  PgDatabase<PgQueryResultHKT>,
  'select' | 'insert' | 'update' | 'delete'
>

/** Les colonnes d'un retour, écrites une fois : deux listes divergeraient. */
const columns = {
  id: feedback.id,
  authorId: feedback.authorId,
  organizationId: feedback.organizationId,
  category: feedback.category,
  message: feedback.message,
  originPath: feedback.originPath,
  status: feedback.status,
  createdAt: feedback.createdAt,
  handledAt: feedback.handledAt,
} as const

/**
 * Échappe les jokers d'un motif `LIKE`.
 *
 * `_` et `%` sont des jokers **et** des caractères légaux d'un message ; non
 * échappés, `%` seul rendrait la table entière derrière un décompte faux. Même
 * fonction, même raison que dans `auth`, `marketing` et `organizations`.
 */
const escapeLikePattern = (value: string): string =>
  value.replaceAll(/[\\%_]/g, (match) => `\\${match}`)

/**
 * Les colonnes rendues sont du `text` en base ; le vocabulaire, lui, est fermé
 * par le `domain`. La conversion est **écrite une fois**, ici, à la sortie de la
 * base — et nulle part ailleurs.
 */
type FeedbackRow = {
  readonly id: string
  readonly authorId: string
  readonly organizationId: string | null
  readonly category: string
  readonly message: string
  readonly originPath: string | null
  readonly status: string
  readonly createdAt: Date
  readonly handledAt: Date | null
}

const asRecord = (row: FeedbackRow): FeedbackRecord => ({
  ...row,
  category: row.category as FeedbackCategory,
  status: row.status as FeedbackStatus,
})

export function createDrizzleFeedback(db: FeedbackDatabase): FeedbackRepository {
  const filtersOf = (input: {
    readonly category: string | null
    readonly status: string | null
    readonly search: string | null
  }): SQL | undefined => {
    const conditions: SQL[] = []

    if (input.category !== null) {
      conditions.push(eq(feedback.category, input.category))
    }

    if (input.status !== null) {
      conditions.push(eq(feedback.status, input.status))
    }

    if (input.search !== null) {
      conditions.push(ilike(feedback.message, `%${escapeLikePattern(input.search)}%`))
    }

    return conditions.length === 0 ? undefined : and(...conditions)
  }

  return {
    record: async (input) => {
      const rows = await db
        .insert(feedback)
        .values({
          id: input.id,
          authorId: input.authorId,
          organizationId: input.organizationId,
          category: input.category,
          message: input.message,
          originPath: input.originPath,
          // Un retour naît **reçu** : le statut n'est pas un paramètre de la
          // route, sans quoi l'auteur choisirait son propre traitement.
          status: 'open',
          createdAt: input.at,
        })
        .returning(columns)

      const row = rows[0] as FeedbackRow | undefined

      return row === undefined ? { ok: false } : { ok: true, feedback: asRecord(row) }
    },

    list: async (input) => {
      const where = filtersOf(input)

      const rows = await db
        .select(columns)
        .from(feedback)
        .where(where)
        // Les plus récents en premier : un back-office qui traite lit d'abord ce
        // qui vient d'arriver.
        .orderBy(desc(feedback.createdAt), desc(feedback.id))
        .limit(input.limit)
        .offset(input.offset)

      const counted = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(feedback)
        .where(where)

      return {
        ok: true,
        feedback: (rows as readonly FeedbackRow[]).map(asRecord),
        // Le décompte porte sur **le même filtre** que la page : sinon la
        // pagination annonce des pages qui n'existent pas.
        total: counted[0]?.total ?? 0,
      }
    },

    markHandled: async (input) => {
      /**
       * **Le rejeu ne produit aucun effet supplémentaire**
       * (`docs/reliability.md` §1) : la condition `status = 'open'` est dans
       * l'écriture, pas dans une lecture préalable. Deux clics simultanés ne
       * peuvent donc pas écrire deux dates de traitement différentes.
       */
      const rows = await db
        .update(feedback)
        .set({ status: 'handled', handledAt: input.at })
        .where(and(eq(feedback.id, input.id), eq(feedback.status, 'open')))
        .returning({ id: feedback.id })

      return { ok: true, handled: rows.length > 0 }
    },

    ofAuthor: async (authorId) =>
      (
        (await db
          .select(columns)
          .from(feedback)
          .where(eq(feedback.authorId, authorId))
          .orderBy(desc(feedback.createdAt))) as readonly FeedbackRow[]
      ).map(asRecord),

    eraseAuthor: async (authorId) =>
      (
        await db
          .delete(feedback)
          .where(eq(feedback.authorId, authorId))
          .returning({ id: feedback.id })
      ).length,

    eraseOrganization: async (organizationId) =>
      (
        await db
          .delete(feedback)
          .where(eq(feedback.organizationId, organizationId))
          .returning({ id: feedback.id })
      ).length,
  }
}
