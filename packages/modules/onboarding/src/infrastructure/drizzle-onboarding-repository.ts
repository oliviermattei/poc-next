import { eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type { OnboardingProgressRepository } from '../application/ports'
import { onboardingProgress } from '../schema'

/**
 * Le repository du module, sur **sa** table.
 *
 * La connexion est **injectée** : ce package ne dépend pas de `@repo/db`, ce
 * qui empêche le cycle `@repo/db` → agrégat généré → module (ADR 020). Le type
 * est réduit aux opérations employées, comme dans `auth`, `organizations`,
 * `storage` et `notifications`.
 *
 * **Toutes les requêtes sont paramétrées** : Drizzle lie les valeurs, aucune
 * n'est concaténée dans du SQL (`docs/security.md` §4).
 */
export type OnboardingDatabase = Pick<
  PgDatabase<PgQueryResultHKT>,
  'select' | 'insert' | 'update' | 'delete'
>

export function createDrizzleOnboardingRepository(
  db: OnboardingDatabase,
): OnboardingProgressRepository {
  return {
    find: async (userId) => {
      const [row] = await db
        .select({
          clearedSteps: onboardingProgress.clearedSteps,
          completedAt: onboardingProgress.completedAt,
        })
        .from(onboardingProgress)
        .where(eq(onboardingProgress.userId, userId))
        .limit(1)

      return row === undefined
        ? null
        : { clearedSteps: row.clearedSteps, completedAt: row.completedAt }
    },

    /**
     * **Une écriture, jamais « lire puis choisir »** : la clé primaire arbitre,
     * si bien que deux requêtes concurrentes ne peuvent pas créer deux lignes.
     * Rejouée, elle réécrit les mêmes valeurs et laisse une seule ligne
     * (`docs/reliability.md` §1).
     */
    save: async (userId, progress) => {
      const values = {
        clearedSteps: progress.clearedSteps,
        completedAt: progress.completedAt,
        updatedAt: new Date(),
      }

      await db
        .insert(onboardingProgress)
        .values({ userId, ...values })
        .onConflictDoUpdate({ target: onboardingProgress.userId, set: values })
    },

    erase: async (userId) => {
      await db.delete(onboardingProgress).where(eq(onboardingProgress.userId, userId))
    },
  }
}
