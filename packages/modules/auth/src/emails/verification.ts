import type { EmailTemplate } from '@repo/core'

/**
 * L'email de vérification d'adresse.
 *
 * Le texte et ses locales sont déclarés au contrat (ADR 007) ; le compilateur
 * refuse une locale manquante. Le lien est interpolé par `@repo/emails`, qui
 * **refuse** un envoi dont la donnée manque plutôt que d'expédier « {url} ».
 */
export const verificationEmail: EmailTemplate<'fr' | 'en'> = {
  id: 'verify-email',
  locales: {
    fr: {
      subject: 'Vérifiez votre adresse email',
      body:
        'Confirmez votre adresse pour activer votre compte : {url}\n\n' +
        'Ce lien ne fonctionne qu’une fois et expire rapidement. ' +
        'Si vous n’êtes pas à l’origine de cette demande, ignorez cet email.',
    },
    en: {
      subject: 'Verify your email address',
      body:
        'Confirm your address to activate your account: {url}\n\n' +
        'This link works once and expires shortly. ' +
        'If you did not request it, ignore this email.',
    },
  },
}
