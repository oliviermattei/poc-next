import { describe, expect, it } from 'vitest'

import { getEnv, parseEnv } from '@repo/config'

const DATABASE_URL = 'postgres://user:password@localhost:5432/app'

describe('validation de l’environnement', () => {
  it('refuse une variable requise absente en la nommant', () => {
    expect(() => parseEnv({})).toThrowError(/DATABASE_URL/)
  })

  it('refuse une variable malformée en la nommant', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://user@localhost:3306/app' })).toThrowError(
      /DATABASE_URL/,
    )
  })

  it('accepte un environnement valide et applique les valeurs par défaut', () => {
    const env = parseEnv({ DATABASE_URL })

    expect(env.DATABASE_URL).toBe(DATABASE_URL)
    expect(env.NODE_ENV).toBe('development')
  })

  it('ne valide pas l’environnement pendant la phase de build de Next', () => {
    expect(() =>
      getEnv({ NEXT_PHASE: 'phase-production-build', NODE_ENV: 'production' }),
    ).not.toThrow()
  })
})
