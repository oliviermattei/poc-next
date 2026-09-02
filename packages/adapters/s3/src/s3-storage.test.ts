import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createS3Storage } from './s3-storage'

/**
 * L'unique implémentation livrée du port `Storage`, éprouvée **le réseau
 * doublé, le SDK réel**.
 *
 * C'est le régime du dépôt (`docs/architecture.md`), et il n'est tenable ici
 * que parce que l'adapter impose `FetchHttpHandler` : par défaut, le SDK parle
 * `node:http` et un double de `globalThis.fetch` ne verrait rien. Ce que ce
 * fichier éprouve est donc la sérialisation réelle de la requête, les en-têtes
 * réels, et le traitement réel de la réponse — pas une fonction à nous.
 *
 * Une seule exception, nommée : le cas qui prouve que l'adapter ne rejette pas
 * quand le transport lève. Le fournisseur n'a aucun moyen de faire lever le
 * SDK depuis le réseau, donc c'est `fetch` qui lève.
 */

const CREDENTIALS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
} as const

const options = (overrides: Record<string, unknown> = {}) => ({
  bucket: 'avatars-test',
  region: 'auto',
  endpoint: 'https://accountid.r2.cloudflarestorage.com',
  ...CREDENTIALS,
  // Les attentes sont injectées : un recul non injecté est un test lent.
  sleep: async () => undefined,
  random: () => 0.5,
  ...overrides,
})

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

const originalFetch = globalThis.fetch

/** Réponse de fournisseur, forgée pour que le SDK la lise réellement. */
const providerResponse = (status: number, body = '', headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : body, { status, headers })

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.useRealTimers()
})

describe('createS3Storage — URL présignée', () => {
  it('rend une URL bornée dans le temps qui ne porte aucun secret', async () => {
    const storage = createS3Storage(options())

    const result = await storage.presignUpload({
      key: 'avatars/user/usr_1/abc.png',
      contentType: 'image/png',
      contentLength: 1024,
      expiresInSeconds: 120,
    })

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    const url = new URL(result.upload.url)

    expect(url.searchParams.get('X-Amz-Expires')).toBe('120')
    expect(url.pathname).toContain('avatars/user/usr_1/abc.png')
    // La clé **secrète** n'apparaît nulle part. L'identifiant de clé, lui, est
    // dans `X-Amz-Credential` par construction de la signature — ce n'est pas
    // un secret, et le vérifier serait vérifier l'algorithme d'AWS.
    expect(result.upload.url).not.toContain(CREDENTIALS.secretAccessKey)
    expect(result.upload.method).toBe('PUT')
  })

  it('lie le type et la taille à la signature : l’URL ne vaut pas pour autre chose', async () => {
    const storage = createS3Storage(options())

    const result = await storage.presignUpload({
      key: 'avatars/user/usr_1/abc.png',
      contentType: 'image/png',
      contentLength: 1024,
      expiresInSeconds: 120,
    })

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    const signedHeaders =
      new URL(result.upload.url).searchParams.get('X-Amz-SignedHeaders') ?? ''

    expect(signedHeaders.split(';')).toEqual(
      expect.arrayContaining(['content-length', 'content-type', 'host']),
    )
    // Ce que l'appelant doit reposer à l'identique, rendu plutôt que deviné.
    expect(result.upload.headers).toMatchObject({
      'content-type': 'image/png',
      'content-length': '1024',
    })
  })

  it('borne l’échéance rendue par la durée demandée', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T10:00:00Z'))

    const storage = createS3Storage(options())
    const result = await storage.presignUpload({
      key: 'avatars/user/usr_1/abc.png',
      contentType: 'image/png',
      contentLength: 10,
      expiresInSeconds: 90,
    })

    expect(result.ok && result.upload.expiresAt.toISOString()).toBe('2026-09-01T10:01:30.000Z')
  })
})

