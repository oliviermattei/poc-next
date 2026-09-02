import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

import type {
  PresignUploadInput,
  PresignUploadResult,
  ReadObjectResult,
  RemoveObjectResult,
  Storage,
  StorageErrorCode,
  WriteObjectInput,
  WriteObjectResult,
} from '@repo/ports'

/**
 * Le stockage sur disque : **un outil de développement**, pas un fournisseur.
 *
 * `docs/reliability.md` §2 : « Aucun port ne dépend d'une clé de fournisseur
 * pour fonctionner en développement local : capture locale des emails,
 * **stockage sur disque**… ». Sans seau S3, les fichiers sont écrits dans un
 * dossier ignoré par git.
 *
 * Ce n'est pas un second adapter (ADR 008) : Supabase Storage et les autres
 * restent au cimetière du PRD, et rien ici ne parle à un service tiers.
 *
 * **L'URL présignée reste sur notre propre origine**, et ce n'est pas une
 * commodité : c'est ce qui fait que l'état livré du dépôt téléverse sans
 * qu'aucune source n'entre dans `config/security.ts` — la politique de s45
 * porte `connect-src 'self'`, et un seau réel, lui, devra y être déclaré.
 *
 * Elle est signée quand même, avec les trois propriétés qu'on exigerait d'une
 * URL présignée réelle, parce qu'un outil de développement qui accepterait
 * n'importe quel `PUT` sur n'importe quelle clé apprendrait la mauvaise leçon
 * au prochain agent :
 *
 * 1. **elle ne dure pas** — l'échéance est dans la charge signée ;
 * 2. **elle ne vaut que pour la clé qu'elle nomme** — la clé est dans la charge ;
 * 3. **elle ne permet pas d'écrire ailleurs** — le chemin est confiné au
 *    dossier, et la signature ne rattrape pas une clé qui en sort.
 */

/** Le chemin que le module monte pour recevoir les téléversements locaux. */
export const LOCAL_UPLOAD_PATH = '/api/modules/storage/local-upload'

export interface LocalDiskStorageOptions {
  /** Dossier d'écriture, **injecté** : ce module ne devine ni le `cwd`, ni la racine du dépôt. */
  readonly directory: string
  /**
   * Secret de signature. Tiré au hasard à la construction quand il n'est pas
   * fourni : une URL présignée n'a pas à survivre au processus qui l'a émise,
   * et un secret par défaut écrit en dur serait un secret publié.
   */
  readonly secret?: string
  /** Horloge injectée : une échéance non injectée n'est pas testable. */
  readonly now?: () => number
}

/**
 * Ce que le point de composition reçoit : le port, et **la porte du mode
 * local**.
 *
 * `handleUpload` n'est pas dans le port, et c'est délibéré : elle n'existe que
 * pour cet outil. Le module la reçoit en option ; avec un vrai seau, elle est
 * absente et la route de téléversement local répond 404.
 */
export interface LocalDiskStorage {
  readonly storage: Storage
  readonly handleUpload: (request: Request) => Promise<Response>
}

/**
 * Le chemin d'un objet **dans le dossier**, ou `null` s'il en sort.
 *
 * **La garde active est celle des segments** : vide, `.`, `..`, ou un caractère
 * hors de `[A-Za-z0-9._-]`. C'est elle qui refuse `../../evade.png` **et**
 * `avatars/user/../../etc/passwd` — le second étant le cas intéressant, parce
 * que ses `..` sont consommés par les segments qui précèdent et que le chemin
 * résolu retombe **dans** le dossier. Retirer cette garde fait rougir un cas.
 *
 * La vérification du chemin **résolu** est la ceinture par-dessus les
 * bretelles, et il faut le dire plutôt que le laisser croire : **la retirer ne
 * fait rougir aucun cas** — mesuré. Elle n'est pas atteignable tant que la
 * garde des segments ne régresse pas, exactement comme le `basename` de
 * `packages/mailer-testing`. Elle est le filet d'une garde active, pas une
 * garde de plus, et c'est le jour où quelqu'un élargira le jeu de caractères
 * qu'elle servira.
 */
export function localObjectPath(directory: string, key: string): string | null {
  const segments = key.split('/')

  if (segments.length === 0 || key.startsWith('/')) {
    return null
  }

  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      return null
    }

    if (!/^[A-Za-z0-9._-]+$/.test(segment)) {
      return null
    }
  }

  const root = resolve(directory)
  const candidate = resolve(root, ...segments)

  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null
}

const failure = (code: StorageErrorCode, message: string) => ({
  ok: false as const,
  error: { code, message, attempts: 1 },
})

/** Le type stocké vit à côté des octets : un fichier ne porte pas son en-tête. */
const TYPE_SUFFIX = '.content-type'

