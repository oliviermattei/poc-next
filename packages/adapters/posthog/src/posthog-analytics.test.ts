import type { AnalyticsLogRecord } from '@repo/ports'
import { describe, expect, it } from 'vitest'

import { createPostHogAnalytics, isTransientAnalyticsError } from './posthog-analytics'

/**
 * **Le premier des deux régimes** (`docs/architecture.md`) : bloquant en CI, il
 * double le **réseau** — jamais le SDK — et n'atteint aucun service. Les
 * requêtes réellement émises sont **capturées et assertées** ; le second régime,
 * qui parle au vrai fournisseur, vit dans `posthog-live.test.ts`.
 *
 * **Ce que ce régime prouve, et ce qu'il ne prouve pas.** Il prouve la forme de
 * ce que *nous* émettons : l'URL, la méthode, le corps, ce qui en a été retiré.
 * Il ne prouve **rien** de la fidélité au fournisseur — c'est exactement la
 * moitié que le régime `recorded` du parcours doré a laissée vide, et qu'une CI
 * verte y fait passer pour vérifiée. Ici la fidélité est le travail du régime
 * réel, et de lui seul.
 */

/** Une doublure de réseau qui **enregistre**. */
const recorder = (respond: (request: Request) => Response = () => Response.json({ status: 1 })) => {
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

/**
 * **Le plancher du régime enregistré**, et c'est lui qui distingue cette recette
 * de celle qui a échoué ailleurs : une assertion portée sur une capture **vide**
 * ne passe pas au vert, elle échoue en le disant. Toute lecture d'une requête
 * capturée traverse cette fonction — un cas qui n'émettrait rien ne peut donc
 * pas se déclarer conforme.
 */
const capturedText = async (requests: readonly Request[]): Promise<string> => {
  if (requests.length === 0) {
    throw new Error('régime enregistré : aucune requête capturée, il n’y a rien à asserter')
  }

  return await (requests.at(-1) as Request).clone().text()
}

const capturedBody = async (requests: readonly Request[]): Promise<Record<string, unknown>> =>
  JSON.parse(await capturedText(requests)) as Record<string, unknown>

const analytics = (
  overrides: Partial<Parameters<typeof createPostHogAnalytics>[0]> = {},
  fetchImpl?: typeof fetch,
) =>
  createPostHogAnalytics({
    apiKey: 'phc_secret_project_key',
    host: 'https://analytics.test',
    fetch: fetchImpl,
    sleep: async () => {},
    random: () => 0.5,
    now: () => new Date('2026-09-06T10:00:00.000Z'),
    ...overrides,
  })

describe('la requête émise, capturée et assertée', () => {
  it('poste l’événement sur le chemin de capture documenté', async () => {
    const network = recorder()
    const result = await analytics({}, network.fetch).track({
      name: 'auth.signed_up',
      distinctId: 'user-42',
      properties: { plan: 'free' },
    })

    const body = await capturedBody(network.requests)

    expect(result.ok).toBe(true)
    expect(network.requests[0]?.method).toBe('POST')
    expect(network.requests[0]?.url).toBe('https://analytics.test/i/v0/e/')
    expect(body.event).toBe('auth.signed_up')
    expect(body.distinct_id).toBe('user-42')
    expect(body.properties).toMatchObject({ plan: 'free' })
  })

  it('mesure un affichage de page sans jamais emporter la query', async () => {
    const network = recorder()
    await analytics({}, network.fetch).page({
      path: '/verify-email',
      distinctId: 'user-42',
      properties: {},
    })

    const body = await capturedBody(network.requests)

    expect(body.event).toBe('$pageview')
    expect(body.properties).toMatchObject({ $pathname: '/verify-email' })
    // Le port ne transporte qu'un chemin : une URL complète emporterait la
    // query, où vivent les jetons de vérification de ce dépôt.
    expect(JSON.stringify(body)).not.toContain('?')
  })

  it('le plancher : asserter sur une capture vide échoue au lieu de passer', async () => {
    await expect(capturedBody([])).rejects.toThrow(/aucune requête capturée/)
    await expect(capturedText([])).rejects.toThrow(/aucune requête capturée/)
  })
})

describe('le filtrage des données sensibles, prouvé sur la requête capturée (critère 2)', () => {
  it('ne laisse partir ni mot de passe, ni jeton, ni cookie de session', async () => {
    const network = recorder()
    const seen: AnalyticsLogRecord[] = []

    const result = await analytics({ log: (record) => seen.push(record) }, network.fetch).track({
      name: 'auth.signed_up',
      distinctId: 'user-42',
      properties: {
        plan: 'pro',
        password: 'hunter2-le-mot-de-passe',
        resetToken: 'tok_3f9c1a2b',
        sessionCookie: 'app_session=abcdef',
        bearer: 'Bearer eyJhbGciOiJIUzI1NiJ9.charge.signature',
      },
    })

    // **Par le plancher**, comme toute lecture d'une capture : lu directement,
    // ce cas passait au vert sur un adaptateur muet (constat mineur de la revue).
    const raw = await capturedText(network.requests)

    expect(result.ok).toBe(true)
    // L'assertion porte sur **ce que le réseau a vu**, jamais sur l'intention.
    expect(raw, 'le mot de passe a fui').not.toContain('hunter2-le-mot-de-passe')
    expect(raw, 'le jeton a fui').not.toContain('tok_3f9c1a2b')
    expect(raw, 'le cookie de session a fui').not.toContain('app_session=abcdef')
    expect(raw, 'le jeton porteur a fui').not.toContain('eyJhbGciOiJIUzI1NiJ9')

    const body = await capturedBody(network.requests)

    // Ce qui n'est pas sensible passe : un filtre qui vide tout ne mesure plus rien.
    expect(body.properties).toMatchObject({ plan: 'pro' })
    expect(seen[0]?.redacted).toEqual(
      expect.arrayContaining(['password', 'resetToken', 'sessionCookie', 'bearer']),
    )
  })

  it('n’écrit jamais la clé de projet dans le message d’un échec', async () => {
    const network = recorder(
      () =>
        new Response('clé phc_secret_project_key refusée sur https://analytics.test/i/v0/e/', {
          status: 401,
        }),
    )

    const result = await analytics({}, network.fetch).track({
      name: 'auth.signed_up',
      distinctId: 'user-42',
      properties: {},
    })

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error.message).not.toContain('phc_secret_project_key')
    expect(result.ok ? '' : result.error.message).not.toContain('https://analytics.test')
  })
})

