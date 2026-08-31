import { buildRegistry } from '@repo/core'
import { authModule } from '@repo/module-auth'
import { demoEnabledModule } from '@repo/module-demo-enabled'
import { describe, expect, it } from 'vitest'

import { shellNavigation } from '../apps/web/lib/navigation'

/**
 * La navigation du shell — le critère qui prouve l'angle du produit côté
 * interface.
 *
 * Ce qui se prouve ici : le shell **dérive** ses entrées du registre et de la
 * session, il ne les décide pas. Ce qui se prouve ailleurs, et n'est donc pas
 * rejoué : la règle de visibilité elle-même
 * (`packages/core/src/protection.test.ts`, qui énumère les acteurs) et le rendu
 * réel dans un navigateur, dans les deux états de `config/features.ts`
 * (`e2e/modules.spec.ts`). Un seul témoin de refus ici, pas une seconde
 * matrice.
 */

const registryOf = (enabled: readonly string[]) =>
  buildRegistry({
    available: [authModule, demoEnabledModule],
    enabled,
    required: ['auth'],
  })

const aSession = { userId: 'user-1', roles: [] as readonly string[] }

describe('navigation du shell', () => {
  it('traduit les entrées que la session a le droit de voir', () => {
    const items = shellNavigation(registryOf(['auth']), aSession)

    expect(items).toContainEqual({
      id: 'auth:account',
      href: '/account',
      label: 'Mon compte',
    })
  })

  it('n’affiche pas l’entrée qu’un visiteur anonyme n’a pas le droit de voir', () => {
    // Le témoin de refus : « Mon compte » est déclarée `authenticated`, et la
    // masquer n'est pas une permission — c'est la route qui refusera. Mais une
    // entrée visible vers un écran refusé divulgue son existence (§3).
    const anonymous = shellNavigation(registryOf(['auth']), null)

    expect(anonymous.map((item) => item.href)).not.toContain('/account')
    expect(anonymous.map((item) => item.href)).toContain('/sign-in')
  })

  it('perd l’entrée d’un module désactivé, sans condition dans le composant', () => {
    const enabled = shellNavigation(registryOf(['auth', 'demo-enabled']), aSession)
    const disabled = shellNavigation(registryOf(['auth']), aSession)

    const removed = enabled
      .map((item) => item.href)
      .filter((href) => !disabled.map((item) => item.href).includes(href))

    // Le module de démonstration déclare bien de la navigation visible : sans
    // cette garde, le cas serait vert sur deux listes identiques.
    expect(removed).not.toEqual([])

    // Et il n'en reste **rien** : pas une entrée masquée, pas une entrée
    // désactivée — rien du tout, ce qui est plus fort.
    for (const item of disabled) {
      expect(item.id.startsWith('demo-enabled:'), item.id).toBe(false)
    }
  })
})
