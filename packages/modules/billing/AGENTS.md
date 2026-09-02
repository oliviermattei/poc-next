# packages/modules/billing — règles locales

Le module de facturation (s19). Il possède les offres, les abonnements et le
webhook entrant du fournisseur de paiement. Il ne possède **ni** la page de
tarifs publique (s22), **ni** l'achat unique (s20), **ni** le gating par offre
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

- de **prix, de montant ou de devise lus d'une requête** : le navigateur envoie
  un identifiant d'offre, et rien d'autre ;
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
  l'accès, l'état affiché, l'ordre d'application, le prix formaté. Un seul
  fichier pour les deux unités du `domain` : le coût d'une suite est dominé par
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

Ces comptes sont ceux des cas passés au rouge, sur les mutations **posées** —
pas un inventaire de ce qui est couvert.
