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
  // s12 : le retrait d'un moyen de connexion, et son refus. Le second couvre
  // les deux issues que l'appelant ne distingue pas dans le détail — un moyen
  // qui n'est pas le sien, et le dernier moyen du compte.
  | 'auth.provider_unlinked'
  | 'auth.provider_unlink_refused'
  // s12 : un parcours par fournisseur **refusé**, au départ comme au retour —
  // fournisseur qu'on ne sert pas, autorisation refusée par la personne, ou
  // échec replié sur la classe générique.
  //
  // Un nom à lui, et non `auth.sign_in_failed`, parce qu'un retour refusé
  // journalise déjà l'échec de connexion au rappel : les compter tous les deux
  // doublerait chaque occurrence, et le verrouillage progressif de s28
  // compterait deux fois le même retour.
  | 'auth.oauth_refused'
  // s13 : le second facteur. `docs/security.md` §7 demande nommément le
  // « changement de second facteur » ; les trois autres couvrent le parcours de
  // vérification, qui est un point d'entrée public au même titre que la
  // connexion.
  //
  // `auth.two_factor_challenged` a un nom à lui, et pas `auth.sign_in_succeeded` :
  // le mot de passe est bon, mais **aucune session n'existe** — la bibliothèque
  // détruit celle qu'elle venait de créer. Le compter comme une connexion
  // réussie ferait mentir le journal sur le seul point qui l'intéresse.
  | 'auth.two_factor_enabled'
  | 'auth.two_factor_disabled'
  | 'auth.two_factor_challenged'
  | 'auth.two_factor_verified'
  | 'auth.two_factor_failed'
  | 'auth.two_factor_backup_codes_regenerated'
  // s14 : les passkeys. Une passkey est un **moyen de connexion** ; l'ajouter
  // ou le retirer est de la même nature qu'une liaison de fournisseur, et §7
  // demande de pouvoir compter les deux. Les refus ont leur nom pour la même
  // raison qu'en s12 : la réponse ne distingue rien, le journal si.
  //
  // La **connexion** par passkey, elle, n'a pas de nom à elle : c'est
  // `auth.sign_in_succeeded` avec `method: 'passkey'`, comme le magic link et
  // les rappels de fournisseur. Un moyen de connexion de plus ne fait pas un
  // événement de plus, sans quoi le verrouillage progressif de s28 devrait
  // apprendre chaque nom.
  | 'auth.passkey_registered'
  | 'auth.passkey_registration_refused'
  | 'auth.passkey_renamed'
  | 'auth.passkey_rename_refused'
  | 'auth.passkey_revoked'
  | 'auth.passkey_revoke_refused'
  // s34 : la suppression de compte. Trois noms, parce que les trois moments
  // n'apprennent pas la même chose — une demande enregistrée, un effacement
  // abouti, et un refus (confirmation qui ne correspond pas, dernier
  // propriétaire, ou file indisponible). Le refus a son nom pour la raison de
  // s12 et de s14 : la réponse ne distingue pas tout, le journal si.
  | 'auth.account_deletion_requested'
  | 'auth.account_deletion_refused'
  | 'auth.account_deleted'

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

/**
 * Noms de clé dont la valeur ne doit jamais sortir, quelle que soit sa forme.
 *
 * `code` y est entré avec s13, et pour une raison précise : un code TOTP fait
 * six chiffres, un code de secours onze caractères — les deux passent **sous**
 * le seuil de seize caractères du motif de valeur ci-dessous, qui ne peut donc
 * pas les voir. Ici, seul le nom de clé attrape.
 */
const SECRET_KEY_PATTERN = /token|password|secret|cookie|hash|authorization|credential|code/i

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
