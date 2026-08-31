import { describe, expect, it } from 'vitest'

import { MarketingConfigurationError } from '../domain/marketing-config'
import { marketingMessageKeys } from '../domain/message-keys'
import { marketingRobotsPolicy, marketingSitemapEntries, robotsAllows } from '../domain/seo'
import {
  EMPTY_MARKETING_SITE,
  legalDocumentOf,
  resolveMarketingSite,
} from './marketing-site'

/**
 * Les règles du site public, éprouvées **à l'endroit où elles vivent**.
 *
 * Tout ce que ce fichier exerce est pur : une configuration entre, une décision
 * sort. Aucun rendu, aucune base, aucun registre — ceux-là sont le sujet de
 * `tests/marketing.test.ts`, qui prouve le câblage. Deux fichiers, deux
 * questions : la règle ici, son application là-bas.
 */

/** Une configuration minimale valide, que chaque cas déforme sur un seul point. */
const validConfiguration = () => ({
  sections: [
    { id: 'hero', kind: 'hero', actions: [{ id: 'signUp', href: '/sign-up', variant: 'default' }] },
    { id: 'features', kind: 'features', items: ['modules', 'toggle'] },
  ],
  legalDocuments: [{ slug: 'privacy', sections: ['data'] }],
})

describe('la configuration du site public', () => {
  it('conserve l’ordre déclaré des sections — c’est lui qui décide de la page', () => {
    const site = resolveMarketingSite({
      ...validConfiguration(),
      sections: [
        { id: 'features', kind: 'features', items: ['modules'] },
        { id: 'hero', kind: 'hero', actions: [{ id: 'signUp', href: '/', variant: 'default' }] },
      ],
    })

    expect(site.sections.map((section) => section.id)).toEqual(['features', 'hero'])
  })

  it('retirer une section la retire de la page, sans toucher au reste', () => {
    const full = resolveMarketingSite(validConfiguration())
    const trimmed = resolveMarketingSite({
      ...validConfiguration(),
      sections: validConfiguration().sections.filter((section) => section.id !== 'features'),
    })

    expect(full.sections).toHaveLength(2)
    expect(trimmed.sections.map((section) => section.id)).toEqual(['hero'])
  })

  it.each([
    [
      'une nature inconnue',
      { sections: [{ id: 'hero', kind: 'carousel' }] },
      /carousel/,
    ],
    [
      'deux sections du même identifiant',
      {
        sections: [
          { id: 'hero', kind: 'hero', actions: [{ id: 'a', href: '/', variant: 'default' }] },
          { id: 'hero', kind: 'cta', actions: [{ id: 'b', href: '/', variant: 'default' }] },
        ],
      },
      /« hero »/,
    ],
    [
      'une section à éléments qui n’en déclare aucun',
      { sections: [{ id: 'faq', kind: 'faq', items: [] }] },
      /« faq »/,
    ],
    [
      'des éléments sur une nature qui n’en affiche pas',
      {
        sections: [
          {
            id: 'hero',
            kind: 'hero',
            items: ['perdu'],
            actions: [{ id: 'a', href: '/', variant: 'default' }],
          },
        ],
      },
      /« hero »/,
    ],
    [
      'une section d’appel à l’action sans action',
      { sections: [{ id: 'cta', kind: 'cta', actions: [] }] },
      /« cta »/,
    ],
    [
      'une action qui sort du site',
      {
        sections: [
          {
            id: 'hero',
            kind: 'hero',
            actions: [{ id: 'a', href: 'https://evil.test', variant: 'default' }],
          },
        ],
      },
      /https:\/\/evil\.test/,
    ],
    ['aucune section', { sections: [] }, /section/i],
    ['aucun document légal', { legalDocuments: [] }, /légal/i],
    [
      'deux documents légaux du même slug',
      {
        legalDocuments: [
          { slug: 'privacy', sections: ['data'] },
          { slug: 'privacy', sections: ['autre'] },
        ],
      },
      /« privacy »/,
    ],
    [
      'un document légal sans section',
      { legalDocuments: [{ slug: 'privacy', sections: [] }] },
      /« privacy »/,
    ],
  ])('refuse %s, en la nommant', (_case, override, message) => {
    expect(() => resolveMarketingSite({ ...validConfiguration(), ...override })).toThrowError(
      MarketingConfigurationError,
    )
    expect(() => resolveMarketingSite({ ...validConfiguration(), ...override })).toThrowError(
      message,
    )
  })

  it('dérive les chemins publics de ce que la configuration déclare', () => {
    const site = resolveMarketingSite({
      ...validConfiguration(),
      legalDocuments: [
        { slug: 'privacy', sections: ['data'] },
        { slug: 'terms', sections: ['object'] },
      ],
    })

    expect(site.publicPaths).toEqual(['/', '/legal/privacy', '/legal/terms'])
  })

  it('ne connaît qu’un document légal déclaré — tout autre slug n’existe pas', () => {
    const site = resolveMarketingSite(validConfiguration())

    expect(legalDocumentOf(site, 'privacy')?.slug).toBe('privacy')
    expect(legalDocumentOf(site, 'terms')).toBeNull()
    // Le chemin par lequel un visiteur essaierait d'atteindre un fichier :
    // il n'existe pas davantage, et l'écran répondra 404.
    expect(legalDocumentOf(site, '../../etc/passwd')).toBeNull()
  })
})

