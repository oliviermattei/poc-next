# packages/modules/billing — règles locales

Le module de facturation (s19, s20, s22, s24). Il possède les offres, les
abonnements, **les achats uniques**, le webhook entrant du fournisseur de
paiement, **le tunnel de paiement d'un visiteur sans compte** et **l'écran
public de tarifs** (`PricingTable`). Il ne possède **ni** le gating par offre
(s21), **ni** les métriques de revenus (s38), **ni** les comptes : créer celui
d'un paiement invité se fait au point de composition
(`apps/web/lib/guest-account.ts`), parce que ce module ne connaît pas `auth`.

**Ce qu'il possède de la page de tarifs, exactement** : l'écran
(`presentation/pricing-table.tsx`), les deux règles qui le nourrissent
(`domain/pricing.ts`), ses clés de catalogue et l'entrée de navigation qui y
mène. Le **fichier de page** (`apps/web/app/pricing/page.tsx`) reste à
l'application, comme `/billing` : c'est elle qui lit `billing.available`, qui
résout la session, qui formate le prix dans la langue servie et qui fournit les
déclencheurs. La ligne d'avant disait que ce module ne possédait « pas la page
de tarifs publique » ; elle était vraie avant s22 et fausse après.

## Ce qu'il faut savoir avant d'y toucher

**Ces tables sont un cache reconstructible, pas la vérité** (ADR 034). La vérité
est chez le fournisseur ; `pnpm billing:reconcile` réécrit le cache depuis lui.
Aucune règle ne doit supposer qu'une colonne est à jour — `grantsAccess` prévoit
explicitement le retard d'un webhook.

**Sauf pour la quantité de sièges, où le sens s'inverse** (s23, ADR 046). C'est
le seul champ du module dont la vérité est **locale** : le nombre de membres de
l'organisation. La quantité détenue par le fournisseur en est *dérivée*, si bien
qu'un écart est une erreur chez lui, pas chez nous — et `reconcile` la corrige
en écrivant **vers** le fournisseur. Un agent qui appliquerait la doctrine
générale de l'ADR 034 à ce champ écraserait le nombre de membres par la quantité
Stripe, c'est-à-dire propagerait l'erreur au lieu de la corriger.

Deux gardes en découlent, et elles sont éprouvées par mutation dans
`tests/billing.test.ts` :

- **la clé d'idempotence porte la quantité visée**, jamais un incrément
  (`seatIdempotencyKey`). Un delta rejoué facture deux fois ; une cible rejouée
  converge ;
- **aucune quantité ne baisse sur une lecture de membres en échec ou vide**
  (`billableSeats`, `domain/seats.ts`). Zéro membre n'est pas un état — une
  organisation naît avec son fondateur —, c'est une lecture partielle, et un
  silence de la base doit interrompre la réconciliation, pas réduire une
  facture.

**Le plafond de sièges d'une offre n'a pas la condition de `offerSyncsSeats`**
(s47, `domain/seats.ts`). Cette dernière exclut l'achat unique et le forfait
parce qu'ils n'ont **aucune quantité à corriger** ; un plafond, lui, se vend
précisément au forfait — « jusqu'à cinq membres », prix fixe —, et c'est même
son emploi le plus courant. `offerSeatLimit` ne reçoit donc que `seatLimit` :
elle ne *peut pas* voir `perSeat` ni `mode`. Deux conséquences à ne pas
retourner :

- dans `syncSeats`, le plafond est évalué **avant** `offerSyncsSeats`. L'inverse
  rendrait illimitée toute offre au forfait — mesuré à nouveau après la revue,
  **3 cas rouges** dans `tests/billing.test.ts` et non deux : « accepte
  l'invitation qui atteint le plafond et refuse la suivante », « ne consomme pas
  l'invitation qu'elle refuse » et « n'expulse personne quand le plafond passe
  sous l'effectif, et laisse retirer » ;
- il ne mord que sur un **ajout** (`adds`), et jamais sur un retrait : un
  plafond abaissé sous l'effectif laisse tous les membres en place et refuse les
  ajouts suivants (critère 4 de s47, et le cimetière du PRD). Mesuré, **1 cas
  rouge** quand `adds` est ignoré — « n'expulse personne quand le plafond passe
  sous l'effectif, et laisse retirer », le seul qui retire un membre au-dessus
  du plafond.

**`requires: []`, et c'est une décision.** Un abonnement appartient tantôt à une
organisation, tantôt à un compte, selon la configuration. Déclarer
`organizations` en requis rendrait la facturation impossible sans multi-tenant.
Aucune clé étrangère ne sort donc du module (ADR 018) : le périmètre est stocké
en deux colonnes de texte, et il est **toujours** résolu par la fonction unique
de l'application (`dataOwnerOf`), injectée en `ownerOf`.

**Aucune route n'accepte d'identifiant de périmètre.** Viser la facturation d'une
autre organisation n'est pas refusé : c'est **impossible à formuler**. Le corps
du checkout est un `z.strictObject` à un champ — un prix, un montant ou un
identifiant d'organisation glissés dedans font un 400, pas un silence.

**`webhooks: []` alors que ce module reçoit un webhook.** Le contrat déclare des
gestionnaires que le registre appellerait, et aucun répartiteur ne les appelle —
`tests/module-registry.test.ts` le **vérifie**, et rougit dès qu'un gestionnaire
de webhook est appelé (`.handle(`) dans `apps/web` ou dans
`packages/core/src`, ou qu'une lecture de `.webhooks` apparaît dans `apps/web`.
Ce sont les deux périmètres balayés, et ce sont les seuls : ni les modules, ni
`tests/`. Le jour où l'un des deux rougit, ce module doit être rouvert.
Surtout, `WebhookEvent` porte `id`, `type` et `payload`
**déjà parsé** : passer par lui obligerait à parser avant de vérifier la
signature, ce que `docs/security.md` §4 interdit. Le webhook est donc une
**route déclarée**, publique, dont la garde est la signature. Un module coupé n'a
alors ni route ni webhook.

