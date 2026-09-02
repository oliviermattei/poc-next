# Revue anti-hallucination — s21-trials-and-gating

Branche `feature/s21-trials-and-gating`, commit unique `29e6840`.
Diff jugé : `git diff dev...feature/s21-trials-and-gating`. Base `s21`.
Revue menée dans le worktree `.claude/worktrees/agent-a1cb10ded3429bf47`.

## 1. Les commandes, dans les deux configurations de modules

Mesuré le 2 septembre 2026, `billing` activé puis coupé par
`node packages/cli/bin/ks.mjs toggle billing`, la configuration étant restaurée
et l'arbre reprouvé propre (`git diff --exit-code`) avant l'écriture de ce
rapport.

| Commande | `billing` activé | `billing` coupé |
|---|---|---|
| `pnpm test` | 1 653 verts, 7 ignorés | 1 651 verts, 9 ignorés |
| `pnpm typecheck` | vert (24 tâches) | vert |
| `pnpm lint` | vert | vert |
| `pnpm test:e2e` (`E2E_PORT=3121`) | 82 verts, 7 ignorés | 75 verts, 14 ignorés |
| `pnpm run audit` | 1 avis, aucun au seuil élevé non couvert | idem |
| `pnpm db:migrate` ×2 | vert, sans effet supplémentaire | — |
| `pnpm db:seed` | vert | — |

## 2. Les références du diff, vérifiées une à une

Chaque symbole importé par le diff a été ouvert à sa cible : `entitlementFeatureOf`,
`parseFeatureGates`, `allowsFeature`, `entitledFeatureIds`, `assertGatesCoverRoutes`
(`packages/core/src/entitlement.ts`), `trialDaysFor`, `entitledOfferIds`
(`packages/modules/billing/src/domain/`), `DEMO_PREMIUM_FEATURE`
(`packages/modules/demo-enabled/src/presentation/demo-item-routes.ts`),
`BILLING_SCREEN_PATH`, `billingCatalogue`, `enabledModules`. Aucune invention.

Deux chaînes de la story vérifiées jusqu'au bout plutôt que crues :

- `listSubscriptions` de l'adaptateur Stripe appelle `client.subscriptions.list`
  avec **`status: 'all'`** (`packages/adapters/stripe/src/stripe-payments.ts:566`)
  et `normalizeSubscription` lit `trial_end` (ligne 191) ; `replaceSubscriptions`
  n'est qu'un *upsert*, il n'efface aucune ligne
  (`infrastructure/drizzle-billing-repositories.ts:620-660`). La mémoire d'essai
  est donc réellement reconstructible par `pnpm billing:reconcile`, comme l'ADR 044
  l'affirme. **Aucun test ne le mesure** (constat m4).
- `config/billing.ts` ne déclare que `pro-monthly`, `pro-yearly` et `lifetime`.

## 3. Le plan, tâche par tâche

Les dix tâches sont présentes et faites. Un seul écart, dans l'autre sens que
d'habitude : la tâche 8 demande un `refuses` **dérivé** pour les deux rendus de
`tests/rendered-text.test.ts` ; le diff écrit `refuses: null` en dur (constat m5).
Rien dans le diff que le plan n'ait demandé — les deux fichiers hors périmètre
(`AGENTS.md` racine, `docs/architecture.md`) sont nommés par la tâche 10, et ils
ne font qu'ajouter le quatrième niveau à une énumération qui était devenue
fausse. Ce n'est pas une décision glissée dans une doc.

## 4. Les mutations posées, et où elles ont été posées

Restaurées une à une, `git diff --exit-code` propre avant l'écriture.

| Mutation | Où elle est posée | Rouges |
|---|---|---|
| `grantsAccess` : un `trialing` n'expire plus | règle (`billing/domain/subscription.ts`) | **5** (2 fichiers) |
| `trialDaysFor` rend toujours les jours de l'offre | règle (`billing/domain`) | **4** — dont 2 dans `tests/billing.test.ts`, contre la vraie base |
| `entitledOfferIds` n'exige plus que l'abonnement donne l'accès | règle (`billing/domain/purchase.ts`) | **5** |
| `createEntitlements` accorde tout, module monté ou non | **point de composition** (`apps/web/lib/entitlements.ts`) | **3** — dont 1 sur l'objet réellement composé |
| le répartiteur accorde quand aucun résolveur n'est branché | `packages/core/src/registry.ts` | **1** |
| `assertGatesCoverRoutes` ne refuse plus rien | `packages/core/src/entitlement.ts` | **2** |
| `allowsFeature` accorde toujours | `packages/core/src/entitlement.ts` | **3** |
| retirer `assertFeatureGates()` de `next.config.ts` | **point de démarrage** | **2** |
| **retirer `resolveFeatures` du point de montage** | `apps/web/app/api/modules/[...path]/route.ts` | **0 sur `pnpm test`** (1 653/1 653 verts) — **1 rouge sur `pnpm test:e2e e2e/billing.spec.ts`** |

