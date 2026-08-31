import type { Mailer, SendEmailResult } from '@repo/ports'

import type { AuthPolicy } from '../domain/auth-policy'
import type { SecurityEventRecord } from '../domain/security-event'
import type { StoredSession } from '../domain/session'

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
  readonly name: string
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
  /** Remplace le nom affiché. Rend `false` si aucun compte ne correspond. */
  changeName(userId: string, name: string): Promise<boolean>
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
  /**
   * Les sessions du compte, **sans leur jeton** : ce que le magasin en dit se
   * limite à ce qu'un écran a le droit d'afficher.
   */
  listForUser(userId: string): Promise<readonly StoredSession[]>
  /** Révoque toutes les sessions du compte. Rend le nombre de sessions supprimées. */
  revokeAllForUser(userId: string): Promise<number>
  /**
   * Révoque **une** session, à condition qu'elle appartienne à ce compte.
   *
   * Le compte fait partie de la condition, il n'est pas vérifié avant :
   * l'autorisation est dans la requête elle-même. Une vérification préalable
   * suivie d'une suppression laisserait la fenêtre où l'on supprime la session
   * d'autrui (`docs/security.md` §3). Rend `false` quand rien ne correspond —
   * l'appelant ne peut donc pas distinguer « pas à vous » de « n'existe pas ».
   */
  revokeForUser(input: {
    readonly userId: string
    readonly sessionId: string
  }): Promise<boolean>
}

/**
 * Un **moyen de connexion** d'un compte, tel que la base le garde.
 *
 * La bibliothèque range l'empreinte du mot de passe et les comptes de
 * fournisseur dans la même table, sous des `providerId` différents
 * (`credential`, `github`…). Ce type est ce qui en **sort** : ni jeton d'accès,
 * ni jeton de rafraîchissement, ni empreinte — les colonnes sont énumérées dans
 * le repository, comme pour les sessions.
 */
export interface SignInMethodRecord {
  readonly id: string
  readonly providerId: string
  readonly createdAt: Date
}

/** Ce que rend un déliement. Trois issues, et l'appelant les traduit. */
export type UnlinkOutcome = 'unlinked' | 'not_found' | 'last-method'

export interface AuthAccountRepository {
  listForUser(userId: string): Promise<readonly SignInMethodRecord[]>
  /**
   * Retire un moyen de connexion, **à condition** qu'il appartienne à ce compte
   * et qu'il en reste un autre.
   *
   * Les deux conditions sont tenues **dans la même transaction, sur des lignes
   * verrouillées** : compter puis supprimer — ce que fait la bibliothèque —
   * laisse deux déliements simultanés observer « il en reste deux » et retirer
   * chacun le sien (`docs/reliability.md` §1 : « jamais une simple vérification
   * préalable »). Le propriétaire est dans la condition, jamais vérifié avant :
   * l'appelant ne peut pas distinguer « pas à vous » de « n'existe pas ».
   */
  unlinkForUser(input: {
    readonly userId: string
    readonly accountId: string
  }): Promise<UnlinkOutcome>
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
  readonly accounts: AuthAccountRepository
  readonly tokens: VerificationTokenRepository
  readonly tokenFactory: TokenFactory
  readonly mailer: Mailer
  readonly log: SecurityLog
  readonly policy: AuthPolicy
  /** URL publique de l'application : ce qui rend les liens d'email absolus. */
  readonly appUrl: string
  /**
   * **La règle unique de langue d'un email**, et elle vaut pour tout email de
   * ce module, présents et futurs.
   *
   * Elle reçoit la langue **connue du destinataire** — celle de la requête
   * qu'il vient de faire — et rend celle dans laquelle l'email part. Un
   * destinataire dont rien n'est connu (invitation, guest checkout, liste
   * d'attente : `null`) reçoit la locale par défaut du site. C'est câblé, pas
   * déduit, et c'est `resolveLocale` de `@repo/core` qui décide — la même
   * fonction que l'écran.
   */
  readonly emailLocaleFor: (knownLocale: string | null | undefined) => string
  readonly now: () => Date
}

export type { Mailer, SendEmailResult }
