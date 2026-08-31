import { describe, expect, it } from 'vitest'

import { defaultAuthPolicy } from './auth-policy'
import {
  genericSignInRefusal,
  InvalidCredentialsError,
  parseDisplayName,
  parseSignUpInput,
  parseSignInInput,
  SIGN_IN_REFUSAL,
} from './credentials'
import { describeSecurityEvent } from './security-event'
import { describeSessions, sessionOf } from './session'
import { safeRedirectPath } from './redirect'
import { isTokenExpired, tokenIdentifier } from './one-time-token'

/**
 * Les règles pures du module d'authentification, éprouvées là où elles vivent.
 * Leurs appelants — les routes, le résolveur de session, le journal — prouvent
 * qu'ils les appellent ; ils ne rejouent pas ces matrices.
 */
describe('règles d’inscription et de connexion', () => {
  it('refuse un mot de passe plus court que la politique, en nommant la longueur', () => {
    const short = 'a'.repeat(defaultAuthPolicy.passwordMinLength - 1)

    expect(() =>
      parseSignUpInput({ email: 'a@example.test', password: short }, defaultAuthPolicy),
    ).toThrow(InvalidCredentialsError)
  })

  it('accepte un mot de passe exactement à la longueur minimale', () => {
    const exact = 'a'.repeat(defaultAuthPolicy.passwordMinLength)

    expect(
      parseSignUpInput({ email: 'a@example.test', password: exact }, defaultAuthPolicy).password,
    ).toBe(exact)
  })

  it('refuse un mot de passe au-delà de la longueur maximale', () => {
    const long = 'a'.repeat(defaultAuthPolicy.passwordMaxLength + 1)

    expect(() =>
      parseSignUpInput({ email: 'a@example.test', password: long }, defaultAuthPolicy),
    ).toThrow(InvalidCredentialsError)
  })

  it('refuse une adresse malformée', () => {
    expect(() =>
      parseSignUpInput({ email: 'pas-une-adresse', password: 'x'.repeat(12) }, defaultAuthPolicy),
    ).toThrow(InvalidCredentialsError)
  })

  it('normalise l’adresse en minuscules et sans espaces', () => {
    const parsed = parseSignUpInput(
      { email: '  Olivier@Example.TEST ', password: 'x'.repeat(12) },
      defaultAuthPolicy,
    )

    expect(parsed.email).toBe('olivier@example.test')
  })

  it('à la connexion, n’impose aucune longueur de mot de passe', () => {
    // La politique a pu changer depuis la création du compte : refuser ici un
    // mot de passe trop court distinguerait un compte ancien d'un compte
    // récent, et le refus ne serait plus « identifiants invalides ».
    expect(parseSignInInput({ email: 'a@example.test', password: 'court' }).password).toBe('court')
  })
})

describe('refus de connexion — le refus ne dit rien de l’état du compte', () => {
  // La règle vit ici, et c'est la seule matrice : « compte inconnu », « mot de
  // passe faux » et « adresse non vérifiée » sont trois états que la
  // bibliothèque distingue par son statut et par son code. La route les
  // ramène tous au même refus ; ses appelants prouvent qu'ils l'appellent, ils
  // ne rejouent pas ces cas.
  it.each([
    ['compte inconnu ou mot de passe faux', 401],
    ['adresse non vérifiée', 403],
  ])('ramène %s au refus unique', (_case, status) => {
    expect(genericSignInRefusal(status)).toEqual(SIGN_IN_REFUSAL)
  })

  it('ne masque pas ce qui ne parle pas du compte', () => {
    // Une panne doit rester une panne : la faire passer pour un refus
    // d'identifiants ferait mentir `docs/reliability.md` §2, et rien n'y fuit
    // puisque le statut ne dépend d'aucun compte.
    expect(genericSignInRefusal(500)).toBeNull()
    expect(genericSignInRefusal(502)).toBeNull()
    expect(genericSignInRefusal(200)).toBeNull()
  })
})

describe('destination de retour après authentification', () => {
  it('accepte un chemin interne', () => {
    expect(safeRedirectPath('/account', '/')).toBe('/account')
  })

  it('conserve la chaîne de requête d’un chemin interne', () => {
    expect(safeRedirectPath('/account?tab=sessions', '/')).toBe('/account?tab=sessions')
  })

  it('refuse une URL absolue vers un autre site', () => {
    expect(safeRedirectPath('https://evil.test/phishing', '/')).toBe('/')
  })

  it('refuse une URL protocole-relative, qui mène hors du site', () => {
    expect(safeRedirectPath('//evil.test/phishing', '/')).toBe('/')
  })

  it('refuse une barre oblique inversée, que les navigateurs lisent comme //', () => {
    expect(safeRedirectPath('/\\evil.test', '/')).toBe('/')
    expect(safeRedirectPath('\\\\evil.test', '/')).toBe('/')
  })

  it('refuse un chemin qui ne commence pas par une barre oblique', () => {
    expect(safeRedirectPath('account', '/')).toBe('/')
  })

  it('refuse une destination absente', () => {
    expect(safeRedirectPath(null, '/dashboard')).toBe('/dashboard')
  })
})

describe('session dérivée du compte', () => {
  const account = {
    userId: 'user-1',
    emailVerified: true,
    roles: ['admin'] as readonly string[],
  }

  it('rend la session d’un compte vérifié', () => {
    expect(sessionOf(account)).toEqual({ userId: 'user-1', roles: ['admin'] })
  })

  it('refuse la session d’un compte non vérifié', () => {
    // Le socle : un compte non vérifié n'accède à aucune route protégée. La
    // règle est ici, pas dans le répartiteur, pour qu'un second appelant ne
    // puisse pas l'oublier.
    expect(sessionOf({ ...account, emailVerified: false })).toBeNull()
  })

  it('refuse la session d’un compte sans identifiant', () => {
    expect(sessionOf({ ...account, userId: '' })).toBeNull()
  })
})

