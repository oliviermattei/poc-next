# Revue anti-hallucination — s19-subscribe-stripe

Branche `feature/s19-subscribe-stripe`, commit unique `54f7eb2`, 73 fichiers,
8 733 insertions. Diff jugé : `git diff dev...feature/s19-subscribe-stripe`.
Base de données `s19`. Worktree
`/Users/olivier/www/boilerplate/.claude/worktrees/agent-a57fb834ceaad2d7c`.

Aucune liste de ce document n'est exhaustive. Chaque relevé dit **ce qui a été
balayé** et sur combien de cas.

## 1. Ce qui a été exécuté

Configuration livrée (`billing` **activé**) :

| Commande | Résultat |
|---|---|
| `pnpm test` | 37 fichiers, 1 298 tests verts, 6 ignorés |
| `pnpm typecheck` | 19 tâches vertes |
| `pnpm lint --max-warnings=0` | aucun avis |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert |
| `pnpm build --force` | vert |
| `E2E_PORT=3119 pnpm test:e2e` | 67 verts, 6 ignorés |

Seconde configuration (`pnpm ks toggle billing`, module **coupé**) :

| Commande | Résultat |
|---|---|
| `pnpm typecheck` / `pnpm lint` | verts |
| `pnpm test` | 1 298 verts (le fichier construit son propre registre) |
| `pnpm build --force` | vert |
| `E2E_PORT=3119 pnpm test:e2e` | 63 verts, 10 ignorés |
| base vierge `s19_vierge` + `pnpm db:migrate` | **aucune table `billing_*`** — huitième critère tenu |

Puis module réactivé, `pnpm db:migrate` deux fois de suite sur la base vierge :
les trois tables apparaissent, la seconde exécution n'ajoute rien.
`pnpm billing:reconcile` sur base vide : `0 client(s) relu(s), 0 abonnement(s)
réécrit(s)`.

Vérification navigateur refaite (build de production forcé au préalable, puis
Playwright) : `/billing` en 1440 px et 390 px, thèmes clair et sombre, états
« sans abonnement » et « en essai » après souscription réelle en mode local.
L'écran rend correctement dans les six captures ; la grille passe en colonne
unique sous `md`, les badges portent le **nom** de l'état et pas seulement une
teinte.

Références du SDK ouvertes et confrontées, sur ces 5 points :
`Stripe.createFetchHttpClient` (`esm/platform/PlatformFunctions.d.ts:79`),
`ApiVersion = "2026-08-26.dahlia"` (`esm/apiVersion.d.ts:1`),
`current_period_end` **absent** de `Subscriptions.d.ts` et présent sur
`SubscriptionItems.d.ts:54`, `generateTestHeaderString` avec `timestamp`
optionnel (`esm/Webhooks.d.ts:15-22`), `dispatchModuleRequest`
(`packages/core/src/registry.ts:191`). Aucune API inventée trouvée sur ces
cinq-là.

## 2. Constats

### F1 — critique — un abonnement actif s'affiche « expiré » et perd l'accès dès qu'un abonnement l'a précédé

`billing_subscription` a pour clé primaire `provider_subscription_id` et
**aucune contrainte d'unicité sur `billing_customer_id`** (migration
`0000_amazing_prowler.sql`, index `billing_subscription_customer_idx`, non
unique). Or `subscriptionOfCustomer`
(`packages/modules/billing/src/infrastructure/drizzle-billing-repositories.ts`)
lit :

```
.where(eq(billingSubscription.billingCustomerId, billingCustomerId))
.limit(1)
```

sans `order by`. Le commentaire du port dit « Un seul par client dans s19 » —
c'est faux dès qu'un client a eu deux abonnements successifs, ce qui est le
parcours ordinaire *annuler puis se réabonner*.

**Mesuré**, sonde temporaire dans `tests/billing.test.ts` (retirée, arbre
prouvé propre) : client rattaché, puis `customer.subscription.deleted` sur
`sub_ancien` (`canceled`), puis `customer.subscription.created` sur
`sub_nouveau` (`active`, période jusqu'en 2030) :

```
lignes = [ {sub_ancien, canceled}, {sub_nouveau, active} ]
vue.state  = "expired"
vue.hasAccess = false
```

Un client qui vient de payer voit « Abonnement expiré » et perd l'accès. Ce
n'est pas une course : Postgres rend l'ordre d'insertion, donc c'est
**l'ancienne** ligne qui gagne de façon reproductible.

Le même état se fabrique par la commande de réconciliation :
`listSubscriptions` appelle `client.subscriptions.list({ customer, status:
'all' })` — *toutes* les souscriptions historiques —, et `replaceSubscriptions`
insère chacune. Réconcilier un client qui a churné une fois suffit.

C'est le défaut F1 de la revue de s18 rejoué à l'identique : le périmètre
d'écriture (une ligne par abonnement du fournisseur) et le périmètre
d'affichage (« l'abonnement de ce client ») divergent.

Aucun test ne couvre le cas : toute la suite ne fabrique jamais qu'un seul
`provider_subscription_id` (`sub_s19_1`).

### F2 — critique — une offre malformée **ne** fait **pas** échouer le démarrage, et met le webhook public en 500

Premier critère de la story : « une offre malformée fait échouer le démarrage ».
Trois docblocks l'affirment :

- `config/billing.ts` : « Elle est appelée au **démarrage** par
  `apps/web/next.config.ts` : une offre malformée arrête le processus avant la
  première requête, en la nommant. »
- `apps/web/lib/billing.ts` : « `apps/web/next.config.ts` force la validation au
  démarrage, quand le module est activé. »
- Plan, tâche T2 : « Une offre malformée fait échouer le démarrage. »

`apps/web/next.config.ts` n'appelle **jamais** `parseBillingCatalogue`. Il
n'appelle que `resolveBillingConfig(env)`. Le catalogue n'est validé que par
`catalogueOf()`, dans la fabrique différée passée à `provideBilling` — donc à la
**première requête** qui construit le service.

**Mesuré** : `config/billing.ts` muté avec deux offres portant le même
`priceId` (cas que `satisfies` laisse passer et que `parseBillingCatalogue`
refuse). `pnpm typecheck` vert, `pnpm build --force` vert, l'application
**démarre et sert** (`✓ Running next.config.ts took 658ms`, aucun refus). Puis,
sous Playwright, trois parcours rouges à l'exécution — et notamment :

```
refuse un webhook dont la signature est invalide, en 400
  Expected: 400
  Received: 500
```

Conséquence, et elle est pire que le critère manqué : une erreur de
configuration ne s'arrête pas au démarrage, elle transforme le **point d'entrée
public** en émetteur de 500. Stripe rejoue, abandonne, et l'état des abonnements
diverge en silence — exactement ce que `docs/reliability.md` §1 et §2
interdisent. La règle de `docs/security.md` §5 (« environnement validé au
démarrage, en nommant la variable ») est tenue pour les trois variables Stripe,
pas pour le catalogue qui décide de ce qu'on facture.

`billing-rules.test.ts` prouve que `parseBillingCatalogue` refuse ; rien ne
prouve qu'on l'appelle au démarrage. La mutation prévue par le plan pour T2
(« retirer le `superRefine` des doublons ») n'éprouve que le parseur.

### F3 — majeur — la garde de permission réelle est **verte sous mutation**

`apps/web/lib/billing.ts` :

```
const canManage = async (scope, userId) => {
  if (scope.kind !== 'organization' || !organizations.available) return true
  const view = await organizations.view(userId)
  return view.permissions[ORGANIZATION_ACTION.manageBilling] === true
}
```

Neutralisée en `return true` — c'est-à-dire : *tout membre d'une organisation
peut souscrire et annuler l'abonnement de son organisation* — la suite complète
reste **verte : 1 298/1 298** (mesuré deux fois ; un rouge apparu au premier
passage dans `tests/rendered-text.test.ts` ne s'est pas reproduit à l'identique,
voir §5).

Ce qui existe : la matrice s17 est couverte (`billing.manage` × owner/admin/
member, unitaire), et les routes du module sont couvertes avec un prédicat
`canManage` **injecté par le test**. Ce qui manque : le fil entre les deux.

`docs/security.md` §3 est explicite — « Chaque combinaison rôle × action
sensible est couverte par un **test d'API**, pas d'interface ». s17 le fait pour
ses six actions (`tests/organizations.test.ts`, `anOrganizationWithRole('member')`
→ rôle réel en base → 403). s19 ne le fait pour aucune. Le code de production
est juste tel que je l'ai lu — `dataOwnerOf` et `organizations.view` dérivent
tous deux de l'organisation *active*, donc il n'y a pas la divergence de
périmètre de s18 — mais rien ne le tient.

C'est le cas que `AGENTS.md` nomme : « A green mutation means the test is wrong,
not that the code is right. »

### F4 — majeur — `emailOfScope` rend `null` en dur, et son commentaire dit le contraire

`apps/web/lib/billing.ts:222` :

```
const emailOfScope = async (): Promise<string | null> => null
```

sous un docblock qui affirme : « c'est ici que l'identifiant devient une adresse,
**comme `emailOfScope` le fait déjà pour `marketing`** ». Or `marketing` la
résout réellement (`apps/web/lib/module-services.ts:65` :
`(await appAuth().useCases.viewAccount(scope.userId))?.email ?? null`).

Le paramètre traverse le port (`CreateCheckoutInput.customerEmail`), le cas
d'usage (`customerEmail: existing === null ? await emailOfScope(scope) : null`)
et l'adaptateur (`client.customers.create({ email })`) — pour arriver toujours
vide. Les clients Stripe créés par ce boilerplate n'auront pas d'adresse au
moment de leur création, alors que la résolution existe deux fichiers plus loin.
Le commentaire est le défaut principal : il fera croire au prochain agent que le
câblage est fait.

### F5 — mineur — `OfferView.current` est calculé, typé, exporté, et jamais lu

