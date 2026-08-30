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
    const env = parseEnv({ DATABASE_URL, EMAIL_LOCAL_CAPTURE: '1' })

    expect(env.DATABASE_URL).toBe(DATABASE_URL)
    expect(env.NODE_ENV).toBe('development')
  })

  it('ne valide pas l’environnement pendant la phase de build de Next', () => {
    expect(() =>
      getEnv({ NEXT_PHASE: 'phase-production-build', NODE_ENV: 'production' }),
    ).not.toThrow()
  })

  it('refuse un environnement où aucun mailer n’est configuré, en nommant les deux variables', () => {
    // Sans clé **et** sans capture explicite, l'application enverrait les
    // emails dans le vide en rendant `{ok:true}` : indiscernable d'un envoi
    // réussi, y compris en production. Une configuration manquante se traite
    // comme toutes les autres — le démarrage échoue en se nommant.
    expect(() => parseEnv({ DATABASE_URL })).toThrowError(/EMAIL_LOCAL_CAPTURE/)
    expect(() => parseEnv({ DATABASE_URL })).toThrowError(/RESEND_API_KEY/)
  })

  it('accepte un environnement sans clé quand la capture locale est demandée explicitement', () => {
    // `docs/reliability.md` §2 : aucun port ne dépend d'une clé d'API pour
    // fonctionner **en développement local**. La capture reste donc possible
    // sans clé — mais elle s'active, elle ne se déduit pas d'une absence.
    expect(() => parseEnv({ DATABASE_URL, EMAIL_LOCAL_CAPTURE: '1' })).not.toThrow()
  })

  it('refuse une clé d’email et la capture locale ensemble : le choix serait ambigu', () => {
    expect(() =>
      parseEnv({
        DATABASE_URL,
        RESEND_API_KEY: 're_abc123',
        EMAIL_FROM: 'envoi@example.test',
        EMAIL_LOCAL_CAPTURE: '1',
      }),
    ).toThrowError(/EMAIL_LOCAL_CAPTURE/)
  })

  it('traite une variable déclarée vide comme absente', () => {
    // `dotenv` charge `CLE=` en chaîne vide. Sans cette normalisation, une
    // variable optionnelle documentée puis laissée vide — la forme même de
    // `.env.example` — fait échouer le démarrage en se plaignant d'une longueur.
    const env = parseEnv({
      DATABASE_URL,
      RESEND_API_KEY: '',
      EMAIL_FROM: '',
      EMAIL_LOCAL_CAPTURE: '1',
    })

    expect(env.RESEND_API_KEY).toBeUndefined()
    expect(env.EMAIL_FROM).toBeUndefined()
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
