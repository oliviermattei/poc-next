import type { EmailTemplate } from '@repo/core'

/** Le lien de connexion à usage unique. */
export const magicLinkEmail: EmailTemplate<'fr' | 'en'> = {
  id: 'magic-link',
  locales: {
    fr: {
      subject: 'Votre lien de connexion',
      body:
        'Connectez-vous en suivant ce lien : {url}\n\n' +
        'Ce lien ne fonctionne qu’une fois et expire dans quelques minutes. ' +
        'Demander un nouveau lien annule celui-ci.',
    },
    en: {
      subject: 'Your sign-in link',
      body:
        'Sign in by following this link: {url}\n\n' +
        'This link works once and expires within minutes. ' +
        'Requesting a new link cancels this one.',
    },
  },
}
