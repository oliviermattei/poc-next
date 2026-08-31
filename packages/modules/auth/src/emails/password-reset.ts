import type { EmailTemplate } from '@repo/core'

/** Le lien de réinitialisation de mot de passe. */
export const passwordResetEmail: EmailTemplate<'fr' | 'en'> = {
  id: 'reset-password',
  locales: {
    fr: {
      subject: 'Réinitialisez votre mot de passe',
      body:
        'Choisissez un nouveau mot de passe : {url}\n\n' +
        'Ce lien ne fonctionne qu’une fois et expire rapidement ; l’utiliser ' +
        'annule les autres liens en cours. Si vous n’êtes pas à l’origine de ' +
        'cette demande, ignorez cet email : votre mot de passe reste inchangé.',
    },
    en: {
      subject: 'Reset your password',
      body:
        'Choose a new password: {url}\n\n' +
        'This link works once and expires shortly; using it cancels any other ' +
        'pending link. If you did not request it, ignore this email: your ' +
        'password stays unchanged.',
    },
  },
}
