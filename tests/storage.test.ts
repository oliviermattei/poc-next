import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import {
  buildRegistry,
  defineModule,
  exportModules,
  purgeModules,
  type ModuleScope,
  type ModuleSession,
} from '@repo/core'
import {
  createDatabaseClient,
  planModuleMigrations,
  runModuleMigrations,
  type DatabaseConnection,
} from '@repo/db'
import { authModule, authUser } from '@repo/module-auth'
import {
  AVATAR_MAX_BYTES,
  configureStorage,
  resetStorageService,
  scopePrefix,
  servedKeyOf,
  storageModule,
  storageRoutePath,
  type FileOwner,
  type StorageService,
} from '@repo/module-storage'
import type { Storage } from '@repo/ports'
import { createLocalDiskStorage } from '@repo/storage-testing'
import { initialsOf } from '@repo/ui'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { appLocales } from '../config/i18n'
import { databaseUrl, isDatabaseReachable } from './fixtures/database'
import { dispatchAllowingRateLimit } from './fixtures/rate-limit'

/**
 * Le stockage de fichiers, éprouvé **contre une vraie base et un vrai disque**,
 * à travers le répartiteur de modules — le même chemin qu'une requête de
 * l'application.
 *
 * Ce fichier porte ce qui décide de la story et rien de ce qui se prouve
 * ailleurs : les règles pures — signatures binaires, plafond de taille, forme
 * d'une clé — vivent dans
 * `packages/modules/storage/src/domain/storage-rules.test.ts`, et ce fichier ne
 * rejoue pas leur matrice. Il prouve qu'elles sont **appelées**, et que le
 * refus n'écrit rien.
 *
 * Cinq mesures :
 *
 * 1. **le périmètre** — le fichier d'un autre compte répond 404, ni 403 ni 200,
 *    et un membre d'organisation, lui, le lit ;
 * 2. **le contenu réel** — du HTML téléversé sous un en-tête `image/png` est
 *    refusé, et **l'objet est retiré du stockage** ;
 * 3. **le remplacement** — le précédent objet disparaît, et un rejeu ne laisse
 *    pas deux objets ;
 * 4. **la purge** — l'objet, pas seulement la ligne ; rejouée, aucun effet de
 *    plus ; et par `purgeModules`, dans l'ordre du contrat ;
 * 5. **le module coupé** — aucune route, aucune table sur une base vierge.
 */

const databaseReachable = await isDatabaseReachable()

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_URL = 'http://localhost:3000'

/**
 * Le **requis**, tenu par une doublure de contrat.
 *
 * `storage` déclare `requires: ['auth']`, donc aucun registre ne peut l'activer
 * sans lui. Le vrai module `auth` refuse en revanche d'être purgé sans son
 * service — lequel demande un mailer, un secret et une URL publique, c'est-à-dire
 * tout ce que cette suite n'a pas à monter pour parler de fichiers.
 *
 * Ce qui est doublé ici est donc un **contrat**, pas une règle : toutes les clés
 * vides, et une purge qui enregistre l'état de la table de fichiers **au moment
 * où elle s'exécute**. C'est ce qui rend l'ordre d'ADR 029 observable — le
 * dépendant avant son requis — au lieu d'être affirmé.
 */
let authPurgedWhenFilesRemained: boolean | null = null

const authStandIn = defineModule({
  id: 'auth',
  requires: [],
  schema: {},
  migrations: null,
  routes: [],
  navigation: [],
  publicUrls: () => [],
  messages: { fr: {}, en: {} },
  emails: [],
  webhooks: [],
  jobs: [],
  dataCategories: [],
  retention: {},
  purge: async (scope) => {
    // **Sans base, elle ne lit rien.** L'ordre d'ADR 029 n'est observable que
    // sur une vraie table, et le cas qui l'observe est déjà ignoré sans base ;
    // mais `le module coupé ne laisse aucune trace` parle de modularité, il
    // s'exécute partout, et il passe par cette doublure. Lire la connexion ici
    // le faisait échouer sur une pile qui ne nommait pas Postgres.
    if (!databaseReachable) {
      return
    }

    authPurgedWhenFilesRemained =
      scope.kind === 'user'
        ? (await rowsOf({ kind: 'user', id: scope.userId })) > 0
        : (await rowsOf({ kind: 'organization', id: scope.organizationId })) > 0
  },
  export: () => Promise.resolve({}),
})

/**
 * Le registre du module et de son requis, **construit par le test**.
 *
 * Il ne dépend donc pas de `config/features.ts` : les assertions portent sur la
 * modularité, pas sur l'état dans lequel le dépôt se trouve. C'est ce qui rend
 * ce fichier vert dans les deux configurations.
 */
const registry = buildRegistry({
  available: [authStandIn, storageModule],
  enabled: ['auth', 'storage'],
  locales: [...appLocales],
})

