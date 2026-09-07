import type { EmailTemplate } from '@repo/core'

/**
 * La confirmation d'inscription à la liste d'attente — le troisième critère de
 * s42.
 *
 * **Un second template, pas un libellé de plus sur celui de la lettre
 * d'information.** Les deux listes ne promettent pas la même chose : l'une
 * annonce des versions à qui suit le produit, l'autre promet **un seul** email,
 * le jour de l'ouverture. Réemployer le texte de la newsletter dirait au futur
 * client qu'il vient de s'abonner à une lettre d'information — ce qui est faux,
 * et ce qu'aucune traduction ne rattraperait.
 *
 * Elle part, comme celle de s11, **hors du temps de réponse** : une inscription
 * nouvelle en envoie une, un doublon non, et la latence dirait sinon lequel des
 * deux cas s'est produit (`docs/security.md` §7).
 *
 * Ce qu'elle ne contient pas, et ce n'est pas un oubli : **aucun lien de
 * désinscription**. Il n'existe pas davantage ici que pour la lettre
 * d'information — aucune story livrée n'en pose la route —, et un lien mort
 * dans un email est pire qu'un lien absent. Le texte dit quoi faire à la place.
 */
export const waitlistConfirmationEmail: EmailTemplate<'fr' | 'en'> = {
  id: 'waitlist-confirmation',
  locales: {
    fr: {
      subject: 'Vous êtes sur la liste d’attente',
      body:
        'L’adresse {email} est inscrite sur notre liste d’attente. Nous vous ' +
        'préviendrons à l’ouverture, et nous ne vous écrirons pas d’ici là.\n\n' +
        'Vous n’êtes pas à l’origine de cette demande ? Répondez à cet email et ' +
        'nous retirerons l’adresse.',
    },
    en: {
      subject: 'You are on the waitlist',
      body:
        '{email} is on our waitlist. We will let you know when we open, and we ' +
        'will not write to you before then.\n\n' +
        'Did not request this? Reply to this email and we will remove the address.',
    },
  },
}
