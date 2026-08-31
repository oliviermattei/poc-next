import { and, eq, like, ne, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type {
  AuthSessionRepository,
  AuthUserRecord,
  AuthUserRepository,
  VerificationToken,
  VerificationTokenRepository,
} from '../application/ports'
import { isTokenExpired } from '../domain/one-time-token'
import { authSession, authUser, authVerification } from '../schema'

/**
 * Les repositories du module, sur **ses** tables.
 *
 * La connexion est **injectée** : ce package ne dépend pas de `@repo/db`, et
 * c'est ce qui empêche le cycle que `packages/db/src/schema.ts` annonçait
 * depuis s04 (`@repo/db` → baril généré → module → `@repo/db`). Le point de
 * composition possède la connexion ; le module lui dit ce qu'il en fait.
 *
 * Le type est réduit aux **quatre opérations** utilisées, et pas au
 * `NodePgDatabase<TSchema>` complet : ce dernier porte son schéma relationnel
 * dans son type, si bien qu'une connexion construite avec les tables de trois
 * modules ne serait pas assignable à une connexion typée sans schéma. Un module
 * n'a pas à connaître les tables des autres pour recevoir une connexion.
 */
export type AuthDatabase = Pick<
  PgDatabase<PgQueryResultHKT>,
  'select' | 'insert' | 'update' | 'delete'
>

/** Violation d'unicité PostgreSQL : c'est ainsi qu'une adresse déjà prise se dit. */
const UNIQUE_VIOLATION = '23505'

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === UNIQUE_VIOLATION

const toRecord = (row: {
  id: string
  email: string
  emailVerified: boolean
}): AuthUserRecord => ({ id: row.id, email: row.email, emailVerified: row.emailVerified })

export function createDrizzleAuthUserRepository(db: AuthDatabase): AuthUserRepository {
  const columns = {
    id: authUser.id,
    email: authUser.email,
    emailVerified: authUser.emailVerified,
  }

  return {
    findByEmail: async (email) => {
      const [row] = await db
        .select(columns)
        .from(authUser)
        .where(eq(authUser.email, email.toLowerCase()))
        .limit(1)

      return row === undefined ? null : toRecord(row)
    },

    findById: async (userId) => {
      const [row] = await db.select(columns).from(authUser).where(eq(authUser.id, userId)).limit(1)

      return row === undefined ? null : toRecord(row)
    },

    markEmailVerified: async (userId) => {
      const updated = await db
        .update(authUser)
        .set({ emailVerified: true, updatedAt: new Date() })
        .where(eq(authUser.id, userId))
        .returning({ id: authUser.id })

      return updated.length > 0
    },

    changeEmail: async (userId, email) => {
      try {
        const updated = await db
          .update(authUser)
          .set({ email: email.toLowerCase(), emailVerified: true, updatedAt: new Date() })
          .where(eq(authUser.id, userId))
          .returning({ id: authUser.id })

        return updated.length > 0
      } catch (error) {
        // L'unicité est tenue par la base, pas par une lecture préalable :
        // celle-ci laisserait une fenêtre de concurrence
        // (`docs/reliability.md` §1).
        if (isUniqueViolation(error)) {
          return false
        }

        throw error
      }
    },

    deleteById: async (userId) => {
      const deleted = await db
        .delete(authUser)
        .where(eq(authUser.id, userId))
        .returning({ id: authUser.id })

      return deleted.length > 0
    },
  }
}

export function createDrizzleAuthSessionRepository(db: AuthDatabase): AuthSessionRepository {
  return {
    countForUser: async (userId) => {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(authSession)
        .where(eq(authSession.userId, userId))

      return Number(row?.count ?? 0)
    },

    revokeAllForUser: async (userId) => {
      // La révocation est **une suppression de ligne**, pas un drapeau : une
      // session révoquée est refusée côté serveur parce qu'elle n'existe plus
      // (`docs/security.md` §2).
      const deleted = await db
        .delete(authSession)
        .where(eq(authSession.userId, userId))
        .returning({ id: authSession.id })

      return deleted.length
    },
  }
}

/**
 * Le magasin des jetons à usage unique.
 *
 * `consume` est **un seul ordre SQL** : `DELETE … RETURNING`. C'est ce qui rend
 * la consommation atomique — deux requêtes concurrentes sur le même lien
 * verrouillent la même ligne, et une seule la voit revenir. Une lecture suivie
 * d'une suppression laisserait au contraire une fenêtre où le même lien ouvre
 * deux sessions, et le socle nomme précisément ce défaut
 * (`docs/reliability.md` §1 : « jamais une simple vérification préalable »).
 */
export function createDrizzleVerificationTokenRepository(
  db: AuthDatabase,
  now: () => Date = () => new Date(),
): VerificationTokenRepository {
  return {
    create: async (token: VerificationToken) => {
      await db.insert(authVerification).values({
        // L'identifiant technique de la ligne, distinct de l'identifiant du
        // jeton : la bibliothèque écrit dans la même table et attend une clé
        // primaire textuelle.
        id: crypto.randomUUID(),
        identifier: token.identifier,
        value: token.value,
        expiresAt: token.expiresAt,
      })
    },

    consume: async (identifier) => {
      const [row] = await db
        .delete(authVerification)
        .where(eq(authVerification.identifier, identifier))
        .returning({
          identifier: authVerification.identifier,
          value: authVerification.value,
          expiresAt: authVerification.expiresAt,
        })

      if (row === undefined || isTokenExpired(row.expiresAt, now())) {
        // Un jeton expiré est supprimé quand même : il ne doit pas pouvoir
        // resservir plus tard, et l'appelant n'a pas à porter sa propre garde
        // d'expiration.
        return null
      }

      return row
    },

    invalidateSiblings: async ({ prefix, value, exceptIdentifier }) => {
      const sameFamily = and(
        like(authVerification.identifier, `${prefix}%`),
        eq(authVerification.value, value),
      )

      const deleted = await db
        .delete(authVerification)
        .where(
          exceptIdentifier === undefined
            ? sameFamily
            : and(sameFamily, ne(authVerification.identifier, exceptIdentifier)),
        )
        .returning({ id: authVerification.id })

      return deleted.length
    },
  }
}
