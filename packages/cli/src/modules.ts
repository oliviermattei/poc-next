/**
 * Ce que `ks list` a besoin de savoir de chaque module.
 *
 * La fonction **reçoit** l'annuaire, elle ne lit pas `config/features.ts` :
 * c'est `src/bin.ts` qui compose. Sans cela, aucun test ne pourrait éprouver un
 * graphe que le dépôt ne contient pas.
 *
 * `requiredBy` est dérivé de l'annuaire complet, pas des seuls modules activés :
 * un dépendant encore désactivé explique quand même pourquoi on voudrait garder
 * ce module, et l'afficher évite de découvrir la relation au moment du refus.
 */
export interface ModuleSummarySource {
  readonly id: string
  readonly requires: readonly string[]
}

export interface ModuleSummary {
  readonly id: string
  readonly enabled: boolean
  readonly requires: readonly string[]
  readonly requiredBy: readonly string[]
}

export function describeModules(configuration: {
  readonly available: readonly ModuleSummarySource[]
  readonly enabled: readonly string[]
}): readonly ModuleSummary[] {
  const enabled = new Set(configuration.enabled)

  return configuration.available.map((module) => ({
    id: module.id,
    enabled: enabled.has(module.id),
    requires: [...module.requires],
    requiredBy: configuration.available
      .filter((candidate) => candidate.requires.includes(module.id))
      .map((candidate) => candidate.id),
  }))
}

const ENABLED_MARK = '●'
const DISABLED_MARK = '○'

/**
 * La sortie lisible par un humain.
 *
 * Le mode `--json` sert les agents et les scripts ; celle-ci sert l'œil. Les
 * deux disent la même chose, et c'est `describeModules` qui la produit — deux
 * calculs divergeraient.
 */
export function renderModuleList(summaries: readonly ModuleSummary[]): string {
  if (summaries.length === 0) {
    return 'Aucun module dans l’annuaire de config/features.ts.'
  }

  const width = Math.max(...summaries.map((summary) => summary.id.length))

  return summaries
    .map((summary) => {
      const relations = [
        summary.requires.length > 0 ? `requiert : ${summary.requires.join(', ')}` : '',
        summary.requiredBy.length > 0 ? `requis par : ${summary.requiredBy.join(', ')}` : '',
      ].filter((part) => part !== '')

      return [
        summary.enabled ? ENABLED_MARK : DISABLED_MARK,
        summary.id.padEnd(width),
        (summary.enabled ? 'activé' : 'désactivé').padEnd(9),
        relations.join('  '),
      ]
        .join(' ')
        .trimEnd()
    })
    .join('\n')
}
