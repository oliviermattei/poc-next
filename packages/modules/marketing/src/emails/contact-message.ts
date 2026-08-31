import type { EmailTemplate } from '@repo/core'

/**
 * Le message de contact, tel qu'il arrive à l'éditeur.
 *
 * **Le sujet n'interpole rien.** C'est la règle qui ferme l'injection
 * d'en-tête : `subject` est un champ d'en-tête, et `@repo/emails` l'interpole
 * avec la **même** fonction que le corps, qui n'échappe rien
 * (`packages/emails/src/interpolate.ts`). Un sujet portant `{name}` ferait donc
 * transiter la saisie d'un visiteur par un en-tête. Le nom et l'adresse vivent
 * dans le corps, que React Email échappe — c'est prouvé dans
 * `packages/emails/src/render.test.ts`.
 *
 * Le destinataire, lui, vient de `config/marketing.ts` : il n'est jamais une
 * donnée du formulaire.
 */
export const contactMessageEmail: EmailTemplate<'fr' | 'en'> = {
  id: 'contact-message',
  locales: {
    fr: {
      subject: 'Nouveau message depuis le formulaire de contact',
      body:
        'De : {name} <{email}>\n\n' +
        '{message}\n\n' +
        'Répondez directement à cette adresse.',
    },
    en: {
      subject: 'New message from the contact form',
      body: 'From: {name} <{email}>\n\n' + '{message}\n\n' + 'Reply directly to that address.',
    },
  },
}
