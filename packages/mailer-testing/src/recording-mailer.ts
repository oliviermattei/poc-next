import type { Mailer, SendEmailInput, SendEmailResult } from '@repo/ports'

/**
 * La doublure d'enregistrement : **un outil de test**, pas un fournisseur.
 *
 * Elle n'envoie rien, ne rend rien, ne touche ni au réseau ni au disque. Elle
 * garde ce qu'on lui a demandé d'envoyer pour qu'un test puisse l'affirmer —
 * c'est le régime d'intégration tierce de la CI (`docs/architecture.md`,
 * « deux régimes, jamais mélangés »).
 *
 * Elle **ne rend pas** le template, délibérément : le critère de la story
 * porte sur le destinataire, le template et les données. Rendre ici ferait
 * dépendre chaque test de CI de la mise en page des emails, et un template
 * cassé ferait rougir des suites qui ne parlent pas d'emails. Le rendu est
 * prouvé là où il vit, dans `@repo/emails`.
 */
export interface RecordingMailer extends Mailer {
  /** Les envois reçus, dans l'ordre. Instantané : une lecture ne bouge plus. */
  readonly sent: readonly SendEmailInput[]
  reset(): void
}

export function createRecordingMailer(): RecordingMailer {
  const sent: SendEmailInput[] = []
  let counter = 0

  return {
    get sent(): readonly SendEmailInput[] {
      // Une copie, pas la liste vivante : sinon un test qui lit avant l'envoi
      // qu'il prétend observer passe au vert quand l'envoi arrive après.
      return [...sent]
    },

    send(input: SendEmailInput): Promise<SendEmailResult> {
      sent.push(input)
      counter += 1

      return Promise.resolve({ ok: true, id: `recorded-${counter}` })
    },

    reset(): void {
      sent.length = 0
      counter = 0
    },
  }
}