Les comptes écrits par l'implémenteur dans `packages/core/AGENTS.md`,
`apps/web/AGENTS.md` et `packages/modules/billing/AGENTS.md` ont été recomptés :
ils sont exacts, y compris le « 1 653 sur 1 653 » de la dernière ligne. Le dépôt
a écrit sa propre mutation verte au lieu de la taire — c'est ce que le socle
« dépôt orienté agent » demande.

## 5. Vérification navigateur, sous le build de production

`pnpm build --force` avant chaque mesure ; serveur `next start` (build de
production) piloté par Chromium, hors du harnais Playwright — lequel sert
`next dev`. Les modes locaux (`OAUTH_LOCAL_PROVIDER`, `STORAGE_LOCAL_DIRECTORY`,
`PAYMENTS_LOCAL_MODE`) refusent `NODE_ENV=production`, ce qui est le comportement
attendu ; la mesure a donc été faite sur l'artefact de production servi avec
`NODE_ENV=development`.

- **`billing` activé, compte sans offre** — `/premium` affiche « Réservé aux
  offres payantes », la description, et l'action « Voir les offres » vers
  `/billing`. `GET /api/modules/demo-enabled/premium/report` → **403
  `{"error":"forbidden"}`**, session comprise. Rendu vérifié à 1 280 px et à
  390 px : l'état vide ne tronque rien, l'action reste atteignable.
- **`billing` activé, après souscription** — le checkout simulé ouvre un
  abonnement **en essai** (« Essai jusqu'au 16 septembre 2026 »), `/premium`
  affiche « Accès ouvert » et la route rend **200 `{"count":0,"owners":0}`**.
  Le quatrième critère est donc tenu par un essai que personne n'a payé.
- **`billing` coupé** — `/premium` affiche l'accès ouvert, **aucune invitation**,
  et la route rend 200. Sixième critère tenu, sur l'artefact de production.

## 6. Constats

Aucun critique. Aucun majeur.

**m1 — le câblage du résolveur n'a de filet que dans une configuration.**
Retirer `resolveFeatures` du point de montage laisse `pnpm test` intégralement
vert ; seul `e2e/billing.spec.ts` rougit. Or ce parcours porte
`test.skip(!mounted)` : **module `billing` coupé, aucune commande du dépôt ne
rougit** si la ligne disparaît. La conséquence est fermée (403 partout, pas un
accès offert), et `tests/organizations.test.ts:2510` importe déjà le vrai
`GET` du point de montage — un cas d'assemblage y coûterait peu. À faire au
prochain cycle. *(minor)*

**m2 — la copie de l'écran reste fausse dans une configuration.**
`app.premium.description` dit « Une fonctionnalité réservée aux offres
payantes. » et s'affiche **aussi** module coupé, au-dessus d'une carte « Accès
ouvert », dans un produit qui ne vend rien. Mesuré au navigateur, capture à
l'appui. L'état verrouillé, lui, dit vrai — il est inatteignable module coupé. *(minor)*

**m3 — un cas de test qui ne mesure pas ce que son nom annonce.**
`tests/billing.test.ts`, « ne le réaccorde pas davantage sur une **autre**
offre » : le cas rouvre `pro-monthly`, pas une autre offre, et son commentaire
nomme `team-monthly`, **qui n'existe pas dans `config/billing.ts`**. Le cas est
donc un doublon du précédent, et la reprise d'essai *après changement d'offre* —
le scénario nommé par l'ADR 044 — n'est mesurée qu'au `domain`, où la règle est
de toute façon agnostique de l'offre. Aucun défaut de production : `trialDaysFor`
ne regarde que `trialEnd`. *(minor)*

**m4 — « la réconciliation rétablit la mémoire d'essai » n'est pas mesurée.**
L'ADR 044 et `packages/modules/billing/AGENTS.md` l'affirment. C'est **vrai** —
je l'ai vérifié en lisant `status: 'all'`, le mappage de `trial_end` et l'absence
de suppression dans `replaceSubscriptions` — mais aucun cas de
`tests/billing.test.ts` ne pose un `trial_end` par réconciliation puis n'observe
que le checkout suivant n'accorde plus d'essai. C'est exactement la forme
« affirmation mesurée que personne ne peut rejouer » contre laquelle le socle
met en garde. *(minor)*

**m5 — dérive de plan, mineure.** La tâche 8 demande un `refuses` **dérivé** pour
les deux rendus de `/premium` ; le diff écrit `refuses: null` en dur. C'est
correct au fond (l'écran rend dans les deux configurations), mais ce n'est pas
ce que le plan validé demandait. *(minor)*

**m6 — l'invitation à souscrire n'est atteignable qu'en tapant l'URL.**
`/premium` n'est lié par aucune navigation (vérifié par balayage de
`apps/web`). La seule entrée visible, « Rapport détaillé », pointe la route
d'API du module et rend un `{"error":"forbidden"}` brut — pédagogie nulle, alors
que l'ADR 043 justifie précisément la visibilité de l'entrée par l'invitation.
C'est la convention du dépôt pour un module sans écran (`admin-report` fait
pareil), donc pas une régression ; mais le second critère de la story est tenu
par un écran que personne ne peut atteindre en cliquant. *(minor)*

