import { and, eq, gt, inArray, sql, type SQL } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type { AdminAccountsPort, GrantOutcome, PlatformRoleRepository } from '../application/ports'
import {
  banRefusal,
  revocationRefusal,
  signInCapableSuperadmins,
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

/** Les identifiants qui portent le rôle, lus **sous le verrou**, en une requête. */
const readSuperadminIds = async (executor: AdminExecutor): Promise<readonly string[]> => {
  const rows = await executor
    .select({ userId: adminPlatformRole.userId })
    .from(adminPlatformRole)
    .where(eq(adminPlatformRole.role, SUPERADMIN_ROLE))

  return rows.map((row) => row.userId)
}

/**
 * L'état lu **sous le verrou**, ou l'aveu qu'il n'a pas pu l'être.
 *
 * ## Pourquoi le port est interrogé **depuis** la transaction, et pourquoi c'est
 * sûr
 *
 * Le décompte doit compter les superadmins **capables de se connecter**, or
 * « banni » vit dans le socle (ADR 058), derrière `AdminAccountsPort` — **qui
 * emploie sa propre connexion**. La lecture des comptes se fait donc hors de
 * cette transaction : ce qu'elle rend est l'état *commis*, pas celui de notre
 * instantané. La jointure, elle, est interdite pour une raison écrite
 * (`src/schema.ts`).
 *
 * Ce qui rend la séquence sûre est **mesuré, pas supposé** : le seul écrivain
 * SQL de `auth_user.banned` est `setBanned`
 * (`packages/modules/auth/src/infrastructure/drizzle-auth-repositories.ts`),
 * appelé par les deux seuls cas d'usage `banAccount` / `unbanAccount` du socle,
 * eux-mêmes atteints par le seul port `AdminAccountsPort.ban` / `.unban` — et
 * `ban` ne s'exécute que **dans** `banUnlessLastSuperadmin`, verrou tenu. Le
 * greffon `admin` de Better Auth, qui écrirait ce champ tout seul, n'est pas
 * monté. Aucun bannissement ne peut donc s'intercaler pendant que nous tenons
 * le verrou.
 *
 * Ce qui a été balayé pour l'établir, sans en écrire le compte — un nombre écrit
 * ici vieillirait à la ligne suivante : les fichiers du dépôt qui nomment
 * `banned` (`grep -rl banned`, hors `node_modules`), les `update(authUser)` du
 * socle, et la liste des greffons réellement montés dans
 * `better-auth-service.ts`.
 *
 * Le **débannissement**, lui, ne prend pas le verrou : il ne peut que faire
 * *grandir* le décompte, et le lire trop bas refuse un geste au lieu d'en
 * autoriser un — le sens fermé.
 */
type PlatformRoleState =
  | { readonly ok: true; readonly facts: PlatformRoleFacts; readonly blocked: readonly string[] }
  | { readonly ok: false }

const readState = async (
  executor: AdminExecutor,
  accounts: AdminAccountsPort,
  userId: string,
): Promise<PlatformRoleState> => {
  const superadminIds = await readSuperadminIds(executor)
  const blocked = await accounts.signInBlockedAmong(superadminIds)

  // Le port ne lève pas : il rend un échec, et un échec n'est pas « personne
  // n'est banni ». Décider d'une révocation ou d'un bannissement sur un
  // décompte qu'on n'a pas serait exactement la lecture optimiste que la dette
  // de `s37a` a coûtée.
  if (!blocked.ok) {
    return { ok: false }
  }

  const closed = new Set(blocked.blocked)

  return {
    ok: true,
    blocked: blocked.blocked,
    facts: {
      superadminCount: signInCapableSuperadmins({
        superadminIds,
        signInBlocked: blocked.blocked,
      }),
      targetIsSuperadmin: superadminIds.includes(userId),
      targetCanSignIn: !closed.has(userId),
    },
  }
}

/**
 * « Il reste un superadmin capable de se connecter **autre que la cible** »,
 * écrit en SQL et évalué **dans le `delete`**.
 *
 * Les identifiants fermés sont des paramètres, jamais une jointure : c'est la
 * borne d'import de `src/schema.ts`. Ils ont été lus sous le même verrou que
 * cette écriture, donc aucun bannissement ne peut les avoir périmés.
 */
const anotherSignInCapableSuperadmin = (input: {
  readonly userId: string
  readonly blocked: readonly string[]
}): SQL =>
  sql`(select count(*) from ${adminPlatformRole} as remaining
      where remaining.role = ${SUPERADMIN_ROLE}
        and remaining.user_id <> ${input.userId}
        ${
          input.blocked.length === 0
            ? sql``
            : sql`and remaining.user_id not in (${sql.join(
                input.blocked.map((closed) => sql`${closed}`),
                sql`, `,
              )})`
        })`

/**
 * L'insertion du rôle, telle que `s37a` l'a écrite : c'est la **base** qui tient
 * l'unicité, jamais une lecture préalable. Elle est extraite pour être exécutée
 * dans la transaction qui tient le verrou.
 */
const grant = async (
  executor: AdminExecutor,
  input: { readonly userId: string; readonly grantedBy: string | null; readonly at: Date },
): Promise<GrantOutcome> => {
  try {
    const inserted = await executor
      .insert(adminPlatformRole)
      .values({
        // **La clé primaire est dérivée du couple (compte, rôle)**, celui-là
        // même que porte l'index unique : deux promotions simultanées du même
        // compte visent alors la même ligne, et la seconde est un no-op plutôt
        // qu'un doublon que le décompte compterait deux fois.
        id: `${SUPERADMIN_ROLE}_${input.userId}`,
        userId: input.userId,
        role: SUPERADMIN_ROLE,
        grantedAt: input.at,
        grantedBy: input.grantedBy,
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
}

export function createDrizzlePlatformRoleRepository(
  db: AdminDatabase,
  accounts: AdminAccountsPort,
): PlatformRoleRepository {
  return {
    /**
     * **Le décompte de la désignation**, et il compte lui aussi les comptes
     * capables de se connecter (s37b1, critère « tout décompte »).
     *
     * Conséquence : une plateforme dont **tous** les porteurs du rôle sont
     * fermés redevient désignable par `SUPERADMIN_EMAIL`. C'est la seule
     * réparation automatique de l'état redouté ; un décompte de lignes la
     * rendait impossible.
     *
     * Lecture des comptes en échec : le nombre de **lignes** est rendu. Il est
     * supérieur ou égal au décompte réel, donc la désignation ne se déclenche
     * pas — accorder un rôle sur un état inconnu serait le sens ouvert.
     */
    countSuperadmins: async () => {
      const superadminIds = await readSuperadminIds(db)
      const blocked = await accounts.signInBlockedAmong(superadminIds)

      return blocked.ok
        ? signInCapableSuperadmins({ superadminIds, signInBlocked: blocked.blocked })
        : superadminIds.length
    },

    superadminsAmong: async (userIds) => {
      // La liste vide ne part pas en base : `inArray(col, [])` n'est traité
      // pareil par aucun dialecte, et il n'y a de toute façon rien à lire.
      if (userIds.length === 0) {
        return []
      }

      const rows = await db
        .select({ userId: adminPlatformRole.userId })
        .from(adminPlatformRole)
        .where(
          and(
            inArray(adminPlatformRole.userId, [...userIds]),
            eq(adminPlatformRole.role, SUPERADMIN_ROLE),
          ),
        )

      return rows.map((row) => row.userId)
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

    /**
     * **La promotion prend le même verrou que les deux autres écritures**
     * (s37b1), et ce n'est pas une symétrie décorative.
     *
     * Elle ajoute une ligne que le prédicat de la révocation **compte**. Sans
     * sérialisation, une promotion validée entre la lecture des comptes fermés
     * et le `delete` ferait compter une ligne dont personne n'a demandé au
     * socle si son porteur peut encore entrer : promouvoir un compte **banni**
     * pendant qu'une révocation est en vol suffisait alors à faire retirer le
     * rôle du dernier superadmin utilisable. Mesuré par un cas **concurrent** —
     * un cas séquentiel laisserait cette mutation verte.
     */
    grantSuperadmin: async ({ userId, grantedBy, at }) =>
      await db.transaction(async (transaction) => {
        await lockPlatformRole(transaction)

        return await grant(transaction, { userId, grantedBy, at })
      }),

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

        // L'état est lu **avant** l'écriture, parce que le prédicat en a besoin :
        // il doit exclure du décompte les porteurs fermés, et ce sont les
        // comptes du socle qui le disent. La lecture et l'écriture restent dans
        // la même transaction, sous le même verrou.
        const state = await readState(transaction, accounts, userId)

        if (!state.ok) {
          return { ok: false, error: 'accounts_unavailable' }
        }

        // **C'est ce prédicat qui refuse**, et lui seul : une lecture qui
        // déciderait, suivie d'un `delete` qui obéit, ferait deux vérités — et
        // la première à diverger serait celle qui écrit. Mesuré : la règle
        // placée **avant** l'écriture laisse le prédicat sans aucun test qui
        // rougisse à son retrait.
        //
        // Une cible **déjà fermée** ne retire rien à l'administrabilité : son
        // retrait n'a pas de prédicat de survivant, et c'est le seul geste qui
        // nettoie une plateforme à moitié fermée.
        const revoked = await transaction
          .delete(adminPlatformRole)
          .where(
            and(
              eq(adminPlatformRole.userId, userId),
              eq(adminPlatformRole.role, SUPERADMIN_ROLE),
              state.facts.targetCanSignIn
                ? gt(anotherSignInCapableSuperadmin({ userId, blocked: state.blocked }), 0)
                : undefined,
            ),
          )
          .returning({ id: adminPlatformRole.id })

        if (revoked.length > 0) {
          return { ok: true }
        }

        // Rien n'a été retiré : ou la cible ne portait pas le rôle, ou elle
        // était le dernier **utilisable**. C'est la règle du `domain` qui nomme
        // lequel, sur des faits lus sous le verrou — un seul vocabulaire, du
        // refus en base jusqu'au corps de la réponse.
        //
        // `null` voudrait dire que la règle et le prédicat divergent, ce que le
        // verrou rend impossible ; si cela arrivait, c'est l'écriture qui a
        // raison — elle a compté les restants au moment de retirer.
        return { ok: false, error: revocationRefusal(state.facts) ?? 'last_superadmin' }
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
     * connexion pendant que celle-ci est tenue. Depuis `s37b1`, la lecture des
     * comptes fermés en ouvre une elle aussi — et **la révocation la paie
     * également**, pas seulement le bannissement. Le pool en compte dix par
     * défaut et refuse au bout de cinq secondes (`packages/db/src/client.ts`),
     * donc une rafale de gestes simultanés échoue en le disant — elle ne pend
     * pas. Administrer n'est pas un chemin de trafic.
     */
    banUnlessLastSuperadmin: async ({ userId, ban }) =>
      await db.transaction(async (transaction) => {
        await lockPlatformRole(transaction)

        const state = await readState(transaction, accounts, userId)

        if (!state.ok) {
          return { ok: false, error: 'accounts_unavailable' }
        }

        const refusal = banRefusal(state.facts)

        if (refusal !== null) {
          // Refusé **avant** d'atteindre le socle : rien n'est écrit, aucune
          // session n'est révoquée.
          return { ok: false, error: refusal }
        }

        return { ok: true, outcome: await ban() }
      }),
  }
}
