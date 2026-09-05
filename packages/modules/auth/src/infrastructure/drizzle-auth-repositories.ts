import { and, eq, inArray, isNull, like, lt, ne, or, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type {
  AuthAccountRepository,
  AuthPasskeyRepository,
  AuthSessionRepository,
  AuthUserRecord,
  AuthUserRepository,
  TwoFactorRepository,
  VerificationToken,
  VerificationTokenRepository,
} from '../application/ports'
import { canUnlinkSignInMethod } from '../domain/oauth'
import { isTokenExpired } from '../domain/one-time-token'
import {
  authAccount,
  authPasskey,
  authSession,
  authTwoFactor,
  authUser,
  authVerification,
} from '../schema'

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
/**
 * Échappe les jokers d'un motif `LIKE` (s34).
 *
 * `_` et `%` sont des jokers **et** des caractères légaux d'un identifiant ou
 * d'une adresse ; non échappés, un motif construit à partir d'une valeur de la
 * base atteindrait des lignes voisines.
 */
const escapeLikePattern = (value: string): string =>
  value.replaceAll(/[\\%_]/g, (match) => `\\${match}`)

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
  banned: boolean
}): AuthUserRecord => ({
  id: row.id,
  name: row.name,
  email: row.email,
  emailVerified: row.emailVerified,
  twoFactorEnabled: row.twoFactorEnabled,
  banned: row.banned,
})