**m7 — code mort dans `parseFeatureGates`.** Les `continue` qui suivent chaque
appel à `fail(...)` sont inatteignables : `fail` est typée `never` et lève. Ils
suggèrent une accumulation d'erreurs qui n'existe pas. *(minor)*

## 7. Arbitrages, plutôt que constats

- **403 et non 404.** Assumé, et je le valide : la règle de `docs/security.md` §3
  vise l'existence de la ressource **d'autrui**. Ici, la fonctionnalité est déjà
  publique — l'entrée de navigation s'affiche pour toute session, le catalogue
  d'offres la vend. Le corps du refus est `{"error":"forbidden"}`, sans nom de
  périmètre ni identifiant. Rien de neuf ne fuit, et `docs/security.md` n'a pas
  été touché pour faire passer le choix.
- **`past_due` garde l'accès jusqu'à la fin de la période payée.** Le cinquième
  critère se lit « un abonnement en retard de paiement retire l'accès » ; le
  dépôt tient un délai de grâce hérité de s19, et `entitledOfferIds` le suit. Les
  deux bords sont testés (`en retard, période encore couverte` → l'offre ;
  `période dépassée` → rien). Défendable, et cohérent avec l'existant.
- **Un essai par périmètre, donc un essai par organisation.** L'ADR 044 dit « une
  fois par périmètre » et le code le tient : la trace est cherchée sur les
  abonnements du **client** de ce périmètre. Un compte qui crée plusieurs
  organisations obtient donc plusieurs essais. C'est la conséquence directe du
  modèle de périmètre, mais elle n'est nommée ni dans l'ADR ni dans un
  `AGENTS.md`, alors que la conséquence voisine (cache purgé) l'est.
- **Essai retrouvé après purge du cache.** Assumé et écrit dans l'ADR 044,
  rattaché au droit à l'effacement. Acceptable en l'état ; s34 devra le relire.
- **Fail-closed devant un résolveur qui lève.** Une exception de
  `entitlements.featuresOf` remonte hors de `dispatchModuleRequest` : la requête
  échoue en 500, le gestionnaire n'est pas atteint. Fermé, donc sûr, mais non
  couvert par un cas.

## 8. Ce que je n'ai pas pu vérifier

- **Le vrai Stripe.** Tout ce qui touche au fournisseur passe par le double
  d'enregistrement ou le mode local. Que `subscription_data[trial_period_days]`
  se comporte comme la simulation, et qu'un `trial_end` relu par
  `subscriptions.list` reconstruise la mémoire d'essai, n'a été vérifié qu'en
  lisant le SDK et l'adaptateur. **Geste humain** : ouvrir un checkout avec une
  clé de test, laisser l'essai courir, résilier, rouvrir un checkout sur
  `pro-yearly`, et lire ce qui part au fournisseur.
