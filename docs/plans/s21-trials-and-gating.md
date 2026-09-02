---
story: s21-trials-and-gating
validated: yes
---

# Plan — s21-trials-and-gating

Recherche : `docs/research/s21-trials-and-gating.md`. Pas de `/ks-design` :
l'écran ajouté ne compose que des composants existants du design system
(`PageHeader`, `Card`, `EmptyState`, `Alert`, `Button`).

## Les deux décisions structurantes

**ADR 043 — la fonctionnalité réservée est un niveau de protection déclaré, et
le droit est résolu par un prédicat injecté.** Le gating n'appartient pas au
module `billing` (son `AGENTS.md` le dit), et il doit répondre quand ce module
est **coupé** : il vit donc dans `@repo/core`, comme `resolveDataOwner`.
`RouteProtection` gagne `{ level: 'entitlement', feature }`, et
`dispatchModuleRequest` reçoit un `resolveFeatures` de la même forme que
`resolveSession` — **fail-closed** : pas de résolveur, pas d'accès.

**ADR 044 — l'essai est un droit qui expire par le temps, accordé une fois par
périmètre.** Deux moitiés, et il faut les deux : `trial_end` devient **opposable
localement** (aucun événement du fournisseur n'a à arriver), et `openCheckout`
n'envoie `trialPeriodDays` que si aucun abonnement du client ne porte déjà un
`trial_end`. Aucune table nouvelle, donc aucune donnée personnelle nouvelle,
donc ni `dataCategories`, ni `purge`, ni `export` à rouvrir.

## Sections de `docs/security.md` touchées

§3 Autorisation (vérification côté serveur, jamais par un écran qui masque ;
chaque combinaison état × fonctionnalité couverte par un test d'API) et
§4 Entrées et sorties (validation de la configuration au démarrage). §5 pour le
refus d'un démarrage nommant la déclaration fautive.

## Tâches

- [x] **1. `@repo/core` — la règle de gating et le quatrième niveau de protection.**
      `src/entitlement.ts` : `FeatureGate`, `FeatureGateError`, `parseFeatureGates`
      (identifiant `kebab-case`, unique, au moins une offre, offres connues quand
      la liste est fournie), `allowsFeature`, `entitledFeatureIds`,
      `entitlementFeatureOf`, `assertGatesCoverRoutes`. `RouteProtection` gagne
      `{ level: 'entitlement', feature }` ; `satisfiesProtection` en répond la
      **moitié session** et rien de plus. Test : `packages/core/src/entitlement.test.ts`
      (nouveau fichier 1/2).

- [x] **2. Le répartiteur refuse en 403, fail-closed.**
      `dispatchModuleRequest` : sur une route `entitlement`, session absente →
      401 ; résolveur absent ou fonctionnalité non accordée → **403**, sans que
      le gestionnaire soit appelé. Cas ajoutés à `tests/module-registry.test.ts`.

- [x] **3. `demo-enabled` porte la fonctionnalité réservée.**
      `DEMO_PREMIUM_FEATURE`, une route `GET /demo-enabled/premium/report`
      protégée par ce niveau, l'entrée de navigation correspondante et ses deux
      libellés `fr`/`en`. Le module ne connaît pas `billing` : il **nomme** une
      fonctionnalité, la configuration dit quelles offres l'ouvrent.

- [x] **4. `config/gating.ts` et le refus au démarrage.**
      Le fichier que le propriétaire édite. `apps/web/next.config.ts` valide les
      déclarations sans condition de phase — et confronte les offres nommées au
      catalogue quand le module `billing` est activé. Cas ajoutés à
      `tests/env-wiring.test.ts` ou `tests/entitlements.test.ts` selon l'endroit
      du défaut.

- [x] **5. `billing/domain` — l'essai expire, et l'accès devient nommé par offre.**
      `grantsAccess` : un `trialing` dont le terme est passé n'accorde plus rien.
      `displayStateOf` : il s'affiche `expired`, pas « essai en cours ».
      `trialAlreadyUsed(subscriptions)`. `entitledOfferIds(subscriptions,
      purchases, now)` — l'accès **consolidé**, nommé par offre, sans toucher
      `grantsBillingAccess`. Cas ajoutés à `src/domain/billing-rules.test.ts`.

- [x] **6. `billing/application` — `entitledOffers`, et l'essai une seule fois.**
      Nouveau cas d'usage `entitledOffers({ session })`. `openCheckout` résout
      `trialPeriodDays` par `trialAlreadyUsed`. Les deux fermetures de s20 ne
      bougent pas. Cas ajoutés à `tests/billing.test.ts`, contre la vraie base et
      le vrai adaptateur.

- [x] **7. `apps/web/lib/entitlements.ts` — la fonction unique, et son câblage.**
      `entitlements.allows(session, feature)` et `entitlements.featuresOf(session)` ;
      module `billing` coupé → **toutes** les fonctionnalités déclarées.
      `apps/web/app/api/modules/[...path]/route.ts` passe `resolveFeatures`.
      Test : `tests/entitlements.test.ts` (nouveau fichier 2/2).

- [x] **8. L'écran `/premium` — l'invitation à souscrire.**
      Accès accordé → le contenu ; refusé → un `EmptyState` qui invite à
      souscrire et mène à `/billing`. Aucun texte en dur : `app.premium.*` en
      `fr` et `en`. Deux rendus inscrits dans `tests/rendered-text.test.ts`, avec
      leur `refuses` **dérivé**.

- [x] **9. Le parcours navigateur.**
      `e2e/billing.spec.ts` : l'invitation avant toute souscription, puis
      l'accès **pendant l'essai** ouvert par le checkout simulé. Attentes
      dérivées de `billing.available`.

- [x] **10. Les décisions et les règles locales.**
      `docs/decisions/043-*.md` et `044-*.md`. `AGENTS.md` de `packages/core`,
      `packages/modules/demo-enabled`, `packages/modules/billing`, `apps/web`, et
      la phrase qui énumère les niveaux de protection dans `AGENTS.md` racine et
      `docs/architecture.md`.

## Ce que ce plan ne fait pas

- **Aucun quota quantitatif** : la story l'exclut, et un compteur de
  consommation est la brique de la facturation à l'usage, au cimetière.
- **Aucune table**, aucune migration, aucune catégorie de données.
- **Aucun second fournisseur**, aucun retrait du repli de lecture de s20.
- **Aucune reprise des options rejetées** par les ADR 037 et 038.
