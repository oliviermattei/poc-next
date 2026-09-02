/**
 * Assainissement des messages du fournisseur (`docs/security.md` §5).
 *
 * `StorageLogRecord` n'a **aucun** champ où mettre la clé d'objet, le seau, un
 * octet ou une URL signée : le compilateur tient cette moitié-là. Reste
 * `message`, qui vient du SDK et qu'on ne contrôle pas — un message de S3 cite
 * volontiers la clé et le seau, et une clé d'objet **porte l'identifiant du
 * compte ou de l'organisation propriétaire**. C'est une donnée personnelle.
 *
 * Le message assaini finit **aussi** dans `StorageError.message`, donc
 * potentiellement dans une réponse d'erreur. Une seule fonction pour les deux
 * chemins, sans quoi l'un des deux serait oublié.
 */

/** Un message de fournisseur n'est pas un dépotoir : au-delà, on tronque. */
export const MAX_MESSAGE_LENGTH = 200

export interface SanitizeContext {
  /** Le seau. Retiré du message parce que le SDK l'y met. */
  readonly bucket: string
  /**
   * La clé d'objet de **cette** opération, retirée nommément.
   *
   * C'est la redaction la plus fiable : elle ne dépend d'aucun motif, seulement
   * de ce que l'appelant a passé. Un motif générique sur « ce qui ressemble à
   * un chemin » raterait le premier format de clé qu'on n'aura pas prévu.
   */
  readonly key?: string
}

/** Ce qu'on efface, indépendamment du contexte, et pourquoi chaque motif est là. */
const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  // Jeton d'autorisation, sous la forme où un transport le recopie. Avant la
  // clé nue, pour que le mot `Bearer` disparaisse avec elle.
  [/\bBearer\s+\S+/gi, '[secret]'],
  // Identifiant de clé d'accès AWS. Ce n'est pas le secret, mais il nomme le
  // compte : rien ne l'oblige à traîner dans un journal.
  [/\bAKIA[0-9A-Z]{8,}/g, '[secret]'],
  // Toute URL : une URL présignée porte la signature **et** la clé d'objet.
  [/https?:\/\/\S+/g, '[url]'],
  // Un en-tête de signature recopié dans un message d'erreur.
  [/X-Amz-[A-Za-z-]*=\S+/gi, '[secret]'],
]

/** Échappe une chaîne pour l'employer littéralement dans une expression régulière. */
const literal = (value: string): RegExp =>
  new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')

export function sanitizeProviderMessage(message: string, context: SanitizeContext): string {
  const contextual: readonly (readonly [RegExp, string])[] = [
    ...(context.key !== undefined && context.key !== ''
      ? ([[literal(context.key), '[clé]']] as const)
      : []),
    [literal(context.bucket), '[seau]'],
  ]

  const redacted = [...contextual, ...REDACTIONS].reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    message,
  )

  return redacted.length > MAX_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
    : redacted
}