/** La même configuration, **sans** le module. */
const withoutStorage = buildRegistry({
  available: [authStandIn, storageModule],
  enabled: ['auth'],
  locales: [...appLocales],
})

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9])
const HTML = new TextEncoder().encode('<html><script>fetch("/vol")</script></html>')

let connection: DatabaseConnection
let service: StorageService
let directory: string
let local: ReturnType<typeof createLocalDiskStorage>

/**
 * Le périmètre d'écriture de la suite, **piloté par le test**.
 *
 * C'est ce que le point de composition de l'application fournit en production
 * (`dataOwnerOf`). L'injecter ici est ce qui permet d'éprouver les deux
 * périmètres — compte et organisation — sans monter le module `organizations`,
 * dont celui-ci ne dépend pas.
 */
let writeOwner: (userId: string) => FileOwner
let readScopes: (userId: string) => readonly FileOwner[]

const anAccount = async (): Promise<ModuleSession> => {
  const userId = `usr_s18_${randomUUID()}`

  await connection.db.insert(authUser).values({
    id: userId,
    name: 'Compte de test',
    email: `s18-${randomUUID()}@example.test`,
  })

  return { userId, roles: [] }
}

interface CallOptions {
  readonly session?: ModuleSession | null
  readonly body?: Record<string, unknown>
  readonly query?: Record<string, string>
}

/** Une requête telle que l'application la sert : par le répartiteur du registre. */
const call = async (
  path: 'presignAvatar' | 'confirmAvatar' | 'removeAvatar' | 'file' | 'localUpload',
  options: CallOptions = {},
  target = registry,
): Promise<Response> => {
  const url = new URL(`${APP_URL}${storageRoutePath(path)}`)

  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value)
  }

  const method = path === 'file' ? 'GET' : path === 'localUpload' ? 'PUT' : 'POST'
  const request =
    options.body === undefined
      ? new Request(url, { method })
      : new Request(url, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(options.body),
        })

  return await dispatchAllowingRateLimit(target, request, {
    resolveSession: () => Promise.resolve(options.session ?? null),
  })
}

/**
 * Présigner et téléverser, **sans confirmer** : l'objet d'attente existe alors
 * dans le stockage, et rien ne le référence encore.
 */
const stageAvatar = async (
  session: ModuleSession,
  bytes: Uint8Array,
  declared: { contentType: string; size?: number } = { contentType: 'image/png' },
): Promise<{ key: string; refused: Response | null }> => {
  const presigned = await call('presignAvatar', {
    session,
    body: { contentType: declared.contentType, size: declared.size ?? bytes.byteLength },
  })

  if (!presigned.ok) {
    return { key: '', refused: presigned }
  }

  const upload = (await presigned.json()) as {
    key: string
    url: string
    headers: Record<string, string>
  }

  // Le téléversement va **directement au stockage**, comme dans le navigateur :
  // les octets ne passent pas par une route de l'application.
  const stored = await local.handleUpload(
    new Request(new URL(upload.url, APP_URL), {
      method: 'PUT',
      headers: upload.headers,
      body: bytes.slice().buffer as ArrayBuffer,
    }),
  )

  expect(stored.status).toBe(200)

  return { key: upload.key, refused: null }
}

/**
 * Le parcours complet : présigner, téléverser, confirmer.
 *
 * Il rend **deux** clés, et la distinction est le cœur de l'ADR 033 : `key` est
 * la clé d'attente, celle que l'URL présignée nomme ; `served` est celle que la
 * route de lecture sert, écrite par le serveur à la confirmation. Aucune URL
 * présignée ne désigne la seconde.
 */
const uploadAvatar = async (
  session: ModuleSession,
  bytes: Uint8Array,
  declared: { contentType: string; size?: number } = { contentType: 'image/png' },
): Promise<{ key: string; served: string; confirm: Response }> => {
  const staged = await stageAvatar(session, bytes, declared)

  if (staged.refused !== null) {
    return { key: '', served: '', confirm: staged.refused }
  }

  return {
    key: staged.key,
    served: servedKeyOf(staged.key, writeOwner(session.userId)) ?? '',
    confirm: await call('confirmAvatar', { session, body: { key: staged.key } }),
  }
}

const objectExists = async (key: string): Promise<boolean> =>
  await stat(join(directory, key)).then(
    () => true,
    () => false,
  )

