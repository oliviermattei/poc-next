# Review — Story s23-seat-billing

> Fresh-context review. Each issue classified: critical / major / minor.
> Diff reviewed: `git diff dev...feature/s23-seat-billing` (1 commit, `f1e89db`, 35 files, +2563/−32)

## Commands run by the reviewer

| Commande | Résultat |
|---|---|
| `docker compose up -d` (worktree, port 5433) | conteneur `s23-seat-billing-postgres-1` joignable |
| `pnpm test` | **1708 passed, 8 skipped, 53 files** |
| Contrôle « la base a bien été jouée » : `DATABASE_URL` vers un port mort | `tests/billing.test.ts` + `tests/organizations.test.ts` tombent de **240 exécutés** à **79 exécutés + 160 sautés**. La suite mesurée l'a donc été **contre une base**, pas contre des cas silencieusement sautés |
| `pnpm typecheck` | vert (24 tâches) |
| `pnpm lint` | vert — « No issues found » |
| `pnpm test:e2e` | vert — 86 passed, 8 skipped |
| `PAYMENTS_LOCAL_MODE=1 pnpm billing:reconcile` ×2 | « 0 client(s) relu(s), 0 correction(s) » les deux fois — voir *Not verified* : base locale vide, la commande n'a rien réconcilié |
| `pnpm ks toggle billing` puis `pnpm test` | vert (1706 passed / 10 skipped) |
| `pnpm ks toggle organizations` puis `pnpm test` | vert (1704 passed / 12 skipped) |
| `git diff --exit-code` après restauration des bascules et des mutations | **propre** |

## Plan compliance

- [x] The code does what the plan specifies, nothing more — les 11 tâches sont livrées et localisées (port étendu `packages/ports/src/payments.ts:221-260`, adaptateur `stripe-payments.ts:581-645`, mode local `local-payments.ts:287-344`, règle pure `domain/seats.ts`, compteur serveur `scoped-reads.ts:208`, les deux accroches `drizzle-organization-repositories.ts:447` et `:507`, réconciliation `billing-use-cases.ts:913-938`, docs).
- [x] Run interdicts respected — chacun vérifié nommément :
  - **`organizations` absent des `requires` de `billing`** : `packages/modules/billing/src/module.ts` n'apparaît pas dans le diff. Ligne 44 intacte. ✔
  - **Compteur serveur non exposé** : `grep -rn countMembers` sur `apps`, `packages`, `config`, `scripts`, `tests` ne le trouve dans **aucun** fichier d'`apps/web/app` ni dans `packages/modules/organizations/src/presentation`. Vérifié indépendamment du cas de test qui l'affirme. Et `syncSeats` n'est atteignable par aucune route : ses deux seuls appelants passent `consumed.organizationId` (lu de la ligne d'invitation) et `access.organizationId` (issu du contrôle d'accès s16/s17) — jamais une valeur venue du navigateur. ✔
  - **Aucune baisse sur lecture de membres en échec** : `seatsOfScope` n'est ni enveloppé ni rattrapé (`billing-use-cases.ts:930`), l'exception interrompt `reconcile`. Éprouvé par mutation (M4 ci-dessous). ✔
  - **Ni file d'attente ni bus d'événements** : aucune occurrence dans le diff. ✔
  - **Pas de rejeu sur erreur de validation** : la nouvelle méthode réutilise le `run()` existant (`stripe-payments.ts:372-412`) et son `isTransientPaymentsError`. Mesuré par le cas « rejoue une panne du fournisseur, jamais un refus de validation » : 400 → 2 requêtes, 503 → 3. ✔
  - **Pas de seconde implémentation de port** : `packages/payments-testing` préexistait ; il gagne une méthode, pas un fournisseur. ✔
  - **`config/billing.ts` intact** : absent du diff. ✔
  - **Limite de sièges non traitée** : aucun `seatLimit`/`maxSeats` dans le diff. ✔
- [x] Le résidu de surfacturation de l'ADR 046 est **dans le code**, pas seulement dans l'ADR : `drizzle-organization-repositories.ts:145-159`, au-dessus de `syncSeatsBeforeCommit`, seul appel avant la sortie de `db.transaction(...)` des deux écrivains. La formule « le `commit` qui suit ce commentaire » est une licence (le commit est implicite), mais le résidu est nommé, chiffré (« un siège »), attribué (le client) et relié à son filet.
- [x] Un seul commit, message impératif en français, portant `docs/research/s23-seat-billing.md`, `docs/plans/s23-seat-billing.md` et `docs/decisions/046-…md`. Vérifié : `git rev-list --count dev..feature/s23-seat-billing` = 1.

### Les quatre écarts déclarés — jugés un par un

**(a) Pas de `packages/ports/src/payments.test.ts`, témoin déplacé dans `stripe-payments.test.ts` — recevable, et j'ai vérifié qu'il mord.** `packages/ports/src/` ne contenait **aucun** fichier de test sur `dev` : la tâche 1 demandait un fichier dans un paquet sans harnais. Le témoin retenu est un `@ts-expect-error` (`stripe-payments.test.ts:1014`). J'ai vérifié qu'il n'est pas décoratif : en pointant la directive sur une expression valide, `pnpm typecheck` échoue avec `src/stripe-payments.test.ts(1015,5): error TS2578: Unused '@ts-expect-error' directive` sur `@repo/adapter-stripe`. Le contrat discriminé est donc bien tenu par une commande.

**(b) Refus neuf `seat_sync_unavailable` au-delà du plan — justifié.** Sans lui, une acceptation annulée par une panne Stripe se serait présentée comme « lien invalide » à quelqu'un dont l'invitation est parfaitement vivante ; le motif est ajouté à `INVITATION_REFUSALS` **et** `ACCEPT_REFUSALS`, traduit fr/en, et le mapping HTTP existant (303 + `?error=<code>`) l'accepte sans code neuf. Aucune fuite : le code ne dit rien du fournisseur ni du périmètre.

**(c) `apps/web/lib/seat-sync.ts` extrait — bon réflexe, insuffisamment exploité.** L'extraction reproduit ce que la revue de s19 avait imposé pour `canManage`, et elle permet effectivement de neutraliser la *règle*. Mais elle ne couvre pas le *câblage* — voir F1.

**(d) `removeMember` calque l'ordre de l'ADR 046 alors que celui-ci ne raisonne que sur l'ajout — correct.** La symétrie est le seul choix cohérent (un fournisseur muet ne doit pas retirer un membre en silence), et le résidu inversé (sous-facturation d'un siège) est écrit sur place (`drizzle-organization-repositories.ts:500-506`). L'ADR étant immuable, l'écrire dans le code est la bonne voie.