describe('createS3Storage — lecture', () => {
  it('rend les octets et le type stockés', async () => {
    // Un corps binaire ne survit pas à `providerResponse` : la réponse est
    // construite ici, avec ses octets.
    globalThis.fetch = vi.fn(
      async () =>
        new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } }),
    ) as unknown as typeof fetch

    const storage = createS3Storage(options())
    const result = await storage.read('avatars/user/usr_1/abc.png')

    expect(result.ok).toBe(true)
    expect(result.ok && Array.from(result.object.bytes)).toEqual(Array.from(PNG_BYTES))
    expect(result.ok && result.object.contentType).toBe('image/png')
  })

  it('rend `not_found` sur un objet absent, sans rejouer', async () => {
    const calls = vi.fn(async () => providerResponse(404, '<Error><Code>NoSuchKey</Code></Error>'))
    globalThis.fetch = calls as unknown as typeof fetch

    const storage = createS3Storage(options())
    const result = await storage.read('avatars/user/usr_1/absent.png')

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('not_found')
    expect(calls).toHaveBeenCalledTimes(1)
  })
})

describe('createS3Storage — écriture par le serveur', () => {
  it('dépose les octets sous le type donné, et rend un résultat', async () => {
    const calls = vi.fn(async (_request: Request) => providerResponse(200))

    globalThis.fetch = calls as unknown as typeof fetch

    const storage = createS3Storage(options())
    const result = await storage.write({
      key: 'avatars/user/usr_1/abc.png',
      bytes: PNG_BYTES,
      contentType: 'image/png',
    })

    expect(result).toEqual({ ok: true })

    // La requête réellement sérialisée par le SDK : un `PUT` sur la clé
    // demandée, avec le type déclaré et les octets fournis.
    const request = calls.mock.calls[0]?.[0] as Request

    expect(request.method).toBe('PUT')
    expect(new URL(request.url).pathname).toContain('avatars/user/usr_1/abc.png')
    expect(request.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await request.arrayBuffer())).toEqual(PNG_BYTES)
  })

  it('rend un échec nommé plutôt que de lever quand le fournisseur refuse', async () => {
    globalThis.fetch = vi.fn(async () =>
      providerResponse(403, '<Error><Code>AccessDenied</Code></Error>'),
    ) as unknown as typeof fetch

    const storage = createS3Storage(options())
    const result = await storage.write({
      key: 'avatars/user/usr_1/abc.png',
      bytes: PNG_BYTES,
      contentType: 'image/png',
    })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('unauthorized')
  })
})

describe('createS3Storage — reprises', () => {
  it('rejoue une panne de fournisseur, dans la limite du nombre d’essais', async () => {
    const calls = vi.fn(async () => providerResponse(500, '<Error><Code>InternalError</Code></Error>'))
    globalThis.fetch = calls as unknown as typeof fetch

    const storage = createS3Storage(options({ maxAttempts: 3 }))
    const result = await storage.read('avatars/user/usr_1/abc.png')

    expect(calls).toHaveBeenCalledTimes(3)
    expect(!result.ok && result.error.code).toBe('provider_unavailable')
    expect(!result.ok && result.error.attempts).toBe(3)
  })

  it('ne rejoue pas un refus d’accès : la clé ne deviendra pas valide', async () => {
    const calls = vi.fn(async () => providerResponse(403, '<Error><Code>AccessDenied</Code></Error>'))
    globalThis.fetch = calls as unknown as typeof fetch

    const storage = createS3Storage(options({ maxAttempts: 3 }))
    const result = await storage.remove('avatars/user/usr_1/abc.png')

    expect(calls).toHaveBeenCalledTimes(1)
    expect(!result.ok && result.error.code).toBe('unauthorized')
  })

  it('recule en dispersant et en plafonnant, jamais à la même milliseconde', async () => {
    globalThis.fetch = vi.fn(async () =>
      providerResponse(503, '<Error><Code>SlowDown</Code></Error>'),
    ) as unknown as typeof fetch

    const waits: number[] = []
    const storage = createS3Storage(
      options({
        maxAttempts: 4,
        baseDelayMs: 100,
        maxDelayMs: 250,
        random: () => 0,
        sleep: async (ms: number) => {
          waits.push(ms)
        },
      }),
    )

    await storage.read('avatars/user/usr_1/abc.png')

    // Recul exponentiel — 100, 200, 400 —, dispersion « à moitié » (le tirage
    // vaut 0, donc la moitié basse), plafond à 250 : 50, 100, 125.
    expect(waits).toEqual([50, 100, 125])
  })

  it('borne l’attente de l’appelant même si le fournisseur ne répond jamais', async () => {
    globalThis.fetch = vi.fn(
      () => new Promise<Response>(() => undefined),
    ) as unknown as typeof fetch

    const storage = createS3Storage(options({ timeoutMs: 20, maxAttempts: 1 }))
    const result = await storage.read('avatars/user/usr_1/abc.png')

    expect(!result.ok && result.error.code).toBe('timeout')
  })
})

