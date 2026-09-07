import type { ModuleScope, ModuleSeed, ModuleSeedContext } from '@repo/core'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type { SubscriptionStatus } from '../domain/subscription'
import { billingCustomer, billingSubscription } from '../schema'

/**
 * **Un abonnement de démonstration par périmètre reçu** (s58).
 *
 * « Par périmètre reçu », et pas « pour l'organisation » : le propriétaire
 * d'une donnée dépend de l'activation du module `organizations` (ADR 025), et
 * un seed qui choisirait l'un des deux laisserait l'écran de facturation vide
 * dans l'autre configuration — celle que `pnpm test:minimal-profile` sert. Ce
 * module déclare `requires: []` et ne connaît aucun des deux : il sème pour ce
 * qu'on lui donne.
 *
 * **L'offre est celle du catalogue livré** (`config/billing.ts`, `pro-monthly`).
 * Ce module ne lit pas la configuration — le catalogue lui est transmis au
 * point de composition —, donc le seed écrit la valeur livrée avec le dépôt.
 * Conséquence à connaître : remplacer le catalogue par le sien sans resemer
 * laisse la ligne de démonstration s'afficher « offre inconnue », ce que
 * `offer_id` nullable prévoit déjà. C'est une donnée de démonstration, pas un
 * état à réconcilier.
 */
export type BillingSeedDatabase = Pick<PgDatabase<PgQueryResultHKT>, 'insert'>

const DEMONSTRATION_OFFER = { offerId: 'pro-monthly', priceId: 'price_pro_monthly' } as const

/** Le statut vient du **vocabulaire du domaine**, jamais d'un littéral libre. */
const DEMONSTRATION_STATUS: SubscriptionStatus = 'active'

const scopeIdentifier = (scope: ModuleScope): string =>
  scope.kind === 'organization' ? scope.organizationId : scope.userId

export const billingDemonstrationSeed: ModuleSeed = {
  id: 'abonnement',
  run: async ({ database, demonstration }: ModuleSeedContext<BillingSeedDatabase>) => {
    for (const scope of demonstration) {
      const scopeId = scopeIdentifier(scope)
      const customerId = `demo-client-${scopeId}`

      await database
        .insert(billingCustomer)
        .values({
          id: customerId,
          scopeKind: scope.kind,
          scopeId,
          // Manifestement fictif : aucun identifiant de ce dépôt n'existe chez
          // le fournisseur, et le mot le dit.
          providerCustomerId: `cus_demonstration_${scopeId}`,
        })
        .onConflictDoNothing()

      await database
        .insert(billingSubscription)
        .values({
          providerSubscriptionId: `sub_demonstration_${scopeId}`,
          billingCustomerId: customerId,
          ...DEMONSTRATION_OFFER,
          status: DEMONSTRATION_STATUS,
          quantity: 1,
          // Une période qui court : une date figée dans le passé afficherait un
          // abonnement expiré, c'est-à-dire une démonstration en panne. Elle
          // n'est écrite qu'une fois — la seconde exécution ne réécrit rien.
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
          cancelAtPeriodEnd: false,
          trialEnd: null,
          lastEventAt: new Date(),
          lastEventId: `evt_demonstration_${scopeId}`,
        })
        .onConflictDoNothing()
    }
  },
}
