# ADR 043 — Une fonctionnalité réservée est un niveau de protection déclaré, résolu par un prédicat injecté

- Status: accepted
- Date: 2026-09-02
- Scope: story s21-trials-and-gating

## Context

s21 demande de « conditionner une fonctionnalité à une offre » avec une
**vérification unique appelée côté serveur**, un **403** sur l'API, une
invitation à souscrire à l'écran, et — sixième critère — que **le module de
facturation coupé, la vérification accorde tout**.

Quatre contraintes se croisent, et aucune n'est tranchée par un ADR existant.

**1. Le gating n'appartient pas au module de facturation.** C'est écrit dans
`packages/modules/billing/AGENTS.md` depuis s19 : ce module « ne possède ni la
page de tarifs publique (s22), ni le gating par offre (s21) ». La raison est
exécutable, pas esthétique : la vérification doit **répondre quand ce module
n'est pas monté**, et un module coupé n'a ni route, ni service, ni code appelé.

**2. Le gating n'est pas la matrice de rôles de s17.** `ORGANIZATION_ACTION`
dit qui, dans une organisation, a le droit de **gérer** la facturation. La
question de s21 est différente : ce périmètre a-t-il **payé** pour cette
fonctionnalité ? Un `member` d'une organisation abonnée doit utiliser ce que
l'organisation paie sans pouvoir le résilier. Ranger l'un dans l'autre ferait
payer une organisation pour une seule personne.

**3. « Une action qui n'a pas de ligne n'est refusée par personne » — et son
inverse.** La revue de s17 a mesuré le premier. Ici le défaut symétrique est
pire : une route qui réserve une fonctionnalité que la configuration ne déclare
pas serait refusée à **tout le monde**, définitivement, y compris à qui a payé,
et aucune commande ne le dirait.

**4. `satisfiesProtection` est synchrone.** Elle sert à la fois le répartiteur
et `visibleNavigation`, qui filtre une liste au rendu. Savoir quelles offres un
périmètre détient demande une lecture.

## Decision

### 1. `RouteProtection` gagne un quatrième niveau, `entitlement`

```ts
| { readonly level: 'entitlement'; readonly feature: string }
```

Le module **nomme** une fonctionnalité ; il ne dit pas quelle offre l'ouvre, et
il n'importe donc jamais le module de facturation. Le niveau est déclaré au
contrat, comme les trois autres, sur une route **et** sur une entrée de
navigation.

### 2. La règle vit dans `@repo/core`, la correspondance dans `config/gating.ts`

`packages/core/src/entitlement.ts` porte `FeatureGate` (`id`, `offers`),
`parseFeatureGates`, `allowsFeature`, `entitledFeatureIds` et
`assertGatesCoverRoutes`. `@repo/core` ne connaît ni offre, ni abonnement, ni
achat : il reçoit des **chaînes** — les offres détenues — et en dérive les
fonctionnalités ouvertes. C'est exactement la raison qui y a mis
`resolveDataOwner` (ADR 025) : la règle doit exister quand le module est coupé.

`config/gating.ts` est le fichier que le propriétaire édite. `offers` est une
**disjonction** : détenir l'une suffit.

### 3. Le répartiteur reçoit `resolveFeatures`, et il est fail-closed

`DispatchOptions.resolveFeatures?: (session) => Promise<ReadonlySet<string>>`,
même forme et même sens de dépendance que `resolveSession`. Sur une route
`entitlement` : pas de session → **401** (il n'y a pas de périmètre dont
parler) ; pas de résolveur, ou fonctionnalité non accordée → **403**, sans que
le gestionnaire soit appelé.

**403 et non 404** : l'existence de la fonctionnalité est publique — le
catalogue d'offres la vend —, seul son usage est réservé. La règle des 404 de
`docs/security.md` §3 protège l'existence de la ressource **d'autrui**, ce qui
n'est pas le cas ici.

### 4. Une entrée de navigation réservée reste **visible**

`satisfiesProtection` traite `entitlement` comme `authenticated` : une session
suffit à la voir. Le second critère demande une **invitation à souscrire**, pas
une disparition — une fonctionnalité qu'on ne voit pas ne s'achète pas. La garde
qui compte reste celle du serveur.

**Et elle mène à un écran, pas à une route d'API.** Une entrée visible qui
désignait la route montée affichait `{"error":"forbidden"}` au premier clic :
l'invitation que ce paragraphe justifie n'était atteignable qu'en tapant l'URL.
Le module ne connaît donc que le **chemin** de l'écran que l'application sert
(`DEMO_PREMIUM_SCREEN_PATH`), exactement comme `billing` connaît
`BILLING_SCREEN_PATH` — il n'en rend rien. La route d'API, elle, reste du JSON :
c'est ce qu'une route d'API sert, et son 403 reste la garde qu'aucun écran ne
contourne. `tests/module-registry.test.ts` distingue désormais les deux
destinations d'un `href` — route montée servie par le répartiteur, ou écran dont
le fichier de page doit exister — et `e2e/billing.spec.ts` mesure le clic, dans
les deux configurations de modules.