`billing-use-cases.ts` calcule `current: subscription?.offerId === offer.id`.
`billing-screen.tsx` ne contient aucune occurrence de `current` (vérifié par
`grep`). Conséquence visible dans la capture « en essai » : l'offre déjà
souscrite affiche encore « Souscrire ». Cliquer rouvre un checkout ; la clé
d'idempotence `checkout:<scope>:<offerId>` protège 24 h (durée de vie d'une clé
Stripe), pas au-delà — et c'est le chemin qui fabrique la seconde ligne de F1.

### F6 — mineur — « la réconciliation le rattrapera » est faux pour le cas décrit

`billing-use-cases.ts`, `effectOf` : quand `customerByProviderId` rend `null`,
l'événement est journalisé et n'écrit rien, avec le commentaire « C'est le cas
d'un abonnement créé depuis le tableau de bord du fournisseur, **que la
réconciliation rattrapera** ». La même affirmation est dans ADR 034 et dans
`docs/research/s19` §4. Elle est fausse pour ce cas précis : `reconcile()` itère
`repository.listCustomers()`, c'est-à-dire les lignes `billing_customer` que
nous connaissons. Un client créé dans le tableau de bord Stripe n'y figure pas,
et rien ne le rattrapera jamais. (Un abonnement ajouté à la main sur un client
**déjà** rattaché, lui, est bien rattrapé — la phrase ne distingue pas.)

### F7 — mineur — `/api/billing-local-checkout` n'a pas de garde de session

La route lit `?session=` et complète le checkout sans regarder qui appelle. Les
identifiants sont déterministes : `cs_local_${customerIdFor(reference)}_${priceId}`,
et `customerIdFor` est un hachage public du périmètre. En mode local, un visiteur
peut donc terminer le checkout ouvert par quelqu'un d'autre. Le rayon est borné —
le drapeau est un opt-in explicite et refusé sous `NODE_ENV=production`, ce que
j'ai mesuré — mais la route est aussi la seule du dépôt qui **écrive en `GET`**,
et l'absence de garde n'est écrite nulle part.

### F8 — mineur — `listSubscriptions` ne lit qu'une page

`client.subscriptions.list({ customer, status: 'all', limit: 100 })`, sans
pagination. Au-delà de 100 abonnements historiques pour un client, la
réconciliation est partielle et silencieuse. Improbable, non documenté.

### F9 — mineur — dérives entre le plan, le design et le code

Trois, sur les dix tâches balayées :

- T6 nomme `accessOf(subscription, now)` ; le code livre `grantsAccess`. Renommage
  seul.
- T9 annonce « six états rendus » dans `tests/rendered-text.test.ts` ; trois le
  sont (`none`, `past_due`, `ending`). Les six sont couverts unitairement par
  `displayStateOf`, pas au rendu.
- `docs/designs/s19` nomme le composant `BillingActions` (le code exporte
  `BillingAction`) et place un `EmptyState` sur l'état `none` ; l'écran rend une
  `Card` avec un `Badge` « Aucun abonnement ». L'`EmptyState` sert au catalogue
  vide.

## 3. Les mutations posées, et ce qu'elles ont fait rougir

Onze mutations, chacune restaurée dans la commande qui la pose, chacune suivie
d'un `git diff --exit-code` vert sur le fichier.

