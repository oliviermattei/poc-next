import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isDatabaseReachable, databaseUrl } from './fixtures/database'

const UNREACHABLE_DATABASE_URL = 'postgres://app:app@127.0.0.1:1/app'

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

    expect(body).not.toContain('127.0.0.1')
    expect(body).not.toContain('app:app')
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
