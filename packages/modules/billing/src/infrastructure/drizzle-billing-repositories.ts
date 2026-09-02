import type { ModuleScope } from '@repo/core'
import { and, desc, eq, lte } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type {
  BillingCustomerRecord,
  BillingRepository,
  SubscriptionRecord,
  SubscriptionWrite,
} from '../application/ports'
import type { SubscriptionStatus } from '../domain/subscription'
import { billingCustomer, billingSubscription, billingWebhookEvent } from '../schema'

/**
 * Le repository du module, sur **ses** tables.
 *
 * La connexion est **injectée** : ce package ne dépend pas de `@repo/db`, et
 * c'est ce qui empêche le cycle `@repo/db` → agrégat généré → module (ADR 020).
 * Le type est réduit aux opérations employées, comme dans `auth`,
 * `organizations` et `marketing` : un `NodePgDatabase<TSchema>` complet
 * porterait le schéma des autres modules dans son type.
 */

/**
 * **L'ordre de lecture des abonnements d'un client, écrit une seule fois.**
 *
 * Il est exporté parce qu'un second appelant en a besoin, et un seul :
 * `tests/billing.test.ts` le passe à `EXPLAIN` pour vérifier que l'index
 * `billing_subscription_customer_idx` le **sert** — le plan portait un `Sort`
 * par-dessus l'index, l'ordre des `NULL` ne correspondant pas (constat m1 de la
 * seconde revue). Le réécrire là-bas ferait deux vérités, et la première à
 * diverger serait celle qui mesure.
 */
export const subscriptionReadOrder = [
  desc(billingSubscription.lastEventAt),
  desc(billingSubscription.currentPeriodEnd),
  desc(billingSubscription.providerSubscriptionId),
]

/**
 * Ce qu'une transaction de ce module fait, et rien de plus : elle journalise et
 * elle écrit. Elle ne lit pas — la décision d'ordre est dans le prédicat de
 * l'écriture, pas dans une lecture préalable.
 */
type TransactionalWriter = Pick<PgDatabase<PgQueryResultHKT>, 'insert' | 'update'>

export type BillingDatabase = Pick<
  PgDatabase<PgQueryResultHKT>,
  'select' | 'insert' | 'update' | 'delete'
> & {
  /**
   * La transaction, **réduite à ce qu'on en fait**.
   *
   * Reprendre la signature de `PgDatabase` rendrait le type invariant sur le
   * schéma : une connexion construite avec les tables de plusieurs modules
   * n'est pas assignable à une connexion typée sans schéma — mesuré en s15, et
   * de nouveau ici. Un module n'a pas à connaître les tables des autres pour
   * recevoir une connexion.
   */
  transaction<T>(run: (writer: TransactionalWriter) => Promise<T>): Promise<T>
}

const scopeColumns = (scope: ModuleScope): { kind: ModuleScope['kind']; id: string } =>
  scope.kind === 'organization'
    ? { kind: 'organization', id: scope.organizationId }
    : { kind: 'user', id: scope.userId }

const CUSTOMER_COLUMNS = {
  id: billingCustomer.id,
  scopeKind: billingCustomer.scopeKind,
  scopeId: billingCustomer.scopeId,
  providerCustomerId: billingCustomer.providerCustomerId,
}

const SUBSCRIPTION_COLUMNS = {
  providerSubscriptionId: billingSubscription.providerSubscriptionId,
  billingCustomerId: billingSubscription.billingCustomerId,
  offerId: billingSubscription.offerId,
  priceId: billingSubscription.priceId,
  status: billingSubscription.status,
  quantity: billingSubscription.quantity,
  currentPeriodEnd: billingSubscription.currentPeriodEnd,
  cancelAtPeriodEnd: billingSubscription.cancelAtPeriodEnd,
  trialEnd: billingSubscription.trialEnd,
  lastEventAt: billingSubscription.lastEventAt,
  lastEventId: billingSubscription.lastEventId,
}

const asCustomer = (row: Record<string, unknown> | undefined): BillingCustomerRecord | null =>
  row === undefined ? null : (row as unknown as BillingCustomerRecord)

const asSubscription = (row: Record<string, unknown> | undefined): SubscriptionRecord | null =>
  row === undefined ? null : (row as unknown as SubscriptionRecord)

/** Les colonnes qu'une réconciliation compare. Le reste est dérivé ou technique. */
const differs = (stored: SubscriptionRecord, write: SubscriptionWrite): boolean =>
  stored.status !== write.status ||
  stored.quantity !== write.quantity ||
  stored.priceId !== write.priceId ||
  stored.offerId !== write.offerId ||
  stored.cancelAtPeriodEnd !== write.cancelAtPeriodEnd ||
  stored.currentPeriodEnd.getTime() !== write.currentPeriodEnd.getTime() ||
  (stored.trialEnd?.getTime() ?? null) !== (write.trialEnd?.getTime() ?? null)

