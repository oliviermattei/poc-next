/**
 * Le port `Storage` — la deuxième dépendance externe du dépôt à passer derrière
 * une interface (ADR 008), et **le premier héritier du gabarit posé par
 * `mailer.ts`**.
 *
 * Les quatre choix de forme du gabarit sont repris tels quels, et ils ne sont
 * pas redémontrés ici : un fichier par capacité dans un seul package de ports,
 * un résultat discriminé plutôt qu'une exception, les collaborateurs injectés,
 * la forme du journal fermée. Ce qui suit dit seulement ce que ce port-ci
 * ajoute.
 *
 * **Quatre opérations, et aucune n'est là par commodité.** Le critère 1 de la
 * story en fixe trois — « l'obtention d'une URL présignée, la lecture et la
 * suppression » —, et l'ADR 033 en a ajouté une quatrième, `write`. L'en-tête
 * d'origine mettait en garde contre elle — « il n'y en aura pas de quatrième
 * par commodité : un port grossit par ajout de cas particuliers dont aucun
 * n'est demandé » — et portait sa clause de sortie : « le jour où l'un l'est,
 * **toutes** les implémentations doivent le porter ». Elle l'est, et les deux
 * implémentations la portent. La garde, elle, n'est pas levée : la cinquième
 * opération se justifiera comme celle-ci, ou n'existera pas.
 *
 * **Pourquoi `write` n'est pas une commodité.** À la confirmation d'un
 * téléversement, l'application promeut les octets **qu'elle vient de vérifier**
 * vers une clé qu'aucune URL présignée ne nomme. Demander cette promotion au
 * fournisseur — une copie d'objet à objet, la cinquième opération qu'on aurait
 * pu ajouter à la place — rouvrirait exactement la fenêtre que l'ADR 033 ferme :
 * entre la lecture vérifiée et la copie, un rejeu de l'URL présignée remplace la
 * source, et la copie promeut alors des octets que personne n'a regardés. La
 * seule promotion qui ne dépende d'aucune garantie du fournisseur écrit les
 * octets déjà en mémoire. Sans elle, le contrôle de contenu ne survit pas à la
 * confirmation.
 *
 * Ce que `write` n'est pas non plus : la voie d'un téléversement. Les octets
 * d'un fichier reçu du navigateur ne traversent toujours pas l'application
 * (critère 2, ADR 032) — ceux-là sont déjà les nôtres, plafonnés à deux
 * mébioctets, et lus une ligne plus haut.
 *
 * **Ce que ce port ne fait pas, et c'est structurant** : il ne présigne pas de
 * lecture. L'avatar est servi par l'application (ADR 032), pour deux raisons
 * mesurées — `img-src 'self'` refuserait une image venue du domaine du seau, et
 * une URL présignée de lecture est une capacité détachée de l'appartenance,
 * donc incapable de tenir « un fichier d'organisation n'est lisible que par ses
 * membres » à chaque requête.
 */

/**
 * Ce que le code métier demande pour téléverser : où, quel type, quelle taille.
 *
 * `contentType` et `contentLength` ne sont pas décoratifs : l'implémentation
 * les **lie à la signature**, si bien que l'URL ne vaut pas pour un autre type
 * ni pour une autre taille. C'est ce qui répond à « l'URL signée ne doit pas
 * permettre d'écrire ailleurs que là où elle prétend » — la clé, elle, est déjà
 * dans le chemin signé.
 *
 * Ce que ces deux champs **ne prouvent pas** : que les octets envoyés soient
 * réellement du type annoncé. Aucune signature ne lie un en-tête à un contenu.
 * La vérification du contenu réel appartient à l'appelant, après téléversement,
 * par `read` — c'est le piège que la story nomme, et le port ne peut pas le
 * fermer à sa place.
 */
export interface PresignUploadInput {
  /** Clé d'objet. Construite par l'appelant ; l'implémentation ne l'invente pas. */
  readonly key: string
  readonly contentType: string
  readonly contentLength: number
  /** Durée de validité de l'URL, en secondes. Aucune valeur par défaut : elle se décide. */
  readonly expiresInSeconds: number
}

/**
 * L'URL présignée, et **la requête exacte** qu'elle autorise.
 *
 * `headers` est rendu parce que l'appelant ne peut pas le deviner : la
 * signature couvre `content-type` et `content-length`, donc un téléversement
 * qui ne les repose pas à l'identique est refusé par le fournisseur. Les rendre
 * ici évite que chaque appelant reconstruise ce que l'implémentation a signé —
 * et qu'il se trompe.
 *
 * `expiresAt` est rendu pour que l'appelant puisse dire à l'utilisateur que sa
 * fenêtre s'est fermée, sans relire l'URL.
 */
export interface PresignedUpload {
  readonly url: string
  readonly method: 'PUT'
  readonly headers: Readonly<Record<string, string>>
  readonly expiresAt: Date
}

/** Un objet lu : ses octets, et le type sous lequel il a été stocké. */
export interface StoredObject {
  readonly bytes: Uint8Array
  /** Le type déclaré **au stockage**. Il ne prouve rien du contenu : le contenu, on le regarde. */
  readonly contentType: string | null
}

