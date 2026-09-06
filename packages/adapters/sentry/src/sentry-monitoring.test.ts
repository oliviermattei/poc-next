import { describe, expect, it } from 'vitest'

import {
  boundStack,
  createSentryMonitoring,
  isTransientMonitoringError,
  MAX_STACK_LINE_LENGTH,
  MAX_STACK_LINES,
  parseStackFrames,
} from './sentry-monitoring'

/**
 * **Régime doublé, bloquant en CI** : le réseau est doublé, jamais le SDK, et
 * l'enveloppe réellement émise est capturée puis assertée.
 */

const recorder = (respond: (request: Request) => Response = () => Response.json({ id: 'evt_1' })) => {
  const requests: Request[] = []

  return {
    requests,
    fetch: (async (input: string | URL, init?: RequestInit) => {
      const request = new Request(String(input), init)
      requests.push(request)

      return respond(request)
    }) as unknown as typeof fetch,
  }
}

/** Le plancher : asserter sur une capture vide échoue, plutôt que de passer. */
const capturedEnvelope = async (requests: readonly Request[]) => {
  if (requests.length === 0) {
    throw new Error('régime enregistré : aucune requête capturée, il n’y a rien à asserter')
  }

  const raw = await (requests.at(-1) as Request).clone().text()
  const [header, itemHeader, payload] = raw.split('\n')

  return {
    raw,
    header: JSON.parse(header ?? '{}') as Record<string, unknown>,
    itemHeader: JSON.parse(itemHeader ?? '{}') as Record<string, unknown>,
    payload: JSON.parse(payload ?? '{}') as Record<string, never>,
  }
}

const DSN = 'https://public_key_abc@errors.test/42'

const monitoring = (
  overrides: Partial<Parameters<typeof createSentryMonitoring>[0]> = {},
  fetchImpl?: typeof fetch,
) =>
  createSentryMonitoring({
    dsn: DSN,
    fetch: fetchImpl,
    sleep: async () => {},
    random: () => 0.5,
    now: () => new Date('2026-09-06T10:00:00.000Z'),
    eventId: () => '0123456789abcdef0123456789abcdef',
    ...overrides,
  })

const STACK = [
  'TypeError: cannot read properties of undefined',
  '    at renderInvoice (/app/.next/server/chunks/482.js:12:31)',
  '    at handler (/app/.next/server/app/api/route.js:3:9)',
].join('\n')

describe('l’enveloppe émise, capturée et assertée', () => {
  it('poste sur le point d’ingestion dérivé du DSN', async () => {
    const network = recorder()
    const result = await monitoring({}, network.fetch).capture({
      message: 'cannot read properties of undefined',
      type: 'TypeError',
      stack: STACK,
      origin: 'server',
      release: 'app@1.2.3',
      context: { route: '/api/invoices' },
    })

    const envelope = await capturedEnvelope(network.requests)

    expect(result).toEqual({ ok: true, id: '0123456789abcdef0123456789abcdef' })
    expect(network.requests[0]?.url).toBe(
      'https://errors.test/api/42/envelope/?sentry_key=public_key_abc&sentry_version=7',
    )
    expect(envelope.itemHeader).toMatchObject({ type: 'event' })
    expect(envelope.payload).toMatchObject({
      release: 'app@1.2.3',
      platform: 'javascript',
      level: 'error',
      tags: { origin: 'server' },
    })
  })

  it('découpe la trace en cadres, **du plus ancien au plus récent**', async () => {
    // C'est la moitié du critère 1 que le code tient : une trace envoyée en
    // texte brut n'est jamais symbolisée par le fournisseur, donc jamais lisible,
    // quelles que soient les cartes source envoyées au build.
    const frames = parseStackFrames(STACK)

    expect(frames).toEqual([
      { filename: '/app/.next/server/app/api/route.js', function: 'handler', lineno: 3, colno: 9 },
      {
        filename: '/app/.next/server/chunks/482.js',
        function: 'renderInvoice',
        lineno: 12,
        colno: 31,
      },
    ])
  })

  it('le plancher : asserter sur une capture vide échoue au lieu de passer', async () => {
    await expect(capturedEnvelope([])).rejects.toThrow(/aucune requête capturée/)
  })
})