describe('le site vide — l’état « module coupé »', () => {
  it('n’expose ni section, ni document légal, ni chemin public', () => {
    expect(EMPTY_MARKETING_SITE.sections).toEqual([])
    expect(EMPTY_MARKETING_SITE.legalDocuments).toEqual([])
    expect(EMPTY_MARKETING_SITE.publicPaths).toEqual([])
  })
})

describe('les clés de traduction qu’une configuration exige', () => {
  it('en demande une par texte affiché, qualifiée par le module', () => {
    const keys = marketingMessageKeys(resolveMarketingSite(validConfiguration()))

    expect(keys).toContain('marketing.section.hero.title')
    expect(keys).toContain('marketing.section.hero.description')
    expect(keys).toContain('marketing.section.hero.action.signUp')
    expect(keys).toContain('marketing.section.features.item.modules.title')
    expect(keys).toContain('marketing.section.features.item.toggle.body')
    expect(keys).toContain('marketing.legal.privacy.title')
    expect(keys).toContain('marketing.legal.privacy.section.data.body')
    expect(keys).toContain('marketing.footer.label')
    expect(keys).toContain('marketing.home.title')
  })

  it('suit la configuration : une section ajoutée amène ses clés, une section retirée les emporte', () => {
    const withFaq = marketingMessageKeys(
      resolveMarketingSite({
        ...validConfiguration(),
        sections: [
          ...validConfiguration().sections,
          { id: 'faq', kind: 'faq', items: ['stack'] },
        ],
      }),
    )
    const without = marketingMessageKeys(resolveMarketingSite(validConfiguration()))

    expect(withFaq).toContain('marketing.section.faq.item.stack.title')
    expect(without).not.toContain('marketing.section.faq.item.stack.title')
  })

  it('n’en demande aucune quand il n’y a pas de site', () => {
    expect(marketingMessageKeys(EMPTY_MARKETING_SITE)).toEqual([])
  })
})

describe('le plan de site', () => {
  /** Une fabrique d'URL absolue, comme le point de composition en fournit une. */
  const url = (pathname: string, locale: string) =>
    `https://app.test${locale === 'fr' ? '' : `/${locale}`}${pathname === '/' ? '' : pathname}`

  it('rend une entrée par chemin public, avec ses variantes de langue', () => {
    const entries = marketingSitemapEntries({
      paths: ['/', '/legal/privacy'],
      locales: ['fr', 'en'],
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
    expect(
      marketingSitemapEntries({ paths: [], locales: ['fr', 'en'], defaultLocale: 'fr', url }),
    ).toEqual([])
  })
})

describe('la politique des robots', () => {
  const policyFor = (allowed: readonly string[]) =>
    marketingRobotsPolicy({ allowed, sitemapUrl: 'https://app.test/sitemap.xml' })

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

  it('lit une politique comme un robot la lit : la règle la plus longue l’emporte', () => {
    // La garde contre l'inertie de `robotsAllows` : sans elle, une fonction qui
    // rendrait toujours `false` satisferait la moitié des cas ci-dessus.
    expect(robotsAllows({ rules: { userAgent: '*', disallow: [] } }, '/n’importe/quoi')).toBe(true)
    expect(
      robotsAllows({ rules: { userAgent: '*', allow: ['/blog/*$'], disallow: ['/'] } }, '/blog/x'),
    ).toBe(true)
  })
})
