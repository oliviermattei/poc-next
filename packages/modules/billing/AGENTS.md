# packages/modules/billing — règles locales

Le module de facturation (s19, s20). Il possède les offres, les abonnements,
**les achats uniques** et le webhook entrant du fournisseur de paiement. Il ne
possède **ni** la page de tarifs publique (s22), **ni** le gating par offre
(s21), **ni** les métriques de revenus (s38).

## Ce qu'il faut savoir avant d'y toucher

**Ces tables sont un cache reconstructible, pas la vérité** (ADR 034). La vérité
est chez le fournisseur ; `pnpm billing:reconcile` réécrit le cache depuis lui.
Aucune règle ne doit supposer qu'une colonne est à jour — `grantsAccess` prévoit
explicitement le retard d'un webhook.

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
- de **quantité reçue du client** : les sièges sont résolus côté serveur ;
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

La mutation à 13 rouges est **grossière** et il faut la lire comme telle :
retirer l'unicité casse aussi la cible de conflit de l'écriture. Les deux cas
qui nomment l'invariant sont « converge sur une seule ligne quand deux
ouvertures partent en même temps » et « refuse **par le moteur** une seconde
ligne pour la même offre ».

Ces comptes sont ceux des cas passés au rouge, sur les mutations **posées** —
pas un inventaire de ce qui est couvert.