/**
 * **Une trace hostile coûte-t-elle plus cher qu'une trace normale ?**
 *
 * CodeQL a signalé `js/polynomial-redos` sur le découpeur de cadres, et ce
 * n'était pas théorique : `POST /analytics/client-error` est **publique** — la
 * story l'a laissée sans session pour attraper les erreurs d'avant la connexion
 * — et son corps porte une trace de 20 000 caractères au choix de l'appelant.
 *
 * **Mesuré avant le correctif**, sur l'ancienne expression
 * `/^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/` : une ligne de
 * **4 003 caractères** (`'at ' + '  '.repeat(2000)`) coûtait **43,9 s** de
 * processeur. Une seule requête, et la politique `default` en tolère 120 par
 * minute : la limitation borne le **nombre** d'appels, jamais le coût de l'un
 * d'eux.
 *
 * L'assertion porte donc sur le **temps**, parce que le défaut *est* le temps.
 * Elle est grossière exprès — trois ordres de grandeur sous la mesure d'origine
 * —, si bien qu'une machine chargée ne la rend pas capricieuse.
 */
describe('une trace hostile ne coûte pas plus qu’une trace normale', () => {
  /** Large exprès : ce qui est refusé est la seconde, pas la milliseconde. */
  const BUDGET_MS = 250

  it('rend la main sur la forme adverse au lieu de partir en temps quadratique', () => {
    const hostile = `at ${'  '.repeat(50_000)}`

    const started = performance.now()
    const frames = parseStackFrames(hostile)
    const elapsed = performance.now() - started

    expect(frames).toEqual([])
    expect(elapsed, `${elapsed.toFixed(0)} ms pour une ligne hostile`).toBeLessThan(BUDGET_MS)
  })

  /**
   * **La borne, qui est la moitié qui ne vieillira pas.** L'expression d'après
   * est linéaire ; celle qu'un prochain agent écrira à sa place ne le sera
   * peut-être pas. Ce qui protège alors est que rien de démesuré n'atteint
   * l'analyseur, quelle qu'en soit l'écriture.
   *
   * Les deux plafonds sont **dérivés** des constantes, jamais recopiés.
   */
  it('jette une ligne plus longue que le plafond, et garde la même en deçà', () => {
    const frame = (padding: number): string =>
      `    at renderInvoice (/app/${'x'.repeat(padding)}.js:12:31)`

    // Le rembourrage est calculé pour encadrer le plafond au caractère près.
    const overhead = frame(0).length
    const tooLong = frame(MAX_STACK_LINE_LENGTH - overhead + 1)
    const justUnder = frame(MAX_STACK_LINE_LENGTH - overhead)

    expect(tooLong.length).toBe(MAX_STACK_LINE_LENGTH + 1)
    expect(justUnder.length).toBe(MAX_STACK_LINE_LENGTH)
    expect(parseStackFrames(tooLong)).toEqual([])
    expect(parseStackFrames(justUnder)).toHaveLength(1)
  })

  it('ne lit pas au-delà du plafond de lignes', () => {
    const noise = Array.from({ length: MAX_STACK_LINES }, () => 'TypeError: boum')
    const frame = '    at handler (/app/route.js:3:9)'

    // Le cadre est **hors** du plafond : il n'est pas lu. Le plancher est la
    // ligne d'après — le même cadre, une ligne plus tôt, est lu.
    expect(parseStackFrames([...noise, frame].join('\n'))).toEqual([])
    expect(parseStackFrames([...noise.slice(1), frame].join('\n'))).toHaveLength(1)
  })

  it('borne la trace **avant** de la filtrer : la remontée entière tient dans le budget', async () => {
    // Le vrai site du défaut est le chemin de la route publique : la trace est
    // d'abord passée au filtrage des secrets, **puis** découpée. Borner à
    // l'entrée est ce qui protège les deux, et le prochain motif écrit là.
    const network = recorder()
    const hostile = `at ${'  '.repeat(50_000)}`

    const started = performance.now()
    const result = await monitoring({}, network.fetch).capture({
      message: 'boum',
      type: 'TypeError',
      stack: hostile,
      origin: 'client',
      release: null,
      context: {},
    })
    const elapsed = performance.now() - started

    expect(result.ok).toBe(true)
    expect(elapsed, `${elapsed.toFixed(0)} ms pour une remontée hostile`).toBeLessThan(BUDGET_MS)

    const envelope = await capturedEnvelope(network.requests)

    // Rien n'est parti de cette trace : elle ne portait aucun cadre lisible.
    expect(envelope.raw).not.toContain('     ')
  })

  it('la borne rend une trace dont la taille est **prouvée**, pas espérée', () => {
    // `boundStack` est exportée pour cette raison : la garantie est une
    // multiplication, pas une intention.
    const bounded = boundStack([`at ${'  '.repeat(50_000)}`, ...Array.from({ length: 500 }, () => 'x')].join('\n'))

    expect(bounded.length).toBeLessThanOrEqual(MAX_STACK_LINES * (MAX_STACK_LINE_LENGTH + 1))
  })
})