describe('createS3Storage — ce que l’appelant reçoit', () => {
  it('ne rejette jamais, même si le transport lève', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error(`socket fermée pendant Bearer ${CREDENTIALS.secretAccessKey}`)
    }) as unknown as typeof fetch

    const storage = createS3Storage(options({ maxAttempts: 1 }))
    const result = await storage.remove('avatars/user/usr_1/abc.png')

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.code).toBe('provider_unavailable')
    // `docs/security.md` §5 : le message du fournisseur est assaini, y compris
    // quand c'est lui qui y a mis le secret.
    expect(!result.ok && result.error.message).not.toContain(CREDENTIALS.secretAccessKey)
  })

  it('journalise sans jamais nommer la clé d’objet ni le seau', async () => {
    // Le fournisseur met **lui-même** la clé et le seau dans son message : c'est
    // la forme réelle d'un `<Message>` de S3, et c'est ce qui rend cette
    // assertion capable de mordre. Un corps sans message laisserait le cas vert
    // quelle que soit la redaction — mesuré.
    globalThis.fetch = vi.fn(async () =>
      providerResponse(
        500,
        '<Error><Code>InternalError</Code><Message>write failed for key ' +
          'avatars/user/usr_1/tres-secret.png in bucket avatars-test</Message></Error>',
      ),
    ) as unknown as typeof fetch

    const records: unknown[] = []
    const storage = createS3Storage(
      options({ maxAttempts: 2, logger: (record: unknown) => records.push(record) }),
    )

    await storage.read('avatars/user/usr_1/tres-secret.png')

    expect(records.length).toBeGreaterThan(0)
    expect(JSON.stringify(records)).not.toContain('usr_1')
    expect(JSON.stringify(records)).not.toContain('avatars-test')
    expect(records.at(-1)).toMatchObject({
      event: 'storage.operation_failed',
      operation: 'read',
      code: 'provider_unavailable',
    })
  })

  it('refuse de se construire sans identifiants plutôt que d’échouer à la première requête', () => {
    expect(() => createS3Storage(options({ secretAccessKey: '  ' }))).toThrow(
      /STORAGE_S3_SECRET_ACCESS_KEY/,
    )
  })
})

describe('createS3Storage — suppression', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => providerResponse(204)) as unknown as typeof fetch
  })

  it('rend un succès quand l’objet n’existait pas : une purge rejouée n’a pas d’effet de plus', async () => {
    const calls = vi.fn(async () => providerResponse(404, '<Error><Code>NoSuchKey</Code></Error>'))
    globalThis.fetch = calls as unknown as typeof fetch

    const storage = createS3Storage(options())

    expect(await storage.remove('avatars/user/usr_1/absent.png')).toEqual({ ok: true })
  })

  it('supprime réellement, par une requête DELETE portant la clé', async () => {
    const seen: { url: string; method: string }[] = []
    globalThis.fetch = vi.fn(async (input: Request) => {
      seen.push({ url: input.url, method: input.method })

      return providerResponse(204)
    }) as unknown as typeof fetch

    const storage = createS3Storage(options())

    expect(await storage.remove('avatars/user/usr_1/abc.png')).toEqual({ ok: true })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.method).toBe('DELETE')
    expect(seen[0]?.url).toContain('avatars/user/usr_1/abc.png')
  })
})
