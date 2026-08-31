import { createHash } from 'node:crypto'

import { eq, lt, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type {
  ContactMessageRecord,
  ContactMessageRepository,
  PublicSubscriptionRecord,
  PublicSubscriptionRepository,
  SubmissionThrottle,
} from '../application/ports'
import { contactMessage, publicFormThrottle, publicSubscription } from '../schema'

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
 * Le condensat sous lequel un seau est écrit.
 *
 * L'identifiant d'appelant — une adresse IP quand un en-tête en donne une —
 * n'entre **jamais en clair** dans la base : ce serait une donnée personnelle
 * stockée pour compter, dans une table que personne ne purge. Le condensat
 * suffit au comptage, qui n'a besoin que d'égalité.
 *
 * Ce n'est pas de la pseudonymisation forte, et il faut le dire : un condensat
 * SHA-256 non salé d'une adresse IPv4 se retrouve par force brute. La propriété
 * obtenue est bornée — la table ne **contient** pas d'adresse — et elle est
 * écrite comme telle dans `docs/research/s11-public-forms.md` §6.4. s28, qui
 * possède la limitation de débit, héritera de la question.
 */
const digestOf = (key: string): string => createHash('sha256').update(key).digest('hex')

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
        .select({
          id: publicSubscription.id,
          email: publicSubscription.email,
          source: publicSubscription.source,
          locale: publicSubscription.locale,
          createdAt: publicSubscription.createdAt,
        })
        .from(publicSubscription)
        .where(eq(publicSubscription.email, email)),

    deleteByEmail: async (email) => {
      const rows = await db
        .delete(publicSubscription)
        .where(eq(publicSubscription.email, email))
        .returning({ id: publicSubscription.id })

      return rows.length
    },
  }
}

export function createDrizzleSubmissionThrottle(db: MarketingDatabase): SubmissionThrottle {
  return {
    hit: async ({ bucket, windowStart }) => {
      /**
       * **Une seule instruction**, donc atomique et partagée entre instances
       * (`docs/security.md` §7).
       *
       * Lire puis écrire laisserait deux instances observer le même compte et
       * le dépasser toutes les deux ; c'est le mode d'échec que le socle de
       * fiabilité appelle « une simple vérification préalable ».
       *
       * Le `case` fait la bascule de fenêtre : même fenêtre, on incrémente ;
       * fenêtre différente, on repart à un. Une ligne par seau, donc, et jamais
       * deux pour le même seau.
       *
       * **Ce que cela ne dit pas** : le nombre de seaux. Il y en a un par
       * identifiant d'appelant, et cet identifiant vient d'un en-tête que le
       * client écrit lui-même — la revue de s11 a mesuré 500 identifiants
       * distincts, 500 lignes, et rien pour les reprendre (constat F1). Ce que
       * le fichier affirmait alors — « la table ne grandit pas avec le temps » —
       * était faux. La borne est celle-ci, et elle est mesurée dans
       * `tests/marketing.test.ts` : les lignes d'une fenêtre **close** sont
       * effacées par `sweep` à la première soumission de la fenêtre suivante,
       * si bien que la table ne porte jamais plus que ce qu'une fenêtre a vu.
       */
      const rows = await db
        .insert(publicFormThrottle)
        .values({ bucket: digestOf(bucket.key), windowStartedAt: windowStart, hits: 1 })
        .onConflictDoUpdate({
          target: publicFormThrottle.bucket,
          set: {
            hits: sql`case when ${publicFormThrottle.windowStartedAt} = excluded.window_started_at then ${publicFormThrottle.hits} + 1 else 1 end`,
            windowStartedAt: sql`excluded.window_started_at`,
          },
        })
        .returning({ hits: publicFormThrottle.hits })

      return rows[0]?.hits ?? 1
    },

    sweep: async (before) => {
      /**
       * Une fenêtre close n'a plus de lecteur : `hit` ne consulte que la
       * fenêtre en cours, et repart à un dès qu'elle change. Ces lignes ne
       * servent donc plus à rien — les garder ne fait qu'entretenir un condensat
       * d'adresse pour l'éternité.
       *
       * L'effacement porte sur `window_started_at`, indexée pour cela : sans
       * l'index, chaque bascule de fenêtre balaierait la table entière.
       */
      const rows = await db
        .delete(publicFormThrottle)
        .where(lt(publicFormThrottle.windowStartedAt, before))
        .returning({ bucket: publicFormThrottle.bucket })

      return rows.length
    },
  }
}

/**
 * Les messages de contact, écrits **avant** l'envoi.
 *
 * Deux opérations et deux seulement sur le chemin d'une soumission : écrire,
 * puis marquer remis. Rien ne lit la table sur ce chemin — c'est la purge et
 * l'export du contrat qui la lisent, pour le périmètre d'un compte.
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
