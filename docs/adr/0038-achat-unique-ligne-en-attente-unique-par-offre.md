# ADR 038 — L'achat unique est une ligne écrite en attente, unique par périmètre et par offre

- Status: accepted
- Date: 2026-09-02
- Scope: story s20-one-time-purchase

## Context

s19 pose le module de facturation : le port `Payments`, le webhook signé et
idempotent, l'ordre d'application des événements (ADR 034) et la lecture ordonnée
des abonnements d'un client (ADR 037). Il ne livre que l'abonnement :
`openCheckout` refuse explicitement une offre `one_time` en `unsupported_mode`.

s20 ouvre ce chemin, et il n'est pas un abonnement de plus. Quatre questions se
posent en même temps, aucune n'étant tranchée par un ADR existant.

**1. À quoi rattacher le droit accordé ?** Mesuré dans `stripe@22.6.0`
(`esm/resources/Checkout/Sessions.d.ts`) : l'objet `Session` porte `mode`,
`payment_status`, `payment_intent`, `amount_total` et `currency`, mais
`line_items` n'en est **pas un champ** — c'est une propriété développable,
absente de toute charge utile de webhook. À la réception de
`checkout.session.completed`, **on ne sait donc pas quel prix a été payé**.

**2. Qu'est-ce qui interdit de facturer deux fois le même acte d'achat ?** Un
achat unique n'expire pas et ne se renouvelle pas : le refus `already_subscribed`
de l'ADR 037, qui s'appuie sur `grantsAccess` d'un abonnement, n'a rien à dire
ici. Et le sixième critère de la story exige qu'un achat unique et un abonnement
**coexistent**, ce qui interdit un refus global fondé sur « le périmètre a déjà
l'accès ».

**3. Quand un remboursement révoque-t-il ?** `charge.refunded` est émis pour un
remboursement total comme partiel (`Charges.d.ts` : `amount`, `amount_refunded`,
`refunded`).

**4. Que devient le portail client ?** Le quatrième critère le retire de l'achat
unique tout en exigeant que l'historique des paiements et les factures restent
accessibles.

## Decision

### 1. L'acte d'achat est la **session de checkout**, écrite en attente avant l'URL

`billing_purchase` porte une ligne par acte d'achat. Elle est écrite en statut
`pending` par `openCheckout`, **avant que l'URL ne parte au navigateur**, avec
l'offre et le prix résolus du catalogue typé, et l'identifiant de session rendu
par le fournisseur.

**Toutes les sessions ouvertes pour cet achat sont retenues**, dans
`billing_purchase_session`, et c'est par cet index inverse que la confirmation
et la réconciliation retrouvent la ligne — jamais par
`billing_purchase.provider_session_id`, qui ne porte que la **dernière**
ouverture. La distinction n'est pas cosmétique : une session de checkout reste
payable chez le fournisseur après qu'une autre a été ouverte, rien de notre côté
ne l'expire, et la première rédaction de cet ADR ne le disait pas. La revue de
s20 a suivi le fil jusqu'au bout — ouvrir `S1`, revenir en arrière, rouvrir
(`S2`), payer `S1` : la confirmation ne trouvait rien, **un paiement encaissé
n'accordait aucun droit**, la réconciliation ne connaissait plus `S1`, et
l'utilisateur qui ne voyait rien rachetait, donc payait deux fois. Retenir chaque
ouverture rend l'écrasement inoffensif et referme le chemin.

**Ce qui est mesuré dans cette séquence, et ce qui est déduit.** La séquence
`S1`/`S2` ci-dessus est écrite comme un fait ; elle ne l'est qu'en partie
(constat m8 de la seconde revue). Sont **mesurés** : la colonne écrasée à chaque
réouverture, la confirmation qui ne trouvait rien, la réconciliation qui ne
retrouvait pas la session supplantée — tous trois contre la base, dans
`tests/billing.test.ts`. Est **déduit**, et par rien d'autre qu'une lecture du
code : qu'une seconde ouverture produise une session **différente**. La clé
d'idempotence d'`openCheckout` est stable par (périmètre, offre) et transmise
telle quelle au fournisseur : dans la fenêtre d'idempotence de celui-ci, la même
session devrait être rendue, et l'écrasement n'aurait alors rien à écraser. Les
doublures de réseau ne modélisent pas ce rejeu — elles rendent un identifiant
neuf à chaque appel, et le cas de l'adaptateur n'assert que **l'en-tête**
envoyé. La correction reste juste dans les deux cas — retenir chaque session ne
suppose rien du fournisseur —, mais aucune commande de ce dépôt ne prouve la
prémisse. Elle demande des clés de test, et le geste est écrit dans la revue.