## Anti-hallucination

- [x] **Aucune API inventée.** Chaque référence ouverte : `currentSubscriptionOf` (`domain/subscription.ts:151`), `offerForPrice` (`domain/offer.ts:170`), `grantsAccess` (`domain/subscription.ts:66`), `DOMAIN_STATUS` (`billing-use-cases.ts:67`), `referenceOf` (`:295`), `BillingCustomerRecord` (`application/ports.ts:15`), `customerForScope` (`:145`), `subscriptionsOfCustomer` (`:180`), `count`/`eq` (déjà importés dans `scoped-reads.ts:2`, l'import n'a pas eu à changer), `run`/`failure`/`isTransientPaymentsError` (préexistants dans l'adaptateur).
- [x] **Le SDK a été vérifié sur le paquet installé, pas de mémoire.** `stripe@22.6.1` : `SubscriptionResource.update(id, params, options)` existe avec `RequestOptions` en troisième position (donc `idempotencyKey` y est légitime), et `SubscriptionUpdateParams.Item.quantity` existe (`esm/resources/Subscriptions.d.ts:2060-2063`) — il n'y a bien pas de `quantity` de premier niveau. Le commentaire de `soleItemIdOf` qui l'affirme est exact, et c'est ce qui justifie la relecture préalable.
- [x] **Pas de valeur plausible-mais-fausse repérée sur le chemin nominal.** La clé d'idempotence (`seats:<scope>:<subId>:<quantity>`) est dérivée d'un état visé, comme `checkout:…` ; la relecture est un GET sans clé (le fournisseur les ignore sur un GET) ; le repli sur abonnement multi-lignes est **fermé** (refus, zéro écriture) plutôt que devinant.
- [ ] **Trois endroits où le code en dit plus qu'il ne tient** — F2, F3, F5 ci-dessous.

## Rules compliance

- [x] **ADR 034 non contredit** : `requires: []` intact, aucune clé étrangère inter-modules, le couplage passe par le point de composition. L'inversion du sens de vérité est bornée au **seul** champ quantité et écrite trois fois (ADR 046, `billing-use-cases.ts:913-928`, `packages/modules/billing/AGENTS.md`).
- [x] **ADR 018** : aucune FK ne sort d'un module ; `scopeOfCustomer` reconstruit le périmètre depuis deux colonnes de texte.
- [x] **ADR 046** : séquence exacte respectée — insertion non validée (`:433`), appel du port (`:447`), refus → `throw SeatSyncRefusedError` qui annule, succès → sortie de transaction. `SEAT_SYNC_REFUSED` ramène l'exception à une valeur dès la sortie de la couche infrastructure, si bien qu'aucun appelant ne voit passer une exception.
- [x] **ADR 006 / frontières de couches** : `domain/seats.ts` est pur ; `pnpm lint` (qui porte la règle) est vert ; la seule lecture de transaction est passée par la porte unique `scoped-reads.ts`, et `TransactionalWriter` gagne `select` avec la justification écrite.
- [x] **Socle sécurité** : aucune nouvelle surface HTTP, aucun `process.env` direct, aucune valeur cliente ne traverse le nouveau chemin, la forme fermée de journalisation d'échec (`payments.ts:388-395`) est héritée telle quelle — aucun champ où loger un identifiant client ou un montant.
- [x] **Socle fiabilité §1 (rejeu)** : la convergence par clé d'idempotence est mesurée sur trois synchronisations ; `reconcile` rejouée rend `changed: 0`.
- [x] **Socle fiabilité §3 (délais)** : la nouvelle méthode passe par le `run()` qui porte `timeoutMs`/`maxAttempts`/backoff. Voir F3 pour ce que le cumul de **deux** appels coûte.
- [ ] **« Docs ship with the code that changes them »** — partiellement tenu (F4, F5).
- [x] Pas de design system à respecter : story sans écran. Les deux chaînes ajoutées le sont dans le catalogue du module, pas en dur.

## Tests

- [x] Suite exécutée par la revue, verte, **contre une base réellement joignable** (contrôle croisé ci-dessus).
- [x] **Aucun cas décoratif dans le diff.** J'ai cherché les motifs interdits : pas d'assertion sur une classe CSS, une structure DOM, un libellé statique ou un inventaire de props. Trois gardes anti-vacuité sont même écrites par l'implémenteur et j'ai vérifié qu'elles servent : `expect(SEAT_OFFER?.mode).toBe('subscription')` (sans elle tout le bloc serait vert et vide), `expect(seen).toBe(2)` (sans elle le cas serait vert sur deux zéros), `expect(swept.length).toBeGreaterThan(10)` (sans elle le balayage de fichiers serait vert sur zéro fichier).
- [x] Les deux cas que l'implémenteur signale comme initialement décoratifs sont bien réparés : le cas de la clé d'idempotence mesure désormais l'en-tête `idempotency-key` **tel que le réseau le voit** sur trois synchronisations, et le cas du critère 4 laisse une invitation **vivante pendant** qu'une autre est acceptée. Les deux mordent (M1, M2, M6, M7).
- [x] Aucun test rendu redondant par la story ; aucun n'avait à être supprimé.
- [x] **Morsure prouvée par neutralisation — et l'endroit où chaque mutation est posée est indiqué**, parce que c'est ce qui distingue une preuve d'une impression :

| # | Mutation | Posée à | Rouges |
|---|---|---|---|
| M1 | clé d'idempotence dérivée d'un **compteur** au lieu de la cible | `billing-use-cases.ts:322` (`seatIdempotencyKey`) | **1** — « dérive la clé d'idempotence de la quantité visée » |
| M2 | clé d'idempotence **constante** (segment quantité retiré) | idem | **1** — même cas, autre assertion |
| M3 | doctrine ADR 034 appliquée à la quantité : `billableSeats(subscription.quantity)` | `billing-use-cases.ts:404` (`alignSeats`) | **1** — « ramène la quantité du fournisseur au nombre de membres » |
| M4 | lecture des membres en échec ravalée : `seatsOfScope(scope).catch(() => 1)` | `billing-use-cases.ts:930` (`reconcile`) | **1** — « ne baisse aucune quantité quand la lecture des membres échoue » |
| M5 | `billableSeats` accepte `0` | `domain/seats.ts:47` | **2** — le cas de domaine **et** le cas d'intégration, qui attrape la *tentative* de relecture, pas seulement l'écriture |
| M6 | comptage = membres + **toutes** les invitations | `scoped-reads.ts:212` (`countMembersOf`) | **6** |
| M7 | comptage = membres + invitations **vivantes** (acceptedAt/revokedAt nuls, non expirées) | idem | **3** — reproduit exactement la mesure annoncée dans `packages/modules/organizations/AGENTS.md` |
| M8 | le refus du `SeatSync` ne lève plus, donc n'annule plus | `drizzle-organization-repositories.ts:171` | **2** — reproduit exactement la mesure annoncée |
| M9 | comptage **hors** de la transaction (`db` au lieu de `transaction`) | `drizzle-organization-repositories.ts:140` | **4** — l'invariant « la quantité est le nombre **après** l'écriture » mord |
| M10 | `@ts-expect-error` rendu vacant | `stripe-payments.test.ts:1014` | `pnpm typecheck` **échoue** (TS2578) — le témoin de contrat est réel |
| **M11** | **le point de composition n'accroche plus la facturation** : `seatSync: () => Promise.resolve(true)` | **`apps/web/lib/organizations.ts:235`** | **0** sur 1708, et `pnpm test:e2e` reste vert → **F1** |

Les deux comptes écrits dans `packages/modules/organizations/AGENTS.md` (« 2 rouges », « 3 rouges ») sont **reproductibles au chiffre près** — je les ai rejoués. C'est rare et cela mérite d'être dit : ce dépôt s'est fait prendre plusieurs fois sur des comptes non vérifiables.

- [x] Arbre restauré et prouvé propre (`git diff --exit-code`) avant l'écriture de ce rapport, après chaque mutation et après les deux bascules de modules.

## Regressions

- [x] Les deux configurations basculées ont été jouées, pas seulement celle de la CI : `billing` coupé → 1706 verts ; `organizations` coupé → 1704 verts ; configuration restaurée, `generated/schema/` identique.
- [x] `tests/organizations.test.ts` n'a été touché que pour injecter la nouvelle dépendance obligatoire (`seatSync: () => Promise.resolve(true)`, 6 lignes) : aucune assertion existante réécrite. Le parcours d'invitation Playwright reste vert sans retouche.
- [x] `configureOrganizations` rend `seatSync` **obligatoire** sans repli optionnel : un point de composition qui l'oublierait ne compile pas. Vérifié : les trois appelants (`apps/web/lib/organizations.ts`, `tests/organizations.test.ts`, `tests/billing.test.ts`) le fournissent.
- [x] `removeMember` : le symbole de refus est testé **avant** `if (removed)` — un symbole étant vrai, l'ordre inverse aurait rendu « ok » sur un refus. L'ordre est correct.
- [x] `reconcile` : l'ajout n'a pas déplacé la garde `if (!listed.ok) continue`, et la commande n'efface toujours rien.

## Findings

**F1 — major — `apps/web/lib/organizations.ts:235` — le seul fil auquel toute la story est suspendue n'est mesuré par rien.**
Remplacer `seatSync: seatSyncOf(async () => (await import('./billing')).billing)` par `seatSync: () => Promise.resolve(true)` laisse **1708 tests sur 1708 au vert** et `pnpm test:e2e` au vert. Dans cette configuration, l'application acceptée en production accepterait des invitations sans jamais rien porter chez le fournisseur, et le critère 6 (atomicité) disparaîtrait en silence — sans qu'aucune commande ne rougisse. La raison est identifiable : chaque cas d'intégration de `tests/billing.test.ts` reconstruit son propre `seatSync` dans son appel à `configureOrganizations` (`:585`) puis le réassigne à la vraie synchronisation (`:3253`) — le point de composition réel de l'application n'est jamais traversé. Le commentaire du fichier le concède (« ce qui est écrit ici n'est neutralisable par aucun test »), mais l'aveu ne vaut pas filet, et **le même diff démontre la technique qui l'aurait tenu** : le balayage de fichiers sur disque écrit à `tests/billing.test.ts:3838` pour prouver que `countMembers` n'est nommé par aucun écran. La même mesure appliquée à `lib/organizations.ts` (le fichier nomme-t-il `seatSyncOf` ?) aurait coûté cinq lignes. Le code est correct aujourd'hui ; c'est sa protection qui manque, et le dépôt écrit lui-même que « a green mutation means the test is wrong, not that the code is right — that has happened five times here ». Sixième.