| # | Ce qui a été neutralisé | Rouges |
|---|---|---|
| A | `stripe-payments.ts` : `Stripe.webhooks.constructEvent` → `JSON.parse` (plus aucune vérification de signature) | **5** (3 fichiers) |
| B | `setWhere: lte(lastEventAt…)` et le `lte` du `payment_failed` retirés (prédicat d'ordre) | **1** |
| C | court-circuit `journal.length === 0` neutralisé (idempotence) | **1** |
| D | `!(await canManage(...))` retiré des deux cas d'usage | **2** |
| E | `apps/web/lib/billing.ts#canManage` → `return true` | **0** → F3 |
| F | `z.strictObject` → `z.looseObject` sur le corps du checkout | **2** |
| G | `if (stored !== null && !differs(...)) continue` retiré (réconciliation) | **1** |
| H | `grantsAccess` ignore `cancelAtPeriodEnd` | **1** |
| I | mode local déduit de `NODE_ENV !== 'production'` | **3** |
| J | `admin` perd `ORGANIZATION_ACTION.manageBilling` | **1** |
| K | `config/billing.ts` : deux offres sur le même `priceId` | typecheck **vert**, build **vert**, démarrage **vert**, 3 e2e rouges à l'exécution → F2 |

Deux mutations n'ont pas mordu là où le plan les annonçait : **E** (aucune) et
**K** (aucune au démarrage, ce qui est le critère). Les neuf autres mordent.

## 4. Les sondes, instruites plutôt que crues

Toutes temporaires, toutes retirées, arbre prouvé propre après chacune.

1. **Signature hors fenêtre de tolérance.** En-tête signé avec
   `timestamp = now - 3600` (la tolérance du SDK est de 300 s) :
   `{ statut: 400, journal: 0, abo: 0 }`. Rien n'est écrit.
2. **Rejeu concurrent.** Trois livraisons simultanées du même `evt_` :
   `[{applied:true},{applied:false},{applied:false}]`, une ligne de journal, une
   ligne d'abonnement. L'idempotence par contrainte tient sous concurrence.
3. **Désordre.** Couvert par la suite (`updated` livré avant
   `checkout.session.completed`, événement plus ancien refusé, égalité
   d'horodatage appliquée) et par le simulateur local, qui envoie
   volontairement `subscription.created` avant `checkout.session.completed` —
   le parcours navigateur passe.
4. **Réconciliation** : divergente → `{customers:1, changed:1}` ; rejouée →
   `{customers:1, changed:0}` ; base vide → `0/0` ; base fraîche migrée deux
   fois → aucun effet supplémentaire.
5. **Refus de démarrage**, mesuré **au-delà de la ligne `✓ Ready`** (le piège
   signalé) : sans clé ni drapeau, `✓ Ready in 123ms` puis
   `⨯ Failed to load next.config.ts` avec le message nommant les trois
   variables, et `curl` rend `000` — le processus ne sert rien. Sous
   `next start` (donc `NODE_ENV=production`) avec `PAYMENTS_LOCAL_MODE=1`, même
   refus, message nommant la variable. Les deux gardes sont vivantes.
6. **Le prix ne vient pas du client** : corps `{offerId, priceId, amount}` →
   400 sans un seul appel sortant ; corps `{offerId, organizationId}` → 400,
   aucune écriture ; le corps envoyé à Stripe porte
   `line_items[0][price]=price_pro_monthly` et `quantity=1` (7 pour une offre au
   siège, résolu serveur).

## 5. Ce que je n'ai pas pu vérifier

- **Stripe réel.** `stripe-live.test.ts` n'a pas été exécuté : il exige
  `STRIPE_LIVE_TEST=1`, une `sk_test_…` et un `STRIPE_LIVE_PRICE_ID`. Le second
  régime d'intégration est donc **déclaré, jamais exercé ici**. Geste humain :
  lancer la recette contre un compte de test avant le premier encaissement, et
  vérifier au tableau de bord que le client créé porte bien une adresse (F4).
- **Le portail client.** Ce que le portail autorise — changer de plan, mettre à
  jour la carte, annuler — dépend de la *configuration du portail* sur le compte
  Stripe, qu'aucun code de ce diff ne pose. Le sixième critère n'est donc pas
  vérifiable ici. Geste humain : ouvrir le portail sur le compte de test et
  cocher les trois capacités.
- **Le vrai désordre de livraison de Stripe.** Tous les événements de la suite
  sont fabriqués et signés localement. La fenêtre de tolérance, l'ordre réel et
  les rejeux de Stripe ne sont pas observés.
- **Les états `expired` et `past_due` au navigateur.** Le mode local ne sait pas
  les produire (il le dit lui-même). Ils sont couverts par `displayStateOf` et
  par deux rendus de `tests/rendered-text.test.ts`, jamais dans un navigateur
  après un vrai cycle.
- **La facturation au siège de bout en bout.** `perSeat: true` n'existe que dans
  le catalogue du test ; les offres livrées sont toutes `perSeat: false`. Le
  chemin `seatsOf` → `quantity` est prouvé unitairement, jamais au navigateur.
- **Un flottement observé une fois.** `tests/rendered-text.test.ts` a échoué une
  fois sur cinq exécutions de la suite complète, dans un passage muté, et n'a pas
  reproduit sur une exécution identique. Je n'ai pas capturé le message. À
  surveiller.
- **La charge.** Aucune limite de taille sur le corps du webhook public, et
  aucune limitation de débit (dette s28, écrite dans la recherche §10). Non
  mesuré.

## 6. Les deux décisions soumises au jugement

**`webhooks: []` au contrat.** L'argument est vérifié et il est bon :
`WebhookEvent` (`packages/core/src/module.ts:140-145`) porte `id`, `type` et
`payload: unknown` — trois valeurs qui n'existent qu'**après** parsing. Passer
par ce contrat obligerait à parser avant de vérifier la signature, ce que
`docs/security.md` §4 interdit. Le webhook est donc une route déclarée, publique,
gardée par la signature ; module coupé, elle répond 404 (mesuré). Décision
acceptée. Réserve : rien dans le dépôt n'empêche un prochain module de déclarer
`webhooks: []` par paresse — la propriété repose sur un commentaire, pas sur une
commande.

**`window.location.assign` plutôt qu'un `<form>` natif.** Vérifié :
`apps/web/lib/security-headers.ts:130` émet `form-action 'self'` et
`config/security.ts` livre `formAction: []`. Une réponse 303 vers
`checkout.stripe.com` depuis une soumission serait effectivement bornée par cette
directive. Le prix — le parcours exige JavaScript — est assumé par ADR 027 et
annoncé par un `<noscript>`. Décision acceptée. Ce qui vous appartient : accepter
que le tunnel de paiement d'un boilerplate ne fonctionne pas sans JavaScript,
plutôt que d'ouvrir deux origines tierces dans la politique.

## 7. Le découpage

73 fichiers, quatre paquets neufs (`@repo/adapter-stripe`,
`@repo/payments-testing`, `@repo/module-billing`, plus `payments.ts` dans
`@repo/ports`), un port, un adaptateur, un simulateur, un module à quatre
couches, trois tables, un écran, une commande de maintenance, un ADR — **en un
commit**. Six fichiers de test.

Oui, elle aurait dû être découpée, et les deux critiques le montrent : F2 est un
oubli de câblage entre le catalogue et le démarrage, F3 un oubli de câblage entre
la matrice de rôles et la composition. Ce sont exactement les coutures qu'une
story de 73 fichiers laisse dans l'angle mort — s18 a payé la même facture. Un
découpage naturel existait : (a) port `Payments` + adaptateur + simulateur, (b)
catalogue + validation au démarrage, (c) module `billing` + webhook +
réconciliation, (d) écran et parcours.

## 8. Verdict

La partie difficile est faite, et faite bien : la signature avant tout effet de
bord, l'idempotence par contrainte prouvée sous concurrence, le prédicat d'ordre
avec l'égalité assumée, la réconciliation rejouable, le refus de démarrage
mesuré au-delà de `✓ Ready`, le mode local jamais déduit de `NODE_ENV`,
`current_period_end` lu sur les lignes, les messages assainis, la clé
d'idempotence injectée. Neuf mutations sur onze mordent.

Ce qui bloque, ce sont les deux coutures que personne ne tient : un abonnement
actif affiché « expiré » dès qu'un abonnement l'a précédé (F1), et un catalogue
qui n'est pas validé au démarrage alors que trois docblocks et un critère
l'affirment — avec un webhook public en 500 pour conséquence (F2).

## 9. Clôture du tour de correction — commit `d604e5c`

Écrite par l'implémenteur, constat par constat. Rien ici n'est un verdict : le
verdict appartient à la revue suivante.

### Ce qui a été corrigé

**F1 — critique — l'abonnement actif affiché « expiré ».** Fermé des deux côtés,
mais **pas avec la contrainte demandée**, et c'est la déviation principale de ce
tour (voir plus bas).

- *lecture* : `subscriptionsOfCustomer` rend **tous** les abonnements du client,
  ordonnés par `last_event_at desc, current_period_end desc,
  provider_subscription_id desc` — un ordre **total**, la dernière clé étant la
  clé primaire ;
- *schéma* : `billing_subscription_customer_idx` porte exactement ces quatre
  colonnes dans cet ordre (migration `0001_modern_squirrel_girl.sql`, additive :
  elle remplace un index par un index dont la colonne de tête est la même) ;
- *règle* : `currentSubscriptionOf` (`domain/subscription.ts`) — **celui qui
  donne l'accès l'emporte**, à défaut le premier de la liste.

Parcours rejoué jusqu'à l'affichage (`tests/billing.test.ts`, « un client qui se
réabonne ») : souscrire → annuler → se réabonner rend `state: 'active'`,
`hasAccess: true`, quantité de l'abonnement neuf, avec **deux** lignes en base.
Trois cas de plus : l'annulation de l'ancien livrée **en dernier**, l'affichage
quand tous sont terminés, et la réconciliation qui relit tout l'historique.
L'export ne rend plus que l'abonnement courant.

**F2 — critique — le catalogue jamais validé au démarrage.** `apps/web/lib/billing-catalogue.ts`
porte le catalogue validé et mémorisé. `next.config.ts` l'appelle quand le module
est activé, **avant** la garde d'environnement et **sans condition de phase** :
un catalogue est du code, pas une variable, et rien ne justifiait qu'il échappe à
`next build` ou à `SKIP_ENV_VALIDATION`. `apps/web/lib/billing.ts` appelle la
même fonction.

Sur le 400 demandé : avec cette garde, l'état « application démarrée sur un
catalogue invalide » n'est plus atteignable — c'est ce qui répond à « quel que
soit l'état de la configuration ». Le refus en 400 sur signature invalide reste
mesuré en unitaire et au navigateur, dans la configuration livrée.

**F3 — majeur — la permission verte sous mutation.** La règle vit dans
`apps/web/lib/billing-permission.ts` ; `tests/billing.test.ts` la branche sur la
**vraie** vue du module `organizations` (compte réel, appartenance écrite en
base, organisation courante sélectionnée) et mesure à la route : `member` → 403
sur le checkout **et** sur le portail, aucun appel sortant, aucune écriture ;
`owner` et `admin` → 200. Un troisième cas tient le critère 7 : organisations
coupées, tout est permis **sans qu'aucune question ne soit posée**.

Ce qui reste hors filet, dit plutôt que sous-entendu : la ligne
`view: (userId) => organizationsService().useCases.viewOrganizations(userId)` de
`apps/web/lib/organizations.ts`, que le test reproduit à l'identique au lieu de
l'importer.

**F4 — majeur — `emailOfScope` rendait `null`.** La parité est réelle :
`ScopeEmailResolver` reçoit désormais l'appelant (comme `canManage` et
`seatsOf`), et le point de composition rend l'adresse du compte qui ouvre le
checkout, dans les deux périmètres. L'import de `lib/auth` est **différé** :
statique, il ferait échouer tous les parcours Playwright, qui chargent
`lib/billing.ts` hors de Next.

Ce qui est couvert : que l'adresse résolue atteigne le fournisseur
(`email=client@example.test` dans le corps de `customers.create`), mutation à
l'appui. Ce qui ne l'est pas : la résolution `userId → adresse` elle-même, un
`await appAuth().useCases.viewAccount(userId)`. C'est exactement la forme et le
statut de celle de `marketing` (`lib/module-services.ts`), qu'aucun test ne
couvre non plus — vérifié sur ces deux occurrences, pas au-delà. Le geste humain
recommandé par la revue reste valable : vérifier au tableau de bord Stripe que le
client créé porte une adresse.

**F5** — l'offre en cours rend un `Badge` « Offre en cours » à la place du bouton
« Souscrire » ; les autres offres gardent le leur. Vérifié au navigateur
(1440 px et 390 px, thèmes clair et sombre) : la carte souscrite porte le badge,
l'autre le bouton, la grille passe en colonne unique sous `md`.

**F6** — le commentaire d'`effectOf` distingue les deux cas : un abonnement
ajouté à un client **déjà rattaché** est rattrapé, un *client* créé dans le
tableau de bord ne l'est jamais. `docs/research/s19` §4 dit la même chose. ADR 034
ne portait pas cette phrase (vérifié).

**F7** — `GET /api/billing-local-checkout` exige une session et le périmètre de
cette session ; le refus est 404 dans les trois cas. La garde est **dans le
simulateur** autant que dans la route : `completeCheckout(sessionId, reference)`,
second paramètre obligatoire.

**F8** — `listSubscriptions` suit `has_more` avec `starting_after`, plafonné à
100 pages. Le plafond atteint, ce qui a été lu est rendu : la réconciliation
n'efface jamais, donc une lecture partielle ne coupe personne.

**F9** — plan (T6, T9) et design (`BillingAction`, `EmptyState`, badge de l'offre
en cours) remis d'accord avec le code.

**Arbitrage 1 (`webhooks: []`)** — une commande le tient désormais :
`tests/module-registry.test.ts` balaie les sources de `apps/web` et refuse toute
répartition de `registry.webhooks`. Le jour où ce répartiteur existera, le cas
rougit et les modules qui ont choisi la route devront être rouverts. La raison est
écrite là où le prochain module la lira : le docblock de `WebhookHandler` dans
`packages/core/src/module.ts`.

**Arbitrage 2 (JavaScript obligatoire)** — écrit dans `config/billing.ts` (le
fichier que le propriétaire édite), `apps/web/AGENTS.md` et
`packages/modules/billing/AGENTS.md`.

### La déviation, et pourquoi

La revue demandait « une contrainte qui rend l'état ambigu impossible » sur
`billing_customer_id`. Elle n'a **pas** été posée, et voici la mesure :

- une **unicité pleine** sur `billing_customer_id` oblige l'écriture à viser le
  client comme cible de conflit. Le parcours « souscrire le neuf, puis annuler
  l'ancien » écrase alors l'abonnement actif par l'annulation, qui est
  l'événement le plus récent : c'est F1 rejoué à l'endroit d'à côté. Le cas est
  dans la suite (« reste actif quand l'annulation de l'ancien arrive en
  dernier ») ;
- une **unicité partielle** sur les statuts vivants ne tient pas davantage : un
  second abonnement vivant est atteignable — un appel direct sur la route de
  checkout suffit —, et la contrainte transformerait le webhook public en 500
  permanent, ce que `docs/reliability.md` §1 interdit.

Ce qui est livré à la place : un ordre de lecture **total** porté par l'index,
donc une ligne « première » qui ne dépend d'aucun hasard du moteur, et une règle
du domaine qui tranche. Le raisonnement est écrit dans le docblock de
`schema.ts`, pour que le prochain agent ne repose pas la question.

Deuxième déviation, mineure : `apps/web/AGENTS.md` et
`packages/modules/billing/AGENTS.md` ont été mis à jour (nouveaux fichiers,
nouvelle garde, tableau de mutations). Ce sont les règles **locales** des
paquets touchés, pas l'architecture ni `AGENTS.md` racine.

### Les mutations posées, et ce qu'elles ont fait rougir

Dix, chacune restaurée dans la commande qui la pose, chacune suivie d'un
`diff` vert sur le fichier.

| Ce qui a été neutralisé | Rouges |
|---|---|
| la garde de périmètre du checkout simulé (simulateur) | **1** |
| la même, de bout en bout (route + simulateur, Playwright) | **1** |
| l'ordre de lecture des abonnements (`order by` retiré) | **1** |
| `currentSubscriptionOf` → le premier de la liste | **2** |
| l'appel au catalogue retiré de `next.config.ts` | **2** |
| `billingPermissionOf` → `return true` | **1** |
| `customerEmail` → `null` | **1** |
| l'offre en cours reprend son bouton « Souscrire » | **1** |
| la pagination de `listSubscriptions` (une page) | **1** |
| une répartition de `registry.webhooks` ajoutée dans `apps/web` | **1** |

Aucune mutation posée n'est restée verte.

### Les commandes, dans les deux configurations

| Commande | `billing` activé | `billing` coupé |
|---|---|---|
| `pnpm typecheck` | 19 tâches vertes | vertes |
| `pnpm lint --max-warnings=0` | aucun avis | aucun avis |
| `pnpm test` | 1 320 verts, 6 ignorés | 1 320 verts, 6 ignorés |
| `pnpm build --force` | vert | vert |
| `E2E_PORT=3119 pnpm test:e2e` | **68** verts, 6 ignorés | 63 verts, 11 ignorés |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert | — |

Base vierge `s19_vierge`, module coupé : **aucune table `billing_*`**. Module
réactivé, `pnpm db:migrate` joué deux fois : les trois tables et l'index à quatre
colonnes apparaissent, la seconde exécution n'ajoute rien, une troisième non
plus. `pnpm ks toggle billing` aller-retour laisse `config/features.ts` et
`generated/` identiques.

### Ce qui reste ouvert

- **Le mode local des parcours vient du `.env` du poste**, pas de
  `playwright.config.ts` : `PAYMENTS_LOCAL_MODE` n'y est pas déclaré. Il est en
  revanche livré à `1` dans `.env.example`, donc un clone neuf qui suit la
  procédure l'a. Non corrigé : `playwright.config.ts` était hors périmètre de ce
  tour, sur consigne explicite. À trancher à la revue.
- **Stripe réel** : `stripe-live.test.ts` n'a toujours pas été exécuté.
- **Le portail client** dépend de la configuration du portail sur le compte
  Stripe ; le sixième critère reste non vérifiable ici.
- **`expired` et `past_due` au navigateur** : toujours pas produits par le mode
  local.
- **La facturation au siège de bout en bout** : `perSeat: true` n'existe que dans
  le catalogue du test.
- **La limite de taille du corps du webhook et la limitation de débit** :
  toujours non mesurées, dette s28.

### Le gate

Les deux lignes ci-dessous décrivent **la revue du commit `54f7eb2`**, et elles
sont laissées telles quelles : ce tour de correction n'est pas une revue, et
l'implémenteur ne s'auto-délivre pas le passage. **La revue doit être rejouée**
sur le diff complet `dev...feature/s19-subscribe-stripe`, en particulier sur la
déviation ci-dessus, qui est un choix de schéma.

Max severity: critical
Ship allowed: no

---

# Seconde revue — commit `d604e5c`

Diff jugé : `git diff dev...feature/s19-subscribe-stripe`, tour de correction
`git diff 54f7eb2..d604e5c` (35 fichiers, 1 701 insertions). Base `s19`,
port 3119. Worktree
`/Users/olivier/www/boilerplate/.claude/worktrees/agent-a57fb834ceaad2d7c`.

Les deux lignes de gate du §9 ci-dessus décrivent la revue de `54f7eb2` ; celles
qui closent ce fichier sont les miennes et portent sur `d604e5c`.

Aucune liste de ce document n'est exhaustive. Chaque relevé dit **ce qui a été
balayé** et sur combien de cas.

## 1. Ce qui a été exécuté

Configuration livrée (`billing` **activé**) :

| Commande | Résultat |
|---|---|
| `pnpm test` | 37 fichiers, **1 320** verts, 6 ignorés |
| `pnpm typecheck` | 19 tâches vertes |
| `pnpm lint --max-warnings=0` | aucun avis |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert |
| `pnpm build --force` | vert |
| `E2E_PORT=3119 pnpm test:e2e` | **68** verts, 6 ignorés |
| `pnpm db:migrate` deux fois | seconde exécution : rien à appliquer |

Seconde configuration (`pnpm ks toggle billing`, module **coupé**) :

| Commande | Résultat |
|---|---|
| `pnpm typecheck` / `pnpm lint` | verts |
| `pnpm test` | 1 320 verts |
| `pnpm build --force` | vert |
| `E2E_PORT=3119 pnpm test:e2e` | 63 verts, 11 ignorés |
| base vierge `s19_revue2` + `pnpm db:migrate` | **aucune table `billing_*`** |

Module réactivé : `config/features.ts` et `generated/` reviennent à l'identique
(`git diff --exit-code` vert), base vierge migrée deux fois de suite → les trois
tables et l'index à quatre colonnes, la seconde exécution n'ajoute rien.

## 2. Le point central — la déviation de schéma **tient**, et c'est mesuré

La revue demandait de fermer F1 par une contrainte de schéma. L'implémenteur a
refusé et donné deux réfutations. Je les ai rejouées.

**Réfutation 1 — unicité pleine sur `billing_customer_id`.** Sonde temporaire :
index unique créé en base après un premier abonnement, puis livraison du webhook
du second. Résultat : le traitement **lève** une violation d'unicité, le point
d'entrée public échoue — `docs/reliability.md` §1. Puis la variante qu'il décrit
(cible de conflit déplacée sur le client, `provider_subscription_id` réécrit) :
parcours « souscrire le neuf, puis annuler l'ancien » →
`lignes: 1, état: expired, accès: false`. **F1 reproduit à l'identique**, à
l'endroit d'à côté. La réfutation est exacte.

**Réfutation 2 — unicité partielle sur les statuts vivants.** Même sonde, index
partiel `where status in ('active','trialing','past_due')` : le second
abonnement vivant fait **lever** l'écriture, donc échouer le webhook public.
Exacte également — et le constat M3 ci-dessous montre que le second abonnement
vivant n'est pas seulement atteignable par un appel direct : il l'est **depuis
l'écran**.

**Le remplacement tient**, sur les quatre scénarios demandés :

| Scénario | Mesure |
|---|---|
| deux abonnements vivants, `last_event_at` **égal** | déterministe et stable entre deux lectures (départage par la clé primaire) : `active`, quantité 7 |
| événement plus ancien livré **après** une annulation | `expired` — le prédicat `setWhere` le refuse |
| réconciliation relisant tout l'historique | `active`, quantité du neuf |
| base portant déjà les deux lignes | `active`, deux lignes conservées |

L'ordre est total parce que sa dernière clé est la clé primaire. **Une consigne
que la mesure contredit doit céder devant la mesure : c'est le cas ici, et la
déviation est acceptée.** Ce qui lui manque est ailleurs — voir m1 et m4.

## 3. Les mutations posées

Chacune restaurée dans la commande qui la pose, chacune suivie d'un
`git diff --exit-code` vert sur le fichier.

| Ce qui a été neutralisé | Rouges |
|---|---|
| `currentSubscriptionOf` → le premier de la liste | **2** |
| `orderBy` retiré de `subscriptionsOfCustomer` | **1** |
| `billingCatalogue()` retiré de `next.config.ts` | **2** |
| `billingPermissionOf` → `return true` | **1** |
| la garde de session de `/api/billing-local-checkout` | **3** (Playwright) |
| `apps/web/lib/billing.ts#canManage` → `async () => true` | **0** → M1 |
| `apps/web/lib/billing.ts#emailOfScope` → `null` | **0** → M2 |

## 4. Constats

### C1 — critique — `PAYMENTS_LOCAL_MODE` n'est déclaré nulle part que le dépôt contrôle : **la CI est rouge**

`.github/workflows/ci.yml` ne pose que `DATABASE_URL` et `EMAIL_LOCAL_CAPTURE`.
`playwright.config.ts` ne pose pas la variable non plus. `.env` est ignoré par
git et aucune étape du workflow n'en fabrique un. Or `config/features.ts` livre
`billing` **activé**, et la branche `socle` de la matrice ne coupe que
`marketing`, `organizations` et `i18n`.

**Mesuré**, `.env` mis de côté et l'environnement de la CI reproduit (variables
du job + celles du `webServer` de Playwright) :

