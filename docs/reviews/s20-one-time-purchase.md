# Revue — s20-one-time-purchase

Branche `feature/s20-one-time-purchase`, commit unique `22b560c`, diff
`git diff dev...feature/s20-one-time-purchase`. Base `s20`. Revue exécutée dans
le worktree, arbre restauré et vérifié propre (`git diff --exit-code`, `git
status --porcelain` vides) avant l'écriture de cette ligne.

## Ce qui a été exécuté

| Commande | Module activé | Module coupé |
|---|---|---|
| `pnpm typecheck` | vert | vert |
| `pnpm lint` | vert (`No issues found`) | vert |
| `pnpm test` | 1468/1474 au premier passage, puis 1466 + 2 rouges de minutage (voir m2) | idem |
| `pnpm build --force` | vert | vert |
| `E2E_PORT=3120 pnpm test:e2e` | 71 passés / 3 rouges hors facturation (voir m3) ; `e2e/billing.spec.ts` seul : 7/7, dont le parcours s20 | `e2e/billing.spec.ts` : 404 attendu, 1 passé / 7 sautés |
| `pnpm db:migrate` | rejouée sur base neuve `s20_review` : `billing (4)` puis « Rien à appliquer » | — |
| `pnpm ks toggle billing` ×2 | régénère à l'identique, arbre propre après aller-retour | — |

Migration `0003_tough_shriek.sql` relue : **purement additive** (une table, une
clé étrangère interne au module, trois unicités, un index). Aucune colonne
supprimée, aucune table existante modifiée.

## Mutations posées, chacune à l'endroit du défaut

| Mutation | Fichier muté | Rouges |
|---|---|---|
| refus `already_purchased` neutralisé | `application/billing-use-cases.ts` | **1** (« refuse un second achat de la même offre ») |
| unicité `(billing_customer_id, offer_id)` supprimée **en base** | index PostgreSQL | **14** (grossière : casse aussi la cible de conflit) |
| `grantsBillingAccess` ne lit plus que l'abonnement | `domain/purchase.ts` | **6** (3 de domaine, 3 d'assemblage) |
| `payment_status` ignoré (`unpaid` accepté) | `adapters/stripe/src/stripe-payments.ts` | **1** |
| prédicat d'ordre de l'écriture d'achat retiré | `infrastructure/drizzle-billing-repositories.ts` | **1** |
| `canOpenPortal` rendu sur l'existence d'un client | `application/billing-use-cases.ts` | **1** |
| réconciliation d'achats réécrit à chaque passage | `infrastructure/drizzle-billing-repositories.ts` | **1** |
| achats `pending` affichés dans l'historique | `application/billing-use-cases.ts` | **1** |

Les comptes annoncés dans `packages/modules/billing/AGENTS.md` sont donc
reproduits, et l'aveu de grossièreté sur la mutation à 13 (14 ici) est exact.

**Une mutation verte, et c'est elle qui a ouvert le constat C1 :** remplacer
l'`onConflictDoUpdate` d'`openPurchase` par un `onConflictDoNothing` sur la même
cible laisse **77/77** cas de `tests/billing.test.ts` au vert, et 1466/1474 sur
la suite entière — exactement le compte de l'arbre non muté. Aucun cas ne fixe
donc **quel identifiant de session** la ligne porte après une seconde ouverture,
alors que l'ADR 038 revendique en toutes lettres qu'« un achat abandonné puis
repris, ou remboursé puis racheté, réutilise la ligne ».

## Constats

### C1 — critique — une session de checkout supplantée reste payable, et son paiement n'accorde rien

`openCheckout` écrit la ligne d'attente en `on conflict do update`, et le `set`
**remplace `provider_session_id` par celui de la nouvelle session**
(`drizzle-billing-repositories.ts`, `openPurchase`). Rien n'expire la session
précédente chez le fournisseur : aucun appel `checkout.sessions.expire`, aucun
`expires_at` posé (vérifié par balayage de `packages/adapters/stripe/src/stripe-payments.ts`).
Une session de checkout Stripe reste payable après son ouverture.

Suite des faits, tous lus dans le code livré :

1. l'utilisateur ouvre l'achat (session `S1`), revient en arrière — le bouton se
   réarme, `pending` est enregistré, `already_purchased` ne refuse pas —, et
   rouvre : la ligne porte désormais `S2` ;
2. il paie **`S1`**. `purchase_paid` écrit
   `where provider_session_id = 'S1' …` → **zéro ligne**. Le comportement est
   d'ailleurs déjà prouvé, à l'envers, par le cas existant « n'écrit rien pour
   une session qu'il n'a pas ouverte » ;
3. l'écran n'affiche rien, `hasAccess` reste faux : **le paiement encaissé
   n'accorde aucun droit** — le deuxième critère de la story tombe ;
4. `pnpm billing:reconcile` ne répare pas : `reconcilePurchases` ne retrouve une
   ligne que par `(billing_customer_id, provider_session_id)`, et `S1` n'est
   plus stockée nulle part. `S2`, elle, est lue `paid: false` → `pending`, égale
   à ce qui est stocké → aucun changement. La divergence est **irrattrapable par
   la commande de réconciliation**, ce que `docs/reliability.md` §5 interdit ;
