import {
  ModuleConfigurationError,
  resolveEnabledModules,
  type AnyModuleDefinition,
} from '@repo/core'

/**
 * Ce que `ks toggle <module>` décide, **avant** d'écrire quoi que ce soit.
 *
 * La règle du graphe n'est pas ici : `resolveEnabledModules` refuse déjà un
 * requis non activé, un cycle, une auto-référence et un identifiant inconnu, et
 * il **nomme** les modules en cause. Ce fichier lui soumet la configuration
 * candidate, attrape son refus et le traduit dans le vocabulaire de la
 * commande. Réécrire la validation ici créerait une seconde vérité, et c'est
 * elle qui déciderait — jusqu'au premier cas limite où les deux divergent.
 */
export class ToggleRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToggleRefusedError'
  }
}

export interface TogglePlan {
  readonly action: 'enable' | 'disable'
  readonly moduleId: string
  /** La liste `enabledModules` telle qu'elle sera écrite. */
  readonly nextEnabled: readonly string[]
  /** Requis activés au passage. Toujours vide en désactivation. */
  readonly alsoEnabled: readonly string[]
}

export interface ToggleInput {
  readonly available: readonly AnyModuleDefinition[]
  readonly enabled: readonly string[]
  readonly moduleId: string
  /** Autorise l'activation des requis manquants. Sans elle, le refus les nomme. */
  readonly withRequirements?: boolean
}

const quote = (value: string): string => `« ${value} »`

/**
 * Les requis d'un module qui ne sont pas encore activés, requis avant dépendant.
 *
 * Ce n'est **pas** la validation : c'est ce qu'il faut savoir pour *proposer*.
 * La décision d'accepter ou de refuser reste à `resolveEnabledModules`, appelé
 * juste après sur la liste que cette fonction a servi à construire. Le parcours
 * garde ses nœuds visités : un graphe cyclique le ferait tourner sans fin, et
 * c'est la validation, pas ce parcours, qui doit le refuser en le nommant.
 */
export function missingRequirements(input: {
  readonly available: readonly AnyModuleDefinition[]
  readonly enabled: readonly string[]
  readonly moduleId: string
}): readonly string[] {
  const byId = new Map(input.available.map((module) => [module.id, module]))
  const enabled = new Set(input.enabled)
  const missing: string[] = []
  const seen = new Set<string>()

  const visit = (id: string): void => {
    if (seen.has(id)) {
      return
    }

    seen.add(id)

    for (const required of byId.get(id)?.requires ?? []) {
      visit(required)

      if (!enabled.has(required) && !missing.includes(required) && required !== input.moduleId) {
        missing.push(required)
      }
    }
  }

  visit(input.moduleId)

  return missing
}

/** Soumet la configuration candidate à `@repo/core`, et rend son refus tel quel. */
const refusalOf = (
  available: readonly AnyModuleDefinition[],
  enabled: readonly string[],
): string | null => {
  try {
    resolveEnabledModules({ available, enabled })

    return null
  } catch (error) {
    if (error instanceof ModuleConfigurationError) {
      return error.message
    }

    throw error
  }
}

/**
 * Décide de l'inversion, sans rien écrire.
 *
 * Les deux sens ont la même mécanique : construire la liste candidate, la
 * soumettre à la validation, traduire son refus. Ce qui change est la phrase
 * d'entête et, à l'activation, la proposition d'activer aussi les requis.
 */
export function planToggle(input: ToggleInput): TogglePlan {
  const { available, enabled, moduleId } = input

  if (!available.some((module) => module.id === moduleId)) {
    throw new ToggleRefusedError(
      `Module inconnu ${quote(moduleId)} : l’annuaire de config/features.ts n’en déclare aucun de ce nom. « ks list » donne les identifiants connus.`,
    )
  }

  if (enabled.includes(moduleId)) {
    const nextEnabled = enabled.filter((id) => id !== moduleId)
    const refusal = refusalOf(available, nextEnabled)

    if (refusal !== null) {
      throw new ToggleRefusedError(
        `Désactivation de ${quote(moduleId)} refusée : un module activé en dépend.\n${refusal}`,
      )
    }

    return { action: 'disable', moduleId, nextEnabled, alsoEnabled: [] }
  }

  const missing = missingRequirements({ available, enabled, moduleId })
  const alsoEnabled = input.withRequirements === true ? missing : []
  const nextEnabled = [...enabled, ...alsoEnabled, moduleId]
  const refusal = refusalOf(available, nextEnabled)

  if (refusal !== null) {
    const hint =
      missing.length > 0 && input.withRequirements !== true
        ? `\nRelancez avec --with-requires pour activer aussi ${missing.map(quote).join(', ')}.`
        : ''

    throw new ToggleRefusedError(
      `Activation de ${quote(moduleId)} refusée.\n${refusal}${hint}`,
    )
  }

  return { action: 'enable', moduleId, nextEnabled, alsoEnabled }
}
