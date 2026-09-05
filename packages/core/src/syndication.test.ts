import { describe, expect, it } from 'vitest'

import { defineModule, type AnyModuleDefinition } from './module'
import { buildRegistry } from './registry'
import {
  carriesLocalePrefix,
  indexableUrls,
  robotsAllows,
  robotsPolicy,
  sitemapEntries,
} from './syndication'

/**
 * Ce que le socle donne à indexer — **la règle, à l'endroit où elle vit**.
 *
 * Ces fonctions étaient dans le `domain` du module `marketing` (s10) : elles y
 * sont montées d'un cran en s53, parce que `app/robots.ts` et `app/sitemap.ts`
 * ne doivent plus connaître **aucun** module par son nom. Ce qu'elles font n'a
 * jamais rien eu de marketing : des chemins entrent, un plan de site et une
 * politique de robots sortent.
 *
 * Le câblage — deux fichiers de l'application, deux configurations de modules —
 * est le sujet de `tests/marketing.test.ts` et `tests/blog.test.ts`.
 */

const moduleFixture = (
  id: string,
  overrides: Partial<AnyModuleDefinition> = {},
): AnyModuleDefinition => ({
  ...defineModule({
    id,
    requires: [],
    schema: {},
    migrations: null,
    routes: [],
    navigation: [],
    publicUrls: () => [],
    messages: { fr: { nav: 'Nav' }, en: { nav: 'Nav' } },
    emails: [],
    webhooks: [],
    jobs: [],
    dataCategories: [],
    retention: {},
    purge: () => Promise.resolve(),
    export: () => Promise.resolve({}),
  }),
  ...overrides,
})

const CONTEXT = { locales: ['fr', 'en'], defaultLocale: 'fr' } as const

describe('ce que le registre donne à indexer', () => {
  /** Un module de contenu : une entrée de navigation, et des URL déclarées. */
  const content = moduleFixture('contenu', {
    navigation: [
      { id: 'index', href: '/contenu', labelKey: 'nav', order: 1, protection: { level: 'public' } },
    ],
    publicUrls: () => [
      { path: '/contenu', locales: ['fr', 'en'] },
      { path: '/contenu/un', locales: ['fr', 'en'], lastModified: '2026-03-01' },
      // Traduit dans une seule langue : l'autre n'existe pas, et l'annoncer
      // reviendrait à publier une URL qui répond 404.
      { path: '/contenu/deux', locales: ['en'] },
    ],
  })

  /**
   * Un module applicatif : **une entrée de navigation publique**, et aucune
   * contribution. C'est le cas de `auth` (`/sign-in`) et de `billing`
   * (`/pricing`) dans la configuration livrée.
   */
  const application = moduleFixture('appli', {
    navigation: [
      {
        id: 'connexion',
        href: '/sign-in',
        labelKey: 'nav',
        order: 2,
        protection: { level: 'public' },
      },
    ],
  })

  const registryWith = (enabled: readonly string[]) =>
    buildRegistry({
      available: [content, application],
      enabled,
      locales: ['fr', 'en'],
    })

  it('retient ce qu’un module activé déclare, et rien d’autre', () => {
    const urls = indexableUrls(registryWith(['contenu', 'appli']), CONTEXT)

    expect(urls.map((url) => url.path)).toEqual(['/contenu', '/contenu/un', '/contenu/deux'])
    // La page servie dans chaque langue les porte toutes ; l'article traduit
    // dans une seule ne porte que celle-là.
    expect(urls[0]?.locales).toEqual(['fr', 'en'])
    expect(urls[2]?.locales).toEqual(['en'])
    expect(urls[1]?.lastModified).toBe('2026-03-01')
  })

  it('n’indexe **pas** un écran au seul motif que sa navigation est publique', () => {
    // La décision de s53, et elle a été mesurée avant d'être prise : dériver
    // l'index des entrées de navigation publiques aurait publié `/sign-in`,
    // `/pricing` et `/api/modules/demo-enabled/items` — trois des cinq entrées
    // publiques de la configuration livrée. `public` est un niveau de
    // protection, pas une décision d'indexation (`docs/security.md` §7).
    const urls = indexableUrls(registryWith(['contenu', 'appli']), CONTEXT)

    expect(urls).not.toContainEqual(expect.objectContaining({ path: '/sign-in' }))
    // Garde d'inertie : le module **déclare** bien cette entrée, publique.
    expect(application.navigation[0]?.protection).toEqual({ level: 'public' })
  })

  it('ne rend rien d’un module coupé — ni entrée, ni URL', () => {
    expect(indexableUrls(registryWith(['appli']), CONTEXT)).toEqual([])
  })

  it('fusionne deux déclarations du même chemin plutôt que de le publier deux fois', () => {
    // Deux entrées pour la même page, ce sont deux URL pour un moteur.
    const twice = moduleFixture('deux-fois', {
      publicUrls: () => [
        { path: '/', locales: ['fr'] },
        { path: '/', locales: ['en'] },
      ],
    })

    const urls = indexableUrls(
      buildRegistry({ available: [twice], enabled: ['deux-fois'], locales: ['fr', 'en'] }),
      CONTEXT,
    )

    expect(urls.map((url) => url.path)).toEqual(['/'])
    expect(urls[0]?.locales).toEqual(['fr', 'en'])
  })

  it('passe au module les langues **servies**, jamais les siennes', () => {
    // Module `i18n` coupé, l'application n'en sert qu'une : un module qui
    // contribue dans toutes les autres publierait des URL qui redirigent.
    const seen: string[][] = []
    const observer = moduleFixture('observateur', {
      publicUrls: ({ locales }) => {
        seen.push([...locales])

        return []
      },
    })

    indexableUrls(
      buildRegistry({ available: [observer], enabled: ['observateur'], locales: ['fr', 'en'] }),
      { locales: ['fr'], defaultLocale: 'fr' },
    )

    expect(seen).toEqual([['fr']])
  })
})