export function createDrizzleAuthUserRepository(db: AuthDatabase): AuthUserRepository {
  const columns = {
    id: authUser.id,
    name: authUser.name,
    email: authUser.email,
    emailVerified: authUser.emailVerified,
    twoFactorEnabled: authUser.twoFactorEnabled,
    banned: authUser.banned,
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

    /**
     * **Lue à chaque ouverture de session** (s37a) : une seule colonne, un seul
     * index primaire. Un compte introuvable rend `true` — le sens fermé : la
     * garde refuse plutôt que d'ouvrir une session à un compte qui n'existe
     * plus.
     */
    isBanned: async (userId) => {
      const [row] = await db
        .select({ banned: authUser.banned })
        .from(authUser)
        .where(eq(authUser.id, userId))
        .limit(1)

      return row === undefined ? true : row.banned
    },

    setBanned: async ({ userId, banned, at, reason }) => {
      const updated = await db
        .update(authUser)
        .set({
          banned,
          // Débannir efface la marque : `banned_at` et le motif n'ont de sens
          // que tant que la sanction dure.
          bannedAt: banned ? at : null,
          bannedReason: banned ? reason : null,
          updatedAt: at,
        })
        .where(eq(authUser.id, userId))
        .returning({ id: authUser.id })

      return updated.length > 0
    },

    findByIds: async (userIds) => {
      // **Une instruction pour N identifiants** (revue s32, R3-3). La liste vide
      // ne part pas en base : `inArray(col, [])` est une condition qu'aucun
      // dialecte ne traite pareil, et il n'y a de toute façon rien à lire.
      if (userIds.length === 0) {
        return []
      }

      const rows = await db.select(columns).from(authUser).where(inArray(authUser.id, [...userIds]))

      return rows.map(toRecord)
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

/** Les opérations que ce module demande à une transaction. */
type AuthTransaction = Parameters<Parameters<AuthDatabase['transaction']>[0]>[0]

/**
 * **Verrouille tous les moyens de connexion du compte, dans un ordre fixe.**
 *
 * Un seul endroit, appelé par le déliement d'un compte et par la révocation
 * d'une passkey : les deux verrouillent `auth_account` **puis** `auth_passkey`.
 * L'ordre n'est pas décoratif — deux retraits croisés qui prendraient les deux
 * verrous en sens inverse se bloqueraient mutuellement, et PostgreSQL en
 * tuerait un.
 *
 * `total` est ce que `canUnlinkSignInMethod` (`domain/oauth.ts`) reçoit : la
 * règle du dernier moyen de connexion n'a pas changé, c'est son entrée qui
 * compte désormais les deux tables.
 */
const lockSignInMethods = async (
  transaction: AuthTransaction,
  userId: string,
): Promise<{
  accounts: readonly { id: string }[]
  passkeys: readonly { id: string }[]
  total: number
}> => {
  const accounts = await transaction
    .select({ id: authAccount.id })
    .from(authAccount)
    .where(eq(authAccount.userId, userId))
    .for('update')

  const passkeys = await transaction
    .select({ id: authPasskey.id })
    .from(authPasskey)
    .where(eq(authPasskey.userId, userId))
    .for('update')

  return { accounts, passkeys, total: accounts.length + passkeys.length }
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
       *
       * **Depuis s14, les passkeys comptent aussi.** La règle n'a pas changé —
       * c'est toujours `canUnlinkSignInMethod` — mais son entrée est désormais
       * la somme des deux tables : un compte qui n'a qu'un fournisseur *et* une
       * passkey pouvait se voir refuser le déliement alors qu'il lui restait un
       * moyen de connexion. Les deux tables sont verrouillées **dans le même
       * ordre** ici et dans `revokeForUser` — comptes puis passkeys —, sans
       * quoi deux retraits croisés se bloqueraient l'un l'autre.
       */
      return await db.transaction(async (transaction) => {
        const rows = await lockSignInMethods(transaction, userId)

        if (!rows.accounts.some((row) => row.id === accountId)) {
          // Ni « pas à vous », ni « n'existe pas » : la même réponse pour les
          // deux (`docs/security.md` §3).
          return 'not_found'
        }

        if (!canUnlinkSignInMethod(rows.total)) {
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
 * Les passkeys d'un compte (s14).
 *
 * Le module possède la lecture, le renommage et la révocation ; le greffon
 * garde l'enrôlement et la vérification, qui sont de la cryptographie. Les
 * trois raisons de ne pas déclarer ses points d'entrée pour ces opérations
 * sont dans `packages/modules/auth/AGENTS.md`, et elles se lisent dans les
 * trois fonctions ci-dessous.
 */
export function createDrizzleAuthPasskeyRepository(db: AuthDatabase): AuthPasskeyRepository {
  return {
    listForUser: async (userId) => {
      // Les colonnes sont **énumérées**, comme pour les sessions et les moyens
      // de connexion : un `select()` nu ramènerait `publicKey`, `credentialID`
      // et `counter`. Le point d'entrée `list-user-passkeys` du greffon, lui,
      // rend la ligne entière — c'est pourquoi le module ne le déclare pas.
      return await db
        .select({
          id: authPasskey.id,
          name: authPasskey.name,
          createdAt: authPasskey.createdAt,
        })
        .from(authPasskey)
        .where(eq(authPasskey.userId, userId))
    },

    countForUser: async (userId) => {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(authPasskey)
        .where(eq(authPasskey.userId, userId))

      return Number(row?.count ?? 0)
    },

    renameForUser: async ({ userId, passkeyId, name }) => {
      // **Un seul ordre SQL**, propriétaire dans la condition : il n'existe pas
      // d'instant où la passkey d'autrui est trouvée puis modifiée. Rend
      // `false` quand rien ne correspond — l'appelant ne peut pas distinguer
      // « pas à vous » de « n'existe pas » (`docs/security.md` §3), là où
      // `requireResourceOwnership` du greffon rend `401` dans un cas et `404`
      // dans l'autre.
      const updated = await db
        .update(authPasskey)
        .set({ name })
        .where(and(eq(authPasskey.id, passkeyId), eq(authPasskey.userId, userId)))
        .returning({ id: authPasskey.id })

      return updated.length > 0
    },

    revokeForUser: async ({ userId, passkeyId }) => {
      // Même forme que le déliement d'un moyen de connexion, et pour la même
      // raison : la bibliothèque compte puis supprime **hors transaction**
      // (`api/routes/account.mjs`), ce qui laisse deux retraits simultanés
      // vider le compte. Ici les deux tables sont verrouillées dans l'ordre
      // fixe de `lockSignInMethods`, et la règle est celle du `domain`.
      return await db.transaction(async (transaction) => {
        const rows = await lockSignInMethods(transaction, userId)

        if (!rows.passkeys.some((row) => row.id === passkeyId)) {
          return 'not_found'
        }

        if (!canUnlinkSignInMethod(rows.total)) {
          return 'last-method'
        }

        const deleted = await transaction
          .delete(authPasskey)
          .where(and(eq(authPasskey.id, passkeyId), eq(authPasskey.userId, userId)))
          .returning({ id: authPasskey.id })

        return deleted.length > 0 ? 'revoked' : 'not_found'
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

    /**
     * **Les jetons qui nomment un compte effacé** (s34).
     *
     * `auth_verification` n'a pas de clé étrangère vers `auth_user` : sa valeur
     * est une adresse, ou « identifiant espace adresse » pour un changement
     * d'email. Rien ne l'emporte par cascade, d'où cet effacement explicite,
     * appelé par la purge du module pendant que le compte existe encore.
     *
     * **Des valeurs nommées et un motif ancré, aucun joker libre** — la liste
     * exacte se lit dans `conditions`, juste en dessous ; un nombre écrit ici
     * vieillirait à trois lignes de ce qu'il compte, et celui-ci a vieilli dans
     * le commit même qui l'a écrit (constat m1 de la quatrième revue).
     *
     * Le premier jet cherchait `%<valeur>%` : sur une table partagée par tous
     * les comptes, cela emportait les jetons d'un tiers dont l'adresse contient
     * celle de la cible (`a@b.co` contre `a@b.com`), et, sans échappement, ceux
     * d'une adresse qui n'en diffère que par un `_`. Les valeurs visées étant
     * connues et fermées, le prédicat les nomme : rien ne dépasse.
     *
     * Le seul motif restant — `<identifiant> %` — est ancré à gauche sur un
     * identifiant de compte suivi d'une espace, ce qu'aucune autre famille de
     * jetons ne produit. `like` reste échappé sur l'identifiant, qui vient de la
     * base et pourrait un jour porter un caractère de motif.
     */
    deleteNaming: async ({ userId, email }) => {
      if (userId === '' && email === '') {
        return 0
      }

      const conditions = [
        // Le jeton de vérification d'adresse : sa valeur **est** l'adresse.
        email === '' ? undefined : eq(authVerification.value, email),
        // Le changement d'email en attente, dans les deux sens de lecture :
        // la valeur exacte quand les deux sont connus, et tout changement
        // **émis par** ce compte quelle que soit l'adresse visée.
        userId === '' || email === ''
          ? undefined
          : eq(authVerification.value, `${userId} ${email}`),
        userId === ''
          ? undefined
          : like(authVerification.value, `${escapeLikePattern(userId)} %`),
      ].filter((condition) => condition !== undefined)

      const deleted = await db
        .delete(authVerification)
        .where(or(...conditions))
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
