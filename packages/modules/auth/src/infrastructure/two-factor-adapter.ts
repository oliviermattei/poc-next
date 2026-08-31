import { and, eq } from 'drizzle-orm'
import type { drizzleAdapter } from 'better-auth/adapters/drizzle'

import { authTwoFactor } from '../schema'
import type { AuthDatabase } from './drizzle-auth-repositories'

/**
 * **La consommation d'un code de secours, rendue réellement atomique** (s13).
 *
 * ## Le défaut, mesuré
 *
 * `backup-codes/index.mjs` consomme un code par comparaison-et-échange :
 *
 * ```js
 * adapter.incrementOne({
 *   model: 'twoFactor',
 *   where: [{ field: 'id', value: … }, { field: 'backupCodes', value: <ancien> }],
 *   increment: {}, set: { backupCodes: <nouveau> },
 * })
 * ```
 *
 * `@better-auth/core` documente `incrementOne` comme « the race-safe primitive
 * for guarded state transitions ». L'implémentation PostgreSQL de
 * `@better-auth/drizzle-adapter@1.7.2` ne l'est pas (`dist/index.mjs:494`) :
 *
 * ```sql
 * UPDATE t SET … WHERE id IN (SELECT id FROM t WHERE <garde> LIMIT 1) RETURNING *
 * ```
 *
 * La garde vit dans un **sous-select**, pas dans la qualification de l'`UPDATE`.
 * Sous `READ COMMITTED`, le second écrivain attend le verrou de ligne puis
 * ré-évalue sa qualification (EvalPlanQual) — mais le sous-select rescanne la
 * table avec le snapshot de sa commande, où l'ancienne valeur est encore
 * visible. La garde passe donc, et **deux consommations simultanées du même
 * code réussissent toutes les deux**.
 *
 * Ce n'est pas une déduction : le cas de `tests/auth.test.ts` a ouvert deux
 * sessions avec un seul code, une exécution sur quatre, avant cette correction.
 *
 * ## La correction
 *
 * Un seul `UPDATE`, la garde dans **sa propre** qualification :
 *
 * ```sql
 * UPDATE auth_two_factor SET backup_codes = $nouveau
 * WHERE id = $id AND backup_codes = $ancien RETURNING *
 * ```
 *
 * Là, la ré-évaluation d'EvalPlanQual porte sur la ligne **mise à jour** : le
 * perdant ne matche plus, aucune ligne n'est rendue, et la bibliothèque répond
 * `CONFLICT` — exactement ce qu'elle prévoit.
 *
 * ## Ce que cette enveloppe ne fait pas
 *
 * Elle ne réécrit **qu'une forme**, reconnue précisément : le modèle
 * `twoFactor`, une garde sur `id` **et** `backupCodes`, aucun incrément, un
 * seul champ posé. Tout le reste — le compteur d'échecs et le verrouillage par
 * compte, qui passent par le même point d'entrée avec des opérateurs `gte` et
 * `lte` — retourne intact à l'adapter de la bibliothèque. Élargir la
 * reconnaissance reviendrait à réécrire un adapter, ce que ce module n'a pas à
 * faire.
 *
 * ## Ce que l'enveloppe court-circuite, et qui est vérifié inoffensif
 *
 * Elle enveloppe l'adapter **externe** : elle reçoit donc l'entrée non
 * transformée (nom de modèle `twoFactor`, champs au nom de modèle), ce qui est
 * exactement ce que la reconnaissance ci-dessus attend — mais elle écrit
 * ensuite en Drizzle **sans repasser** par les `transformInput` /
 * `transformOutput` de `@better-auth/core` (`db/adapter/factory.mjs:719-769`).
 * Deux effets, tous deux mesurés inoffensifs sur le paquet installé, et c'est
 * la **quatrième** hypothèse de ce fichier (revue s13, C7) :
 *
 * - aucun champ `onUpdate` n'est appliqué — le schéma du greffon
 *   (`plugins/two-factor/schema.mjs`) n'en déclare aucun, donc rien ne manque ;
 * - la ligne rendue est brute, castée `as T` — le seul appelant n'en teste que
 *   la vérité (`if (!await adapter.incrementOne(...)) throw CONFLICT`).
 *
 * Un `onUpdate` ajouté au modèle `twoFactor`, ou un appelant qui se mettrait à
 * lire un champ de la ligne rendue, rouvre ce paragraphe.
 *
 * Le jour où l'adapter corrige sa branche PostgreSQL, ce fichier devient un
 * doublon inoffensif — et le cas de course reste là pour le dire.
 */

type AdapterFactory = ReturnType<typeof drizzleAdapter>
type Adapter = ReturnType<AdapterFactory>
type IncrementOne = Adapter['incrementOne']
type IncrementOneInput = Parameters<IncrementOne>[0]

/** Le nom de **modèle** que le greffon passe, littéral dans ses trois lectures. */
const TWO_FACTOR_MODEL = 'twoFactor'

interface BackupCodeSwap {
  readonly id: string
  readonly previous: string
  readonly next: string
}

/**
 * Cette écriture est-elle la comparaison-et-échange des codes de secours ?
 *
 * Reconnue par sa **forme entière**, pas par le seul nom du modèle : deux
 * conditions d'égalité et pas une de plus, aucun incrément, et un unique champ
 * posé. Une forme voisine — celle du verrouillage par compte, qui porte un
 * opérateur — n'entre pas ici et garde le chemin de la bibliothèque.
 */
const backupCodeSwap = (input: IncrementOneInput): BackupCodeSwap | null => {
  if (input.model !== TWO_FACTOR_MODEL || Object.keys(input.increment).length > 0) {
    return null
  }

  const set = input.set ?? {}

  if (Object.keys(set).length !== 1 || typeof set.backupCodes !== 'string') {
    return null
  }

  if (input.where.length !== 2 || input.where.some((clause) => clause.operator !== undefined && clause.operator !== 'eq')) {
    return null
  }

  const id = input.where.find((clause) => clause.field === 'id')?.value
  const previous = input.where.find((clause) => clause.field === 'backupCodes')?.value

  if (typeof id !== 'string' || typeof previous !== 'string') {
    return null
  }

  return { id, previous, next: set.backupCodes }
}

/**
 * L'adapter de la bibliothèque, avec la seule écriture ci-dessus reprise.
 *
 * La connexion est celle du module — **reçue**, comme partout ailleurs
 * (ADR 020) : ce fichier n'importe pas `@repo/db`.
 */
export function withAtomicBackupCodeConsumption(
  db: AuthDatabase,
  factory: AdapterFactory,
): AdapterFactory {
  return (options) => {
    const adapter = factory(options)

    const incrementOne = async <T>(input: IncrementOneInput): Promise<T | null> => {
      const swap = backupCodeSwap(input)

      if (swap === null) {
        return await adapter.incrementOne<T>(input)
      }

      const [row] = await db
        .update(authTwoFactor)
        .set({ backupCodes: swap.next })
        .where(
          and(eq(authTwoFactor.id, swap.id), eq(authTwoFactor.backupCodes, swap.previous)),
        )
        .returning()

      return (row ?? null) as T | null
    }

    return { ...adapter, incrementOne }
  }
}