describe('les chemins qui portent un préfixe de langue', () => {
  /**
   * Le piège relevé en revue de s29 (constat M3) et mesuré par la recherche de
   * s53 : `publicPath` préfixe **sans condition**, `/api…` compris, alors que
   * `apps/web/proxy.ts` ne préfixe jamais ces chemins. Tant qu'aucun module ne
   * déclarait d'entrée vers une route d'API, personne ne pouvait le voir ; la
   * dérivation élargie en fait une possibilité. La règle est donc **écrite une
   * fois**, et les deux appelants la partagent.
   */
  it('exclut ce que l’application ne sert pas sous une langue', () => {
    for (const pathname of [
      '/api/modules/blog/feed.xml',
      '/api/health',
      '/_next/static/x.js',
      '/favicon.ico',
      '/robots.txt',
      '/sitemap.xml',
      '/v1.2/page',
    ]) {
      expect(carriesLocalePrefix(pathname), pathname).toBe(false)
    }
  })

  it('retient les écrans', () => {
    for (const pathname of ['/', '/blog', '/blog/mon-article', '/legal/privacy', '/account']) {
      expect(carriesLocalePrefix(pathname), pathname).toBe(true)
    }
  })
})

describe('le plan de site', () => {
  /** Une fabrique d'URL absolue, comme le point de composition en fournit une. */
  const url = (pathname: string, locale: string) =>
    `https://app.test${locale === 'fr' ? '' : `/${locale}`}${pathname === '/' ? '' : pathname}`

  it('rend une entrée par chemin public, avec ses variantes de langue', () => {
    const entries = sitemapEntries({
      entries: [
        { path: '/', locales: ['fr', 'en'] },
        { path: '/legal/privacy', locales: ['fr', 'en'] },
      ],
      defaultLocale: 'fr',
      url,
    })

    expect(entries.map((entry) => entry.url)).toEqual([
      'https://app.test',
      'https://app.test/legal/privacy',
    ])
    expect(entries[1]?.alternates).toEqual({
      fr: 'https://app.test/legal/privacy',
      en: 'https://app.test/en/legal/privacy',
    })
  })

  it('ne référence rien quand aucun chemin n’est public', () => {
    expect(sitemapEntries({ entries: [], defaultLocale: 'fr', url })).toEqual([])
  })

  it('donne pour canonique la seule langue où la page existe', () => {
    // Un article traduit en anglais seulement : sa canonique ne peut pas être
    // l'URL française, qui répond 404. Et il ne porte qu'un `hreflang`.
    const [entry] = sitemapEntries({
      entries: [{ path: '/blog/only-in-english', locales: ['en'], lastModified: '2026-02-28' }],
      defaultLocale: 'fr',
      url,
    })

    expect(entry?.url).toBe('https://app.test/en/blog/only-in-english')
    expect(entry?.alternates).toEqual({ en: 'https://app.test/en/blog/only-in-english' })
    expect(entry?.lastModified).toBe('2026-02-28')
  })
})

