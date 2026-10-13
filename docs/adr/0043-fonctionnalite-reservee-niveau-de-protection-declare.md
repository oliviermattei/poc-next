# ADR 043 — Une fonctionnalité réservée est un niveau de protection déclaré, résolu par un prédicat injecté

- Status: accepted
- Date: 2026-09-02

Réserver une fonctionnalité à une offre exige une vérification unique côté serveur, un 403 sur l'API, une invitation à souscrire à l'écran, et que tout soit accordé quand le module `billing` est coupé — donc une règle qui répond quand ce module n'est pas monté. Ce n'est pas non plus la matrice des rôles (ADR 030) : un `member` d'une organisation abonnée utilise ce qu'elle paie sans pouvoir le résilier.

**`RouteProtection` a un niveau `entitlement`** (`{ level: 'entitlement'; feature: string }`), déclaré sur une route ou une entrée de navigation. Le module nomme une fonctionnalité, jamais l'offre qui l'ouvre, et n'importe pas `billing`. La règle vit dans `packages/core/src/entitlement.ts` (`allowsFeature`, `entitledFeatureIds`, `assertGatesCoverRoutes`), qui ne reçoit que des chaînes ; la correspondance fonctionnalité → offres est `config/gating.ts`, que le propriétaire du projet édite, où détenir l'une des offres suffit.

**Le répartiteur reçoit `resolveFeatures` et échoue fermé** : sans session, 401 ; sans résolveur ou sans droit, 403, sans appeler le gestionnaire. 403 et non 404 : l'existence de la fonctionnalité est publique, le catalogue la vend. Le prédicat est construit au point de composition (`apps/web/lib/entitlements.ts`, fabrique `createEntitlements`) : `billing` coupé, il rend toutes les fonctionnalités **déclarées** — une fonctionnalité inconnue reste refusée dans les deux configurations.

**Une entrée de navigation réservée reste visible** — `satisfiesProtection`, synchrone, traite `entitlement` comme `authenticated` — et mène à un écran de l'application, pas à la route d'API : une fonctionnalité qu'on ne voit pas ne s'achète pas.

**Le démarrage refuse une déclaration incohérente** (`assertFeatureGates`, garde de démarrage de `apps/web/lib/startup.ts`, ADR 049) : une fonctionnalité qui nomme une offre absente du catalogue, ou une route qui réserve une fonctionnalité non déclarée — elle serait refusée à tout le monde, en silence.

## Considered options

- **La règle dans `billing`, ou un module `entitlements`** — rejeté : elle doit répondre module coupé ; un module jamais désactivable est du socle, et le socle est `@repo/core`.
- **Un appel dans chaque gestionnaire de route** — rejeté : une route qui l'oublie est servie sans que rien ne le dise ; un niveau déclaré se vérifie par le registre.
- **Accorder quand aucun résolveur n'est branché** — rejeté : un oubli offrirait gratuitement ce que le produit vend, sans que personne ne le voie.
- **Des niveaux ordonnés (`free < pro < enterprise`)** — rejeté : abonnement et licence à vie ne s'ordonnent pas.

## Consequences

Le gating porte sur la détention d'une offre, jamais sur un volume consommé : un compteur de consommation est la brique de la facturation à l'usage, au cimetière du PRD. Une ligne de `config/gating.ts` que nulle route ne nomme est inerte ; l'inverse est refusé au démarrage.
