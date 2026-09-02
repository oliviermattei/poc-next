/**
 * Les règles pures du module `storage` : ce qu'un avatar a le droit d'être, et
 * où son objet a le droit de vivre.
 *
 * Aucune base, aucun framework, aucun SDK, aucun port (ADR 006). Ce fichier est
 * l'endroit où se ferme le piège que la story nomme — « le type déclaré par le
 * client ne prouve rien » —, et il s'y ferme parce que **c'est ici qu'on peut
 * l'éprouver sans réseau, sans disque et sans base**.
 */

export const STORAGE_MODULE_ID = 'storage'

/**
 * Les trois types servis, et **rien d'autre**.
 *
 * C'est une liste blanche, jamais une liste de refus : une liste de refus laisse
 * passer le format qu'on n'a pas prévu, et le format qu'on n'a pas prévu est
 * précisément celui qui pose problème. `image/svg+xml` en est le cas d'école —
 * un SVG est un document XML, il porte du script, et le servir depuis notre
 * origine reviendrait à exécuter du code de l'utilisateur sous notre politique
 * de sécurité du contenu. `image/gif` est absent par sobriété : un avatar animé
 * n'a été demandé nulle part.
 */
export const AVATAR_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type AvatarContentType = (typeof AVATAR_CONTENT_TYPES)[number]

/** Deux mébioctets. Le plafond est une décision de produit, écrite une fois. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

/** L'unique usage de fichier livré. La colonne existe pour que l'unicité ait un sens. */
export const AVATAR_PURPOSE = 'avatar'

/**
 * À qui appartient un fichier.
 *
 * Volontairement défini ici plutôt qu'importé de `@repo/core` : c'est la même
 * forme que `ModuleScope`, et le `domain` n'a pas besoin de connaître le
 * contrat de module pour dire ce qu'est un propriétaire. La conversion se fait
 * à la frontière, dans `application/`.
 */
export interface FileOwner {
  readonly kind: 'user' | 'organization'
  readonly id: string
}

/** Pourquoi un téléversement est refusé. Un code, jamais une phrase. */
export type AvatarRefusal =
  | 'unsupported_type'
  | 'too_large'
  | 'invalid_size'
  | 'content_mismatch'
  | 'invalid_key'

/**
 * Les signatures binaires des trois formats, relevées sur des fichiers réels.
 *
 * Ce n'est **pas** la liste des signatures qui existent : c'est la liste de ce
 * que ce produit sert. Tout ce qui n'y est pas est refusé, y compris une image
 * parfaitement valide d'un quatrième format.
 */
const startsWith = (bytes: Uint8Array, offset: number, signature: readonly number[]): boolean => {
  if (bytes.byteLength < offset + signature.length) {
    return false
  }

  return signature.every((byte, index) => bytes[offset + index] === byte)
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46]
/** `WEBP`, aux octets 8 à 11 : `RIFF` seul est aussi le début d'un WAV. */
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50]

/**
 * Le type **réel** d'un contenu, ou `null`.
 *
 * C'est la fonction qui rend le contrôle de la story vérifiable : aucune
 * signature d'URL présignée ne lie un en-tête à des octets, donc l'en-tête
 * `Content-Type` d'un téléversement est une déclaration du client — et le
 * client est hostile jusqu'à preuve du contraire.
 */
export function detectImageType(bytes: Uint8Array): AvatarContentType | null {
  if (startsWith(bytes, 0, PNG_SIGNATURE)) {
    return 'image/png'
  }

  if (startsWith(bytes, 0, JPEG_SIGNATURE)) {
    return 'image/jpeg'
  }

  if (startsWith(bytes, 0, RIFF_SIGNATURE) && startsWith(bytes, 8, WEBP_SIGNATURE)) {
    return 'image/webp'
  }

  return null
}

export type AvatarValidation = { readonly ok: true } | { readonly ok: false; readonly refusal: AvatarRefusal }

/**
 * Ce qui est refusé **avant** d'émettre une URL présignée
 * (`docs/security.md` §4).
 *
 * Nécessaire et insuffisant, et il faut lire les deux mots : le type et la
 * taille annoncés sont liés à la signature, donc le fournisseur refusera un
 * téléversement qui ne les repose pas. Mais rien ne lie ces en-têtes au
 * contenu — c'est `validateStoredAvatar` qui ferme le piège, après coup.
 */