**F2 — minor — `packages/modules/organizations/src/infrastructure/drizzle-organization-repositories.ts:248-253` — une troisième écriture d'appartenance ne synchronise rien.**
`deleteMembershipsOf(userId)` retire une personne de **toutes** ses organisations d'un seul `delete`, sans compter ni appeler `seatSync`. Le critère 3 dit « après **toute** opération ». La recherche annonçait « les deux points d'accroche sont nommés » et le plan a suivi ; ni l'une ni l'autre n'a ouvert ce troisième site. J'ai vérifié l'atteignabilité avant de classer : `purgeModules` (`packages/core/src/registry.ts:282`) n'a **aucun appelant hors des tests** — la suppression de compte n'est pas livrée. La story n'expédie donc aucun bug. Ce qui reste est un piège posé pour l'agent suivant : la ligne d'invariant ajoutée à `packages/modules/organizations/AGENTS.md` s'intitule « Un changement de taille passe chez l'extérieur avant d'être validé » — un titre sans réserve, dont la colonne de preuve ne nomme que `consumeInvitation` et `removeMember`. Qui câblera la suppression de compte lira le titre, pas la colonne, et laissera une place fantôme facturée jusqu'à la prochaine réconciliation. Le dépôt a une règle pour exactement ça : « Never claim exhaustiveness […] Write "found so far, over these N cases", and name the cases. »

