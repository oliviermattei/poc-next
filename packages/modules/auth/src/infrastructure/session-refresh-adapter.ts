import { and, eq, isNull } from 'drizzle-orm'
import type { drizzleAdapter } from 'better-auth/adapters/drizzle'

import { authSession } from '../schema'
import type { AuthDatabase } from './drizzle-auth-repositories'

/**
 * **La fenêtre glissante ne prolonge pas une session empruntée** (constat C2 de
 * la revue de s37b1).
 *
 * ## Le défaut, mesuré
 *
 * `api/routes/session.mjs:173` décide du renouvellement ainsi :
 *
 * ```js
 * const shouldBeUpdated =
 *   session.session.expiresAt.valueOf() - expiresIn * 1e3 + updateAge * 1e3 <= Date.now()
 * ```
 *
 * Pour une session ordinaire — écrite avec `expiresAt = maintenant + expiresIn`
 * — le test est faux tant que `updateAge` n'est pas écoulé : c'est la fenêtre
 * glissante voulue. Pour une ligne écrite avec une échéance **plus courte** que
 * `expiresIn`, il est **toujours vrai** : la première lecture repousse
 * l'échéance à `expiresIn`.
 *
 * Mesuré avant cette enveloppe : une session d'impersonation ouverte à une heure
 * passait à **sept jours** dès la première requête servie. L'heure annoncée par
 * `AuthPolicy.impersonationTtlSeconds`, par `packages/modules/admin/AGENTS.md`
 * et par l'ADR 064 était donc fausse partout — et la fenêtre d'un accès
 * résiduel se comptait en jours.
 *
 * ## La correction
 *
 * Le renouvellement s'exécute avec une qualification de plus :
 *
 * ```sql
 * UPDATE auth_session SET expires_at = $1, updated_at = $2
 * WHERE token = $3 AND impersonated_by IS NULL RETURNING *
 * ```
 *
 * Une ligne empruntée n'est donc jamais prolongée : son échéance reste celle de
 * l'emprunt, et c'est **la bibliothèque elle-même** qui la refuse ensuite —
 * `getSession` supprime une session échue et rend `null`, sur tous ses chemins,
 * y compris ses propres points d'entrée. La garde n'est pas dans un résolveur
 * qu'un appelant pourrait contourner : elle est dans la donnée.
 *
 * La ligne courante est rendue telle quelle quand rien n'a été mis à jour :
 * rendre `null` ferait croire à la bibliothèque que la session a disparu, et
 * elle déconnecterait (`session.mjs:196`).
 *
 * ## Ce que cette enveloppe ne fait pas
 *
 * Elle ne reconnaît **qu'une forme** — modèle `session`, exactement les deux
 * champs du renouvellement, une seule condition d'égalité sur le jeton. Toute
 * autre écriture de session retourne intacte à l'adapter de la bibliothèque.
 * C'est la discipline de `two-factor-adapter.ts`, et pour la même raison :
 * élargir la reconnaissance reviendrait à réécrire un adapter.
 *
 * Comme cette enveloppe-là, elle écrit en Drizzle sans repasser par les
 * `transformInput` / `transformOutput` de `@better-auth/core` : la ligne rendue
 * est brute. Le modèle `session` du socle ne déclare aucun champ `onUpdate`, et
 * l'appelant relit `expiresAt`, `token` et `userId`, que Drizzle rend déjà sous
 * ces noms. Un champ transformé ajouté au modèle rouvre ce paragraphe.
 *
 * La commande qui rougit si tout cela cesse d'être vrai : `pnpm test`, cas « ne
 * prolonge pas une session empruntée à la première lecture » **et** « prolonge
 * toujours une session ordinaire arrivant en fin de fenêtre » de
 * `tests/admin.test.ts` — le second est là pour que la correction reste
 * étroite : elle ne doit pas éteindre la fenêtre glissante de tout le monde.
 */

type AdapterFactory = ReturnType<typeof drizzleAdapter>
type Adapter = ReturnType<AdapterFactory>
type Update = Adapter['update']
type UpdateInput = Parameters<Update>[0]

/** Le nom de **modèle** que la bibliothèque passe pour une session. */
const SESSION_MODEL = 'session'

interface SessionRefresh {
  readonly token: string
  readonly expiresAt: Date
  readonly updatedAt: Date
}

/**
 * Cette écriture est-elle le renouvellement de la fenêtre glissante ?
 *
 * Reconnue par sa forme entière : le modèle, les deux champs posés
 * (`session.mjs:192`), et l'unique condition d'égalité sur le jeton.
 */
const sessionRefresh = (input: UpdateInput): SessionRefresh | null => {
  if (input.model !== SESSION_MODEL || input.where.length !== 1) {
    return null
  }

  const [clause] = input.where

  if (
    clause === undefined ||
    clause.field !== 'token' ||
    (clause.operator !== undefined && clause.operator !== 'eq') ||
    typeof clause.value !== 'string'
  ) {
    return null
  }

  const update: Record<string, unknown> = input.update as Record<string, unknown>
  const fields = Object.keys(update)

  if (fields.length !== 2 || !fields.includes('expiresAt') || !fields.includes('updatedAt')) {
    return null
  }

  const { expiresAt, updatedAt } = update

  if (!(expiresAt instanceof Date) || !(updatedAt instanceof Date)) {
    return null
  }

  return { token: clause.value, expiresAt, updatedAt }
}

export function withoutBorrowedSessionRefresh(
  db: AuthDatabase,
  factory: AdapterFactory,
): AdapterFactory {
  return (options) => {
    const adapter = factory(options)

    const update = async <T>(input: UpdateInput): Promise<T | null> => {
      const refresh = sessionRefresh(input)

      if (refresh === null) {
        return await adapter.update<T>(input)
      }

      const [extended] = await db
        .update(authSession)
        .set({ expiresAt: refresh.expiresAt, updatedAt: refresh.updatedAt })
        .where(and(eq(authSession.token, refresh.token), isNull(authSession.impersonatedBy)))
        .returning()

      if (extended !== undefined) {
        return extended as T
      }

      // Session empruntée — ou disparue entre-temps. La ligne est rendue telle
      // quelle : `null` ferait déconnecter la bibliothèque.
      const [current] = await db
        .select()
        .from(authSession)
        .where(eq(authSession.token, refresh.token))
        .limit(1)

      return (current ?? null) as T | null
    }

    return { ...adapter, update }
  }
}
