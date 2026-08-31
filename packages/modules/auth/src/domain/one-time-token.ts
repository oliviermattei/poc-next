/**
 * Les usages d'un jeton à usage unique.
 *
 * L'usage fait partie de l'identifiant stocké : sans lui, un jeton de
 * vérification d'email servirait de jeton de changement d'email, et
 * l'invalidation des jetons frères effacerait ceux d'un autre parcours.
 */
export type TokenPurpose =
  | 'email-verification'
  | 'email-change'
  | 'magic-link'
  | 'reset-password'

/** L'identifiant stocké : `<usage>:<empreinte du jeton>`. */
export function tokenIdentifier(purpose: TokenPurpose, digest: string): string {
  return `${purpose}:${digest}`
}

/** Le préfixe des identifiants d'un usage, pour invalider les jetons frères. */
export function tokenIdentifierPrefix(purpose: TokenPurpose): string {
  return `${purpose}:`
}

/**
 * Un jeton est expiré **à** l'instant de son expiration, pas après.
 *
 * L'inégalité stricte laisserait une milliseconde pendant laquelle un jeton
 * périmé est encore accepté ; c'est sans conséquence pratique et faux à la
 * lecture, ce qui est le pire des deux.
 */
export function isTokenExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime()
}