### 5. Le démarrage refuse une déclaration incohérente

`apps/web/next.config.ts` appelle `assertFeatureGates()` **sans condition de
phase** : deux fichiers de configuration, aucune variable d'environnement. Il
refuse une fonctionnalité qui nomme une offre absente du catalogue (seulement
quand le module de facturation est activé — sans lui, il n'y a pas de catalogue)
et une route ou une entrée de navigation qui réserve une fonctionnalité non
déclarée.

### 6. La fonction unique vit au point de composition

`apps/web/lib/entitlements.ts` : `featuresOf(session)` et
`allows(session, feature)`. Module de facturation coupé, elle rend **toutes les
fonctionnalités déclarées** — pas « oui à n'importe quelle question » : une
route qui réserverait une fonctionnalité inconnue reste refusée dans les deux
configurations. La facturation n'est alors même pas interrogée : ni client, ni
offre, ni connexion ouverte.

La règle est écrite dans une fabrique injectable (`createEntitlements`), et pas
directement dans le module : c'est la leçon des constats M1 et M2 de la seconde
revue de s19, où une règle enfermée dans ce dossier laissait 1 320 cas sur 1 320
au vert quand on la neutralisait dans le module.

## Considered options

**Sur l'endroit de la règle**

- *Un fichier dans `packages/modules/billing`* — rejeté par le sixième critère :
  la vérification doit répondre module coupé, et un module coupé n'a pas de
  service construit. C'est aussi ce que l'`AGENTS.md` du module dit déjà.
- *Un nouveau module `entitlements`* — rejeté : un module optionnel qui doit
  répondre quand un autre est coupé et qui n'est lui-même jamais désactivable
  n'est pas un module, c'est du socle. `@repo/core` est le socle.
- *Ajouter la question à la matrice de s17* — rejeté (contrainte 2) : la matrice
  distingue des **rôles** dans une organisation, le gating distingue ce qui a
  été **payé** par un périmètre. Les fusionner refuserait à un `member` l'usage
  de ce que son organisation paie.

**Sur la forme de la garde**

- *Laisser chaque route appeler la fonction dans son gestionnaire* — rejeté :
  c'est « écrire de la logique d'accès à chaque écran », ce que la story existe
  pour éviter, et une route qui oublie l'appel est servie sans que rien ne le
  dise. Le niveau déclaré est vérifiable par le registre plutôt que par
  relecture, comme les trois autres.
- *Résoudre le droit dans `satisfiesProtection`* — impossible : elle est
  synchrone et sert la navigation. La rendre asynchrone imposerait un `await`
  au filtre de navigation de chaque rendu.
- *Accorder par défaut quand aucun résolveur n'est branché* — rejeté : un point
  de composition qui oublie la ligne offrirait gratuitement ce que le produit
  vend, et personne ne s'en apercevrait. Fail-closed casse une fonctionnalité
  payante, ce qui se voit tout de suite.

**Sur la déclaration**

- *Des niveaux ordonnés (`free < pro < enterprise`)* — rejeté : ce dépôt vend un
  abonnement **et** une licence à vie (s20), et rien n'ordonne les deux. Le
  premier ordre écrit serait faux, et le gating retomberait sur un `>=` entre
  choses incomparables.
- *Déclarer les fonctionnalités dans `config/billing.ts`* — rejeté : ce fichier
  décrit ce qui se vend, et il n'a de sens que module activé. Les déclarations
  de gating sont lues **dans les deux configurations**.
- *Ne rien valider et traiter une fonctionnalité inconnue comme « ouverte à
  tous »* — rejeté : elle deviendrait payante le jour où quelqu'un l'ajoute au
  fichier, et gratuite jusque-là, sans que rien ne le signale.

## Consequences

- Un quatrième niveau de protection existe : `AGENTS.md` racine,
  `docs/architecture.md`, `packages/core/AGENTS.md` et
  `packages/modules/demo-enabled/AGENTS.md` le nomment.
- `demo-enabled` porte la route et l'entrée réservées : c'est le module qui
  démontre en continu les niveaux de protection, et il ne dépend toujours
  d'aucun autre — il nomme une fonctionnalité, il n'importe pas la facturation.
- L'écran `/premium` de l'application démontre l'autre moitié du critère 2, et
  son segment est **réservé** dans `lib/organizations.ts`.
- **Ce qui reste ouvert** : le gating porte sur l'appartenance à une offre,
  jamais sur un volume consommé. Les quotas quantitatifs sont hors périmètre de
  la story, et un compteur de consommation est la brique dont la facturation à
  l'usage — au cimetière du PRD — a besoin. La limite de sièges de s23 est la
  seule exception assumée, et elle appartient à cette story-là.
- **Ce que personne ne vérifie** : qu'une fonctionnalité déclarée soit
  effectivement réservée quelque part. Une ligne de `config/gating.ts` que
  personne ne nomme est inerte, pas dangereuse — l'inverse, lui, est refusé au
  démarrage.
