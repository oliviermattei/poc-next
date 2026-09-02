import { assertGatesCoverRoutes, parseFeatureGates, type FeatureGate } from '@repo/core'

import { enabledModules } from '../../../config/features'
import { featureGates as declared } from '../../../config/gating'
import { billingCatalogue } from './billing-catalogue'
import { moduleRegistry } from './module-registry'

/**
 * **Les fonctionnalités réservées, validées** — la règle qui décide, isolée de
 * ce qui la construit, comme `lib/billing-catalogue.ts` et
 * `lib/billing-permission.ts`.
 *
 * Elle est appelée à **deux** endroits, et il faut les deux :
 *
 * - `apps/web/next.config.ts`, au **démarrage** : une déclaration fausse arrête
 *   le processus avant qu'il ne serve une requête. C'est la leçon du constat F2
 *   de la revue de s19 — le catalogue d'offres n'était validé qu'à la première
 *   requête, et cette requête pouvait être le webhook public ;
 * - `apps/web/lib/entitlements.ts`, à chaque question posée sur un droit.
 *
 * Elle ne lit **aucune** variable d'environnement : ce sont deux fichiers de
 * configuration, c'est-à-dire du code. Rien ne justifie donc qu'un artefact se
 * construise sur une déclaration que le démarrage refusera, et la garde ne
 * dépend pas de la phase.
 */

/**
 * Le module de facturation est-il activé ? La **configuration** décide, pas un
 * `if` épars — même lecture que `next.config.ts`, et pour la même raison : la
 * question est « ce module est-il activé ? », pas « le registre est-il
 * cohérent ? ».
 */
const billingEnabled = (enabledModules as readonly string[]).includes('billing')

/**
 * Les offres contre lesquelles confronter les déclarations, ou `undefined`.
 *
 * `undefined` quand le module de facturation est coupé : un projet qui ne vend
 * rien n'a pas de catalogue, et il n'y a rien à confronter. La **forme** des
 * déclarations, elle, est vérifiée dans les deux configurations — c'est ce qui
 * fait que couper le module ne désarme pas la garde, seulement la moitié qui
 * n'a plus de sens.
 */
const knownOffers = (): readonly string[] | undefined =>
  billingEnabled ? billingCatalogue().map((offer) => offer.id) : undefined

let gates: readonly FeatureGate[] | null = null

/**
 * Les déclarations validées. Mémorisées : c'est du code, elles ne changent pas
 * d'un appel à l'autre, et l'écran ne doit pas repayer la validation à chaque vue.
 */
export function featureGates(): readonly FeatureGate[] {
  gates ??= parseFeatureGates([...declared], { offers: knownOffers() })

  return gates
}

/**
 * La garde de démarrage, **les deux moitiés**.
 *
 * La seconde — chaque route réservée nomme une fonctionnalité déclarée — a
 * besoin du registre, donc des modules **activés** : une route d'un module
 * coupé n'existe pas, et rien n'a à la couvrir.
 */
export function assertFeatureGates(): void {
  assertGatesCoverRoutes(moduleRegistry, featureGates())
}
