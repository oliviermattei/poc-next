import type { EmailTemplate } from '@repo/core'

import { INVITATION_EMAIL_TEMPLATE } from '../domain/invitation'

/**
 * L'email d'invitation.
 *
 * Le texte et ses locales sont déclarés au contrat (ADR 007) ; le compilateur
 * refuse une locale manquante — `emails[].locales` est indexé par les locales de
 * `messages`, et ce module en livre deux. Le lien et le nom de l'organisation
 * sont interpolés par `@repo/emails`, qui **refuse** un envoi dont une donnée
 * manque plutôt que d'expédier « {url} ».
 *
 * Aucune donnée personnelle du destinataire n'y figure : il reçoit le nom de
 * l'organisation qui l'invite et un lien, rien d'autre.
 */
export const invitationEmail: EmailTemplate<'fr' | 'en'> = {
  id: INVITATION_EMAIL_TEMPLATE,
  locales: {
    fr: {
      subject: 'Invitation à rejoindre {organization}',
      body:
        'Vous avez été invité à rejoindre {organization}. Ouvrez ce lien pour accepter : {url}\n\n' +
        'Ce lien ne fonctionne qu’une fois et expire au bout de sept jours. ' +
        'Si vous ne savez pas de quoi il s’agit, ignorez cet email.',
    },
    en: {
      subject: 'Invitation to join {organization}',
      body:
        'You have been invited to join {organization}. Open this link to accept: {url}\n\n' +
        'This link works once and expires after seven days. ' +
        'If you do not know what this is about, ignore this email.',
    },
  },
}
