import type { Storage } from '@repo/ports'
import { z } from 'zod'

import {
  AVATAR_MAX_BYTES,
  AVATAR_PURPOSE,
  avatarKeyFor,
  type AvatarContentType,
  type AvatarRefusal,
  type FileOwner,
  servedKeyOf,
  validateAvatarUpload,
  validateStoredAvatar,
} from '../domain/avatar'
import type { FileRepository } from './ports'

/**
 * Les cas d'usage du module `storage`.
 *
 * Ils ne connaissent ni S3, ni le disque : ils reçoivent le **port** `Storage`,
 * et c'est tout ce qu'ils savent du monde extérieur. Le point de composition de
 * l'application décide lequel des deux l'exécute (`apps/web/lib/storage.ts`).
 *
 * **L'ordre est le même à chaque porte** : autorisation, puis validation. Un
 * appelant sans droit reçoit 404 avant que quoi que ce soit ne soit jugé — c'est
 * la leçon du constat F5 de la revue de s17, où l'ordre inverse rendait un motif
 * traduit à qui n'avait aucun droit.
 */

/** La durée de vie d'une URL de téléversement. Courte : elle sert tout de suite. */
export const UPLOAD_URL_TTL_SECONDS = 120

export type StorageRefusal = AvatarRefusal | 'storage_unavailable'

export type PresignOutcome =
  | {
      readonly status: 'ok'
      readonly key: string
      readonly url: string
      readonly method: 'PUT'
      readonly headers: Readonly<Record<string, string>>
      readonly expiresAt: Date
    }
  | { readonly status: 'refused'; readonly refusal: StorageRefusal }

export type ConfirmOutcome =
  | { readonly status: 'ok'; readonly fileId: string }
  | { readonly status: 'refused'; readonly refusal: StorageRefusal }
  /** L'appelant a confirmé une clé qui n'est pas dans son périmètre. 404, jamais 403. */
  | { readonly status: 'not_found' }
  /**
   * La clé a **déjà été promue, et c'est bien celle que la ligne porte**.
   *
   * Le refus reste entier : rien n'est réécrit, rien n'est enregistré, et la
   * réponse HTTP reste un 404 (ADR 033, conséquence 3). Ce que ce cas ajoute
   * est un **motif exact** : l'avatar de l'appelant a changé, et lui dire que
   * son envoi n'est plus valide est faux.
   *
   * Il ne dit rien qu'un 404 nu ne dirait déjà : il n'est rendu que pour une
   * clé du périmètre de l'appelant — `servedKeyOf` l'a exigé une ligne plus
   * haut — **et** dont la promotion est celle que sa propre ligne référence.
   * Une clé inventée dans son propre préfixe, comme celle d'un autre compte,
   * reçoit `not_found`.
   */
  | { readonly status: 'already_confirmed' }

export type RemoveOutcome =
  | { readonly status: 'ok' }
  | { readonly status: 'refused'; readonly refusal: StorageRefusal }

export type ReadOutcome =
  | {
      readonly status: 'ok'
      readonly bytes: Uint8Array
      readonly contentType: AvatarContentType
    }
  | { readonly status: 'not_found' }

/** L'avatar tel que les écrans le lisent : un identifiant, jamais une clé d'objet. */
export interface AvatarView {
  readonly fileId: string
  readonly contentType: AvatarContentType
  /**
   * Le jeton qui change à chaque remplacement.
   *
   * L'identifiant de ligne, lui, ne change pas : le remplacement est **une**
   * écriture, et c'est ce qui interdit une fenêtre sans avatar. Sans ce jeton,
   * l'URL de lecture serait la même avant et après, et le navigateur
   * continuerait d'afficher l'ancienne image — mesuré au navigateur, où le
   * remplacement était invisible malgré `cache-control: private, no-store`,
   * l'attribut `src` n'ayant tout simplement pas changé.
   *
   * C'est l'horodatage de la dernière écriture, pas la clé d'objet : celle-ci
   * ne sort jamais du module.
   */
  readonly version: string
}

/**
 * **Zod à la frontière** (`docs/security.md` §4).
 *
 * Le corps d'une demande d'URL présignée porte deux valeurs venues du client, et
 * les deux sont hostiles : un type qui n'est pas une chaîne et une taille qui
 * n'est pas un nombre passeraient autrement jusqu'au `domain`.
 */
export const presignBodySchema = z.object({
  contentType: z.string().max(100),
  size: z.coerce.number().int(),
})

export const confirmBodySchema = z.object({
  key: z.string().min(1).max(300),
})

