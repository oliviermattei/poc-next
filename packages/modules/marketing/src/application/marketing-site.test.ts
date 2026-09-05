import { describe, expect, it } from 'vitest'

import { MarketingConfigurationError } from '../domain/marketing-config'
import { marketingMessageKeys } from '../domain/message-keys'
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
  forms: {
    contactRecipient: 'bonjour@exemple.test',
    newsletterSource: 'newsletter',
    rateLimit: { windowSeconds: 600, maxPerClient: 5, maxPerForm: 200 },
  },
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

    // `/contact` est une page publique du module depuis s11 : elle entre donc
    // dans le plan de site et dans la politique des robots par le même chemin
    // que les documents légaux, sans qu'aucune liste ne soit recopiée.
    expect(site.publicPaths).toEqual(['/', '/contact', '/legal/privacy', '/legal/terms'])
  })

  it('rend l’adresse de contact **de la configuration**, jamais une constante', () => {
    // Le piège nommé par la story : une adresse écrite dans le code serait la
    // même dans tous les projets générés depuis ce boilerplate.
    const site = resolveMarketingSite({
      ...validConfiguration(),
      forms: { ...validConfiguration().forms, contactRecipient: 'editeur@autre.test' },
    })

    expect(site.forms?.contactRecipient).toBe('editeur@autre.test')
  })

  it.each([
    ['aucun bloc de formulaires', { forms: undefined }, /forms/],
    [
      'une adresse de contact malformée',
      { forms: { ...validConfiguration().forms, contactRecipient: 'pas-une-adresse' } },
      /pas-une-adresse/,
    ],
    [
      'une adresse de contact porteuse d’un retour à la ligne',
      {
        forms: {
          ...validConfiguration().forms,
          contactRecipient: 'a@b.test\r\nBcc: espion@b.test',
        },
      },
      /contactRecipient/,
    ],
    [
      'une source d’inscription qui n’est pas un identifiant',
      { forms: { ...validConfiguration().forms, newsletterSource: 'Newsletter 2026' } },
      /newsletterSource/,
    ],
    [
      'une fenêtre de limitation nulle',
      {
        forms: {
          ...validConfiguration().forms,
          rateLimit: { ...validConfiguration().forms.rateLimit, windowSeconds: 0 },
        },
      },
      /windowSeconds/,
    ],
    [
      'un seuil par appelant à zéro — ce serait un formulaire fermé',
      {
        forms: {
          ...validConfiguration().forms,
          rateLimit: { ...validConfiguration().forms.rateLimit, maxPerClient: 0 },
        },
      },
      /maxPerClient/,
    ],
  ])('refuse %s, en la nommant', (_case, override, message) => {
    expect(() => resolveMarketingSite({ ...validConfiguration(), ...override })).toThrowError(
      MarketingConfigurationError,
    )
    expect(() => resolveMarketingSite({ ...validConfiguration(), ...override })).toThrowError(
      message,
    )
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

  it('n’expose aucun formulaire : il n’y a ni destinataire, ni source, ni seuil', () => {
    // C'est ce `null` qui fait disparaître l'écran de contact et la section
    // d'inscription **sans condition sur un identifiant de module**.
    expect(EMPTY_MARKETING_SITE.forms).toBeNull()
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