describe('la dégradation, et la reprise', () => {
  it('rend une valeur plutôt que de lever quand le réseau tombe', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    const result = await analytics({ maxAttempts: 1 }, failing).track({
      name: 'auth.signed_up',
      distinctId: 'user-42',
      properties: {},
    })

    expect(result).toEqual({
      ok: false,
      error: { code: 'provider_unavailable', message: 'fetch failed' },
    })
  })

  it('rejoue une panne transitoire et **jamais** une validation refusée', async () => {
    const unavailable = recorder(() => new Response('nope', { status: 503 }))
    await analytics({ maxAttempts: 3 }, unavailable.fetch).track({
      name: 'auth.signed_up',
      distinctId: 'u',
      properties: {},
    })

    const invalid = recorder(() => new Response('nope', { status: 400 }))
    await analytics({ maxAttempts: 3 }, invalid.fetch).track({
      name: 'auth.signed_up',
      distinctId: 'u',
      properties: {},
    })

    expect(unavailable.requests).toHaveLength(3)
    // `docs/reliability.md` §3 : rejouer une erreur de validation est un défaut.
    expect(invalid.requests).toHaveLength(1)
  })

  it('abandonne sur son délai explicite, et le classe comme transitoire', async () => {
    const hanging = (async (_input: string | URL, init?: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      })) as unknown as typeof fetch

    const result = await analytics({ maxAttempts: 1, timeoutMs: 5 }, hanging).track({
      name: 'auth.signed_up',
      distinctId: 'u',
      properties: {},
    })

    expect(result.ok ? null : result.error.code).toBe('timeout')
    expect(isTransientAnalyticsError('timeout')).toBe(true)
  })
})
