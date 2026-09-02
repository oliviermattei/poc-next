# Recherche — s19-subscribe-stripe

> Ce qui suit est **mesuré** dans les paquets installés et dans l'arbre du dépôt
> au 01/09/2026, branche `feature/s19-subscribe-stripe` sur `4417cb4`. Les
> affirmations sur Stripe viennent de `stripe@22.6.0` déposé dans
> `packages/adapters/stripe/node_modules/stripe`, jamais de la documentation en
> ligne : une version d'API se démode, et une approximation ici coûte de
> l'argent réel.
>
> Aucune liste de ce document n'est exhaustive. Chaque relevé dit **ce qui a été
> balayé** et sur combien de cas.

## 1. Ce que la story demande, et ce qu'elle ne demande pas

`docs/stories.md` § s19 : neuf critères. Traduits en obligations exécutables :

| Critère | Ce qui le tient |
|---|---|
| 1 — offres dans une configuration typée, une offre malformée fait échouer le démarrage | `config/billing.ts` + un schéma Zod dans le `domain` du module, appliqué au démarrage par `apps/web/next.config.ts` |
| 2 — interface `Payments` typée, seule surface appelée | `packages/ports/src/payments.ts` + lint de couches (ADR 006) |
| 3 — checkout puis retour affiche l'abonnement actif | route `POST /billing/checkout`, écran `/billing`, parcours Playwright en mode local |
| 4 — webhook met à jour l'état, idempotent au rejeu | route publique `POST /billing/webhook`, table `billing_webhook_event` en clé primaire |
| 5 — signature invalide → 400 sans effet | vérification **avant** toute écriture, dans l'adaptateur |
| 6 — portail client | route `POST /billing/portal` |
| 7 — annulé = accès jusqu'à la fin de la période payée | fonction pure `accessOf(subscription, now)` |
| 8 — module coupé : rien | registre (`buildRegistry`), écran en 404, aucune table sur base vierge |
| 9 — CI : rejeu d'événements enregistrés ; hors CI : clés de test | `packages/adapters/stripe/src/stripe-payments.test.ts` (réseau doublé, SDK réel) et `stripe-live.test.ts` (opt-in) |

**Hors périmètre, et le cimetière est contraignant** (`docs/prd.md`) :
facturation à l'usage, fournisseurs autres que Stripe, page de tarifs (s22),
achat unique (s20), gating par offre (s21), métriques de revenus (s38).
`config/billing.ts` porte le **mode** `one_time` dans son type parce que le
critère 1 le nomme ; s19 n'ouvre de checkout que pour `subscription` et refuse
l'autre en nommant l'offre — livrer un chemin `payment` non éprouvé serait pire
que de le refuser.

## 2. `stripe@22.6.0` — ce qui a été relevé dans le paquet installé

### 2.1 Version d'API

`esm/apiVersion.d.ts` : `ApiVersion = "2026-08-26.dahlia"`. Les types du paquet
ne décrivent **que** cette version (`apiVersion?: LatestApiVersion` dans
`esm/lib.d.ts`). Conséquence : la version est passée explicitement au
constructeur, et une montée du paquet devient une décision visible plutôt qu'un
changement de forme silencieux des objets reçus.

### 2.2 Le piège qui coûte de l'argent : `current_period_end` n'est plus sur l'abonnement

Mesuré : `esm/resources/Subscriptions.d.ts` ne déclare **aucun**
`current_period_end` sur l'objet `Subscription` (seulement
`cancel_at_period_end` l. 135, `status` l. 263, `trial_end` l. 275).
`esm/resources/SubscriptionItems.d.ts` l. 54 et 58 portent
`current_period_end` / `current_period_start`.

La fin de période payée se lit donc sur **les lignes** de l'abonnement
(`subscription.items.data[].current_period_end`), pas sur l'abonnement. Un code
écrit de mémoire lirait `subscription.current_period_end`, obtiendrait
`undefined`, et un `new Date(undefined)` ferait perdre l'accès à un client qui
paie — ou le lui laisserait pour toujours, selon le sens du repli. C'est le
premier constat de cette recherche.