```
✓ Ready in 266ms
⨯ Failed to load next.config.ts
Error: Le module de facturation est activé mais aucun fournisseur de paiement
n’est configuré : renseignez STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET […]
  at resolveBillingConfig (lib/billing-config.ts:59:11)
curl http://localhost:3121/ → 000        code de sortie du serveur : 1
```

`pnpm test:e2e` échoue donc au démarrage du `webServer`, **dans les deux
branches de la matrice**. Le workflow porte déjà ce cas exact pour
`EMAIL_LOCAL_CAPTURE`, avec un commentaire qui décrit précisément ce mode de
défaillance ; s19 ajoute une quatrième garde de démarrage sans ajouter sa
variable.

**Arbitrage demandé : c'est le même défaut que celui de s18, pas un cas
différent** — et il est porteur ici, puisqu'il rend la CI rouge. Le fait que
`playwright.config.ts` ait été hors périmètre ne le couvre pas : le fichier
manquant est aussi `.github/workflows/ci.yml`, qui ne l'était pas. Les 68
parcours verts de ce poste ne prouvent que le `.env` de ce poste.

### M1 — majeur — F3 n'est pas fermé : la garde de permission **de l'application** reste verte sous mutation

`apps/web/lib/billing.ts`, ligne `const canManage = billingPermissionOf(organizations)`,
neutralisée en `async () => true` — c'est-à-dire *tout `member` souscrit et
annule l'abonnement de son organisation* : `pnpm test` **1 320/1 320 verts**,
`pnpm test:e2e e2e/billing.spec.ts` **6 verts**.

Ce que le tour a fermé est la **règle** (`lib/billing-permission.ts` →
`return true` = 1 rouge, vérifié). Ce qui reste ouvert est le **fil** : le test
reconstruit la composition (`billingPermissionOf({ available: true, view: … })`)
au lieu d'exercer celle de l'application, si bien que `lib/billing.ts` n'est
tenu par rien. C'est le constat F3 déplacé d'une ligne, pas refermé.

Aggravant : `packages/modules/billing/AGENTS.md` inscrit cette mutation comme
« `canManage` de l'application → `return true` | 1 rouge ». `canManage` est
exactement l'identifiant que je mesure **vert**. Le compte est juste pour le
fichier réellement muté, faux pour le symbole qu'il nomme — et c'est ce que le
prochain agent lira.

Balayé aussi : la matrice rôle × action sensible couvre `member`×checkout,
`member`×portail, `owner`×checkout, `admin`×checkout ; `owner`×portail et
`admin`×portail ne le sont pas.

