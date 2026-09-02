---
story: s20-one-time-purchase
validated: yes
---

# Plan — s20-one-time-purchase

Recherche : `docs/research/s20-one-time-purchase.md` · Design :
`docs/designs/s20-one-time-purchase.md` · Décision : **ADR 038** (hérite de
ADR 034 et ADR 037, qui restent la loi).

**L'invariant central**, celui qui décide de la story : *un achat unique ne peut
pas être facturé deux fois pour un même acte d'achat*. Il est tenu à deux
endroits, et il faut les deux — une contrainte d'unicité
`(billing_customer_id, offer_id)` en base, et un refus `already_purchased` sur
`openCheckout`. Le premier tient la concurrence, le second dit pourquoi.

**Socles nommés, et les sections qui s'appliquent** :

- `docs/security.md` §3 (autorisation côté serveur : l'achat réutilise
  `billing.manage` de la matrice de s17, aucune action nouvelle ; aucune route
  n'accepte d'identifiant de périmètre), §4 (Zod à chaque frontière, signature
  vérifiée avant tout effet — hérité de s19, non rouvert), §5 (aucun secret ni
  URL signée du fournisseur, au repos comme en réponse), §7 (les refus rendent
  une clé de catalogue).
- `docs/reliability.md` §1 (webhook idempotent par identifiant, migration et
  réconciliation rejouables), §2 (mode local explicite, jamais déduit de
  `NODE_ENV`), §3 (délai et reprises — hérités du port), §4 (migration
  **additive**, rétrocompatible avec la version en ligne), §5 (la réconciliation
  couvre le nouvel état).
- `AGENTS.md` racine : `AGENTS.md` de package tenu à jour, aucune revendication
  d'exhaustivité, règle exécutable ou rien.

## Tâches

- [x] **T1 — Le port apprend le paiement unique.**
  `packages/ports/src/payments.ts` : `CreateCheckoutInput.mode` s'ouvre à
  `'payment'`, `Checkout` rend l'identifiant de **session** (c'est l'acte
  d'achat, ADR 038 §1), `PaymentEvent` gagne `purchase_paid` et
  `purchase_refunded`, et une opération `list_purchases` entre dans
  `PaymentsOperation`. Aucun montant reçu, aucune règle décidée ici.
  *Preuve* : le port n'a que des types ; il est prouvé chez ses implémentations
  (T3, T7). `pnpm typecheck`.

- [x] **T2 — Les règles pures de l'achat.**
  `packages/modules/billing/src/domain/purchase.ts` : statuts
  (`pending`/`paid`/`refunded`), `purchaseGrantsAccess`,
  `refundRevokesPurchase({amount, amountRefunded})`, et **la règle consolidée**
  `grantsBillingAccess(subscription, purchases, now)` — abonnement **ou** achat
  payé, jamais l'un révoqué par l'autre (critères 3 et 6).
  *Test* : `packages/modules/billing/src/domain/billing-rules.test.ts` (fichier
  existant, groupes ajoutés).
  *Mutation* : `grantsBillingAccess` ne lit plus que l'abonnement.

- [x] **T3 — L'adaptateur normalise le mode paiement et le remboursement.**
  `packages/adapters/stripe/src/stripe-payments.ts` : `mode: 'payment'` posé
  tel qu'il est reçu, `invoice_creation` activé hors abonnement (recherche §2.4),
  `Checkout.sessionId` rendu ; `checkout.session.completed` et
  `checkout.session.async_payment_succeeded` deviennent `purchase_paid`
  **seulement** si `mode === 'payment'` et `payment_status === 'paid'` — repli
  fermé sur des unions ouvertes ; `charge.refunded` devient `purchase_refunded`
  avec `amount` et `amountRefunded`, sans décider.
  *Test* : `packages/adapters/stripe/src/stripe-payments.test.ts`.
  *Mutation* : accepter `payment_status: 'unpaid'` comme un paiement.

- [x] **T4 — La table `billing_purchase` et sa migration.**
  `packages/modules/billing/src/schema.ts` : clé primaire technique, clé
  étrangère **interne au module** vers `billing_customer` (`on delete cascade`),
  unicité `(billing_customer_id, offer_id)` — l'invariant central —, unicité de
  l'identifiant de session, unicité de l'identifiant de paiement, index de
  lecture ordonné total comme celui des abonnements (ADR 037). Migration
  générée, **additive**, rejouée deux fois.
  *Test* : `tests/billing.test.ts` — une seconde ligne payée sur la même
  `(client, offre)` est refusée **par le moteur**.
  *Mutation* : retirer l'unicité `(billing_customer_id, offer_id)`.