**F3 — minor — `stripe-payments.ts:591-630` + `billing-use-cases.ts:813-859` — le coût que l'ADR 046 accepte est trois fois celui qui est écrit.**
L'ADR accepte « une transaction reste ouverte le temps d'**un** aller-retour HTTP ». La séquence livrée en tient deux : `subscriptions.retrieve` puis `subscriptions.update`, chacun avec son propre budget `run()` (`TIMEOUT_MS = 4_000`, `MAX_ATTEMPTS = 2`, plus le recul), soit jusqu'à ~20 s de transaction ouverte tenant le verrou de `lockOrganizationMembership`. S'y ajoute, non mentionnée nulle part, une **seconde prise dans le même pool** : `syncSeats` appelle `repository.customerForScope` et `subscriptionsOfCustomer` sur une autre connexion pendant que la transaction en retient une (`packages/db/src/client.ts:44-45` — `max: 10`, `connectionTimeoutMillis: 5_000`). La concurrence utile des écritures d'appartenance tombe donc à cinq, la sixième attend 5 s puis échoue. Le mode de défaillance est sain — l'exception n'est pas un `SeatSyncRefusedError`, elle remonte et annule —, donc rien n'est corrompu et le client n'est pas surfacturé. Mais le pire cas dépasse les « dix secondes d'une fonction serverless » que `apps/web/lib/billing.ts:146-149` invoque précisément pour dimensionner ce budget, et ni l'ADR ni le code ne le disent.