5. l'utilisateur, ne voyant rien, rachète : `already_purchased` ne refuse
   toujours pas (la ligne n'est pas `paid`), une session `S3` part, il est
   **prélevé une seconde fois pour la même offre**.

C'est l'invariant central de la story pris à revers : la contrainte d'unicité
tient bien « une ligne par (client, offre) », mais elle ne tient ni le nombre de
prélèvements, ni le rattachement du prélèvement effectif. Le déplacement décidé
par l'ADR 038 §1 — écrire avant l'URL — crée cette fenêtre : l'écriture est
faite **avant** de savoir quelle session sera payée, et la dernière ouverture
écrase la clé de rattachement des précédentes.

Deux socles non négociables sont touchés : `docs/reliability.md` §5 (« toute
divergence possible avec un système externe possède une commande de
réconciliation ») et le critère 2 de la story. Aucun cas ne couvre ce chemin —
la mutation verte ci-dessus le démontre.

Deux directions possibles (non prescriptives) : ne jamais réécrire
`provider_session_id` sur une ligne encore `pending` mais expirer l'ancienne
session chez le fournisseur avant d'en ouvrir une autre ; ou dissocier l'acte
d'achat de la ligne d'offre — une ligne de session par ouverture, l'unicité
portant sur les seules lignes payées — ce qui rouvre l'arbitrage de l'ADR 038 §2
et devra donc passer par un ADR.

### C2 — majeur — un remboursement livré avant sa confirmation est perdu, et la garde censée le couvrir ne peut pas se déclencher

L'effet `purchase_refunded` retrouve la ligne par
`eq(provider_payment_id, …)`. Or une ligne ouverte par `openPurchase` a
`provider_payment_id` **NULL** : le paiement n'est écrit qu'à la promotion. Un
`charge.refunded` arrivé avant le `checkout.session.completed` correspondant —
réordonnancement que l'ADR 034 déclare possible et que les reprises de livraison
du fournisseur produisent — ne trouve **aucune** ligne, est journalisé (donc
jamais rejoué), et la confirmation ultérieure pose `status = 'paid'` : l'accès
est accordé pour un achat intégralement remboursé.

Le commentaire de l'écriture affirme le contraire :

> `ne(status, 'refunded')` : un remboursement livré avant sa confirmation — le
> désordre que l'ADR 034 décrit — ne doit pas être annulé par elle.

Cette garde ne peut pas se déclencher dans le cas qu'elle nomme, puisque le
remboursement n'a jamais pu marquer la ligne. `AGENTS.md` racine : une règle qui
n'est vérifiée par aucune commande est de la documentation ; ici elle est en
plus fausse pour le cas cité. La réconciliation rattrape — si quelqu'un la
lance. Aucun cas ne couvre cet ordre d'arrivée.

### m1 — mineur — la réconciliation peut ré-accorder un achat remboursé

`listPurchases` rend `chargedAmount: null` et `amountRefunded: 0` lorsqu'aucune
charge ne correspond (cas explicitement testé : « rend zéro remboursement quand
aucune charge ne correspond »). `reconciledStatus` traduit alors « charge
inconnue » en **« rien n'a été remboursé »**, donc `paid`. Une ligne `refunded`
dont la charge n'est pas retrouvée — au-delà du plafond de 100 pages × 100
charges, ou en mode local où `chargedAmount` est toujours `null` — est réécrite
en `paid` et l'accès revient. « La réconciliation n'efface jamais » est tenu ;
« elle ne ré-accorde jamais » ne l'est pas, et aucun cas ne l'exige. La
portée en production est étroite (10 000 charges pour un même client) ; la
dissymétrie « inconnu = non remboursé » reste à écrire ou à corriger.

### m2 — mineur — rachat après remboursement : `refunded_at` reste sur la ligne repayée

`openPurchase` ne réinitialise que `provider_session_id`, `price_id` et
`status` ; `refunded_at` (et `provider_payment_id`, jusqu'à la promotion)
survivent. Après « payé → remboursé → racheté → payé », `export` rend un achat
`paid` portant une date de remboursement. L'écran n'en montre rien (il lit
`status`), le droit est correct ; c'est l'export RGPD qui ment. Aucun cas ne
couvre le rachat après remboursement de bout en bout — le cas de remboursement
s'arrête à `owned === false`.

### m3 — mineur — `tests/rendered-text.test.ts` est au bord du délai par défaut

Sur cette machine, ce cas échoue en `Test timed out in 5000ms` **3 passages sur
4**, seul comme dans la suite complète. Mesuré : il échoue aussi **après avoir
retiré l'écran ajouté par s20** — la cause n'est donc pas cette story. Mais
aucun `testTimeout` n'est déclaré nulle part (`vitest.config.ts` n'en contient
pas), s20 y ajoute un quatrième rendu, et s36 — déjà sur `dev` — y en ajoute
d'autres (56 lignes). La marge se referme à chaque story sur le cas le plus cher
de la suite.

### m4 — mineur — `pnpm test:e2e` complet est instable, hors facturation

Deux passages complets, deux jeux de rouges différents : `app-shell.spec.ts` ×3
au premier (`signUp` qui n'attend pas son bandeau), `marketing.spec.ts` ×1 au
second. Chaque fichier repasse au vert exécuté seul. Rien de s20 : `billing.spec.ts`
est vert isolé (7/7) comme dans les passages complets.

### m5 — mineur — aucune commande ne relie une offre du catalogue à ses traductions

`offerNameKey(offer.id)` et `offerDescriptionKey(offer.id)` composent une clé
depuis `config/billing.ts`, et `tests/i18n.test.ts` ne voit pas les clés
composées (le commentaire de `message-keys.ts` le dit lui-même). Ajouter une
offre dans `config/billing.ts` sans ses quatre entrées `fr`/`en` met `/billing`
en 500 — le traducteur lève depuis s09. s20 élargit ce chemin : `config/billing.ts`
est précisément le fichier que le propriétaire édite pour vendre ou ne plus
vendre à l'unité, et la story l'y invite. Les deux appels **existants** sont
correctement gardés par un `null` (achat et abonnement) ; c'est l'ajout d'offre
qui n'est protégé par aucune commande. Constat hérité de s19, pas introduit ici.

## Ce qui a été vérifié et tient

- **Prix, devise, offre et mode ne viennent jamais du client** : corps
  `z.strictObject({ offerId, locale? })`, `mode` résolu du catalogue
  (`offer.mode === 'one_time' ? 'payment' : 'subscription'`), quantité résolue
  côté serveur. Le cas d'ouverture inspecte le corps réellement envoyé au
  fournisseur.
- **Permissions côté serveur**, matrice de s17 réutilisée sans action nouvelle
  (`billing.manage`) ; refus `403` sans appel sortant, mesuré. Aucune route
  n'accepte d'identifiant de périmètre : le 404-plutôt-que-403 ne s'applique pas
  ici, faute de ressource adressable d'autrui.
- **Un achat n'expire pas** : `purchaseGrantsAccess` ne prend aucun instant,
  `grantsBillingAccess` est un `||` strict entre deux sources indépendantes —
  prouvé par mutation (6 rouges) et par les cas « abonnement expiré, achat
  payé » et « abonnement actif, achat remboursé ». Aucun chemin d'expiration
  d'abonnement ne touche `billing_purchase`.
- **Critère 6** : les deux gardes sont disjointes (`existing !== null && offer.mode === 'subscription'`
  d'un côté, `=== 'one_time'` de l'autre), l'écran ferme sur `hasSubscription` et
  `offer.owned`, jamais sur `hasAccess` — mutation « fermer sur l'accès
  consolidé » rouge.
- **Critère 7** : rejeu d'un même événement → `applied: false`, une seule ligne.
  Désordre d'événements de confirmation absorbé par le prédicat d'ordre
  (nullable, `or(isNull, lte)`) — mutation rouge.
- **Critère 4** : `canOpenPortal` suit l'existence d'un abonnement en cache, pas
  celle d'un client — mutation rouge, et le parcours navigateur constate
  l'absence du bouton pour un acheteur pur.
- **Réconciliation rejouée** : deuxième passage à `changed: 0`, mesuré ;
  réordonnancement hors plan de la boucle (achats d'abord, `continue` sur l'échec
  des abonnements) — c'est une amélioration : avant, un échec de lecture des
  abonnements aurait sauté le client entier. Un échec de lecture n'écrit rien.
- **Offre retirée du catalogue** : `purchaseViews` et `export` rendent
  `offerId: null` quand `offerById` ne connaît plus l'identifiant, l'écran rend
  `subscription.unknownOffer` — mutation rouge, et les deux seuls autres sites de
  composition de clé d'offre (`OfferCard`, carte d'abonnement) ont été relus :
  l'un lit le catalogue lui-même, l'autre est déjà gardé par un `null`.
- **Mode local explicite** : inchangé par s20, couvert par des cas nommant les
  trois variables. Mesuré **au-delà** de `✓ Ready` : le refus de configuration
  survient après cette ligne et le serveur ne sert **rien** (HTTP `000` sur
  `/billing` et `/`), comportement observé sur le même mécanisme
  (`next.config.ts`) faute d'avoir pu franchir les gardes de `storage` sans
  toucher à la configuration.
- **ADR** : 018 (aucune clé étrangère hors module), 024 (le baril principal
  n'exporte aucun `.tsx`), 034 et 037 (ordre, cache reconstructible, lecture
  ordonnée totale servie par l'index — `EXPLAIN` sans `Sort`) respectés. ADR 038
  livré avec la story, options rejetées écrites.
- **Cimetière du PRD** : aucun compteur d'usage, aucun second fournisseur,
  aucune commande de suppression de données.
- **Plan** : les onze tâches sont faites. Le seul écart au plan est le
  réordonnancement de `reconcile`, déclaré. Rien dans le diff que le plan n'ait
  demandé.
- **Tests** : aucun cas décoratif relevé — pas d'assertion sur une classe CSS,
  une structure DOM ou un écho de propriété. Les cas d'écran portent sur ce que
  l'écran **décide** (quel bouton, quel badge), pas sur sa mise en page.

## Ce qui n'a pas pu être vérifié

- **Le vrai fournisseur.** Tout ce qui touche Stripe est joué contre une
  doublure de réseau et contre le simulateur local. Ni `mode: 'payment'`, ni
  `invoice_creation: { enabled: true }`, ni `checkout.sessions.list` /
  `charges.list`, ni `checkout.session.async_payment_succeeded`, ni
  `charge.refunded` n'ont touché une clé de test. **Geste humain attendu** :
  `pnpm billing:reconcile` et un achat complet en clés de test avant le ship,
  dont un remboursement total et un remboursement partiel depuis le tableau de
  bord, et la vérification qu'une facture est bien émise et délivrée.
- **Le scénario de C1 en conditions réelles.** Il est établi par lecture du code
  et par une mutation verte, pas par un paiement effectif sur une session
  supplantée. **Geste humain attendu** : en clés de test, ouvrir l'achat, revenir
  en arrière, rouvrir, puis payer la **première** session, et observer l'écran et
  la base.
- **Ce que la fusion avec `dev` exposera.** `git merge-tree` ne rend aucun
  conflit. Mais s36 pose `CONSENT_SCRIPT_PROBE=1` dans `playwright.config.ts` en
  assumant que « la bannière est visible dans tous les parcours tant que le
  consentement n'est pas donné » : le parcours s20 clique un bouton « Acheter »
  situé en bas de `/billing`, sous la bannière. Le parcours d'abonnement de s19
  passe déjà dans cette configuration sur `dev`, donc le risque est faible mais
  non nul. Et `tests/rendered-text.test.ts` recevra les écrans des deux stories
  sous le même délai de 5 s (m3). **Geste humain attendu** : rejouer
  `E2E_PORT=… pnpm test:e2e e2e/billing.spec.ts` et `pnpm test tests/rendered-text.test.ts`
  immédiatement après la fusion.
- **La mise en page.** Le rendu de la carte « Vos achats » n'a été observé que par
  balisage rendu et par les assertions textuelles du parcours Playwright ; aucune
  capture, aucune vérification à 400 px de l'historique à plusieurs lignes.
- **La charge.** Les deux ouvertures « simultanées » du cas de concurrence
  partent d'un `Promise.all` dans un même processus ; rien n'a été joué sur deux
  instances.

Ces listes disent ce qui a été balayé, sur ce périmètre. Elles ne prétendent pas
dire ce qui existe.

Max severity: critical
Ship allowed: no

---

# Seconde revue — delta `22b560c..a28a82d`

Revue **ciblée sur le tour de correction**. Ce que la première revue a validé
n'est pas refait. Arbre restauré et vérifié propre (`git diff --exit-code` vide,
seul ce fichier reste non suivi) avant l'écriture de cette ligne.

## 1. Ce qui a été exécuté, par moi

| Commande | Module activé | Module coupé |
|---|---|---|
| `pnpm typecheck --force` | vert (22/22, `Cached: 0`) | vert (22/22, `Cached: 0`) |
| `pnpm lint` | `No issues found` | `No issues found` |
| `pnpm test` | 1476 passés, 2 rouges de **minutage** (`rendered-text`, `marketing` : « seaux d'une fenêtre close »), verts tous les deux relancés seuls (39/39) | 1476 passés, **0 rouge** |
| `pnpm build --force` | vert | vert |
| `E2E_PORT=3120 pnpm test:e2e e2e/billing.spec.ts` | 7 passés / 1 sauté | 1 passé (404 attendu) / 7 sautés |
| `pnpm db:migrate` sur base neuve | `billing (5)`, puis « Rien à appliquer » | — |
| `pnpm ks toggle billing` ×2 | régénère à l'identique, arbre propre après l'aller-retour | — |

Les deux rouges du passage complet sont des `Test timed out in 5000ms` sur des
cas sans rapport avec la facturation — le constat m3 de la première revue, qui
n'est pas imputable à cette story et que ce tour n'aggrave pas.

**Migration `0004`, jugée.** Purement additive (deux tables, une clé étrangère
interne au module, aucune colonne touchée). Le rattrapage écrit à la main a été
éprouvé sur une base portant **déjà** des achats (`0000`→`0003` appliquées, deux
lignes `billing_purchase`, l'une `pending` l'autre `paid`) : les deux sessions
sont reportées, et le rejeu de l'instruction rend `INSERT 0 0`. Rejouable,
correct. La ligne `delete from billing_refunded_payment` du montage des tests est
un **nettoyage** authentique, jumeau de celui du journal d'événements : sans
elle, la table sans périmètre fuit d'un cas à l'autre (mesuré : **4** rouges,
pas les 5 annoncés — un compte de fuite dépend de l'ordre d'exécution).

## 2. Mutations, chacune posée à l'endroit du défaut

Référence sur `tests/billing.test.ts` + `domain/billing-rules.test.ts` : **143
verts**.

| Mutation | Site | Rouges |
|---|---|---|
| l'achat résolu par `billing_purchase.provider_session_id` au lieu de l'index inverse | `drizzle-…-repositories.ts`, effet `purchase_paid` | **2** |
| le rejeu du remboursement retiré à la promotion | id., même effet | **1** |
| la remise à zéro du cycle précédent retirée | id., `openPurchase` | **1** |
| « charge introuvable » traduit en « rien n'a été remboursé » | `domain/purchase.ts` | **2** |
| « session impayée » traduit en « achat en attente » | id. | **2** |
| **l'achat résolu par la colonne dans la réconciliation** | id., `reconcilePurchases` (jointure) | **0** ⚠ |

Les cinq premières bitent. La sixième est le constat C3 ci-dessous.

## 3. Les deux réfutations, instruites avant la solution

- **« expirer la session précédente chez le fournisseur »** — la réfutation
  tient, et elle est vérifiable : `idempotencyKey` composée en `checkout:<périmètre>:<offre>`
  (`application/billing-use-cases.ts:478`) est bien stable par (périmètre,
  offre), et transmis tel quel à `checkout.sessions.create`
  (`packages/adapters/stripe/src/stripe-payments.ts:452`). Expirer puis rouvrir
  rendrait donc la réponse en cache, c'est-à-dire la session morte.
- **« ne jamais supplanter une session ouverte »** — tient aussi : sans stocker
  l'URL signée (ce que l'ADR 038 §4 refuse déjà pour le reçu), il faut relire la
  session à chaque ouverture. C'est un arbitrage, pas une impossibilité, et il
  est écrit comme tel dans l'ADR.

Aucune des deux ne rend la solution superflue. Elle est en outre **inoffensive**
et bon marché : une table qui n'efface jamais, une résolution par index inverse.
Je la valide. Voir cependant C4 : la clé d'idempotence a une conséquence que
l'ADR ne tire pas, et qui rétrécit la fenêtre que C1 décrivait.

## 4. Constats

### C3 — majeur — la moitié « réconciliation » de l'index inverse n'est prouvée par rien

`billing_purchase_session` est interrogé à **deux** endroits : la confirmation
(`purchaseOfSession`) et la réconciliation (la jointure de
`reconcilePurchases`). L'ADR 038 §1 et `packages/modules/billing/AGENTS.md`
affirment les deux en toutes lettres. Or, en remplaçant la jointure par
`eq(billingPurchase.providerSessionId, write.providerSessionId)` — la faute
exacte que C1 nommait, reposée à ce site-là — **82 cas sur 82 restent verts**.

Le cas « ne rétrograde pas un achat payé à cause de la session abandonnée » ne
l'attrape pas : il passe encore, mais pour une autre raison (le `null` rendu par
`reconciledPurchaseStatus`). Aucun cas n'exige que la réconciliation **retrouve**
un achat par une session supplantée — c'est-à-dire qu'elle répare ce que C1
déclarait irréparable. Le code est juste ; le filet est plus étroit que son nom,
ce que `AGENTS.md` racine range explicitement parmi les défauts à corriger.

