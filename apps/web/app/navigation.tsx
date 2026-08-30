import { visibleNavigation } from '@repo/core'

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
 * l'entrée (`docs/security.md` §3). Aucune session n'est résolue tant que
 * l'authentification n'existe pas (s07) : l'appel passe `null`, et seules les
 * entrées publiques s'affichent — comme le répartiteur refuse toute route non
 * publique. La règle vit dans `@repo/core`, ce composant ne la rejoue pas.
 */
const DEFAULT_LOCALE = 'fr'

export function ModuleNavigation() {
  const messages = moduleRegistry.messages[DEFAULT_LOCALE] ?? {}

  return (
    <nav aria-label="Modules">
      <ul>
        {visibleNavigation(moduleRegistry, null).map((entry) => (
          <li key={`${entry.moduleId}:${entry.id}`}>
            <a href={entry.href}>{messages[entry.labelKey] ?? entry.labelKey}</a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