**F4 — minor — `apps/web/AGENTS.md` et `packages/payments-testing/AGENTS.md` non mis à jour.**
`apps/web/AGENTS.md:634` dit encore « **Quatre fichiers**, sur le modèle exact du mailer » pour le montage de la facturation, alors que `lib/seat-sync.ts` rejoint cette famille — son propre commentaire s'y rattache explicitement (« comme `lib/billing-permission.ts` »). La section « Le montage des organisations » (`:536-546`) énumère ce que `lib/organizations.ts` donne au module — le `Mailer`, l'`APP_URL`, la locale, la connexion, les identifiants réservés — sans la dépendance neuve, qui est pourtant la plus lourde de conséquences puisqu'elle peut **annuler** une écriture d'appartenance. `packages/payments-testing/AGENTS.md:35` tient une section « Ce qu'il ne simule pas — écrit plutôt que sous-entendu » restée inchangée, alors que le mode local gagne une écriture qui diverge de l'adaptateur : elle applique la quantité à **toutes** les lignes et ne connaît pas le refus `invalid_request` que Stripe oppose à un abonnement multi-lignes. La divergence est inatteignable aujourd'hui (le simulateur ne fabrique qu'une ligne), mais c'est exactement ce que cette section existe pour écrire. Le plan n'avait listé que quatre fichiers de documentation en tâche 11 ; le diff s'y tient, la règle du dépôt (« Docs ship with the code that changes them ») demandait davantage.

