import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * Les tables du module `billing` — **trois, et pas une de plus**.
 *
 * Elles n'existent que lorsque le module est activé : `pnpm db:generate` ne
 * génère que pour les modules de `config/features.ts`, et sur une base vierge
 * dont la configuration ne nomme pas ce module, aucune des trois n'est créée
 * (huitième critère de s19, vérifié par lecture d'`information_schema`).
 *
 * **Aucune clé étrangère ne sort du module**, et c'est une propriété, pas un
 * oubli. ADR 018 n'autorise une référence inter-modules que vers un `requires`
 * déclaré ; or ce module doit fonctionner **avec ou sans** `organizations`, et
 * un abonnement appartient tantôt à une organisation, tantôt à un compte. Le
 * périmètre est donc stocké en deux colonnes de texte, exactement comme
 * `ModuleScope` le décrit, et `billing` ne déclare aucun requis.
 *
 * **Ce que ces tables sont** : un **cache reconstructible** de l'état détenu par
 * le fournisseur (ADR 034). Elles ne font pas foi ; `pnpm billing:reconcile` les
 * réécrit depuis Stripe. Ce qui fait foi, c'est le fournisseur — et c'est
 * pourquoi aucune règle métier ne s'appuie sur une colonne qu'un webhook
 * n'aurait pas encore mise à jour sans que `grantsAccess` ne le prévoie.
 */

/**
 * Le lien entre un périmètre du produit et un client du fournisseur.
 *
 * **La ligne est écrite à l'ouverture du checkout, pas à sa complétion** : c'est
 * elle qui rend l'ordre de livraison des événements sans importance (ADR 034).
 * Un `customer.subscription.updated` arrivé avant le
 * `checkout.session.completed` retrouve son propriétaire ici.
 *
 * Deux unicités, et les deux sont en base :
 *
 * - `(scope_kind, scope_id)` — un périmètre n'a qu'un client. Sans elle, deux
 *   ouvertures de checkout simultanées créeraient deux clients pour la même
 *   organisation, donc deux abonnements payés ;
 * - `provider_customer_id` — un client du fournisseur n'appartient qu'à un
 *   périmètre. Sans elle, un identifiant recopié par erreur ferait basculer les
 *   abonnements d'un client vers un autre périmètre.
 */
export const billingCustomer = pgTable(
  'billing_customer',
  {
    id: text('id').primaryKey(),
    /** `user` ou `organization` — les deux formes de `ModuleScope`. */
    scopeKind: text('scope_kind').notNull(),
    scopeId: text('scope_id').notNull(),
    /** L'identifiant du client chez le fournisseur. Jamais montré à l'écran. */
    providerCustomerId: text('provider_customer_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('billing_customer_scope_key').on(table.scopeKind, table.scopeId),
    uniqueIndex('billing_customer_provider_key').on(table.providerCustomerId),
  ],
)

/**
 * L'abonnement, tel que le dernier événement appliqué l'a laissé.
 *
 * La clé primaire est l'identifiant **du fournisseur** : c'est la seule clé que
 * porte un événement, et s'en donner une autre obligerait à une lecture
 * préalable pour la retrouver — donc à la fenêtre de concurrence que
 * `docs/reliability.md` §1 refuse.
 *
 * `last_event_at` et `last_event_id` portent l'ordre (ADR 034) : un événement
 * plus ancien est journalisé et n'écrit rien.
 *
 * `offer_id` est **nullable** : le prix reçu du fournisseur peut ne plus être au
 * catalogue — une offre retirée de `config/billing.ts` laisse des abonnements
 * en cours. L'écran sait alors dire « offre inconnue » plutôt que de mentir.
 *
 * **Un client peut avoir plusieurs lignes**, et c'est une propriété, pas un
 * oubli : annuler puis se réabonner en fait deux, et la réconciliation relit
 * l'historique complet du fournisseur. Ce qu'il ne faut **pas** en conclure,
 * c'est qu'une des deux est « la bonne » au hasard — c'est exactement le défaut
 * F1 de la revue. Deux choses le ferment, et il faut les deux :
 *
 * - **l'index ci-dessous**, qui porte l'ordre de lecture : trois clés dont la
 *   dernière est la clé primaire, donc un ordre **total**. Deux lectures
 *   rendent la même liste, quoi que le moteur décide ;
 * - **`currentSubscriptionOf`** (`domain/subscription.ts`), qui décide lequel
 *   est *le* sien : celui qui donne l'accès l'emporte sur le plus récent.
 *
 * **Pourquoi pas une unicité sur `billing_customer_id`.** Elle rendrait l'état
 * ambigu impossible, mais elle obligerait l'écriture à remplacer la ligne du
 * client à chaque événement — et le parcours « souscrire le neuf, puis annuler
 * l'ancien » écraserait alors l'abonnement actif par l'annulation, qui est
 * l'événement le plus récent : le défaut F1, rejoué à l'endroit d'à côté (cas
 * mesuré, `tests/billing.test.ts`, « reste actif quand l'annulation de l'ancien
 * arrive en dernier »). Une unicité **partielle** sur les statuts vivants ne
 * tient pas davantage : un second abonnement vivant est atteignable — un appel
 * direct sur la route de checkout suffit —, et la contrainte transformerait
 * alors le webhook public en 500 permanent, ce que `docs/reliability.md` §1
 * interdit.
 */
export const billingSubscription = pgTable(
  'billing_subscription',
  {
    providerSubscriptionId: text('provider_subscription_id').primaryKey(),
    billingCustomerId: text('billing_customer_id')
      .notNull()
      .references(() => billingCustomer.id, { onDelete: 'cascade' }),
    /** L'offre du catalogue, ou `null` si le prix n'y figure plus. */
    offerId: text('offer_id'),
    priceId: text('price_id').notNull(),
    /** Statut normalisé par le port. Le fournisseur, lui, n'a pas d'union fermée. */
    status: text('status').notNull(),
    quantity: integer('quantity').notNull(),
    currentPeriodEnd: timestamp('current_period_end', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull(),
    trialEnd: timestamp('trial_end', { withTimezone: true, mode: 'date' }),
    /** Horodatage **du fournisseur**, jamais l'heure d'arrivée : c'est lui qui ordonne. */
    lastEventAt: timestamp('last_event_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastEventId: text('last_event_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /**
     * La question de l'écran — « les abonnements de ce périmètre » —, **et
     * l'ordre dans lequel on les lit**.
     *
     * Les trois clés forment un ordre total : l'horodatage d'événement d'abord,
     * la fin de période ensuite (la réconciliation pose le même instant sur
     * toutes les lignes d'un client), l'identifiant du fournisseur en dernier,
     * qui est la clé primaire — donc jamais deux lignes à égalité.
     * `subscriptionsOfCustomer` lit exactement dans cet ordre.
     *
     * **`nullsFirst()` n'est pas cosmétique** (constat m1 de la seconde revue).
     * `.desc()` seul fait écrire `DESC NULLS LAST` à Drizzle, tandis que
     * `desc(colonne)` dans une requête émet `DESC`, c'est-à-dire `NULLS FIRST` :
     * les clés de tri ne correspondaient donc jamais, et le planificateur
     * ajoutait un `Sort` par-dessus l'index — mesuré à l'`EXPLAIN`. L'index ne
     * servait pas la lecture qui l'a motivé, et ce commentaire-ci affirmait le
     * contraire. `tests/billing.test.ts` le vérifie désormais sur le plan
     * d'exécution réel.
     */
    index('billing_subscription_customer_idx').on(
      table.billingCustomerId,
      table.lastEventAt.desc().nullsFirst(),
      table.currentPeriodEnd.desc().nullsFirst(),
      table.providerSubscriptionId.desc().nullsFirst(),
    ),
  ],
)

/**
 * Le journal des événements reçus — **la clé d'idempotence, en base**.
 *
 * `event_id` est la clé primaire, et c'est tout le mécanisme : le traitement
 * commence par un `insert … on conflict do nothing` et s'arrête si aucune ligne
 * n'a été insérée. `docs/reliability.md` §1 refuse explicitement la lecture
 * préalable, qui laisse une fenêtre où deux livraisons simultanées passent
 * toutes les deux.
 *
 * L'insertion et l'écriture d'état ont lieu dans **la même transaction** : un
 * traitement en échec annule les deux, et le rejeu du fournisseur reste
 * possible. Sans cela, un événement à demi traité serait refusé pour toujours.
 *
 * Aucune charge utile n'est conservée : elle contiendrait des données du
 * fournisseur dont ce module n'a pas l'usage, et dont personne n'a décidé la
 * rétention.
 */
export const billingWebhookEvent = pgTable('billing_webhook_event', {
  eventId: text('event_id').primaryKey(),
  type: text('type').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
})

/** Les tables du module, telles que le contrat les déclare. */
export const billingSchema = {
  billingCustomer,
  billingSubscription,
  billingWebhookEvent,
} as const
