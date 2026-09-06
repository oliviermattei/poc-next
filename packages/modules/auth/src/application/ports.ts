import type {
  BuildDataExportArchiveOutcome,
  ModuleScope,
  PurgeModulesOutcome,
} from '@repo/core'
import type { Analytics, Jobs, Mailer, SendEmailResult } from '@repo/ports'

import type { AuthPolicy } from '../domain/auth-policy'
import type { StoredPasskey } from '../domain/passkey'
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
  /**
   * Le compte est-il protégé par un second facteur **confirmé** (s13) ?
   *
   * C'est la bibliothèque qui bascule ce champ, à la confirmation du premier
   * code et à la désactivation. Le module ne l'écrit jamais : il le lit, pour
   * que l'écran de compte sache quelle forme prendre.
   */
  readonly twoFactorEnabled: boolean
  /**
   * Le compte est-il banni (s37a) ?
   *
   * Il est **lu ici** et pas seulement en base : le refus de connexion est une
   * règle du socle, et la règle a besoin de l'état, pas d'une requête.
   */
  readonly banned: boolean
}

/**
 * **Ce qu'une liste d'administration montre d'un compte** (s37b2).
 *
 * Distinct d'`AuthUserRecord` parce qu'il porte ce que le socle n'a jamais eu
 * besoin de lire sur le chemin d'une session — la date d'inscription — et qu'il
 * ne porte pas ce dont un écran n'a que faire. Le **jeton n'y est pas**, et il
 * n'y a rien de plus à dire : ce type est la liste de ce qui sort.
 */
export interface AuthAccountSummary {
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly emailVerified: boolean
  readonly banned: boolean
  readonly createdAt: Date
}

export interface AuthUserRepository {
  findByEmail(email: string): Promise<AuthUserRecord | null>
  findById(userId: string): Promise<AuthUserRecord | null>
  /**
   * **Le seul état lu sur le chemin de la création de session** (s37a).
   *
   * Distinct de `findById` parce qu'il est appelé à chaque ouverture de
   * session, sur tous les parcours : il ne rend qu'une colonne, et il rend
   * `true` pour un compte introuvable — un compte qu'on ne trouve pas
   * n'ouvre pas de session, c'est le sens fermé.
   */
  isBanned(userId: string): Promise<boolean>
  /**
   * Écrit l'état de bannissement. Rend `false` si aucun compte ne correspond.
   *
   * `bannedAt` et le motif sont **effacés** au débannissement : les garder
   * ferait d'un compte rendu à son propriétaire un compte qui porte encore la
   * marque de sa sanction.
   */
  setBanned(input: {
    readonly userId: string
    readonly banned: boolean
    readonly at: Date
    readonly reason: string | null
  }): Promise<boolean>
  /**
   * Les comptes de plusieurs identifiants, **en une seule lecture**.
   *
   * Elle existe pour que l'affichage d'une page qui nomme N comptes ne fasse pas
   * N requêtes (revue s32, ronde 3, R3-3). Les identifiants absents ne sont pas
   * dans la réponse : c'est ce qui distingue un compte effacé d'un compte lu.
   */
  findByIds(userIds: readonly string[]): Promise<readonly AuthUserRecord[]>
  /**
   * **Les comptes de la plateforme, une page à la fois** (s37b2).
   *
   * Elle existe pour le back-office, et pour lui seul : c'est la seule lecture
   * du module qui parcoure les comptes au lieu d'en désigner un. Le module
   * `admin` ne l'atteint que par son port (`AdminAccountsPort.listAccounts`), et
   * la recherche est une **valeur paramétrée**, jamais interpolée.
   *
   * `total` est le nombre de comptes qui correspondent, pas la taille de la
   * page : sans lui, la pagination ne saurait pas combien de pages elle a.
   */
  search(input: {
    readonly search: string | null
    readonly limit: number
    readonly offset: number
  }): Promise<{ readonly accounts: readonly AuthAccountSummary[]; readonly total: number }>
  /**
   * Le même résumé, **pour un seul compte** : ce que le détail du back-office
   * affiche. `null` quand le compte n'existe pas — le back-office rend alors
   * 404, comme pour n'importe quelle ressource inconnue.
   */
  summaryOf(userId: string): Promise<AuthAccountSummary | null>
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
  /**
   * Révoque **toutes les sessions du compte, et tous les emprunts qu'il tient**
   * (s37b1, revue C3). Rend les lignes effacées : les emprunts qui s'y trouvent
   * sont des fins que quelqu'un doit journaliser.
   */
  revokeAllForUser(userId: string): Promise<readonly BorrowedSession[]>
  /** Éteint les seuls emprunts tenus par ce compte, sans toucher à ses sessions. */
  revokeBorrowsBy(userId: string): Promise<readonly BorrowedSession[]>
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
  /**
   * **Ouvre une session** (s37b1), pour l'impersonation et elle seule à ce jour.
   *
   * Toutes les autres sessions du produit sont créées par la bibliothèque : ce
   * chemin-ci existe parce qu'aucune de ses routes n'ouvre une session **au nom
   * d'un autre compte** sans justificatif. La ligne est écrite ici, avec son
   * emprunteur ; le cookie est signé dans `infrastructure/`, avec le nom et les
   * attributs que la bibliothèque impose.
   *
   * **Rend `false` pour un compte inconnu comme pour un compte banni**, et le
   * refus est dans l'`insert` : c'est, pour ce chemin, la garde que
   * `databaseHooks.session.create.before` tient pour ceux de la bibliothèque
   * (`docs/security.md` §2). Le refus ne distingue pas les deux cas.
   */
  create(input: {
    readonly id: string
    readonly token: string
    readonly userId: string
    readonly impersonatedBy: string | null
    readonly expiresAt: Date
    readonly at: Date
  }): Promise<boolean>
  /**
   * Ce qu'on sait d'une session par son identifiant : **qui l'emprunte**.
   *
   * `null` quand elle n'existe pas. C'est la lecture qui permet au back-office
   * de refuser une session empruntée sans jamais lire une table hors de ce
   * module.
   */
  findById(sessionId: string): Promise<BorrowedSession | null>
  /** Efface une session par son identifiant. Rend `false` si elle n'existait plus. */
  deleteById(sessionId: string): Promise<boolean>
  /**
   * **Efface les sessions empruntées échues, et dit lesquelles** (s37b1).
   *
   * L'effacement est ce qui rend le balayage rejouable sans effet
   * supplémentaire (`docs/reliability.md` §1) : la seconde exécution ne trouve
   * plus rien, donc n'émet plus rien. Une session expirée qu'on laisserait en
   * place ferait réémettre son événement de fin à chaque passage.
   */
  deleteExpiredImpersonations(at: Date): Promise<readonly BorrowedSession[]>
}