**L'ordre des événements est décidé deux fois, et c'est voulu.** `appliesAfter`
(dans `domain/subscription.ts`) **nomme** la règle ; le `setWhere` de
`infrastructure/drizzle-billing-repositories.ts` la **refuse** dans le prédicat
de l'écriture. Une lecture suivie d'une décision laisserait la fenêtre de
concurrence que `docs/reliability.md` §1 rejette. Les deux disent `>=` ; si l'un
change, l'autre doit changer, et `tests/billing.test.ts` le prouve contre la base.

**Le composant interactif vit dans `apps/web`** (ADR 027) : il appelle `fetch`,
et `eslint.config.ts` refuse tout appel réseau depuis un module. L'écran reçoit
ses déclencheurs en `ReactNode`, obligatoires — un `ReactNode` facultatif se
serait oublié en silence au point de composition.

**Le tunnel de paiement exige JavaScript, et c'est un prix assumé.** Souscrire
et ouvrir le portail passent par `fetch` puis par `window.location.assign` : sans
script, le bouton reste éteint et un `<noscript>` le dit. La raison est
mesurable — une redirection 303 vers `checkout.stripe.com` depuis une soumission
de formulaire serait bornée par `form-action 'self'`, et il faudrait déclarer
deux origines tierces dans `config/security.ts`, que la politique n'a pas
aujourd'hui. Qui voudrait un checkout sans JavaScript doit donc **d'abord**
décider d'ouvrir ces deux origines : c'est une décision de sécurité, pas un
ajustement d'écran.

**Un client peut avoir plusieurs abonnements en cache**, et lequel est *le* sien
est une règle du `domain` (`currentSubscriptionOf`), jamais un `limit(1)`. Le
dépôt lit dans un ordre total ; la règle préfère celui qui donne l'accès. **ADR
037** porte cette décision, les deux contraintes de schéma essayées et pourquoi
chacune casse.

**L'achat unique n'est pas un abonnement, et l'invariant est en base**
(ADR 038). `billing_purchase` porte une ligne par acte d'achat, écrite en
`pending` **à l'ouverture du checkout** — la charge utile de confirmation ne dit
pas quel prix a été payé, `line_items` n'étant pas un champ de la session mais
une propriété développable. La confirmation **promeut** ; elle n'insère jamais.

Ce qui interdit de facturer deux fois le même acte d'achat, et il faut les
deux :

- l'unicité `(billing_customer_id, offer_id)` — tenue par le moteur, y compris
  sous deux ouvertures simultanées ;
- le refus `already_purchased` (409) sur `openCheckout`, qui dit pourquoi.

Cette contrainte **est** possible ici alors que l'ADR 037 en a rejeté deux sur
les abonnements : là-bas, c'est le webhook **public** qui insère, et une
violation d'unicité y devient un `500` permanent. Ici, le webhook ne fait que
mettre à jour ; la seule écriture qui rencontre un conflit est la route de
checkout, authentifiée. Ne pas lire ce paragraphe comme une permission de
rejouer les deux options de l'ADR 037 sur `billing_subscription`.

**Deux fermetures, et elles ne se regardent pas** (sixième critère de s20) :
`already_subscribed` ne lit que les abonnements, `already_purchased` que les
achats. Une garde unique fondée sur l'accès consolidé interdirait à un abonné
d'acheter à vie et à un acheteur à vie de s'abonner. À l'écran, c'est la même
frontière : `hasSubscription` ferme le catalogue d'abonnements, `offer.owned`
ferme la carte de l'offre unique — **jamais** `hasAccess`, qui est le droit
consolidé que s21 lira.

**Un remboursement total révoque, un partiel ne change rien** (ADR 038 §3). Le
fournisseur émet le même événement pour les deux ; c'est `refundRevokesPurchase`
— une fonction pure — qui décide, jamais l'adaptateur. Conséquence assumée : un
remboursement partiel n'apparaît nulle part.

**Une session de checkout n'est jamais oubliée** (ADR 038 §1, constat C1 de la
revue de s20). `billing_purchase.provider_session_id` ne porte que la
**dernière** ouverture — `openPurchase` l'écrase à chaque reprise. La clé de
rattachement est `billing_purchase_session`, qui les retient **toutes** : c'est
elle que la confirmation et la réconciliation interrogent. Rien de notre côté
n'expire une session chez le fournisseur, et une session ouverte reste payable
après qu'une autre l'a supplantée ; sans cet index inverse, un paiement encaissé
sur `S1` après une réouverture en `S2` n'accordait aucun droit, n'était pas
rattrapable par `pnpm billing:reconcile`, et l'utilisateur qui ne voyait rien
rachetait. **Un seul prédicat pour les deux lecteurs** — `purchaseOfSession`,
dans `infrastructure/` : la confirmation et la réconciliation posent la même
question, et deux formulations feraient deux vérités. C'est ce qu'a coûté la
moitié non prouvée : résoudre l'achat par la colonne **dans la réconciliation**
laissait 82 cas sur 82 au vert (constat C3), et les deux sites sont désormais
exigés chacun par un cas.

**Ce prédicat lit aussi l'ancien emplacement, et ce repli est transitoire**
(constat C4). Une migration est rétrocompatible avec la version qui **sert
encore** (`docs/reliability.md`) : pendant la bascule, celle-ci ouvre des
checkouts sans écrire dans l'index inverse, que le rattrapage de `0004` ne peut
pas connaître — il ne reporte que ce qui existe à l'instant où il passe. Lire
`billing_purchase.provider_session_id` **à défaut** est ce que « ajouter avant de
lire » exige ; sans lui, le déploiement qui referme C1 le rejoue sur sa propre
durée. À retirer une fois l'ancienne version hors ligne, dans un tour à part —
et c'est le seul usage légitime de cette colonne en lecture.

