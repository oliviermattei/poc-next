/**
 * Les événements de sécurité (`docs/security.md` §7), et le filtrage qui les
 * rend publiables (§5 : « aucun secret dans un journal »).
 *
 * Deux gardes, et il faut les deux :
 *
 * 1. **La forme est fermée.** Un enregistrement porte un événement, un acteur
 *    et des détails scalaires — il n'y a aucun champ où mettre un mot de passe,
 *    un cookie ou un jeton, et l'acteur est un identifiant, jamais une adresse
 *    email. C'est le compilateur qui tient cette moitié.
 * 2. **Les valeurs sont assainies.** Un détail peut porter un secret sans le
 *    dire : une URL de vérification contient son jeton, un nom de clé inattendu
 *    échappe à toute liste d'interdits. Le filtrage porte donc sur la
 *    **valeur** autant que sur le nom, et il est prouvé par mutation.
 */
export type SecurityEventName =
  | 'auth.sign_up_succeeded'
  | 'auth.sign_in_succeeded'
  | 'auth.sign_in_failed'
  | 'auth.sign_out'
  | 'auth.email_verified'
  | 'auth.email_verification_failed'
  | 'auth.email_change_requested'
  | 'auth.email_changed'
  | 'auth.magic_link_requested'
  | 'auth.password_reset_requested'
  | 'auth.password_reset_succeeded'
  | 'auth.password_changed'
  | 'auth.profile_changed'
  | 'auth.session_revoked'
  // Une demande de révocation qui ne correspond à aucune session **du compte**.
  // Journalisée : c'est le signal d'un identifiant deviné, et §7 demande de
  // pouvoir le détecter. La réponse rendue à l'appelant, elle, ne distingue
  // rien.
  | 'auth.session_revocation_refused'

/** L'acteur d'un événement. `email` est accepté à l'appel, jamais journalisé. */
export interface SecurityEventActor {
  readonly userId: string
  readonly email?: string
}

export type SecurityEventDetails = Readonly<Record<string, string | number | boolean>>

export interface SecurityEventInput {
  readonly event: SecurityEventName
  readonly actor: SecurityEventActor | null
  readonly details?: SecurityEventDetails
}

export interface SecurityEventRecord {
  readonly event: SecurityEventName
  /** Identifiant de l'acteur, ou `anonymous` : un journal sans acteur ne sert à rien. */
  readonly actor: string
  readonly details: SecurityEventDetails
}

/** Noms de clé dont la valeur ne doit jamais sortir, quelle que soit sa forme. */
const SECRET_KEY_PATTERN = /token|password|secret|cookie|hash|authorization|credential/i

/**
 * Une valeur assez longue et assez « opaque » pour être un secret.
 *
 * Seize caractères de l'alphabet des jetons : c'est ce qui attrape un jeton
 * collé dans une URL, cas qu'aucune liste de noms de clés ne couvre.
 */
const SECRET_VALUE_PATTERN = /[A-Za-z0-9_\-+/=.]{16,}/

const REDACTED = '[filtré]'

const isSecret = (key: string, value: string | number | boolean): boolean =>
  SECRET_KEY_PATTERN.test(key) ||
  (typeof value === 'string' && SECRET_VALUE_PATTERN.test(value))

/** Rend l'enregistrement journalisable d'un événement de sécurité. */
export function describeSecurityEvent(input: SecurityEventInput): SecurityEventRecord {
  const details: Record<string, string | number | boolean> = {}

  for (const [key, value] of Object.entries(input.details ?? {})) {
    details[key] = isSecret(key, value) ? REDACTED : value
  }

  return {
    event: input.event,
    // L'adresse email n'est pas journalisée : elle identifie une personne, et
    // le journal de sécurité désigne un compte.
    actor: input.actor?.userId ?? 'anonymous',
    details,
  }
}
