import type { EmailTemplate } from '@repo/core'

import { DATA_EXPORT_EMAIL_TEMPLATE } from '../domain/data-export'

/**
 * Le lien de téléchargement d'un export de données (s35).
 *
 * Le corps dit **deux choses que la personne ne peut pas deviner** : que le
 * lien expire, et qu'il ouvre les données de son périmètre — donc qu'il ne se
 * transfère pas. Il ne dit pas combien de temps en chiffres : la durée est une
 * décision du serveur, et un email qui la recopierait mentirait le jour où elle
 * change.
 *
 * **Il ne promet pas « l'ensemble » de ses données**, et c'est mesuré : deux
 * manques sont documentés et délibérés — les fichiers de `storage` entrent par
 * un manifeste, sans octets ni empreinte (ADR 062), et le rôle de plateforme
 * d'un superadmin n'a aucune catégorie déclarée, donc n'est pas exporté (ADR
 * 063). La phrase dit donc ce que l'archive contient réellement : les données
 * **que nous exportons**. L'avertissement — ne transmettez ce lien à personne —
 * ne perd rien à cette précision.
 *
 * **Il ne promet pas non plus l'effacement de l'archive.** Il l'a promis, et
 * c'était faux d'une configuration livrable : sans ordonnanceur — `jobs` coupé,
 * ce que `config/profiles.ts` fait — et sans demande d'export ultérieure,
 * l'archive reste en base jusqu'à l'effacement du compte (ADR 062). Ce qui est
 * **inconditionnel** est le refus du lien, décidé à la lecture sur l'échéance
 * stockée : c'est donc la seule des deux moitiés que cet email garde. C'est le
 * seul endroit où ce reliquat est lu par la personne concernée plutôt que par un
 * agent ; il n'y a pas de place pour une nuance, seulement pour la vérité.
 */
export const dataExportReadyEmail: EmailTemplate<'fr' | 'en'> = {
  id: DATA_EXPORT_EMAIL_TEMPLATE,
  locales: {
    fr: {
      subject: 'Votre export de données est prêt',
      body:
        'Téléchargez vos données : {url}\n\n' +
        'Ce lien ouvre l’ensemble des données que nous exportons pour votre ' +
        'périmètre : ne le transmettez à personne. Il cesse de fonctionner à son ' +
        'échéance. Si vous n’êtes pas à l’origine de cette demande, ignorez cet ' +
        'email et changez votre mot de passe.',
    },
    en: {
      subject: 'Your data export is ready',
      body:
        'Download your data: {url}\n\n' +
        'This link opens every piece of data we export for your scope: do not ' +
        'forward it. It stops working when it expires. If you did not request it, ' +
        'ignore this email and change your password.',
    },
  },
}
