# Research — Story s23-seat-billing

## Prémisse fausse — à lire avant tout le reste

**Le port de paiement ne sait pas modifier un abonnement.** `packages/ports/src/payments.ts:380`
déclare l'interface `Payments` et elle a exactement cinq méthodes :

```
createCheckout · createPortalSession · verifyWebhook · listSubscriptions · listPurchases
```

Aucune n'écrit chez le fournisseur après la création. La quantité n'est
transmise qu'**une fois**, à l'ouverture du tunnel
(`billing-use-cases.ts:488` — `quantity: offer.perSeat ? await seatsOf(…) : 1`),
et plus jamais ensuite.

Or quatre des huit critères — 2, 3, 6 et 7 — demandent d'écrire une quantité sur
un abonnement **existant**. La story suppose une capacité qui n'existe pas.

Ce n'est pas un détail d'implémentation : c'est un changement de **contrat de
port**, et il traverse `packages/ports`, l'adaptateur Stripe et le double de
test. Le contrat impose qu'aucune méthode ne lève et que l'échec soit une valeur
(« Aucune méthode ne lève : l'échec est une valeur », `payments.ts:375-378`) —
c'est précisément ce qui rendra le critère 6 (atomicité) exprimable, mais il faut
l'écrire avant de pouvoir s'en servir.

## Les cinq faits structurants

1. **`requires: []` du module `billing` est une décision, pas un oubli** (ADR 034,
   `packages/modules/billing/src/module.ts:44`, commenté aux lignes 23-27) :
   « déclarer `organizations` en requis rendrait la facturation impossible sans
   multi-tenant ». s23 ne doit donc **pas** ajouter cette dépendance. Le couplage
   passe par le point de composition, `apps/web/lib/billing.ts`.
2. **Le motif de couplage existe déjà et sert de modèle.** `seatsOf`
   (`apps/web/lib/billing.ts:218`) compte les sièges et **rend `1`** quand le
   périmètre n'est pas une organisation ou quand `organizations` est coupé.
   C'est exactement la forme que demande le critère 8 — le forfait est le
   comportement de repli, pas un cas particulier à écrire.
3. **`perSeat` est déjà au contrat d'offre** (`domain/offer.ts:42`, validé
   `offer.ts:71`). Le critère 1 est à moitié acquis. En revanche **aucune limite
   de sièges n'existe** dans `BillingOffer` : le critère 5 demande un champ neuf.
4. **`quantity` est déjà persistée** sur l'abonnement (`application/ports.ts:29`
   et `:135`). Il y a donc un endroit où lire ce que le fournisseur croit, sans
   l'interroger.
5. **Les deux points d'accroche sont nommés** :
   `acceptInvitation` (`organizations/src/application/organization-use-cases.ts:690`)
   et `removeMember` (`:740`). Le critère 4 confirme que l'incrément se fait à
   l'**acceptation**, jamais à l'envoi de l'invitation.

## La réconciliation change de sens, et c'est le piège

`scripts/billing-reconcile.ts` existe (43 lignes) et son commentaire pose la
doctrine actuelle : « Ce que le module `billing` stocke est un **cache** de ce
que le fournisseur détient (ADR 034) ». La commande lit Stripe et réécrit le
local. Le fournisseur fait foi.

Le critère 7 demande l'inverse : « compare la quantité Stripe au nombre réel de
membres et **corrige l'écart** ». Pour les sièges, la vérité est **locale** — le
nombre de membres — et la quantité Stripe est la valeur dérivée. La même commande
devrait donc réconcilier dans les deux sens selon le champ : le statut vient du
fournisseur, la quantité va vers lui.

Deux contraintes s'ajoutent, et elles se contredisent presque :

- `AGENTS.md` dit que `billing:reconcile` **« n'efface jamais »** : « un silence
  du tiers ne doit pas couper un client qui paie ». Corriger une quantité chez le
  fournisseur est une écriture, pas un effacement — mais une lecture partielle
  des membres (base en cours de migration, organisation à demi supprimée)
  ferait *baisser* une facture à tort.
- `docs/reliability.md` §1 impose le rejeu sans effet supplémentaire, ce que
  `tests/billing.test.ts` vérifie déjà en exécutant la commande deux fois.

C'est le point où cette story peut créer un défaut de facturation silencieux,
et c'est celui qui mérite le plus d'attention au plan.

## Story visée

« Facturer au nombre de membres ». Complexité annoncée : **4**.
Dépendances : `s21-trials-and-gating`, `s17-roles-permissions` — livrées.

1. Une offre marquée facturée au siège dans la configuration.
2. Ajout d'un membre → quantité incrémentée ; retrait → décrémentée.
3. La quantité facturée égale toujours le nombre de membres actifs après toute
   opération.
4. Une invitation en attente n'est pas facturée ; elle le devient à l'acceptation.
5. Une limite de sièges configurable ; l'ajout au-delà est refusé **côté
   serveur**, avec un message nommant la limite.
6. Un échec Stripe n'ajoute pas le membre : atomique et rejouable.
7. Une commande de réconciliation compare et corrige l'écart.
8. Module non activé : forfait, aucune synchronisation, aucune limite.