describe('nom affiché', () => {
  it('retire les espaces de bordure', () => {
    expect(parseDisplayName({ name: '  Olivier  ' })).toBe('Olivier')
  })

  it('refuse un nom vide, qui rendrait le compte anonyme dans l’interface', () => {
    expect(() => parseDisplayName({ name: '   ' })).toThrow(InvalidCredentialsError)
  })

  it('refuse un nom plus long que ce que la colonne et l’écran acceptent', () => {
    expect(() => parseDisplayName({ name: 'a'.repeat(101) })).toThrow(InvalidCredentialsError)
  })

  it('refuse ce qui n’est pas une chaîne', () => {
    expect(() => parseDisplayName({ name: 42 })).toThrow(InvalidCredentialsError)
  })
})

describe('liste des sessions actives', () => {
  const record = (id: string, createdAt: string) => ({
    id,
    createdAt: new Date(createdAt),
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    ipAddress: '203.0.113.7',
    userAgent: 'Firefox',
  })

  it('marque la session courante, et elle seule', () => {
    const described = describeSessions(
      [record('a', '2026-01-01T00:00:00Z'), record('b', '2026-01-02T00:00:00Z')],
      'b',
    )

    expect(described.map((session) => [session.id, session.current])).toEqual([
      ['b', true],
      ['a', false],
    ])
  })

  it('présente la session courante en tête, puis les plus récentes', () => {
    const described = describeSessions(
      [
        record('vieille', '2026-01-01T00:00:00Z'),
        record('récente', '2026-03-01T00:00:00Z'),
        record('courante', '2026-02-01T00:00:00Z'),
      ],
      'courante',
    )

    expect(described.map((session) => session.id)).toEqual(['courante', 'récente', 'vieille'])
  })

  it('n’expose aucun jeton de session', () => {
    // Le jeton est ce que le cookie porte : le rendre à un écran reviendrait à
    // écrire dans le HTML de quoi rejouer la session — ce que `HttpOnly`
    // existe précisément pour empêcher (`docs/security.md` §2).
    const described = describeSessions(
      [{ ...record('a', '2026-01-01T00:00:00Z'), token: 'un-jeton-de-session' } as never],
      'a',
    )

    expect(JSON.stringify(described)).not.toContain('un-jeton-de-session')
  })

  it('accepte une session sans agent ni adresse — la colonne est nullable', () => {
    const [described] = describeSessions(
      [{ ...record('a', '2026-01-01T00:00:00Z'), ipAddress: null, userAgent: null }],
      null,
    )

    expect(described?.ipAddress).toBeNull()
    expect(described?.current).toBe(false)
  })
})

describe('journal des événements de sécurité', () => {
  it('nomme l’événement et son acteur', () => {
    const record = describeSecurityEvent({
      event: 'auth.sign_in_succeeded',
      actor: { userId: 'user-1' },
    })

    expect(record.event).toBe('auth.sign_in_succeeded')
    expect(record.actor).toBe('user-1')
  })

  it('rend un acteur anonyme quand l’appelant n’est pas identifié', () => {
    const record = describeSecurityEvent({ event: 'auth.sign_in_failed', actor: null })

    expect(record.actor).toBe('anonymous')
  })

  it('n’écrit jamais l’adresse email de l’acteur', () => {
    const record = describeSecurityEvent({
      event: 'auth.sign_in_failed',
      actor: { userId: 'user-1', email: 'victime@example.test' },
    })

    expect(JSON.stringify(record)).not.toContain('victime@example.test')
  })

  it('efface toute valeur ressemblant à un secret dans les détails', () => {
    const record = describeSecurityEvent({
      event: 'auth.password_reset_requested',
      actor: null,
      details: {
        token: 'abcdef0123456789',
        password: 'hunter2',
        cookie: 'better-auth.session_token=xyz',
        sessionToken: 'xyz',
        outcome: 'sent',
      },
    })

    const serialized = JSON.stringify(record)

    expect(serialized).not.toContain('abcdef0123456789')
    expect(serialized).not.toContain('hunter2')
    expect(serialized).not.toContain('xyz')
    expect(record.details.outcome).toBe('sent')
  })

  it('efface une valeur secrète même sous un nom de clé inattendu', () => {
    // Le filtrage porte sur la **valeur**, pas seulement sur le nom de la clé :
    // un nom inconnu (`t`, `code`, `link`) est le cas qu'une liste de clés
    // interdites laisse passer.
    const record = describeSecurityEvent({
      event: 'auth.magic_link_requested',
      actor: null,
      details: { link: 'https://app.test/verify?token=abcdef0123456789abcdef' },
    })

    expect(JSON.stringify(record)).not.toContain('abcdef0123456789abcdef')
  })
})

describe('jetons à usage unique', () => {
  it('préfixe l’identifiant par l’usage, pour qu’un jeton d’un usage ne serve pas à un autre', () => {
    expect(tokenIdentifier('email-verification', 'abc')).toBe('email-verification:abc')
    expect(tokenIdentifier('email-change', 'abc')).not.toBe(
      tokenIdentifier('email-verification', 'abc'),
    )
  })

  it('déclare un jeton expiré dès l’instant de son expiration', () => {
    const expiry = new Date('2026-01-01T00:00:00.000Z')

    expect(isTokenExpired(expiry, new Date('2026-01-01T00:00:00.000Z'))).toBe(true)
    expect(isTokenExpired(expiry, new Date('2025-12-31T23:59:59.999Z'))).toBe(false)
  })
})
