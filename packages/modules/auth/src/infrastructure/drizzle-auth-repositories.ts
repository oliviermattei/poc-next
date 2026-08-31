import { and, eq, isNull, like, lt, ne, or, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type {
  AuthAccountRepository,
  AuthSessionRepository,
  AuthUserRecord,
  AuthUserRepository,
  TwoFactorRepository,
  VerificationToken,
  VerificationTokenRepository,
} from '../application/ports'
import { canUnlinkSignInMethod } from '../domain/oauth'
import { isTokenExpired } from '../domain/one-time-token'
import { authAccount, authSession, authTwoFactor, authUser, authVerification } from '../schema'

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
> &
  AuthTransactions

/**
 * La transaction, **déclarée ici plutôt que reprise de Drizzle**.
 *
 * `Pick<PgDatabase, 'transaction'>` ne marche pas : la signature de Drizzle
 * porte le schéma relationnel **dans le type du paramètre** de son rappel, si
 * bien qu'une connexion construite avec les tables de trois modules n'est plus
 * assignable — mesuré, c'est l'erreur que rendait `pnpm typecheck`. La
 * déclarer en méthode, et faire recevoir au rappel les quatre opérations que ce
 * module utilise, dit exactement ce dont il a besoin : un module n'a pas à
 * connaître les tables des autres pour ouvrir une transaction.
 */
export interface AuthTransactions {
  transaction<TResult>(
    run: (
      transaction: Pick<PgDatabase<PgQueryResultHKT>, 'select' | 'insert' | 'update' | 'delete'>,
    ) => Promise<TResult>,
  ): Promise<TResult>
}

/** Violation d'unicité PostgreSQL : c'est ainsi qu'une adresse déjà prise se dit. */
const UNIQUE_VIOLATION = '23505'

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === UNIQUE_VIOLATION

const toRecord = (row: {
  id: string
  name: string
  email: string
  emailVerified: boolean
  twoFactorEnabled: boolean
}): AuthUserRecord => ({
  id: row.id,
  name: row.name,
  email: row.email,
  emailVerified: row.emailVerified,
  twoFactorEnabled: row.twoFactorEnabled,
})

export function createDrizzleAuthUserRepository(db: AuthDatabase): AuthUserRepository {
  const columns = {
    id: authUser.id,
    name: authUser.name,
    email: authUser.email,
    emailVerified: authUser.emailVerified,
    twoFactorEnabled: authUser.twoFactorEnabled,
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

    changeName: async (userId, name) => {
      const updated = await db
        .update(authUser)
        .set({ name, updatedAt: new Date() })
        .where(eq(authUser.id, userId))
        .returning({ id: authUser.id })

      return updated.length > 0
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

    listForUser: async (userId) => {
      // Les colonnes sont **énumérées** : un `select()` nu ramènerait le jeton
      // de session, que le `domain` retirerait ensuite — une garde de plus à
      // ne pas oublier, au lieu d'une donnée qui ne sort jamais de la base.
      return await db
        .select({
          id: authSession.id,
          createdAt: authSession.createdAt,
          expiresAt: authSession.expiresAt,
          ipAddress: authSession.ipAddress,
          userAgent: authSession.userAgent,
        })
        .from(authSession)
        .where(eq(authSession.userId, userId))
    },

    revokeForUser: async ({ userId, sessionId }) => {
      // **Un seul ordre SQL**, et le propriétaire est dans la condition : c'est
      // ce qui rend impossible de révoquer la session d'un autre compte, y
      // compris en devinant un identifiant.
      const deleted = await db
        .delete(authSession)
        .where(and(eq(authSession.id, sessionId), eq(authSession.userId, userId)))
        .returning({ id: authSession.id })

      return deleted.length > 0
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

export function createDrizzleAuthAccountRepository(db: AuthDatabase): AuthAccountRepository {
  return {
    listForUser: async (userId) => {
      // Les colonnes sont **énumérées**, comme pour les sessions : un `select()`
      // nu ramènerait l'empreinte du mot de passe et les jetons du fournisseur,
      // qu'il faudrait ensuite penser à retirer.
      return await db
        .select({
          id: authAccount.id,
          providerId: authAccount.providerId,
          createdAt: authAccount.createdAt,
        })
        .from(authAccount)
        .where(eq(authAccount.userId, userId))
    },

    unlinkForUser: async ({ userId, accountId }) => {
      /**
       * **Une transaction, et un verrou sur les moyens du compte.**
       *
       * `SELECT … FOR UPDATE` verrouille toutes les lignes du compte, dans le
       * même ordre pour tout le monde : un second déliement simultané attend,
       * puis relit — et PostgreSQL réévalue sa condition après le verrou, donc
       * il voit le moyen déjà retiré. Sans ce verrou, les deux requêtes lisent
       * « il en reste deux » et le compte se retrouve sans aucun moyen de
       * connexion. Mesuré : le cas de concurrence est rouge sans lui.
       */
      return await db.transaction(async (transaction) => {
        const rows = await transaction
          .select({ id: authAccount.id })
          .from(authAccount)
          .where(eq(authAccount.userId, userId))
          .for('update')

        if (!rows.some((row) => row.id === accountId)) {
          // Ni « pas à vous », ni « n'existe pas » : la même réponse pour les
          // deux (`docs/security.md` §3).
          return 'not_found'
        }

        if (!canUnlinkSignInMethod(rows.length)) {
          return 'last-method'
        }

        const deleted = await transaction
          .delete(authAccount)
          .where(and(eq(authAccount.id, accountId), eq(authAccount.userId, userId)))
          .returning({ id: authAccount.id })

        return deleted.length > 0 ? 'unlinked' : 'not_found'
      })
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

/**
 * **La garde de rejeu d'un code TOTP**, côté magasin (revue s13, C3).
 *
 * Un pas de trente secondes n'est consommable qu'une fois par compte. La
 * comparaison-et-échange est dans la **qualification de l'`UPDATE`**, jamais
 * une lecture suivie d'une écriture : deux vérifications simultanées du même
 * code, sur deux défis distincts, franchiraient sinon toutes deux une
 * vérification préalable (`docs/reliability.md` §1). Ici, la perdante ne met
 * à jour aucune ligne, et son appelant la refuse.
 *
 * `is null` fait partie de la condition : une ligne créée avant cette colonne
 * — ou par un enrôlement qui n'a encore rien consommé — doit pouvoir prendre
 * son premier pas.
 */
export function createDrizzleTwoFactorRepository(db: AuthDatabase): TwoFactorRepository {
  return {
    findByUserId: async (userId) => {
      const [row] = await db
        .select({ secret: authTwoFactor.secret, lastTotpStep: authTwoFactor.lastTotpStep })
        .from(authTwoFactor)
        .where(eq(authTwoFactor.userId, userId))
        .limit(1)

      return row ?? null
    },

    claimTotpStep: async ({ userId, step }) => {
      const claimed = await db
        .update(authTwoFactor)
        .set({ lastTotpStep: step })
        .where(
          and(
            eq(authTwoFactor.userId, userId),
            or(isNull(authTwoFactor.lastTotpStep), lt(authTwoFactor.lastTotpStep, step)),
          ),
        )
        .returning({ id: authTwoFactor.id })

      return claimed.length === 1
    },
  }
}