export function validateAvatarUpload(input: {
  readonly contentType: string
  readonly size: number
}): AvatarValidation {
  if (!(AVATAR_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
    return { ok: false, refusal: 'unsupported_type' }
  }

  if (!Number.isInteger(input.size) || input.size <= 0) {
    return { ok: false, refusal: 'invalid_size' }
  }

  if (input.size > AVATAR_MAX_BYTES) {
    return { ok: false, refusal: 'too_large' }
  }

  return { ok: true }
}

export type StoredAvatarValidation =
  | { readonly ok: true; readonly contentType: AvatarContentType }
  | { readonly ok: false; readonly refusal: AvatarRefusal }

/**
 * **Le contrôle qui compte** : les octets réellement stockés.
 *
 * Trois refus, et chacun ferme une porte différente :
 *
 * - les octets ne portent aucune des trois signatures — HTML, SVG, PDF, une
 *   archive renommée ;
 * - ils en portent une, mais **pas celle qui a été déclarée au stockage**. Le
 *   fournisseur servira l'objet sous le type déclaré : un JPEG stocké en
 *   `image/png` ferait servir un type qui ment, et un type qui ment est
 *   exactement ce que `X-Content-Type-Options: nosniff` empêche de rattraper ;
 * - la taille réelle dépasse le plafond, quoi qu'ait annoncé le client. Une
 *   taille annoncée fausse ne survit pas à cette ligne.
 */
export function validateStoredAvatar(input: {
  readonly bytes: Uint8Array
  readonly declaredContentType: string
}): StoredAvatarValidation {
  if (input.bytes.byteLength > AVATAR_MAX_BYTES) {
    return { ok: false, refusal: 'too_large' }
  }

  const actual = detectImageType(input.bytes)

  if (actual === null || actual !== input.declaredContentType) {
    return { ok: false, refusal: 'content_mismatch' }
  }

  return { ok: true, contentType: actual }
}

/** L'extension servie pour un type. Dérivée du type, jamais d'un nom de fichier. */
const EXTENSIONS: Readonly<Record<AvatarContentType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/**
 * Les **deux espaces de clés**, et la raison d'en avoir deux.
 *
 * `pending` est ce vers quoi une URL présignée est émise ; `served` est ce que
 * la route de lecture sert. **Aucune URL présignée ne nomme jamais une clé
 * servie.** C'est ce qui rend le contrôle de contenu durable : rejouée dans sa
 * fenêtre avec d'autres octets de même longueur et de même type, une URL
 * présignée réécrit son objet d'attente — que plus rien ne lit — et ne peut pas
 * atteindre l'objet vérifié (constat F2 de la revue, mesuré au navigateur avant
 * la promotion).
 *
 * La révocation d'une URL présignée n'existe chez aucun fournisseur : elle vaut
 * jusqu'à son échéance, un point c'est tout. La seule réponse qui ne dépende
 * pas du fournisseur est donc de déplacer la cible, pas d'espérer l'invalider.
 */
export type KeySpace = 'served' | 'pending'

const SPACE_PREFIX: Readonly<Record<KeySpace, string>> = {
  served: 'avatars',
  pending: 'pending',
}

/**
 * Le préfixe d'objets d'un propriétaire, dans l'espace demandé. **C'est la
 * frontière d'autorisation.**
 *
 * La barre oblique finale n'est pas cosmétique : sans elle, `usr_1` serait un
 * préfixe de `usr_10`, et le périmètre du voisin deviendrait accessible par une
 * comparaison de chaîne.
 */
export function scopePrefix(owner: FileOwner, space: KeySpace = 'served'): string {
  return `${SPACE_PREFIX[space]}/${owner.kind}/${owner.id}/`
}

/** Un identifiant de propriétaire ne fabrique pas de chemin. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/

/**
 * La clé d'un nouvel avatar.
 *
 * **Rien du client n'y entre.** Le nom du fichier téléversé n'est ni lu, ni
 * stocké, ni employé : c'est ce qui rend la traversée de répertoire impossible
 * par construction plutôt que par assainissement. Le hasard vient de l'appelant
 * — une clé non injectée est une clé non testable — et l'extension du type.
 *
 * L'identifiant du propriétaire vient de la base, jamais d'une requête ; il est
 * quand même vérifié, parce que la clé **est** la frontière entre deux
 * périmètres et qu'une frontière qu'on peut fabriquer n'en est pas une. Une
 * exception ici est un défaut de programmation, pas un refus métier : aucun
 * chemin d'appel ne doit pouvoir l'atteindre.
 */
export function avatarKeyFor(
  owner: FileOwner,
  contentType: AvatarContentType,
  newId: () => string,
  space: KeySpace = 'served',
): string {
  if (!SAFE_ID.test(owner.id)) {
    throw new Error('Identifiant de propriétaire refusé : il ne peut pas former un chemin.')
  }

  return `${scopePrefix(owner, space)}${newId()}.${EXTENSIONS[contentType]}`
}

/**
 * La clé appartient-elle à ce périmètre ?
 *
 * C'est la règle qui autorise la confirmation d'un téléversement : l'appelant ne
 * peut confirmer que dans le préfixe qui lui a été présigné. Elle refuse aussi
 * un segment supplémentaire et un `..`, faute de quoi une clé sous le bon
 * préfixe pourrait remonter chez le voisin.
 */
export function keyBelongsTo(key: string, owner: FileOwner, space: KeySpace = 'served'): boolean {
  const prefix = scopePrefix(owner, space)

  if (!key.startsWith(prefix)) {
    return false
  }

  const remainder = key.slice(prefix.length)

  // Un seul segment, non vide, dans le jeu de caractères d'une clé que nous
  // avons nous-mêmes fabriquée.
  return /^[A-Za-z0-9_-]+\.[a-z]{3,4}$/.test(remainder)
}

/**
 * **La promotion** : la clé servie qui correspond à une clé d'attente, ou
 * `null` si celle-ci n'appartient pas au périmètre de l'appelant.
 *
 * Elle porte les deux refus d'un coup, et c'est voulu — un appelant ne peut
 * confirmer que ce qu'il aurait pu faire présigner :
 *
 * - une clé d'attente d'un autre périmètre, ou remontant dans l'arborescence,
 *   ne promeut rien ;
 * - une clé **déjà servie** non plus. Elle n'est présignable par personne, et
 *   l'accepter rouvrirait la porte que la séparation des deux espaces ferme.
 *
 * Le nom de l'objet est repris tel quel : il a été fabriqué par nous, il ne
 * porte rien du client, et son extension vient du type déclaré — dont
 * `validateStoredAvatar` vient de prouver qu'il est le type réel.
 */
export function servedKeyOf(pendingKey: string, owner: FileOwner): string | null {
  if (!keyBelongsTo(pendingKey, owner, 'pending')) {
    return null
  }

  return `${scopePrefix(owner, 'served')}${pendingKey.slice(scopePrefix(owner, 'pending').length)}`
}