const rowsOf = async (owner: FileOwner): Promise<number> => {
  const counted = await connection.db.execute<{ count: number }>(
    sql`select count(*)::int as count from storage_file where owner_kind = ${owner.kind} and owner_id = ${owner.id}`,
  )

  return Number(counted.rows[0]?.count ?? 0)
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ks-s18-'))
  local = createLocalDiskStorage({ directory })

  if (!databaseReachable) {
    return
  }

  connection = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 5 })

  await runModuleMigrations({
    db: connection.db,
    plan: planModuleMigrations({ modules: [authModule, storageModule], repoRoot: REPO_ROOT }),
  })

  writeOwner = (userId) => ({ kind: 'user', id: userId })
  readScopes = (userId) => [{ kind: 'user', id: userId }]

  service = configureStorage({
    db: connection.db,
    storage: local.storage,
    localUpload: local.handleUpload,
    ownerOf: (userId) => Promise.resolve(writeOwner(userId)),
    readableScopes: (userId) => Promise.resolve(readScopes(userId)),
  })
})

afterAll(async () => {
  resetStorageService()
  await rm(directory, { recursive: true, force: true })

  if (databaseReachable) {
    await connection.db.execute(sql`delete from auth_user where email like 's18-%'`)
    await connection.db.execute(sql`delete from storage_file where owner_id like 'usr_s18_%'`)
    await connection.db.execute(sql`delete from storage_file where owner_id like 'org_s18_%'`)
    await connection.close()
  }
})

describe.runIf(databaseReachable)('le contenu réel décide, jamais l’en-tête', () => {
  it('accepte une image dont les octets sont ceux qu’elle annonce', async () => {
    const session = await anAccount()
    const { key, served, confirm } = await uploadAvatar(session, PNG)

    expect(confirm.status).toBe(200)
    // **Ce qui est servi n'est pas ce qui a été présigné** (ADR 033) : l'objet
    // d'attente est promu par le serveur, puis retiré.
    expect(served).not.toBe(key)
    expect(await objectExists(served)).toBe(true)
    expect(await objectExists(key)).toBe(false)
    expect(await rowsOf(writeOwner(session.userId))).toBe(1)
  })

  it('refuse du HTML téléversé sous un en-tête `image/png`, et retire l’objet', async () => {
    const session = await anAccount()
    const { key, confirm } = await uploadAvatar(session, HTML)

    expect(confirm.status).toBe(422)
    expect(await confirm.json()).toEqual({ error: 'content_mismatch' })
    // **Le refus n'écrit rien** — et il ne laisse rien non plus : l'objet
    // hostile est retiré du stockage, pas seulement ignoré.
    expect(await objectExists(key)).toBe(false)
    expect(await rowsOf(writeOwner(session.userId))).toBe(0)
  })

  it('refuse une image réelle dont le type ne correspond pas à celui présigné', async () => {
    const session = await anAccount()
    // Le fournisseur servirait cet objet en `image/png` : les octets, eux, sont
    // du JPEG. Servir un type qui ment est exactement ce que `nosniff` empêche
    // de rattraper.
    const { confirm } = await uploadAvatar(session, JPEG, { contentType: 'image/png' })

    expect(confirm.status).toBe(422)
    expect(await rowsOf(writeOwner(session.userId))).toBe(0)
  })

  it('refuse un type et une taille que le domaine n’accepte pas, sans rien présigner', async () => {
    const session = await anAccount()

    const svg = await call('presignAvatar', {
      session,
      body: { contentType: 'image/svg+xml', size: 100 },
    })
    const huge = await call('presignAvatar', {
      session,
      body: { contentType: 'image/png', size: AVATAR_MAX_BYTES + 1 },
    })

    expect(svg.status).toBe(422)
    expect(await svg.json()).toEqual({ error: 'unsupported_type' })
    expect(huge.status).toBe(422)
    expect(await huge.json()).toEqual({ error: 'too_large' })
    expect(await rowsOf(writeOwner(session.userId))).toBe(0)
  })
})

