import type { EmailTemplate } from '@repo/core'

/**
 * La confirmation d'inscription à la newsletter — le troisième critère de s11.
 *
 * Elle part **hors du temps de réponse** : une inscription nouvelle en envoie
 * une, un doublon non, et la latence dirait sinon lequel des deux cas s'est
 * produit (`docs/security.md` §7).
 *
 * Ce qu'elle ne contient pas, et ce n'est pas un oubli : **aucun lien de
 * désinscription**. Il n'existe pas encore — aucune story livrée n'en pose la
 * route, et un lien mort dans un email est pire qu'un lien absent. Le texte dit
 * donc ce qu'il faut faire à la place. C'est une limite de s11, écrite ici pour
 * que la story qui livrera la désinscription sache où revenir.
 */
export const newsletterConfirmationEmail: EmailTemplate<'fr' | 'en'> = {
  id: 'newsletter-confirmation',
  locales: {
    fr: {
      subject: 'Votre inscription est enregistrée',
      body:
        'L’adresse {email} est inscrite à notre lettre d’information.\n\n' +
        'Vous n’êtes pas à l’origine de cette demande ? Répondez à cet email et ' +
        'nous retirerons l’adresse.',
    },
    en: {
      subject: 'Your subscription is confirmed',
      body:
        '{email} is now subscribed to our newsletter.\n\n' +
        'Did not request this? Reply to this email and we will remove the address.',
    },
  },
}