export interface StorageUseCases {
  presignAvatar(input: {
    readonly owner: FileOwner
    readonly body: unknown
  }): Promise<PresignOutcome>
  confirmAvatar(input: { readonly owner: FileOwner; readonly body: unknown }): Promise<ConfirmOutcome>
  removeAvatar(owner: FileOwner): Promise<RemoveOutcome>
  avatarOf(owner: FileOwner): Promise<AvatarView | null>
  readFile(input: {
    readonly fileId: string
    readonly scopes: readonly FileOwner[]
  }): Promise<ReadOutcome>
  purge(owner: FileOwner): Promise<void>
  export(owner: FileOwner): Promise<{ readonly files: readonly unknown[] }>
}

export interface StorageUseCasesDependencies {
  readonly repository: FileRepository
  readonly storage: Storage
  readonly newId: () => string
  readonly newObjectId: () => string
  readonly now: () => Date
}

const isSameOwner = (left: FileOwner, right: FileOwner): boolean =>
  left.kind === right.kind && left.id === right.id

export function createStorageUseCases(
  dependencies: StorageUseCasesDependencies,
): StorageUseCases {
  const { repository, storage, newId, newObjectId, now } = dependencies

  return {
    async presignAvatar({ owner, body }): Promise<PresignOutcome> {
      const parsed = presignBodySchema.safeParse(body)

      if (!parsed.success) {
        return { status: 'refused', refusal: 'unsupported_type' }
      }

      const validation = validateAvatarUpload({
        contentType: parsed.data.contentType,
        size: parsed.data.size,
      })

      if (!validation.ok) {
        return { status: 'refused', refusal: validation.refusal }
      }

      // Le type est désormais l'un des trois : le `domain` vient de le dire, et
      // c'est lui qui décide, jamais cette conversion.
      const contentType = parsed.data.contentType as AvatarContentType
      // **Rien du client n'entre dans la clé** : ni nom de fichier, ni
      // extension. Le périmètre vient de la session, le reste du hasard.
      //
      // Et la clé est **une clé d'attente** (ADR 033) : l'URL présignée ne
      // nomme jamais l'objet servi. Rejouée dans sa fenêtre — ce qu'aucun
      // fournisseur ne permet d'empêcher —, elle réécrit un objet que plus rien
      // ne lit.
      const key = avatarKeyFor(owner, contentType, newObjectId, 'pending')

      const presigned = await storage.presignUpload({
        key,
        contentType,
        contentLength: parsed.data.size,
        expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      })

      if (!presigned.ok) {
        // Le stockage est indisponible : l'application le dit, elle ne tombe
        // pas (`docs/reliability.md` §2).
        return { status: 'refused', refusal: 'storage_unavailable' }
      }

      return {
        status: 'ok',
        key,
        url: presigned.upload.url,
        method: presigned.upload.method,
        headers: presigned.upload.headers,
        expiresAt: presigned.upload.expiresAt,
      }
    },

    async confirmAvatar({ owner, body }): Promise<ConfirmOutcome> {
      const parsed = confirmBodySchema.safeParse(body)

      if (!parsed.success) {
        return { status: 'not_found' }
      }

      // **L'autorisation d'abord.** Une clé hors du périmètre d'attente de
      // l'appelant rend 404 : dire « interdit » confirmerait qu'elle existe
      // (`docs/security.md` §3). `servedKeyOf` porte le refus **et** la clé
      // servie correspondante — une seule fonction, donc rien à faire diverger.
      const servedKey = servedKeyOf(parsed.data.key, owner)

      if (servedKey === null) {
        return { status: 'not_found' }
      }

      const object = await storage.read(parsed.data.key)

      if (!object.ok) {
        if (object.error.code !== 'not_found') {
          return { status: 'refused', refusal: 'storage_unavailable' }
        }

        // L'objet d'attente n'existe plus, et **deux histoires y mènent** : la
        // confirmation a déjà eu lieu — la promotion a consommé l'objet —, ou
        // cette clé n'a jamais rien désigné. Les confondre fait afficher « cet
        // envoi n'est plus valide » alors que l'avatar a bien changé.
        //
        // La distinction se lit sur **la ligne de l'appelant**, jamais sur le
        // stockage : si elle porte la clé servie que cette clé d'attente
        // produit, c'est cette confirmation-ci qui a réussi.
        const current = await repository.avatarOf(owner)

        return current !== null && current.storageKey === servedKey
          ? { status: 'already_confirmed' }
          : { status: 'not_found' }
      }

      // **Le contrôle qui compte** : les octets, pas l'en-tête. Le type déclaré
      // au stockage est lié à la signature de l'URL présignée, donc il vient
      // bien de nous — mais rien ne lie ce type au contenu.
      const validation = validateStoredAvatar({
        bytes: object.object.bytes,
        declaredContentType: object.object.contentType ?? '',
      })

      if (!validation.ok) {
        // L'objet hostile ne reste pas dans le seau. Un échec de suppression est
        // sans conséquence pour l'appelant : rien ne le référence, il n'est
        // servi par aucune route, et la purge du périmètre ne le connaîtra pas —
        // c'est la limite, et elle est écrite dans l'`AGENTS.md` du module.
        await storage.remove(parsed.data.key)

        return { status: 'refused', refusal: validation.refusal }
      }

      // **La promotion** (ADR 033) : les octets **qui viennent d'être vérifiés**
      // sont écrits par le serveur vers la clé servie. C'est ce qui rend le
      // contrôle durable — entre la lecture et cette écriture, plus rien du
      // client n'intervient, et l'URL présignée ne désigne pas cette clé.
      const promoted = await storage.write({
        key: servedKey,
        bytes: object.object.bytes,
        contentType: validation.contentType,
      })

      if (!promoted.ok) {
        // Rien n'est enregistré, et l'objet d'attente **reste** : une seconde
        // confirmation de la même clé refera la promotion. Le supprimer ici
        // obligerait à retéléverser pour une panne passagère du stockage.
        return { status: 'refused', refusal: 'storage_unavailable' }
      }

      // L'objet d'attente n'a plus de raison d'exister. Un échec est sans
      // conséquence pour l'appelant : rien ne le référence, aucune route ne le
      // sert — c'est la dette d'orphelins déjà nommée dans l'ADR 032.
      await storage.remove(parsed.data.key)

      const replaced = await repository.replaceAvatar({
        id: newId(),
        owner,
        storageKey: servedKey,
        contentType: validation.contentType,
        sizeBytes: object.object.bytes.byteLength,
        at: now(),
      })

      // **Le remplacement supprime le précédent** (critère 4). La comparaison
      // n'est pas décorative : la promotion reprend le nom de l'objet d'attente,
      // donc une confirmation rejouée dont la suppression d'attente aurait
      // échoué retomberait sur la clé servie qu'on vient d'écrire.
      if (replaced.previousStorageKey !== null && replaced.previousStorageKey !== servedKey) {
        await storage.remove(replaced.previousStorageKey)
      }

      return { status: 'ok', fileId: replaced.id }
    },

    async removeAvatar(owner): Promise<RemoveOutcome> {
      // Même chemin que la purge : la ligne **et** l'objet. Un « retirer » qui
      // ne laisserait que l'objet serait une purge à moitié faite.
      const keys = await repository.deleteOwnedBy(owner)
      const outcomes = await Promise.all(keys.map(async (key) => await storage.remove(key)))

      return outcomes.every((outcome) => outcome.ok)
        ? { status: 'ok' }
        : { status: 'refused', refusal: 'storage_unavailable' }
    },

    async avatarOf(owner): Promise<AvatarView | null> {
      const record = await repository.avatarOf(owner)

      return record === null
        ? null
        : {
            fileId: record.id,
            contentType: record.contentType,
            version: String(record.updatedAt.getTime()),
          }
    },

    async readFile({ fileId, scopes }): Promise<ReadOutcome> {
      const record = await repository.byId(fileId)

      // **404 dans les trois cas, et c'est le point.** La ligne n'existe pas,
      // elle appartient à quelqu'un d'autre, ou l'objet a disparu du stockage :
      // l'appelant reçoit exactement la même réponse, si bien qu'il ne peut pas
      // déduire l'existence du fichier d'une autre organisation
      // (`docs/security.md` §3).
      if (record === null || !scopes.some((scope) => isSameOwner(scope, record.owner))) {
        return { status: 'not_found' }
      }

      const object = await storage.read(record.storageKey)

      if (!object.ok) {
        return { status: 'not_found' }
      }

      return {
        status: 'ok',
        bytes: object.object.bytes,
        // Le type servi est celui **enregistré après vérification des octets**,
        // jamais celui que le stockage rend : un fournisseur qui se tromperait
        // ferait servir un type qui ment.
        contentType: record.contentType,
      }
    },

    async purge(owner): Promise<void> {
      // **L'objet, pas seulement la ligne.** C'est le défaut exact que s16 a
      // laissé passer sur une adresse, et le critère 6 de cette story le nomme.
      // L'ordre compte : les clés sont lues au moment de l'effacement, donc une
      // purge rejouée ne trouve plus rien à supprimer et n'a aucun effet de plus
      // (`docs/reliability.md` §1).
      const keys = await repository.deleteOwnedBy(owner)

      await Promise.all(keys.map(async (key) => await storage.remove(key)))
    },

    async export(owner) {
      const records = await repository.listOwnedBy(owner)

      return {
        // La clé d'objet **n'est pas exportée** : elle ne dit rien à la personne
        // qui exporte, et elle nommerait l'emplacement d'un objet d'un seau.
        files: records.map((record) => ({
          id: record.id,
          purpose: record.purpose,
          contentType: record.contentType,
          sizeBytes: record.sizeBytes,
          createdAt: record.createdAt.toISOString(),
        })),
      }
    },
  }
}

export { AVATAR_MAX_BYTES, AVATAR_PURPOSE }