describe.runIf(databaseReachable)('le périmètre d’un fichier', () => {
  it('sert le fichier de son propriétaire et rend 404 à un autre compte', async () => {
    const owner = await anAccount()
    const stranger = await anAccount()
    const { confirm } = await uploadAvatar(owner, PNG)
    const { fileId } = (await confirm.json()) as { fileId: string }

    const mine = await call('file', { session: owner, query: { id: fileId } })

    expect(mine.status).toBe(200)
    expect(mine.headers.get('content-type')).toBe('image/png')
    expect(mine.headers.get('x-content-type-options')).toBe('nosniff')
    // **Aucun cache ne garde un avatar.** C'est une donnée personnelle servie
    // derrière une session : un intermédiaire partagé qui la conserverait la
    // servirait au visiteur suivant, et un cache privé la servirait encore
    // après une révocation. L'en-tête était juste et **aucun test ne le
    // tenait** — constat F4 de la revue.
    expect(mine.headers.get('cache-control')).toBe('private, no-store')
    expect(new Uint8Array(await mine.arrayBuffer())).toEqual(PNG)

    const theirs = await call('file', { session: stranger, query: { id: fileId } })
    const invented = await call('file', { session: stranger, query: { id: 'file_inconnu' } })

    // **404, jamais 403** : la réponse d'un fichier existant qu'on n'a pas le
    // droit de voir est exactement celle d'un identifiant inventé — même
    // statut, même corps (`docs/security.md` §3).
    expect(theirs.status).toBe(404)
    expect(invented.status).toBe(404)
    expect(await theirs.text()).toBe(await invented.text())
  })

  it('sert le fichier d’une organisation à ses membres, et à eux seuls', async () => {
    const organizationId = `org_s18_${randomUUID()}`
    const member = await anAccount()
    const outsider = await anAccount()

    writeOwner = () => ({ kind: 'organization', id: organizationId })
    readScopes = (userId) =>
      userId === member.userId
        ? [
            { kind: 'user', id: userId },
            { kind: 'organization', id: organizationId },
          ]
        : [{ kind: 'user', id: userId }]

    try {
      const { confirm } = await uploadAvatar(member, PNG)
      const { fileId } = (await confirm.json()) as { fileId: string }

      expect((await call('file', { session: member, query: { id: fileId } })).status).toBe(200)
      // Le fichier appartient à une organisation dont ce compte n'est pas
      // membre : il n'existe pas, pour lui (critère 5).
      expect((await call('file', { session: outsider, query: { id: fileId } })).status).toBe(404)
    } finally {
      writeOwner = (userId) => ({ kind: 'user', id: userId })
      readScopes = (userId) => [{ kind: 'user', id: userId }]
    }
  })

  it('affiche l’avatar du périmètre où il vient d’être écrit, et le retire du même', async () => {
    const organizationId = `org_s18_${randomUUID()}`
    const member = await anAccount()

    // Le périmètre d'écriture est ici celui d'une organisation. **L'écran doit
    // suivre** : c'est le constat F1 de la revue, où l'écriture partait dans le
    // périmètre de l'organisation active pendant que l'affichage lisait
    // toujours celui du compte — l'avatar téléversé n'apparaissait pas, et
    // « Retirer » effaçait le fichier d'un autre périmètre en rendant un succès.
    writeOwner = () => ({ kind: 'organization', id: organizationId })

    try {
      const { served, confirm } = await uploadAvatar(member, PNG)
      const { fileId } = (await confirm.json()) as { fileId: string }

      // **Une seule résolution de propriétaire**, celle du point de
      // composition : le module n'a aucune autre source d'appartenance à
      // l'écriture, à l'affichage et à la suppression.
      expect((await service.avatarOfUser(member.userId))?.fileId).toBe(fileId)

      expect((await call('removeAvatar', { session: member })).status).toBe(204)
      expect(await service.avatarOfUser(member.userId)).toBe(null)
      expect(await objectExists(served)).toBe(false)
    } finally {
      writeOwner = (userId) => ({ kind: 'user', id: userId })
    }
  })

  it('refuse de confirmer une clé qui n’est pas dans le périmètre de l’appelant', async () => {
    const owner = await anAccount()
    const attacker = await anAccount()
    // **Téléversé, pas encore confirmé** : l'objet d'attente de la victime
    // existe bel et bien dans le stockage, et c'est ce que l'attaquant tente de
    // s'approprier.
    const { key } = await stageAvatar(owner, PNG)

    // La clé est réelle, l'objet existe, et l'appelant n'a rien à y voir.
    const stolen = await call('confirmAvatar', { session: attacker, body: { key } })
    // Une clé forgée sous **son propre** préfixe, mais sans objet derrière.
    const forged = await call('confirmAvatar', {
      session: attacker,
      body: { key: `${scopePrefix({ kind: 'user', id: attacker.userId })}invente.png` },
    })

    expect(stolen.status).toBe(404)
    expect(forged.status).toBe(404)
    expect(await rowsOf(writeOwner(attacker.userId))).toBe(0)
    // Et l'objet de la victime n'a pas bougé.
    expect(await objectExists(key)).toBe(true)
  })

  it('refuse toutes les routes à un visiteur anonyme, avant d’atteindre le module', async () => {
    for (const path of ['presignAvatar', 'confirmAvatar', 'removeAvatar', 'file'] as const) {
      expect((await call(path, { session: null })).status).toBe(401)
    }
  })
})