### M2 — majeur — F4 n'est pas fermé non plus : le défaut d'origine se réintroduit sans un rouge

`apps/web/lib/billing.ts#emailOfScope` ramené à `Promise.resolve(null)` — la
forme **exacte** du constat F4 : `pnpm test` **1 320/1 320 verts**,
`pnpm typecheck` vert.

La mutation que le tour rapporte à « 1 rouge » (`customerEmail` → `null`) est
posée **dans le module** : elle prouve que le module transmet ce qu'on lui donne,
ce qui n'a jamais été en doute. Le défaut vivait au point de composition, et le
point de composition n'est toujours pas sous filet. La clôture dit « la
résolution `userId → adresse` n'est pas couverte » ; c'est plus large que cela —
c'est `emailOfScope` **entier** qui ne l'est pas, et la parité invoquée avec
`marketing` décrit une seconde occurrence non couverte, pas une couverture.

### M3 — majeur — un abonné qui clique une autre offre ouvre un **second** abonnement et paie deux fois, sans que l'écran le dise

`openCheckout` ne demande jamais s'il existe déjà un abonnement vivant, et
`checkout.sessions.create({ mode: 'subscription', customer, line_items })`
(`stripe-payments.ts:357`) crée **toujours** un abonnement de plus chez le
fournisseur : le SDK n'offre aucun paramètre de remplacement, et l'adaptateur
n'en passe aucun. `config/billing.ts` livre **deux** offres ; F5 n'a retiré le
bouton que de l'offre **en cours**. Le client se retrouve donc avec deux
abonnements facturés, et `currentSubscriptionOf` n'en affiche qu'un — le second
prélèvement devient **invisible dans l'application**.

Deux endroits du diff affirment le contraire :

- `billing-screen.tsx` : « Changer d'offre reste possible — l'autre carte garde
  son bouton » ;
- `docs/designs/s19-subscribe-stripe.md` : « changer d'offre passe par les autres
  cartes ou par le portail ».

Le sixième critère de la story confie le changement de plan au **portail**. Le
bouton du catalogue le contredit, et c'est un chemin où l'on perd de l'argent
réel. Aucun test ne couvre « un checkout ouvert alors qu'un abonnement vivant
existe ».

### m1 — mineur — l'index ne porte pas l'ordre pour lequel il a été créé

`EXPLAIN` sur la base `s19` :

```
Sort  (Sort Key: last_event_at DESC, current_period_end DESC, provider_subscription_id DESC)
  ->  Index Only Scan using billing_subscription_customer_idx
        Index Cond: (billing_customer_id = 'x')
```

La migration `0001` crée les colonnes en `DESC NULLS LAST` ; `orderBy(desc(…))`
émet `DESC`, c'est-à-dire `NULLS FIRST`. Les clés de tri ne correspondent donc
jamais, et le planificateur trie par-dessus l'index. Le déterminisme est réel,
mais il vient de l'`ORDER BY` **seul** : les trois colonnes ajoutées à l'index ne
servent pas la lecture qui les a motivées. `schema.ts` (« l'index ci-dessous, qui
porte l'ordre de lecture ») et `drizzle-billing-repositories.ts` affirment tous
deux le contraire.

### m2 — mineur — le fil de détente de `webhooks: []` ne balaie que `apps/web`

`tests/module-registry.test.ts` cherche `/\.webhooks\b/` dans les sources de
`apps/web`. Or le répartiteur naturel s'écrirait dans
`packages/core/src/registry.ts`, à côté de `dispatchModuleRequest` — le balayage
ne le verrait pas. Le test le dit lui-même ; `packages/modules/billing/AGENTS.md`,
lui, conclut « Ce n'est donc pas une convention tenue par un commentaire », ce
qui dépasse ce que le balayage couvre.

**Arbitrage demandé** : le tour a **partiellement** fermé ce point. Il y a
désormais une commande, et elle mordra sur le cas le plus probable ; elle ne
couvre pas l'endroit le plus naturel où le répartiteur naîtrait.

### m3 — mineur — `export(scope)` ne rend plus qu'un abonnement sur N

Le contrat dit « rend les données du périmètre »
(`packages/core/src/module.ts:278`). Le module garde délibérément plusieurs
lignes par client ; l'export n'en rend qu'une depuis ce tour, et le test
« n'exporte que l'abonnement courant » fige ce choix.

### m4 — mineur — la déviation n'a pas d'ADR

ADR 034 §2 ordonne les **événements** ; il ne dit rien de « lequel des
abonnements d'un client est le sien ». La décision livrée — index à quatre
colonnes, `currentSubscriptionOf`, plus deux alternatives mesurées et rejetées —
ne vit que dans un docblock de `schema.ts` et dans le plan. `docs/STATE.md` sur
`dev` prévoit qu'« un tour de correction peut consommer un numéro de plus ».

## 5. Ce qui est bien refermé

- **F2** — mesuré **au-delà de `✓ Ready`**, `config/billing.ts` muté avec deux
  offres sur le même prix : `✓ Ready in 231ms` puis `⨯ Failed to load
  next.config.ts`, `BillingConfigError: config/billing.ts : le prix
  « price_pro_monthly » est partagé par les offres…`, `curl` sur `/` **et** sur
  la route de webhook → `000`, code de sortie 1. L'état « application démarrée
  sur un catalogue invalide » est inatteignable, donc la question du 400 contre
  500 est close. Deux rouges à la mutation du câblage.
- **F1** — voir §2.
- **F7** — la garde de session du checkout simulé mord (3 parcours rouges) ; la
  garde est bien aux deux étages (simulateur et route), et le refus est 404 dans
  les trois cas.
- **F8** — pagination suivie et plafonnée, deux cas unitaires sur le curseur.
- **F5, F6, F9** — vérifiés par lecture ; l'écran rend bien un `Badge` « Offre
  en cours » à la place du bouton, et le commentaire de `effectOf` distingue
  désormais les deux cas de réconciliation.
- **Huitième critère** — base vierge, module coupé : aucune table `billing_*`.

## 6. Ce que je n'ai pas pu vérifier

- **La CI elle-même.** J'ai reproduit son environnement en local ; je n'ai pas
  exécuté le workflow sur GitHub. *Geste humain* : pousser la branche et lire le
  job `quality` dans ses **deux** branches de matrice avant toute fusion.
- **Stripe réel.** `stripe-live.test.ts` n'a toujours pas été exécuté (exige
  `STRIPE_LIVE_TEST=1`, une `sk_test_…` et un prix). Tout ce qui est affirmé du
  fournisseur vient du SDK contre un réseau doublé. *Geste humain* : lancer la
  recette contre un compte de test avant le premier encaissement ; vérifier au
  tableau de bord que le client créé porte une adresse (M2), **et** qu'un second
  checkout sur la seconde offre crée bien un second abonnement facturé (M3).
- **Le portail client.** Ce qu'il autorise dépend de sa configuration sur le
  compte Stripe, qu'aucun code de ce diff ne pose. Sixième critère non
  vérifiable ici. *Geste humain* : ouvrir le portail sur le compte de test et
  cocher les trois capacités.
- **Le vrai désordre de livraison, la fenêtre de tolérance réelle, les rejeux de
  Stripe.** Tous les événements sont forgés et signés localement.
- **`expired` et `past_due` au navigateur** : le simulateur local ne sait pas
  les produire.
- **La facturation au siège de bout en bout** : `perSeat: true` n'existe que
  dans le catalogue du test.
- **Le rendu.** Je n'ai rendu aucun écran moi-même ; je m'appuie sur les
  parcours Playwright et sur les captures de la première revue. *Geste humain* :
  revoir `/billing` en 390 px et 1440 px, thèmes clair et sombre, avec un
  abonnement en cours, pour juger le badge « Offre en cours » — et lire ce que
  l'écran dit à quelqu'un qui a deux abonnements (M3).
- **La charge** : taille du corps du webhook public et limitation de débit,
  toujours non mesurées (dette s28).
- **La concurrence** : je n'ai pas rejoué la sonde de rejeu concurrent de la
  première revue.

## 7. Verdict

La partie difficile reste bien faite, et le tour de correction a fermé ce qu'il
annonçait fermer sur les deux critiques d'origine : le catalogue échoue
maintenant au démarrage, mesuré au-delà de `✓ Ready`, et l'abonnement d'un client
qui se réabonne est celui qui donne l'accès. **La déviation de schéma est
justifiée par la mesure**, et je la valide : les deux contraintes rejetées
cassent réellement, l'ordre total est réellement total, et il tient sur les
quatre scénarios que je lui ai opposés.

Ce qui bloque n'est pas la déviation. C'est qu'une story qui ajoute une garde de
démarrage n'a pas donné à la CI de quoi la satisfaire : les parcours échoueront
au premier push, dans les deux configurations, et l'arbre vert de ce poste ne
tient qu'à son `.env`. Et c'est que les deux constats majeurs du premier tour —
F3 et F4 — ont chacun reçu un filet qui attrape **la règle** et laisse passer
**le câblage** : les deux mutations que la première revue avait posées au point
de composition y restent vertes, l'une d'elles étant portée au tableau des
mutations comme si elle mordait.

Max severity: critical
Ship allowed: no

---

## 8. Clôture du second tour de correction — commit `d95aea2`

Les huit constats de la seconde revue sont traités. Chaque mutation a été posée
**à l'endroit exact du défaut** — c'est la leçon de M1 et M2, et elle a été
appliquée à toutes les autres.

### C1 — la CI démarre, mesuré

`PAYMENTS_LOCAL_MODE=1` est déclaré dans **les deux** fichiers du harnais :
`.github/workflows/ci.yml` (niveau job `quality`, comme `EMAIL_LOCAL_CAPTURE`)
et `playwright.config.ts` (le serveur que Playwright démarre, comme
`AUTH_SECRET`, `APP_URL` et `OAUTH_LOCAL_PROVIDER`).

Environnement de la CI reproduit — variables du job **plus** celles du
`webServer`, `.env` du poste mis de côté, `env -i` :