**Le repli sur l'ancien emplacement, pendant la bascule.** L'index inverse est
ajouté par la migration `0004`, qui reporte les sessions présentes à l'instant
où elle passe. Or `docs/reliability.md` demande qu'une migration soit
rétrocompatible avec la version qui **sert encore** : pendant la bascule, celle-ci
continue d'ouvrir des checkouts sans rien écrire dans l'index inverse. Le
nouveau code résout donc une session par l'index inverse **et, à défaut, par
`billing_purchase.provider_session_id`** — les deux emplacements, le temps de la
transition, ce qui est exactement « ajouter avant de lire ». Sans ce repli, une
session ouverte dans cette fenêtre et payée après la bascule rejouerait le défaut
ci-dessus pendant le déploiement censé le refermer (constat C4). Le repli est
**transitoire** : il se retire quand l'ancienne version est hors ligne, et ce
retrait est un tour à part — « cesser d'écrire avant de supprimer ».

La confirmation ne fait que **promouvoir** cette ligne : elle écrit
`status = 'paid'`, l'identifiant de paiement, le montant réellement prélevé et
la date. **Le webhook n'insère jamais.**

C'est le motif que le dépôt possède déjà à deux endroits, et il est repris tel
quel : le rattachement du client avant l'URL (ADR 034 §1) et la clé d'attente
promue à la confirmation (ADR 033).

Deux types d'événement promeuvent, et il faut les deux :
`checkout.session.completed` et `checkout.session.async_payment_succeeded`, l'un
et l'autre **seulement** si `mode === 'payment'` et `payment_status === 'paid'`.
Les deux unions du fournisseur sont ouvertes (`… | OtherString`) : le repli est
fermé — ce qui n'est pas exactement reconnu n'accorde rien.

### 2. Une unicité `(billing_customer_id, offer_id)`, et c'est le moteur qui la tient

**Un périmètre ne possède qu'une ligne par offre unique**, quel que soit son
statut. C'est l'invariant central de la story — « il ne doit pas pouvoir être
facturé deux fois pour un même acte d'achat » — et il est tenu par une contrainte
de base, pas par une lecture.

`openCheckout` refuse en `409` (`already_purchased`) quand cette ligne existe en
statut `paid`, et **écrit en `on conflict do update`** sinon : un achat abandonné
puis repris, ou remboursé puis racheté, réutilise la ligne.

**Ce que la reprise fait de la ligne**, que la première rédaction laissait
indéterminé — au point qu'aucun cas ne le fixait, et qu'une mutation remplaçant
l'écriture par un `do nothing` laissait la suite entière au vert (revue de s20) :

- `provider_session_id` devient la **nouvelle** session. L'ancienne n'est pas
  perdue pour autant : elle reste rattachée à l'achat par
  `billing_purchase_session` (§1) ;
- le cycle précédent est **remis à zéro** — paiement, montant, devise, date
  d'achat, date de remboursement, horodatage d'événement. Sans cela, un « payé →
  remboursé → racheté → payé » rendait un achat `paid` portant une date de
  remboursement : l'écran n'en montrait rien, l'export RGPD mentait.

Ce refus est indépendant de `already_subscribed`, et c'est le sixième critère :
la garde d'abonnement ne regarde que les abonnements, la garde d'achat ne regarde
que les achats. Un abonné peut acheter à vie ; un acheteur à vie peut s'abonner.

### 3. Le remboursement **total** révoque ; le partiel ne change rien