Deux comptes du tableau de `packages/modules/billing/AGENTS.md` ne se
reproduisent pas non plus : « retrouver l'achat par la colonne » y vaut 1, j'en
mesure **2** ; la fuite du journal des remboursements y vaut 5, j'en mesure
**4**. Un compte écrit à la main dans un fichier de règles est une affirmation
que rien ne vérifie ; celui-ci recouvre en plus deux sites dont l'un est vert.

### C4 — majeur — la fenêtre de bascule du déploiement rouvre exactement C1

Le rattrapage de `0004` reporte les sessions présentes **à l'instant de la
migration**. Or `docs/reliability.md` (ligne 36) décrit une bascule où la
migration précède le basculement du trafic : pendant cet intervalle, la version
encore en ligne continue d'ouvrir des checkouts en n'écrivant que
`billing_purchase.provider_session_id`. Le nouveau code, lui, ne résout **que**
par l'index inverse — `purchaseOfSession` pour la confirmation, la jointure pour
la réconciliation. Une session ouverte dans cette fenêtre et payée après la
bascule ne retrouve donc aucun achat : paiement encaissé, aucun droit accordé,
aucune réparation par `pnpm billing:reconcile`. C'est C1, mot pour mot, sur la
durée du déploiement qui prétend le refermer.

