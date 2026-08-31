import { visibleNavigation, type ModuleRegistry, type ModuleSession } from '@repo/core'
import type { SidebarItem } from '@repo/ui'

/**
 * Les entrées de navigation du shell, dérivées du registre.
 *
 * **Aucune condition, et surtout aucun identifiant de module.** Le registre
 * n'agrège que les modules activés, `visibleNavigation` (s03) retire ensuite ce
 * que la session n'a pas le droit de voir — la même règle qui refusera la route
 * correspondante (`docs/security.md` §3). Cette fonction ne fait que traduire
 * les clés en libellés.
 *
 * Elle est ici, et pas dans le composant, pour qu'elle soit éprouvable sans
 * rendre quoi que ce soit : ce qui se prouve dans une fonction pure n'a pas
 * besoin d'un navigateur.
 */
export const DEFAULT_LOCALE = 'fr'

export function shellNavigation(
  registry: ModuleRegistry,
  session: ModuleSession | null,
): readonly SidebarItem[] {
  const messages = registry.messages[DEFAULT_LOCALE] ?? {}

  return visibleNavigation(registry, session).map((entry) => ({
    // Deux modules peuvent nommer leur entrée pareil : la clé de rendu porte
    // donc le module, comme la clé de traduction.
    id: `${entry.moduleId}:${entry.id}`,
    href: entry.href,
    // Repli sur la clé : une traduction manquante doit se voir, jamais faire
    // disparaître l'entrée. s09 remplacera cette lecture par `next-intl`.
    label: messages[entry.labelKey] ?? entry.labelKey,
  }))
}