/**
 * Pourquoi une opération a échoué — et, indissociablement, **s'il faut la
 * rejouer**.
 *
 * Même règle que `MailerErrorCode` : `docs/reliability.md` §3 interdit de
 * rejouer une erreur de validation, donc un code de plus oblige à dire de quel
 * côté il tombe. C'est `isTransientStorageError`, chez chaque implémentation,
 * qui lit cette partition.
 */
export type StorageErrorCode =
  /** Requête refusée par le fournisseur (clé invalide, en-tête incohérent). Définitif. */
  | 'invalid_request'
  /** Identifiants absents, révoqués ou sans droit sur le seau. Définitif. */
  | 'unauthorized'
  /** L'objet n'existe pas. Définitif — et ce n'est pas une panne. */
  | 'not_found'
  /** Quota ou limitation du fournisseur. Transitoire. */
  | 'rate_limited'
  /** Fournisseur en panne ou injoignable. Transitoire. */
  | 'provider_unavailable'
  /** Délai d'attente dépassé (`docs/reliability.md` §3). Transitoire. */
  | 'timeout'

/**
 * L'échec, tel que l'appelant le reçoit.
 *
 * `message` est destiné à l'humain qui lit un journal : il est **assaini** par
 * l'implémentation (`docs/security.md` §5). Ni identifiant de clé d'accès, ni
 * URL signée, ni octet de contenu ne doivent pouvoir y transiter, y compris
 * quand c'est le fournisseur qui les a mis dans son propre message.
 */
export interface StorageError {
  readonly code: StorageErrorCode
  readonly message: string
  /** Nombre de tentatives réellement faites, reprises comprises. */
  readonly attempts: number
}

export type PresignUploadResult =
  | { readonly ok: true; readonly upload: PresignedUpload }
  | { readonly ok: false; readonly error: StorageError }

export type ReadObjectResult =
  | { readonly ok: true; readonly object: StoredObject }
  | { readonly ok: false; readonly error: StorageError }

/**
 * Ce que l'application écrit **elle-même** dans le stockage, par opposition à
 * ce que le navigateur y dépose par URL présignée.
 *
 * La quatrième opération, celle dont l'en-tête de ce fichier dit pourquoi elle
 * n'est pas une commodité. La raison est mesurée : une URL présignée reste
 * valable jusqu'à son échéance, et rien ne la révoque. Sans écriture par le serveur, l'objet vérifié à la confirmation
 * est exactement celui qu'une URL présignée rejouée peut réécrire.
 *
 * L'appelant écrit donc les octets **qu'il vient de valider**, vers une clé que
 * nulle URL présignée ne nomme. Les octets transitent par l'application : sur
 * un avatar plafonné à deux mébioctets, qu'elle a déjà lu pour le vérifier,
 * c'est le prix de la garantie.
 */
export interface WriteObjectInput {
  readonly key: string
  readonly bytes: Uint8Array
  readonly contentType: string
}

export type WriteObjectResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: StorageError }

/**
 * Le résultat d'une suppression.
 *
 * `ok: true` couvre « supprimé » **et** « n'existait pas », et c'est délibéré :
 * `docs/reliability.md` §1 exige qu'une opération rejouée ne produise aucun
 * effet supplémentaire. Distinguer les deux ferait échouer la seconde purge
 * d'un même périmètre, alors que l'état voulu est atteint dans les deux cas.
 */
export type RemoveObjectResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: StorageError }

/**
 * La seule surface que le code métier appelle pour parler au stockage.
 *
 * Aucune de ces méthodes ne lève, quoi qu'il arrive au fournisseur — c'est le
 * corollaire opposable du gabarit, et il est prouvé chez chaque implémentation,
 * y compris au cas où le SDK lui-même lèverait.
 */
export interface Storage {
  presignUpload(input: PresignUploadInput): Promise<PresignUploadResult>
  read(key: string): Promise<ReadObjectResult>
  write(input: WriteObjectInput): Promise<WriteObjectResult>
  remove(key: string): Promise<RemoveObjectResult>
}

/**
 * Ce qu'une implémentation a le droit de journaliser d'un échec.
 *
 * La forme est fermée, et c'est la première ligne de défense de
 * `docs/security.md` §5 : il n'y a **aucun champ** où mettre la clé d'objet, un
 * octet de contenu, une URL signée ou un identifiant d'accès. Une clé d'objet
 * porte l'identifiant du compte ou de l'organisation propriétaire — c'est une
 * donnée personnelle, et elle n'a pas sa place dans un journal.
 *
 * `operation` est un verbe fermé : il dit ce qui a échoué sans dire sur quoi.
 */
export interface StorageLogRecord {
  readonly event: 'storage.operation_failed' | 'storage.operation_retried'
  readonly operation: 'presign' | 'read' | 'write' | 'remove'
  readonly code: StorageErrorCode
  readonly attempts: number
  readonly message: string
}

/**
 * Le journal, injecté. Une fonction plutôt qu'une interface, pour la même
 * raison que `MailerLogger` : ce port n'a besoin que d'écrire.
 */
export type StorageLogger = (record: StorageLogRecord) => void