Décision : le port normalise, et l'adaptateur prend **le maximum** des
`current_period_end` des lignes (une seule ligne dans les offres livrées ;
prendre le maximum est le repli qui n'enlève jamais un accès payé). Une
souscription sans ligne est un état que Stripe ne produit pas, mais qui est
possible dans une charge utile forgée : elle est refusée à la normalisation.

### 2.3 Statuts d'abonnement

`esm/resources/Subscriptions.d.ts` l. 478 :
`'active' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'past_due' | 'paused' | 'trialing' | 'unpaid' | OtherString`.

`OtherString` — le SDK admet donc explicitement une valeur qu'il ne connaît pas.
Le port ferme l'union et l'adaptateur **retombe fermé** : un statut inconnu
devient `incomplete`, qui n'accorde aucun accès. Un repli ouvert donnerait
l'accès sur un statut que personne n'a lu.

### 2.4 Erreurs : le SDK **lève**, contrairement à Resend

`esm/Error.d.ts` : `StripeError` et ses sous-classes
(`StripeInvalidRequestError`, `StripeAuthenticationError`, `StripePermissionError`,
`StripeRateLimitError`, `StripeAPIError`, `StripeConnectionError`,
`StripeIdempotencyError`, `StripeSignatureVerificationError`, `RateLimitError`,
`TemporarySessionExpiredError`, plus six erreurs OAuth). C'est l'inverse de
`resend@6.25.0`, qui rend `{data, error}`. Le `try/catch` de l'adaptateur n'est
donc **pas** une précaution ici : c'est le chemin nominal.

Classement retenu (dix classes balayées, celles listées ci-dessus hors OAuth,
que ce dépôt n'utilise pas) :

| Classe / `rawType` | Code de port | Rejoué ? |
|---|---|---|
| `StripeInvalidRequestError`, `card_error`, `StripeIdempotencyError` | `invalid_request` | non |
| `StripeAuthenticationError`, `StripePermissionError` | `unauthorized` | non |
| `StripeSignatureVerificationError` | `invalid_signature` | non |
| `StripeRateLimitError`, `RateLimitError` | `rate_limited` | oui |
| `StripeAPIError`, `StripeConnectionError`, `TemporarySessionExpiredError` | `provider_unavailable` | oui |
| inconnu | repli sur le code HTTP (`statusCode`), jamais « définitif » par défaut | selon |

Le repli sur `statusCode` reprend celui de l'adaptateur Resend : traiter une
panne inconnue comme définitive supprimerait la reprise exactement quand elle
sert.

**Deux champs se ressemblent et ne disent pas la même chose**, mesuré en
exécutant le SDK contre un `fetch` doublé rendant un 429 :
`error.type === 'StripeRateLimitError'` (le **nom de la classe**) et
`error.rawType === 'rate_limit_error'` (le type rendu par l'API). Le classement
lit `rawType`, puis retombe sur le nom de classe, puis sur `statusCode` :
`rawType` est absent des erreurs que le SDK fabrique lui-même sans réponse
(panne réseau).

### 2.5 Délai d'attente et reprises

`esm/lib.d.ts` `StripeConfig` : `timeout?: number` (« default is 80000 »),
`maxNetworkRetries?: number` (« default 1 »), `httpClient?: HttpClientInterface`.

Deux conséquences :

1. **80 secondes par défaut** : une requête HTTP dans un gestionnaire Next
   tiendrait la connexion plus d'une minute. Le délai est donc **toujours**
   passé explicitement.
2. **Le SDK rejoue tout seul, une fois, sans dispersion visible.**
   `maxNetworkRetries` est mis à `0` : la politique de reprise du dépôt
   (recul exponentiel, dispersion à moitié, plafond, erreurs transitoires
   uniquement — `docs/reliability.md` §3) est celle de `retry.ts`, reprise du
   gabarit de `@repo/adapter-resend`. Deux politiques superposées multiplieraient
   les appels sans que personne ne sache combien.

**Un délai dépassé et une panne réseau rendent la même classe.** Mesuré en
exécutant le SDK contre un `fetch` qui pend et contre un `fetch` qui rejette :

| Cas | Classe | `rawType` | `statusCode` | Ce qui distingue |
|---|---|---|---|---|
| délai dépassé (120 ms) | `StripeConnectionError` | `undefined` | `undefined` | `error.detail.code === 'ETIMEDOUT'` |
| `fetch` en échec | `StripeConnectionError` | `undefined` | `undefined` | — |

Le classement lit donc `detail.code` pour rendre `timeout` plutôt que
`provider_unavailable`. Les deux sont transitoires : la distinction sert le
journal, pas la décision de rejouer.

**`name` n'est pas le marqueur, et l'erreur a été commise ici même.**
`esm/net/HttpClient.js` l. 19-21 : `makeTimeoutError()` fabrique un `TypeError`
dont le `name` reste « TypeError » ; ce sont `code` **et** `message` qui valent
`ETIMEDOUT`. La première écriture lisait `detail.name` — elle n'aurait jamais
correspondu, en silence, et chaque délai dépassé se serait journalisé comme une
panne de fournisseur. Le cas de test l'a fait rougir avant la livraison.

**Le message du fournisseur fuit.** Mesuré sur une réponse 400 réelle du SDK :
`No such price: price_x (key sk_test_51ABCdefGHIjklMNO used, customer cus_9,
url https://checkout.stripe.com/c/pay/cs_test_secret)` — une clé, un
identifiant de client et une URL de session, tous rendus tels quels par le SDK.
L'assainissement n'est donc pas une précaution de principe : il y a de quoi le
prouver par mutation.

`esm/net/FetchHttpClient.d.ts` : `createFetchHttpClient(fetchFn?: typeof fetch)`,
et le client applique le `timeout` à la requête **entière** (course puis garde
sur la lecture du corps). C'est ce qui permet de doubler le **réseau** en gardant
le SDK réel — même régime que `resend-mailer.test.ts` (`docs/architecture.md`,
« deux régimes, jamais mélangés »).

### 2.6 Signature de webhook

`esm/Webhooks.d.ts` :

- `constructEvent(payload, header, secret, tolerance?, cryptoProvider?, receivedAt?): Event` —
  **lève** `StripeSignatureVerificationError` en cas de non-correspondance ;
- `generateTestHeaderString({payload, secret, timestamp?, scheme?})` — le SDK
  **fournit lui-même** de quoi signer une charge utile dans un test.

C'est ce qui rend le rejeu d'événements enregistrés faisable sans clé et sans
réseau, avec la **vraie** vérification : les fixtures sont des charges utiles
JSON enregistrées, signées à l'exécution du test par le SDK avec un secret de
test. Doubler `constructEvent` n'éprouverait que la doublure.

`DEFAULT_TOLERANCE` existe et vaut **300** (mesuré, pas lu) : une charge utile
enregistrée il y a des mois échouerait sur la fenêtre temporelle si le timestamp
de signature n'était pas régénéré. Il l'est (`generateTestHeaderString` prend
`timestamp`, et sans lui prend l'horloge courante).

Mesuré aussi, en exécutant le SDK : un secret erroné fait lever
`StripeSignatureVerificationError`, et l'en-tête produit a bien la forme
`t=<unix>,v1=<hmac>`. Le SDK **pose l'en-tête `Idempotency-Key`** à partir de
`{ idempotencyKey }` en options de requête — même discipline que
`@repo/adapter-resend` : **une seule clé pour toutes les tentatives** d'un même
appel, sans quoi une reprise sur réponse perdue ouvrirait deux checkouts.

### 2.7 Checkout et portail

`esm/resources/Checkout/Sessions.d.ts` — `SessionCreateParams` (l. 2119) porte
entre autres : `mode`, `line_items`, `customer`, `client_reference_id`,
`success_url`, `cancel_url`, `subscription_data`, `metadata`, `locale`.
L'objet `Session` porte `url: string | null` (l. 314), `customer` (l. 134),
`subscription` (l. 295), `client_reference_id` (l. 92), `payment_status`
(l. 241), `status` (l. 285).

`url` est **nullable** : il l'est pour `ui_mode: 'embedded'`. Le dépôt n'utilise
que la page hébergée ; une session rendue sans `url` est donc un état que
l'adaptateur refuse en `invalid_request` plutôt que de rendre `{ok:true, url: null}`.

Le portail est `stripe.billingPortal.sessions.create({customer, return_url})`.

### 2.8 Ce que le paquet **n'** offre **pas**

- aucune option `apiVersion` par requête qui changerait la forme des objets
  d'événement : l'événement porte sa propre `api_version`, figée à sa création.
  Un événement créé sous une version antérieure garde sa forme — d'où la
  normalisation défensive côté adaptateur (§2.2, §2.3) plutôt qu'une lecture de
  champ directe ;
- aucune garantie d'ordre de livraison. C'est le §3 ci-dessous.

Et deux choses qu'il fait **sans qu'on le lui demande**, mesurées à l'exécution :

- il écrit une ligne sur `stderr` au chargement du module quand `CLAUDECODE` ou
  `CLAUDE_CODE_CHILD_SESSION` est présent (`esm/stripe.esm.node.js` l. 138).
  Observé pendant les parcours Playwright de cette machine ; aucun déploiement
  ne pose ces variables, et la ligne ne contient ni clé ni charge utile ;
- il dérive un champ `ai_agent` de l'environnement et le place dans
  `X-Stripe-Client-User-Agent`, à **chaque** requête. `telemetry: false` ne le
  couvre pas : cette option ne gouverne que les métriques de latence. Aucun
  secret n'y transite. Les deux sont nommés plutôt que découverts plus tard.

## 3. Le désordre des événements, et comment il est ordonné ici

Deux désordres différents, et un seul mécanisme ne les couvre pas.

### 3.1 Désordre de **rattachement** — qui possède cet abonnement ?

Le piège nommé par la story : `customer.subscription.updated` peut précéder le
`checkout.session.completed` qui l'a causé. Si le rattachement
« client Stripe → propriétaire de la donnée » était posé par
`checkout.session.completed`, le premier événement arriverait sans propriétaire
connu et serait perdu.

**Décision : le client Stripe est créé et rattaché _avant_ le checkout, pas
après.** `POST /billing/checkout` crée (ou réutilise) le client Stripe du
propriétaire, écrit la ligne `billing_customer` **puis** ouvre la session. Tout
événement `customer.subscription.*` résout alors son propriétaire par
`billing_customer.provider_customer_id`, quel que soit l'ordre d'arrivée.

Ce désordre-là cesse donc d'exister par construction. C'est le seul traitement
d'ordre qui ne demande pas de tampon d'attente.

### 3.2 Désordre d'**état** — quel est le dernier état connu ?

Deux `customer.subscription.updated` peuvent arriver inversés. Chaque événement
porte `created` (secondes Unix, `esm/resources/Events.d.ts`). La ligne
`billing_subscription` garde `last_event_at`.

**Décision : un événement dont `created` est strictement antérieur au
`last_event_at` enregistré est journalisé comme traité et n'écrit rien.** Les
égalités sont appliquées : deux événements de la même seconde décrivent le même
instant, et refuser l'égalité perdrait le second d'une paire légitime.

Limite assumée, écrite parce qu'elle est réelle : deux événements de la **même
seconde** portant des états différents sont départagés par l'ordre d'arrivée.
C'est ce que la commande de réconciliation (§4) répare, et c'est pourquoi elle
n'est pas optionnelle.

### 3.3 Idempotence par identifiant

`billing_webhook_event.event_id` est **clé primaire**. Le traitement commence par
un `insert … on conflict do nothing`, et s'arrête si aucune ligne n'a été
insérée. C'est une contrainte d'unicité, pas une lecture préalable :
`docs/reliability.md` §1 refuse explicitement la seconde, qui laisse une fenêtre
de concurrence.

Conséquence à connaître : un événement dont le traitement **échoue** après
l'insertion ne sera pas rejoué (Stripe le rejouerait, nous le refuserions). Le
traitement se fait donc dans **une transaction** — insertion du journal et
écriture de l'état ensemble —, si bien qu'un échec annule les deux et laisse le
rejeu possible.

## 4. Ce qui peut diverger de Stripe, et la commande qui répare

`docs/reliability.md` §5 : « Toute divergence possible avec un système externe
possède une commande de réconciliation. » Ce que nous stockons est un **cache**
— statut, fin de période, quantité, annulation programmée. Il diverge quand un
webhook est perdu, quand deux événements partagent une seconde (§3.2), ou quand
un abonnement est ajouté depuis le tableau de bord Stripe **à un client déjà
rattaché**.

`pnpm billing:reconcile` relit Stripe pour chaque `billing_customer` connu et
réécrit le cache. Elle est rejouable sans effet supplémentaire (deuxième
exécution : zéro écriture, et c'est ce que le test observe).

**Ce qu'elle ne rattrape pas, et il faut l'écrire** : un *client* créé de toutes
pièces dans le tableau de bord Stripe. Il n'est dans aucun `billing_customer`,
donc la commande ne le lit pas — et il n'a de toute façon aucun périmètre du
produit à qui appartenir. Ses événements sont journalisés et n'écrivent rien.
La réponse est de passer par le produit pour ouvrir un abonnement, pas
d'inventer un rattachement (constat F6 de la revue).

## 5. Là où l'argent se perd — les décisions prises

| Risque | Décision |
|---|---|
| montant / devise / offre lus du client | la route ne reçoit qu'un **identifiant d'offre**, validé par Zod contre l'énumération de `config/billing.ts`. Le prix vient de Stripe, jamais du navigateur. Le corps ne porte ni montant, ni devise, ni `priceId` |
| quantité de sièges pilotée par le client | résolue côté serveur (`seatsOf(scope)`), jamais reçue |
| secret dans un journal, une URL, une erreur | forme de journal **fermée** (`PaymentsLogRecord`), messages assainis, aucune clé ni URL signée dans un message d'erreur — même discipline que `MailerLogRecord` |
| ressource d'une autre organisation | l'appelant n'atteint jamais qu'un périmètre résolu par `dataOwnerOf(session)` : il n'y a pas de paramètre d'identité à falsifier. Un abonnement qui n'est pas celui du périmètre courant n'est pas trouvé — **404**, jamais 403 |
| un `member` annule l'abonnement de l'organisation | §6 |

## 6. Qui a le droit de souscrire — et pourquoi la matrice de s17 est rouverte

`packages/modules/organizations/src/domain/permissions.ts` porte la matrice
rôle × action, et `eslint.config.ts` refuse toute comparaison de rôle ailleurs
dans ce module. La matrice énumère six actions ; aucune ne parle de facturation.

Sans garde, **tout membre** d'une organisation pourrait ouvrir le portail client
et annuler l'abonnement. `docs/security.md` §3 exige que « chaque combinaison
rôle × action sensible soit couverte par un test d'API » : dépenser et annuler
sont sensibles.

Trois options examinées :

1. **Réutiliser une action existante** (`organization.rename`, qui vaut
   owner+admin) — rejeté : la règle deviendrait vraie par coïncidence, et le
   jour où `rename` change de rôles, la facturation change avec elle sans que
   personne ne l'ait décidé.
2. **Comparer le rôle dans `apps/web/lib/billing.ts`** — rejeté : le lint qui
   garde la matrice ne couvre que `packages/modules/organizations/src`, donc
   cette écriture passerait, et la matrice existerait à deux endroits. C'est
   exactement le défaut F4 de la revue de s17.
3. **Ajouter `billing.manage` à la matrice** — retenu. Voir ADR 034.

C'est le **point d'entrée strictement nécessaire** dans le module
`organizations` : trois lignes de `domain/permissions.ts` et la ligne
correspondante du tableau attendu de son test. Aucune autre ligne de ce module
n'est touchée.

## 7. La politique de sécurité du contenu — ce qui est signalé, pas pris

`config/security.ts` livre `formAction: []`, et
`apps/web/lib/security-headers.ts` émet `form-action 'self'`.

**Constat.** Un `<form method="post">` qui poste vers une route dont la réponse
est une redirection 303 vers `https://checkout.stripe.com/…` est soumis à
`form-action` **sur la destination de la redirection** dans les navigateurs
fondés sur Chromium et dans WebKit. Faire aboutir ce chemin exigerait de
déclarer `https://checkout.stripe.com` et `https://billing.stripe.com` dans
`config/security.ts`.

**Décision : ne pas les déclarer, et ne pas toucher `config/security.ts`.** Le
déclencheur d'abonnement est un composant client (ADR 027) qui appelle la route
en `fetch` — donc `connect-src 'self'`, déjà couvert — et navigue ensuite par
`window.location.assign(url)`. Une navigation de premier niveau pilotée par
script n'est soumise à aucune directive livrée par les navigateurs
(`navigate-to` n'a jamais été implémentée). La politique reste `default-src 'self'`
sans une seule source tierce.

**À signaler au propriétaire** (et c'est ce que fait cette section) : si une
story future veut un formulaire natif qui redirige vers Stripe — pour la même
raison d'accessibilité que l'ADR 027 laisse ouverte —, alors et seulement alors
`config/security.ts` devra déclarer ces deux origines, avec la justification
écrite qu'exige `docs/security.md` §1. s19 ne le fait pas.

Aucun iframe : `frame-src 'none'` reste valide, le checkout intégré
(`ui_mode: 'embedded'`) n'est pas utilisé.

## 8. Le mode local — sans clé, explicite, et refusé en production

Précédents du dépôt : `EMAIL_LOCAL_CAPTURE=1` (s06) et `OAUTH_LOCAL_PROVIDER=1`
(s12). Le second est le bon gabarit, parce que son rayon d'action est le même :
il **ouvre un droit** sans que personne ne paie.

`PAYMENTS_LOCAL_MODE=1` :

- opt-in explicite, jamais déduit de `NODE_ENV` ni de l'absence de clé ;
- refusé **avec** `STRIPE_SECRET_KEY` : le choix serait implicite ;
- refusé sous `NODE_ENV=production`, au démarrage, en nommant la variable —
  comme `OAUTH_LOCAL_PROVIDER`, et pour une raison plus forte encore : il permet
  de s'accorder un abonnement payant sans payer ;
- sans clé et sans drapeau, l'application **refuse de démarrer** en nommant les
  deux variables.

### 8.1 Le refus de démarrage, mesuré — et le piège de la mesure

Vérifié sur un serveur réel, `next dev` **et** `next start` (Next 16.3.3) :

| Environnement, module `billing` activé | Ce qui se passe |
|---|---|
| ni clé ni drapeau | le processus **s'arrête**, code 1, en nommant `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` et `PAYMENTS_LOCAL_MODE` |
| drapeau **et** `NODE_ENV=production` | le processus **s'arrête**, code 1, en nommant `PAYMENTS_LOCAL_MODE` |
| `DATABASE_URL` malformé | le processus **s'arrête**, code 1, en nommant la variable |

**Le piège, et il a failli me faire écrire le contraire.** Dans Next 16.3.3, la
configuration est chargée **après** l'affichage de `✓ Ready in …` : un
harnais qui arrête d'observer à cette ligne voit un serveur « démarré » et
conclut que la garde est morte. C'est exactement ce que ma première mesure a
conclu, à tort, pour les quatre gardes du dépôt — mailer, authentification,
OAuth et paiement. La bonne mesure capture la sortie jusqu'à la fin du
processus et lit son **code de sortie**. La ligne « Ready » de Next ne dit pas
que le démarrage a réussi.

**Le corollaire, qui a coûté un second tour de revue.** Une garde de démarrage
de plus est aussi une **variable de plus à déclarer dans le harnais**. Le
workflow de CI et `playwright.config.ts` posent déjà `EMAIL_LOCAL_CAPTURE`,
`AUTH_SECRET`, `APP_URL` et `OAUTH_LOCAL_PROVIDER` pour cette exact raison ;
s19 ajoutait la quatrième garde sans ajouter sa variable, si bien que `next dev`
mourait après `✓ Ready` dans les deux branches de la matrice et que
`pnpm test:e2e` échouait au démarrage du serveur — l'arbre vert d'un poste ne
tenant qu'à son `.env`. `PAYMENTS_LOCAL_MODE=1` est donc posé dans les deux
fichiers, et `tests/env-wiring.test.ts` démarre la configuration de Next avec
leur union et rien d'autre.

L'implémentation locale vit dans `packages/payments-testing`, qui est un
**outil**, pas un fournisseur — exactement comme `@repo/mailer-testing`
(ADR 008 : une seule implémentation livrée par port, et c'est Stripe).

Elle produit un checkout dont l'URL mène à
`GET /api/billing-local-checkout?…`, une route de l'**application** montée
uniquement sous le drapeau (404 sinon), qui fabrique les deux événements
correspondants, les signe avec le secret local et les fait passer par la
**vraie** route de webhook du module. Le parcours navigateur exerce donc la
chaîne complète — signature, idempotence, écriture d'état — sans un octet vers
Stripe.

Une route `GET` qui écrit est assumée et bornée : elle n'existe que sous le
drapeau, elle tient la place d'une page hébergée par un tiers, et elle est
nommée comme telle dans `apps/web/AGENTS.md`.

## 9. L'arbre du dépôt — ce que s19 doit respecter

Relevé sur les fichiers lus (dix-huit, nommés ci-dessous) :

- **`packages/ports`** ne contient que des types, aucune dépendance
  (`packages/ports/AGENTS.md`). `payments.ts` s'y ajoute comme `mailer.ts` ;
- **un adaptateur par SDK** (`packages/adapters/resend/AGENTS.md`), collaborations
  injectées, `send` ne lève jamais ;
- **un module n'importe jamais `@repo/db`** (ADR 020, `eslint.config.ts`) : la
  connexion arrive par le point de composition ;
- **aucun `fetch` dans `packages/modules/**`** (`eslint.config.ts`,
  `OUTBOUND_FETCH_SYNTAX`) : le composant interactif vit dans `apps/web`
  (ADR 027) ;
- **`presentation` d'un module s'expose par un second point d'entrée**
  (ADR 024) : `@repo/module-billing/presentation` ;
- **`dispatchModuleRequest`** apparie (chemin, méthode) sans segment dynamique
  et rend 404 — jamais 405 — sur une méthode non déclarée (ADR 017) ;
- **le corps brut est disponible** : `apps/web/app/api/modules/[...path]/route.ts`
  passe la `Request` sans la lire. `await request.text()` dans le gestionnaire du
  webhook donne donc les octets exacts que Stripe a signés ;
- **tout écran `page.tsx` de `apps/web/app`** entre dans
  `tests/rendered-text.test.ts` (garde d'inertie explicite) et tout segment de
  premier niveau de `apps/web/app` doit être dans `APPLICATION_SEGMENTS`
  (`apps/web/lib/organizations.ts`, exigé par `tests/organizations.test.ts`) ;
- **`stripe` est déjà refusé au `domain`** (`tooling/eslint/boundaries.ts`,
  `domainForbiddenSources`) : rien à ajouter ;
- **`config/features.ts`, `generated/schema/`** sont régénérés par
  `pnpm db:generate` ; le fichier généré est versionné et comparé en CI.

## 10. Ce qui reste ouvert, et qui n'est pas de s19

- **La limitation de débit** de `POST /billing/webhook` et de
  `POST /billing/checkout` : s28. Le webhook est un point d'entrée public. En
  attendant, la seule borne est la vérification de signature — un appelant sans
  secret n'écrit rien, mais il consomme du calcul. C'est la même dette que celle
  déjà écrite pour `marketing` dans `docs/STATE.md`.
- **La synchronisation du nombre de sièges** à chaque invitation ou retrait
  (PRD, ligne Billing) : s19 pose `perSeat` et résout la quantité **au
  checkout** ; la synchronisation continue et sa réconciliation par membre
  appartiennent à la story de seat billing. La commande de réconciliation de §4
  réécrit la quantité connue, elle ne la corrige pas chez Stripe.
- **Les emails de facturation** (échec de paiement, fin d'essai) : le module
  déclare `emails: []`. Les relances sont attachées aux jobs de s33.
- **`one_time`** : s20.
