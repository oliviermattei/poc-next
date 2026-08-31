import { visibleNavigation } from '@repo/core'

import { currentSession } from '../lib/auth'
import { moduleRegistry } from '../lib/module-registry'

/**
 * La navigation de l'application.
 *
 * Elle ne contient **aucune condition** : pas de `if (moduleActivé)`, pas de
 * liste de modules connue d'avance. Elle affiche ce que le registre lui donne,
 * et le registre n'agrège que les modules activés. C'est la différence entre
 * masquer une entrée et ne pas l'avoir.
 *
 * Le second filtre n'est pas de la même nature : `visibleNavigation` distingue
 * deux appelants d'un **même** module activé, selon la protection déclarée par
 * l'entrée (`docs/security.md` §3). Depuis s07, la session est réelle : une
 * entrée `authenticated` n'apparaît que pour un compte connecté, et la règle
 * qui en décide est celle qui refuse la route correspondante. Ce composant ne
 * la rejoue pas — il passe la session et affiche ce qu'on lui rend.
 */
const DEFAULT_LOCALE = 'fr'

export async function ModuleNavigation() {
  const messages = moduleRegistry.messages[DEFAULT_LOCALE] ?? {}
  const session = await currentSession()

  return (
    <nav aria-label="Modules">
      <ul>
        {visibleNavigation(moduleRegistry, session).map((entry) => (
          <li key={`${entry.moduleId}:${entry.id}`}>
            <a href={entry.href}>{messages[entry.labelKey] ?? entry.labelKey}</a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
