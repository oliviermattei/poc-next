import type { AvatarContentType, FileOwner } from '../domain/avatar'

/**
 * Les **ports** du module (ADR 006) : ce dont les cas d'usage ont besoin, dit
 * par eux, sans savoir qui l'implémente. `infrastructure/` les branche sur
 * Drizzle et sur la connexion que le point de composition injecte — ce module
 * n'importe jamais `@repo/db` (ADR 020).
 */

/** Une ligne de fichier, telle que les cas d'usage la lisent. */
export interface FileRecord {
  readonly id: string
  readonly owner: FileOwner
  readonly purpose: string
  readonly storageKey: string
  readonly contentType: AvatarContentType
  readonly sizeBytes: number
  readonly createdAt: Date
  /**
   * La dernière écriture. Elle n'est pas décorative : c'est elle qui **change**
   * quand l'avatar est remplacé, alors que l'identifiant de ligne, lui, ne
   * change pas — un remplacement est une seule écriture, pas une suppression
   * suivie d'une insertion. Sans elle, l'URL de lecture serait identique avant
   * et après, et le navigateur continuerait d'afficher l'ancienne image
   * (mesuré au navigateur : le remplacement était invisible).
   */
  readonly updatedAt: Date
}

/**
 * Le remplacement d'un avatar, **en une écriture**.
 *
 * Elle rend la clé **précédente**, et c'est tout l'intérêt : c'est ce qui permet
 * de supprimer l'objet remplacé sans le relire ensuite, donc sans fenêtre où
 * deux lignes désigneraient deux objets. `null` quand il n'y en avait pas.
 */
export interface ReplacedFile {
  readonly id: string
  readonly previousStorageKey: string | null
}

export interface FileRepository {
  /**
   * Pose l'avatar d'un propriétaire et rend ce qu'il remplace.
   *
   * L'unicité est portée par la **base** — un index unique sur
   * `(owner_kind, owner_id, purpose)` — jamais par une vérification préalable
   * (`docs/reliability.md` §1). L'implémentation sérialise en plus les
   * remplacements d'un même propriétaire : deux confirmations en vol laisseraient
   * sinon un objet orphelin, celui que ni l'une ni l'autre n'a vu.
   */
  replaceAvatar(input: {
    readonly id: string
    readonly owner: FileOwner
    readonly storageKey: string
    readonly contentType: AvatarContentType
    readonly sizeBytes: number
    readonly at: Date
  }): Promise<ReplacedFile>

  /** L'avatar d'un propriétaire, ou `null`. */
  avatarOf(owner: FileOwner): Promise<FileRecord | null>

  /** Une ligne par son identifiant, quel qu'en soit le propriétaire. */
  byId(id: string): Promise<FileRecord | null>

  /**
   * Efface les lignes d'un propriétaire et rend **les clés qui étaient les
   * leurs**.
   *
   * Rendre les clés est ce qui rend la purge honnête : sans elles, l'appelant ne
   * pourrait supprimer que la ligne, et l'objet survivrait — le défaut exact que
   * s16 a laissé passer sur une adresse.
   */
  deleteOwnedBy(owner: FileOwner): Promise<readonly string[]>

  /** Les lignes d'un propriétaire, pour l'export. */
  listOwnedBy(owner: FileOwner): Promise<readonly FileRecord[]>
}
