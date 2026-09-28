import {
  buildRegistry,
  navigationSurfaceOf,
  singleLocaleRouting,
  visibleNavigation,
} from '@repo/core'
import {
  authModule,
  PROFILE_SCREEN_PATH,
  SECURITY_SCREEN_PATH,
} from '@repo/module-auth'
import { BILLING_SCREEN_PATH } from '@repo/module-billing'
import { CONSENT_SETTINGS_SCREEN_PATH } from '@repo/module-consent'
import { demoEnabledModule } from '@repo/module-demo-enabled'
import { i18nModule, localePrefixRouting } from '@repo/module-i18n'
import { MEMBERS_SCREEN_PATH, ORGANIZATIONS_SCREEN_PATH } from '@repo/module-organizations'
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
 * rendrait vert un libellé que l'écran afficherait en « auth.navigation.profile ».
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
    // L'entrée du compte vit dans la surface `settings` depuis s62a : c'est
    // la sous-navigation des réglages qui la rend, par la même dérivation.
    const items = shellNavigation(
      registryOf(['auth']),
      aSession,
      intlFor('fr', undefined, ['auth']),
      'settings',
    )

    expect(items).toContainEqual({
      id: 'auth:profile',
      href: PROFILE_SCREEN_PATH,
      label: 'Profil',
    })
  })

  it('n’affiche pas l’entrée qu’un visiteur anonyme n’a pas le droit de voir', () => {
    // Le témoin de refus : « Profil » est déclarée `authenticated`, et la
    // masquer n'est pas une permission — c'est la route qui refusera. Mais une
    // entrée visible vers un écran refusé divulgue son existence (§3).
    const anonymous = shellNavigation(
      registryOf(['auth']),
      null,
      intlFor('fr', undefined, ['auth']),
      'settings',
    )

    expect(anonymous.map((item) => item.href)).not.toContain(PROFILE_SCREEN_PATH)
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

/**
 * **Le site a sa surface, l'application la sienne** (s61, ADR 073).
 *
 * Les quatre entrées du site sont déclarées `surface: 'site'` par leurs
 * modules ; oublier la déclaration sur l'une d'elles la ferait retomber dans la
 * barre latérale (défaut `app`), sans erreur à l'écran. L'entrée de connexion
 * n'existe plus : le bouton du gabarit la remplace.
 *
 * Le premier cas lit **l'annuaire** (`availableModules`), pas le registre : il
 * tient la déclaration quelle que soit la configuration jouée — le profil
 * minimal et la branche `socle` coupent trois de ces quatre modules. Le second
 * lit le registre en vigueur, et vaut dans toute configuration.
 */
describe('les surfaces du site et de l’application', () => {
  const siteIds = ['marketing:home', 'blog:index', 'docs:index', 'billing:pricing']

  it('déclare exactement l’accueil, le blog, les docs et les tarifs dans la surface `site`', async () => {
    const { availableModules } = await import('../config/features')
    const declared = availableModules.flatMap((module) =>
      module.navigation
        .filter((entry) => navigationSurfaceOf(entry) === 'site')
        .map((entry) => `${module.id}:${entry.id}`),
    )

    expect([...declared].sort()).toEqual([...siteIds].sort())
  })

  it('rend dans la surface `site` les entrées du site des seuls modules activés', async () => {
    const { moduleRegistry } = await import('../apps/web/lib/module-registry')
    const { enabledModules } = await import('../config/features')
    const expected = siteIds.filter((id) =>
      (enabledModules as readonly string[]).includes(id.split(':')[0] ?? ''),
    )

    for (const viewer of [null, aSession]) {
      expect(
        visibleNavigation(moduleRegistry, viewer, 'site')
          .map((entry) => `${entry.moduleId}:${entry.id}`)
          .sort(),
      ).toEqual([...expected].sort())
    }
  })

  it('ne laisse aucun lien du site, ni la connexion, dans la barre latérale', async () => {
    const { moduleRegistry } = await import('../apps/web/lib/module-registry')

    for (const viewer of [null, aSession]) {
      const app = visibleNavigation(moduleRegistry, viewer).map((entry) => `${entry.moduleId}:${entry.id}`)

      // L'anti-vacuité : la barre latérale d'un connecté porte bien des entrées.
      if (viewer !== null) expect(app).not.toEqual([])
      expect(app.filter((id) => siteIds.includes(id) || id === 'auth:sign-in')).toEqual([])
    }
  })
})

/**
 * **La zone Réglages a sa surface** (s62a, ADR 075).
 *
 * Compte, organisation et facturation quittent la barre latérale du produit
 * pour la sous-navigation de `/app/settings`, rangés depuis s62b en six
 * rubriques : Profil, Sécurité, Organisation, Membres, Facturation, Cookies. Les attentes sont des **chemins**
 * — les constantes des modules —, jamais des identifiants de module : une
 * entrée oubliée en surface `app` retomberait dans la barre latérale sans
 * erreur à l'écran, et c'est ce que ces cas voient.
 *
 * Le premier lit **l'annuaire** (`availableModules`) : il tient la déclaration
 * et son ordre quelle que soit la configuration jouée. Le deuxième coupe tour à
 * tour chaque module qui déclare une rubrique. Le dernier lit le registre en
 * vigueur, et vaut dans toute configuration — `socle` et le profil minimal
 * coupent deux de ces trois modules.
 */
describe('la surface des réglages', () => {
  // L'ordre du design de s62b : Profil, Sécurité, Organisation, Membres,
  // Facturation, Cookies. Des **chemins** — les constantes des modules —,
  // jamais des identifiants de module.
  const SETTINGS_SCREENS = [
    PROFILE_SCREEN_PATH,
    SECURITY_SCREEN_PATH,
    ORGANIZATIONS_SCREEN_PATH,
    MEMBERS_SCREEN_PATH,
    BILLING_SCREEN_PATH,
    CONSENT_SETTINGS_SCREEN_PATH,
  ]

  /** Un module et ce qu'il requiert, transitivement, plus le socle. */
  const closureOf = (
    modules: readonly { readonly id: string; readonly requires: readonly string[] }[],
    root: string,
    required: readonly string[],
  ): readonly string[] => {
    const found = new Set<string>()
    const visit = (id: string): void => {
      if (found.has(id)) return
      found.add(id)
      for (const dependency of modules.find((module) => module.id === id)?.requires ?? []) {
        visit(dependency)
      }
    }

    for (const id of [root, ...required]) visit(id)

    return [...found]
  }

  it('déclare les six rubriques dans la surface `settings`, dans l’ordre du design', async () => {
    const { availableModules, requiredModules } = await import('../config/features')
    const everything = buildRegistry({
      available: [...availableModules],
      // Tout l'annuaire activé : c'est la déclaration qui est jugée, pas la
      // configuration jouée.
      enabled: availableModules.map((module) => module.id),
      required: [...requiredModules],
      locales: ['fr', 'en'],
    })
    const declared = everything.navigation
      .filter((entry) => navigationSurfaceOf(entry) === 'settings')
      .map((entry) => entry.href)

    expect(declared).toEqual(SETTINGS_SCREENS)

    for (const href of declared) {
      expect(href.startsWith('/app/settings/'), href).toBe(true)
    }
  })

  it('perd chaque rubrique avec le module qui la déclare, sans condition ailleurs', async () => {
    const { availableModules, requiredModules } = await import('../config/features')
    const settingsOf = (enabled: readonly string[]) =>
      buildRegistry({
        available: [...availableModules],
        enabled,
        required: [...requiredModules],
        locales: ['fr', 'en'],
      })
        .navigation.filter((entry) => navigationSurfaceOf(entry) === 'settings')
        .map((entry) => entry.href)
    const owners = availableModules.filter((module) =>
      module.navigation.some((entry) => navigationSurfaceOf(entry) === 'settings'),
    )
    let cut = 0

    for (const owner of owners) {
      const own = owner.navigation
        .filter((entry) => navigationSurfaceOf(entry) === 'settings')
        .map((entry) => entry.href)
      const on = closureOf(availableModules, owner.id, requiredModules)

      expect(settingsOf(on), owner.id).toEqual(expect.arrayContaining(own))

      // Le socle ne se coupe pas : ses rubriques restent, par construction.
      if ((requiredModules as readonly string[]).includes(owner.id)) continue

      const off = settingsOf(on.filter((id) => id !== owner.id))

      expect(off.filter((href) => own.includes(href)), owner.id).toEqual([])
      cut += 1
    }

    // L'anti-vacuité : des rubriques appartiennent bien à des modules qu'on
    // peut couper — sans quoi la boucle serait verte sans rien couper.
    expect(cut).toBeGreaterThan(0)
  })

  it('rend les réglages des modules activés, et aucun dans la barre latérale', async () => {
    const { moduleRegistry } = await import('../apps/web/lib/module-registry')
    const declared = moduleRegistry.navigation
      .filter((entry) => navigationSurfaceOf(entry) === 'settings')
      .map((entry) => entry.href)
    const settings = visibleNavigation(moduleRegistry, aSession, 'settings').map(
      (entry) => entry.href,
    )
    const sidebar = visibleNavigation(moduleRegistry, aSession).map((entry) => entry.href)

    // L'anti-vacuité : le profil appartient au socle, il est toujours là.
    expect(settings).toContain(PROFILE_SCREEN_PATH)
    // Dans l'ordre du design, quelle que soit la configuration jouée.
    expect(settings).toEqual(SETTINGS_SCREENS.filter((href) => declared.includes(href)))
    expect(sidebar.filter((href) => SETTINGS_SCREENS.includes(href))).toEqual([])
    // Un visiteur anonyme n'a aucun réglage.
    expect(visibleNavigation(moduleRegistry, null, 'settings')).toEqual([])
  })
})

describe('navigation du shell et langue', () => {
  it('rend le libellé du catalogue de la locale demandée', () => {
    // Le même scénario, deux langues : c'est la traduction qui change, pas le
    // code de l'écran. La clé vient du **module**, ce qui prouve que le
    // catalogue agrégé par le registre est réellement consommé.
    const french = shellNavigation(
      registryOf(['auth']),
      aSession,
      intlFor('fr', undefined, ['auth']),
      'settings',
    )
    const english = shellNavigation(
      registryOf(['auth']),
      aSession,
      intlFor('en', undefined, ['auth']),
      'settings',
    )

    expect(french.find((item) => item.id === 'auth:profile')?.label).toBe('Profil')
    expect(english.find((item) => item.id === 'auth:profile')?.label).toBe('Profile')
  })

  it('sert les mêmes entrées, préfixées ou non, sans variante dans le composant', () => {
    // Le critère qui décide de trente-six stories : le même appel, les deux
    // états de configuration, aucune branche dans l'appelant.
    const withoutPrefix = shellNavigation(
      registryOf(['auth']),
      aSession,
      intlFor('fr', undefined, ['auth']),
      'settings',
    )
    const withPrefix = shellNavigation(
      registryOf(['auth']),
      aSession,
      intlFor('fr', prefixed, ['auth']),
      'settings',
    )

    expect(withoutPrefix.map((item) => item.href)).toContain(PROFILE_SCREEN_PATH)
    expect(withPrefix.map((item) => item.href)).toContain(`/fr${PROFILE_SCREEN_PATH}`)
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
