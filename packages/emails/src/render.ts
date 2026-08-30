import type { EmailTemplateContent, RegistryEmailTemplate } from '@repo/core'
import type { EmailRenderer, RenderedEmail, SendEmailInput } from '@repo/ports'
import { render } from '@react-email/components'
import { createElement } from 'react'

import { EmailTemplateError, interpolate } from './interpolate'
import { TransactionalEmail } from './transactional-email'

/**
 * Le rendu des emails, **injecté** dans les implémentations du port `Mailer`.
 *
 * C'est ce qui permet à `@repo/adapter-resend` de ne dépendre que du SDK, et
 * aux outils de `@repo/mailer-testing` de n'avoir aucune dépendance : ni l'un
 * ni les autres ne connaissent React.
 *
 * Le catalogue vient du **registre de modules** : seuls les templates des
 * modules activés sont rendables, exactement comme leurs routes et leur
 * navigation. Un module désactivé ne laisse pas plus de trace ici qu'ailleurs.
 */

/**
 * Identifiant qualifié d'un template : `<module>.<template>`.
 *
 * Le contrat ne garantit pas l'unicité globale des identifiants de template —
 * `assertDeclarationsAreComplete` la vérifie pour les routes, pas pour les
 * emails, et deux modules peuvent légitimement déclarer `welcome`. La
 * qualification par module rend la question sans objet, avec la convention déjà
 * retenue pour les clés de traduction (`qualifyMessageKey`).
 */
export function qualifyEmailTemplateId(moduleId: string, templateId: string): string {
  return `${moduleId}.${templateId}`
}

const contentFor = (
  templates: ReadonlyMap<string, RegistryEmailTemplate>,
  input: SendEmailInput,
): EmailTemplateContent => {
  const found = templates.get(input.template)

  if (found === undefined) {
    throw new EmailTemplateError(
      `Aucun template d’email « ${input.template} » parmi les modules activés.`,
    )
  }

  const content = found.template.locales[input.locale]

  if (content === undefined) {
    throw new EmailTemplateError(
      `Le template « ${input.template} » n’est pas livré dans la locale « ${input.locale} ».`,
    )
  }

  return content
}

export function createEmailRenderer(
  emails: readonly RegistryEmailTemplate[],
): EmailRenderer {
  const templates = new Map(
    emails.map((entry) => [qualifyEmailTemplateId(entry.moduleId, entry.template.id), entry]),
  )

  return async (input: SendEmailInput): Promise<RenderedEmail> => {
    const content = contentFor(templates, input)

    // Le sujet vient de l'appel quand l'appelant en impose un, du template
    // déclaré sinon — le contrat de module l'oblige à en déclarer un par
    // locale. Sujet et corps passent par la **même** interpolation.
    const subject = interpolate(
      input.subject ?? content.subject,
      input.data,
      `« ${input.template} » (sujet)`,
    )
    const body = interpolate(content.body, input.data, `« ${input.template} »`)

    const element = createElement(TransactionalEmail, { subject, body, locale: input.locale })

    // `render` de `@react-email/components@1.0.12` est **asynchrone** — relevé
    // dans le paquet installé, la majeure précédente le rendait de façon
    // synchrone.
    const [html, text] = await Promise.all([
      render(element),
      render(element, { plainText: true }),
    ])

    return { subject, html, text }
  }
}

export { EmailTemplateError } from './interpolate'
