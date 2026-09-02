import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * Les tables du module `billing` — **six depuis le tour de correction de s20**.
 *
 * Elles n'existent que lorsque le module est activé : `pnpm db:generate` ne
 * génère que pour les modules de `config/features.ts`, et sur une base vierge
 * dont la configuration ne nomme pas ce module, aucune n'est créée (huitième
 * critère de s19, vérifié par lecture d'`information_schema`).
 *
 * **L'abonnement et l'achat unique vivent dans deux tables**, et c'est le
 * sixième critère de s20 : un périmètre peut porter les deux, et aucun des deux
 * ne peut écraser l'autre — pas par discipline d'écriture, par construction.
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
 * **L'achat unique** — une ligne par acte d'achat (ADR 038).
 *
 * Elle est écrite en statut `pending` **à l'ouverture du checkout**, avant que
 * l'URL ne parte au navigateur, et c'est ce qui la rend nécessaire : mesuré dans
 * `stripe@22.6.0`, la session de checkout **ne porte pas son prix** dans une
 * charge utile de webhook — `line_items` est une propriété développable, jamais
 * livrée. Sans cette écriture préalable, la confirmation ne saurait rattacher
 * l'achat à aucune offre, et la seule autre source (`metadata`) est modifiable
 * depuis le tableau de bord du fournisseur, ce que l'ADR 034 a déjà refusé pour
 * de l'autorisation.
 *
 * **Trois unicités, et chacune tient quelque chose de différent :**
 *
 * - `(billing_customer_id, offer_id)` — **l'invariant central de la story** :
 *   un périmètre ne possède qu'une ligne par offre unique, donc il ne peut pas
 *   être facturé deux fois pour le même acte d'achat, y compris sous deux
 *   ouvertures de checkout simultanées. Elle est tenue par le moteur, pas par
 *   une lecture ;
 * - `provider_session_id` — la **dernière** session ouverte pour cet achat.
 *   Ce n'est pas la clé de rattachement : `openPurchase` l'écrase à chaque
 *   reprise, et la confirmation résout la session par
 *   `billing_purchase_session`, qui les garde toutes (constat C1). Elle est
 *   encore lue **en repli**, le temps de la bascule de déploiement
 *   (constat C4) ;
 * - `provider_payment_id` — la clé par laquelle le remboursement la retrouve :
 *   `charge.refunded` ne porte que le paiement, jamais la session. Elle est
 *   **nullable** — une ligne en attente n'a pas encore de paiement —, et
 *   PostgreSQL admet plusieurs `NULL` sous une unicité.
 *
 * **Pourquoi cette contrainte tient ici alors qu'elle cassait en s19.**
 * L'ADR 037 a rejeté, mesures à l'appui, deux unicités sur
 * `billing_subscription` : elles transformaient le webhook **public** en `500`
 * permanent, parce que c'est lui qui insère un abonnement. Ici, le webhook
 * n'insère **jamais** — il met à jour une ligne existante. La seule écriture qui
 * puisse rencontrer un conflit est `openCheckout`, une route authentifiée, qui
 * le traite en `on conflict do update`. Ce déplacement est la décision, et il
 * n'est pas un des deux essais rejetés.
 *
 * `last_event_at` et `last_event_id` sont **nullables** : une ligne en attente
 * ne vient d'aucun événement. L'ordre est le même que celui des abonnements
 * (`appliesAfter` le nomme, le prédicat d'écriture le refuse), et `null` y vaut
 * « rien n'a encore été appliqué ».
 *
 * `amount` et `currency` sont **ce qui a été prélevé**, écrits à la
 * confirmation depuis la session — pas le montant du catalogue, qui n'est
 * qu'un affichage et qui peut changer. Un historique de paiements doit dire ce
 * qui a été payé.
 */
export const billingPurchase = pgTable(
  'billing_purchase',
  {
    id: text('id').primaryKey(),
    billingCustomerId: text('billing_customer_id')
      .notNull()
      .references(() => billingCustomer.id, { onDelete: 'cascade' }),
    /** L'offre du catalogue, résolue **côté serveur** à l'ouverture du checkout. */
    offerId: text('offer_id').notNull(),
    priceId: text('price_id').notNull(),
    /**
     * La **dernière** session de checkout ouverte pour cet achat.
     *
     * Elle dit où le navigateur vient d'être envoyé, pas comment un paiement se
     * rattache : c'est `billing_purchase_session` qui le fait, et elle les
     * retient toutes.
     */
    providerSessionId: text('provider_session_id').notNull(),
    /** Le paiement, connu seulement une fois encaissé. C'est la clé du remboursement. */
    providerPaymentId: text('provider_payment_id'),
    /** `pending`, `paid` ou `refunded` — l'union du `domain`. */
    status: text('status').notNull(),
    /** Le montant **réellement prélevé**, en unités mineures. */
    amount: integer('amount'),
    currency: text('currency'),
    purchasedAt: timestamp('purchased_at', { withTimezone: true, mode: 'date' }),
    refundedAt: timestamp('refunded_at', { withTimezone: true, mode: 'date' }),
    /** Horodatage **du fournisseur**, jamais l'heure d'arrivée : c'est lui qui ordonne. */
    lastEventAt: timestamp('last_event_at', { withTimezone: true, mode: 'date' }),
    lastEventId: text('last_event_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('billing_purchase_offer_key').on(table.billingCustomerId, table.offerId),
    uniqueIndex('billing_purchase_session_key').on(table.providerSessionId),
    uniqueIndex('billing_purchase_payment_key').on(table.providerPaymentId),
    /**
     * La question de l'écran — « les achats de ce périmètre » —, **et l'ordre
     * dans lequel on les lit**.
     *
     * Deux clés, dont la dernière est la clé primaire : l'ordre est **total**,
     * deux lectures rendent la même liste. `nullsFirst()` n'est pas cosmétique
     * — c'est la leçon du constat m1 de la seconde revue de s19 : `.desc()`
     * seul fait écrire `DESC NULLS LAST` à Drizzle, tandis que `desc(colonne)`
     * dans une requête émet `NULLS FIRST`, et le planificateur retrie alors
     * par-dessus l'index.
     */
    index('billing_purchase_customer_idx').on(
      table.billingCustomerId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
  ],
)

/**
 * **Toutes les sessions de checkout ouvertes pour un achat** — la clé de
 * rattachement d'un paiement, et elle ne s'efface jamais.
 *
 * `billing_purchase.provider_session_id` ne porte que la **dernière** ouverture :
 * l'`on conflict do update` de `openPurchase` l'écrase à chaque reprise. Une
 * session de checkout, elle, reste payable chez le fournisseur après qu'une
 * autre a été ouverte — rien ne l'expire de notre côté. Le constat C1 de la
 * revue de s20 a suivi le fil : l'utilisateur ouvre `S1`, revient en arrière,
 * rouvre (`S2`), puis paie `S1` ; la confirmation cherchait `S1` sur la colonne,
 * ne trouvait rien, et **un paiement encaissé n'accordait aucun droit**. La
 * réconciliation ne rattrapait pas davantage : elle ne connaissait plus `S1`.
 *
 * Cette table est l'index inverse qui manquait. La confirmation et la
 * réconciliation y résolvent la session : **toute** session que nous avons
 * ouverte reste rattachable à son achat, quel que soit le nombre de reprises.
 *
 * **Un repli transitoire sur la colonne de l'achat** subsiste, et il est
 * obligatoire tant que la bascule de déploiement dure : la version encore en
 * ligne ouvre des checkouts sans écrire ici, et le rattrapage de la migration
 * `0004` ne connaît que les sessions présentes à l'instant où il passe
 * (constat C4, ADR 038 §1). Il se retire une fois l'ancienne version hors
 * ligne — pas avant.
 *
 * `provider_session_id` est la clé primaire : une session appartient à un achat
 * et un seul. La clé étrangère reste **à l'intérieur du module** (ADR 018), et
 * la cascade fait partir les sessions avec l'achat, donc avec le périmètre.
 */
export const billingPurchaseSession = pgTable('billing_purchase_session', {
  providerSessionId: text('provider_session_id').primaryKey(),
  billingPurchaseId: text('billing_purchase_id')
    .notNull()
    .references(() => billingPurchase.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
})

/**
 * **Les remboursements dont la confirmation n'était pas encore arrivée.**
 *
 * `charge.refunded` ne porte que le paiement, jamais la session (recherche
 * §2.3), et une ligne d'achat n'a de `provider_payment_id` qu'**à partir de sa
 * promotion**. Un remboursement livré avant la confirmation qu'il annule — le
 * désordre que l'ADR 034 déclare possible, et que les reprises de livraison du
 * fournisseur produisent — ne trouvait donc aucune ligne : il était journalisé,
 * donc jamais rejoué, et la confirmation ultérieure accordait l'accès à un achat
 * intégralement remboursé (constat C2 de la revue de s20).
 *
 * Le remboursement est donc écrit **ici d'abord**, sous la seule clé qu'il
 * porte, et la promotion le rejoue depuis cette table dans la même transaction.
 * L'ordre de livraison cesse de compter, ce qui est la propriété que
 * `docs/reliability.md` §1 demande.
 *
 * **Les deux chemins qui posent un paiement la relisent** : la promotion, par
 * sous-requête dans sa transaction, et la réconciliation, qui est l'autre
 * écriture d'un `provider_payment_id` (constat m6 de la seconde revue).
 *
 * Elle ne porte que des identifiants du fournisseur et des horodatages — aucun
 * lien vers un périmètre, aucune donnée personnelle —, comme le journal
 * d'événements ci-dessous, et pour la même raison elle n'est pas purgée :
 * l'effacer rouvrirait un remboursement déjà absorbé.
 *
 * **Elle croît donc sans borne, et c'est un arbitrage écrit** (constat m10,
 * ADR 038 §3) : une ligne par remboursement total effectivement émis — y
 * compris ceux des factures d'abonnement, qui ne trouveront jamais d'achat —,
 * jamais une ligne par requête. La croissance n'est pas pilotée par
 * l'extérieur, ce qui la distingue des seaux de limitation de débit. Aucune
 * commande ne vérifie cette phrase.
 */
export const billingRefundedPayment = pgTable('billing_refunded_payment', {
  providerPaymentId: text('provider_payment_id').primaryKey(),
  refundedAt: timestamp('refunded_at', { withTimezone: true, mode: 'date' }).notNull(),
  lastEventAt: timestamp('last_event_at', { withTimezone: true, mode: 'date' }).notNull(),
  lastEventId: text('last_event_id').notNull(),
})

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
  billingPurchase,
  billingPurchaseSession,
  billingRefundedPayment,
  billingWebhookEvent,
} as const
