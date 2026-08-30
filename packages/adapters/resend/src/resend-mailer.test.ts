import type { EmailRenderer, MailerLogRecord, SendEmailInput } from '@repo/ports'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { backoffDelayMs, classifyResendError, isTransient } from './retry'
import { MAX_MESSAGE_LENGTH, sanitizeProviderMessage } from './log'
import { createResendMailer } from './resend-mailer'

/**
 * **Où s'arrête la doublure, où commence l'adapter.**
 *
 * Ce qui est doublé ici est le **réseau**, jamais le SDK : `createResendMailer`
 * construit un vrai client `resend`, et les cas ci-dessous remplacent
 * `globalThis.fetch`. Ce sont donc la sérialisation réelle de la requête, les
 * en-têtes réels et le traitement réel de `{ data, error }` par le SDK qui sont
 * exercés. Un test qui remplacerait `emails.send` par une fonction à soi
 * n'éprouverait que cette fonction — c'est exactement le piège relevé en revue
 * de s01.
 *
 * Ce que ces cas **ne** prouvent pas, et qui ne peut l'être qu'avec une vraie
 * clé : que l'API Resend accepte cette requête. C'est le second régime, hors
 * CI, sur commande explicite (`docs/architecture.md`).
 */

const API_KEY = 're_test_ABCDEF0123456789'
const BASE_URL = 'https://resend.invalid'

const anInput = (overrides: Partial<SendEmailInput> = {}): SendEmailInput => ({
  to: 'destinataire@example.test',
  subject: 'Bienvenue {name}',
  template: 'welcome',
  locale: 'fr',
  data: { name: 'Olivier' },
  ...overrides,
})

const render: EmailRenderer = async (input) => ({
  subject: `Bienvenue ${String(input.data.name)}`,
  html: '<p>Contenu confidentiel de l’email</p>',
  text: 'Contenu confidentiel de l’email',
})

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

interface Call {
  readonly url: string
  readonly headers: Headers
  readonly body: Record<string, unknown>
}

/** Remplace le réseau, et rien d'autre. Rend les requêtes réellement émises. */
const stubNetwork = (responses: (() => Promise<Response>)[]): Call[] => {
  const calls: Call[] = []
  let index = 0

  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      headers: new Headers(init.headers),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    })
    const responder = responses[Math.min(index, responses.length - 1)]
    index += 1

    return responder?.() ?? Promise.resolve(jsonResponse(200, { id: 'email-1' }))
  })

  return calls
}

const ok = (id = 'email-1') => () => Promise.resolve(jsonResponse(200, { id }))
const fails = (status: number, body: unknown) => () => Promise.resolve(jsonResponse(status, body))

/** Ne dort pas : le recul est prouvé sur sa fonction, pas en attendant. */
const noSleep = () => Promise.resolve()

