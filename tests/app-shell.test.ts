import { buildRegistry, singleLocaleRouting } from '@repo/core'
import { authModule } from '@repo/module-auth'
import { demoEnabledModule } from '@repo/module-demo-enabled'
import { i18nModule, localePrefixRouting } from '@repo/module-i18n'
import { describe, expect, it } from 'vitest'

import { flatMessagesFor } from '../apps/web/lib/messages'
import { localeOptions, shellNavigation } from '../apps/web/lib/navigation'

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
    available: [authModule, i18nModule, demoEnabledModule],
    enabled,
    required: ['auth'],
    locales: ['fr', 'en'],
  })

const aSession = { userId: 'user-1', roles: [] as readonly string[] }

/**
 * Le traducteur, tel que le shell le passe : le catalogue réel de la locale, et
 * **aucun repli** sur la clé — c'est la règle de la story, et un repli ici
 * rendrait vert un libellé que l'écran afficherait en « auth.navigation.account ».
 */
const intlFor = (
  locale: string,
  routing = singleLocaleRouting(locale),
  enabled: readonly string[] = ['auth', 'i18n'],
) => {
  const catalog = flatMessagesFor(locale, registryOf(enabled))

  return {
    locale,
    t: (key: string): string => {
      const value = catalog[key]

      if (value === undefined) {
        throw new Error(`Traduction manquante : « ${key} ».`)
      }

      return value
    },
    path: (pathname: string): string => routing.publicPath(pathname, locale),
  }
}

const prefixed = localePrefixRouting({ locales: ['fr', 'en'], defaultLocale: 'fr' })

describe('navigation du shell', () => {
  it('traduit les entrées que la session a le droit de voir', () => {
    const items = shellNavigation(registryOf(['auth']), aSession, intlFor('fr', undefined, ['auth']))

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
    const anonymous = shellNavigation(registryOf(['auth']), null, intlFor('fr', undefined, ['auth']))

    expect(anonymous.map((item) => item.href)).not.toContain('/account')
    expect(anonymous.map((item) => item.href)).toContain('/sign-in')
  })

  it('perd l’entrée d’un module désactivé, sans condition dans le composant', () => {
    const on = ['auth', 'demo-enabled']
    const enabled = shellNavigation(registryOf(on), aSession, intlFor('fr', undefined, on))
    const disabled = shellNavigation(registryOf(['auth']), aSession, intlFor('fr', undefined, ['auth']))

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

describe('navigation du shell et langue', () => {
  it('rend le libellé du catalogue de la locale demandée', () => {
    // Le même scénario, deux langues : c'est la traduction qui change, pas le
    // code de l'écran. La clé vient du **module**, ce qui prouve que le
    // catalogue agrégé par le registre est réellement consommé.
    const french = shellNavigation(registryOf(['auth']), aSession, intlFor('fr', undefined, ['auth']))
    const english = shellNavigation(registryOf(['auth']), aSession, intlFor('en', undefined, ['auth']))

    expect(french.find((item) => item.id === 'auth:account')?.label).toBe('Mon compte')
    expect(english.find((item) => item.id === 'auth:account')?.label).toBe('My account')
  })

  it('sert les mêmes entrées, préfixées ou non, sans variante dans le composant', () => {
    // Le critère qui décide de trente-six stories : le même appel, les deux
    // états de configuration, aucune branche dans l'appelant.
    const withoutPrefix = shellNavigation(
      registryOf(['auth']),
      aSession,
      intlFor('fr', undefined, ['auth']),
    )
    const withPrefix = shellNavigation(
      registryOf(['auth']),
      aSession,
      intlFor('fr', prefixed, ['auth']),
    )

    expect(withoutPrefix.map((item) => item.href)).toContain('/account')
    expect(withPrefix.map((item) => item.href)).toContain('/fr/account')
    expect(withPrefix.map((item) => item.id)).toEqual(withoutPrefix.map((item) => item.id))
    expect(withPrefix.map((item) => item.label)).toEqual(withoutPrefix.map((item) => item.label))
  })
})

describe('les langues proposées par le shell', () => {
  it('propose chaque langue servie, nommée par le catalogue du module i18n', () => {
    const options = localeOptions(prefixed, intlFor('fr'))

    expect(options).toEqual([
      { value: 'fr', label: 'Français', href: '/fr' },
      { value: 'en', label: 'English', href: '/en' },
    ])
  })

  it('n’en propose aucune — et n’en demande aucune clé — quand une seule est servie', () => {
    // Le défaut mesuré au navigateur : le shell construisait la liste avant de
    // décider de l'afficher, donc il demandait `i18n.locale.fr` alors que le
    // module `i18n` — propriétaire de cette clé — était coupé. Comme aucune
    // traduction ne se replie sur sa clé, l'écran répondait 500. Le `t` de ce
    // cas lève sur une clé absente, exactement comme celui de l'application :
    // c'est ce qui fait mordre l'assertion.
    expect(
      localeOptions(singleLocaleRouting('fr'), intlFor('fr', singleLocaleRouting('fr'), ['auth'])),
    ).toEqual([])
  })
})