`charge.refunded` transporte `amount` et `amountRefunded` jusqu'au domaine, qui
décide : `amountRefunded >= amount` (et `amount > 0`) révoque, tout le reste
laisse le droit. La règle est une fonction pure, pas un test dans l'adaptateur.

Une ligne révoquée n'accorde plus l'accès, reste visible dans l'historique avec
son statut, et **redevient achetable**.

**L'ordre de livraison ne compte pas, et il fallait l'écrire.** `charge.refunded`
ne porte que le paiement, jamais la session ; une ligne encore en attente n'a pas
de paiement. Un remboursement livré **avant** la confirmation qu'il annule — le
désordre que l'ADR 034 déclare possible — ne trouvait donc aucune ligne, était
journalisé (donc jamais rejoué), et la confirmation ultérieure accordait l'accès
à un achat intégralement remboursé. Le remboursement est désormais écrit d'abord
dans `billing_refunded_payment`, sous la seule clé qu'il porte, et la promotion
l'y relit et l'applique dans la même transaction.

**Les deux chemins qui posent un paiement rejouent ce journal**, pas seulement
la promotion (constat m6). La réconciliation est l'autre : elle pose le même
`provider_payment_id`, et elle ne consultait pas le journal. La suite était
atteignable et **permanente** en mode local — remboursement journalisé,
confirmation jamais délivrée, charge introuvable, et l'accès accordé sur un achat
intégralement remboursé. Le journal l'emporte sur le silence de la charge : il
porte un événement **reçu** du fournisseur, une charge introuvable ne porte
rien.

**Une lecture de réconciliation qui tranche consomme son achat pour le
passage** (constat m7). Depuis §1, plusieurs sessions désignent le même achat, et
deux d'entre elles peuvent être payées — deux onglets, deux sessions vivantes,
deux prélèvements. Les deux lectures se départageaient alors sur le paiement, et
chaque exécution réécrivait l'une puis l'autre : `changed` ne retombait jamais à
zéro, ce que `docs/reliability.md` §1 interdit. La première lecture qui tranche
l'emporte, dans l'ordre rendu par le fournisseur ; une session impayée ne tranche
pas, donc ne consomme pas la place. **Ce que cela ne répare pas** : le second
prélèvement existe toujours chez le fournisseur, et rembourser celui que la ligne
retient révoque l'accès alors que l'autre reste encaissé. Fermer cette fenêtre
demande l'expiration de session, dont la dernière puce ci-dessous dit pourquoi
elle n'est pas prise ici.

### 4. Le portail suit l'abonnement ; l'historique est servi par l'application

Le bouton « Gérer la facturation » n'est rendu que si le périmètre a au moins un
abonnement en cache. Ce que le portail sert — moyen de paiement, changement
d'offre, résiliation — n'existe pas pour un achat unique.

L'historique des paiements est rendu par l'application depuis son propre cache :
offre, date, **montant réellement prélevé** et statut. Il ne dépend d'aucun
tiers.

Les factures sont émises et délivrées par le fournisseur :
`invoice_creation: { enabled: true }` est posé sur les sessions en mode paiement.

## Considered options

**Sur le rattachement de l'offre à l'achat**

- *Lire l'offre depuis `metadata` ou `client_reference_id` de la session* —
  rejeté. L'ADR 034 a déjà tranché que ces champs sont modifiables depuis le
  tableau de bord du fournisseur et ne servent qu'au diagnostic. Or l'offre
  achetée **est** de l'autorisation : c'est elle qui dit quel droit est accordé.
  Le même raisonnement, au même endroit, pour une donnée qui compte davantage.
- *Développer `line_items` à la réception de l'événement* — rejeté par l'ADR 034,
  §« Sur l'ordre » : un appel réseau par webhook, sur un point d'entrée public
  non limité en débit avant s28, transforme une rafale d'événements en rafale
  d'appels sortants.
- *Retrouver l'offre par le montant payé* — rejeté : deux offres peuvent partager
  un montant, le catalogue ne l'interdit pas (il n'interdit que deux offres sur
  un même `priceId`), et une remise ou une taxe fait diverger `amount_total` du
  montant déclaré. La lecture inverse serait fausse le jour d'une promotion.

**Sur ce qui empêche la double facturation**

