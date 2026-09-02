import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createLocalDiskStorage, LOCAL_UPLOAD_PATH } from './local-disk-storage'

/**
 * Le stockage sur disque — **un outil de développement**, pas un fournisseur.
 *
 * Ce que ce fichier éprouve n'est pas « ça écrit un fichier » : c'est que
 * l'URL présignée qu'il rend a les trois propriétés que
 * `docs/security.md` §4 exige d'une URL signée — elle ne dure pas, elle ne vaut
 * que pour la clé qu'elle nomme, et elle ne permet pas d'écrire hors du
 * dossier.
 */

const directories: string[] = []

const newDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'ks-storage-'))

  directories.push(directory)

  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const KEY = 'avatars/user/usr_1/abcdef.png'

const uploadRequest = (url: string, body: Uint8Array, contentType = 'image/png'): Request =>
  new Request(new URL(url, 'http://localhost:3000'), {
    method: 'PUT',
    headers: { 'content-type': contentType, 'content-length': String(body.byteLength) },
    body,
  })

const presign = async (
  local: ReturnType<typeof createLocalDiskStorage>,
  overrides: { key?: string; contentLength?: number; expiresInSeconds?: number } = {},
) =>
  await local.storage.presignUpload({
    key: overrides.key ?? KEY,
    contentType: 'image/png',
    contentLength: overrides.contentLength ?? PNG.byteLength,
    expiresInSeconds: overrides.expiresInSeconds ?? 60,
  })

