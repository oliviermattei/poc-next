import type { RouteProtection } from './module'
import type { ModuleRegistry } from './registry'

/**
 * **Le gating par offre** (ADR 043) : quelles fonctionnalités une offre détenue
 * ouvre, et comment une route déclare qu'elle en réserve une.
 *
 * Ce fichier est dans `@repo/core` et **pas** dans le module de facturation, et
 * ce n'est pas un rangement : `packages/modules/billing/AGENTS.md` dit que ce
 * module « ne possède ni la page de tarifs publique (s22), ni le gating par
 * offre (s21) », et surtout la règle doit répondre **quand ce module est
 * coupé** — le critère 6 de la story exige qu'elle accorde alors tout. C'est
 * exactement la raison qui a mis `resolveDataOwner` ici (ADR 025).
 *
 * `@repo/core` ne connaît donc ni offre, ni abonnement, ni achat : il reçoit des
 * **chaînes** — les offres qu'un périmètre détient — et il en dérive les
 * fonctionnalités ouvertes. C'est le point de composition de l'application qui
 * sait d'où ces chaînes viennent, et le module `billing` qui sait les calculer
 * quand il est là.
 *
 * Il n'y a pas de `zod` ici : ce package n'en dépend pas, et la validation
 * suit la forme de `validate.ts` — un refus par faute, nommant la déclaration.
 */

/**
 * Une fonctionnalité réservée, telle que le propriétaire la déclare.
 *
 * `offers` est une **disjonction** : détenir l'une d'elles suffit. C'est ce qui
 * permet d'écrire « le rapport détaillé est ouvert par l'offre mensuelle,
 * l'annuelle ou la licence à vie » sans inventer une notion de niveau que rien
 * n'ordonnerait — et un ordre entre offres serait faux dès qu'une offre unique
 * et un abonnement coexistent, ce qui est précisément le cas de ce dépôt.
 */
export interface FeatureGate {
  /** Identifiant stable, en `kebab-case`. C'est lui qu'une route nomme. */
  readonly id: string
  /** Les offres qui l'ouvrent. Au moins une : zéro fermerait la porte à vie. */
  readonly offers: readonly string[]
}

/** Refus d'une déclaration. Son message nomme la fonctionnalité **et** le champ. */
export class FeatureGateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeatureGateError'
  }
}

/** `kebab-case` strict, comme un identifiant d'offre : il voyage dans du code et des messages. */
const FEATURE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Refus d'une déclaration : la fonction **ne rend jamais la main**.
 *
 * Le type est porté par la constante et pas seulement par la lambda, et c'est
 * ce qui le rend utile au compilateur : TypeScript ne considère un appel comme
 * terminal que si la cible est annotée à sa déclaration. Sans cette annotation,
 * il fallait un `continue` derrière chaque refus — trois lignes inatteignables
 * qui suggéraient une accumulation d'erreurs qui n'existe pas (constat m7 de la
 * revue).
 */
const fail: (message: string) => never = (message) => {
  throw new FeatureGateError(message)
}

/** Le nom sous lequel une déclaration fautive est désignée. */
const nameOf = (value: unknown, index: number): string => {
  const id = (value as { id?: unknown } | null)?.id

  return typeof id === 'string' && id !== '' ? id : `#${String(index)}`
}

/**
 * Valide les déclarations, ou lève en nommant la fonctionnalité et le champ.
 *
 * Elle **lève** au lieu de rendre un résultat discriminé, comme
 * `parseBillingCatalogue` : ce n'est pas une panne de tiers à dégrader, c'est
 * une configuration fausse. `apps/web/next.config.ts` l'appelle au démarrage, et
 * le processus s'arrête avant de servir une requête (`docs/security.md` §5).
 *
 * `options.offers` — le catalogue d'offres connu — n'est fourni que lorsqu'il y
 * en a un : un dépôt dont le module de facturation est coupé ne vend rien, et il
 * n'y a alors aucune offre contre laquelle confronter la déclaration. La forme
 * de la déclaration, elle, est vérifiée dans les deux cas.
 */