export function createLocalDiskStorage(options: LocalDiskStorageOptions): LocalDiskStorage {
  const now = options.now ?? (() => Date.now())
  const secret = options.secret ?? randomBytes(32).toString('hex')

  const sign = (payload: string): string =>
    createHmac('sha256', secret).update(payload).digest('base64url')

  /** La charge signée : tout ce que l'URL prétend autoriser, et rien de plus. */
  const payloadOf = (key: string, contentType: string, length: string, expires: string): string =>
    [key, contentType, length, expires].join('\n')

  /**
   * Comparaison à temps constant.
   *
   * Une comparaison de chaînes ordinaire fuit la position du premier octet
   * faux : sur un secret de développement c'est théorique, mais l'écrire à
   * l'envers ici serait l'écrire à l'envers au prochain endroit qui compte.
   */
  const matches = (expected: string, received: string): boolean => {
    const left = Buffer.from(expected)
    const right = Buffer.from(received)

    return left.length === right.length && timingSafeEqual(left, right)
  }

  const storage: Storage = {
    async presignUpload(input: PresignUploadInput): Promise<PresignUploadResult> {
      if (localObjectPath(options.directory, input.key) === null) {
        return failure('invalid_request', 'Clé refusée : elle sort du dossier de stockage local.')
      }

      const expiresAt = new Date(now() + input.expiresInSeconds * 1000)
      const expires = String(expiresAt.getTime())
      const length = String(input.contentLength)
      const parameters = new URLSearchParams({
        key: input.key,
        type: input.contentType,
        length,
        expires,
        signature: sign(payloadOf(input.key, input.contentType, length, expires)),
      })

      return {
        ok: true,
        upload: {
          // Un **chemin**, pas une URL absolue : même origine, donc rien à
          // déclarer dans la politique de sécurité du contenu.
          url: `${LOCAL_UPLOAD_PATH}?${parameters.toString()}`,
          method: 'PUT',
          headers: {
            'content-type': input.contentType,
            'content-length': length,
          },
          expiresAt,
        },
      }
    },

    async read(key: string): Promise<ReadObjectResult> {
      const path = localObjectPath(options.directory, key)

      if (path === null) {
        return failure('invalid_request', 'Clé refusée : elle sort du dossier de stockage local.')
      }

      try {
        const bytes = new Uint8Array(await readFile(path))
        const contentType = await readFile(`${path}${TYPE_SUFFIX}`, 'utf8').catch(() => null)

        return { ok: true, object: { bytes, contentType } }
      } catch {
        // Absent ou illisible : les deux sont « il n'y a rien à lire ». Le
        // disque est le « fournisseur » de cet outil ; son indisponibilité
        // dégrade, elle ne lève pas.
        return failure('not_found', 'Aucun objet à cette clé dans le stockage local.')
      }
    },

    /**
     * L'écriture **par le serveur** : la promotion d'octets déjà vérifiés.
     *
     * Elle passe par la même frontière de dossier que le téléversement, et pour
     * la même raison : la clé est ce qui sépare deux périmètres, et une clé qui
     * en sort n'écrit rien. Elle ne demande en revanche ni signature ni
     * échéance — l'appelant est le serveur lui-même, pas le navigateur.
     */
    async write(input: WriteObjectInput): Promise<WriteObjectResult> {
      const path = localObjectPath(options.directory, input.key)

      if (path === null) {
        return failure('invalid_request', 'Clé refusée : elle sort du dossier de stockage local.')
      }

      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, input.bytes)
        await writeFile(`${path}${TYPE_SUFFIX}`, input.contentType, 'utf8')

        return { ok: true }
      } catch {
        return failure('provider_unavailable', 'Écriture impossible dans le stockage local.')
      }
    },

    async remove(key: string): Promise<RemoveObjectResult> {
      const path = localObjectPath(options.directory, key)

      if (path === null) {
        return failure('invalid_request', 'Clé refusée : elle sort du dossier de stockage local.')
      }

      try {
        // `force` : une suppression rejouée ne doit produire aucun effet
        // supplémentaire (`docs/reliability.md` §1), et un objet absent est
        // déjà l'état voulu.
        await rm(path, { force: true })
        await rm(`${path}${TYPE_SUFFIX}`, { force: true })

        return { ok: true }
      } catch {
        return failure('provider_unavailable', 'Suppression impossible dans le stockage local.')
      }
    },
  }

  return {
    storage,

    /**
     * La porte du téléversement local.
     *
     * Elle refuse **avant d'écrire quoi que ce soit** : signature, échéance,
     * type, taille, puis le confinement au dossier. Un refus est un 403 nu — il
     * ne dit pas laquelle des cinq conditions a manqué, parce qu'un message
     * précis apprendrait à la sonde suivante laquelle contourner.
     */
    async handleUpload(request: Request): Promise<Response> {
      const parameters = new URL(request.url).searchParams
      const key = parameters.get('key') ?? ''
      const contentType = parameters.get('type') ?? ''
      const length = parameters.get('length') ?? ''
      const expires = parameters.get('expires') ?? ''
      const signature = parameters.get('signature') ?? ''

      if (!matches(sign(payloadOf(key, contentType, length, expires)), signature)) {
        return new Response(null, { status: 403 })
      }

      const expiresAt = Number(expires)

      if (!Number.isFinite(expiresAt) || expiresAt <= now()) {
        return new Response(null, { status: 403 })
      }

      const path = localObjectPath(options.directory, key)

      if (path === null) {
        return new Response(null, { status: 403 })
      }

      const bytes = new Uint8Array(await request.arrayBuffer())

      // Le type et la taille sont **liés à la signature** chez un vrai
      // fournisseur : ils le sont ici aussi, sans quoi cet outil serait plus
      // permissif que ce qu'il imite, et le développement laisserait passer ce
      // que la production refuse.
      if (
        request.headers.get('content-type') !== contentType ||
        String(bytes.byteLength) !== length
      ) {
        return new Response(null, { status: 403 })
      }

      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, bytes)
        await writeFile(`${path}${TYPE_SUFFIX}`, contentType, 'utf8')
      } catch {
        // Le disque est le « fournisseur » : son indisponibilité dégrade. Le
        // message ne porte ni chemin absolu, ni clé.
        return new Response(null, { status: 500 })
      }

      return new Response(null, { status: 200 })
    },
  }
}
