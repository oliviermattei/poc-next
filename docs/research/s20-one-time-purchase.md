# Recherche — s20-one-time-purchase

> Ce que j'ai **mesuré** dans les paquets installés et dans le code livré par
> s19, et ce que cela oblige. Les faits datent du 02/09/2026, sur
> `stripe@22.6.0` et l'arbre `feature/s20-one-time-purchase`.
> **Aucune liste ci-dessous ne se prétend exhaustive** : chacune dit ce qui a
> été balayé, et sur quel périmètre.

## 1. Ce que la story demande, ramené à des décisions

Les sept critères de `docs/stories.md` posent quatre questions que s19 n'a pas
tranchées, et une seule est vraiment structurante :

1. **Comment sait-on *quelle offre* a été achetée ?** Le paiement unique n'a pas
   d'objet `Subscription` : l'événement porte une session de checkout, et cette
   session **ne contient pas son prix** (§2.1). Sans réponse, le droit accordé
   n'est rattaché à rien.
2. **Qu'est-ce qui empêche de facturer deux fois le même acte d'achat ?** C'est
   l'invariant central de la story, et s19 ne le tient que pour l'abonnement,
   par un refus applicatif (`already_subscribed`, ADR 037).
3. **Quand un remboursement révoque-t-il ?** Total, partiel — le critère 5 ne le
   dit pas.
4. **Que devient le portail ?** Le critère 4 le retire de l'achat unique tout en
   exigeant que l'historique et les factures restent atteignables.

Ce que la story **n'ouvre pas**, et que le cimetière du PRD ferme : la
facturation à l'usage, un compteur de consommation, un second fournisseur. Un
achat unique acheté deux fois serait un compteur de crédits ; c'est exactement
ce que l'invariant ci-dessus refuse, et ce n'est pas une coïncidence.

## 2. Le fournisseur, relevé dans le paquet installé

Tout ce qui suit vient de
`node_modules/.pnpm/stripe@22.6.0_@types+node@22.20.1/node_modules/stripe/esm/resources/`,
jamais de la documentation en ligne.

### 2.1 La session de checkout ne porte pas son prix

`Checkout/Sessions.d.ts` : l'objet `Session` déclare `mode` (ligne 202),
`payment_status` (241), `payment_intent` (215), `invoice` (174),
`client_reference_id`, `amount_total`, `currency`. **`line_items` n'est pas un
champ de l'objet** : c'est une propriété *développable* (`expand`), absente de
toute charge utile de webhook.

Conséquence directe, et c'est la contrainte qui décide de tout le modèle : à la
réception de `checkout.session.completed`, **on ne peut pas savoir quel prix a
été payé** sans un appel réseau supplémentaire — que l'ADR 034 a déjà refusé sur
le chemin nominal du webhook.

Les unions utiles sont ouvertes, comme celle des statuts d'abonnement :

- `type Mode = 'payment' | 'setup' | 'subscription' | OtherString` (ligne 537) ;
- `type PaymentStatus = 'no_payment_required' | 'paid' | 'unpaid' | OtherString`
  (607).

Le repli doit donc être **fermé** : tout ce qui n'est pas exactement `payment` +
`paid` n'accorde rien, comme un statut d'abonnement inconnu retombe sur
`incomplete`.

### 2.2 Le paiement différé arrive plus tard

`Events.d.ts` déclare `checkout.session.async_payment_succeeded` (ligne 673).
Pour un moyen de paiement différé (virement, prélèvement),
`checkout.session.completed` est livré avec `payment_status: 'unpaid'`, et c'est
`async_payment_succeeded` qui confirme. Ne traiter que le premier laisserait ces
acheteurs sans droit **pour toujours** : ils ont payé, aucun événement ultérieur
ne serait lu.

### 2.3 Le remboursement, et ce que la charge en dit

`Events.d.ts` ligne 621 : `charge.refunded`. `Charges.d.ts` : `amount` (63),
`amount_refunded` (71), `refunded` (190), `payment_intent` (161),
`receipt_url` (186).

Deux faits qui décident :

- **la charge porte `payment_intent`, jamais la session de checkout.** Le lien
  entre un remboursement et l'achat qu'il annule passe donc obligatoirement par
  l'identifiant de paiement, qu'il faut avoir enregistré à la confirmation ;
- **`amount` et `amount_refunded` permettent de distinguer un remboursement
  total d'un geste commercial partiel.** L'événement `charge.refunded` est émis
  dans les deux cas.

### 2.4 Ce que le checkout accepte en mode paiement

`SessionCreateParams` déclare `mode`, `invoice_creation`, `payment_intent_data`,
`line_items`, `client_reference_id`, `customer`. `invoice_creation` existe donc
bien sur la version installée : une facture peut être émise et délivrée par le
fournisseur pour un paiement unique, ce qu'il ne fait pas par défaut.

`subscription_data.trial_period_days` n'a **aucun** sens en mode `payment` — le
catalogue le refuse déjà au démarrage (`offer.ts`, `trialDays` doit être `null`
pour une offre `one_time`).

## 3. Ce que s19 a payé, et qui ne se réinvente pas

