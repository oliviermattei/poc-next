import { checkDatabaseConnection, createDatabaseClient } from '@repo/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isDatabaseReachable, databaseUrl } from './fixtures/database'

const UNREACHABLE_DATABASE_URL = 'postgres://app:app@localhost:1/app'

const loadHealthRoute = async () => {
  vi.resetModules()

  return await import('../apps/web/app/api/health/route')
}

const databaseReachable = await isDatabaseReachable()

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('répond 503 quand la base est injoignable', async () => {
    vi.stubEnv('DATABASE_URL', UNREACHABLE_DATABASE_URL)

    const { GET } = await loadHealthRoute()
    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ database: 'unreachable' })
  })

  it('répond 503 sans divulguer la chaîne de connexion', async () => {
    vi.stubEnv('DATABASE_URL', UNREACHABLE_DATABASE_URL)

    const { GET } = await loadHealthRoute()
    const body = await (await GET()).text()

    expect(body).not.toContain('localhost')
    expect(body).not.toContain('app:app')
  })

  it('nomme la cause réelle dans les journaux : un refus de connexion, pas « Failed query »', async () => {
    // Sur un hôte à double pile, le pilote lève une AggregateError au message
    // vide : sans déballage, le journal ne dit rien de l'échec.
    const connection = createDatabaseClient({
      connectionString: UNREACHABLE_DATABASE_URL,
      maxConnections: 1,
    })

    try {
      const status = await checkDatabaseConnection(connection)

      expect(status.connected).toBe(false)
      expect(status.reason).toMatch(/ECONNREFUSED/)
    } finally {
      await connection.close()
    }
  })

  it('refuse de construire un client sans chaîne de connexion', () => {
    // Sans cette garde, `pg` se rabat silencieusement sur les défauts de libpq
    // (utilisateur système, base locale) : la sonde peut alors répondre 200 en
    // interrogeant une base que personne n'a configurée.
    expect(() => createDatabaseClient({ connectionString: '' })).toThrowError(/DATABASE_URL/)
  })

  it('répond 503 quand DATABASE_URL est absente', async () => {
    vi.stubEnv('DATABASE_URL', '')

    const { GET } = await loadHealthRoute()

    expect((await GET()).status).toBe(503)
  })

  describe.skipIf(!databaseReachable)('avec une base joignable', () => {
    it('répond 200 et annonce la base connectée', async () => {
      vi.stubEnv('DATABASE_URL', databaseUrl)

      const { GET } = await loadHealthRoute()
      const response = await GET()

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        status: 'ok',
        database: 'connected',
      })
    })
  })
})
