import type { AnyModuleDefinition } from './module'

/**
 * Validation de la configuration des modules.
 *
 * Le compilateur refuse déjà un identifiant inconnu dans `config/features.ts`.
 * Ce qu'il ne peut pas voir, c'est le **graphe** : un module activé sans son
 * requis, un cycle, une auto-référence. Ces trois-là se découvrent à la
 * construction du registre, c'est-à-dire au démarrage de l'application et dans
 * la suite de tests — jamais au premier appel d'une route.
 *
 * Et une quatrième, qui n'est pas un graphe mais une **décision de produit** :
 * le socle non désactivable (ADR 021). Elle est *reçue*, comme le reste de la
 * configuration : `@repo/core` ne connaît pas l'identifiant `auth`, c'est
 * `config/features.ts` qui déclare `requiredModules` et les trois points de
 * composition — l'application, la génération de schéma, le CLI — qui le
 * transmettent.
 *
 * Chaque refus nomme les modules en cause. Un message qui dit « configuration
 * invalide » sans dire lequel oblige à relire toute la liste, et c'est
 * exactement le moment où quelqu'un désactive la validation.
 */
export class ModuleConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModuleConfigurationError'
  }
}

const quote = (value: string): string => `« ${value} »`

const fail = (message: string): never => {
  throw new ModuleConfigurationError(message)
}

/** Annuaire indexé, et refus d'un identifiant déclaré deux fois. */
function indexAvailableModules(
  available: readonly AnyModuleDefinition[],
): ReadonlyMap<string, AnyModuleDefinition> {
  const byId = new Map<string, AnyModuleDefinition>()

  for (const module of available) {
    if (byId.has(module.id)) {
      fail(
        `Identifiant de module en double : ${quote(module.id)} est déclaré deux fois dans l’annuaire.`,
      )
    }

    byId.set(module.id, module)
  }

  return byId
}

/**
 * Résout les modules activés dans un ordre dérivé du **graphe** : un module
 * apparaît après ceux qu'il requiert, quel que soit l'ordre dans lequel
 * `config/features.ts` les liste. C'est ce qui rend l'ordre de composition
 * indépendant de la mise en forme d'un fichier de configuration.
 */
export function resolveEnabledModules(configuration: {
  readonly available: readonly AnyModuleDefinition[]
  readonly enabled: readonly string[]
  /**
   * Le **socle non désactivable** (ADR 021) : les modules dont le retrait n'est
   * pas une configuration valide.
   *
   * Facultatif, et vide par défaut, pour que les tests puissent construire un
   * registre de deux modules d'essai sans hériter du socle du dépôt. Ce qui
   * rend la règle exécutable est que les trois points de composition le
   * passent — et le CLI avec eux, donc `ks toggle auth` est refusé avant
   * d'écrire quoi que ce soit.
   */
  readonly required?: readonly string[]
}): readonly AnyModuleDefinition[] {
  const byId = indexAvailableModules(configuration.available)
  const enabled = new Set(configuration.enabled)

  for (const id of enabled) {
    if (!byId.has(id)) {
      fail(
        `Module inconnu ${quote(id)} : aucun module de ce nom n’est déclaré dans l’annuaire de config/features.ts.`,
      )
    }
  }

  for (const id of configuration.required ?? []) {
    // Un socle que l'annuaire ne connaît pas est refusé lui aussi : sans ce
    // cas, une faute de frappe dans `requiredModules` désarmerait la règle en
    // silence — le module nommé n'existant pas, il ne manquerait jamais.
    if (!byId.has(id)) {
      fail(
        `Socle inconnu ${quote(id)} : « requiredModules » de config/features.ts nomme un module que l’annuaire ne déclare pas.`,
      )
    }

    if (!enabled.has(id)) {
      fail(
        `Le module ${quote(id)} fait partie du socle et ne peut pas être désactivé : « requiredModules » de config/features.ts le déclare non désactivable.`,
      )
    }
  }

  const ordered: AnyModuleDefinition[] = []
  const resolved = new Set<string>()
  const visiting = new Set<string>()

  const visit = (id: string, path: readonly string[]): void => {
    if (resolved.has(id)) {
      return
    }

    if (visiting.has(id)) {
      fail(`Cycle de modules requis : ${[...path, id].join(' → ')}.`)
    }

    // `byId` contient forcément l'identifiant : les entrées sont vérifiées
    // au-dessus, et les requis juste avant l'appel récursif.
    const module = byId.get(id) as AnyModuleDefinition

    visiting.add(id)

    for (const required of module.requires) {
      if (required === id) {
        fail(`Le module ${quote(id)} se requiert lui-même.`)
      }

      if (!byId.has(required)) {
        fail(
          `Le module ${quote(id)} requiert ${quote(required)}, qui n’existe pas dans l’annuaire de config/features.ts.`,
        )
      }

      if (!enabled.has(required)) {
        fail(
          `Le module ${quote(id)} requiert ${quote(required)}, qui n’est pas activé dans config/features.ts.`,
        )
      }

      visit(required, [...path, id])
    }

    visiting.delete(id)
    resolved.add(id)
    ordered.push(module)
  }

  for (const id of configuration.enabled) {
    visit(id, [])
  }

  return ordered
}

/**
 * Ce que le typage ne peut pas garantir sur des modules déjà construits.
 *
 * Le contrat interdit déjà à la compilation un template d'email incomplet ; ces
 * vérifications tiennent pour un module dont les locales ne sont pas connues
 * statiquement, et couvrent deux règles qui n'existent qu'entre modules : deux
 * routes identiques, et une clé de navigation sans traduction.
 */
export function assertDeclarationsAreComplete(
  modules: readonly AnyModuleDefinition[],
): void {
  const routeOwners = new Map<string, string>()

  for (const module of modules) {
    const locales = Object.keys(module.messages)

    for (const template of module.emails) {
      for (const locale of locales) {
        if (!(locale in template.locales)) {
          fail(
            `Le module ${quote(module.id)} déclare le template d’email ${quote(template.id)} sans version dans la locale ${quote(locale)}.`,
          )
        }
      }
    }

    for (const entry of module.navigation) {
      for (const locale of locales) {
        if (module.messages[locale]?.[entry.labelKey] === undefined) {
          fail(
            `Le module ${quote(module.id)} déclare l’entrée de navigation ${quote(entry.id)} dont la clé ${quote(entry.labelKey)} est absente des traductions ${quote(locale)}.`,
          )
        }
      }
    }

    for (const route of module.routes) {
      const signature = `${route.method} ${route.path}`
      const owner = routeOwners.get(signature)

      if (owner !== undefined) {
        fail(
          `Collision de route : ${signature} est déclarée par ${quote(owner)} et par ${quote(module.id)}.`,
        )
      }

      routeOwners.set(signature, module.id)
    }
  }
}