- **L'expiration d'essai au navigateur.** Elle est mesurée aux deux bords en
  déplaçant l'horloge dans `tests/billing.test.ts` et dans le `domain`, jamais à
  l'écran : le serveur de production ne prend pas d'horloge injectée. **Geste
  humain** : forcer un `trial_end` passé en base et recharger `/premium` et
  `/billing`.
- **La configuration `billing` coupé au navigateur, sur le chemin verrouillé.**
  Inatteignable par construction — module coupé, tout est accordé. Seul l'état
  « accès ouvert » a donc été vu.
- **Le parcours de bout en bout sous un vrai build de production.** Le harnais
  Playwright sert `next dev` ; mes mesures navigateur sur l'artefact de
  production ont dû tourner avec `NODE_ENV=development`, faute de quoi les modes
  locaux refusent de démarrer. Les en-têtes de sécurité et la CSP en production
  réelle ne sont donc pas ce que j'ai vu.
- **La concurrence.** Deux checkouts simultanés sur le même périmètre, chacun
  lisant des abonnements sans `trial_end`, peuvent tous deux accorder un essai.
  Non mesuré, et la clé d'idempotence
  (`checkout:<périmètre>:<offre>`) ne couvre pas deux offres différentes.
  **Geste humain** : le tenter, ou l'écrire comme risque connu.

## 9. Socles

- **Sécurité** — §3 : la vérification est côté serveur, au répartiteur, avant le
  gestionnaire ; l'écran ne fait que suivre. §4 : `config/gating.ts` est validée,
  et son refus nomme la fonctionnalité et le champ. §5 : le démarrage refuse une
  déclaration incohérente, sans condition de phase, et le refus est mesuré. Rien
  n'a été affaibli dans `docs/security.md`.
- **Fiabilité** — aucune table, aucune migration, aucun appel sortant nouveau sur
  le chemin d'une route réservée. Le tiers absent ne casse rien : module coupé,
  la facturation n'est même pas interrogée (mesuré : le double n'est jamais
  appelé).
- **Dépôt orienté agent** — quatre `AGENTS.md` mis à jour ou créés, chacun avec
  ses comptes de mutation datés et la mention explicite « pas un inventaire de ce
  qui est couvert ». Les comptes ont été recontrôlés et sont exacts.
- **ADR** — 043 et 044 conformes au code livré. 034 (Stripe fait foi, la
  réconciliation n'efface ni ne ré-accorde), 037 et 038 (options rejetées non
  rejouées), 024 (aucun `.tsx` au barrel) : rien de contredit. Cimetière du PRD
  respecté — aucun compteur de consommation n'est introduit.

## 10. Clôture — ce que le second passage a fermé

Commit `16204db`, sur `feature/s21-trials-and-gating`. Mesuré le 2 septembre
2026, dans les **deux** configurations de modules (`billing` activé, puis coupé
par `node packages/cli/bin/ks.mjs toggle billing`, configuration restaurée
ensuite et arbre reprouvé propre).

| Constat | Fermé | Comment |
|---|---|---|
| **m1** | oui | `tests/entitlements.test.ts` sert la route réservée par le **vrai** point de montage, `billing` coupé — la configuration où le parcours navigateur est sauté |
| **m2** | oui | `app.premium.description` décrit la fonctionnalité, plus son prix ; l'état verrouillé, seul, parle des offres |
| **m3** | oui | le catalogue de la suite porte une seconde offre d'abonnement à essai, et le cas dérive la sienne au lieu de rouvrir `pro-monthly` |
| **m4** | oui | un cas efface le cache d'abonnements, observe l'essai redevenu disponible, réconcilie, et le voit se refermer |
| **m5** | oui | `refuses` des deux rendus de `/premium` dérivé de `config/gating.ts` |
| **m6** | oui | l'entrée de navigation mène à l'écran `/premium` ; la route d'API reste du JSON, et le parcours mesure le clic |
| **m7** | oui | `fail` annotée à sa déclaration, les trois `continue` inatteignables retirés |

### Les commandes, dans les deux configurations