| Environnement | `curl http://localhost:3121/` | Processus |
|---|---|---|
| avec `PAYMENTS_LOCAL_MODE=1` | **307** (redirection de locale) | vivant |
| sans le drapeau | `000` | **mort**, code 1, message nommant les trois variables |

Et la règle est exécutable, dans trois cas de `tests/env-wiring.test.ts` :

- la configuration de Next démarre avec l'**union** des deux fichiers et rien
  d'autre — toute variable du schéma absente de ces deux fichiers est posée
  vide, donc lue comme absente ;
- `resolveBillingConfig` rend `local` sur l'environnement du job de CI seul ;
- idem sur l'environnement du `webServer` seul.

Les deux derniers cas sont ce qui rend **chacune** des deux déclarations
porteuse : retirer la variable de l'un des fichiers fait rougir son cas, et lui
seul. Conséquence assumée, écrite dans `apps/web/AGENTS.md` : un poste muni
d'une vraie clé Stripe verra `pnpm test:e2e` refuser de démarrer en nommant le
conflit — ces parcours ne sauraient pas se dérouler contre un vrai fournisseur.

### M1 et M2 — le fil, pas seulement la règle

`billing.prepare()` accepte trois substitutions, et trois seulement : la
connexion, le port `Payments` et l'`APP_URL` — c'est-à-dire exactement ce que ce
fichier irait chercher dans l'ambiance. Même forme que `createAppMailer({ env })`
(« injecté dans les tests ; lu au démarrage sinon »). Le périmètre, la
permission, les sièges, l'adresse et le catalogue restent ceux de l'application.

`tests/billing.test.ts` branche donc le **vrai** objet `billing` sur la base du
test, et mesure deux choses : un `member` d'organisation refusé aux deux portes,
sans écriture ni appel sortant ; et l'adresse du compte appelant telle que le
**réseau** la voit partir. Le bloc ne rejoue pas la matrice de rôles — elle
appartient au bloc de la règle, et la rejouer multiplierait la même décision par
une porte de plus.

Il ne s'exécute que si `billing` **et** `organizations` sont activés : sans
`organizations`, tout périmètre est un compte et la permission n'a personne à
qui poser la question. La configuration « socle » de la CI le saute, comme
`tests/organizations.test.ts` saute les siens.

Le tableau des mutations de `packages/modules/billing/AGENTS.md` est corrigé :
les deux lignes fautives nomment désormais le fichier réellement muté (la règle
voisine, le module), et les deux mutations du point de composition ont leur
propre ligne.

### M3 — le catalogue se ferme à qui a déjà l'accès

Arbitrage retenu : celui que la seconde revue proposait. Le changement d'offre
passe par le **portail** (sixième critère), donc le catalogue ne propose plus de
souscrire à qui a déjà l'accès.

- **côté serveur** — `openCheckout` refuse en `409` (`already_subscribed`) quand
  `grantsAccess` est vrai pour le périmètre, **sans appeler le fournisseur** et
  sans écrire ;
- **côté écran** — la carte de l'offre en cours garde son `Badge` « Offre en
  cours », les autres rendent une ligne qui renvoie à « Gérer la facturation ».
  Aucun bouton « Souscrire » ne subsiste ;
- **la réouverture est mesurée** — un abonnement qui ne donne plus l'accès rend
  ses boutons à toutes les cartes et laisse le checkout passer en `200` : c'est
  le parcours « annuler puis se réabonner » du constat F1, qui ne devait pas
  être fermé au passage.

Le refus est côté serveur parce que masquer un bouton n'est pas une permission.

### m1, m2, m3, m4

- **m1** — migration `0002` : l'index passe en `DESC NULLS FIRST`, ce que
  `desc()` émet dans la requête. `EXPLAIN` avant : `Sort` par-dessus un
  `Index Scan`. Après : `Index Only Scan`, plus de `Sort`. L'ordre de lecture est
  désormais écrit **une seule fois** (`subscriptionReadOrder`), et
  `tests/billing.test.ts` le passe à `EXPLAIN` — `enable_seqscan` **et**
  `enable_bitmapscan` coupés le temps de la transaction, le second parce qu'un
  parcours par bitmap ne rend aucun ordre et retrie toujours : sans lui le cas
  échouait sur une base fraîchement migrée, pour une raison qui n'était pas la
  sienne.