**Un remboursement peut précéder la confirmation qu'il annule** (constat C2).
`charge.refunded` ne porte que le paiement, et une ligne en attente n'en a pas
encore : le remboursement est donc écrit d'abord dans
`billing_refunded_payment`, et la promotion l'y relit dans la même transaction.
Le `ne(status, 'refunded')` de la promotion ne couvre que l'ordre **inverse** —
une confirmation livrée après un remboursement déjà appliqué sur la ligne. Les
deux gardes sont nécessaires ; ni l'une ni l'autre ne couvre les deux ordres.

**La reprise d'un achat repart à zéro** (constat m2) : session, paiement,
montant, devise, date d'achat, date de remboursement et horodatage d'événement.
Un « payé → remboursé → racheté → payé » qui garderait `refunded_at` rendrait un
export RGPD qui ment, alors même que l'écran et le droit sont justes.

**La réconciliation est dissymétrique, et c'est la règle** (constat m1).
`reconciledPurchaseStatus` rend `null` — « ne touche pas » — dans deux cas :
une session que le fournisseur dit impayée (plusieurs sessions désignent le même
achat, et l'abandonnée ne doit pas défaire ce que la payée a promu), et une
charge introuvable sur une ligne déjà remboursée (`chargedAmount: null` veut dire
« je ne sais pas », pas « rien n'a été remboursé » — c'est le cas permanent du
mode local). « Elle n'efface jamais » ne suffisait pas : « elle ne ré-accorde
jamais » est la moitié qui manquait.

**Les deux chemins qui posent un paiement rejouent le journal des
remboursements** (constat m6). La promotion le fait par sous-requête dans sa
transaction ; `reconcilePurchases` est l'autre écriture d'un
`provider_payment_id`, et elle ne le consultait pas — remboursement journalisé,
confirmation jamais délivrée, charge introuvable (le cas **permanent** du mode
local), et l'accès était accordé sur un achat intégralement remboursé. Le
journal l'emporte sur le silence de la charge : il porte un événement **reçu**,
une charge introuvable ne porte rien.

**Une lecture de réconciliation qui tranche consomme son achat pour le passage**
(constat m7). Plusieurs sessions désignent le même achat, et deux d'entre elles
peuvent être payées : elles se départageaient sur le paiement, et chaque
exécution réécrivait l'une puis l'autre — `changed` ne retombait jamais à zéro.
La première qui tranche l'emporte, dans l'ordre du fournisseur ; une session
impayée ne tranche pas, donc ne consomme pas la place. Cela ne rend pas le second
prélèvement : ADR 038 §3 dit ce qui reste ouvert.

**L'inventaire déclaré doit suivre ce que l'export rend** (constat m9).
`dataCategories` déclare `billing-customer`, `subscription` **et** `purchase` :
la purge des achats était mesurée, c'est la déclaration qui mentait, et c'est
elle que liront s34 et s35. Un cas de `tests/billing.test.ts` **dérive**
l'exigence des collections de l'export — ajouter une collection sans sa catégorie
le fait rougir.

**`billing_refunded_payment` n'est pas purgé, croît sans borne, et
`tests/billing.test.ts` doit le vider entre les cas.** Il ne porte que des
identifiants du fournisseur, sans lien vers un périmètre : la cascade de
`billing_customer` ne l'emporte pas, comme elle n'emporte pas le journal
d'événements. L'absence de borne est un arbitrage écrit, pas un oubli (constat
m10) : une ligne par remboursement total **émis**, jamais par requête — la
croissance n'est pas pilotée par l'extérieur, contrairement aux seaux de
limitation de débit —, et l'effacer rouvrirait un remboursement déjà absorbé.
ADR 038 §3 porte la décision et ce qu'un projet gêné devrait rouvrir. En test,
les cas réemploient `pi_life_1` : sans le `delete from billing_refunded_payment`
du nettoyage, un remboursement d'un cas révoque l'achat des suivants. Mesuré
**4 cas au rouge** au 2 septembre 2026, sur l'ordre d'exécution de ce
fichier — c'est un compte de fuite, il dépend de cet ordre et se déplacera. La
table l'annonçait à 5.

**Un essai expire par le temps, et il commence une fois par périmètre**
(s21, ADR 044). Deux moitiés, et il faut les deux.

La première : `grantsAccess` rend un `trialing` **daté**. La tolérance au retard
du cache, écrite pour `active`, ne s'applique pas ici — c'est l'essai qui fait
de cette date une échéance, comme l'annulation programmée. Un essai est un droit
d'accès **que personne n'a payé**, et le seul événement qui le termine peut se
perdre : c'est même le cas que `pnpm billing:reconcile` existe pour rattraper,
donc trop tard pour un droit d'accès. `displayStateOf` suit — un essai périmé
s'affiche `expired`. Un `trialing` sans `trial_end` ne devrait pas exister ; il
retombe sur `currentPeriodEnd`, pour que l'accès reste **borné** au lieu de
devenir perpétuel sur une lacune du cache.

La seconde : `trialDaysFor` rend `null` dès qu'un abonnement du client porte un
`trial_end`, et `openCheckout` l'appelle sur les abonnements qu'il lit **déjà**
pour la garde `already_subscribed` — une lecture, deux décisions. Mesuré dans
`stripe@22.6.1`, `subscription_data.trial_period_days` est un nombre que
l'appelant pose à chaque ouverture : le fournisseur n'a aucune mémoire d'essai
par client, et redemander un checkout rendait quatorze jours de plus,
indéfiniment. **Aucune table pour autant** : la trace est le cache, elle est
reconstructible depuis le fournisseur (`listSubscriptions` rend `trialEnd`),
donc `dataCategories`, `retention`, `purge` et `export` ne bougent pas.

**L'entrée de navigation des tarifs est `public`** (s22). Balayage du
3 septembre 2026 sur `billing-routes.ts` : **deux** déclarations
`protection: { level: 'public' }` à ce jour — le webhook (`:172`) et cette entrée
(`:214`). Aucune commande ne rougit le jour où une troisième apparaît : c'est un
compte mesuré, pas une garantie. Comparer des offres ne demande aucun
compte, et une offre qu'on ne voit pas ne se vend pas. `/billing` reste
`authenticated` : une entrée visible vers un écran qui redirige promettrait ce
qu'elle ne tient pas. Les deux disparaissent **avec le module**, par
déclaration — aucun composant ne porte de condition.

**L'écran de tarifs n'a aucun effet de bord, dans aucun état** (ADR 045). Il lit
le catalogue déjà validé au démarrage et rend du HTML ; la seule écriture
possible est déclenchée par un clic. `?offer=<id>` **repose** le choix d'une
personne revenue de la connexion — carte en évidence, focus sur son
déclencheur — et n'ouvre **jamais** le tunnel : un lien forgé créerait sinon une
session de paiement au nom d'un tiers connecté. Le paramètre est validé par Zod
puis confronté au catalogue (`selectedOfferOf`, `domain/pricing.ts`) ; inconnu,
il est ignoré sans erreur.

**Le focus tient par deux mécanismes différents, et la revue de s22 a mesuré
pourquoi.** L'attribut `autofocus` que React rend dans le document servi est
appliqué par le navigateur à l'analyse : cela suffit au **lien** du visiteur
anonyme, cela ne fait rien du **bouton** du visiteur connecté, qui est désactivé
jusqu'à l'hydratation — et rien ne reposait le focus au rallumage
(`document.activeElement` restait `BODY`). Le déclencheur de l'application pose
donc lui-même son focus après l'hydratation
(`apps/web/app/use-focus-when-ready.ts`). La commande qui rougit si l'une des
deux branches cesse de fonctionner est `pnpm test:e2e` — « rend le focus au
bouton de l'offre reposée », `e2e/billing.spec.ts`, mesuré sur Chromium. Aucun
test de nœud ne peut voir un focus : ne pas en écrire un.

Deux conséquences à ne pas défaire :

- **le catalogue n'est ni trié ni copié** par l'écran. `billingCatalogue()` le
  mémorise pour tout le processus : le muter pour un affichage empoisonnerait
  aussi le checkout ;
- **le prix affiché et l'identifiant emporté viennent de la même offre**. C'est
  le second critère de s22, et il est mesurable ; ce qui ne l'est pas, et qu'il
  faut savoir, c'est la divergence entre `amount` et le prix réel chez le
  fournisseur — les deux valeurs locales sont cohérentes entre elles et fausses
  ensemble. Cette divergence-là relève du régime « clés de test réelles hors
  CI ».

**Aucune division mensuelle d'une offre annuelle.** `periodicityKeyOf` rend
« par mois », « par an » ou « paiement unique », et rien d'autre : afficher
« 24,17 €/mois » sous un prélèvement unique de 290 € par an est une affirmation
que personne ne valide. La recherche de s22 avait laissé la question ouverte ;
le plan l'a tranchée.

**La mise en avant est dérivée, jamais déclarée.** `config/billing.ts` ne porte
aucun champ `featured` — en ajouter un obligerait chaque projet à le
renseigner : `highlightedOfferId` désigne la **dernière offre d'abonnement**, et
`null` quand le catalogue n'en vend pas.

**Ce module dit quelles offres un périmètre détient, jamais ce qu'elles
ouvrent** (s21, ADR 043). `entitledOffers` est toute sa part du gating : la
correspondance offre → fonctionnalité vit dans `config/gating.ts`, et la règle
dans `@repo/core`, parce qu'elle doit répondre **module coupé**. Deux
conséquences à ne pas défaire : `entitledOffers` ne consulte **aucune
permission** — `canManage` dit qui a le droit de *gérer* la facturation, pas qui
a le droit d'*utiliser* ce que le périmètre paie, et confondre les deux ferait
payer une organisation pour une seule personne —, et `entitledOfferIds` lit
**tous** les abonnements qui donnent l'accès, pas `currentSubscriptionOf`, qui
désigne celui que l'écran affiche.

**Le portail suit l'abonnement.** `canOpenPortal` est vrai s'il existe au moins
un abonnement en cache, pas dès qu'il existe un client : ce que le portail sert
— moyen de paiement, changement d'offre, résiliation — n'existe pas pour un
achat unique. L'historique des paiements est servi par l'application depuis son
cache ; les factures sont émises par le fournisseur, `invoice_creation` étant
posé sur les sessions en mode paiement. **Aucun lien vers une facture n'est
rendu par l'écran**, et ce n'est pas un oubli : il faudrait stocker une URL
signée au repos ou appeler le réseau à chaque affichage.

**Le catalogue se ferme à qui a déjà l'accès**, et la garde est côté serveur :
`openCheckout` refuse en `409` (`already_subscribed`) quand `grantsAccess` est
vrai pour le périmètre, et l'écran retire *tous* ses boutons — pas seulement
celui de l'offre en cours. La raison est chez le fournisseur :
`checkout.sessions.create({ mode: 'subscription' })` crée **toujours** un
abonnement de plus, le SDK n'offrant aucun paramètre de remplacement. Un abonné
qui cliquait la seconde offre était donc prélevé deux fois, et l'écran — qui
n'affiche que son abonnement courant — ne montrait pas le second. Changer d'offre
passe par le **portail**, ce que le sixième critère de la story dit déjà.

## Le périmètre invité (s24, ADR 047)

**`scope_kind` porte trois valeurs, `ModuleScope` en garde deux.** `user`,
`organization` — et `guest`, qui n'existe **qu'au stockage**. `billing_customer`
ne porte aucune clé étrangère (ADR 018) : deux colonnes de texte suffisent à
représenter un visiteur qui paie sans compte. Ajouter un troisième cas à
`ModuleScope` (`packages/core/src/module.ts`) obligerait à rouvrir **chaque**
module écrit, pour un périmètre qui n'a ni donnée à exporter ni donnée à purger.

**La ligne est écrite à l'ouverture du tunnel, comme toutes les autres**
(ADR 034). Le webhook ne la crée pas : il la **promeut**. C'est ce qui préserve
intacte la garantie d'ordre — `provider_customer_id` ne change jamais, donc tout
événement continue d'y résoudre son propriétaire, quel que soit son ordre
d'arrivée, et il n'y a toujours pas de tampon d'événements orphelins.

**Trois gardes, et chacune ferme un défaut différent :**

| Garde | Où | Ce qu'elle ferme |
|---|---|---|
| `accountScopeOfCustomer` rend `null` pour un invité | `domain/guest.ts` | une ligne invitée reconstruite en `user:<jeton>` — un compte que personne n'a créé, passé au compteur de sièges par `pnpm billing:reconcile` |
| `isGuestScopeKind` avant de produire une promotion | `application/billing-use-cases.ts` | un second `checkout.session.completed` sur le même client, avec une autre adresse, qui repointerait vers un autre compte la ligne d'une personne déjà promue |
| `where scope_kind = 'guest'` dans la mise à jour | `infrastructure/drizzle-billing-repositories.ts` | la **même** prise de contrôle, quand deux livraisons simultanées passent toutes les deux la garde applicative — celle-ci lit puis écrit, celle-là décide en base |

La troisième porte aussi un `not exists` : un visiteur qui paie deux fois sans se
connecter produit deux lignes invitées, et promouvoir la seconde vers le même
compte dépasserait l'index `(scope_kind, scope_id)`. La clause laisse la seconde
ligne invitée plutôt que de faire lever le webhook — un 400 que le fournisseur
rejouerait indéfiniment (`docs/reliability.md` §1).

**Une requête qui sert un compte ne rend jamais une ligne invitée.**
`customerForScope` filtre sur les deux colonnes, donc un périmètre `user:` ou
`organization:` ne peut pas atteindre une ligne `guest`. Toute lecture ajoutée
ici doit garder cette propriété : l'unicité de la base ne l'attrapera pas.

**L'identifiant invité est un tirage cryptographique** — trente-deux octets,
`infrastructure/guest-scope-id.ts`. Il est écrit avant tout paiement, dans une
ligne que le webhook retrouvera : prévisible, il permettrait de viser la ligne
d'un autre. Il est **distinct de `generateId`**, que les suites remplacent
volontiers par un compteur, et `tests/billing.test.ts` mesure le générateur
réellement livré — deux tirages doivent différer sur la majorité de leurs
positions.

**Ce qu'un paiement abandonné laisse, et que rien ne nettoie** : une ligne
`billing_customer` invitée, orpheline. Ce n'est ni un compte ni un droit
d'accès, donc le cinquième critère de la story est tenu — mais aucun périmètre
ne la nomme, donc aucune purge ne peut l'atteindre. La catégorie
`guest-checkout` est déclarée au contrat avec sa politique, et le commentaire de
`module.ts` dit exactement ce que cette politique recouvre et ce qu'elle ne
recouvre pas. **N'écrivez pas de commande de nettoyage** : l'`eject` est au
cimetière du PRD.

**La route publique est limitée en débit**, en base, donc partagée entre
instances (`docs/security.md` §7). **Deux seaux, et ils ne disent pas la même
chose** (constat F3 de la revue) :

| Seau | Clé | Ce qu'il fait quand il est plein |
|---|---|---|
| l'appelant | le premier maillon de `x-forwarded-for` — une valeur que le client écrit | **refuse** (429) |
| global | aucune clé : une ligne pour toute la route | **dégrade** — le tunnel n'est pas ouvert, le visiteur repart par la connexion, avec son offre en poche |

La première rédaction n'avait que le premier seau, et affirmait qu'il n'y avait
rien à dégrader. C'était faux : la dégradation disponible est **le comportement
d'avant s24** — le déclencheur anonyme menait à `/sign-in`. Sans le second seau,
qui fait tourner l'en-tête obtient une croissance **définitive** de
`billing_customer` (rien ne l'efface, voir ci-dessus) et une consommation
illimitée du budget d'appels du marchand : chaque ouverture crée un client et
une session chez le fournisseur, avec une clé d'idempotence tirée au hasard qui
ne converge jamais.

Trois propriétés que le second seau ne doit pas perdre, et chacune a son cas
dans `tests/billing.test.ts` : le canal de vente reste ouvert, le **chemin
authentifié** n'est pas touché, et les martèlements **refusés** ne comptent pas
dedans — sinon un seul appelant enverrait tout le monde à la connexion. Où mène
la porte est décidé par le point de composition (`guestFallbackUrl`,
`apps/web/lib/billing.ts`) : ce module ne connaît pas `auth`. Le raisonnement
complet est dans `domain/checkout-throttle.ts`.

**Depuis s28, le compteur n'est plus le sien** (ADR 050).
`billing_checkout_throttle` **n'est plus écrite** : ce module compte à travers le
port partagé (`infrastructure/shared-checkout-throttle.ts`), et le répartiteur
limite en plus la route publique par la politique `guestCheckout` de
`config/security.ts`. La **règle** ci-dessus reste ici, parce que sa dégradation
— repartir par la connexion plutôt que refuser — n'est pas exprimable par un
répartiteur qui ne connaît que « autorisé » et « 429 ».

Le commentaire du schéma disait que s28 « devra la supprimer » : **ce n'est pas
ce qui a été fait**, et c'est délibéré. `docs/reliability.md` impose de cesser
d'écrire avant de supprimer, et s27 a mesuré qu'un déploiement compose détruit le
conteneur en service avant de migrer — la version encore en ligne écrit toujours
dans l'ancienne table pendant la bascule. La table reste donc déclarée, vide et
inerte ; sa suppression est une story ultérieure, et `tests/rate-limiting.test.ts`
refuse à la fois qu'on la réécrive et qu'on la supprime ici.

**`openCheckout` n'a pas été assoupli.** Le chemin authentifié garde sa garde de
session et sa permission ; l'anonyme a **sa propre entrée**
(`openGuestCheckout`). Affaiblir la première pour servir la seconde mettrait le
chemin authentifié en danger pour un besoin qui n'est pas le sien.

## Imports autorisés

- `@repo/core` pour le contrat de module, `ModuleScope` et le registre ;
- `@repo/ports` pour le port `Payments` — **jamais** `@repo/adapter-stripe` : le
  module ignore qui l'implémente, et c'est ce qui rend le mode local possible ;
- `@repo/ui` pour **tout** ce qui s'affiche, dans `presentation/` uniquement ;
- `lucide-react` pour les icônes ;
- `drizzle-orm` dans `schema.ts` et `infrastructure/` uniquement ;
- `zod` pour valider les frontières — la configuration des offres (`domain/`) et
  le corps des routes (`presentation/`) ;
- `react` (pair) pour les composants de `presentation/` ;
- `@repo/typescript-config`, `@types/node`, `@types/react`, `typescript`,
  `vitest` pour l'outillage.

**Jamais `@repo/db`** (ADR 020) : la connexion arrive par le point de
composition. **Jamais `@repo/module-organizations` ni `@repo/module-auth`** : la
permission, le nombre de sièges et l'adresse arrivent en fonctions injectées.
**Jamais `stripe`** : un seul package du dépôt importe ce SDK, et c'est
`packages/adapters/stripe`.

## Ne doit jamais contenir

- de **prix, de montant, de devise ou de mode lus d'une requête** : le
  navigateur envoie un identifiant d'offre, et rien d'autre — `mode: 'payment'`
  est résolu du catalogue, jamais reçu ;
- de **quantité reçue du client** : les sièges sont résolus côté serveur, et
  `syncSeats` reçoit une **cible**, jamais un delta ;
- d'appel `fetch` : `eslint.config.ts` le refuse, et le port porte déjà le délai
  d'attente et les reprises ;
- de comparaison de rôle : la matrice s'écrit une fois, dans
  `packages/modules/organizations/src/domain/permissions.ts` ;
- de secret, de clé, d'URL de session ni d'identifiant de client dans une
  réponse d'erreur : les routes rendent une **clé de catalogue**, jamais une
  phrase ni un détail du fournisseur ;
- de vérification préalable en guise d'idempotence : c'est une contrainte
  d'unicité qui décide, dans la même transaction que l'effet ;
- de branche `if (module organizations activé)` : la forme est la même dans les
  deux configurations.

## Tests

- `src/domain/pricing.test.ts` — les deux règles pures de la page de tarifs
  (s22) : l'offre mise en avant et la périodicité affichée. Un second fichier
  dans `domain/`, et c'est assumé : il éprouve une unité que
  `billing-rules.test.ts` ne couvre pas, et la présentation ne les rejoue pas ;
- `src/domain/billing-rules.test.ts` — les règles pures : le catalogue d'offres,
  l'accès, l'état affiché, l'ordre d'application, le prix formaté, **ce qu'un
  achat donne, ce qu'un remboursement révoque et l'accès consolidé**. Un seul
  fichier pour les trois unités du `domain` : le coût d'une suite est dominé par
  le fichier, pas par l'assertion ;
- `tests/billing.test.ts` (racine) — ce qui n'existe qu'assemblé : les routes à
  travers le répartiteur, contre une vraie base, avec le **vrai** adaptateur
  Stripe dont seul le réseau est doublé.

**Ce qui a été prouvé par mutation** (le compte est le nombre de cas passés au
rouge) :

| Mutation | Rouges |
|---|---|
| retirer la garde d'idempotence du journal | 1 |
| retirer le prédicat d'ordre (`setWhere`) | 1 |
| écrire avant que la signature soit acceptée | 2 |
| retirer la garde de permission du checkout | 1 |
| relâcher le schéma strict du corps (`z.object`) | 2 |
| ne plus rattacher le client à l'ouverture du checkout | 10 |
| faire réécrire la réconciliation à chaque passage | 1 |
| accorder l'accès à un abonnement annulé après sa période | 1 |
| inverser la comparaison d'horodatage | 1 |
| retirer « annulé » de l'état affiché « expiré » | 1 |
| retirer la garde des identifiants d'offre en double | 1 |
| retirer la garde des prix en double | 1 |
| retirer la règle « un abonnement a une périodicité » | 1 |

**Tour de correction (revue, constats F1 à F8)** — mêmes règles, mêmes comptes :

| Mutation | Rouges |
|---|---|
| retirer l'ordre de lecture des abonnements d'un client | 1 |
| faire préférer le plus récent à celui qui donne l'accès | 2 |
| ne plus valider le catalogue au démarrage | 2 |
| `apps/web/lib/billing-permission.ts` (la **règle**) → `return true` | 1 |
| `customerEmail` du **module** → `null` | 1 |
| reproposer « Souscrire » sur l'offre en cours | 1 |
| terminer un checkout local sans vérifier le périmètre | 1 |
| ne lire qu'une page d'abonnements à la réconciliation | 1 |
| répartir `registry.webhooks` depuis `apps/web` | 1 |

**Second tour de correction (constats C1, M1 à M3, m1 à m3)** — les deux
premières lignes remplacent celles du tableau ci-dessus qui les nommaient mal :
elles y étaient portées à « 1 rouge » alors que la mutation comptée était posée
dans la règle voisine et dans le module, non au **point de composition** où
vivait le défaut. Reposées là, elles laissaient 1 320 cas sur 1 320 au vert.

| Mutation | Rouges |
|---|---|
| `apps/web/lib/billing.ts#canManage` → `async () => true` | 1 |
| `apps/web/lib/billing.ts#emailOfScope` → `null` | 1 |
| retirer `PAYMENTS_LOCAL_MODE` de `.github/workflows/ci.yml` | 1 |
| retirer `PAYMENTS_LOCAL_MODE` de `playwright.config.ts` | 1 |
| retirer le refus `already_subscribed` d'`openCheckout` | 1 |
| rendre les boutons du catalogue à l'offre en cours seule | 3 |
| recréer l'index en `DESC NULLS LAST` (mutation en base) | 1 |
| appeler un gestionnaire de webhook depuis `packages/core/src/registry.ts` | 1 |

**s20 — l'achat unique** — mêmes règles, mêmes comptes :

| Mutation | Rouges |
|---|---|
| `grantsBillingAccess` ne lit plus que l'abonnement | 3 |
| accepter `payment_status: 'unpaid'` comme un paiement encaissé | 1 |
| retirer l'unicité `(billing_customer_id, offer_id)` (mutation en base) | 13 |
| retirer le prédicat d'ordre de l'écriture d'achat | 1 |
| retirer le refus `already_purchased` | 1 |
| faire regarder les achats à la garde d'abonnement | 1 |
| faire réécrire la réconciliation d'achats à chaque passage | 1 |
| rendre `payment_status: 'unpaid'` dans la session simulée | 1 |
| rendre le bouton du portail sur la seule existence d'un client | 1 |
| fermer le catalogue d'abonnements sur l'accès **consolidé** | 1 |
| rendre l'identifiant d'une offre retirée du catalogue dans l'historique | 1 |

**Tour de correction de s20 (constats C1, C2, m1, m2)** — mêmes règles, mêmes
comptes. Chaque mutation est posée à l'endroit du défaut, pas à côté :

| Mutation | Rouges |
|---|---|
| retrouver l'achat par la colonne **à la confirmation** | 2 |
| ne pas rejouer, à la promotion, un remboursement déjà reçu | 1 |
| ne pas remettre à zéro le cycle précédent à la réouverture d'un achat | 1 |
| « charge introuvable » traduit en « rien n'a été remboursé » | 2 |
| « session impayée » traduit en « achat en attente » | 2 |

Les deux dernières valent 2 parce que la règle est prouvée **où elle vit** (un
cas de `domain/billing-rules.test.ts`) et **qu'elle est appliquée** (un cas
d'assemblage de `tests/billing.test.ts`).

La première ligne portait « 1 » et en vaut **2**, remesurés : le second cas est
« ne rétrograde pas un achat payé à cause de la session abandonnée du même
achat ». Un compte écrit à la main est une affirmation que rien ne vérifie ; les
comptes de ce fichier sont ceux d'une exécution datée, pas une propriété du code.

**Troisième tour de correction (constats C3, C4, m6, m7, m9)** — mêmes règles,
mêmes comptes, chaque mutation posée au site du défaut. Mesurés le 2 septembre
2026 par `pnpm vitest run tests/billing.test.ts packages/modules/billing/src/domain/billing-rules.test.ts`
(149 cas verts sans mutation) :

| Mutation | Rouges |
|---|---|
| retirer le repli sur la colonne pendant la bascule (`purchaseOfSession`) | 2 |
| retrouver l'achat par la colonne **dans la réconciliation** | 2 |
| ne pas consulter le journal des remboursements à la réconciliation | 1 |
| retirer « un achat tranché une fois par passage » de la réconciliation | 1 |
| retirer `purchase` de `dataCategories` et de `retention` | 1 |

Les deux premières se répondent : la seconde ne rougissait **rien** avant ce
tour, alors que l'ADR et ce fichier affirmaient déjà les deux moitiés de l'index
inverse.

**Mesuré et non reproduit** : le constat m5 de la revue — « aucune commande ne
relie une offre du catalogue à ses traductions » — ne tient pas. Une offre
ajoutée à `config/billing.ts` sans ses quatre entrées `fr`/`en` fait rougir
« les traductions du module › livre le nom et la description de chaque offre
déclarée, dans chaque langue », qui itère `billingOffers` lu de `config/billing.ts`.
La revue n'avait balayé que `tests/i18n.test.ts`, qui ne voit effectivement pas
les clés composées. Aucun code n'a donc été changé pour m5.

**s21 — l'essai et le droit nommé par offre** — mêmes règles, mêmes comptes.
Mesurés le 2 septembre 2026 par
`pnpm vitest run tests/billing.test.ts packages/modules/billing/src/domain/billing-rules.test.ts`
(185 cas verts sans mutation) :

| Mutation | Rouges |
|---|---|
| retirer la date d'un essai dans `grantsAccess` (il n'expire plus) | 5 |
| `trialDaysFor` rend toujours les jours de l'offre | 4 |
| `entitledOfferIds` n'exige plus que l'abonnement donne l'accès | 5 |
| envoyer `offer.trialDays` au fournisseur sans passer par `trialDaysFor` | 2 |
| `entitledOffers` ne lit plus les achats uniques | 1 |
| `replaceSubscriptions` écrit `trialEnd: null` (la réconciliation perd l'essai) | 1 |

Les trois dernières sont posées **au point de composition du module** — dans
`openCheckout`, dans le cas d'usage, et dans l'écriture de la réconciliation —,
pas dans le `domain` : c'est là que vivrait le défaut, et les deux premières
lignes ne les couvrent pas.

La dernière est celle qui manquait : « la réconciliation rétablit la mémoire
d'essai » était écrite dans l'ADR 044 et dans ce fichier sans qu'aucune commande
ne la rejoue (constat m4 de la revue). Le cas « retrouve la mémoire d'essai par
la réconciliation, cache perdu » efface les lignes en cache, observe que l'essai
redevient disponible, réconcilie, et observe qu'il se referme.

La mutation à 13 rouges est **grossière** et il faut la lire comme telle :
retirer l'unicité casse aussi la cible de conflit de l'écriture. Les deux cas
qui nomment l'invariant sont « converge sur une seule ligne quand deux
ouvertures partent en même temps » et « refuse **par le moteur** une seconde
ligne pour la même offre ».

Ces comptes sont ceux des cas passés au rouge, sur les mutations **posées** —
pas un inventaire de ce qui est couvert.

**s22 — la page publique de tarifs** — mêmes règles, mêmes comptes. Mesurés le
3 septembre 2026, chaque mutation posée au site où vivrait le défaut :

| Mutation | Rouges | Commande |
|---|---|---|
| l'entrée de navigation des tarifs passe `authenticated` | 1 | `vitest run tests/billing.test.ts -t 'entrée de navigation des tarifs'` (2 verts) |
| la mise en avant ignore le mode de l'offre | 2 | `vitest run packages/modules/billing/src/domain/pricing.test.ts` (5 verts) |
| l'achat unique s'affiche « par mois » | 1 | idem |
| retirer `notFound()` sur `billing.available` | 1 | `vitest run tests/billing.test.ts -t 'la page publique de tarifs'` (9 verts) |
| le lien de connexion rendu **aussi** à qui a une session | 1 | idem |
| le déclencheur de checkout rendu **aussi** à un anonyme | 1 | idem |
| le montant affiché remplacé par une constante, **dans le composant** | 1 | idem |
| le montant affiché remplacé par une constante, **dans la page** | 2 | idem |
| la carte affiche le prix de l'offre voisine | 2 | idem |
| le bouton emporte toujours la première offre | 3 | idem |
| `?offer=` n'est plus reposé du tout (sélection toujours nulle) | 1 | idem |

Reprise après revue, mesurée le 3 septembre 2026 (suite entière à 1674 verts,
`pnpm test:e2e` à 13 verts sur `e2e/billing.spec.ts`) :

| Mutation | Rouges | Commande |
|---|---|---|
| **`?offer=` lu sans confrontation au catalogue** (`selectedOfferOf`, `domain/pricing.ts`) | 1 | `pnpm test` (1673 verts) |
| le déclencheur connecté ne repose plus le focus (`ref={focus}` retiré) | 1 | `pnpm test:e2e e2e/billing.spec.ts` (12 verts) |
| le lien anonyme ne repose plus le focus (`autoFocus` retiré) | 1 | idem |
| les prix du catalogue ne sont plus déclarés sur l'écran de tarifs (`screenData`) | 1 | `pnpm test tests/rendered-text.test.ts` |

La première ligne remplace une ligne à **0** : la confrontation au catalogue
vivait dans l'écran, où la neutraliser ne changeait aucun rendu — rien du
document ne consomme un identifiant qui ne désigne aucune carte, et la suite
entière restait verte. Descendue dans le domaine, elle est à son site de défaut
et elle mord. C'est la règle du dépôt appliquée : une mutation verte dit que le
test est faux, pas que le code est bon.

Les deux lignes de focus disent la même chose des **deux branches** de l'écran :
le lien anonyme tient par l'attribut servi, le bouton connecté par le focus posé
après hydratation. Elles ne sont mesurables que dans un navigateur.

Les deux lignes du montant affiché se répondent : celle du **composant** est
celle qui compte, parce que c'est là que le prix est réellement écrit à l'écran.
Une mutation posée seulement dans la page aurait laissé croire à une couverture
qu'un test de props n'aurait pas eue.

**s24 — le tunnel invité**, premier passage, mesuré le 3 septembre 2026
(`pnpm test` à 1745 verts alors, `pnpm test:e2e` à 86 verts, base levée) — les
comptes de la colonne « Commande » sont ceux de ce jour-là, avant les six cas
ajoutés par le second passage :

| Mutation | Rouges | Commande |
|---|---|---|
| retirer `where scope_kind = 'guest'` de la promotion (`infrastructure/`) | 1 | `pnpm vitest run tests/billing.test.ts` (159 verts) |
| retirer `isGuestScopeKind` avant de produire la promotion (`application/`) | 2 | idem (158 verts) |
| passer le compteur de débit en mémoire de processus | 6 | idem (154 verts) |
| la page de retour ouvre une session pour le payeur (`apps/web/app/pricing/page.tsx`) | 1 | idem (159 verts) |
| envoyer un lien de définition de mot de passe à un compte existant (`apps/web/lib/guest-account.ts`) | 1 | idem (159 verts) |
| la résolution de compte ne retrouve plus avant de créer (`accountFor`) | 2 | idem (158 verts) |
| un `scope_id` invité tiré d'un compteur et d'un horodatage | 1 | idem (159 verts) |

**Le second passage** — les filets que la revue a trouvés manquants (constats F1
à F4), mesurés le 3 septembre 2026, `pnpm test` à **1751** verts et
`pnpm test:e2e` à 86 verts :

| Mutation | Rouges | Commande |
|---|---|---|
| le seau **global** ne décide plus rien | 1 | `pnpm vitest run tests/billing.test.ts` (163 verts) |
| le seau global prend l'appelant dans sa clé — donc contournable par l'en-tête | 1 | idem |
| les martèlements **refusés** comptent dans le seau global | 1 | idem |
| la branche de promotion réduite à `checkout_completed` — le **paiement unique** perd son filet | 1 | idem |
| `if (applied && promoted !== null)` ramené à `if (promoted !== null)` | 1 | idem |
| `await users.markEmailVerified(userId)` supprimé (`packages/modules/auth`) | 1 | `pnpm vitest run tests/auth.test.ts` (102 verts) |

Les deux dernières étaient **vertes** au premier passage, et elles disaient
quelque chose : la première parce que l'inertie du rejeu est portée par
`isGuestScopeKind` **dans le cas courant**, mais pas dans celui d'une promotion
que le `not exists` a bloquée — un rejeu y reproduit une promotion non nulle, et
`applied` est alors la **seule** barrière ; la seconde parce que rien ne jouait
la ligne la plus sensible du diff.

**Une mutation verte reste, et elle est nommée là où elle vit** : déplacer le
`return false` du journal **après** la promotion ne fait rougir aucun cas.
L'idempotence de la promotion est une propriété du **stockage** (les deux gardes
de l'écriture, prouvées rouges ci-dessus), pas de l'ordre des instructions. Le
commentaire d'`applyEvent` porte le constat et la condition qui le rendrait
faux — un effet non idempotent entrant dans cette transaction.