**F5 — minor — `packages/modules/billing/src/domain/offer.ts:41` — la documentation du champ `perSeat` est devenue fausse par omission.**
Elle dit « Facturation au siège : la quantité suit le nombre de membres ». Depuis la tâche 4, c'est faux pour `mode: 'one_time'` : `offerSyncsSeats` rend `false` et **rien ne se produit, en silence**. Le choix de trancher dans le domaine plutôt que d'ajouter un champ est bon et le plan l'imposait ; mais le champ que le propriétaire du projet édite est documenté à cet endroit et à cet endroit seul, et `config/billing.ts` (justement laissé intact) ne livre aucune offre `perSeat: true` dont il pourrait s'inspirer. Une ligne — « sans effet sur une offre `one_time` » — refermait l'écart.

### Sur le point 8 de la commande (aucune offre au siège dans le catalogue livré)

Ce n'est **pas** un critère non tenu : le critère 1 porte sur le contrat d'offre, `perSeat` y est validé depuis s19, la règle qui décide est éprouvée sur les quatre combinaisons `perSeat` × `mode`, et le plan interdisait de toucher `config/billing.ts`. Mais la conséquence mérite d'être écrite plutôt que sous-entendue : **dans la configuration livrée par défaut, aucune ligne du chemin d'écriture ne s'exécute jamais** — `syncSeats` sort en `not_applicable` sur la garde `offerSyncsSeats`, et `pnpm billing:reconcile` n'a rien à corriger (mes deux exécutions : « 0 client(s), 0 correction(s) »). C'est ce qui donne son poids à F1 : ni la suite, ni les parcours, ni la commande de maintenance ne traversent le câblage réel, et aucun des trois ne rougirait s'il disparaissait.

## Not verified

- **Les deux écrans qui rendent le nouveau motif.** `error.seat_sync_unavailable` est ajouté en fr et en en, et atteint `/organizations` (retrait refusé) et `/invitations/accept` (acceptation annulée) par `?error=`. **Aucun test ne rend cette phrase et aucun parcours ne la produit** — les cas s'arrêtent à l'objet `{status:'refused', refusal:'seat_sync_unavailable'}`. Geste humain : provoquer un échec Stripe (clé invalide, ou stub qui répond 503) sur une organisation abonnée à une offre `perSeat`, puis ouvrir les deux écrans et vérifier que la phrase s'affiche vraiment au lieu de retomber sur un message générique ou de disparaître — en 390 px aussi, la phrase française fait 84 caractères.
- **Stripe n'a jamais été appelé.** Tout est mesuré au `fetch` doublé. Non vérifié contre le vrai fournisseur : qu'il accepte une clé d'idempotence de la forme `seats:organization:org_x:sub_y:3`, que `items:[{id, quantity}]` sur `subscriptions.update` laisse bien les autres champs intacts, et surtout **le proratage** — que l'ADR 046 déclare explicitement ne pas trancher. Geste humain : le régime « hors CI, sur commande explicite » du dépôt — changer une quantité en cours de période sur un abonnement de test réel, puis lire la facture produite et sa ligne d'ajustement. C'est un choix de facturation que personne n'a encore vu.
- **La configuration livrée n'exerce rien** (voir ci-dessus). Geste humain : sur une branche jetable, poser `perSeat: true` sur `pro-monthly`, rejouer une fois le parcours d'invitation complet en mode local, et regarder la quantité effectivement mémorisée.
- **La concurrence n'est pas mesurée.** F3 est raisonné depuis les sémantiques de `pg` et `packages/db/src/client.ts:44-45`, pas observé. Geste humain : lancer une douzaine d'acceptations d'invitation simultanées contre un fournisseur lent (stub à 3 s) et vérifier que la dégradation est bien « quelques 500 » et non un blocage du pool.
- **`pnpm billing:reconcile` n'a rien réconcilié.** Les deux exécutions ont porté sur une base locale sans aucun client de facturation : elles prouvent que la commande démarre, sort proprement et ne casse pas, rien de plus. Son comportement à double sens n'est prouvé que par `tests/billing.test.ts`. Geste humain : la lancer une fois contre une base portant un client au siège dont la quantité a été volontairement désalignée.
- **Le mode local n'a pas été essayé au navigateur.** `updateSubscriptionQuantity` en `PAYMENTS_LOCAL_MODE=1` est couvert par trois cas unitaires ; personne n'a vu ce que l'écran de facturation affiche après un changement de quantité en mode local.

## Verdict