describe.runIf(databaseReachable)('l’URL présignée ne désigne jamais ce qui est servi', () => {
  it('rejouée après la confirmation, elle ne remplace pas les octets vérifiés', async () => {
    const session = await anAccount()
    const presigned = await call('presignAvatar', {
      session,
      body: { contentType: 'image/png', size: PNG.byteLength },
    })
    const upload = (await presigned.json()) as {
      key: string
      url: string
      headers: Record<string, string>
    }

    const put = async (bytes: Uint8Array): Promise<Response> =>
      await local.handleUpload(
        new Request(new URL(upload.url, APP_URL), {
          method: 'PUT',
          headers: upload.headers,
          body: bytes.slice().buffer as ArrayBuffer,
        }),
      )

    expect((await put(PNG)).status).toBe(200)

    const confirm = await call('confirmAvatar', { session, body: { key: upload.key } })
    const { fileId } = (await confirm.json()) as { fileId: string }

    expect(confirm.status).toBe(200)

    // **Le rejeu.** Des octets arbitraires de **même longueur** et de même type
    // que ceux signés : le fournisseur les accepte, comme un vrai seau
    // accepterait une URL présignée non expirée — aucune API ne permet de la
    // révoquer.
    const forged = new Uint8Array(PNG.byteLength).fill(0x41)

    expect((await put(forged)).status).toBe(200)

    // Et ce qui est servi n'a pas bougé : la clé servie n'est pas celle que
    // l'URL présignée nomme (constat F2 de la revue, mesuré au navigateur).
    const served = await call('file', { session, query: { id: fileId } })

    expect(served.status).toBe(200)
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG)
  })
})

describe.runIf(databaseReachable)('le remplacement et le rejeu', () => {
  it('supprime l’objet précédent quand l’avatar est remplacé', async () => {
    const session = await anAccount()
    const first = await uploadAvatar(session, PNG)
    const second = await uploadAvatar(session, JPEG, { contentType: 'image/jpeg' })

    expect(second.confirm.status).toBe(200)
    expect(first.served).not.toBe(second.served)
    // **Un seul objet, une seule ligne** : le remplacement ne laisse pas
    // d'orphelin (critère 4, `docs/reliability.md` §1).
    expect(await objectExists(first.served)).toBe(false)
    expect(await objectExists(second.served)).toBe(true)
    expect(await rowsOf(writeOwner(session.userId))).toBe(1)
  })

  it('confirmer deux fois la même clé ne supprime pas ce qui vient d’être enregistré', async () => {
    const session = await anAccount()
    const { key, served, confirm } = await uploadAvatar(session, PNG)

    expect(confirm.status).toBe(200)

    const again = await call('confirmAvatar', { session, body: { key } })

    // La clé d'attente a été consommée par la promotion : elle ne désigne plus
    // rien, donc 404 (ADR 033, conséquence 3). Ce qui compte est la ligne
    // suivante : **l'avatar enregistré n'a pas bougé**.
    expect(again.status).toBe(404)
    // Et le **motif** ne ment pas sur ce qui s'est passé : le refus est juste,
    // mais l'avatar a bien changé. « Cet envoi n'est plus valide » était faux —
    // c'est ce code que l'écran traduit.
    expect(await again.json()).toEqual({ error: 'already_confirmed' })
    expect(await objectExists(served)).toBe(true)
    expect(await rowsOf(writeOwner(session.userId))).toBe(1)
  })

  it('une clé d’attente jamais déposée rend le refus indistinct d’une clé étrangère', async () => {
    const session = await anAccount()
    const { key, served } = await uploadAvatar(session, PNG)
    // Une clé du **périmètre de l'appelant**, de la forme exacte de celles que
    // nous fabriquons, mais qu'aucun téléversement n'a produite. Le motif
    // `already_confirmed` ne doit pas y répondre : il dirait « cet objet-là a
    // été promu », donc il deviendrait un oracle d'existence, fût-ce dans son
    // propre préfixe.
    const invented = key.replace(/\/[^/]+$/, '/jamais-deposee.png')

    expect(invented).not.toBe(key)

    const response = await call('confirmAvatar', { session, body: { key: invented } })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not_found' })
    // L'avatar réellement enregistré est intact : le refus n'a rien touché.
    expect(await objectExists(served)).toBe(true)
    expect(await rowsOf(writeOwner(session.userId))).toBe(1)
  })

  it('retire l’avatar : la ligne **et** l’objet', async () => {
    const session = await anAccount()
    const { served } = await uploadAvatar(session, PNG)

    expect((await call('removeAvatar', { session })).status).toBe(204)
    expect(await objectExists(served)).toBe(false)
    expect(await rowsOf(writeOwner(session.userId))).toBe(0)
    // Rejoué : aucun effet de plus, et pas d'échec.
    expect((await call('removeAvatar', { session })).status).toBe(204)
  })
})