describe('createLocalDiskStorage — l’URL présignée', () => {
  it('reste sur notre propre origine, donc `connect-src \'self\'` suffit', async () => {
    const local = createLocalDiskStorage({ directory: await newDirectory() })
    const result = await presign(local)

    expect(result.ok).toBe(true)
    // Un chemin, pas une URL absolue : c'est ce qui fait que l'état livré du
    // dépôt téléverse sans qu'aucune source n'entre dans `config/security.ts`.
    expect(result.ok && result.upload.url.startsWith(`${LOCAL_UPLOAD_PATH}?`)).toBe(true)
    expect(result.ok && /^[a-z]+:\/\//.test(result.upload.url)).toBe(false)
  })

  it('téléverse puis relit les octets et le type', async () => {
    const directory = await newDirectory()
    const local = createLocalDiskStorage({ directory })
    const result = await presign(local)

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    const response = await local.handleUpload(uploadRequest(result.upload.url, PNG))

    expect(response.status).toBe(200)

    const read = await local.storage.read(KEY)

    expect(read.ok && Array.from(read.object.bytes)).toEqual(Array.from(PNG))
    expect(read.ok && read.object.contentType).toBe('image/png')
  })

  it('ne dure pas : passée l’échéance, rien n’est écrit', async () => {
    const directory = await newDirectory()
    let clock = Date.parse('2026-09-01T10:00:00Z')
    const local = createLocalDiskStorage({ directory, now: () => clock })
    const result = await presign(local, { expiresInSeconds: 30 })

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    clock += 31_000

    const response = await local.handleUpload(uploadRequest(result.upload.url, PNG))

    expect(response.status).toBe(403)
    expect(await local.storage.read(KEY)).toMatchObject({ ok: false })
  })

  it('ne vaut que pour la clé qu’elle nomme', async () => {
    const directory = await newDirectory()
    const local = createLocalDiskStorage({ directory })
    const result = await presign(local)

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    // La signature couvre la clé : la remplacer sans resigner ne vaut rien.
    const detourned = new URL(result.upload.url, 'http://localhost:3000')

    detourned.searchParams.set('key', 'avatars/user/usr_2/vole.png')

    const response = await local.handleUpload(
      uploadRequest(`${detourned.pathname}${detourned.search}`, PNG),
    )

    expect(response.status).toBe(403)
    expect(await local.storage.read('avatars/user/usr_2/vole.png')).toMatchObject({ ok: false })
  })

  it('ne vaut que pour la taille et le type qu’elle annonce', async () => {
    const directory = await newDirectory()
    const local = createLocalDiskStorage({ directory })
    const result = await presign(local)

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    const tooBig = new Uint8Array(PNG.byteLength + 10)
    const bigger = await local.handleUpload(uploadRequest(result.upload.url, tooBig))
    const wrongType = await local.handleUpload(
      uploadRequest(result.upload.url, PNG, 'text/html'),
    )

    expect(bigger.status).toBe(403)
    expect(wrongType.status).toBe(403)
    expect(await local.storage.read(KEY)).toMatchObject({ ok: false })
  })
})

describe('createLocalDiskStorage — le dossier est une frontière', () => {
  it('refuse une clé qui sort du dossier, et n’écrit rien dehors', async () => {
    const directory = await newDirectory()
    const local = createLocalDiskStorage({ directory })
    const escape = '../../evade.png'

    expect(await presign(local, { key: escape })).toMatchObject({
      ok: false,
      error: { code: 'invalid_request' },
    })

    // Ceinture par-dessus les bretelles : même en forgeant la requête, rien
    // n'est écrit hors du dossier.
    const forged = new URL(LOCAL_UPLOAD_PATH, 'http://localhost:3000')

    forged.searchParams.set('key', escape)
    forged.searchParams.set('signature', 'peu-importe')

    expect(
      (await local.handleUpload(uploadRequest(`${forged.pathname}${forged.search}`, PNG)))
        .status,
    ).toBe(403)
    await expect(stat(join(directory, '..', '..', 'evade.png'))).rejects.toThrow()
  })

  it('refuse d’écrire hors du dossier, y compris par le serveur', async () => {
    const directory = await newDirectory()
    const local = createLocalDiskStorage({ directory })

    // `write` est la voie de la **promotion** : l'application y pose des octets
    // qu'elle vient de valider. Elle ne dispense de rien — la clé passe par la
    // même frontière que le téléversement.
    expect(
      await local.storage.write({
        key: '../../evade.png',
        bytes: PNG,
        contentType: 'image/png',
      }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_request' } })
    await expect(stat(join(directory, '..', '..', 'evade.png'))).rejects.toThrow()

    // Écrite sous une clé du dossier, elle est relisible avec son type — c'est
    // ce que la route de lecture sert.
    expect(await local.storage.write({ key: KEY, bytes: PNG, contentType: 'image/png' })).toEqual({
      ok: true,
    })
    expect(await local.storage.read(KEY)).toMatchObject({
      ok: true,
      object: { contentType: 'image/png' },
    })
  })

  it('refuse un segment `..` déguisé en nom de fichier', async () => {
    const local = createLocalDiskStorage({ directory: await newDirectory() })

    expect(await presign(local, { key: 'avatars/user/../../etc/passwd' })).toMatchObject({
      ok: false,
    })
  })
})

describe('createLocalDiskStorage — dégradation et rejeu', () => {
  it('rend un échec plutôt que de lever quand le disque refuse', async () => {
    const directory = await newDirectory()
    const local = createLocalDiskStorage({ directory })
    const result = await presign(local)

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    // Le dossier disparaît **et** son emplacement devient un fichier : plus
    // aucune écriture n'y est possible.
    await rm(directory, { recursive: true, force: true })
    await (await import('node:fs/promises')).writeFile(directory, 'pas un dossier', 'utf8')

    const response = await local.handleUpload(uploadRequest(result.upload.url, PNG))

    expect(response.status).toBe(500)
    expect(await local.storage.remove(KEY)).toMatchObject({ ok: false })
  })

  it('supprime, et une seconde suppression n’a aucun effet de plus', async () => {
    const directory = await newDirectory()
    const local = createLocalDiskStorage({ directory })
    const result = await presign(local)

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    await local.handleUpload(uploadRequest(result.upload.url, PNG))

    expect(await local.storage.remove(KEY)).toEqual({ ok: true })
    expect(await local.storage.remove(KEY)).toEqual({ ok: true })
    expect(await local.storage.read(KEY)).toMatchObject({ ok: false, error: { code: 'not_found' } })
  })

  it('écrit sous le dossier injecté, jamais sous un chemin deviné', async () => {
    const directory = await newDirectory()
    const local = createLocalDiskStorage({ directory })
    const result = await presign(local)

    expect(result.ok).toBe(true)

    if (!result.ok) {
      return
    }

    await local.handleUpload(uploadRequest(result.upload.url, PNG))

    expect(Array.from(await readFile(join(directory, KEY)))).toEqual(Array.from(PNG))
  })
})
