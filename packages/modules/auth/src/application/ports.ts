import type { Mailer, SendEmailResult } from '@repo/ports'

import type { AuthPolicy } from '../domain/auth-policy'
import type { SecurityEventRecord } from '../domain/security-event'

/**
 * Les **ports** du module (ADR 006) : ce dont les cas d'usage ont besoin, dit
 * par eux, sans savoir qui l'implémente. `infrastructure/` les branche sur
 * Drizzle, sur Better Auth et sur le port `Mailer` de s06.
 *
 * Aucun de ces ports ne connaît une requête HTTP, un cookie ou une table : ce
 * sont les cas d'usage qui décident, l'infrastructure qui exécute.
 */

/** Ce que le module sait d'un compte, et rien de plus. */
export interface AuthUserRecord {
  readonly id: string
  readonly email: string
  readonly emailVerified: boolean
}

export interface AuthUserRepository {
  findByEmail(email: string): Promise<AuthUserRecord | null>
  findById(userId: string): Promise<AuthUserRecord | null>
  /** Marque l'email vérifié. Rend `false` si aucun compte ne correspond. */
  markEmailVerified(userId: string): Promise<boolean>
  /** Remplace l'email et le marque vérifié. Rend `false` si l'adresse est déjà prise. */
  changeEmail(userId: string, email: string): Promise<boolean>
  /**
   * Efface le compte. Les sessions et les identifiants suivent par cascade :
   * la contrainte de la base est ce qui garantit qu'aucun reste n'échappe à la
   * purge, là où une suppression table par table oublie celle qu'on ajoute
   * ensuite.
   */
  deleteById(userId: string): Promise<boolean>
}

export interface AuthSessionRepository {
  /** Sessions actives d'un compte : c'est la vérification **côté serveur** de la révocation. */
  countForUser(userId: string): Promise<number>
  /** Révoque toutes les sessions du compte. Rend le nombre de sessions supprimées. */
  revokeAllForUser(userId: string): Promise<number>
}

export interface VerificationToken {
  readonly identifier: string
  readonly value: string
  readonly expiresAt: Date
}

/**
 * Le magasin des jetons à usage unique (`docs/security.md` §2).
 *
 * `consume` est **atomique** : deux appels concurrents sur le même identifiant
 * ne peuvent pas réussir tous les deux. Une lecture suivie d'une suppression
 * laisserait une fenêtre pendant laquelle le même lien ouvre deux sessions.
 */
export interface VerificationTokenRepository {
  create(token: VerificationToken): Promise<void>
  consume(identifier: string): Promise<VerificationToken | null>
  /**
   * Invalide les jetons **frères** : même usage, même sujet, autre identifiant.
   * Rend le nombre de jetons invalidés.
   */
  invalidateSiblings(input: {
    readonly prefix: string
    readonly value: string
    readonly exceptIdentifier?: string
  }): Promise<number>
}

/**
 * Fabrique de jetons : la valeur envoyée, et l'empreinte stockée.
 *
 * La propriété porte sur **les jetons de cette fabrique**, pas sur toute la
 * table `auth_verification` : le lien de réinitialisation de mot de passe est
 * émis par la bibliothèque, qui le stocke en clair. La limite est écrite, avec
 * son arbitrage, dans `infrastructure/token-factory.ts`.
 */
export interface TokenFactory {
  /** Un jeton imprévisible. Ce qui part dans l'email, jamais ce qui est stocké. */
  generate(): string
  /** L'empreinte stockée : un vol de ces lignes-là ne rend aucun lien utilisable. */
  digest(token: string): Promise<string>
}

/** Journal des événements de sécurité (§7). Reçoit un enregistrement déjà filtré. */
export type SecurityLog = (record: SecurityEventRecord) => void

export interface AuthDependencies {
  readonly users: AuthUserRepository
  readonly sessions: AuthSessionRepository
  readonly tokens: VerificationTokenRepository
  readonly tokenFactory: TokenFactory
  readonly mailer: Mailer
  readonly log: SecurityLog
  readonly policy: AuthPolicy
  /** URL publique de l'application : ce qui rend les liens d'email absolus. */
  readonly appUrl: string
  /** Locale des emails transactionnels tant que l'i18n (s09) n'existe pas. */
  readonly locale: string
  readonly now: () => Date
}

export type { Mailer, SendEmailResult }