describe.runIf(databaseReachable)('la purge et l’export du contrat de module', () => {
  it('la purge supprime l’objet stocké, pas seulement la ligne', async () => {
    const session = await anAccount()
    const { served } = await uploadAvatar(session, PNG)
    const scope: ModuleScope = { kind: 'user', userId: session.userId }

    expect(await objectExists(served)).toBe(true)
    authPurgedWhenFilesRemained = null

    await purgeModules(registry, scope)

    // C'est le défaut exact que s16 a laissé passer sur une adresse : la ligne
    // partait, la donnée restait.
    expect(await objectExists(served)).toBe(false)
    expect(await rowsOf(writeOwner(session.userId))).toBe(0)
    // **L'ordre du graphe, à l'envers** (ADR 029) : le requis est purgé après
    // son dépendant, donc les fichiers ont déjà disparu quand `auth` s'exécute.
    // Purgé dans l'autre sens, `storage` ne pourrait plus résoudre ce qu'il
    // doit effacer — c'est ce qui a laissé une adresse survivre en s16.
    expect(authPurgedWhenFilesRemained).toBe(false)
  })

  it('la purge rejouée n’a aucun effet supplémentaire', async () => {
    const session = await anAccount()

    await uploadAvatar(session, PNG)

    const scope: ModuleScope = { kind: 'user', userId: session.userId }

    await purgeModules(registry, scope)
    await expect(purgeModules(registry, scope)).resolves.toMatchObject({
      ok: true,
      purged: expect.arrayContaining(['storage']),
    })
    expect(await rowsOf(writeOwner(session.userId))).toBe(0)
  })

  it('l’export liste les fichiers du périmètre, sans jamais rendre la clé d’objet', async () => {
    const session = await anAccount()
    const { served } = await uploadAvatar(session, PNG)

    const outcome = await exportModules(registry, { kind: 'user', userId: session.userId })

    expect(outcome.ok).toBe(true)

    const payload = outcome.ok ? outcome.payloads : {}
    const files = (payload['storage'] as { files: readonly Record<string, unknown>[] }).files

    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ purpose: 'avatar', contentType: 'image/png' })
    // La clé nomme l'emplacement d'un objet dans un seau : elle n'a rien à
    // faire dans un export remis à la personne (`docs/security.md` §5).
    expect(JSON.stringify(payload)).not.toContain(served)
  })
})

describe('le module coupé ne laisse aucune trace', () => {
  it('n’expose aucune des cinq routes', async () => {
    const session: ModuleSession = { userId: 'usr_absent', roles: [] }

    for (const path of [
      'presignAvatar',
      'confirmAvatar',
      'removeAvatar',
      'file',
      'localUpload',
    ] as const) {
      const response = await call(path, { session }, withoutStorage)

      // 404 et non 401 : la route n'est pas protégée, elle **n'est pas montée**.
      expect(response.status).toBe(404)
    }
  })

  it('ne déclare aucune entrée de navigation, activé comme coupé', () => {
    expect(registry.navigation.filter((entry) => entry.moduleId === 'storage')).toEqual([])
  })

  it('n’est ni purgé ni exporté quand il est coupé', async () => {
    const scope: ModuleScope = { kind: 'user', userId: 'usr_absent' }

    expect((await purgeModules(withoutStorage, scope)).purged).not.toContain('storage')
    expect(Object.keys(await exportModules(withoutStorage, scope))).not.toContain('storage')
  })
})

describe.runIf(databaseReachable)('la route de téléversement local', () => {
  it('sert quand le stockage sur disque est monté', async () => {
    const session = await anAccount()
    const presigned = await call('presignAvatar', {
      session,
      body: { contentType: 'image/png', size: PNG.byteLength },
    })
    const upload = (await presigned.json()) as { url: string; headers: Record<string, string> }

    // L'URL présignée du mode local **reste sur notre origine** : c'est ce qui
    // fait que l'état livré téléverse sans qu'aucune source n'entre dans
    // `config/security.ts`, où `connect-src 'self'` refuserait un domaine tiers.
    expect(upload.url.startsWith('/api/modules/storage/local-upload?')).toBe(true)

    const stored = await dispatchAllowingRateLimit(
      registry,
      new Request(new URL(upload.url, APP_URL), {
        method: 'PUT',
        headers: upload.headers,
        body: PNG.slice().buffer as ArrayBuffer,
      }),
      { resolveSession: () => Promise.resolve(session) },
    )

    expect(stored.status).toBe(200)
  })

  it('répond 404 quand le point de composition n’a monté aucun stockage local', async () => {
    const session = await anAccount()
    const withoutLocal = configureStorage({
      db: connection.db,
      storage: local.storage,
      // Pas de `localUpload` : c'est l'état d'un déploiement muni d'un vrai
      // seau, où le navigateur écrit directement chez le fournisseur.
      ownerOf: (userId) => Promise.resolve(writeOwner(userId)),
      readableScopes: (userId) => Promise.resolve(readScopes(userId)),
    })

    try {
      expect(withoutLocal.localUpload).toBe(null)
      expect((await call('localUpload', { session })).status).toBe(404)
    } finally {
      service = configureStorage({
        db: connection.db,
        storage: local.storage,
        localUpload: local.handleUpload,
        ownerOf: (userId) => Promise.resolve(writeOwner(userId)),
        readableScopes: (userId) => Promise.resolve(readScopes(userId)),
      })
      expect(service.localUpload).not.toBe(null)
    }
  })
})