describe('le filtrage des données sensibles, prouvé sur la requête capturée (critère 2)', () => {
  it('ne laisse partir ni mot de passe, ni jeton, ni cookie de session', async () => {
    const network = recorder()

    const result = await monitoring({}, network.fetch).capture({
      message:
        'échec de la requête avec Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.charge.signature',
      type: 'TypeError',
      stack: STACK,
      origin: 'client',
      release: null,
      context: {
        route: '/api/invoices',
        password: 'hunter2-le-mot-de-passe',
        csrfToken: 'tok_3f9c1a2b',
        cookie: 'app_session=abcdef',
      },
    })

    const envelope = await capturedEnvelope(network.requests)

    expect(result.ok).toBe(true)
    expect(envelope.raw, 'le mot de passe a fui').not.toContain('hunter2-le-mot-de-passe')
    expect(envelope.raw, 'le jeton a fui').not.toContain('tok_3f9c1a2b')
    expect(envelope.raw, 'le cookie de session a fui').not.toContain('app_session=abcdef')
    expect(envelope.raw, 'le jeton porteur a fui').not.toContain('eyJhbGciOiJIUzI1NiJ9')
    // Ce qui n'est pas sensible passe : un filtre qui vide tout ne mesure plus rien.
    expect(envelope.raw).toContain('/api/invoices')
  })

  it('n’écrit jamais la clé publique du DSN dans le message d’un échec', async () => {
    const network = recorder(
      () => new Response('clé public_key_abc refusée par https://errors.test/api/42', { status: 401 }),
    )

    const result = await monitoring({}, network.fetch).capture({
      message: 'boum',
      type: 'Error',
      stack: null,
      origin: 'server',
      release: null,
      context: {},
    })

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error.message).not.toContain('public_key_abc')
    expect(result.ok ? '' : result.error.message).not.toContain('https://errors.test')
  })
})

describe('la dégradation', () => {
  it('rend une valeur plutôt que de lever : une remontée qui échoue ne fait pas deux erreurs', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    const result = await monitoring({ maxAttempts: 1 }, failing).capture({
      message: 'boum',
      type: 'Error',
      stack: null,
      origin: 'server',
      release: null,
      context: {},
    })

    expect(result).toEqual({
      ok: false,
      error: { code: 'provider_unavailable', message: 'fetch failed' },
    })
  })

  it('rejoue une panne transitoire et **jamais** une charge refusée', async () => {
    const unavailable = recorder(() => new Response('nope', { status: 503 }))
    await monitoring({ maxAttempts: 3 }, unavailable.fetch).capture({
      message: 'boum',
      type: 'Error',
      stack: null,
      origin: 'server',
      release: null,
      context: {},
    })

    const invalid = recorder(() => new Response('nope', { status: 400 }))
    await monitoring({ maxAttempts: 3 }, invalid.fetch).capture({
      message: 'boum',
      type: 'Error',
      stack: null,
      origin: 'server',
      release: null,
      context: {},
    })

    expect(unavailable.requests).toHaveLength(3)
    expect(invalid.requests).toHaveLength(1)
    expect(isTransientMonitoringError('invalid_event')).toBe(false)
  })
})