Relu intégralement : le module, ses quatre couches, le point de composition, la
simulation locale, les deux ADR, les trois revues.

| Propriété | Où elle vit | Ce que s20 en fait |
|---|---|---|
| Signature vérifiée **avant** tout effet | `handleWebhook`, `verifyWebhook` | inchangé, hérité |
| Idempotence par identifiant d'événement | clé primaire `billing_webhook_event`, `insert … on conflict do nothing` dans la **même** transaction | inchangé, hérité — c'est lui qui ferme le critère 7 |
| Ordre des événements | `appliesAfter` (nomme) + `setWhere` (refuse) | **rejoué à l'identique** sur la nouvelle table |
| Le fournisseur fait foi, la base est un cache | ADR 034 §3, `pnpm billing:reconcile` | étendu aux achats (§6) |
| Prix, devise, produit jamais lus du client | `openCheckout` lit le catalogue typé, corps `z.strictObject` à un champ | inchangé |
| Rattachement du client **avant** l'URL | `linkCustomer` après `createCheckout` | **le motif est repris** pour l'achat (§4) |
| Permission `billing.manage` | matrice de s17, injectée en `canManage` | **réutilisée telle quelle**, aucune action nouvelle |
| Mode local explicite | `PAYMENTS_LOCAL_MODE=1`, refusé sous `NODE_ENV=production` | inchangé, étendu au mode paiement |

**Ce que l'ADR 037 interdit de réessayer** : une unicité pleine sur
`billing_customer_id`, et une unicité partielle sur les statuts vivants — les
deux mesurées, les deux cassant le point d'entrée public. §4.3 explique pourquoi
la contrainte retenue ici n'est **pas** une de ces deux-là.

## 4. La décision centrale : l'achat est la session, écrite en attente

### 4.1 Le problème

§2.1 : l'événement de confirmation ne dit pas quel prix a été payé. Trois voies
existent, deux sont fermées.

- **Lire l'offre depuis `metadata` ou `client_reference_id`** — rejeté.
  L'ADR 034 a déjà tranché : ces deux champs sont modifiables depuis le tableau
  de bord du fournisseur, et ils servent au diagnostic, jamais à l'autorisation.
  Or l'offre achetée **est** de l'autorisation : c'est elle qui dit quel droit
  est accordé.
- **Développer `line_items` à la réception** — rejeté par l'ADR 034 : un appel
  réseau par webhook, sur un point d'entrée public non limité en débit avant
  s28.
- **Écrire l'achat *avant*, et le promouvoir à la confirmation** — retenu.

### 4.2 La forme retenue

C'est le motif que le dépôt possède déjà à deux endroits : le rattachement du
client avant l'URL (ADR 034 §1) et la clé d'attente promue à la confirmation de
s18 (ADR 033).

`openCheckout` d'une offre `one_time` écrit une ligne `billing_purchase` en
statut `pending`, portant l'offre, le prix et l'identifiant de session, **avant**
de rendre l'URL. La confirmation ne fait que promouvoir cette ligne : elle
n'insère jamais.

### 4.3 Pourquoi une contrainte d'unicité tient ici, alors qu'elle cassait en s19

Unicité sur `(billing_customer_id, offer_id)` : **un périmètre ne possède qu'une
ligne par offre unique**, quel que soit son statut.

L'ADR 037 a rejeté deux contraintes parce qu'elles transformaient le **webhook
public** en `500` permanent : c'était le webhook qui *insérait*. Ici, le webhook
n'insère rien — il met à jour une ligne existante par son identifiant de session.
Une violation d'unicité est donc **inatteignable** depuis le point d'entrée
public ; la seule écriture qui peut la rencontrer est `openCheckout`, une route
authentifiée qui la traite comme un conflit ordinaire (`on conflict do update`).

C'est ce déplacement — l'insertion passe du chemin public au chemin
authentifié — qui rend la contrainte acceptable, et il vient directement du
choix §4.2. Les deux options de l'ADR 037 ne sont pas réessayées : elles
portaient sur `billing_subscription`, où l'insertion est faite par le webhook.

### 4.4 Ce que la contrainte tient, et ce qu'elle ne tient pas

Elle tient : **une seule ligne payée par périmètre et par offre**, sous
concurrence, par le moteur. Deux ouvertures simultanées du même achat convergent
sur une ligne ; deux confirmations du même achat ne peuvent pas produire deux
droits.

Elle ne tient pas : rien n'empêche un périmètre d'acheter **deux offres
uniques différentes**. C'est voulu — ce sont deux actes d'achat distincts.

## 5. Le remboursement

`charge.refunded` est émis pour un remboursement total **comme** partiel (§2.3).
Deux réponses possibles, et il faut en écrire une :

- **révoquer sur tout remboursement** : un geste commercial de 1 € détruirait
  une licence à vie payée. Le produit punirait le vendeur d'avoir été aimable ;
- **révoquer sur remboursement total** (`amount_refunded >= amount`) : le
  remboursement partiel laisse le droit, et n'est pas enregistré.

Retenu : le second. La règle est **dans le domaine**, pas dans l'adaptateur :
l'événement transporte `amount` et `amountRefunded`, et c'est une fonction pure
qui décide. Un adaptateur qui trancherait rendrait la règle inatteignable par
un test de domaine.