describe('le repli sur les initiales', () => {
  it('dérive deux caractères d’un nom, et rien d’un nom vide', () => {
    expect(initialsOf('Alice Martin')).toBe('AM')
    expect(initialsOf('Marie-Claire Le Guen')).toBe('MG')
    expect(initialsOf('cher')).toBe('CH')
    expect(initialsOf('  ')).toBe('')
    // Un nom accentué reste lisible : la mise en majuscule suit la locale.
    expect(initialsOf('Élodie Ötsch')).toBe('ÉÖ')
  })
})

describe('la configuration du stockage', () => {
  it('exige un choix : un seau, ou le disque, jamais rien et jamais les deux', async () => {
    const { resolveStorageConfig } = await import('../apps/web/lib/storage-config')
    const { envSchema } = await import('@repo/config')

    const s3 = {
      STORAGE_S3_BUCKET: 'avatars',
      STORAGE_S3_REGION: 'auto',
      STORAGE_S3_ACCESS_KEY_ID: 'AKIA0000000000000000',
      STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
    }

    // L'origine du seau est déclarée ici comme le propriétaire du projet la
    // déclarerait dans `config/security.ts` — sans elle, le démarrage est
    // refusé, et c'est le cas suivant qui le mesure.
    expect(
      resolveStorageConfig({ ...s3 } as never, ['https://s3.auto.amazonaws.com']),
    ).toMatchObject({ kind: 's3' })
    expect(resolveStorageConfig({ STORAGE_LOCAL_DIRECTORY: '.storage' } as never)).toEqual({
      kind: 'local-disk',
      directory: '.storage',
    })

    // **Rien n'est configuré** : le montage refuse, en nommant les variables.
    // Le mode local est un opt-in, jamais le repli d'un seau absent — sans quoi
    // un déploiement écrirait sur un disque éphémère en rendant un succès.
    expect(() => resolveStorageConfig({} as never)).toThrow(/STORAGE_LOCAL_DIRECTORY/)
    expect(() => resolveStorageConfig({} as never)).toThrow(/STORAGE_S3_BUCKET/)

    // Les deux à la fois : refusé par le schéma d'environnement, comme la
    // capture locale des emails l'est face à une clé Resend.
    const both = envSchema.safeParse({
      DATABASE_URL: 'postgres://x/y',
      ...s3,
      STORAGE_LOCAL_DIRECTORY: '.storage',
    })

    expect(both.success).toBe(false)

    // Un seau à moitié renseigné : refusé, en **nommant** l'absente.
    const partial = envSchema.safeParse({
      DATABASE_URL: 'postgres://x/y',
      STORAGE_S3_BUCKET: 'avatars',
    })

    expect(partial.success).toBe(false)
    expect(JSON.stringify(partial.error?.issues)).toContain('STORAGE_S3_SECRET_ACCESS_KEY')
  })

  it('ne dépend jamais de `NODE_ENV` pour choisir', async () => {
    const { resolveStorageConfig } = await import('../apps/web/lib/storage-config')

    const bucket = {
      STORAGE_S3_BUCKET: 'avatars',
      STORAGE_S3_REGION: 'auto',
      STORAGE_S3_ACCESS_KEY_ID: 'AKIA0000000000000000',
      STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
      STORAGE_S3_ENDPOINT: 'https://compte.r2.cloudflarestorage.com',
    }

    // Les deux axes croisés : production et développement, avec seau puis sans
    // rien. Si `NODE_ENV` reprenait la main, l'un des deux changerait de
    // branche.
    for (const NODE_ENV of ['production', 'development'] as const) {
      expect(
        resolveStorageConfig({ NODE_ENV, ...bucket } as never, [
          'https://compte.r2.cloudflarestorage.com',
        ]),
      ).toMatchObject({ kind: 's3' })
      expect(() => resolveStorageConfig({ NODE_ENV } as never)).toThrow()
    }
  })

  it('refuse d’armer le stockage sur disque sous `NODE_ENV=production`', async () => {
    const { resolveStorageConfig } = await import('../apps/web/lib/storage-config')

    // Même arbitrage que `OAUTH_LOCAL_PROVIDER` (s12), et pour un risque de
    // même nature : un `.env` recopié d'un poste écrirait les avatars sur le
    // disque éphémère d'une fonction serverless, et personne ne le verrait
    // avant le premier redéploiement — l'avatar disparaîtrait sans erreur.
    // `NODE_ENV` n'**arme** toujours rien : il **restreint**.
    expect(() =>
      resolveStorageConfig({
        NODE_ENV: 'production',
        STORAGE_LOCAL_DIRECTORY: '.storage',
      } as never),
    ).toThrow(/STORAGE_LOCAL_DIRECTORY/)
    expect(
      resolveStorageConfig({ NODE_ENV: 'development', STORAGE_LOCAL_DIRECTORY: '.storage' } as never),
    ).toEqual({ kind: 'local-disk', directory: '.storage' })
  })

  it('refuse un seau réel dont l’origine n’est pas déclarée dans `config/security.ts`', async () => {
    const { resolveStorageConfig } = await import('../apps/web/lib/storage-config')
    const { contentSecurityPolicySources } = await import('../config/security')

    const aws = {
      STORAGE_S3_BUCKET: 'avatars',
      STORAGE_S3_REGION: 'eu-west-3',
      STORAGE_S3_ACCESS_KEY_ID: 'AKIA0000000000000000',
      STORAGE_S3_SECRET_ACCESS_KEY: 'secret',
    }

    // **L'état livré** ne déclare aucune source : un seau réel arrête donc le
    // démarrage. C'était le constat F3 de la revue — l'exigence était écrite à
    // trois endroits, et quatre variables renseignées passaient `dev`, `build`
    // et la CI. L'échec n'apparaissait que dans le navigateur du premier
    // utilisateur, invisible côté serveur, parce que `connect-src 'self'`
    // refuse le `PUT` direct vers le seau.
    expect(contentSecurityPolicySources.connect).toEqual([])
    expect(() => resolveStorageConfig(aws as never)).toThrow(/config\/security\.ts/)
    expect(() => resolveStorageConfig(aws as never)).toThrow(/connect/)
    // Le message **nomme l'origine** qu'il faut déclarer : sans elle, il faut
    // deviner la forme d'URL que le SDK construit.
    expect(() => resolveStorageConfig(aws as never)).toThrow(
      /https:\/\/s3\.eu-west-3\.amazonaws\.com/,
    )

    // Déclarée, elle passe. Et c'est l'**origine du point de terminaison** qui
    // compte quand il y en a un — R2, MinIO, Spaces.
    expect(resolveStorageConfig(aws as never, ['https://s3.eu-west-3.amazonaws.com'])).toMatchObject(
      { kind: 's3' },
    )
    expect(() =>
      resolveStorageConfig(
        { ...aws, STORAGE_S3_ENDPOINT: 'https://compte.r2.cloudflarestorage.com' } as never,
        ['https://s3.eu-west-3.amazonaws.com'],
      ),
    ).toThrow(/https:\/\/compte\.r2\.cloudflarestorage\.com/)
  })
})

