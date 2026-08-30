import { moduleRegistry } from '../lib/module-registry'

/**
 * La navigation de l'application.
 *
 * Elle ne contient **aucune condition** : pas de `if (moduleActivé)`, pas de
 * liste de modules connue d'avance. Elle affiche ce que le registre lui donne,
 * et le registre n'agrège que les modules activés. C'est la différence entre
 * masquer une entrée et ne pas l'avoir.
 */
const DEFAULT_LOCALE = 'fr'

export function ModuleNavigation() {
  const messages = moduleRegistry.messages[DEFAULT_LOCALE] ?? {}

  return (
    <nav aria-label="Modules">
      <ul>
        {moduleRegistry.navigation.map((entry) => (
          <li key={`${entry.moduleId}:${entry.id}`}>
            <a href={entry.href}>{messages[entry.labelKey] ?? entry.labelKey}</a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
