/**
 * Assainissement des messages du fournisseur (`docs/security.md` §5).
 *
 * `MailerLogRecord` n'a **aucun** champ où mettre un destinataire, un sujet ou
 * un corps : le compilateur tient cette moitié-là. Reste `message`, qui vient
 * du fournisseur et qu'on ne contrôle pas — Resend met volontiers l'adresse
 * refusée dans son texte, et rien n'interdit qu'un jour une clé s'y retrouve.
 * Ce fichier est la seconde moitié de la garantie, et la seule qui puisse
 * mordre : sa mutation est décrite dans l'`AGENTS.md` du package.
 *
 * Le message assaini finit **aussi** dans `MailerError.message`, donc
 * potentiellement dans une réponse d'erreur. §5 y interdit un secret autant que
 * dans un journal : une seule fonction pour les deux chemins, sans quoi l'un
 * des deux serait oublié.
 */

/** Un message de fournisseur n'est pas un dépotoir : au-delà, on tronque. */
export const MAX_MESSAGE_LENGTH = 200

/**
 * Ce qu'on efface, et pourquoi chaque motif est là.
 *
 * L'ordre compte : le jeton `Bearer` est retiré avant la clé nue, pour que le
 * mot `Bearer` disparaisse avec elle.
 */
const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  // Jeton d'autorisation, sous la forme où un fournisseur le recopie.
  [/\bBearer\s+\S+/gi, '[secret]'],
  // Clé d'API Resend : préfixe `re_` suivi du secret.
  [/\bre_[A-Za-z0-9_-]+/g, '[secret]'],
  // Toute adresse email : le destinataire d'un email est une donnée
  // personnelle, et c'est la fuite la plus probable — Resend nomme l'adresse
  // refusée dans ses messages de validation.
  [/[^\s<>@]+@[^\s<>@]+\.[A-Za-z]{2,}/g, '[adresse]'],
]

export function sanitizeProviderMessage(message: string): string {
  const redacted = REDACTIONS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    message,
  )

  return redacted.length > MAX_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
    : redacted
}