- *Rejouer `already_subscribed` tel quel, sur un accès consolidé* — rejeté par le
  sixième critère : un abonné ne pourrait plus acheter à vie, et un acheteur à
  vie ne pourrait plus s'abonner. C'est la seule lecture qui casse un critère
  explicite de la story.
- *Un refus applicatif seul, sans contrainte de base* (la forme de l'ADR 037) —
  rejeté **ici**. L'ADR 037 s'y résout parce que l'insertion d'un abonnement est
  faite par le **webhook public**, où une violation d'unicité devient un `500`
  permanent que `docs/reliability.md` §1 interdit. Le choix §1 déplace
  l'insertion sur `openCheckout`, une route authentifiée : la contrainte y est
  rencontrée comme un conflit ordinaire, jamais comme une panne. Ce déplacement
  est ce qui rend la contrainte possible, et c'est la raison pour laquelle les
  deux options mesurées et rejetées par l'ADR 037 ne sont pas réessayées — elles
  portaient sur une table que le webhook insère.
- *Unicité sur l'identifiant de paiement seul* — rejeté : elle empêche deux
  écritures du même paiement, ce que le journal d'événements fait déjà, et elle
  ne dit rien de deux paiements distincts pour la même offre, qui est le cas
  qu'on veut fermer.
- *Une ligne par acte d'achat, sans unicité par offre* (historique pur) —
  rejeté : c'est un compteur de crédits, c'est-à-dire la brique dont la
  facturation à l'usage — au cimetière du PRD — a besoin. Un achat unique se
  possède ou ne se possède pas.

**Sur le remboursement**

- *Révoquer sur tout `charge.refunded`* — rejeté : un geste commercial partiel de
  quelques euros détruirait une licence à vie payée. Le produit punirait le
  vendeur d'avoir été aimable, et le webhook est le seul chemin — il n'y a pas de
  ré-octroi.
- *Décider dans l'adaptateur* (`refunded === true`) — rejeté : la règle
  deviendrait inatteignable par un test de domaine, et l'adaptateur n'a pas à
  savoir ce qu'un remboursement fait perdre. Le champ `refunded` du fournisseur
  n'est d'ailleurs pas la même question — il dit qu'un remboursement existe, pas
  qu'il est total.

**Sur le portail**

- *Le garder pour tout périmètre ayant un client* (l'état livré par s19) —
  rejeté par le quatrième critère, en toutes lettres.
- *Le retirer et pointer les factures depuis l'écran* — rejeté **pour cette
  story** : le lien demanderait de stocker une URL signée du fournisseur au repos
  (`charge.receipt_url`), ou un appel réseau à chaque affichage. Le premier met
  au repos un jeton d'accès que `docs/security.md` §5 tient à distance ; le
  second remet un tiers sur le chemin d'un écran.

## Consequences

**Ce qui devient plus facile.** s21 (gating) reçoit un droit d'accès consolidé —
abonnement **ou** achat payé — décidé par une fonction pure du domaine, et n'a
plus à interroger un état d'abonnement. s22 peut présenter les deux modes. Le
parcours « remboursé puis racheté » est un cas ordinaire, sans écriture
destructive.

**Ce qui devient plus difficile.** Ouvrir un checkout d'achat unique écrit deux
lignes avant de rendre l'URL — le client et l'achat en attente. Un abandon laisse
une ligne `pending`, qui est le comportement voulu et non un résidu : c'est elle
qui est reprise au prochain essai.

**Ce qu'il faut surveiller.**

- **Un remboursement partiel n'apparaît nulle part.** C'est assumé (§3) : la
  ligne reste `paid`, et l'historique ne le montre pas. Un projet qui a besoin de
  le voir doit ouvrir un ADR, pas élargir la règle en silence ;
- **la réconciliation ne rattrape que ce que nous avons ouvert.** Elle promeut
  les lignes dont nous connaissons la session et corrige leur état de
  remboursement ; une session créée de toutes pièces dans le tableau de bord du
  fournisseur n'a pas d'offre, et il n'y en a aucune à deviner. C'est la même
  frontière que celle du constat F6 de la revue de s19 ;
- **le lien vers la facture n'existe pas dans l'écran.** Le critère est tenu par
  l'émission de la facture chez le fournisseur, qui la délivre. Ne pas lire ce
  document comme livrant un lien ;
- **l'unicité porte sur `(client, offre)`.** Deux offres uniques distinctes
  restent achetables ensemble, et c'est voulu. Retirer une offre du catalogue
  laisse ses achats en base : l'écran sait dire « offre retirée du catalogue »,
  comme il le fait déjà pour un abonnement ;
- **la réconciliation est dissymétrique, et elle doit le rester.** Une charge que
  le fournisseur ne rend pas (`chargedAmount: null` — au-delà du plafond de
  pagination, et toujours en mode local) veut dire « je ne sais pas », pas « rien
  n'a été remboursé ». Elle promeut donc un achat en attente, mais ne relève
  jamais un achat déjà remboursé. De même, une session impayée n'impose rien :
  depuis §1, plusieurs sessions désignent le même achat, et celle qui a été
  abandonnée rétrograderait la ligne que celle qui a été payée vient de promouvoir.
  `reconciledPurchaseStatus` rend `null` dans ces deux cas, et `null` veut dire
  « ne touche pas » ;
- **`billing_refunded_payment` n'a pas de borne, et c'est un choix** (constat
  m10). Une ligne y est insérée pour **tout** remboursement total, y compris ceux
  des factures d'abonnement, qui ne trouveront jamais d'achat à promouvoir ;
  rien ne les relit alors, rien ne les retire. Ce qui rend l'absence de borne
  tenable, et qui la distingue des seaux de limitation de débit — la croissance
  que ce dépôt a déjà refermée : là-bas, une ligne par requête et par visiteur,
  donc une croissance **pilotée par l'extérieur** ; ici, une ligne par
  remboursement effectivement émis par le vendeur, quatre colonnes
  d'identifiants et d'horodatages, aucune donnée personnelle. Ce qui rend
  l'effacement coûteux : une ligne retirée rouvre le remboursement qu'elle a
  absorbé — c'est le constat C2, en sens inverse. Un projet dont le volume de
  remboursements rendrait cette table gênante doit ouvrir un ADR, et il devra y
  décider ce qui autorise l'oubli d'un remboursement (le plus probable : la
  purge du périmètre de l'achat correspondant, qui n'est pas atteignable par la
  cascade puisque le journal ne porte aucun périmètre). **Aucune commande ne
  vérifie cette puce** : c'est un arbitrage écrit, pas une règle ;
- **la clé d'idempotence du checkout est stable, et ses paramètres ne le sont
  pas.** `checkout:<périmètre>:<offre>` est fixe, tandis que la langue et le
  nombre de sièges varient d'un appel à l'autre sous cette même clé. Un
  fournisseur d'idempotence refuse une seconde requête aux paramètres différents,
  et rien dans ce dépôt ne l'a éprouvé : hérité de s19, non instruit ici, à
  vérifier en clés de test (corollaire du constat m8) ;
- **rien n'expire une session de checkout de notre côté.** Deux directions ont
  été mesurées pour fermer la fenêtre de §1 en amont, et aucune ne tient seule :
  *expirer la session précédente chez le fournisseur* échoue parce que la clé
  d'idempotence du checkout est stable par (périmètre, offre) — l'appel suivant
  rejouerait la réponse de la session qu'on vient d'expirer, dont l'URL est morte
  — et parce qu'un refus d'expiration ne distingue pas « déjà expirée » de « déjà
  payée », qui est précisément la course à fermer ; *ne jamais supplanter une
  session ouverte* demande de renvoyer le navigateur vers l'URL de la session en
  cours, donc de stocker au repos une URL signée du fournisseur — ce que §4
  refuse déjà pour `charge.receipt_url` — ou d'aller la relire à chaque
  ouverture. Retenir chaque session ouverte ne prévient pas la fenêtre : elle la
  rend **sans conséquence**, ce qui est la propriété demandée. Un projet qui
  voudrait en plus l'expiration devra ouvrir un ADR, et commencer par la clé
  d'idempotence.