/**
 * Le port `Storage`, éprouvé sur sa **forme** plutôt que sur un fournisseur.
 *
 * Un seul cas, et il ne rejoue pas ce que les deux implémentations prouvent
 * chez elles : il vérifie que l'appelant reçoit un résultat et non une
 * exception quand tout échoue — la propriété que le port existe pour garantir
 * (`docs/reliability.md` §2).
 */
describe.runIf(databaseReachable)('un stockage en panne dégrade, il ne casse pas', () => {
  it('rend un refus nommé plutôt que de faire tomber la requête', async () => {
    const broken: Storage = {
      presignUpload: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'provider_unavailable', message: 'panne simulée', attempts: 2 },
        }),
      read: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'provider_unavailable', message: 'panne simulée', attempts: 2 },
        }),
      write: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'provider_unavailable', message: 'panne simulée', attempts: 2 },
        }),
      remove: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'provider_unavailable', message: 'panne simulée', attempts: 2 },
        }),
    }

    const session = await anAccount()

    configureStorage({
      db: connection.db,
      storage: broken,
      ownerOf: (userId) => Promise.resolve(writeOwner(userId)),
      readableScopes: (userId) => Promise.resolve(readScopes(userId)),
    })

    try {
      const presigned = await call('presignAvatar', {
        session,
        body: { contentType: 'image/png', size: 10 },
      })

      expect(presigned.status).toBe(422)
      expect(await presigned.json()).toEqual({ error: 'storage_unavailable' })
    } finally {
      service = configureStorage({
        db: connection.db,
        storage: local.storage,
        localUpload: local.handleUpload,
        ownerOf: (userId) => Promise.resolve(writeOwner(userId)),
        readableScopes: (userId) => Promise.resolve(readScopes(userId)),
      })
    }
  })
})

/**
 * **Garde d'inertie** : sans base, les deux tiers de ce fichier ne s'exécutent
 * pas, et le dire est la seule façon de distinguer « mesuré » de « ignoré ».
 *
 * C'est aussi ce qui remplace l'échec opaque que ce fichier produisait
 * auparavant : la doublure d'`auth` lisait la connexion pendant un cas de
 * modularité qui, lui, n'a besoin d'aucune base — la pile qui en sortait
 * (`Cannot read properties of undefined`) ne nommait ni Postgres ni la
 * commande qui le réveille. Même forme que `tests/organizations.test.ts`.
 */
describe('la base de données de la suite', () => {
  it('est joignable', () => {
    expect(databaseReachable, 'docker compose up -d, puis DATABASE_URL').toBe(true)
  })
})
