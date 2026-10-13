# ADR 038 — L'achat unique est une ligne écrite en attente, unique par périmètre et par offre

- Status: accepted
- Date: 2026-09-02

À la réception de `checkout.session.completed`, on ne sait pas quel prix a été payé : `line_items` n'est pas dans la charge utile du webhook. Et un achat unique doit coexister avec un abonnement, ce qui exclut le refus `already_subscribed` de l'ADR 037.

**1. L'acte d'achat est écrit en attente avant l'URL.** `openCheckout` écrit une ligne `billing_purchase` en `pending`, avec l'offre et le prix résolus du catalogue, avant que l'URL parte au navigateur — le motif de l'ADR 034 (client rattaché avant l'URL) et de l'ADR 033 (promotion à la confirmation). La confirmation ne fait que promouvoir cette ligne en `paid` ; **le webhook n'insère jamais**. Seuls `checkout.session.completed` et `checkout.session.async_payment_succeeded` promeuvent, avec `mode === 'payment'` et `payment_status === 'paid'` ; ce qui n'est pas exactement reconnu n'accorde rien. Une session reste payable chez le fournisseur après qu'une autre a été ouverte : toutes les sessions d'un achat sont retenues dans `billing_purchase_session`, et c'est par cet index que confirmation et réconciliation retrouvent la ligne. Le repli transitoire sur `billing_purchase.provider_session_id`, gardé pour la version qui sert encore pendant la bascule, est à retirer (#94).

**2. Une unicité `(billing_customer_id, offer_id)`, tenue par la base.** `openCheckout` refuse en `409` (`already_purchased`) une ligne `paid`, et sinon écrit en `on conflict do update`, en remettant à zéro paiement, montant, devise et dates du cycle précédent : un achat abandonné, ou remboursé puis racheté, réutilise sa ligne. La contrainte est possible ici, contrairement à l'ADR 037, parce que l'insertion a lieu sur une route authentifiée et non dans le webhook public.

**3. Seul un remboursement total révoque.** `amountRefunded >= amount` (et `amount > 0`) révoque, décidé par une fonction pure du domaine. Un remboursement peut arriver avant la confirmation qu'il annule : il est d'abord écrit dans `billing_refunded_payment`, sous l'identifiant de paiement, et les deux chemins qui posent un paiement — promotion et réconciliation — relisent ce journal. Une ligne révoquée reste dans l'historique et redevient achetable.

**4. Le portail suit l'abonnement.** « Gérer la facturation » n'est rendu que s'il existe un abonnement. L'historique des paiements est servi par l'application depuis son cache ; les factures sont émises et délivrées par le fournisseur (`invoice_creation` sur les sessions en mode paiement).

## Considered options

- **Lire l'offre dans `metadata` ou `client_reference_id`** — rejeté : modifiables depuis le tableau de bord du fournisseur (ADR 034), alors que l'offre achetée est de l'autorisation.
- **Retrouver l'offre par le montant** — rejeté : deux offres peuvent partager un montant, et une remise ou une taxe fait diverger le montant prélevé.
- **Une ligne par acte d'achat, sans unicité par offre** — rejeté : c'est un compteur de crédits, la brique de la facturation à l'usage que le cimetière du PRD exclut.
- **Révoquer sur tout `charge.refunded`** — rejeté : un geste commercial partiel détruirait une licence à vie, sans ré-octroi possible.
- **Expirer la session précédente chez le fournisseur** — rejeté : la clé d'idempotence du checkout est stable par (périmètre, offre), l'appel suivant rejouerait la session expirée ; et un refus d'expiration ne distingue pas « expirée » de « payée ». Retenir chaque session rend la fenêtre sans conséquence, ce qui suffit.

## Consequences

Un remboursement partiel n'apparaît nulle part : la ligne reste `paid`.

La réconciliation ne rattrape que les sessions que nous avons ouvertes, et elle est dissymétrique : une charge introuvable (`chargedAmount: null`) veut dire « je ne sais pas » — elle promeut un achat en attente mais ne relève jamais un achat remboursé — et une session impayée n'impose rien ; `reconciledPurchaseStatus` rend alors `null`, « ne touche pas ». Deux sessions payées du même achat : la première qui tranche l'emporte, et le second prélèvement reste chez le fournisseur.

`billing_refunded_payment` n'a pas de borne, délibérément : une ligne par remboursement émis par le vendeur, sans donnée personnelle, et en effacer une rouvrirait le remboursement qu'elle a absorbé.

La clé d'idempotence `checkout:<périmètre>:<offre>` est fixe alors que la langue et le nombre de sièges varient sous elle ; le comportement du fournisseur face à des paramètres différents n'a pas été éprouvé en clés de test.
