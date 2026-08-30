import type { RegistryEmailTemplate } from '@repo/core'
import type { SendEmailInput } from '@repo/ports'
import { demoEnabledModule } from '@repo/module-demo-enabled'
import { describe, expect, it } from 'vitest'

import { createEmailRenderer, qualifyEmailTemplateId } from './render'

/**
 * Le template de démonstration vient du module `demo-enabled`, tel qu'il le
 * déclare au contrat (ADR 007). Rien n'est recopié ici : si le module changeait
 * ses locales, ces cas rendraient ce qu'il déclare, pas ce qu'on aurait figé.
 */
const registryEmails: readonly RegistryEmailTemplate[] = demoEnabledModule.emails.map(
  (template) => ({ moduleId: demoEnabledModule.id, template }),
)

const render = createEmailRenderer(registryEmails)

const WELCOME = qualifyEmailTemplateId('demo-enabled', 'welcome')

const anInput = (overrides: Partial<SendEmailInput> = {}): SendEmailInput => ({
  to: 'destinataire@example.test',
  subject: demoEnabledModule.emails[0]?.locales.fr.subject ?? '',
  template: WELCOME,
  locale: 'fr',
  data: { name: 'Olivier' },
  ...overrides,
})

describe('rendu React Email du template de démonstration', () => {
  it('rend le template avec ses données, en HTML et en texte', async () => {
    const rendered = await render(anInput())

    expect(rendered.subject).toContain('Olivier')
    expect(rendered.subject).not.toContain('{name}')
    expect(rendered.html).toContain('<html')
    expect(rendered.html).toContain('Olivier')
    expect(rendered.html).not.toContain('{name}')
    expect(rendered.text).toContain('Olivier')
    expect(rendered.text).not.toContain('<html')
  })

  it('rend la locale demandée, et pas une autre', async () => {
    const fr = await render(anInput({ locale: 'fr' }))
    const en = await render(anInput({ locale: 'en' }))

    expect(fr.html).not.toBe(en.html)
    expect(en.html).toContain(
      demoEnabledModule.emails[0]?.locales.en.body.replace('{name}', 'Olivier') ?? '',
    )
  })

  it('déclare la langue du document dans la locale demandée', async () => {
    // `lang` n'est pas décoratif : c'est ce que lisent les lecteurs d'écran et
    // les moteurs de traduction des clients de messagerie. Un email français
    // annoncé `lang="en"` se fait proposer à la traduction depuis l'anglais.
    const fr = await render(anInput({ locale: 'fr' }))
    const en = await render(anInput({ locale: 'en' }))

    expect(fr.html).toContain('lang="fr"')
    expect(en.html).toContain('lang="en"')
  })

  it('rend le sujet déclaré par le module quand l’appelant n’en impose pas', async () => {
    // Le contrat de module oblige chaque module à déclarer un sujet **par
    // locale**. Sans ce repli, chaque appelant devait aller le chercher dans le
    // registre pour le repasser au rendu qui l'a déjà — ou le coder en dur, et
    // rien n'empêchait alors un sujet français sur un corps anglais.
    const { subject: declared } = demoEnabledModule.emails[0]?.locales.en ?? { subject: '' }

    const rendered = await render(anInput({ locale: 'en', subject: undefined }))

    expect(rendered.subject).toBe(declared.replace('{name}', 'Olivier'))
  })

  it('échappe les données : une donnée ne devient jamais du balisage', async () => {
    // Les données d'un email viennent d'un utilisateur (son nom, celui de son
    // organisation). Interpolées dans le HTML sans échappement, elles font de
    // chaque email un vecteur d'injection.
    const rendered = await render(anInput({ data: { name: '<script>alert(1)</script>' } }))

    expect(rendered.html).not.toContain('<script>')
    expect(rendered.html).toContain('&lt;script&gt;')
  })
})

describe('rendu — ce qui est refusé', () => {
  it('refuse un template inconnu, en le nommant', async () => {
    await expect(render(anInput({ template: 'demo-enabled.inexistant' }))).rejects.toThrow(
      /demo-enabled\.inexistant/,
    )
  })

  it('refuse une locale non livrée par le module, en la nommant', async () => {
    await expect(render(anInput({ locale: 'de' }))).rejects.toThrow(/« de »/)
  })

  it('refuse une donnée manquante plutôt que d’envoyer un marqueur', async () => {
    // Un email qui part avec « Bonjour {name} » est pire qu'un email qui ne
    // part pas : il est visible du destinataire et personne ne le voit passer.
    await expect(render(anInput({ data: {} }))).rejects.toThrow(/name/)
  })
})

describe('identifiant qualifié d’un template', () => {
  it('porte le module, parce que deux modules peuvent nommer leur template pareil', () => {
    // Le contrat ne garantit pas l'unicité globale des identifiants de
    // template : `assertDeclarationsAreComplete` la vérifie pour les routes,
    // pas pour les emails. La qualification par module la rend inutile — même
    // convention que les clés de traduction.
    expect(qualifyEmailTemplateId('auth', 'welcome')).not.toBe(
      qualifyEmailTemplateId('demo-enabled', 'welcome'),
    )
  })
})