- **m2** — le fil de détente balaie maintenant deux périmètres : `apps/web`
  (lecture de `.webhooks` **ou** invocation d'un gestionnaire) et
  `packages/core/src` (invocation seulement — y lire `.webhooks` est le travail
  normal du registre, qui les agrège). Ce sont les deux périmètres balayés, et
  ce sont les seuls : ni les modules, ni `tests/`.
- **m3** — `export(scope)` rend **tous** les abonnements du périmètre, dans
  l'ordre de lecture. Le commentaire dit explicitement que cet ordre n'est pas
  celui de `currentSubscriptionOf` : quand l'ancien abonnement est annulé après
  la souscription du neuf, c'est l'annulation qui ouvre la liste.
- **m4** — **ADR 037**, avec les deux contraintes de schéma mesurées, la raison
  précise pour laquelle chacune casse, les deux autres options rejetées, et les
  trois conséquences à surveiller — à commencer par celle-ci : l'invariant
  n'est **pas** en base, il est tenu par un refus applicatif.

### Les mutations posées, et ce qu'elles ont fait rougir

Chacune restaurée dans la commande qui la pose, arbre vérifié après restauration.

| Ce qui a été neutralisé | Rouges |
|---|---|
| `apps/web/lib/billing.ts#canManage` → `async () => true` | **1** |
| `apps/web/lib/billing.ts#emailOfScope` → `null` | **1** |
| `PAYMENTS_LOCAL_MODE` retiré de `.github/workflows/ci.yml` | **1** |
| `PAYMENTS_LOCAL_MODE` retiré de `playwright.config.ts` | **1** |
| le refus `already_subscribed` d'`openCheckout` | **1** |
| l'écran rendu aux boutons de l'ancienne règle (`offer.current`) | **3** |
| l'index recréé en `DESC NULLS LAST` (mutation en base) | **1** |
| un répartiteur de webhooks dans `packages/core/src/registry.ts` | **1** |

Les deux premières sont exactement celles que la seconde revue avait mesurées
vertes.

### Les commandes, dans les deux configurations

Configuration livrée (`billing` **activé**) :

| Commande | Résultat |
|---|---|
| `pnpm typecheck` | 19 tâches vertes |
| `pnpm lint --max-warnings=0` | aucun avis |
| `pnpm test` | 37 fichiers, **1 329** verts, 6 ignorés |
| `pnpm build --force` | vert |
| `E2E_PORT=3119 pnpm test:e2e` | **68** verts, 6 ignorés |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert |
| `pnpm db:migrate` deux fois | seconde exécution : rien à appliquer |

Seconde configuration (`pnpm ks toggle billing`, module **coupé**) :

| Commande | Résultat |
|---|---|
| `pnpm typecheck` / `pnpm lint --max-warnings=0` | verts |
| `pnpm test` | 1 327 verts, 8 ignorés |
| `pnpm build --force` | vert |
| `E2E_PORT=3119 pnpm test:e2e` | 63 verts, 11 ignorés |
| `pnpm run audit` | identique |

Module réactivé : `config/features.ts` et `generated/` reviennent à l'identique
(aucune ligne dans `git status`). Base **vierge** `s19_fix2`, migrée deux fois :
les trois tables `billing_*`, l'index à quatre colonnes en `DESC`, et la seconde
exécution n'ajoute rien.

### La vérification visuelle

Navigateur (Chromium), `/billing` en 390 px et 1440 px, thèmes clair et sombre,
compte réel, abonnement souscrit par le simulateur :

- **avant abonnement** : 2 boutons « Souscrire », un par offre ;
- **après abonnement** : **0** bouton « Souscrire », 1 `Badge` « Offre en
  cours » sur la carte souscrite, 1 renvoi « Pour changer d'offre, passez par
  « Gérer la facturation ». » sur l'autre, 1 bouton « Gérer la facturation »
  dans la carte d'abonnement. Les quatre captures sont lisibles dans les deux
  thèmes ; en 390 px les cartes s'empilent et le renvoi tient sur deux lignes
  sans débordement.

**Limite de cette mesure, dite plutôt que sous-entendue** : elle a été faite sous
`next dev`, et non sous le build de production. Ce n'est pas un choix de
commodité — `PAYMENTS_LOCAL_MODE` est **refusé sous `NODE_ENV=production`**, et
`next start` pose ce mode : l'état « abonné » est donc inatteignable sous un
build de production sans une vraie clé Stripe. La conséquence connue est que la
politique de sécurité du contenu y est assouplie (`unsafe-inline` dans
`style-src`), donc qu'un style en ligne ne serait pas signalé. Ce que ce tour
ajoute à l'écran est un `<p className="text-sm text-muted-foreground">`, une
composition déjà présente sur ce même écran.

### Ce qui reste ouvert

- **Stripe réel** : `stripe-live.test.ts` n'a toujours pas été exécuté. *Geste
  humain* : recette contre un compte de test avant le premier encaissement,
  vérifier au tableau de bord que le client créé porte une adresse.
- **Le portail client** dépend de sa configuration sur le compte Stripe ; le
  sixième critère reste non vérifiable ici — et il porte désormais **davantage** :
  c'est lui, et lui seul, qui permet de changer d'offre. *Geste humain* : ouvrir
  le portail sur le compte de test et vérifier que le changement de plan y est
  activé avant de livrer.
- **`expired` et `past_due` au navigateur** : toujours pas produits par le mode
  local ; ils sont couverts par rejeu d'événements.
- **La facturation au siège de bout en bout** : `perSeat: true` n'existe que dans
  le catalogue du test.
- **La limite de taille du corps du webhook et la limitation de débit** :
  toujours non mesurées, dette s28.
- **La CI elle-même** n'a pas été exécutée sur GitHub : son environnement a été
  reproduit en local. *Geste humain* : lire le job `quality` dans ses **deux**
  branches de matrice avant la fusion.

### Le gate

Les deux lignes ci-dessous décrivent **la seconde revue, du commit `d604e5c`**,
et elles sont laissées telles quelles : un tour de correction n'est pas une
revue, et l'implémenteur ne s'auto-délivre pas le passage.

**Une troisième revue est nécessaire**, et pour deux raisons précises, pas par
principe :

1. **le changement de comportement de M3 n'a jamais été relu.** Fermer le
   catalogue à un abonné retire une action que la story livrait ; c'est un
   arbitrage de produit autant que de sécurité financière, et il touche l'écran,
   la route, le contrat de refus et le design ;
2. **la migration `0002` et ADR 037 sont nouveaux.** Une migration et une
   décision structurelle ne se relisent pas dans le tour qui les écrit.

Max severity: critical
Ship allowed: no

---

# Troisième revue — delta `d604e5c..d95aea2`

Périmètre **strictement** le delta du second tour de correction : 27 fichiers,
1 243 insertions. Ce que les deux revues précédentes ont validé n'est pas rejoué,
sauf là où le delta le touche. Base `s19`, worktree
`/Users/olivier/www/boilerplate/.claude/worktrees/agent-a57fb834ceaad2d7c`.

Aucune liste de cette section n'est exhaustive : chaque relevé dit **ce qui a été
balayé**, et sur combien de cas.

## 1. Ce qui a été exécuté, par moi

Configuration livrée (`billing`, `organizations`, `i18n`, `marketing` **activés**) :

| Commande | Résultat |
|---|---|
| `pnpm typecheck --force` | 19 tâches vertes, **0 en cache** |
| `pnpm lint --max-warnings=0` | aucun avis |
| `pnpm test` | 37 fichiers, **1 329** verts, 6 ignorés |
| `pnpm build --force` | vert |
| `E2E_PORT=3119 pnpm test:e2e` | **68** verts, 6 ignorés |
| `pnpm run audit` | 1 avis, aucun au seuil « élevé » non couvert |

Seconde configuration (`pnpm ks toggle marketing organizations i18n`, `billing`
**resté activé** — c'est la branche `socle` de la matrice) :

| Commande | Résultat |
|---|---|
| `pnpm typecheck --force` / `pnpm lint --max-warnings=0` | verts |
| `pnpm test` | **1 327** verts, 8 ignorés |
| `pnpm build --force` | vert |
| `E2E_PORT=3119 pnpm test:e2e` | **55** verts, **19** ignorés |
| `pnpm run audit` | identique |

Configuration restaurée ensuite : `git status --porcelain` ne rend que ce
rapport, `git diff --exit-code` est vide.

Base **vierge** `s19_rev3`, `pnpm db:migrate` **trois** fois de suite : la
première applique, les suivantes disent « Rien à appliquer : aucune migration en
attente ». L'index créé y est bien
`btree (billing_customer_id, last_event_at DESC, current_period_end DESC,
provider_subscription_id DESC)` — `DESC` seul, c'est-à-dire `NULLS FIRST`.

## 2. Le point central — M1 et M2, reposés à l'endroit du défaut

Ce sont exactement les deux mutations que la seconde revue avait mesurées
**vertes**. Chacune posée dans `apps/web/lib/billing.ts`, restaurée dans la même
commande, `git diff --exit-code` sur le fichier vérifié après chaque restauration.

| Mutation, au point de composition | Rouges mesurés |
|---|---|
| `const canManage = billingPermissionOf(organizations)` → `const canManage = async () => true` | **1** (`[403,403]` devient `[502,409]`) |
| le corps d'`emailOfScope` → `return null` | **1** (l'adresse vue partir sur le réseau devient `null`) |

Les deux mordent. **C'est le point le plus important de ce tour, et il est
fermé.** Le rouge de la permission est instructif au-delà du compte : il ne dit
pas « 403 attendu, 403 reçu », il montre les deux portes s'ouvrant réellement
(`502` sur le checkout, faute de fournisseur joignable, et `409` sur le portail),
c'est-à-dire un `member` arrivé jusqu'au fournisseur.

Ce que ce filet ne couvre pas, et qui n'est pas dit ailleurs : **il ne s'exécute
pas dans la branche `socle` de la matrice**. Mesuré — 1 329 cas en configuration
livrée, 1 327 en `socle` : ce sont ces deux-là qui sautent, `organizations`
étant coupé. Les deux gardes qui ont coûté deux tours de revue sont donc tenues
dans **une** des deux branches de la CI.

## 3. C1 — le démarrage en CI, les deux branches de la matrice

Environnement du workflow reproduit à la main : `env -i`, `.env` du poste **mis
de côté** (restauré ensuite, empreinte MD5 identique), variables du job `quality`
(`DATABASE_URL`, `EMAIL_LOCAL_CAPTURE`) **plus** celles du `webServer` de
Playwright (`AUTH_SECRET`, `APP_URL`, `I18N_MISSING_KEY_PROBE`,
`OAUTH_LOCAL_PROVIDER`), puis `next dev`.

| Configuration de modules | Avec `PAYMENTS_LOCAL_MODE=1` | Sans |
|---|---|---|
| livrée (`tous`) | `curl /` → **307**, serveur vivant | `curl /` → `000`, `⨯ Failed to load next.config.ts` |
| `socle` | `curl /` → **307**, `GET / 307 in 1884ms` | `curl /` → `000`, même échec |

Le message d'échec nomme les trois variables :

```
Error: Le module de facturation est activé mais aucun fournisseur de paiement
n’est configuré : renseignez STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET pour
encaisser, ou PAYMENTS_LOCAL_MODE=1 pour simuler les paiements en local sans
rien encaisser.
    at resolveBillingConfig (lib/billing-config.ts:59:11)
```

Et la règle est exécutable, mesurée aux deux fichiers :

| Mutation | Rouges |
|---|---|
| `PAYMENTS_LOCAL_MODE` retiré de `.github/workflows/ci.yml` | **1** (`tests/env-wiring.test.ts`) |
| `PAYMENTS_LOCAL_MODE` retiré de `playwright.config.ts` | **1** (idem) |

Chacune des deux déclarations est donc porteuse séparément. **C1 est fermé.**

Une précision sur la forme de l'échec, qui n'est écrite nulle part : le
processus `next dev` meurt, mais le `pnpm` qui l'enveloppe reste vivant. En CI,
Playwright n'observera donc pas une sortie immédiate mais l'expiration de son
`timeout: 120_000` sur l'`url`. Le job échoue dans les deux cas ; il échoue
120 secondes plus tard qu'on ne le croirait.

## 4. M3 — le changement de comportement, jugé

**Contre les critères de la story.** Le sixième critère
(`docs/stories.md:528`) confie explicitement au portail le fait de « changer de
plan ». Le troisième dit « le choix d'une offre en mode `subscription` ouvre un
checkout Stripe » — il reste tenu pour qui n'a pas d'abonnement, et aucun critère
ne promet à un abonné d'en souscrire un second. **L'arbitrage ne retire donc
aucune action que la story exigeait** : il retire une action que
l'implémentation offrait en trop, et dont la seconde revue a montré qu'elle
facturait deux fois.

**Un second abonnement facturé est-il réellement devenu inatteignable ?** Balayé
sur ces points, et pas d'autres :

- **le chemin d'appel est unique.** `payments.createCheckout` n'a qu'un seul
  appelant de production dans tout le dépôt —
  `billing-use-cases.ts:315` — et le refus est **au-dessus** de lui, dans le même
  `openCheckout`. Le bouton retiré de l'écran n'est pas la garde ;
- **le refus mord.** Neutralisé (`if (false && grantsAccess(current, at))`) :
  **1 rouge**, et le cas mesure ce qu'il faut — `409`, corps
  `refusal.alreadySubscribed`, **aucun appel sortant** (`calls` vide) et une
  seule ligne en base ;
- **l'écran suit la même règle.** `subscribed={view.hasAccess}`, et `hasAccess`
  est `grantsAccess(currentSubscriptionOf(...))` — la fonction que le refus
  serveur appelle. Écran et route ne peuvent pas diverger. Revenu à l'ancienne
  règle par carte : **2 rouges** unitaires, plus le parcours ;
- **la réouverture est tenue.** L'abonnement terminé rend ses boutons et laisse
  le checkout passer en `200` : le parcours F1 n'a pas été refermé au passage ;
- **preuve navigateur.** `e2e/billing.spec.ts` a tourné chez moi : après
  souscription réelle par le simulateur, `0` bouton « Souscrire », le renvoi
  « Pour changer d'offre… » visible et le badge « Offre en cours » présent.

Deux fenêtres restent ouvertes, et elles ne sont **pas** écrites dans l'ADR :

- **`incomplete` n'accorde pas l'accès** (`domain/subscription.ts:56-62`). Un
  périmètre dont le premier abonnement est resté `incomplete` peut donc ouvrir un
  checkout sur une autre offre ; si le premier se dénoue ensuite, deux
  abonnements coexistent. C'est le prix, assumé, de laisser réessayer un paiement
  échoué ;
- **le refus lit un cache.** Entre la fin d'un checkout et l'arrivée de son
  webhook, `grantsAccess` est encore faux : deux checkouts ouverts dans cette
  fenêtre créent deux abonnements. L'ADR dit bien « l'invariant n'est pas en
  base » ; il ne nomme pas cette fenêtre-ci.

Aucune des deux n'est atteignable par un clic ordinaire, et aucune ne
réintroduit le défaut M3 tel qu'il était (un bouton offert en permanence à tout
abonné). Je les classe **mineures**, à écrire, pas à corriger.

## 5. Migration `0002` et ADR 037 — premiers relus

**La migration.** Deux instructions, `DROP INDEX` puis `CREATE INDEX` sur un
index **non unique**. Additive au sens qui compte : aucune colonne, aucune
donnée, aucune contrainte touchée ; la version encore en ligne continue de servir
la même requête, avec ou sans l'index — elle perdrait au pire un plan, jamais un
résultat. Rejouable : la journalisation Drizzle la marque, et trois `db:migrate`
d'affilée sur une base vierge n'appliquent rien après le premier.

**L'`EXPLAIN`, mesuré par moi** sur la base `s19`, `enable_seqscan` et
`enable_bitmapscan` coupés :