describe('la politique des robots', () => {
  const policyFor = (allowed: readonly string[]) =>
    robotsPolicy({ allowed, sitemapUrl: 'https://app.test/sitemap.xml' })

  it('n’autorise que les chemins publics eux-mêmes, jamais ce qui s’ouvre en dessous', () => {
    const publicPaths = ['/fr', '/en', '/fr/legal/privacy', '/en/legal/privacy']
    const policy = policyFor(publicPaths)

    for (const pathname of publicPaths) {
      expect(robotsAllows(policy, pathname), pathname).toBe(true)
    }

    // La correspondance d'un `robots.txt` est **par préfixe** (RFC 9309 §2.2.2) :
    // « Allow: /fr » ouvre `/fr/account`, `/fr/sign-in` et `/fr/reset-password?token=…`,
    // et il l'emporte sur `Disallow: /` parce qu'il est plus long. Un jeton de
    // réinitialisation dans un index public est une fuite, pas une coquille.
    for (const pathname of [
      '/fr/account',
      '/fr/sign-in',
      '/fr/reset-password?token=jeton-de-reinitialisation',
      '/fr/verify-email',
      '/fr/legal/privacy/annexe',
      '/fr/legal/inconnu',
      '/frais',
      '/en/account',
      '/account',
      '/',
    ]) {
      expect(robotsAllows(policy, pathname), pathname).toBe(false)
    }

    expect(policy.sitemap).toBe('https://app.test/sitemap.xml')
  })

  it('n’ouvre pas davantage quand les chemins publics ne sont pas préfixés', () => {
    // Module `i18n` coupé : `publicPath` est l'identité, et le chemin public de
    // l'accueil est `/` — celui-là même que `Disallow: /` interdit. Une règle
    // d'autorisation par préfixe ouvrirait alors le site entier.
    const policy = policyFor(['/', '/legal/privacy'])

    expect(robotsAllows(policy, '/')).toBe(true)
    expect(robotsAllows(policy, '/legal/privacy')).toBe(true)

    for (const pathname of ['/account', '/sign-in', '/reset-password?token=jeton', '/legal']) {
      expect(robotsAllows(policy, pathname), pathname).toBe(false)
    }
  })

  it('interdit tout et n’annonce aucun plan de site quand rien n’est public', () => {
    const policy = policyFor([])

    expect(policy.rules.allow).toBeUndefined()
    expect(policy.rules.disallow).toEqual(['/'])
    expect(policy.sitemap).toBeUndefined()

    for (const pathname of ['/', '/fr', '/fr/legal/privacy', '/account']) {
      expect(robotsAllows(policy, pathname), pathname).toBe(false)
    }
  })

  it('annonce le plan de site dès qu’**un** chemin est public, fût-il d’un seul module', () => {
    // **La bascule que s53 assume** (piège 3 de la recherche). Site public
    // coupé, la liste était vide et le `sitemap.xml` n'était pas annoncé. Blog
    // activé, elle cesse de l'être : le plan de site **réapparaît** dans le
    // `robots.txt` là où il était tu. Ce n'est pas un défaut — un plan de site
    // qui référence des articles mérite d'être annoncé —, c'est un changement
    // de comportement, et il est écrit ici.
    const policy = policyFor(['/fr/blog'])

    expect(policy.sitemap).toBe('https://app.test/sitemap.xml')
    expect(robotsAllows(policy, '/fr/blog')).toBe(true)
    expect(robotsAllows(policy, '/fr')).toBe(false)
  })

  it('lit une politique comme un robot la lit : la règle la plus longue l’emporte', () => {
    // La garde contre l'inertie de `robotsAllows` : sans elle, une fonction qui
    // rendrait toujours `false` satisferait la moitié des cas ci-dessus.
    expect(robotsAllows({ rules: { userAgent: '*', disallow: [] } }, '/n’importe/quoi')).toBe(true)
    expect(
      robotsAllows({ rules: { userAgent: '*', allow: ['/blog/*$'], disallow: ['/'] } }, '/blog/x'),
    ).toBe(true)
  })
})
