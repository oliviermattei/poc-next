import { and, eq, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type { FileRecord, FileRepository, ReplacedFile } from '../application/ports'
import { AVATAR_PURPOSE, type AvatarContentType, type FileOwner } from '../domain/avatar'
import { storageFile } from '../schema'

/**
 * Le repository du module, sur **sa** table.
 *
 * La connexion est **injectée** : ce package ne dépend pas de `@repo/db`, et
 * c'est ce qui empêche le cycle `@repo/db` → agrégat généré → module (ADR 020).
 * Le type est réduit aux opérations employées, comme dans `auth`,
 * `organizations` et `marketing` : un `NodePgDatabase<TSchema>` complet porterait
 * le schéma des autres modules dans son type, et une connexion construite avec
 * trois modules ne lui serait pas assignable.
 */
/**
 * Ce que la transaction du module a besoin de faire, et rien de plus.
 *
 * `execute` pour le verrou consultatif, `select` pour lire la clé précédente
 * **sous ce verrou**, `insert` pour la poser.
 */
type TransactionalWriter = Pick<
  PgDatabase<PgQueryResultHKT>,
  'select' | 'insert' | 'execute'
>

export type StorageDatabase = Pick<
  PgDatabase<PgQueryResultHKT>,
  'select' | 'insert' | 'update' | 'delete'
> & {
  /**
   * La transaction, **réduite à ce qu'on en fait**.
   *
   * Reprendre la signature de `PgDatabase` rendrait le type invariant sur le
   * schéma : une connexion construite avec les tables de six modules n'est pas
   * assignable à une connexion typée sans schéma — mesuré, `pnpm typecheck` l'a
   * refusée. C'est exactement la forme qu'`organizations` a dû prendre, pour la
   * même raison : un module n'a pas à connaître les tables des autres pour
   * recevoir une connexion.
   */
  transaction<T>(run: (writer: TransactionalWriter) => Promise<T>): Promise<T>
}

const ownerFilter = (owner: FileOwner) =>
  and(eq(storageFile.ownerKind, owner.kind), eq(storageFile.ownerId, owner.id))

const toRecord = (row: {
  id: string
  ownerKind: string
  ownerId: string
  purpose: string
  storageKey: string
  contentType: string
  sizeBytes: number
  createdAt: Date
  updatedAt: Date
}): FileRecord => ({
  id: row.id,
  owner: { kind: row.ownerKind === 'organization' ? 'organization' : 'user', id: row.ownerId },
  purpose: row.purpose,
  storageKey: row.storageKey,
  contentType: row.contentType as AvatarContentType,
  sizeBytes: row.sizeBytes,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const SELECTION = {
  id: storageFile.id,
  ownerKind: storageFile.ownerKind,
  ownerId: storageFile.ownerId,
  purpose: storageFile.purpose,
  storageKey: storageFile.storageKey,
  contentType: storageFile.contentType,
  sizeBytes: storageFile.sizeBytes,
  createdAt: storageFile.createdAt,
  updatedAt: storageFile.updatedAt,
} as const

export function createDrizzleFileRepository(db: StorageDatabase): FileRepository {
  return {
    async replaceAvatar(input): Promise<ReplacedFile> {
      return await db.transaction(async (tx) => {
        /**
         * **La sérialisation des remplacements d'un même propriétaire.**
         *
         * Sans elle, deux confirmations en vol lisent chacune l'état d'avant
         * l'autre : la contrainte d'unicité garantit qu'il ne restera qu'une
         * ligne, mais aucune des deux ne voit la clé de l'autre, et l'objet
         * perdant reste dans le seau sans que rien ne le désigne — un orphelin,
         * exactement ce que le critère de rejeu interdit.
         *
         * `pg_advisory_xact_lock` ne verrouille aucune ligne, ne lit aucune
         * table, et tombe avec la transaction : il n'y a pas de déverrouillage
         * à oublier. C'est le mécanisme de `organizations`, repris avec sa
         * limite — `hashtext` rend 32 bits, donc deux propriétaires peuvent
         * partager une clé de verrou. La conséquence est une attente inutile,
         * jamais une suppression manquée.
         */
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`${input.owner.kind}:${input.owner.id}`}))`,
        )

        const existing = await tx
          .select({ storageKey: storageFile.storageKey })
          .from(storageFile)
          .where(and(ownerFilter(input.owner), eq(storageFile.purpose, AVATAR_PURPOSE)))
          .limit(1)

        const previousStorageKey = existing[0]?.storageKey ?? null

        const rows = await tx
          .insert(storageFile)
          .values({
            id: input.id,
            ownerKind: input.owner.kind,
            ownerId: input.owner.id,
            purpose: AVATAR_PURPOSE,
            storageKey: input.storageKey,
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
            createdAt: input.at,
            updatedAt: input.at,
          })
          // L'unicité est celle de la base : le remplacement est **une**
          // écriture, jamais un `delete` suivi d'un `insert` qui laisserait une
          // fenêtre sans avatar.
          .onConflictDoUpdate({
            target: [storageFile.ownerKind, storageFile.ownerId, storageFile.purpose],
            set: {
              storageKey: input.storageKey,
              contentType: input.contentType,
              sizeBytes: input.sizeBytes,
              updatedAt: input.at,
            },
          })
          .returning({ id: storageFile.id })

        return { id: rows[0]?.id ?? input.id, previousStorageKey }
      })
    },

    async avatarOf(owner): Promise<FileRecord | null> {
      const rows = await db
        .select(SELECTION)
        .from(storageFile)
        .where(and(ownerFilter(owner), eq(storageFile.purpose, AVATAR_PURPOSE)))
        .limit(1)

      return rows[0] === undefined ? null : toRecord(rows[0])
    },

    async byId(id): Promise<FileRecord | null> {
      const rows = await db.select(SELECTION).from(storageFile).where(eq(storageFile.id, id)).limit(1)

      return rows[0] === undefined ? null : toRecord(rows[0])
    },

    async deleteOwnedBy(owner): Promise<readonly string[]> {
      // **L'effacement rend les clés qu'il vient de retirer.** Une lecture
      // préalable suivie d'un `delete` laisserait une fenêtre où une ligne
      // insérée entre les deux ne serait pas supprimée ; ici, ce qui est rendu
      // est exactement ce qui a été effacé, et une purge rejouée rend une liste
      // vide.
      const rows = await db
        .delete(storageFile)
        .where(ownerFilter(owner))
        .returning({ storageKey: storageFile.storageKey })

      return rows.map((row) => row.storageKey)
    },

    async listOwnedBy(owner): Promise<readonly FileRecord[]> {
      const rows = await db.select(SELECTION).from(storageFile).where(ownerFilter(owner))

      return rows.map(toRecord)
    },
  }
}