```
Index Only Scan using billing_subscription_customer_idx on billing_subscription
  Index Cond: (billing_customer_id = 'bc_s19_explain'::text)
```

Plus de `Sort` — le constat m1 est fermé. Et le cas qui le mesure mord : l'index
recréé **en base** en `DESC NULLS LAST`, `tests/billing.test.ts` passe au rouge
(**1**), index restauré et vérifié ensuite. Le cas est de la bonne espèce : il
lit l'ordre du dépôt (`subscriptionReadOrder`) au lieu de le recopier.

Une réserve, mineure : `DROP INDEX` + `CREATE INDEX` sans `CONCURRENTLY` bloque
les écritures de `billing_subscription` le temps de la reconstruction. Sur la
table d'un boilerplate neuf, c'est instantané ; sur une base déjà chargée, c'est
une fenêtre d'indisponibilité en écriture que la migration ne signale pas.
`docs/reliability.md` §4 parle de compatibilité ascendante, pas de verrous — ce
n'est donc pas une violation, c'est une chose à écrire.

**L'ADR 037.** Format MADR, statut `accepted`, numéro libre (le dépôt de base
porte 032 et 033, la branche porte 034 ; aucun conflit). Il retient **quatre**
options rejetées, pas deux, et chacune avec la mesure qui la tue : unicité pleine
sur `billing_customer_id` (deux variantes — l'une lève sur le webhook public,
l'autre **reproduit F1 à l'identique**, `lignes: 1, état: expired, accès: false`),
unicité partielle sur les statuts vivants (transforme le webhook en `500`
permanent), tri sur `last_event_at` seul, et suppression des lignes terminées. La
section « Consequences » nomme la vraie fragilité —  *l'invariant n'est pas en
base, il est tenu par un refus applicatif*. C'est exactement ce qu'un ADR doit
porter. **Retenu.**

## 6. `prepare(runtime?)` — l'ouverture, jugée

Elle est **bornée**, et je la valide :

- trois champs, tous optionnels, tous repliant sur l'ambiance : `db`, `payments`,
  `appUrl` — c'est-à-dire exactement ce que ce fichier irait chercher tout seul ;
- ce qu'elle **ne** donne pas est le point, et je l'ai vérifié ligne à ligne dans
  `provide()` : `ownerOf`, `canManage`, `seatsOf`, `emailOfScope` et `catalogue`
  ne sont **pas** substituables. Un appelant ne peut donc pas s'accorder une
  permission, un périmètre, un catalogue ni une adresse ;
- un seul appelant de production, `apps/web/lib/module-services.ts:74`, et il
  appelle `billing.prepare()` **sans argument** ;
- la forme est celle qui existe déjà (`createAppMailer({ env })`).

Ce que je n'accorde pas : **aucune commande n'échoue** si un futur appelant de
production passe un `runtime`. L'ouverture est bornée par le type, pas par une
règle exécutable — et `AGENTS.md` demande justement de se poser la question
« quelle commande échoue si on la casse ? ». C'est mineur, parce que le pire
qu'un tel appelant puisse injecter est une connexion, un port ou une URL de
retour, tous trois déjà sous le contrôle du serveur.

## 7. Constats

Aucun critique. Aucun majeur.

### n1 — mineur — les chiffres de la clôture ne se reproduisent pas en `socle`

La clôture annonce, module coupé, `pnpm test:e2e` à « 63 verts, 11 ignorés ». Ma
mesure, dans la configuration `socle` exacte du workflow (`marketing`,
`organizations`, `i18n` coupés) : **55 verts, 19 ignorés**, deux fois de suite.
Les 19 ignorés sont tous légitimes (parcours `i18n`, `marketing`,
`organizations`, `public-forms`, plus le cas « billing coupé »). Aucun code n'est
en cause : c'est un chiffre rapporté qui ne décrit pas la configuration qu'il
nomme, et le prochain agent le lira comme une mesure.

### n2 — mineur — le filet du point de composition ne tourne pas en `socle`

Voir §2. Les deux cas qui ferment M1 et M2 sautent quand `organizations` est
coupé. C'est justifié (sans organisations, la permission n'a personne à qui poser
la question) et c'est écrit dans le code ; la conséquence — *ces deux gardes ne
sont éprouvées que dans une branche de matrice sur deux* — ne l'est nulle part.

### n3 — mineur — le fil de détente de `webhooks: []` s'évite en déstructurant

Le motif cherché dans `packages/core/src` est `.handle(`. Un répartiteur écrit
`const { handle } = w; await handle(event)` ne le déclenche pas, et `.webhooks`
n'est balayé que dans `apps/web`. **Mesuré** : un répartiteur ajouté à
`packages/core/src/registry.ts` sous la forme `await h.handle(e)` fait bien
**1 rouge**. Le tour a donc élargi le balayage au bon endroit ; il reste textuel,
et `AGENTS.md` le décrit correctement comme « les deux périmètres balayés ». À
l'inverse, tout `.handle(` sans rapport avec un webhook, ajouté dans `apps/web`
ou `packages/core/src`, fera rougir ce cas avec un message trompeur.

### n4 — mineur — `subscriptionReadOrder` sort par le baril principal

L'ordre de lecture est un tableau d'expressions SQL Drizzle, donc de
l'`infrastructure`, exporté depuis `packages/modules/billing/src/index.ts` pour
un unique consommateur : un test. Le lint des frontières l'accepte (le baril
exporte déjà `configureBilling` et le schéma), et la raison écrite — « ne pas
avoir deux vérités, dont l'une mesure » — est bonne. C'est de la surface
publique en plus, pour un besoin de mesure.

### n5 — mineur — deux fenêtres à deux abonnements, non écrites dans l'ADR

Voir §4 : le statut `incomplete`, et la fenêtre entre la fin d'un checkout et
l'arrivée de son webhook. L'ADR dit que l'invariant n'est pas en base ; il ne
nomme pas ces deux chemins-là.

### n6 — mineur — la migration `0002` reconstruit l'index sans `CONCURRENTLY`

Voir §5. Compatible et rejouable ; pas sans verrou.

## 8. Ce que je n'ai pas pu vérifier

- **La CI elle-même.** J'en ai reproduit l'environnement en local, dans les deux
  branches de la matrice. Je n'ai pas exécuté le workflow sur GitHub. *Geste
  humain* : pousser et lire le job `quality` dans ses deux branches avant la
  fusion.
- **L'état « abonné » sous un build de production.** Ma preuve navigateur vient
  de `e2e/billing.spec.ts`, et le `webServer` de Playwright lance `next dev` :
  comme le mode de paiement local est **refusé** sous `NODE_ENV=production`
  (`lib/billing-config.ts`), cet état est inatteignable sous `next start` sans
  une vraie clé Stripe. Ce qui n'est donc **pas** mesuré sur le nouvel écran :
  la politique de sécurité du contenu de production, plus stricte sur
  `style-src`. L'ajout est un `<p className="text-sm text-muted-foreground">`,
  sans style en ligne — le risque est nul à la lecture, pas mesuré. *Geste
  humain* : revoir `/billing` abonné en 390 px et 1440 px, thèmes clair et
  sombre, contre un compte de test réel.
- **Le portail Stripe.** `billingPortal.sessions.create` ne passe **aucune**
  `configuration` (`stripe-payments.ts:395-401`) : le portail servi est celui du
  tableau de bord. Or M3 fait de ce portail le **seul** chemin de changement
  d'offre. Si le compte n'y a pas activé le changement de plan, le produit n'en a
  plus aucun. *Geste humain, désormais bloquant pour le sixième critère* : ouvrir
  le portail sur le compte de test et vérifier que le changement de plan y est
  activé, avant le premier encaissement.
- **Stripe réel.** `stripe-live.test.ts` n'a pas été exécuté (exige
  `STRIPE_LIVE_TEST=1`). Tout ce qui est affirmé du fournisseur vient du SDK
  contre un réseau doublé — y compris « un second checkout crée toujours un
  second abonnement », qui est la prémisse de M3.
- **La concurrence** sur le refus `already_subscribed` : deux checkouts
  simultanés, jamais joués.
- **`expired` et `past_due` au navigateur**, la facturation au siège de bout en
  bout, la taille du corps du webhook et la limitation de débit (dette s28) :
  inchangés depuis la seconde revue, toujours non mesurés.
- **Le comportement de `0002` sur une table volumineuse** : mesuré sur une base
  de quelques lignes seulement.

## 9. Verdict

Les trois choses que ce tour devait fermer sont fermées, et je les ai mesurées
moi-même, chaque mutation posée là où vivait le défaut : **M1 et M2 mordent au
point de composition** (1 rouge chacune, là où la revue précédente comptait zéro),
**la CI démarre dans les deux branches de la matrice** et meurt sans le drapeau en
nommant ses variables, **le second abonnement facturé n'est plus atteignable par
le chemin livré** — le refus est au-dessus du seul appelant de `createCheckout`,
il mord, et il ne referme pas le parcours « annuler puis se réabonner ».

Les deux pièces jamais relues tiennent : la migration `0002` est additive,
rétrocompatible et rejouable, l'`EXPLAIN` ne porte plus de `Sort`, et l'ADR 037
retient quatre options rejetées avec la mesure qui tue chacune, en nommant sa
propre fragilité. L'ouverture de `prepare(runtime?)` est bornée aux trois choses
que ce fichier irait chercher dans l'ambiance, et ne laisse substituer ni
permission, ni périmètre, ni catalogue, ni adresse.

Ce qui reste est de la trace à écrire, pas du code à changer : des chiffres de
clôture qui ne décrivent pas la configuration qu'ils nomment, un filet qui ne
tourne que dans une branche de matrice sur deux, deux fenêtres à deux abonnements
absentes de l'ADR, et un fil de détente textuel qui s'évite en déstructurant.
Rien de cela ne facture personne deux fois ni ne casse la CI.

Le sixième critère reste, lui, suspendu à une configuration hors du dépôt — et il
porte davantage depuis M3. C'est une vérification humaine avant le premier
encaissement, pas un blocage de fusion.

Max severity: minor
Ship allowed: yes