- [x] **T5 — Le dépôt : promotion, remboursement, lecture.**
  `infrastructure/drizzle-billing-repositories.ts` : `purchasesOfCustomer`
  (ordre total, écrit une fois), `upsertPendingPurchase` (`on conflict do
  update`, **jamais** sur une ligne déjà payée), et deux effets de webhook —
  `purchase_paid` (mise à jour **par session**, jamais d'insertion) et
  `purchase_refunded` (mise à jour **par paiement**), tous deux sous le même
  prédicat d'ordre `setWhere` que les abonnements.
  *Test* : `tests/billing.test.ts`, contre la vraie base.
  *Mutation* : retirer le prédicat d'ordre de l'écriture d'achat.

- [x] **T6 — Les cas d'usage.** `application/billing-use-cases.ts` :
  `openCheckout` cesse de refuser `one_time`, garde `already_subscribed` **pour
  les seules offres d'abonnement**, ajoute `already_purchased` (409) pour une
  offre unique déjà payée, et écrit l'achat en attente **avant** de rendre l'URL.
  `handleWebhook` traite les deux nouveaux événements. `view` rend les achats,
  l'accès consolidé et `canOpenPortal`. `export` rend aussi les achats du
  périmètre.
  *Test* : `tests/billing.test.ts`, à travers le répartiteur.
  *Mutations* : retirer le refus `already_purchased` ; faire regarder les achats
  à la garde d'abonnement (critère 6).

- [x] **T7 — La simulation locale apprend le mode paiement.**
  `packages/payments-testing/src/local-payments.ts` : session de mode paiement,
  événement `checkout.session.completed` signé et **normalisé par l'adaptateur**,
  `listPurchases` local. Le drapeau reste `PAYMENTS_LOCAL_MODE=1`, explicite.
  *Test* : `packages/payments-testing/src/payments-testing.test.ts`.
  *Mutation* : rendre `payment_status: 'unpaid'` dans la session simulée.

- [x] **T8 — La réconciliation couvre les achats.**
  Port `listPurchases` implémenté sur `checkout.sessions.list` +
  `charges.list` (paginés, plafonnés), `reconcile` promeut les lignes connues et
  corrige l'état de remboursement, **sans jamais effacer**. Une seconde exécution
  ne change rien.
  *Test* : `tests/billing.test.ts`.
  *Mutation* : faire réécrire la réconciliation à chaque passage.

- [x] **T9 — L'écran et ses textes.** Carte « Vos achats », « Acheter » et
  « Déjà acheté » sur les offres uniques, portail conditionné à l'existence d'un
  abonnement. Clés fr **et** en. `config/billing.ts` gagne une offre `lifetime` —
  sans elle, aucune commande n'exerce ce chemin. Écrans ajoutés à
  `tests/rendered-text.test.ts` avec leur champ `refuses` dérivé.
  *Test* : `tests/billing.test.ts` (rendu de l'écran) + `tests/rendered-text`.
  *Mutation* : rendre le bouton de portail sur la seule existence d'un client.

- [x] **T10 — Le parcours navigateur.** `e2e/billing.spec.ts` : acheter l'offre
  unique, revenir, lire l'achat, constater qu'il n'est plus proposé — et que le
  portail n'apparaît pas pour un acheteur pur. `playwright.config.ts` et
  `.github/workflows/ci.yml` portent déjà `PAYMENTS_LOCAL_MODE=1` : **rien à y
  ajouter**, vérifié.
  *Preuve* : `E2E_PORT=3120 pnpm test:e2e`, dans les deux configurations.

- [x] **T11 — La trace.** `packages/modules/billing/AGENTS.md` : la nouvelle
  table, l'invariant et où il est tenu, le tableau des mutations mesurées.
  `packages/payments-testing/AGENTS.md` : ce que la simulation couvre désormais.
  `docs/decisions/038-*.md` livré avec la story.
  *Preuve* : `tests/agents-md.test.ts`, `pnpm lint`.

## Tour de correction (revue `docs/reviews/s20-one-time-purchase.md`)

Constats traités : **C1** (critique), **C2** (majeur), **m1**, **m2**, **m5**.
`m3` et `m4` restent hors périmètre — mesurés non imputables à cette story.

- [x] **R1 — C1 : une session supplantée reste rattachable.**
  `billing_purchase_session` retient **toutes** les sessions ouvertes pour un
  achat ; la confirmation et la réconciliation y résolvent la session, jamais
  sur `billing_purchase.provider_session_id`, qui ne porte que la dernière.
  Migration additive, avec report des achats déjà ouverts (`docs/reliability.md`
  §4). Fixe aussi le cas manquant que la mutation verte de la revue avait
  révélé : ce que la ligne porte après une seconde ouverture.
  *Test* : `tests/billing.test.ts`, « rattache le paiement d'une session
  supplantée par une seconde ouverture ».
  *Mutation* : retrouver l'achat par la colonne de l'achat → **1 rouge**.

- [x] **R2 — C2 : un remboursement peut précéder sa confirmation.**
  `billing_refunded_payment` journalise le remboursement sous la seule clé qu'il
  porte ; la promotion l'y relit et l'applique dans la même transaction. Le
  commentaire du `ne(status, 'refunded')` est corrigé : il ne couvre que l'ordre
  inverse.
  *Test* : « applique un remboursement livré **avant** la confirmation qu'il
  annule ».
  *Mutation* : retirer le rejeu à la promotion → **1 rouge**.

- [x] **R3 — m1 : la réconciliation ne ré-accorde jamais.**
  `reconciledPurchaseStatus` entre dans le `domain` et rend `null` — « ne touche
  pas » — sur une session impayée et sur une charge introuvable d'une ligne
  remboursée. `PurchaseReconcileWrite` porte désormais des **faits**, pas un
  statut décidé sans voir l'état stocké.
  *Test* : cinq cas de `domain/billing-rules.test.ts`, deux d'assemblage.
  *Mutations* : « charge introuvable = non remboursé » → **2 rouges** ;
  « session impayée = achat en attente » → **2 rouges**.

- [x] **R4 — m2 : la reprise d'un achat repart à zéro.**
  `openPurchase` remet paiement, montant, devise, date d'achat, date de
  remboursement et horodatage d'événement à `null`.
  *Test* : « remboursé puis racheté : la ligne repayée ne porte plus la date de
  remboursement », qui vérifie l'**export**.
  *Mutation* : retirer la remise à zéro → **1 rouge**.

- [x] **R5 — m5 : mesuré, non reproduit.** Une offre ajoutée à
  `config/billing.ts` sans ses quatre traductions fait rougir « livre le nom et
  la description de chaque offre déclarée, dans chaque langue »
  (`tests/billing.test.ts`), qui itère `billingOffers`. La revue n'avait balayé
  que `tests/i18n.test.ts`. **Aucun code changé.**

- [x] **R6 — la trace.** ADR 038 corrigé (§1, §2, §3 et « ce qu'il faut
  surveiller », dont les deux directions mesurées pour C1 et pourquoi aucune ne
  tient seule), `packages/modules/billing/AGENTS.md` : les deux tables, les
  quatre règles, le tableau des mutations de ce tour.

## Second tour de correction (seconde revue, constats C3, C4, m6 à m10)

Constats traités : **C4** et **C3** (majeurs), **m6**, **m7**, **m8**, **m9**,
**m10**. `m3` et `m4` de la première revue restent hors périmètre — mesurés non
imputables à cette story.

- [x] **S1 — C4 : la fenêtre de bascule ne rejoue plus C1.**
  Le nouveau code résout une session par l'index inverse **et, à défaut, par
  `billing_purchase.provider_session_id`** — le repli que « ajouter avant de
  lire » demande tant que l'ancienne version sert encore du trafic. Un seul
  prédicat pour les deux sites (confirmation et réconciliation), retiré par un
  tour ultérieur une fois l'ancienne version hors ligne.
  *Test* : `tests/billing.test.ts`, les deux chemins — confirmation et
  réconciliation d'une session ouverte **avant** la bascule.
  *Mutation* : retirer le repli sur la colonne.

- [x] **S2 — C3 : la moitié « réconciliation » de l'index inverse est prouvée.**
  Un cas exige que `pnpm billing:reconcile` **retrouve** un achat par une
  session supplantée — ce que C1 déclarait irréparable.
  *Test* : `tests/billing.test.ts`.
  *Mutation* : résoudre l'achat par la colonne dans la réconciliation.

- [x] **S3 — m6 : la réconciliation consulte le journal des remboursements.**
  Le même rejeu que la promotion fait déjà, à l'endroit où la réconciliation
  pose le même paiement : un remboursement journalisé mais non appliqué ne doit
  pas être effacé par une charge introuvable.
  *Test* : `tests/billing.test.ts`.
  *Mutation* : ne pas consulter le journal à la réconciliation.

- [x] **S4 — m7 : la réconciliation reste rejouable à deux sessions payées.**
  Une lecture qui **tranche** consomme l'achat pour le passage : la première
  dans l'ordre du fournisseur l'emporte, les suivantes ne réécrivent pas.
  *Test* : `tests/billing.test.ts`, second passage à `changed: 0`.
  *Mutation* : retirer la garde « un achat tranché une fois par passage ».

- [x] **S5 — m9 : l'inventaire déclaré ne ment plus.**
  `dataCategories` et `retention` déclarent la catégorie `purchase`, et un cas
  **dérive** l'exigence des collections que l'export rend.
  *Test* : `tests/billing.test.ts`.
  *Mutation* : retirer `purchase` de `dataCategories`.

- [x] **S6 — m8 et m10 : à écrire, pas à corriger.**
  ADR 038 : la séquence `S1`/`S2` est **déduite**, pas mesurée — la clé
  d'idempotence stable rend la même session dans la fenêtre du fournisseur, et
  aucune doublure ne modélise ce rejeu. `billing_refunded_payment` : la borne
  qu'il n'a pas, et pourquoi. Comptes de `packages/modules/billing/AGENTS.md`
  remesurés.
  *Preuve* : `tests/agents-md.test.ts`, `pnpm lint`, les deux mutations
  remesurées.
