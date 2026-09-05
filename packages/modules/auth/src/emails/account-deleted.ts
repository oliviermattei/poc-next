import type { EmailTemplate } from '@repo/core'

/**
 * La confirmation d'une suppression de compte (s34, critère 8).
 *
 * **Elle part après l'effacement, et l'adresse est retenue avant** — la
 * décision est écrite là où elle s'exécute (`runAccountPurge`), pas ici. Le
 * texte n'annonce donc rien : il constate. Un email envoyé avant, sur une
 * suppression qui peut encore échouer, serait un accusé de réception faux.
 *
 * Aucune donnée à interpoler : le corps ne nomme ni le compte, ni son adresse.
 * Le seul destinataire est la personne concernée, et lui rappeler son propre
 * identifiant dans un message qui survit à son compte n'apporte rien.
 */
export const accountDeletedEmail: EmailTemplate<'fr' | 'en'> = {
  id: 'account-deleted',
  locales: {
    fr: {
      subject: 'Votre compte a été supprimé',
      body:
        'Votre compte et les données personnelles qui y étaient rattachées ont ' +
        'été supprimés. Cette opération est définitive : il n’existe aucun ' +
        'moyen de les restaurer.\n\n' +
        'Vous pouvez créer un nouveau compte avec cette adresse à tout moment.',
    },
    en: {
      subject: 'Your account has been deleted',
      body:
        'Your account and the personal data attached to it have been deleted. ' +
        'This is permanent: there is no way to restore them.\n\n' +
        'You can create a new account with this address at any time.',
    },
  },
}