export function createDrizzleBillingRepository(db: BillingDatabase): BillingRepository {
  const customerForScope = async (
    connection: BillingDatabase,
    scope: ModuleScope,
  ): Promise<BillingCustomerRecord | null> => {
    const { kind, id } = scopeColumns(scope)
    const rows = await connection
      .select(CUSTOMER_COLUMNS)
      .from(billingCustomer)
      .where(and(eq(billingCustomer.scopeKind, kind), eq(billingCustomer.scopeId, id)))
      .limit(1)

    return asCustomer(rows[0])
  }

  return {
    customerForScope: async (scope) => await customerForScope(db, scope),

    /**
     * **Une contrainte d'unicité, jamais une lecture préalable**
     * (`docs/reliability.md` §1).
     *
     * `onConflictDoNothing` sur `(scope_kind, scope_id)` rend une liste vide
     * quand la ligne existait : on relit alors celle qui est là. Deux ouvertures
     * de checkout simultanées passeraient toutes les deux un `select` ; elles ne
     * passent pas cette contrainte, et le périmètre ne se retrouve pas avec deux
     * clients — donc deux abonnements payés.
     */
    linkCustomer: async ({ id, scope, providerCustomerId }) => {
      const { kind, id: scopeId } = scopeColumns(scope)
      const rows = await db
        .insert(billingCustomer)
        .values({ id, scopeKind: kind, scopeId, providerCustomerId })
        .onConflictDoNothing({ target: [billingCustomer.scopeKind, billingCustomer.scopeId] })
        .returning(CUSTOMER_COLUMNS)

      const inserted = asCustomer(rows[0])

      if (inserted !== null) {
        return inserted
      }

      const existing = await customerForScope(db, scope)

      if (existing === null) {
        // Inatteignable par construction : le conflit signifie qu'une ligne
        // existe. Levé plutôt que replié, pour qu'un défaut de schéma se voie.
        throw new Error('billing_customer : conflit sur un périmètre introuvable')
      }

      return existing
    },

    customerByProviderId: async (providerCustomerId) => {
      const rows = await db
        .select(CUSTOMER_COLUMNS)
        .from(billingCustomer)
        .where(eq(billingCustomer.providerCustomerId, providerCustomerId))
        .limit(1)

      return asCustomer(rows[0])
    },

    /**
     * **Un ordre total, et il est écrit ici.**
     *
     * Sans `order by`, PostgreSQL rend l'ordre d'insertion — donc l'abonnement
     * **annulé** en premier chez un client qui s'est réabonné, et l'écran
     * disait « expiré » à quelqu'un qui venait de payer (constat F1).
     *
     * Les trois clés en font un ordre **total**, jamais ambigu : l'horodatage
     * d'événement d'abord, la fin de période ensuite — la réconciliation pose
     * le même instant sur toutes les lignes d'un client —, et l'identifiant du
     * fournisseur en dernier, qui est unique par construction. Deux lectures
     * successives rendent donc la même liste, quoi que fasse le moteur.
     *
     * Elle ne choisit pas : `currentSubscriptionOf` (dans le `domain`) décide
     * lequel est *le* sien, parce que celui qui donne l'accès l'emporte sur le
     * plus récent.
     */
    subscriptionsOfCustomer: async (billingCustomerId) =>
      (await db
        .select(SUBSCRIPTION_COLUMNS)
        .from(billingSubscription)
        .where(eq(billingSubscription.billingCustomerId, billingCustomerId))
        .orderBy(...subscriptionReadOrder)) as readonly SubscriptionRecord[],

    /**
     * Le journal **et** l'effet, dans une seule transaction.
     *
     * Deux propriétés, et elles sont indissociables :
     *
     * 1. **l'idempotence vient de la clé primaire.** `onConflictDoNothing` rend
     *    une liste vide sur un rejeu, et l'effet n'est alors pas appliqué. Une
     *    lecture préalable laisserait la fenêtre où deux livraisons simultanées
     *    passent toutes les deux ;
     * 2. **l'ordre est dans le prédicat de l'écriture**, pas dans une lecture
     *    suivie d'une décision : `setWhere` compare l'horodatage enregistré à
     *    celui de l'événement. C'est la règle que `appliesAfter` **nomme** dans
     *    le `domain` (ADR 034) ; ici elle **refuse**. Les deux disent `>=` — le
     *    domaine l'énonce, ce prédicat l'applique, et `tests/billing.test.ts` le
     *    prouve contre la base.
     *
     * Un effet en échec annule aussi le journal : le rejeu du fournisseur reste
     * possible. Sans cela, un événement à demi traité serait refusé pour
     * toujours.
     */
    applyEvent: async ({ eventId, type, effect }) =>
      await db.transaction(async (tx) => {
        const journal = await tx
          .insert(billingWebhookEvent)
          .values({ eventId, type })
          .onConflictDoNothing({ target: billingWebhookEvent.eventId })
          .returning({ eventId: billingWebhookEvent.eventId })

        if (journal.length === 0) {
          return false
        }

        if (effect.kind === 'subscription') {
          const { write } = effect

          await tx
            .insert(billingSubscription)
            .values({ ...write, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: billingSubscription.providerSubscriptionId,
              set: {
                billingCustomerId: write.billingCustomerId,
                offerId: write.offerId,
                priceId: write.priceId,
                status: write.status,
                quantity: write.quantity,
                currentPeriodEnd: write.currentPeriodEnd,
                cancelAtPeriodEnd: write.cancelAtPeriodEnd,
                trialEnd: write.trialEnd,
                lastEventAt: write.lastEventAt,
                lastEventId: write.lastEventId,
                updatedAt: new Date(),
              },
              // L'ordre, dans le prédicat : un événement plus ancien n'écrase
              // rien. L'égalité passe — deux événements de la même seconde
              // décrivent le même instant (ADR 034).
              setWhere: lte(billingSubscription.lastEventAt, write.lastEventAt),
            })
        }

        if (effect.kind === 'payment_failed') {
          await tx
            .update(billingSubscription)
            .set({
              status: 'past_due' satisfies SubscriptionStatus,
              lastEventAt: effect.lastEventAt,
              lastEventId: effect.lastEventId,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(billingSubscription.providerSubscriptionId, effect.providerSubscriptionId),
                lte(billingSubscription.lastEventAt, effect.lastEventAt),
              ),
            )
        }

        return true
      }),

    listCustomers: async () =>
      (await db.select(CUSTOMER_COLUMNS).from(billingCustomer)) as readonly BillingCustomerRecord[],

    /**
     * La réconciliation : elle **compare avant d'écrire**, et rend le nombre de
     * lignes réellement changées.
     *
     * Lire puis écrire est acceptable ici — et seulement ici : cette commande
     * n'est pas concurrente, elle est lancée à la main ou par un ordonnanceur.
     * Le compte est ce qui rend l'idempotence **observable** : une seconde
     * exécution rend zéro (`docs/reliability.md` §1).
     */
    replaceSubscriptions: async ({ billingCustomerId, subscriptions }) => {
      let changed = 0

      for (const write of subscriptions) {
        const rows = await db
          .select(SUBSCRIPTION_COLUMNS)
          .from(billingSubscription)
          .where(eq(billingSubscription.providerSubscriptionId, write.providerSubscriptionId))
          .limit(1)

        const stored = asSubscription(rows[0])

        if (stored !== null && !differs(stored, write)) {
          continue
        }

        await db
          .insert(billingSubscription)
          .values({ ...write, billingCustomerId, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: billingSubscription.providerSubscriptionId,
            set: {
              billingCustomerId,
              offerId: write.offerId,
              priceId: write.priceId,
              status: write.status,
              quantity: write.quantity,
              currentPeriodEnd: write.currentPeriodEnd,
              cancelAtPeriodEnd: write.cancelAtPeriodEnd,
              trialEnd: write.trialEnd,
              lastEventAt: write.lastEventAt,
              lastEventId: write.lastEventId,
              updatedAt: new Date(),
            },
          })

        changed += 1
      }

      return changed
    },

    /**
     * La purge du périmètre.
     *
     * Les abonnements partent par la clé étrangère (`on delete cascade`), qui
     * reste **à l'intérieur du module** : ADR 018 n'autorise une référence que
     * vers un requis déclaré, et `billing` n'en a aucun. Le journal
     * d'événements n'est pas touché : il ne porte que des identifiants
     * d'événements du fournisseur, aucune donnée personnelle, et l'effacer
     * rouvrirait le rejeu d'événements déjà traités.
     */
    deleteScope: async (scope) => {
      const { kind, id } = scopeColumns(scope)
      const rows = await db
        .delete(billingCustomer)
        .where(and(eq(billingCustomer.scopeKind, kind), eq(billingCustomer.scopeId, id)))
        .returning({ id: billingCustomer.id })

      return rows.length
    },
  }
}
