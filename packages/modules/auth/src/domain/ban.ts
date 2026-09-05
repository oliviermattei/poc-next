import { z } from 'zod'

/**
 * **L'état « banni » d'un compte** (s37a), écrit une fois.
 *
 * Aucun framework, aucun ORM : ce fichier ne connaît qu'un compte et une date.
 * Ce qui décide de bannir vit dans le module `admin` ; ce qui décide de
 * **laisser entrer** vit ici, dans le socle, parce que la connexion ne peut pas
 * dépendre d'un module qui peut être coupé (ADR 058).
 */

/**
 * La longueur maximale d'un motif de bannissement.
 *
 * Elle n'est pas dans `AuthPolicy` — cette politique porte les règles qu'un
 * exploitant peut vouloir durcir (mots de passe, durées de vie), pas les bornes
 * de forme d'un champ de texte, comme `DISPLAY_NAME_MAX_LENGTH`.
 */
export const BAN_REASON_MAX_LENGTH = 500

const reasonSchema = z.string().trim().max(BAN_REASON_MAX_LENGTH).nullable().optional()

/** Le motif validé : une chaîne non vide, `null`, ou un refus. */
export type ParsedBanReason =
  | { readonly ok: true; readonly reason: string | null }
  | { readonly ok: false }

/**
 * Le motif tel qu'il est **stocké** : une chaîne non vide, ou `null`.
 *
 * Deux décisions, et la seconde est celle qui morde :
 *
 * - un motif fait d'espaces n'est pas un motif. Il afficherait une raison vide
 *   dans le back-office, ce qui est pire que pas de raison du tout — on
 *   croirait qu'elle a été écrite ;
 * - un motif trop long est **refusé**, jamais tronqué ni jeté en silence. La
 *   borne est ici, avec la colonne qui le porte : la répéter dans le module
 *   d'administration ferait deux bornes, et la plus permissive écrirait une
 *   valeur que l'autre croit refusée.
 */
export function parseBanReason(input: unknown): ParsedBanReason {
  const parsed = reasonSchema.safeParse(input)

  if (!parsed.success) {
    return { ok: false }
  }

  const value = parsed.data ?? ''

  return { ok: true, reason: value === '' ? null : value }
}

/** Ce que le socle sait d'un compte banni, et rien de plus. */
export interface AccountBan {
  readonly bannedAt: Date
  readonly reason: string | null
}

/**
 * **La décision de laisser entrer.**
 *
 * Un compte banni n'ouvre pas de session — sur aucun chemin : mot de passe,
 * magic link, fournisseur externe ou passkey. Elle est ici, et non dans le
 * gestionnaire de la route de connexion, pour cette raison exacte : une règle
 * écrite à la porte d'un seul parcours laisse les autres ouvertes.
 */
export function refusesSignIn(account: { readonly banned: boolean }): boolean {
  return account.banned
}
