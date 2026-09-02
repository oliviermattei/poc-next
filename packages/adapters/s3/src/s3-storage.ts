import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type {
  PresignUploadInput,
  PresignUploadResult,
  ReadObjectResult,
  RemoveObjectResult,
  Storage,
  StorageError,
  StorageErrorCode,
  StorageLogRecord,
  StorageLogger,
  WriteObjectInput,
  WriteObjectResult,
} from '@repo/ports'
import { FetchHttpHandler } from '@smithy/fetch-http-handler'

import { sanitizeProviderMessage } from './log'
import { backoffDelayMs, classifyStorageStatus, isTransientStorageError } from './retry'

/**
 * L'unique implémentation livrée du port `Storage` (ADR 008) — S3 et toute API
 * compatible : Cloudflare R2, MinIO, DigitalOcean Spaces.
 *
 * Quatre comportements des paquets installés (`@aws-sdk/client-s3@3.1123.0`,
 * `@aws-sdk/s3-request-presigner@3.1123.0`) ont été **relevés dans une
 * exécution**, pas dans une documentation, et ils décident de ce fichier :
 *
 * 1. **le gestionnaire de requêtes par défaut parle `node:http`.** Le régime de
 *    test du dépôt double le **réseau**, pas le SDK — un double de
 *    `globalThis.fetch` ne verrait donc rien. `FetchHttpHandler` est imposé
 *    ici, et c'est ce qui rend cet adapter éprouvable comme l'est celui de
 *    Resend. Ce n'est pas un réglage de test : il est posé en production aussi,
 *    sans quoi ce qui est éprouvé ne serait pas ce qui s'exécute ;
 * 2. **`getSignedUrl` ne touche pas le réseau.** La signature est un calcul :
 *    elle n'a ni délai à borner, ni reprise à faire. Elle peut lever (options
 *    incohérentes), d'où le `try` — un port ne lève pas ;
 * 3. **`signableHeaders` lie les en-têtes à la signature.** Mesuré :
 *    `X-Amz-SignedHeaders=content-length;content-type;host`. L'URL rendue ne
 *    vaut donc ni pour un autre type, ni pour une autre taille, ni pour une
 *    autre clé — celle-ci étant déjà dans le chemin signé ;
 * 4. **le SDK a sa propre politique de reprise.** `maxAttempts: 1` la coupe :
 *    deux politiques superposées multiplient les essais sans que personne ne
 *    l'ait décidé, et le nombre d'essais rendu à l'appelant deviendrait faux.
 *
 * Ce que cet adapter **ne fait pas** : il ne présigne aucune lecture. C'est
 * l'ADR 032, et la raison est double — `img-src 'self'` refuserait une image
 * servie par le domaine du seau, et une URL de lecture est une capacité
 * détachée de l'appartenance.
 */

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 250
const DEFAULT_MAX_DELAY_MS = 5_000

export interface S3StorageOptions {
  readonly bucket: string
  readonly region: string
  /** Point de terminaison. Absent pour AWS ; renseigné pour R2, MinIO, Spaces. */
  readonly endpoint?: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  /**
   * Chemin plutôt que sous-domaine. Vrai par défaut : c'est la forme que R2 et
   * MinIO servent, et AWS l'accepte aussi. Un seau dont le nom porte un point
   * casse le style sous-domaine en TLS, ce qui est le mode d'échec le plus
   * pénible à diagnostiquer.
   */
  readonly forcePathStyle?: boolean
  readonly timeoutMs?: number
  readonly maxAttempts?: number
  readonly baseDelayMs?: number
  readonly maxDelayMs?: number
  readonly logger?: StorageLogger
  /** Injectés pour que le recul, la dispersion et l'échéance soient testables. */
  readonly sleep?: (ms: number) => Promise<void>
  readonly random?: () => number
}

/** Marqueur de course : distinct de toute valeur qu'un appel peut rendre. */
const TIMED_OUT = Symbol('s3-timed-out')

/**
 * Borne l'attente de l'appelant, quoi qu'il arrive en face.
 *
 * `FetchHttpHandler` arme déjà un `requestTimeout`, et les deux moyens sont
 * gardés ensemble pour la raison écrite dans `oauth-outbound.ts` : le signal
 * annule réellement la requête quand le transport l'honore, la course garantit
 * la borne quand il ne l'honore pas — un `fetch` doublé qui ne résout jamais,
 * par exemple.
 *
 * La promesse perdante est neutralisée : sans cela, un rejet arrivant après la
 * course remonterait en `unhandledRejection` et pourrait abattre le processus.
 */
const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof TIMED_OUT> => {
  let timer: ReturnType<typeof setTimeout> | undefined

  const expiry = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs)
  })

  promise.catch(() => undefined)

  try {
    return await Promise.race([promise, expiry])
  } finally {
    clearTimeout(timer)
  }
}