Conséquence assumée, à écrire : un remboursement partiel n'apparaît nulle part.

## 6. Réconciliation

`docs/reliability.md` §5 : tout état divergeant d'un système externe a une
commande de réconciliation. Un achat diverge dès qu'un webhook se perd.

`checkout.sessions.list({ customer })` rend les sessions du client, avec leur
`mode` et leur `payment_status` — mais toujours sans prix (§2.1). Ce n'est pas
un obstacle : la réconciliation ne fait que **promouvoir des lignes que nous
avons ouvertes**, exactement comme la réconciliation des abonnements ne
rattrape pas un client créé de toutes pièces dans le tableau de bord (constat F6
de la revue de s19). Une session inconnue de notre table n'a pas d'offre, et il
n'y en a aucune à deviner.

L'état de remboursement, lui, n'est pas sur la session : il faut
`charges.list({ customer })`, dont chaque charge porte `payment_intent`,
`amount` et `amount_refunded` (§2.3). Deux lectures paginées par client, sous le
même plafond de pages que `listSubscriptions`.

**La réconciliation n'efface jamais** (ADR 034 §3) : une session absente de la
réponse ne dégrade rien.

## 7. Le portail, et le quatrième critère

« Le portail client n'est pas proposé pour un achat unique ; l'historique des
paiements et les factures restent accessibles. »

Ce que le portail sert, mesuré dans le code livré : `createPortalSession` ne
passe **aucune** `configuration` — le portail servi est celui du tableau de bord,
et la revue de s19 a laissé ouvert le fait qu'il faut y activer le changement de
plan. Son objet est la gestion d'un **abonnement** : moyen de paiement,
changement d'offre, résiliation. Un achat unique n'a rien de tout cela.

Retenu :

- le bouton « Gérer la facturation » n'est rendu que si le périmètre a au moins
  un abonnement en cache — un acheteur unique pur ne le voit pas ;
- **l'historique des paiements est servi par l'application**, depuis son propre
  cache : offre, date, montant réellement payé, statut. Il ne dépend d'aucun
  tiers, ce que `docs/reliability.md` §2 préfère ;
- les **factures** sont émises et délivrées par le fournisseur :
  `invoice_creation` est activé sur les sessions en mode paiement (§2.4).

**Ce que cela ne livre pas, et qu'il ne faut pas lire comme livré** : un lien
vers la facture *depuis l'écran*. Il demanderait soit de stocker une URL
signée du fournisseur au repos, soit un appel réseau à chaque affichage. Aucun
des deux n'est pris ici, et le critère est tenu par l'émission de la facture,
pas par un lien.

## 8. Le montant affiché dans l'historique

Le montant du catalogue est un montant d'**affichage** (`offer.ts` le dit).
L'historique doit montrer ce qui a été **prélevé** : `amount_total` et `currency`
de la session, écrits à la confirmation. Un changement de prix dans
`config/billing.ts` ne réécrit alors pas le passé.

## 9. Ce que le harnais doit apprendre

- `config/billing.ts` gagne une offre `one_time` : sans elle, aucune commande
  n'exerce ce chemin, et le mode reste de la documentation ;
- `tests/rendered-text.test.ts` : l'écran gagne des états — achat payé, achat
  remboursé — qui portent des textes qu'aucun autre rendu ne produit. Ils
  doivent entrer dans la liste des écrans rendus, avec leur champ `refuses`
  dérivé de `billing.available` ;
- `e2e/billing.spec.ts` : le parcours d'achat passe par le même checkout simulé
  que l'abonnement, donc par la vraie route de webhook. `playwright.config.ts` et
  `.github/workflows/ci.yml` portent déjà `PAYMENTS_LOCAL_MODE=1` — **rien à y
  ajouter** ;
- la simulation locale doit apprendre le mode paiement : sans cela le parcours
  navigateur ne peut pas exister.

## 10. Pièges nommés, à ne pas rejouer

1. **Une mutation posée ailleurs qu'à l'endroit du défaut ne prouve rien.**
   Mesuré deux fois en s19. Les gardes de cette story vivent à trois endroits
   distincts — le domaine, le cas d'usage, le prédicat SQL — et chacune se
   neutralise chez elle.
2. **`turbo` sert le `.next` de l'autre configuration** : `pnpm build --force`
   avant toute mesure au navigateur.
3. **Next charge sa configuration *après* `✓ Ready`** : une mesure de démarrage
   qui s'arrête à cette ligne conclut à tort.
4. **Un `.env` de poste peut faire passer une suite qui échouerait ailleurs** :
   ce dont le harnais a besoin se déclare dans `playwright.config.ts` et dans
   `.github/workflows/ci.yml`.
5. **Le repli ouvert** : `Mode` et `PaymentStatus` sont des unions ouvertes
   (§2.1). Tout ce qui n'est pas reconnu n'accorde rien.
6. **Deux vérités qui divergent** : l'ordre de lecture et l'index doivent rester
   d'accord (ADR 037). La nouvelle table hérite de la même discipline.
