import { and, asc, desc, eq, ilike, sql, type SQL } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type {
  ContactMessageRecord,
  ContactMessageRepository,
  PublicSubscriptionRecord,
  PublicSubscriptionRepository,
} from '../application/ports'
import { contactMessage, publicSubscription } from '../schema'

/**
 * Les repositories du module, sur **ses** tables.
 *
 * La connexion est **injectée** : ce package ne dépend pas de `@repo/db`, et
 * c'est ce qui empêche le cycle `@repo/db` → agrégat généré → module (ADR 020).
 * Le type est réduit aux opérations employées, comme dans `auth` et
 * `organizations` : un `NodePgDatabase<TSchema>` complet porterait le schéma des
 * autres modules dans son type, et une connexion construite avec trois modules
 * ne lui serait pas assignable.
 */
export type MarketingDatabase = Pick<
  PgDatabase<PgQueryResultHKT>,
  'select' | 'insert' | 'update' | 'delete'
>

/**
 * **Les colonnes d'une inscription, écrites une fois** : deux listes recopiées
 * divergeraient, et la seconde serait celle qui oublie une colonne.
 */
const subscriptionColumns = {
  id: publicSubscription.id,
  email: publicSubscription.email,
  source: publicSubscription.source,
  locale: publicSubscription.locale,
  createdAt: publicSubscription.createdAt,
} as const

/**
 * Échappe les jokers d'un motif `LIKE`.
 *
 * `_` et `%` sont des jokers **et** des caractères légaux d'une adresse ; non
 * échappés, `%` seul rendrait la table entière derrière un décompte faux. Même
 * fonction, même raison que dans `auth` (s34, s37b2).
 */
const escapeLikePattern = (value: string): string =>
  value.replaceAll(/[\\%_]/g, (match) => `\\${match}`)

export function createDrizzlePublicSubscriptions(
  db: MarketingDatabase,
): PublicSubscriptionRepository {
  return {
    subscribe: async (input) => {
      /**
       * **L'idempotence est portée par la contrainte**, pas par une lecture
       * préalable (`docs/reliability.md` §1). `onConflictDoNothing` sur le
       * couple `(source, email)` rend une liste vide quand la ligne existait :
       * c'est ce vide, et rien d'autre, qui dit qu'aucun email de confirmation
       * n'est à envoyer. Deux soumissions simultanées passeraient toutes les
       * deux un `select` ; elles ne passent pas cette contrainte.
       */
      const rows = await db
        .insert(publicSubscription)
        .values(input)
        .onConflictDoNothing({
          target: [publicSubscription.source, publicSubscription.email],
        })
        .returning()

      return (rows[0] as PublicSubscriptionRecord | undefined) ?? null
    },

    listByEmail: async (email) =>
      await db
        .select(subscriptionColumns)
        .from(publicSubscription)
        .where(eq(publicSubscription.email, email)),

    /**
     * **Qui est inscrit à quoi** (s37c).
     *
     * Deux lectures et pas une jointure : le décompte porte sur la **même**
     * condition que la page, sans quoi la pagination compterait autre chose que
     * ce qu'elle affiche. C'est la forme que `auth` emploie pour la liste des
     * comptes (s37b2), et pour la même raison.
     *
     * La recherche est une **valeur liée**, jamais interpolée, et ses jokers
     * sont échappés avant d'entrer dans `ilike`.
     */
    listBySource: async ({ source, search, limit, offset }) => {
      const conditions: SQL[] = []

      if (source !== null) {
        conditions.push(eq(publicSubscription.source, source))
      }

      if (search !== null) {
        conditions.push(ilike(publicSubscription.email, `%${escapeLikePattern(search)}%`))
      }

      const condition = conditions.length === 0 ? undefined : and(...conditions)

      const page = db
        .select(subscriptionColumns)
        .from(publicSubscription)
        .where(condition)
        // Un ordre **total** : `created_at` seul laisse deux inscriptions de la
        // même milliseconde changer de place d'une page à l'autre, et une ligne
        // se retrouve alors sur deux pages ou sur aucune.
        .orderBy(desc(publicSubscription.createdAt), asc(publicSubscription.id))

      // `limit: null` — l'export lit tout ce que le filtre retient. La borne
      // manquante est écrite au port : rien ne la fixe aujourd'hui.
      const rows = limit === null ? await page : await page.limit(limit).offset(offset)

      const [counted] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(publicSubscription)
        .where(condition)

      return { subscriptions: rows, total: Number(counted?.total ?? 0) }
    },

    listSources: async () => {
      // `groupBy` plutôt que `selectDistinct` : la connexion injectée est
      // volontairement réduite à quatre opérations (`MarketingDatabase`), et
      // l'élargir pour une seule lecture donnerait au module une surface de
      // base qu'il n'a pas besoin d'avoir.
      const rows = await db
        .select({ source: publicSubscription.source })
        .from(publicSubscription)
        .groupBy(publicSubscription.source)
        .orderBy(asc(publicSubscription.source))

      return rows.map((row) => row.source)
    },

    deleteByEmail: async (email) => {
      const rows = await db
        .delete(publicSubscription)
        .where(eq(publicSubscription.email, email))
        .returning({ id: publicSubscription.id })

      return rows.length
    },
  }
}

/**
 * **`public_form_throttle` n'est plus écrite** (s28).
 *
 * `createDrizzleSubmissionThrottle` vivait ici et y écrivait. Le compteur a
 * convergé vers le port partagé (`shared-submission-throttle.ts`), et la table
 * reste en place, **vide et inerte** : `docs/reliability.md` impose de cesser
 * d'écrire avant de supprimer, et la version encore en ligne l'écrit toujours
 * pendant un basculement — que s27 a mesuré non instantané. Sa suppression est
 * une story ultérieure (ADR 050). Ne la faites pas ici, et n'écrivez pas un
 * second compteur.
 */

export function createDrizzleContactMessages(db: MarketingDatabase): ContactMessageRepository {
  return {
    record: async (input) => {
      const rows = await db.insert(contactMessage).values(input).returning()

      const created = rows[0] as ContactMessageRecord | undefined

      if (created === undefined) {
        // `returning()` sur une insertion sans conflit rend toujours la ligne :
        // un vide ici n'est pas un cas métier, c'est une panne, et la taire
        // ferait répondre « message reçu » sans qu'il le soit.
        throw new Error('Le message de contact n’a pas pu être enregistré.')
      }

      return created
    },

    markDelivered: async ({ id, at }) => {
      await db.update(contactMessage).set({ deliveredAt: at }).where(eq(contactMessage.id, id))
    },

    listByEmail: async (email) =>
      await db
        .select({
          id: contactMessage.id,
          name: contactMessage.name,
          email: contactMessage.email,
          message: contactMessage.message,
          locale: contactMessage.locale,
          createdAt: contactMessage.createdAt,
          deliveredAt: contactMessage.deliveredAt,
        })
        .from(contactMessage)
        .where(eq(contactMessage.email, email)),

    deleteByEmail: async (email) => {
      const rows = await db
        .delete(contactMessage)
        .where(eq(contactMessage.email, email))
        .returning({ id: contactMessage.id })

      return rows.length
    },
  }
}
