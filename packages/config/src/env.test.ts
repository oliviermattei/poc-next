import { describe, expect, it, vi } from 'vitest'

import { getEnv, parseEnv } from './env'

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

  it('accepte un environnement sans clé d’email : le mailer dégrade en capture locale', () => {
    // `docs/reliability.md` §2 : aucun port ne dépend d'une clé d'API pour
    // fonctionner en local. Rendre `RESEND_API_KEY` obligatoire ferait échouer
    // le démarrage d'un développeur qui n'envoie aucun email.
    expect(() => parseEnv({ DATABASE_URL })).not.toThrow()
  })

  it('refuse une clé d’email sans expéditeur, en nommant la variable', () => {
    // Sans EMAIL_FROM, l'adapter part avec un expéditeur vide et l'échec
    // n'apparaît qu'au premier email refusé par le fournisseur — en
    // production, sur un parcours d'inscription.
    expect(() => parseEnv({ DATABASE_URL, RESEND_API_KEY: 're_abc123' })).toThrowError(
      /EMAIL_FROM/,
    )
  })

  it('refuse un expéditeur qui n’est pas une adresse, en le nommant', () => {
    expect(() =>
      parseEnv({ DATABASE_URL, RESEND_API_KEY: 're_abc123', EMAIL_FROM: 'Killer SaaS' }),
    ).toThrowError(/EMAIL_FROM/)
  })

  it('accepte un expéditeur nommé comme une adresse nue', () => {
    for (const EMAIL_FROM of ['envoi@example.test', 'Killer SaaS <envoi@example.test>']) {
      expect(parseEnv({ DATABASE_URL, RESEND_API_KEY: 're_abc123', EMAIL_FROM }).EMAIL_FROM).toBe(
        EMAIL_FROM,
      )
    }
  })

  it('annonce bruyamment que SKIP_ENV_VALIDATION désactive la validation', () => {
    // Une trappe silencieuse est pire que pas de trappe : elle transforme une
    // variable manquante en comportement par défaut du pilote.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      getEnv({ SKIP_ENV_VALIDATION: '1' })

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('SKIP_ENV_VALIDATION'))
    } finally {
      warn.mockRestore()
    }
  })
})