/** Une session empruntée, telle que le magasin la connaît. Aucun jeton n'en sort. */
export interface BorrowedSession {
  readonly id: string
  readonly userId: string
  /** Le superadmin qui emprunte, ou `null` : la session est alors ordinaire. */
  readonly impersonatedBy: string | null
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

/** Ce que rend une révocation de passkey. Trois issues, et l'appelant les traduit. */
export type PasskeyRevocationOutcome = 'revoked' | 'not_found' | 'last-method'

/**
 * Les passkeys d'un compte (s14).
 *
 * Le module possède **la lecture, le renommage et la révocation** ; le greffon
 * garde l'enrôlement et la vérification, qui sont de la cryptographie. Les
 * trois points d'entrée que le greffon offre pour ces opérations ne sont pas
 * déclarés, et chacun a sa raison (`packages/modules/auth/AGENTS.md`) : le
 * premier rend la ligne entière, le deuxième compte puis supprime hors
 * transaction, le troisième distingue « inconnue » de « pas à vous ».
 */
export interface AuthPasskeyRepository {
  /** Les passkeys du compte, **sans clé publique ni identifiant de justificatif**. */
  listForUser(userId: string): Promise<readonly StoredPasskey[]>
  /** Combien ce compte en a. Employé par la règle du dernier moyen de connexion. */
  countForUser(userId: string): Promise<number>
  /**
   * Renomme **une** passkey, à condition qu'elle appartienne à ce compte.
   *
   * Le propriétaire est dans la condition, jamais vérifié avant : l'appelant ne
   * peut pas distinguer « pas à vous » de « n'existe pas ».
   */
  renameForUser(input: {
    readonly userId: string
    readonly passkeyId: string
    readonly name: string
  }): Promise<boolean>
  /**
   * Révoque **une** passkey, à condition qu'elle appartienne à ce compte et
   * qu'il reste un moyen de connexion après elle.
   *
   * Les deux conditions sont tenues **dans la même transaction, sur les lignes
   * verrouillées des deux tables** — passkeys et comptes. Compter puis
   * supprimer laisserait deux retraits simultanés observer « il en reste
   * deux » et retirer chacun le sien (`docs/reliability.md` §1).
   */
  revokeForUser(input: {
    readonly userId: string
    readonly passkeyId: string
  }): Promise<PasskeyRevocationOutcome>
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
  /**
   * **Efface les jetons qui nomment ce compte** (s34).
   *
   * Elle existe parce que `auth_verification` **ne porte aucune clé étrangère
   * vers le compte** : ses lignes sont désignées par une adresse, ou par
   * « identifiant espace adresse visée » pour un changement d'email en attente.
   * La cascade qui emporte sessions et moyens de connexion ne les touche donc
   * pas, et un jeton de vérification survivait à la suppression du compte en
   * portant son adresse — mesuré par le balayage de s34, pas déduit.
   *
   * **Le prédicat est ancré, sans aucun joker**, et la seconde revue explique
   * pourquoi : une correspondance par sous-chaîne déborde de sa cible sur une
   * table partagée par tous les comptes. Échapper `_` et `%` fermait la classe
   * des jokers, pas celle des adresses qui en contiennent une autre — `a@b.co`
   * emportait les jetons de `a@b.com`, deux adresses ordinaires et distinctes.
   *
   * Les valeurs à atteindre sont **connues et fermées** : l'adresse exacte, ou
   * `<identifiant> <adresse visée>`. Le prédicat les nomme donc exactement, et
   * le seul motif restant est ancré sur l'identifiant suivi d'une espace — ce
   * qu'aucune autre valeur de la table ne peut porter.
   */
  deleteNaming(subject: {
    readonly userId: string
    readonly email: string
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

/**
 * Le second facteur d'un compte, **tel que la garde de rejeu en a besoin**.
 *
 * Le secret sort d'ici **chiffré** : le déchiffrer demande la clé de
 * l'application, qui n'appartient qu'à `infrastructure/`. Ce port ne sait donc
 * pas ce qu'est un code TOTP — il sait lire une ligne et prendre un pas.
 */
export interface StoredTwoFactor {
  readonly secret: string
  readonly lastTotpStep: number | null
}

export interface TwoFactorRepository {
  findByUserId(userId: string): Promise<StoredTwoFactor | null>
  /**
   * Prend le pas `step` pour ce compte, **à condition** qu'aucun pas supérieur
   * ou égal n'ait déjà été pris. Rend `false` quand la condition tombe : le
   * code a déjà servi.
   *
   * La condition est dans la requête, jamais vérifiée avant : deux
   * vérifications concurrentes du même code se départagent ici
   * (`docs/reliability.md` §1).
   */
  claimTotpStep(input: { readonly userId: string; readonly step: number }): Promise<boolean>
}

/** Journal des événements de sécurité (§7). Reçoit un enregistrement déjà filtré. */
export type SecurityLog = (record: SecurityEventRecord) => void

/**
 * **Les demandes d'export de données** (s35), du côté des cas d'usage.
 *
 * Le module ne sait pas construire une archive : elle traverse **tous** les
 * modules activés, et seul le registre sait lesquels le sont. Le port
 * `collectArchive` est ce qu'on lui donne — la même inversion que
 * `readableScopes` pour `storage` ou `emailOfScope` pour `marketing`.
 */
export type DataExportStatus = 'pending' | 'ready' | 'failed'

export interface DataExportRequestRecord {
  readonly id: string
  readonly scope: ModuleScope
  readonly requestedBy: string
  readonly status: DataExportStatus
  readonly requestedAt: Date
}

/** Une demande telle que le magasin la rend, l'archive comprise. */
export interface StoredDataExportRequest extends DataExportRequestRecord {
  readonly completedAt: Date | null
  /** L'échéance du lien, **décidée par le serveur**. `null` tant qu'il n'y en a pas. */
  readonly expiresAt: Date | null
  /** L'empreinte du jeton, jamais le jeton (`docs/security.md` §2). */
  readonly tokenDigest: string | null
  readonly archive: unknown
  readonly failedModuleId: string | null
}

/** Ce que l'export du contrat rend d'une demande : sa trace, jamais son archive. */
export interface DataExportTrace {
  readonly requestedAt: string
  readonly status: string
  readonly expiresAt: string | null
}

export interface DataExportRepository {
  /**
   * Revendique une demande pour ce périmètre, ou refuse parce qu'il y en a une.
   *
   * La condition est tenue **dans la transaction, sous verrou** : une lecture
   * suivie d'une écriture laisserait deux demandes en vol se voir chacune
   * seule (`docs/reliability.md` §1).
   */
  claim(input: {
    readonly id: string
    readonly scope: ModuleScope
    readonly requestedBy: string
    readonly at: Date
  }): Promise<'claimed' | 'already-pending'>
  findById(id: string): Promise<StoredDataExportRequest | null>
  /** Range l'archive et l'échéance. Sans effet si la demande n'est plus en cours. */
  markReady(input: {
    readonly id: string
    readonly tokenDigest: string
    readonly expiresAt: Date
    readonly archive: unknown
    readonly at: Date
  }): Promise<void>
  /**
   * Clôt une demande en échec. Sans effet si elle n'est plus en cours.
   *
   * `moduleId` nomme le module qui a refusé, ou vaut `null` quand l'échec n'est
   * celui d'aucun module — la mise en file refusée, par exemple. Dans les deux
   * cas la demande cesse d'être en cours, donc le périmètre redevient
   * demandable : un échec ne bloque pas la personne.
   */
  markFailed(input: {
    readonly id: string
    readonly moduleId: string | null
    readonly at: Date
  }): Promise<void>
  /**
   * Les demandes encore en cours **réclamées avant `before`**.
   *
   * La borne n'est pas un confort : sans elle, le balayage reprend une demande
   * que le fournisseur est peut-être en train d'exécuter, et les deux clés
   * d'idempotence diffèrent — l'archive est construite deux fois et deux emails
   * partent.
   */
  listPending(before: Date): Promise<readonly StoredDataExportRequest[]>
  listForScope(scope: ModuleScope): Promise<readonly DataExportTrace[]>
  /** Efface les archives dont l'échéance est passée. Rend combien. */
  forgetExpiredArchives(at: Date): Promise<number>
  /** Efface les demandes du périmètre — appelée par la purge du contrat. */
  deleteScope(scope: ModuleScope): Promise<void>
}

/**
 * **La signature du lien**, et rien d'autre.
 *
 * Le `domain` ne connaît aucune primitive (`packages/modules/auth/AGENTS.md`) :
 * le HMAC vit dans `infrastructure/`, la **forme** du jeton et la décision
 * d'échéance vivent dans `domain/data-export.ts`.
 */
export interface DataExportTokenSigner {
  /** Le jeton remis, qui porte l'identifiant de la demande et sa signature. */
  issue(requestId: string): string
  /** L'identifiant de la demande si la signature tient, `null` sinon. */
  verify(token: string): string | null
  /** L'empreinte stockée : un vol de ces lignes ne rend aucun lien utilisable. */
  digest(token: string): string
}

export interface AuthDependencies {
  readonly users: AuthUserRepository
  readonly sessions: AuthSessionRepository
  readonly accounts: AuthAccountRepository
  readonly passkeys: AuthPasskeyRepository
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
  /**
   * **L'effacement de tous les modules activés** (s34).
   *
   * Le module ne connaît pas le registre — il ne peut pas : `@repo/core`
   * construit le registre à partir des modules, et un module qui le lirait
   * fermerait le cycle. Il reçoit donc la fonction, exactement comme il reçoit
   * son mailer, et le point de composition de l'application la branche sur
   * `purgeModules`.
   */
  readonly purgeScope: (scope: ModuleScope) => Promise<PurgeModulesOutcome>
  /**
   * **Les organisations dont ce compte est le dernier propriétaire** (critère
   * 6), nommées.
   *
   * Reçue pour la même raison que `purgeScope`, et avec la même conséquence
   * quand le module d'organisations est coupé : la liste est vide, il n'y a
   * rien à bloquer — par la valeur, jamais par une condition sur un nom de
   * module.
   */
  readonly soleOwnerships: (userId: string) => Promise<readonly string[]>
  /**
   * **La revendication atomique du départ** (s34, constat F1 de la troisième
   * revue) : retire le compte de ses organisations, ou refuse en les nommant.
   *
   * Distincte de `soleOwnerships`, qui **lit** et qui sert le refus à la
   * demande. Celle-ci est appelée au moment d'effacer, et c'est la différence
   * qui compte : deux lectures concurrentes se voient l'une l'autre et laissent
   * passer les deux départs, après quoi le refus arrive **à l'intérieur** de la
   * purge — trop tard, les modules purgés plus tôt dans l'ordre inverse ont
   * déjà effacé les fichiers du perdant. Une revendication, elle, sérialise :
   * le second appelant se découvre dernier propriétaire et refuse avant
   * d'effacer quoi que ce soit.
   */
  readonly releaseOrganizations: (userId: string) => Promise<readonly string[]>
  /**
   * **Les rôles de plateforme d'un compte** (s56) — la quatrième fonction de
   * cette famille, et elle arrive pour la raison des trois autres.
   *
   * Les rôles vivent dans la table du module `admin`, qui déclare `auth` dans
   * ses `requires` : ce module-ci ne peut pas les lire sans fermer le cycle. Il
   * reçoit donc la fonction, exactement comme il reçoit son mailer, et le point
   * de composition de l'application la branche.
   *
   * **Module `admin` coupé : la liste est vide — par la valeur, jamais par une
   * condition sur un nom de module.** Et c'est le sens fermé : aucun rôle ne se
   * porte, donc aucune route réservée à un rôle ne s'ouvre.
   *
   * Elle est appelée à **chaque** résolution de session qui aboutit, et jamais
   * mise en cache dans le jeton : un rôle retiré doit cesser d'ouvrir sa route
   * sans nouvelle connexion (`docs/security.md` §2, révocation côté serveur).
   * Ce que cela coûte est décidé plus haut : le point de composition ne branche
   * la lecture que si un module activé déclare une protection `role`.
   */
  readonly platformRolesOf: (userId: string) => Promise<readonly string[]>
  /**
   * **Le port d'émission de tâches** (s33) : le seul chemin par lequel
   * l'effacement quitte la requête.
   *
   * Il est injecté et non construit : module `jobs` activé, l'émission part
   * chez le fournisseur ; module coupé, le port l'exécute de façon synchrone
   * dans la requête appelante. Le module d'authentification ne connaît pas la
   * différence, et c'est le critère 9.
   */
  readonly jobs: Jobs
  /**
   * **Le port d'analytique** (s39) : le seul chemin par lequel ce module mesure.
   *
   * Il est injecté et non construit, pour la raison qui vaut aussi pour `jobs` —
   * `auth` est du socle, `analytics` est optionnel, et importer l'un depuis
   * l'autre inverserait la dépendance. Aucune clé configurée, ou module coupé :
   * le port est inerte et n'émet **aucun appel réseau**, sans que ce module
   * connaisse la différence.
   */
  readonly analytics: Analytics
  /**
   * **Ce que le module ne peut pas se procurer** pour l'export (s35).
   *
   * Absent, les routes d'export répondent 404 : elles ne sont pas montées à
   * moitié. Le point de composition de l'application est le seul à posséder le
   * registre, donc le seul à pouvoir construire une archive.
   */
  readonly dataExport?: DataExportDependencies
}

/** Ce dont l'export a besoin, et que le module ne possède pas. */
export interface DataExportDependencies {
  readonly requests: DataExportRepository
  readonly signer: DataExportTokenSigner
  /** L'archive de **tous** les modules activés, construite par le registre. */
  readonly collectArchive: (scope: ModuleScope) => Promise<BuildDataExportArchiveOutcome>
  /**
   * **Qui a le droit de demander l'export d'une organisation.**
   *
   * `auth` ne connaît ni `organizations`, ni ses rôles, et n'a pas le droit de
   * lire ses tables : la décision lui est **donnée**, comme `readableScopes`
   * l'est à `storage`. Trois réponses, et la distinction porte le socle §3 :
   *
   * - `unknown` — l'appelant n'est pas membre, ou l'organisation n'existe pas,
   *   ou le module est coupé : **404**, l'existence de la ressource d'autrui ne
   *   se confirme pas ;
   * - `refused` — membre, mais la matrice de rôles le lui refuse : **403**, il
   *   sait déjà que l'organisation existe ;
   * - `allowed` — la demande passe.
   *
   * Aucun rôle ne traverse cette frontière : la matrice rôle × action s'écrit
   * une fois, dans le module qui possède les rôles.
   */
  readonly authorizeOrganization: (input: {
    readonly userId: string
    readonly organizationId: string
  }) => Promise<'allowed' | 'refused' | 'unknown'>
  /**
   * L'identifiant d'une demande. **Reçu**, parce que le hasard appartient à
   * `infrastructure/` : la couche application ne connaît pas `node:crypto`
   * (ADR 006).
   */
  readonly generateId: () => string
}

export type { Jobs, Mailer, SendEmailResult }