## État actuel du code

| Fichier | Ce qu'il fait aujourd'hui |
|---|---|
| `packages/ports/src/payments.ts:380` | cinq méthodes, **aucune écriture post-création** |
| `packages/modules/billing/src/domain/offer.ts:42,71` | `perSeat: boolean`, validé ; **pas de limite** |
| `packages/modules/billing/src/application/billing-use-cases.ts:488` | envoie la quantité **une seule fois**, au checkout |
| `packages/modules/billing/src/application/ports.ts:29,135` | `quantity` persistée sur l'abonnement |
| `apps/web/lib/billing.ts:218` | `seatsOf` — compte les membres, rend `1` sans organisations |
| `packages/modules/billing/src/module.ts:44` | `requires: []` — décision ADR 034 |
| `organizations/.../organization-use-cases.ts:690,740` | `acceptInvitation`, `removeMember` |
| `scripts/billing-reconcile.ts` | réconcilie fournisseur → local, rejouable, n'efface jamais |

## Pièges & contraintes

- **L'atomicité traverse deux systèmes qui n'ont pas de transaction commune.**
  Le critère 6 dit « n'ajoute pas le membre ». L'ordre compte : écrire chez
  Stripe **avant** de valider l'ajout local rend l'échec sans effet ; l'inverse
  demande une compensation, qui peut elle-même échouer. Le port ne levant pas,
  l'échec est une valeur que l'appelant **doit** traiter — le compilateur y
  oblige.
- **Le rejeu ne doit pas doubler.** Une clé d'idempotence existe déjà pour le
  checkout (`billing-use-cases.ts`, `idempotencyKey: \`checkout:…\``). Une mise à
  jour de quantité rejouée doit converger, pas incrémenter.
- **Une limite de sièges est une règle d'autorisation**, donc serveur, et son
  message nomme la limite — sans divulguer autre chose. Elle doit être refusée
  au même endroit que les autres refus d'`organizations`, pas dans l'écran.
- **`docs/security.md` §3** : une ressource d'une autre organisation rend 404.
  Un dépassement de limite n'est pas ça — c'est un 409 ou 403 sur **sa propre**
  organisation, comme l'a tranché s21 pour les fonctionnalités réservées.
- **La forme fermée de journalisation d'échec** (`payments.ts:388-395`) n'a
  aucun champ pour un identifiant client ou un montant. Une nouvelle méthode de
  port hérite de cette contrainte.
- **Sans Postgres levé, 288 tests se sautent en silence.** Deux fichiers seulement
  portent un garde qui crie.

## Questions ouvertes

- **Qui est « membre actif » ?** Le critère 3 dit « nombre de membres actifs ».
  `seatsOf` compte déjà quelque chose — la recherche n'a pas ouvert la requête
  sous-jacente pour savoir si elle exclut les invitations en attente, les comptes
  désactivés ou le propriétaire. Le critère 4 en dépend directement.
- **Que fait-on d'un dépassement *constaté* plutôt que provoqué ?** Si la limite
  est abaissée alors que l'organisation a déjà trop de membres, le critère 5 ne
  dit rien. Refuser les ajouts suivants sans expulser personne est le seul
  comportement non destructeur.
- **La quantité doit-elle suivre pour une offre `one_time` ?** `perSeat` est un
  booléen indépendant du mode ; le catalogue ne l'interdit pas aujourd'hui pour
  un achat unique, ce qui n'a pas de sens.
- **Le proratage.** Modifier une quantité en cours de période fait émettre à
  Stripe un ajustement. Rien dans le dépôt ne dit quel comportement est voulu, et
  c'est un choix de facturation, pas technique.

## Complexité réelle

`docs/stories.md` annonce **4**. Après lecture : **5**.

L'écart ne vient pas du volume mais du nombre de choses dures **distinctes** :
un contrat de port à étendre sur trois paquets ; une atomicité entre deux
systèmes sans transaction commune ; une réconciliation dont le sens de vérité
s'inverse par rapport à la doctrine écrite ; et une règle d'autorisation neuve.
Chacune est traitable ; ensemble, elles ne tiennent pas dans une revue.

## Proposition de découpe

**s23a — la quantité facturée suit les membres** (critères 1, 2, 3, 4, 6, 7, 8).
Étend le port d'une méthode d'écriture, branche `acceptInvitation` et
`removeMember` au point de composition, rend l'opération atomique et rejouable,
et étend `billing:reconcile` à la quantité. La réconciliation reste **avec** la
synchronisation : c'est son filet, et la story elle-même prévient que « sans
commande de réconciliation, la dérive est silencieuse et ne se découvre qu'à la
facture du client ». Les en séparer livrerait la dérive sans son détecteur.

**s23b — la limite de sièges** (critère 5). Une règle de refus, pure, sans état
distribué : un champ de configuration, une vérification serveur, un message qui
nomme la limite. Elle ne dépend de s23a que par le comptage, déjà existant.

La coupure passe entre *ce qui doit rester cohérent entre deux systèmes* et *ce
qui se décide localement*. C'est la seule ligne qui laisse deux stories
revuables.
