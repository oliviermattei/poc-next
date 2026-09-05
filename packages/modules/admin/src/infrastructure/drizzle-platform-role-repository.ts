import { and, eq, gt, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type { PlatformRoleRepository } from '../application/ports'
import {
  banRefusal,
  revocationRefusal,
  SUPERADMIN_ROLE,
  type PlatformRoleFacts,
} from '../domain/platform-role'
import { adminPlatformRole } from '../schema'

/**
 * Le repository du module, sur **sa** table.
 *
 * La connexion est **injectée** : ce package ne dépend pas de `@repo/db`, ce
 * qui empêche le cycle `@repo/db` → agrégat généré → module (ADR 020). Le type
 * est réduit aux opérations utilisées, jamais le `NodePgDatabase<TSchema>`
 * complet — celui-ci porte son schéma relationnel dans son type, si bien qu'une
 * connexion construite avec les tables de treize modules ne serait pas
 * assignable.
 */
export type AdminExecutor = Pick<
  PgDatabase<PgQueryResultHKT>,
  // `update` est arrivé avec s34 : l'anonymisation de `granted_by` réécrit une
  // colonne au lieu d'effacer une ligne. Les opérations sont énumérées, jamais
  // élargies au `NodePgDatabase` complet.
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>

export type AdminDatabase = AdminExecutor & AdminTransactions

export interface AdminTransactions {
  transaction<TResult>(run: (transaction: AdminExecutor) => Promise<TResult>): Promise<TResult>
}

/** Violation de clé étrangère PostgreSQL : c'est ainsi qu'un compte inconnu se dit. */
const FOREIGN_KEY_VIOLATION = '23503'

/**
 * **La cause est inspectée, pas seulement l'erreur** : `drizzle-orm@0.45.2`
 * enveloppe l'erreur du pilote dans une `DrizzleQueryError` (« Failed query: … »)
 * et range l'originale — celle qui porte le `code` de PostgreSQL — dans
 * `cause`. Ne regarder que le premier niveau laissait la violation de clé
 * étrangère remonter en 500 : mesuré.
 */
const isForeignKeyViolation = (error: unknown): boolean => {
  for (let candidate: unknown = error; candidate != null; ) {
    if (
      typeof candidate === 'object' &&
      'code' in candidate &&
      candidate.code === FOREIGN_KEY_VIOLATION
    ) {
      return true
    }

    candidate = typeof candidate === 'object' && 'cause' in candidate ? candidate.cause : null
  }

  return false
}

/**
 * **La sérialisation des écritures du rôle de plateforme.**
 *
 * `pg_advisory_xact_lock` porté par la transaction, sur une clé **constante** :
 * il n'y a qu'un seul rôle de plateforme, donc un seul compteur à protéger. Le
 * verrou ne lit aucune table, ne verrouille aucune ligne, et tombe avec le
 * `commit` ou le `rollback`.
 *
 * Sans lui, le prédicat du `delete` ne ferme la fenêtre que d'une requête
 * **isolée** : sous l'isolation par défaut de PostgreSQL, deux révocations en
 * vol évaluent chacune la sous-requête sur l'état d'avant l'autre, et la
 * plateforme se retrouve sans aucun superadmin — l'état exact qu'aucune
 * commande ne répare (`docs/reliability.md` §1).
 */
const lockPlatformRole = async (
  executor: Pick<PgDatabase<PgQueryResultHKT>, 'execute'>,
): Promise<void> => {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtext(${SUPERADMIN_ROLE}))`)
}

/**
 * Les faits que les règles du `domain` attendent, lus **sous le verrou**.
 *
 * Ce n'est donc pas « une lecture qui décide suivie d'une écriture qui obéit » :
 * tout écrivain du rôle de plateforme prend le même verrou, si bien que rien ne
 * peut changer entre cette lecture et l'écriture qui la suit dans la même
 * transaction.
 */
const readFacts = async (
  executor: AdminExecutor,
  userId: string,
): Promise<PlatformRoleFacts> => {
  const [counted] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(adminPlatformRole)
    .where(eq(adminPlatformRole.role, SUPERADMIN_ROLE))

  const [held] = await executor
    .select({ id: adminPlatformRole.id })
    .from(adminPlatformRole)
    .where(
      and(eq(adminPlatformRole.userId, userId), eq(adminPlatformRole.role, SUPERADMIN_ROLE)),
    )
    .limit(1)

  return {
    superadminCount: Number(counted?.count ?? 0),
    targetIsSuperadmin: held !== undefined,
  }
}

export function createDrizzlePlatformRoleRepository(
  db: AdminDatabase,
): PlatformRoleRepository {
  return {
    countSuperadmins: async () => {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(adminPlatformRole)
        .where(eq(adminPlatformRole.role, SUPERADMIN_ROLE))

      return Number(row?.count ?? 0)
    },

    isSuperadmin: async (userId) => {
      const [row] = await db
        .select({ id: adminPlatformRole.id })
        .from(adminPlatformRole)
        .where(
          and(
            eq(adminPlatformRole.userId, userId),
            eq(adminPlatformRole.role, SUPERADMIN_ROLE),
          ),
        )
        .limit(1)

      return row !== undefined
    },

    grantSuperadmin: async ({ userId, grantedBy, at }) => {
      try {
        // **L'unicité est tenue par la base**, jamais par une lecture préalable :
        // celle-ci laisserait la fenêtre où deux promotions du même compte
        // écrivent chacune une ligne, et le décompte du garde-fou compterait
        // deux fois la même personne. Rejouer la désignation est donc sans
        // effet supplémentaire (`docs/reliability.md` §1).
        const inserted = await db
          .insert(adminPlatformRole)
          .values({
            // **La clé primaire est dérivée du couple (compte, rôle)**, celui-là
            // même que porte l'index unique : deux promotions simultanées du
            // même compte visent alors la même ligne, et la seconde est un
            // no-op plutôt qu'un doublon que le décompte compterait deux fois.
            id: `${SUPERADMIN_ROLE}_${userId}`,
            userId,
            role: SUPERADMIN_ROLE,
            grantedAt: at,
            grantedBy,
          })
          .onConflictDoNothing()
          .returning({ id: adminPlatformRole.id })

        return { ok: true, granted: inserted.length > 0 }
      } catch (error) {
        // Un compte que `auth_user` ne connaît pas : la clé étrangère refuse, et
        // c'est la base qui le dit — jamais une lecture préalable.
        if (isForeignKeyViolation(error)) {
          return { ok: false, error: 'unknown_account' }
        }

        throw error
      }
    },

    /**
     * **L'anonymisation du promoteur** (s34, constat F1).
     *
     * Aucun verrou : elle ne lit ni ne compte les superadmins, elle réécrit une
     * colonne d'attribution. Le décompte du dernier superadmin porte sur `role`
     * et sur `user_id`, que cette écriture ne touche pas — deux annulations
     * simultanées ne peuvent donc pas se croiser ici.
     *
     * Rejouée, elle ne touche plus aucune ligne : le prédicat porte sur la
     * valeur qu'elle efface (`docs/reliability.md` §1).
     */
    forgetGranter: async (userId) => {
      const disowned = await db
        .update(adminPlatformRole)
        .set({ grantedBy: null })
        .where(eq(adminPlatformRole.grantedBy, userId))
        .returning({ id: adminPlatformRole.id })

      return disowned.length
    },

    revokeSuperadmin: async (userId) =>
      await db.transaction(async (transaction) => {
        await lockPlatformRole(transaction)

        // **C'est ce prédicat qui refuse**, et lui seul : une lecture qui
        // déciderait, suivie d'un `delete` qui obéit, ferait deux vérités — et
        // la première à diverger serait celle qui écrit. Mesuré : la règle
        // placée **avant** l'écriture laisse le prédicat sans aucun test qui
        // rougisse à son retrait.
        const revoked = await transaction
          .delete(adminPlatformRole)
          .where(
            and(
              eq(adminPlatformRole.userId, userId),
              eq(adminPlatformRole.role, SUPERADMIN_ROLE),
              gt(
                sql<number>`(select count(*) from ${adminPlatformRole} as remaining
                    where remaining.role = ${SUPERADMIN_ROLE})`,
                1,
              ),
            ),
          )
          .returning({ id: adminPlatformRole.id })

        if (revoked.length > 0) {
          return { ok: true }
        }

        // Rien n'a été retiré : ou la cible ne portait pas le rôle, ou elle
        // était le dernier. **C'est la règle du `domain` qui nomme lequel**, sur
        // des faits lus sous le verrou — un seul vocabulaire, du refus en base
        // jusqu'au corps de la réponse. La distinction est faite **après**
        // l'écriture refusée, jamais avant.
        //
        // `null` voudrait dire que la règle et le prédicat divergent, ce que le
        // verrou rend impossible ; si cela arrivait, c'est l'écriture qui a
        // raison — elle a compté les restants au moment de retirer.
        const refusal = revocationRefusal(await readFacts(transaction, userId))

        return { ok: false, error: refusal ?? 'last_superadmin' }
      }),

    /**
     * **Le bannissement, sous le verrou du rôle de plateforme** (revue de
     * s37a, F2).
     *
     * Le geste lui-même appartient au socle (ADR 058) : il est **reçu** et
     * exécuté ici, la transaction ouverte et le verrou tenu. C'est ce qui le
     * sérialise avec la révocation — une révocation validée entre la décision
     * et l'écriture ferait de la cible le dernier superadmin, banni, et la
     * plateforme serait définitivement inadministrable.
     *
     * **Le coût, écrit plutôt que découvert** : le geste ouvre sa propre
     * connexion pendant que celle-ci est tenue. Le pool en compte dix par
     * défaut et refuse au bout de cinq secondes (`packages/db/src/client.ts`),
     * donc une rafale de bannissements simultanés échoue en le disant — elle ne
     * pend pas. Le bannissement est un geste d'administration, pas un chemin
     * de trafic.
     */
    banUnlessLastSuperadmin: async ({ userId, ban }) =>
      await db.transaction(async (transaction) => {
        await lockPlatformRole(transaction)

        const refusal = banRefusal(await readFacts(transaction, userId))

        if (refusal !== null) {
          // Refusé **avant** d'atteindre le socle : rien n'est écrit, aucune
          // session n'est révoquée.
          return { ok: false, error: refusal }
        }

        return { ok: true, outcome: await ban() }
      }),
  }
}
