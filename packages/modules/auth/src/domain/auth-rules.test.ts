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
import {
  classifyOutboundStatus,
  isTransientOutboundFailure,
  outboundBackoffMs,
} from './outbound'
import {
  canUnlinkSignInMethod,
  localOAuthIdentity,
  localOAuthIdentityOfCode,
  oauthFailureClass,
  oauthProvisioningRefusal,
  readOAuthFailureClass,
  LOCAL_OAUTH_ACCOUNT_ID,
  LOCAL_OAUTH_EMAIL,
  OAUTH_UNVERIFIED_EMAIL_REFUSAL,
} from './oauth'
import { digestBackupCode, digestBackupCodes, isBackupCodeDigest } from './backup-code'
import {
  totpStepsToTry,
  twoFactorRefusal,
  TWO_FACTOR_REFUSAL_STATUS,
} from './two-factor'
import {
  describePasskeys,
  parsePasskeyName,
  passkeyRefusal,
  PASSKEY_NAME_MAX_LENGTH,
  PASSKEY_REFUSAL_STATUS,
} from './passkey'

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

  it('efface un code de second facteur, que le motif de valeur ne peut pas voir', () => {
    // Un code de secours fait onze caractères (`XXXXX-XXXXX`) et un code TOTP
    // six chiffres : les deux passent **sous** le seuil de seize caractères du
    // motif de valeur. Seul le nom de clé peut les attraper, et c'est ce que
    // s13 ajoute à la liste.
    const record = describeSecurityEvent({
      event: 'auth.two_factor_failed',
      actor: { userId: 'user-1' },
      details: { code: 'a7k2m-9qx4z', backupCode: '123456', outcome: 'refused' },
    })

    const serialized = JSON.stringify(record)

    expect(serialized).not.toContain('a7k2m-9qx4z')
    expect(serialized).not.toContain('123456')
    expect(record.details.outcome).toBe('refused')
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

describe('provisionnement par un fournisseur OAuth', () => {
  it('refuse une identité dont le fournisseur n’atteste pas l’adresse, à la création', () => {
    expect(
      oauthProvisioningRefusal({
        method: 'oauth',
        action: 'create-user',
        providerAssertsEmail: false,
      }),
    ).toBe(OAUTH_UNVERIFIED_EMAIL_REFUSAL)
  })

  it('refuse aussi à la liaison et au retour d’un compte déjà lié', () => {
    for (const action of ['link-account', 'sign-in'] as const) {
      expect(
        oauthProvisioningRefusal({ method: 'oauth', action, providerAssertsEmail: false }),
      ).toBe(OAUTH_UNVERIFIED_EMAIL_REFUSAL)
    }
  })

  it('accepte une identité attestée', () => {
    expect(
      oauthProvisioningRefusal({
        method: 'oauth',
        action: 'create-user',
        providerAssertsEmail: true,
      }),
    ).toBeNull()
  })

  it('ne juge pas ce qui ne vient pas d’un fournisseur : le mot de passe a ses propres règles', () => {
    expect(
      oauthProvisioningRefusal({
        method: 'email-password',
        action: 'create-user',
        providerAssertsEmail: false,
      }),
    ).toBeNull()
  })
})

/**
 * **Les créneaux d'identité du fournisseur de développement** (s52, cause B).
 *
 * Deux parcours pilotaient ce fournisseur, qui rendait toujours la même
 * adresse : joués en parallèle sur une base où la ligne n'existe pas encore,
 * le perdant de la course d'insertion échoue sur `auth_user_email_key`. Les
 * créneaux suppriment la ressource partagée au lieu de sérialiser les deux cas.
 *
 * Ce que ces cas tiennent, et qui est la contrepartie du créneau : **l'appelant
 * choisit une étiquette, jamais une adresse.** L'adresse est composée ici,
 * toujours dans `example.test`.
 */
describe('créneau d’identité du fournisseur de développement', () => {
  it('rend l’identité par défaut quand aucun créneau n’est demandé', () => {
    for (const slot of [null, undefined, '', '   ']) {
      expect(localOAuthIdentity(slot)).toEqual({
        accountId: LOCAL_OAUTH_ACCOUNT_ID,
        email: LOCAL_OAUTH_EMAIL,
      })
    }
  })

  it('compose une identité distincte par créneau, et jamais hors du domaine réservé', () => {
    const first = localOAuthIdentity('retour')
    const second = localOAuthIdentity('bouton')

    expect(first?.email).toBe('local-retour@example.test')
    expect(second?.email).toBe('local-bouton@example.test')
    expect(first?.accountId).not.toBe(second?.accountId)
    expect(first?.accountId).not.toBe(LOCAL_OAUTH_ACCOUNT_ID)
  })

  /**
   * **Le refus est le cœur du mécanisme.** Une étiquette hors forme est
   * refusée, jamais repliée en silence sur l'identité par défaut : un repli
   * rendrait indiscernables « ce parcours a son créneau » et « ce parcours a
   * mal écrit son créneau, et partage donc le créneau des autres » — la course
   * reviendrait sans que rien ne le dise.
   */
  it('refuse une étiquette qui n’est pas une étiquette, plutôt que de replier sur le défaut', () => {
    for (const slot of [
      'victime@example.com',
      'Retour',
      'a b',
      'retour.suite',
      '../autre',
      'x'.repeat(17),
      'retour%40ailleurs',
    ]) {
      expect(localOAuthIdentity(slot)).toBeNull()
    }
  })

  it('relit l’identité depuis le code que le rappel transporte, dans les deux sens', () => {
    for (const slot of [null, 'retour', 'bouton']) {
      const identity = localOAuthIdentity(slot)

      expect(identity).not.toBeNull()
      expect(localOAuthIdentityOfCode((identity as { accountId: string }).accountId)).toEqual(
        identity,
      )
    }
  })

  it('refuse un code que ce fournisseur n’a pas émis', () => {
    for (const code of ['', 'autre-chose', `${LOCAL_OAUTH_ACCOUNT_ID}-Retour`, 'local-oauth']) {
      expect(localOAuthIdentityOfCode(code)).toBeNull()
    }
  })
})

describe('classe d’un retour OAuth en échec', () => {
  it('distingue le refus d’autorisation de l’utilisateur', () => {
    expect(oauthFailureClass('access_denied')).toBe('denied')
  })

  it('replie tout le reste sur un échec unique — un code qui nomme l’état du compte n’en sort pas', () => {
    for (const code of [
      'account_not_linked',
      'email_not_found',
      'state_mismatch',
      'provider_not_found',
      'unable_to_create_user',
      '',
      null,
    ]) {
      expect(oauthFailureClass(code)).toBe('failed')
    }
  })
})

describe('classe relue d’un paramètre d’URL', () => {
  it('accepte les deux classes, et rien d’autre — un code de fournisseur n’en est pas une', () => {
    expect(readOAuthFailureClass('denied')).toBe('denied')
    expect(readOAuthFailureClass('failed')).toBe('failed')

    for (const value of ['access_denied', 'account_not_linked', '', null, undefined, 42]) {
      expect(readOAuthFailureClass(value)).toBe('failed')
    }
  })
})

describe('déliement d’un moyen de connexion', () => {
  it('refuse de retirer le dernier moyen de connexion', () => {
    expect(canUnlinkSignInMethod(1)).toBe(false)
  })

  it('accepte tant qu’il en reste un autre', () => {
    expect(canUnlinkSignInMethod(2)).toBe(true)
  })
})

describe('reprise d’un appel sortant vers un fournisseur', () => {
  it('ne rejoue que les échecs transitoires : rejouer une erreur de requête est un défaut', () => {
    // Transitoires : le fournisseur peut se relever tout seul.
    expect(isTransientOutboundFailure('timeout')).toBe(true)
    expect(isTransientOutboundFailure('network')).toBe(true)
    expect(isTransientOutboundFailure(classifyOutboundStatus(500))).toBe(true)
    expect(isTransientOutboundFailure(classifyOutboundStatus(502))).toBe(true)
    expect(isTransientOutboundFailure(classifyOutboundStatus(429))).toBe(true)

    // Définitifs : la requête est fautive ou le jeton ne vaut rien. La rejouer
    // ne fera que la refaire refuser trois fois (`docs/reliability.md` §3).
    expect(isTransientOutboundFailure(classifyOutboundStatus(400))).toBe(false)
    expect(isTransientOutboundFailure(classifyOutboundStatus(401))).toBe(false)
    expect(isTransientOutboundFailure(classifyOutboundStatus(403))).toBe(false)
    expect(isTransientOutboundFailure(classifyOutboundStatus(404))).toBe(false)
  })

  it('recule exponentiellement, disperse l’attente, et la plafonne', () => {
    const policy = { baseMs: 100, maxMs: 400, random: () => 1 }

    expect(outboundBackoffMs(1, policy)).toBe(100)
    expect(outboundBackoffMs(2, policy)).toBe(200)
    expect(outboundBackoffMs(3, policy)).toBe(400)
    // Le plafond tient : sans lui, la dixième reprise attendrait cinquante
    // secondes dans le temps de réponse d'un rappel.
    expect(outboundBackoffMs(10, policy)).toBe(400)
  })

  it('tire l’attente dans la moitié haute du recul : jamais une reprise immédiate', () => {
    const policy = { baseMs: 100, maxMs: 400 }

    // La dispersion « à moitié » : entre la moitié et la totalité du recul.
    expect(outboundBackoffMs(2, { ...policy, random: () => 0 })).toBe(100)
    expect(outboundBackoffMs(2, { ...policy, random: () => 1 })).toBe(200)
  })
})

describe('empreinte d’un code de secours', () => {
  /**
   * Un hacheur déterministe et factice : la règle éprouvée ici est
   * l'aiguillage — hacher, ou reconnaître ce qui est déjà haché —, pas la
   * primitive cryptographique, qui vit dans `infrastructure/`.
   */
  const hash = (value: string): string =>
    [...value]
      .reduce((sum, character) => sum + character.charCodeAt(0) * value.length, 0)
      .toString(16)
      .padStart(64, '0')

  /** La forme que `generateBackupCodesFn` de la bibliothèque produit. */
  const EMITTED = ['a7k2m-9qx4z', 'b3n8p-1rw6y', 'c5h1t-7vd2s']

  it('ne laisse aucun code émis en clair dans ce qui est stocké', () => {
    const stored = digestBackupCodes(JSON.stringify(EMITTED), hash)

    for (const code of EMITTED) {
      expect(stored).not.toContain(code)
    }

    expect((JSON.parse(stored) as string[]).every(isBackupCodeDigest)).toBe(true)
  })

  it('ne confond jamais un code émis avec une empreinte — le discriminant est total', () => {
    for (const code of EMITTED) {
      expect(isBackupCodeDigest(code)).toBe(false)
    }
  })

  it('hache la saisie **sans condition** : une empreinte soumise comme code est hachée à son tour', () => {
    // Le constat C1 de `docs/reviews/s13-two-factor.md` : la fonction
    // reconnaissait une empreinte et la rendait inchangée, si bien qu'une
    // valeur lue en base et postée sur la route valait le code lui-même. Ce
    // qui vient du monde extérieur n'a pas le droit de se reconnaître.
    const [emitted = ''] = EMITTED
    const digest = digestBackupCode(emitted, hash)

    expect(isBackupCodeDigest(digest)).toBe(true)
    expect(digestBackupCode(digest, hash)).not.toBe(digest)
  })

  it('sépare les deux chemins : le magasin garde ses empreintes, la saisie non', () => {
    // Une seule fonction pour les deux chemins ne peut pas tenir les deux
    // propriétés à la fois — c'est la séparation qui est la règle.
    const stored = JSON.parse(
      digestBackupCodes(JSON.stringify(EMITTED), hash),
    ) as readonly string[]
    const [first = ''] = stored

    expect(digestBackupCodes(JSON.stringify([first]), hash)).toBe(JSON.stringify([first]))
    expect(digestBackupCode(first, hash)).not.toBe(first)
  })

  it('ré-encode sans hacher deux fois — c’est le cas qui casse les codes restants', () => {
    // La bibliothèque rappelle son encodeur avec ce qu'elle vient de **lire** :
    // après consommation d'un code, les neuf restants repassent ici sous forme
    // d'empreintes. Les hacher une seconde fois les rendrait tous
    // inutilisables, et rien ne le dirait avant le deuxième usage.
    const once = digestBackupCodes(JSON.stringify(EMITTED), hash)

    expect(digestBackupCodes(once, hash)).toBe(once)
  })

  it('donne deux empreintes différentes à deux codes différents', () => {
    const [first, second] = JSON.parse(
      digestBackupCodes(JSON.stringify(EMITTED), hash),
    ) as readonly string[]

    expect(first).not.toBe(second)
  })

  it('refuse une charge qui n’est pas une liste de codes, plutôt que de la stocker telle quelle', () => {
    expect(() => digestBackupCodes('pas du json', hash)).toThrow()
    expect(() => digestBackupCodes(JSON.stringify({ codes: EMITTED }), hash)).toThrow()
    expect(() => digestBackupCodes(JSON.stringify([1, 2]), hash)).toThrow()
  })
})

describe('compteurs TOTP à essayer', () => {
  const PERIOD = 30
  const stepAt = (millis: number): number => Math.floor(millis / (PERIOD * 1000))

  /** Une vérification qui tombe à la toute fin d'une période : le cas qui pique. */
  const VERIFIED_AT = 1_800_000_000_000 - (1_800_000_000_000 % (PERIOD * 1000)) + 29_999

  it('couvre les trois compteurs que la bibliothèque a pu accepter, frontière de période comprise', () => {
    // La bibliothèque vérifie à `T₁` avec une fenêtre de ±1 ; la garde place le
    // code à `T₂ ≥ T₁`, éventuellement une période plus loin. Un compteur non
    // couvert, c'est un code accepté que la garde ne sait pas rattacher — donc
    // une connexion refusée, la garde étant fermée.
    const accepted = [stepAt(VERIFIED_AT) - 1, stepAt(VERIFIED_AT), stepAt(VERIFIED_AT) + 1]

    for (const gap of [0, 1, 1_000, 29_000, 29_999]) {
      const tried = totpStepsToTry(new Date(VERIFIED_AT + gap), PERIOD)

      for (const step of accepted) {
        expect(tried, `écart ${gap} ms, compteur ${step}`).toContain(step)
      }
    }
  })

  it('les rend dans l’ordre croissant : à collision, c’est le plus petit qui l’emporte', () => {
    // Deux compteurs produisant le même code sont de l'ordre de 10⁻⁶. Retenir
    // le plus petit refuse alors un rejeu ; retenir le plus grand l'accepterait.
    const tried = totpStepsToTry(new Date(VERIFIED_AT), PERIOD)

    expect([...tried].sort((left, right) => left - right)).toEqual([...tried])
  })
})

describe('refus d’une vérification de second facteur', () => {
  it('rend le même statut aux deux classes : la distinction est dans la conduite à tenir, pas dans le code', () => {
    for (const status of [400, 401, 403, 429, 500]) {
      expect(twoFactorRefusal(status)?.status).toBe(TWO_FACTOR_REFUSAL_STATUS)
    }
  })

  it('dit « recommencez » quand le défi est mort, « code invalide » quand il vit encore', () => {
    // Mesuré dans `better-auth@1.7.2` : `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`
    // et `TOTP_NOT_ENABLED` sortent en 400, `ACCOUNT_TEMPORARILY_LOCKED` en
    // 429 — trois états où le défi n'est plus jouable. `INVALID_CODE` et
    // `INVALID_TWO_FACTOR_COOKIE` sortent en 401.
    expect(twoFactorRefusal(400)?.body.error).toBe('restart')
    expect(twoFactorRefusal(429)?.body.error).toBe('restart')
    expect(twoFactorRefusal(401)?.body.error).toBe('invalid')
  })

  it('ne laisse sortir aucun code de la bibliothèque', () => {
    // Les cinq codes que le greffon peut produire. Aucun n'a le droit
    // d'atteindre le navigateur : chacun décrit un état du compte
    // (`docs/security.md` §7).
    const refusals = [400, 401, 429].map((status) => JSON.stringify(twoFactorRefusal(status)))

    for (const code of [
      'INVALID_CODE',
      'TOTP_NOT_ENABLED',
      'INVALID_TWO_FACTOR_COOKIE',
      'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
      'ACCOUNT_TEMPORARILY_LOCKED',
    ]) {
      for (const refusal of refusals) {
        expect(refusal).not.toContain(code)
      }
    }
  })

  it('laisse passer une réponse qui n’est pas un refus', () => {
    expect(twoFactorRefusal(200)).toBeNull()
  })
})

describe('nom d’une passkey', () => {
  it('rend `null` quand aucun nom n’est donné : une passkey sans nom est légitime', () => {
    // L'enregistrement n'en demande pas — la cérémonie part d'un clic, pas
    // d'un formulaire. Le nom vient ensuite, par le renommage.
    expect(parsePasskeyName({})).toBeNull()
    expect(parsePasskeyName({ name: undefined })).toBeNull()
  })

  it('rogne le nom donné', () => {
    expect(parsePasskeyName({ name: '  MacBook  ' })).toBe('MacBook')
  })

  it('refuse un nom vide, blanc, trop long, ou qui n’est pas une chaîne', () => {
    for (const name of ['', '   ', 'x'.repeat(PASSKEY_NAME_MAX_LENGTH + 1), 42, null]) {
      expect(() => parsePasskeyName({ name })).toThrow(InvalidCredentialsError)
    }

    expect(parsePasskeyName({ name: 'x'.repeat(PASSKEY_NAME_MAX_LENGTH) })).toHaveLength(
      PASSKEY_NAME_MAX_LENGTH,
    )
  })
})

describe('refus d’une opération de passkey', () => {
  it('distingue la session trop ancienne du reste, au même statut', () => {
    // Mesuré dans `better-auth@1.7.2` : `freshSessionMiddleware` rend `403`
    // (`SESSION_NOT_FRESH`) quand la session dépasse `freshAge`, et `401`
    // quand il n'y en a pas. La conduite à tenir n'est pas la même — se
    // reconnecter, ou réessayer — mais le statut rendu, si.
    expect(passkeyRefusal(403)?.body.error).toBe('stale')

    for (const status of [400, 401, 429, 500]) {
      expect(passkeyRefusal(status)?.body.error).toBe('refused')
    }

    for (const status of [400, 401, 403, 429, 500]) {
      expect(passkeyRefusal(status)?.status).toBe(PASSKEY_REFUSAL_STATUS)
    }
  })

  it('ne laisse sortir aucun code de la bibliothèque', () => {
    const refusals = [400, 401, 403, 500].map((status) => JSON.stringify(passkeyRefusal(status)))

    for (const code of [
      'PASSKEY_NOT_FOUND',
      'CHALLENGE_NOT_FOUND',
      'AUTHENTICATION_FAILED',
      'FAILED_TO_VERIFY_REGISTRATION',
      'SESSION_NOT_FRESH',
      'YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY',
    ]) {
      for (const refusal of refusals) {
        expect(refusal).not.toContain(code)
      }
    }
  })

  it('laisse passer une réponse qui n’est pas un refus', () => {
    expect(passkeyRefusal(200)).toBeNull()
  })
})

describe('liste des passkeys', () => {
  const row = {
    id: 'pk-1',
    name: 'MacBook',
    createdAt: new Date('2026-09-01T09:12:00.000Z'),
    // Ce que la ligne porte **en plus**, et qui n'a rien à faire à l'écran.
    credentialID: 'Y3JlZGVudGlhbA',
    publicKey: 'cHVibGljLWtleQ',
    counter: 7,
  }

  it('recopie champ par champ : ni clé publique, ni identifiant de justificatif, ni compteur', () => {
    const [described] = describePasskeys([row], { removable: true })

    expect(Object.keys(described ?? {}).sort()).toEqual(['createdAt', 'id', 'name', 'removable'])
    expect(JSON.stringify(described)).not.toContain(row.publicKey)
    expect(JSON.stringify(described)).not.toContain(row.credentialID)
  })

  it('porte la règle déjà décidée, elle ne la rejoue pas', () => {
    expect(describePasskeys([row], { removable: false })[0]?.removable).toBe(false)
    expect(describePasskeys([row], { removable: true })[0]?.removable).toBe(true)
  })

  it('rend la plus récente en tête', () => {
    const older = { ...row, id: 'pk-0', createdAt: new Date('2026-08-01T09:12:00.000Z') }

    expect(describePasskeys([older, row], { removable: true }).map((one) => one.id)).toEqual([
      'pk-1',
      'pk-0',
    ])
  })
})