Le cœur de la story est solide et honnête : l'ordre d'écriture de l'ADR 046 est implémenté à la lettre, le résidu de surfacturation est écrit là où il se paie, l'inversion du sens de vérité est bornée au seul champ quantité et défendue par des mutations qui rougissent vraiment, la clé d'idempotence porte une cible dans les deux directions d'attaque, et les deux comptes de rouges annoncés dans les `AGENTS.md` se reproduisent au chiffre près. Aucun interdit d'exécution n'est franchi, aucune API n'est inventée, le SDK a été vérifié sur le paquet installé.

Ce qui manque n'est pas du code, c'est un filet sur la seule ligne dont tout dépend (F1) — et il est d'autant plus nécessaire que la configuration livrée ne traverse jamais ce chemin. Rien de tout cela n'expédie de bug ni ne casse l'existant.

## Reprise après revue (même branche, commit amendé `5aec71e`)

Le major et les quatre mineurs ont été refermés avant le ship, bien que le
portail autorisât déjà l'expédition.

| Constat | Ce qui a été fait | Morsure |
|---|---|---|
| **F1** | Garde **comportementale** au lieu du balayage de fichiers suggéré : le cas intercepte `provideOrganizations`, importe le vrai `apps/web/lib/organizations.ts`, prend le `seatSync` que le point de composition remet réellement au module, et le fait tourner contre une facturation en échec. Un fil coupé rend `true` sans interroger personne ; le vrai fil rend `false` et porte le périmètre. Sans base, sans service construit, valable dans les deux configurations. | **1 rouge** — contre **0 sur 1708** avant |
| **F2** | Ligne d'invariant réécrite en mesure : « sur les deux écritures où ce l'est jusqu'ici », colonne de preuve nommant **les quatre écritures** qui changent le nombre de lignes de `organization_member` — `consumeInvitation` et `removeMember` synchronisent, `deleteMembershipsOf` et `deleteOrganization` non. Rien n'a été câblé. | — |
| **F3** | Coût réel écrit au site de la séquence et dans l'`AGENTS.md` du module. ADR 046 non touché (immuable). | — |
| **F4** | `apps/web/AGENTS.md` (« Cinq fichiers », et la dépendance `seatSync` — la seule qui peut **annuler** une écriture d'appartenance) et `packages/payments-testing/AGENTS.md` (le mode local applique la quantité à **toutes** les lignes, là où l'adaptateur refuse un abonnement multi-lignes). | — |
| **F5** | `perSeat` documente désormais qu'il est **sans effet** sur une offre `one_time`. | — |

### Deux corrections apportées à cette revue

- **F3, le pire cas** : ~**16,6 s**, pas ~20 s — deux appels × (2 tentatives × 4 s
  + un recul ≤ 300 ms), d'après `TIMEOUT_MS`, `MAX_ATTEMPTS` et le recul de
  `retry.ts:145-149`. Raisonné, non observé.
- **F3, le verrou** : il n'est tenu pendant la séquence que sur `removeMember`.
  `consumeInvitation` ne prend jamais `lockOrganizationMembership`.

### Une déviation assumée sur le remède de F1

La revue proposait un balayage de fichiers (« `lib/organizations.ts` nomme-t-il
`seatSyncOf` ? »). Écarté : un `grep` serait vert sur un câblage qui épelle le
nom tout en remettant au module quelque chose d'inerte. La garde retenue mesure
le **comportement** du fil, pas sa présence textuelle.

### Contre-vérification indépendante (contexte principal)

Mutation M11 reposée à la main sur `apps/web/lib/organizations.ts:235` →
**rouge** (« accroche au module la synchronisation qui interroge vraiment la
facturation »), arbre restauré et `git diff --exit-code` propre. Puis
`pnpm typecheck` 24 tâches, `pnpm lint` sans anomalie, `pnpm test`
**1709 passés / 8 sautés**, `pnpm test:e2e` **86 passés / 8 sautés**, contre une
base réellement joignable. Un seul commit sur la branche.

### Ce qui reste ouvert, hors périmètre

Le catalogue livré ne déclare **aucune offre au siège** : dans la configuration
par défaut, aucune ligne du chemin d'écriture ne s'exécute. Aucun critère n'en
est faux, mais ce code ne sera exercé pour de vrai qu'au premier projet qui vend
au siège — et le **proratage** appliqué par le fournisseur quand la quantité
change en cours de période, que l'ADR 046 déclare explicitement ne pas trancher,
n'a encore été vu par personne.

Max severity: major
Ship allowed: yes