/** Le statut HTTP d'un échec du SDK, quand il en porte un. */
const statusOf = (cause: unknown): number | undefined => {
  const metadata = (cause as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata

  return metadata?.httpStatusCode
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : 'Erreur inattendue du SDK S3.'

export function createS3Storage(options: S3StorageOptions): Storage {
  // Erreurs de configuration, pas pannes de fournisseur : elles se voient au
  // démarrage, elles ne dégradent pas requête par requête. Chacune **nomme sa
  // variable** (`docs/security.md` §5).
  const required: readonly (readonly [string, string])[] = [
    ['STORAGE_S3_BUCKET', options.bucket],
    ['STORAGE_S3_REGION', options.region],
    ['STORAGE_S3_ACCESS_KEY_ID', options.accessKeyId],
    ['STORAGE_S3_SECRET_ACCESS_KEY', options.secretAccessKey],
  ]

  for (const [name, value] of required) {
    if (value.trim() === '') {
      throw new Error(
        `${name} est vide : renseignez le seau S3/R2, ou montez le stockage local (STORAGE_LOCAL_DIRECTORY).`,
      )
    }
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const backoff = {
    baseMs: options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
    maxMs: options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
    random: options.random ?? Math.random,
  }
  const log = options.logger ?? (() => undefined)

  const client = new S3Client({
    region: options.region,
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    forcePathStyle: options.forcePathStyle ?? true,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    requestHandler: new FetchHttpHandler({ requestTimeout: timeoutMs }),
    // Voir le constat 4 : la reprise appartient à cet adapter, pas au SDK.
    maxAttempts: 1,
  })

  const asError = (
    code: StorageErrorCode,
    message: string,
    attempts: number,
    key: string | undefined,
  ): StorageError => ({
    code,
    message: sanitizeProviderMessage(message, { bucket: options.bucket, key }),
    attempts,
  })

  /**
   * Un appel borné et repris, ou l'échec définitif.
   *
   * Le nombre d'essais rendu est le nombre **réellement fait** : c'est ce qui
   * permet à l'appelant de distinguer « le fournisseur a refusé tout de suite »
   * de « il n'a jamais répondu, trois fois ».
   */
  const run = async <T>(
    operation: StorageLogRecord['operation'],
    key: string | undefined,
    send: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false; error: StorageError }> => {
    let lastError = asError('provider_unavailable', 'Aucune tentative.', 0, key)

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const outcome = await withTimeout(send(), timeoutMs)

        if (outcome !== TIMED_OUT) {
          return { ok: true, value: outcome }
        }

        lastError = asError('timeout', `Aucune réponse en ${timeoutMs} ms.`, attempt, key)
      } catch (cause) {
        lastError = asError(
          classifyStorageStatus(statusOf(cause)),
          messageOf(cause),
          attempt,
          key,
        )
      }

      if (!isTransientStorageError(lastError.code) || attempt === maxAttempts) {
        break
      }

      log({
        event: 'storage.operation_retried',
        operation,
        code: lastError.code,
        attempts: lastError.attempts,
        message: lastError.message,
      })
      await sleep(backoffDelayMs(attempt, backoff))
    }

    log({
      event: 'storage.operation_failed',
      operation,
      code: lastError.code,
      attempts: lastError.attempts,
      message: lastError.message,
    })

    return { ok: false, error: lastError }
  }

  return {
    async presignUpload(input: PresignUploadInput): Promise<PresignUploadResult> {
      try {
        // Aucun réseau ici (constat 2) : ni délai à borner, ni reprise à faire.
        const url = await getSignedUrl(
          client,
          new PutObjectCommand({
            Bucket: options.bucket,
            Key: input.key,
            ContentType: input.contentType,
            ContentLength: input.contentLength,
          }),
          {
            expiresIn: input.expiresInSeconds,
            // Constat 3 : c'est cette ligne qui empêche l'URL de valoir pour un
            // autre type ou une autre taille. La retirer rendrait une URL
            // signée pour une image utilisable pour téléverser du HTML.
            signableHeaders: new Set(['content-type', 'content-length']),
          },
        )

        return {
          ok: true,
          upload: {
            url,
            method: 'PUT',
            // Ce que l'appelant doit reposer à l'identique : rendu plutôt que
            // deviné, parce qu'une signature qui ne retrouve pas ses en-têtes
            // est refusée par le fournisseur.
            headers: {
              'content-type': input.contentType,
              'content-length': String(input.contentLength),
            },
            expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
          },
        }
      } catch (cause) {
        const error = asError('invalid_request', messageOf(cause), 1, input.key)

        log({
          event: 'storage.operation_failed',
          operation: 'presign',
          code: error.code,
          attempts: error.attempts,
          message: error.message,
        })

        return { ok: false, error }
      }
    },

    async read(key: string): Promise<ReadObjectResult> {
      const outcome = await run('read', key, async () => {
        const response = await client.send(
          new GetObjectCommand({ Bucket: options.bucket, Key: key }),
        )

        return {
          bytes: (await response.Body?.transformToByteArray()) ?? new Uint8Array(),
          contentType: response.ContentType ?? null,
        }
      })

      return outcome.ok ? { ok: true, object: outcome.value } : outcome
    },

    /**
     * L'écriture **par le serveur** : la promotion d'octets déjà vérifiés vers
     * la clé servie (ADR 033).
     *
     * Elle passe par `run`, donc par le délai borné et les reprises sur
     * transitoires : c'est un appel réseau comme les autres. Le type est celui
     * que l'appelant a **prouvé** sur les octets, jamais celui qu'un client a
     * annoncé.
     */
    async write(input: WriteObjectInput): Promise<WriteObjectResult> {
      const outcome = await run('write', input.key, async () => {
        await client.send(
          new PutObjectCommand({
            Bucket: options.bucket,
            Key: input.key,
            Body: input.bytes,
            ContentType: input.contentType,
            ContentLength: input.bytes.byteLength,
          }),
        )
      })

      return outcome.ok ? { ok: true } : outcome
    },

    async remove(key: string): Promise<RemoveObjectResult> {
      const outcome = await run('remove', key, async () => {
        await client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key }))
      })

      // « Supprimé » et « n'existait pas » sont le même état voulu
      // (`docs/reliability.md` §1) : une purge rejouée ne doit produire aucun
      // effet supplémentaire, et distinguer les deux ferait échouer la seconde.
      if (!outcome.ok && outcome.error.code === 'not_found') {
        return { ok: true }
      }

      return outcome.ok ? { ok: true } : outcome
    },
  }
}