export function parseFeatureGates(
  value: unknown,
  options: { readonly offers?: readonly string[] } = {},
): readonly FeatureGate[] {
  if (!Array.isArray(value)) {
    return fail(
      'config/gating.ts : `featureGates` doit être une liste de fonctionnalités réservées (id, offers).',
    )
  }

  const gates: FeatureGate[] = []
  const seen = new Set<string>()

  for (const [index, entry] of value.entries()) {
    const name = nameOf(entry, index)
    const candidate = entry as { id?: unknown; offers?: unknown } | null

    if (typeof candidate?.id !== 'string' || !FEATURE_ID.test(candidate.id)) {
      fail(
        `config/gating.ts : la fonctionnalité « ${name} » a un identifiant invalide — ` +
          'il doit être en kebab-case (premium-report).',
      )
    }

    if (seen.has(candidate.id)) {
      fail(
        `config/gating.ts : la fonctionnalité « ${candidate.id} » est déclarée deux fois. ` +
          'Un identifiant désigne une fonctionnalité et une seule — c’est lui qu’une route nomme.',
      )
    }

    const offers = candidate.offers

    if (!Array.isArray(offers) || offers.length === 0) {
      fail(
        `config/gating.ts : la fonctionnalité « ${candidate.id} » doit déclarer au moins une offre ` +
          'dans `offers` — une liste vide la fermerait à tout le monde, pour toujours.',
      )
    }

    for (const offer of offers) {
      if (typeof offer !== 'string' || offer === '') {
        fail(
          `config/gating.ts : la fonctionnalité « ${candidate.id} » déclare dans \`offers\` ` +
            'une valeur qui n’est pas un identifiant d’offre.',
        )
      }

      // Une offre inconnue rendrait la fonctionnalité inaccessible en silence à
      // qui a pourtant payé : c'est une faute de configuration, pas une porte
      // que personne n'ouvre.
      if (options.offers !== undefined && !options.offers.includes(offer as string)) {
        fail(
          `config/gating.ts : la fonctionnalité « ${candidate.id} » nomme l’offre ` +
            `« ${String(offer)} », qui n’est pas au catalogue de config/billing.ts.`,
        )
      }
    }

    seen.add(candidate.id)
    gates.push({ id: candidate.id, offers: offers as readonly string[] })
  }

  return gates
}

/**
 * La fonctionnalité qu'une protection réserve, ou `null`.
 *
 * Une **fonction** plutôt qu'une comparaison écrite chez chaque appelant : le
 * répartiteur et la validation de démarrage posent la même question, et deux
 * formulations feraient deux vérités.
 */
export const entitlementFeatureOf = (protection: RouteProtection): string | null =>
  protection.level === 'entitlement' ? protection.feature : null

/** Détenir l'une des offres déclarées suffit. */
export const allowsFeature = (gate: FeatureGate, entitledOffers: Iterable<string>): boolean => {
  const held = entitledOffers instanceof Set ? entitledOffers : new Set(entitledOffers)

  return gate.offers.some((offer) => held.has(offer))
}

/** Les fonctionnalités que ces offres ouvrent. C'est ce que le répartiteur reçoit. */
export function entitledFeatureIds(
  gates: readonly FeatureGate[],
  entitledOffers: Iterable<string>,
): ReadonlySet<string> {
  const held = new Set(entitledOffers)

  return new Set(gates.filter((gate) => allowsFeature(gate, held)).map((gate) => gate.id))
}

/**
 * **Une fonctionnalité réservée que rien ne déclare n'est ouverte par
 * personne.**
 *
 * C'est le pendant, inversé, de la leçon de s17 : là-bas, une action absente de
 * la matrice n'était refusée par personne ; ici, une fonctionnalité absente des
 * déclarations serait refusée à **tout le monde**, définitivement, y compris à
 * qui a payé — et aucune commande ne le dirait. Le démarrage la nomme.
 *
 * Elle balaie les routes **et** les entrées de navigation du registre, parce que
 * le contrat déclare une protection sur les deux.
 */
export function assertGatesCoverRoutes(
  registry: ModuleRegistry,
  gates: readonly FeatureGate[],
): void {
  const declared = new Set(gates.map((gate) => gate.id))

  const surfaces: readonly { readonly what: string; readonly feature: string | null }[] = [
    ...registry.routes.map((route) => ({
      what: `la route ${route.method} ${route.path} du module « ${route.moduleId} »`,
      feature: entitlementFeatureOf(route.protection),
    })),
    ...registry.navigation.map((entry) => ({
      what: `l’entrée de navigation « ${entry.id} » du module « ${entry.moduleId} »`,
      feature: entitlementFeatureOf(entry.protection),
    })),
  ]

  for (const surface of surfaces) {
    if (surface.feature !== null && !declared.has(surface.feature)) {
      fail(
        `${surface.what} réserve la fonctionnalité « ${surface.feature} », que config/gating.ts ` +
          'ne déclare pas : personne ne pourrait y accéder.',
      )
    }
  }
}