| Commande | `billing` activé | `billing` coupé |
|---|---|---|
| `pnpm test` | 1 654 verts, 8 ignorés | 1 653 verts, 9 ignorés |
| `pnpm typecheck` | vert (24 tâches) | vert |
| `pnpm lint` | vert | vert |
| `pnpm test:e2e` (`E2E_PORT=3121`) | 83 verts, 7 ignorés | **suite complète non remesurée** après la dernière correction de sélecteur — le disque de la machine s'est rempli ; le parcours ajouté y a été mesuré vert seul (`-g navigation`), et la suite complète y rendait 75 verts / 14 ignorés / 1 rouge avant cette correction |
| `pnpm run audit` | 1 avis, aucun au seuil élevé non couvert | idem |
| `pnpm build --force` | vert | vert |
| `pnpm db:migrate` ×2, `pnpm db:seed` | vert, sans effet supplémentaire | — |

### Les mutations du second passage, à l'endroit du défaut

Restaurées une à une ; `git diff --exit-code` propre avant le commit.

| Mutation | Où elle est posée | Rouges |
|---|---|---|
| **retirer `resolveFeatures` du point de montage**, `billing` **coupé** | point de montage (`apps/web/app/api/modules/[...path]/route.ts`) | **1** sur `pnpm test` — là où le premier passage en comptait **0** |
| l'entrée de navigation réservée pointe la route d'API | contrat du module (`demo-item-routes.ts`) | **1** sur `pnpm test:e2e e2e/billing.spec.ts`, **dans les deux configurations** |
| supprimer `apps/web/app/premium/page.tsx` | l'écran lui-même | **2** sur `pnpm test` |
| `replaceSubscriptions` écrit `trialEnd: null` | l'écriture de la **réconciliation** (`drizzle-billing-repositories.ts`) | **1** sur `tests/billing.test.ts` (99 verts) |
| l'adaptateur ne mappe plus `trial_end` | `packages/adapters/stripe/src/stripe-payments.ts` | **4** sur `tests/billing.test.ts` + le `domain` (186 verts) |

La quatrième ligne est celle qui manquait au premier passage : elle est posée à
l'endroit précis que l'ADR 044 revendiquait — l'écriture faite par la commande
de réconciliation — et non sur le mappage commun, que le chemin du webhook
couvre déjà.

### Vérification navigateur, sous le build de production

`pnpm build --force`, puis `next start` piloté par Chromium hors du harnais
Playwright, à 1 280 px et à 390 px. Les modes locaux refusant
`NODE_ENV=production`, la mesure porte sur l'artefact de production servi avec
`NODE_ENV=development` — même limite qu'au premier passage.

- **`billing` activé, compte sans offre** — le clic sur « Rapport détaillé »
  dans la navigation mène à `/fr/premium` (et non plus à un corps JSON). L'écran
  rend : « Rapport détaillé | Le rapport détaillé des éléments de démonstration.
  | Réservé aux offres payantes | … | Voir les offres ».
- **`billing` coupé** — même clic, même écran : « Rapport détaillé | Le rapport
  détaillé des éléments de démonstration. | Votre rapport détaillé | Accès
  ouvert | Cette fonctionnalité vous est ouverte. » **Plus une seule phrase
  fausse au-dessus de l'accès ouvert**, et toujours aucune invitation.

### Les deux conséquences écrites, pas corrigées

Toutes deux dans les *Consequences* de l'ADR 044, à côté de celle du cache
purgé : un compte qui crée plusieurs organisations obtient **plusieurs essais**
— conséquence directe du modèle de périmètre, qu'un projet vendant cher devra
rouvrir par un ADR —, et l'essai retrouvé après purge du cache, déjà écrite.

### Ce qui reste ouvert

**À remesurer avant le ship** : `E2E_PORT=3121 pnpm test:e2e`, module `billing`
coupé, sur l'état commité. La suite y a tourné entière une fois — 75 verts, 14
ignorés, 1 rouge sur le parcours ajouté, dont le sélecteur de titre était
ambigu dans cette configuration —, le sélecteur a été corrigé et le parcours
remesuré vert seul, mais le disque de la machine s'est rempli avant la
reprise complète. Aucune autre commande n'est concernée : `pnpm test`,
`typecheck`, `lint` et `build` ont tourné entiers dans les deux configurations
après la correction.

Le reste est inchangé depuis le §8, à une chose près : la réconciliation de la mémoire
d'essai est désormais rejouée **contre la doublure de réseau**, jamais contre le
vrai Stripe. Le geste humain du §8 reste entier.

Max severity: minor
Ship allowed: yes