« Ajouter avant de lire » demande de lire **les deux** emplacements pendant la
transition ; un `or(...)` dans `purchaseOfSession` et une jointure permissive
dans la réconciliation suffisent, et pourront être retirés au tour suivant. En
l'état, la propriété n'est tenue qu'avec un déploiement sans recouvrement de
versions — ce que ce dépôt ne fournit ni ne vérifie.

### m6 — mineur — la réconciliation peut accorder un achat dont le remboursement est journalisé mais non appliqué

C2 est refermé sur le chemin des webhooks, et prouvé (1 rouge). Il ne l'est pas
sur l'autre chemin qui écrit `provider_payment_id` :
`reconcilePurchases` **ne consulte jamais** `billing_refunded_payment` (seuls
sept sites référencent la table, tous dans l'effet `purchase_paid` et l'effet
`purchase_refunded`). Suite : remboursement livré avant sa confirmation
(journalisé, ligne encore `pending`), confirmation jamais délivrée, puis
réconciliation avec une charge introuvable — `chargedAmount: null`, cas
**permanent** en mode local et au-delà du plafond de pagination.
`reconciledPurchaseStatus({stored:'pending', paid:true, chargedAmount:null})`
rend `'paid'` (un cas unitaire l'exige explicitement) : l'accès est accordé sur
un achat intégralement remboursé, et la ligne prend le paiement remboursé. La
dissymétrie choisie est défendable ; ce qui manque est le rejeu du journal, que
la promotion fait déjà, à l'endroit où la réconciliation pose le même paiement.

### m7 — mineur — deux sessions payées pour le même achat : la réconciliation cesse d'être rejouable

La fenêtre laissée ouverte (deux onglets, deux sessions vivantes) autorise deux
prélèvements. Le droit est correct — un `paid` reste `paid` — mais :
`reconcilePurchases` traite les deux lectures, toutes deux `paid`, et
`purchaseDiffers` les départage sur `provider_payment_id`. Chaque passage
réécrit donc alternativement l'un puis l'autre : `changed: 2` **à chaque
exécution**, indéfiniment, là où `docs/reliability.md` §1 exige qu'un second
passage n'ait pas d'effet supplémentaire. Corollaire : rembourser le
prélèvement que la ligne retient à cet instant révoque l'accès alors que l'autre
reste encaissé. Rien n'est écrit sur ce cas, ni dans l'ADR ni dans
`AGENTS.md`.

### m8 — mineur — la prémisse de C1 n'est établie contre aucun fournisseur

La même clé d'idempotence qui fonde la réfutation a une conséquence que l'ADR ne
tire pas : à paramètres identiques et dans la fenêtre d'idempotence du
fournisseur, une seconde ouverture rend **la même** session, pas `S2`. La
séquence « ouvrir `S1`, revenir, rouvrir `S2` », écrite comme un fait dans
l'ADR 038 §1 et dans `AGENTS.md`, suppose donc d'être sorti de cette fenêtre. Les
doublures ne modélisent pas ce rejeu — elles rendent un identifiant neuf à chaque
appel, et `stripe-payments.test.ts` n'assert que **l'en-tête** envoyé —, si bien
que le cas central de ce tour mesure un comportement de fournisseur que rien n'a
vérifié. Corollaire non examiné, hérité du premier commit : `locale` et la
quantité de sièges varient d'un appel à l'autre **sous une clé fixe**, ce qu'un
fournisseur d'idempotence refuse. À vérifier en clés de test avant le ship.

### m9 — mineur — `dataCategories` ne déclare aucune catégorie d'achat

Signalé par l'implémenteur, non corrigé. `dataCategories: ['billing-customer',
'subscription']` alors que le module stocke désormais des achats, que `export`
les rend et que `purge` les efface. La portée est **plus étroite que s16** : la
purge des achats est mesurée (cascade depuis `billing_customer`, cas « efface les
achats avec le périmètre, et l'export les rend »), donc aucune donnée ne survit ;
c'est l'inventaire déclaré qui ment, et aucune commande ne le vérifie —
`retention` n'est contrainte que par ce que `dataCategories` déclare.
`billing_refunded_payment` échappe à la purge comme le journal d'événements :
même nature (identifiants du fournisseur, horodatages), même précédent accepté.

### m10 — mineur — `billing_refunded_payment` croît sans borne et sans relecture

Une ligne est insérée pour **tout** remboursement total, y compris ceux des
factures d'abonnement, qui ne trouveront jamais d'achat à promouvoir. Rien ne les
relit, rien ne les retire, et le module documente ce non-effacement comme voulu.
La croissance est lente (bornée par les remboursements), mais ce dépôt a déjà
refermé une croissance de cette forme — les seaux de limitation de débit ont
leur propre cas « n'accumule pas ». Ici, aucun.

## 5. Arbitrages

- **ADR 038 amendé en place** : même lecture que le lanceur. L'ADR naît dans
  cette branche, n'est pas fusionné, et l'amendement ne touche ni la décision ni
  les options rejetées. Rien à trancher autrement.
- **La solution retenue est proportionnée** malgré m8 : elle est additive, sans
  appel sortant, sans URL stockée, et elle rend la fenêtre sans conséquence là où
  les deux autres directions demandaient soit un aller-retour réseau par
  ouverture, soit une donnée que l'ADR refuse de stocker.
- **C1 est refermé** sur le chemin qui comptait — la confirmation — et prouvé à
  son site (2 rouges). C2, m1 et m2 sont refermés et prouvés (1, 2+2, 1). Aucune
  dérive au plan : les six tâches R1–R6 sont faites, et rien dans le delta que le
  plan n'ait demandé. R5 est une **réfutation vérifiée** : le cas « livre le nom
  et la description de chaque offre déclarée » itère bien `billingOffers` lu de
  `config/billing.ts` (`tests/billing.test.ts:2620`) — le m5 de la première revue
  ne tenait pas, et aucun code n'a été changé pour lui.

## 6. Ce que je n'ai pas pu vérifier

- **Le vrai fournisseur, toujours.** Rien de ce tour n'a touché une clé de test :
  ni le rejeu d'idempotence (m8), ni `checkout.sessions.list` / `charges.list`,
  ni un `charge.refunded` réel. **Gestes humains** : en clés de test, (a) ouvrir
  deux fois le même achat à quelques minutes d'intervalle et relever si
  l'identifiant de session change ; (b) recommencer en changeant la langue entre
  les deux ouvertures ; (c) payer une session supplantée si (a) en produit une ;
  (d) rembourser totalement depuis le tableau de bord et relancer
  `pnpm billing:reconcile`.
- **La fenêtre de bascule (C4)** est établie par lecture du code et du modèle de
  déploiement écrit dans `docs/reliability.md`, pas par un déploiement à deux
  versions. **Geste humain** : déployer sans recouvrement de versions, ou poser
  la lecture de repli avant de déployer.
- **m6 et m7** sont établis par lecture, pas par exécution : je n'ai pas écrit de
  cas (je ne modifie pas le code de la story). Chacun se reproduit en une dizaine
  de lignes dans `tests/billing.test.ts`.
- **La mise en page** : aucun écran n'est modifié par ce delta ; je n'ai fait
  aucune mesure navigateur au-delà du parcours Playwright de facturation.
- **La concurrence réelle** : toujours un seul processus. Les deux sessions
  vivantes de m7 n'ont pas été jouées contre le fournisseur.
- **La fusion avec `dev`** : non rejouée dans ce tour.

Ces listes disent ce qui a été balayé, sur ce périmètre. Elles ne prétendent pas
dire ce qui existe.

## 7. Verdict

Le constat critique du premier tour est refermé là où il faisait mal, et prouvé
à son site. Restent deux constats majeurs — un filet absent sur la seconde moitié
du même mécanisme (C3), et la fenêtre de bascule qui rejoue le défaut pendant le
déploiement qui le corrige (C4) — plus cinq mineurs. Aucun ne ferme le ship, mais
C4 impose une consigne de déploiement explicite, et C3 doit être refermé au tour
suivant : c'est très exactement le motif qui a laissé C1 passer la première fois.

Max severity: major
Ship allowed: yes

---

# Clôture du troisième tour — delta `a28a82d..HEAD`

Écrite par l'implémenteur, **ce n'est pas une revue** : elle rapporte ce qui a
été fait et mesuré depuis la seconde revue, pour que la troisième parte de
faits datés.

## Ce qui a été traité

| Constat | Traitement | Preuve |
|---|---|---|
| **C4** | `purchaseOfSession` résout par l'index inverse **et, à défaut, par `billing_purchase.provider_session_id`** — le repli que « ajouter avant de lire » exige tant que l'ancienne version sert du trafic. Un seul prédicat pour la confirmation **et** la réconciliation. Écrit comme transitoire, retrait dans un tour ultérieur | deux cas neufs, un par chemin ; mutation « retirer le repli » → **2 rouges** |
| **C3** | cas neuf : la réconciliation **retrouve** un achat par une session supplantée | mutation « résoudre par la colonne dans la réconciliation » → **1 rouge** (0 avant ce tour) |
| **m6** | `reconcilePurchases` relit `billing_refunded_payment` — l'autre chemin qui pose un `provider_payment_id`. Le journal l'emporte sur le silence de la charge | mutation « ne pas consulter le journal » → **1 rouge** |
| **m7** | une lecture qui **tranche** consomme son achat pour le passage ; une session impayée ne tranche pas. Second passage à `changed: 0` | mutation « retirer la garde » → **1 rouge** |
| **m8** | ADR 038 §1 distingue ce qui est **mesuré** (colonne écrasée, confirmation aveugle, réconciliation aveugle) de ce qui est **déduit** (qu'une seconde ouverture rende une session différente, sous une clé d'idempotence stable). Corollaire `locale`/sièges sous clé fixe écrit dans « ce qu'il faut surveiller ». Aucun code changé | lecture |
| **m9** | `dataCategories` et `retention` déclarent `purchase` ; le cas **dérive** l'exigence des collections que l'export rend | mutation « retirer `purchase` » → **1 rouge** |
| **m10** | borne refusée, **raison écrite** (ADR 038 §3, `schema.ts`, `AGENTS.md`) : une ligne par remboursement **émis**, jamais par requête — croissance non pilotée par l'extérieur, contrairement aux seaux de limitation de débit —, et l'effacer rouvrirait C2. Aucune commande ne vérifie cette puce, et c'est écrit | lecture |
| comptes de `AGENTS.md` | « retrouver l'achat par la colonne » remesuré à **2** (site : la confirmation) ; fuite du journal des remboursements remesurée à **4**, datée, avec la mention qu'un compte de fuite dépend de l'ordre d'exécution | les deux mutations rejouées |

`m3` et `m4` de la première revue restent hors périmètre : mesurés non
imputables à cette story, et ce tour ne les aggrave pas.

## Ce qui a été exécuté, par l'implémenteur

| Commande | Module activé | Module coupé |
|---|---|---|
| `pnpm typecheck --force` | vert (22/22, `Cached: 0`) | vert (22/22, `Cached: 0`) |
| `pnpm lint` | `No issues found` | `No issues found` |
| `pnpm test` | 1483 passés, **1 rouge de minutage** (`rendered-text`, vert relancé seul) | 1482 passés, **0 rouge** |
| `pnpm build --force` | vert | vert |
| `E2E_PORT=3120 pnpm test:e2e e2e/billing.spec.ts` | 7 passés / 1 sauté | 1 passé (404 attendu) / 7 sautés |
| `pnpm db:migrate` base neuve `s20_t3` | `billing (5)` puis « Rien à appliquer » | — |
| `pnpm db:migrate` base portant **deux achats sans ligne de session** | « Rien à appliquer », lignes intactes — c'est l'état exact de la fenêtre de bascule | — |
| `pnpm ks toggle billing` ×2 | régénère à l'identique, arbre propre après l'aller-retour | — |

Aucune migration n'est ajoutée par ce tour : les corrections sont de lecture,
pas de schéma.

## Ce qui reste ouvert

- **le vrai fournisseur**, inchangé : ni le rejeu d'idempotence (m8), ni
  `checkout.sessions.list` / `charges.list`, ni un `charge.refunded` réel n'ont
  touché une clé de test. Les gestes humains listés par la seconde revue tiennent
  tous ;
- **le second prélèvement de m7 existe toujours** chez le fournisseur : la
  commande redevient rejouable, elle ne rend pas l'argent. Rembourser celui que
  la ligne retient révoque l'accès alors que l'autre reste encaissé — écrit dans
  l'ADR, non fermé ;
- **le repli de C4 est une dette datée** : il doit être retiré une fois
  l'ancienne version hors ligne, et rien ne le rappellera qu'ADR 038 §1 et
  l'`AGENTS.md` du module ;
- **m10 n'est pas vérifié par une commande**, par construction : c'est un
  arbitrage écrit ;
- **m3** (le cas au bord du délai de 5 s) et **m4** (l'instabilité de la suite
  Playwright complète) restent entiers, et hors de cette story.

Les deux lignes ci-dessous **reprennent le verdict de la seconde revue** : un
implémenteur ne s'auto-délivre pas le passage, et la ré-adjudication appartient
à la revue suivante.

Max severity: major
Ship allowed: yes

---

# Troisième revue — delta `a28a82d..357ac93`

Revue **ciblée sur le delta** : cinq cas neufs et un prédicat. Ce que les deux
revues précédentes ont validé n'est pas refait. Toutes les mutations ci-dessous
ont été posées **au site du défaut** et restaurées dans la commande qui les
posait ; l'arbre est vérifié propre (`git diff --exit-code` vide, seul ce fichier
reste non suivi) avant l'écriture de cette ligne.

## 1. Ce qui a été exécuté, par moi

| Commande | Module activé | Module coupé |
|---|---|---|
| `pnpm typecheck --force` | vert (22/22, `Cached: 0`) | vert (22/22, `Cached: 0`) |
| `pnpm lint` | `No issues found` | `No issues found` |
| `pnpm test` | **1484 passés, 0 rouge** | **1482 passés, 0 rouge** |
| `pnpm build --force` | vert (`Cached: 0`) | vert (`Cached: 0`) |
| `E2E_PORT=3120 pnpm test:e2e e2e/billing.spec.ts` | 7 passés / 1 sauté | 1 passé (404 attendu) / 7 sautés |
| `pnpm ks toggle billing` ×2 | régénère à l'identique, arbre propre après l'aller-retour | — |

`pnpm db:migrate` n'a pas été rejouée : **aucun fichier de migration ne change
dans ce delta**, les corrections sont de lecture. La revue précédente l'avait
mesurée sur `0004`.

**Le rouge de minutage de `tests/rendered-text.test.ts` ne se reproduit pas** :
deux passages complets de la suite, dans les deux configurations, zéro rouge. Le
constat m3 reste ouvert comme fragilité de marge, pas comme échec observé ici.

## 2. Mutations, chacune au site du défaut

Référence : `pnpm vitest run tests/billing.test.ts packages/modules/billing/src/domain/billing-rules.test.ts` → **149 verts**, le compte exact qu'annonce `AGENTS.md`.

| Mutation | Site | Rouges | Cas rougis |
|---|---|---|---|
| retirer le repli sur la colonne | `purchaseOfSession` | **2** | les deux cas « … pendant la bascule », un par chemin |
| résoudre par la colonne **dans la réconciliation** | `reconcilePurchases` | **2** | « retrouve un achat par une session supplantée », « reste rejouable quand deux sessions … » |
| ne pas consulter le journal des remboursements | `reconcilePurchases` | **1** | « n'accorde pas un achat dont le remboursement est journalisé mais non appliqué » |
| retirer la garde « un achat tranché une fois par passage » | `reconcilePurchases` | **1** | « reste rejouable quand deux sessions du même achat sont payées » |
| retirer `purchase` de `dataCategories`/`retention` | `module.ts` | **1** | « déclare une catégorie et une rétention pour chaque collection que l'export rend » |
| résoudre par la colonne **à la confirmation** | effet `purchase_paid` | **2** | conforme au compte remesuré de `AGENTS.md` |
| retirer `delete from billing_refunded_payment` du nettoyage | `tests/billing.test.ts:497` | **4** | conforme au compte remesuré |

**Les quatre points du mandat, vérifiés :**

1. **Le repli de la fenêtre de bascule bite sur les deux chemins.** Le prédicat
   unifié `purchaseOfSession` est bien l'unique formulation des deux lecteurs
   (deux sites, vérifiés par balayage), et le neutraliser rougit exactement un
   cas par chemin — la confirmation *et* la réconciliation. L'état « achat
   ouvert par l'ancienne version, sans ligne de session » est reproduit au
   niveau applicatif (`asOpenedByPreviousVersion` efface
   `billing_purchase_session`), ce qui est l'état exact que décrit la fenêtre.
   Les deux branches du `or` ne peuvent pas désigner deux achats : la colonne
   porte `billing_purchase_session_key` (unicité), et `openPurchase` écrit les
   deux emplacements pour la même ligne — relu dans `schema.ts`.
2. **La séquence de m6 est refermée et mesurée** : remboursement journalisé,
   confirmation jamais délivrée, charge introuvable → la réconciliation pose
   `refunded`, `refunded_at` non nul, `hasAccess` faux, et le second passage rend
   `changed: 0`. La mutation « ne pas lire le journal » rougit ce cas et lui
   seul.
3. **`purchase` est déclarée *et* branchée** : la purge et l'export des achats
   sont exercés par un cas exécuté (« efface les achats avec le périmètre, et
   l'export les rend »), et le cas d'inventaire **dérive** les catégories des
   collections que l'export rend au lieu de recopier une liste — il exige aussi
   de voir plus d'une collection, ce qui l'empêche d'être vert à vide.
4. **Les deux comptes de `AGENTS.md` se reproduisent** : 2 pour la résolution par
   la colonne à la confirmation (dont le second cas est bien celui que le
   fichier nomme), 4 pour la fuite du journal des remboursements.

**Le refus de figer le compte de fuite est le bon choix.** Un compte de fuite
mesure l'ordre d'exécution d'un fichier, pas une propriété du code : le figer
serait exactement l'affirmation invérifiable que `AGENTS.md` racine proscrit. Il
est daté, qualifié comme dépendant de l'ordre, et la valeur périmée (5) est
laissée visible. C'est la bonne forme.

## 3. Ce qui est laissé ouvert, et où on le lira

Les deux points sont écrits là où le prochain agent les rencontrera :

- **le second prélèvement subsiste chez le fournisseur** — ADR 038 §3, en toutes
  lettres (« ce que cela ne répare pas »), et `packages/modules/billing/AGENTS.md` ;
- **le repli est une dette** — ADR 038 §1, `schema.ts` (deux endroits),
  `AGENTS.md` du module, et le commentaire de `purchaseOfSession` lui-même.

Réserve : la dette est **conditionnelle, pas datée** (« une fois l'ancienne
version hors ligne ») et aucune commande ne rougit quand elle survit à son
utilité. C'est assumé et écrit ; c'est aussi la forme de dette que ce dépôt
oublie.

## 4. Constats

### m11 — mineur — un commentaire du site de la confirmation dit l'inverse du code

`drizzle-billing-repositories.ts:494` porte encore :

> La ligne est retrouvée par **l'index inverse des sessions**, jamais par la
> colonne de l'achat

Le prédicat lit désormais les deux, et son propre commentaire (380 lignes plus
haut) l'explique. C'est le commentaire que lira l'agent qui touche l'effet
`purchase_paid`, et il lui dit le contraire de ce qui se passe — la forme de
dérive documentaire que ce dépôt a déjà payée trois fois.

### m12 — mineur — un compte du tableau de `AGENTS.md` est déjà périmé

« retrouver l'achat par la colonne **dans la réconciliation** | 1 » : je mesure
**2** sur la même commande (le second cas est « reste rejouable quand deux
sessions du même achat sont payées », que la résolution par la colonne casse
aussi). L'écart va dans le sens de la sûreté, et le fichier dit lui-même que ses
comptes sont ceux d'une exécution datée — mais c'est le troisième compte écrit à
la main de ce fichier que je remesure différemment.

### m13 — mineur — la garde « un achat tranché une fois par passage » suppose un ordre de fournisseur stable

`decided` consomme l'achat **avant** `purchaseDiffers`, donc la première lecture
qui tranche gagne même quand elle n'écrit rien. Si l'ordre rendu par le
fournisseur venait à s'inverser entre deux passages, une session payée pourrait
prendre la place d'une session remboursée du même achat et l'accès survivrait à
un remboursement. Le commentaire pose l'hypothèse (« un ordre stable, pas un
tirage ») ; rien dans ce dépôt ne l'éprouve contre le vrai fournisseur, et la
doublure rend l'ordre du tableau littéral. Cousin du m7 déjà écrit, pas un
chemin neuf.

## 5. Ce que je n'ai pas pu vérifier

- **Le vrai fournisseur, toujours.** Ni `checkout.sessions.list`, ni
  `charges.list`, ni un `charge.refunded` réel, ni le rejeu d'idempotence (m8)
  n'ont touché une clé de test dans ce tour. Les gestes humains listés par les
  deux revues précédentes tiennent **tous**, et m13 en ajoute un : relever si
  `checkout.sessions.list` rend un ordre stable entre deux appels.
- **La bascule à deux versions.** Elle est reproduite en base par l'effacement
  de l'index inverse, ce qui est l'état exact qu'elle laisse, mais **aucun
  déploiement à deux versions n'a été joué**. Geste humain : migrer, laisser
  l'ancienne version ouvrir un checkout, basculer, payer.
- **Les migrations.** Non rejouées : aucun fichier de migration ne change ici.
  Je n'ai donc pas revérifié moi-même le rattrapage de `0004` sur une base
  portant des achats.
- **L'écran.** Aucun écran n'est modifié par ce delta ; aucune mesure navigateur
  au-delà du parcours Playwright de facturation, aucune capture.
- **La concurrence réelle.** Toujours un seul processus, une seule instance.
- **La suite Playwright complète** (m4) et la fusion avec `dev` : non rejouées
  dans ce tour.

Ces listes disent ce qui a été balayé, sur ce périmètre. Elles ne prétendent pas
dire ce qui existe.

## 6. Verdict

Les deux constats majeurs de la seconde revue sont refermés **et prouvés à leur
site** : le repli de bascule rougit sur les deux chemins, la moitié
« réconciliation » de l'index inverse est enfin exigée par un cas. m6, m7 et m9
sont refermés et prouvés ; m8 et m10 sont des arbitrages écrits, avec leurs
limites nommées. Les six commandes sont vertes dans les deux configurations.
Restent trois mineurs, dont un commentaire à corriger au prochain passage.

Max severity: minor
Ship allowed: yes
