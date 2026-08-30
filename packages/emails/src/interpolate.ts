import type { EmailData } from '@repo/ports'

/**
 * Interpolation des données d'un template : `{name}` → la valeur.
 *
 * Pure, et **une seule** : le sujet et le corps passent par elle. Interpoler le
 * sujet chez l'appelant en ferait deux implémentations, qui divergeraient au
 * premier cas particulier.
 *
 * Une donnée manquante **lève**. C'est le point qui mérite d'être défendu : la
 * tolérance produirait un email visible du destinataire, portant « Bonjour
 * {name} », que personne du côté du produit ne voit passer. Un email qui ne
 * part pas se remarque ; un email fautif qui part, non.
 */
export class EmailTemplateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailTemplateError'
  }
}

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g

export function interpolate(template: string, data: EmailData, context: string): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    const value = data[key]

    if (value === undefined) {
      throw new EmailTemplateError(
        `Le template ${context} attend la donnée « ${key} », absente de l’envoi.`,
      )
    }

    return String(value)
  })
}