const mailerWith = (overrides: Partial<Parameters<typeof createResendMailer>[0]> = {}) =>
  createResendMailer({
    apiKey: API_KEY,
    from: 'Killer SaaS <envoi@example.test>',
    baseUrl: BASE_URL,
    render,
    sleep: noSleep,
    random: () => 1,
    newIdempotencyKey: () => 'idem-fixe',
    ...overrides,
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('adapter Resend — envoi', () => {
  it('émet la requête attendue et rend l’identifiant du fournisseur', async () => {
    const calls = stubNetwork([ok('email-42')])

    const result = await mailerWith().send(anInput())

    expect(result).toEqual({ ok: true, id: 'email-42' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${BASE_URL}/emails`)
    expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(calls[0]?.body).toMatchObject({
      from: 'Killer SaaS <envoi@example.test>',
      to: 'destinataire@example.test',
      subject: 'Bienvenue Olivier',
      html: '<p>Contenu confidentiel de l’email</p>',
      text: 'Contenu confidentiel de l’email',
    })
  })

  it('rend le rendu injecté, sans connaître ni React ni les templates', async () => {
    const calls = stubNetwork([ok()])

    await mailerWith({
      render: async () => ({ subject: 'Autre sujet', html: '<b>autre</b>', text: 'autre' }),
    }).send(anInput())

    expect(calls[0]?.body).toMatchObject({ subject: 'Autre sujet', html: '<b>autre</b>' })
  })
})

describe('adapter Resend — reprises (docs/reliability.md §3)', () => {
  it('rejoue une panne transitoire et réussit, avec la même clé d’idempotence', async () => {
    // La clé d'idempotence est ce qui rend la reprise sûre : le fournisseur
    // n'envoie pas deux fois l'email si c'est sa réponse qui s'est perdue.
    const calls = stubNetwork([
      fails(503, { name: 'internal_server_error', message: 'oups', statusCode: 503 }),
      ok('email-7'),
    ])

    const result = await mailerWith().send(anInput())

    expect(result).toEqual({ ok: true, id: 'email-7' })
    expect(calls).toHaveLength(2)
    expect(calls.map((call) => call.headers.get('idempotency-key'))).toEqual([
      'idem-fixe',
      'idem-fixe',
    ])
  })

  it('ne rejoue jamais une erreur de validation', async () => {
    // « Rejouer une erreur de validation est un défaut, pas une précaution. »
    const calls = stubNetwork([
      fails(422, { name: 'validation_error', message: 'adresse invalide', statusCode: 422 }),
    ])

    const result = await mailerWith().send(anInput())

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatchObject({
      code: 'invalid_request',
      attempts: 1,
    })
    expect(calls).toHaveLength(1)
  })

  it('ne rejoue jamais une clé d’API refusée', async () => {
    const calls = stubNetwork([
      fails(401, { name: 'invalid_api_key', message: 'clé invalide', statusCode: 401 }),
    ])

    const result = await mailerWith().send(anInput())

    expect(result.ok === false && result.error.code).toBe('unauthorized')
    expect(calls).toHaveLength(1)
  })

  it('abandonne après le nombre maximal d’essais, et le dit', async () => {
    const calls = stubNetwork([
      fails(500, { name: 'internal_server_error', message: 'panne', statusCode: 500 }),
    ])

    const result = await mailerWith({ maxAttempts: 3 }).send(anInput())

    expect(calls).toHaveLength(3)
    expect(result.ok === false && result.error).toMatchObject({
      code: 'provider_unavailable',
      attempts: 3,
    })
  })

  it('attend entre deux essais, et le recul grandit', async () => {
    const waited: number[] = []
    stubNetwork([
      fails(500, { name: 'internal_server_error', message: 'panne', statusCode: 500 }),
    ])

    await mailerWith({
      maxAttempts: 3,
      baseDelayMs: 100,
      sleep: async (ms) => {
        waited.push(ms)
      },
    }).send(anInput())

    expect(waited).toEqual([100, 200])
  })
})

describe('adapter Resend — délai d’attente (docs/reliability.md §3)', () => {
  it('rend un échec de délai plutôt que de pendre indéfiniment', async () => {
    stubNetwork([() => new Promise<Response>(() => {})])

    const result = await mailerWith({ timeoutMs: 20, maxAttempts: 1 }).send(anInput())

    expect(result.ok === false && result.error.code).toBe('timeout')
  })

  it('rejoue un délai dépassé : c’est une erreur transitoire', async () => {
    let attempt = 0
    stubNetwork([
      () => {
        attempt += 1

        return attempt === 1
          ? new Promise<Response>(() => {})
          : Promise.resolve(jsonResponse(200, { id: 'email-9' }))
      },
    ])

    const result = await mailerWith({ timeoutMs: 20, maxAttempts: 2 }).send(anInput())

    expect(result).toEqual({ ok: true, id: 'email-9' })
  })
})

describe('adapter Resend — dégradation (docs/reliability.md §2)', () => {
  it('ne rejette jamais, quoi qu’il arrive au réseau', async () => {
    // C'est le corollaire de la forme du port : l'appelant reçoit une valeur,
    // il ne reçoit pas une exception qui ferait tomber sa requête.
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')))

    const result = await mailerWith({ maxAttempts: 1 }).send(anInput())

    expect(result.ok === false && result.error.code).toBe('provider_unavailable')
  })

  it('ne rejette pas non plus quand le rendu du template échoue, et ne le rejoue pas', async () => {
    const calls = stubNetwork([ok()])

    const result = await mailerWith({
      render: () => Promise.reject(new Error('locale « de » non livrée')),
    }).send(anInput())

    expect(result.ok === false && result.error.code).toBe('invalid_request')
    expect(calls).toHaveLength(0)
  })
})

describe('adapter Resend — journalisation (docs/security.md §5)', () => {
  const provokeLoggedFailure = async (): Promise<MailerLogRecord[]> => {
    const records: MailerLogRecord[] = []
    stubNetwork([
      fails(500, {
        name: 'internal_server_error',
        // Le fournisseur met ce qu'il veut dans son message : ici l'adresse du
        // destinataire et une clé d'API. C'est le cas qu'il faut tenir.
        message: `Delivery to destinataire@example.test failed for key ${API_KEY}`,
        statusCode: 500,
      }),
    ])

    await mailerWith({ maxAttempts: 2, logger: (record) => records.push(record) }).send(
      anInput(),
    )

    return records
  }

  it('journalise l’échec définitif et chaque reprise', async () => {
    const records = await provokeLoggedFailure()

    expect(records.map((record) => record.event)).toEqual([
      'mailer.send_retried',
      'mailer.send_failed',
    ])
    expect(records.at(-1)).toMatchObject({
      template: 'welcome',
      code: 'provider_unavailable',
      attempts: 2,
    })
  })

  it('ne divulgue ni clé d’API, ni destinataire, ni sujet, ni corps de l’email', async () => {
    const records = await provokeLoggedFailure()

    const journal = JSON.stringify(records)

    expect(journal).not.toContain(API_KEY)
    expect(journal).not.toContain('re_test')
    expect(journal).not.toContain('destinataire@example.test')
    expect(journal).not.toContain('Bienvenue Olivier')
    expect(journal).not.toContain('Contenu confidentiel')
    // Le journal reste utile : il nomme le template et la cause.
    expect(journal).toContain('welcome')
  })

  it('ne divulgue pas davantage dans le message rendu à l’appelant', async () => {
    // Le message d'erreur remonte jusqu'à une réponse HTTP : `docs/security.md`
    // §5 interdit qu'un secret y transite autant que dans un journal.
    stubNetwork([
      fails(500, {
        name: 'internal_server_error',
        message: `key ${API_KEY} rejected for destinataire@example.test`,
        statusCode: 500,
      }),
    ])

    const result = await mailerWith({ maxAttempts: 1 }).send(anInput())

    const message = result.ok === false ? result.error.message : ''
    expect(message).not.toContain(API_KEY)
    expect(message).not.toContain('destinataire@example.test')
  })
})

describe('assainissement d’un message de fournisseur', () => {
  it.each([
    ['une adresse email', 'échec pour olivier@example.test', 'olivier@example.test'],
    ['une clé Resend', 'clé re_AbCd1234EfGh refusée', 're_AbCd1234EfGh'],
    ['un jeton Bearer', 'Bearer re_AbCd1234EfGh invalide', 're_AbCd1234EfGh'],
  ])('retire %s', (_name, message, secret) => {
    expect(sanitizeProviderMessage(message)).not.toContain(secret)
  })

  it('garde ce qui reste lisible', () => {
    expect(sanitizeProviderMessage('rate limit exceeded')).toBe('rate limit exceeded')
  })

  it('borne la longueur : un message de fournisseur n’est pas un dépotoir', () => {
    expect(sanitizeProviderMessage('x'.repeat(2000)).length).toBeLessThanOrEqual(
      MAX_MESSAGE_LENGTH,
    )
  })
})

describe('politique de reprise', () => {
  it.each([
    ['validation_error', 'invalid_request'],
    ['missing_required_field', 'invalid_request'],
    ['invalid_from_address', 'invalid_request'],
    ['not_found', 'invalid_request'],
    ['missing_api_key', 'unauthorized'],
    ['invalid_api_key', 'unauthorized'],
    ['restricted_api_key', 'unauthorized'],
    ['rate_limit_exceeded', 'rate_limited'],
    ['daily_quota_exceeded', 'rate_limited'],
    ['internal_server_error', 'provider_unavailable'],
    ['application_error', 'provider_unavailable'],
  ] as const)('classe « %s » en %s', (name, code) => {
    expect(classifyResendError({ name, message: '', statusCode: null })).toBe(code)
  })

  it('retombe sur le code HTTP quand le nom est inconnu du SDK installé', () => {
    // Le SDK ajoute des codes d'une version à l'autre. Sans ce repli, un code
    // inconnu serait traité comme définitif et une panne 503 ne serait jamais
    // rejouée.
    const unknown = { name: 'code_inedit', message: '', statusCode: 503 } as never

    expect(classifyResendError(unknown)).toBe('provider_unavailable')
  })

  it.each([
    ['timeout', true],
    ['provider_unavailable', true],
    ['rate_limited', true],
    ['invalid_request', false],
    ['unauthorized', false],
  ] as const)('« %s » est transitoire : %s', (code, transient) => {
    expect(isTransient(code)).toBe(transient)
  })
})

describe('recul exponentiel avec dispersion', () => {
  const policy = { baseMs: 100, maxMs: 5_000 }

  it('double à chaque essai', () => {
    const delays = [1, 2, 3, 4].map((attempt) =>
      backoffDelayMs(attempt, { ...policy, random: () => 1 }),
    )

    expect(delays).toEqual([100, 200, 400, 800])
  })

  it('plafonne', () => {
    expect(backoffDelayMs(12, { ...policy, random: () => 1 })).toBe(5_000)
  })

  it('disperse : deux tirages du même essai ne donnent pas la même attente', () => {
    // Sans dispersion, mille instances qui échouent ensemble rejouent ensemble.
    const low = backoffDelayMs(3, { ...policy, random: () => 0 })
    const high = backoffDelayMs(3, { ...policy, random: () => 1 })

    expect(low).toBeLessThan(high)
    expect(low).toBeGreaterThan(0)
  })
})
