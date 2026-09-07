import type { ModuleSeed, ModuleSeedContext } from '@repo/core'
import { hashPassword } from 'better-auth/crypto'
import { createLocalAccountIssuer } from 'better-auth/db'
import { count, notInArray } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import { authAccount, authUser } from '../schema'

/**
 * **Les comptes de démonstration** (s58), et la garde qui les rend inoffensifs.
 *
 * Le module qui possède les comptes est le seul endroit où « la base est déjà
 * en service » puisse être un **fait** plutôt qu'une variable : le socle refuse
 * de déduire un comportement de `NODE_ENV`, et un seed est exactement l'outil
 * qui ne doit pas dépendre d'une variable pour être inoffensif.
 *
 * Le fait retenu : **un compte que ce seed n'a pas créé lui-même**. Il connaît
 * les siens — ce sont les périmètres qu'il reçoit —, donc il n'a rien à
 * deviner. Un produit en service porte toujours un autre compte ; une base de
 * découverte n'en porte aucun.
 *
 * La connexion est **injectée**, comme partout dans ce module, et le type est
 * réduit aux deux opérations utilisées : ce package ne dépend pas de
 * `@repo/db`.
 */
export type AuthSeedDatabase = Pick<PgDatabase<PgQueryResultHKT>, 'select' | 'insert'>

/**
 * **Le mot de passe des comptes de démonstration.**
 *
 * Il est dans le dépôt, donc public par construction : c'est pourquoi il est
 * écrit en toutes lettres comme ce qu'il est. Ce qui empêche un tel mot de
 * passe d'atteindre une base en service n'est pas son contenu, c'est la garde
 * ci-dessus (`docs/security.md` §5).
 */
export const DEMONSTRATION_PASSWORD = 'demonstration-seulement'

/**
 * Les personnes de démonstration, **manifestement fictives** : le domaine
 * `.invalid` est réservé par la RFC 2606 et ne peut recevoir aucun courrier, et
 * le nom porte le mot « démo ». Aucune adresse d'ici ne peut passer pour réelle.
 *
 * Elles sont associées **dans l'ordre** aux périmètres de compte reçus : le
 * premier est celui que les autres modules traitent comme propriétaire.
 */
const DEMONSTRATION_PEOPLE = [
  { name: 'Ada Démo', email: 'ada@demonstration.invalid' },
  { name: 'Hedy Démo', email: 'hedy@demonstration.invalid' },
] as const

const countForeignAccounts = async (
  database: AuthSeedDatabase,
  accountIds: readonly string[],
): Promise<number> => {
  const rows = await database
    .select({ total: count() })
    .from(authUser)
    // Aucun périmètre reçu : **tout** compte est alors étranger au seed. Un
    // `notInArray` sur une liste vide ne dirait pas la même chose — et cette
    // branche-là est mesurée (`tests/seed.test.ts`), les périmètres livrés
    // portant toujours deux comptes : sans ce cas, elle n'était vraie que par
    // lecture.
    .where(accountIds.length === 0 ? undefined : notInArray(authUser.id, [...accountIds]))

  return Number(rows[0]?.total ?? 0)
}

export const authDemonstrationSeed: ModuleSeed = {
  id: 'comptes',
  run: async ({ database, demonstration }: ModuleSeedContext<AuthSeedDatabase>) => {
    const accountIds = demonstration
      .filter((scope) => scope.kind === 'user')
      .map((scope) => scope.userId)

    const foreign = await countForeignAccounts(database, accountIds)

    if (foreign > 0) {
      throw new Error(
        `Le seed de démonstration refuse : la base porte ${foreign} compte(s) que ce seed ` +
          'n’a pas créé(s). C’est une base en service, pas une base de découverte — aucune ' +
          'donnée de démonstration n’y est écrite.',
      )
    }

    for (const [index, userId] of accountIds.entries()) {
      const person = DEMONSTRATION_PEOPLE[index]

      // Plus de périmètres que de personnes déclarées : le module ne fabrique
      // pas une identité de remplissage, il s'arrête.
      if (person === undefined) {
        break
      }

      await database
        .insert(authUser)
        .values({
          id: userId,
          name: person.name,
          email: person.email,
          // Vérifié : sans cela le compte existe et ne peut pas se connecter
          // (`requireEmailVerification`), ce qui rendrait la démonstration
          // aussi longue à ouvrir qu'une inscription à la main.
          emailVerified: true,
        })
        .onConflictDoNothing()

      // L'empreinte et l'émetteur viennent de la **bibliothèque**, jamais d'une
      // forme recopiée : c'est ce qui garantit que le chemin de connexion
      // ordinaire accepte ces comptes. `hashPassword` sale à chaque appel, donc
      // l'empreinte change d'une exécution à l'autre — l'écriture est
      // conditionnée par l'identifiant, qui lui ne change pas.
      await database
        .insert(authAccount)
        .values({
          id: `${userId}-credential`,
          userId,
          accountId: userId,
          providerId: 'credential',
          issuer: createLocalAccountIssuer('credential'),
          password: await hashPassword(DEMONSTRATION_PASSWORD),
        })
        .onConflictDoNothing()
    }
  },
}
