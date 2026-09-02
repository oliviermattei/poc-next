import { entitledFeatureIds, type FeatureGate, type ModuleSession } from '@repo/core'

import { billing } from './billing'
import { featureGates } from './feature-gates'

/**
 * **La fonction unique qui dit ce à quoi un compte a droit** (s21, ADR 043) —
 * le premier critère de la story, et le seul endroit du dépôt qui relie « ce
 * que ce périmètre a payé » à « ce que cette fonctionnalité exige ».
 *
 * Elle est ici, au point de composition, et pas dans un module, pour la même
 * raison que `dataOwnerOf` : elle doit répondre **quand le module de
 * facturation est coupé**. Le module dit quelles offres un périmètre détient ;
 * `@repo/core` dit ce que ces offres ouvrent ; ce fichier tient les deux
 * ensemble et connaît le seul cas qu'aucun des deux ne peut connaître — celui
 * où il n'y a pas de facturation du tout.
 *
 * | | module `billing` monté | module coupé |
 * |---|---|---|
 * | `featuresOf(session)` | ce que ses offres ouvrent | **toutes** les fonctionnalités déclarées |
 * | route réservée | 403 sans le droit | servie |
 * | invitation à souscrire | affichée sans le droit | **jamais** |
 *
 * **La règle vit dans une fabrique**, injectable, et ce n'est pas une élégance :
 * les deux constats majeurs de la seconde revue de s19 étaient des règles
 * enfermées dans ce dossier, qu'une mutation posée dans le module ne faisait pas
 * rougir. Ce qui est éprouvable est éprouvé (`tests/entitlements.test.ts`).
 */

/**
 * Ce que la règle a besoin de connaître de la facturation : **deux membres**,
 * exactement ceux que `lib/billing.ts` expose.
 *
 * Réduit à cela pour que la règle soit éprouvable sans monter l'application, et
 * pour qu'elle ne puisse rien apprendre d'autre — surtout pas l'état d'un
 * abonnement, que le gating ne doit jamais lire directement (sinon l'achat
 * unique de s20 devient inutilisable).
 */
export interface EntitlementBilling {
  readonly available: boolean
  readonly entitledOffers: (session: ModuleSession) => Promise<readonly string[]>
}

export interface AppEntitlements {
  /** Les fonctionnalités réservées que cette session a le droit d'utiliser. */
  readonly featuresOf: (session: ModuleSession) => Promise<ReadonlySet<string>>
  /** **La fonction unique**, appelée côté serveur : cet écran, cette action. */
  readonly allows: (session: ModuleSession, feature: string) => Promise<boolean>
}

export function createEntitlements(dependencies: {
  readonly billing: EntitlementBilling
  readonly gates: readonly FeatureGate[]
}): AppEntitlements {
  const featuresOf = async (session: ModuleSession): Promise<ReadonlySet<string>> => {
    if (!dependencies.billing.available) {
      // **Tout est accordé — c'est-à-dire tout ce qui est déclaré.** Pas « oui à
      // n'importe quelle question » : une route qui réserverait une
      // fonctionnalité inconnue doit être refusée dans les deux configurations,
      // sans quoi couper la facturation ouvrirait une porte que le démarrage
      // refuse par ailleurs.
      //
      // Et la facturation n'est **pas interrogée** : il n'y a ni client, ni
      // offre, ni connexion à ouvrir.
      return new Set(dependencies.gates.map((gate) => gate.id))
    }

    return entitledFeatureIds(dependencies.gates, await dependencies.billing.entitledOffers(session))
  }

  return {
    featuresOf,
    allows: async (session, feature) => (await featuresOf(session)).has(feature),
  }
}

/**
 * L'objet composé : la vraie facturation, les déclarations **validées**.
 *
 * `featureGates()` est appelée à l'import, comme `buildRegistry` l'est dans
 * `lib/module-registry.ts` : une déclaration fausse doit se voir au chargement,
 * pas à la première question posée sur un droit. C'est du code, pas de
 * l'environnement — rien ici ne lit une variable.
 */
export const entitlements: AppEntitlements = createEntitlements({
  billing,
  gates: featureGates(),
})
