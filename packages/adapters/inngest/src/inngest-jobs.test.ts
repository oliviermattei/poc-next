import type { JobEmission, JobsError, JobsLogRecord } from '@repo/ports'
import { describe, expect, it, vi } from 'vitest'

import { createInngestJobs, createInngestRunner } from './inngest-jobs'

/**
 * **Le premier des deux régimes** (`docs/architecture.md`) : bloquant en CI, le
 * réseau est doublé et **rien ne part**. Le second — un vrai événement contre
 * l'environnement de développement Inngest — vit dans `inngest-live.test.ts` et
 * ne s'exécute que sur commande explicite.
 *
 * Ce qui est doublé est le **réseau**, jamais le SDK : le gestionnaire de
 * rappel est le vrai `serve` d'`inngest`, et les cas ci-dessous lui envoient une
 * charge d'appel de fonction telle que le serveur d'Inngest en envoie une.
 */

const EVENT_KEY = 'event-key-test-abcdef'
const BASE_URL = 'https://inngest.test'

const accepted = (): Response =>
  new Response(JSON.stringify({ ids: ['01J0EVT'], status: 200 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const emission: JobEmission = {
  job: 'rate-limit.sweep-closed-windows',
  key: 'sweep@2026-09-05T10:20',
  data: { windowStart: '2026-09-05T10:20:00.000Z' },
}

const jobsOf = (
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createInngestJobs>[0]> = {},
) =>
  createInngestJobs({
    eventKey: EVENT_KEY,
    baseUrl: BASE_URL,
    declared: ['rate-limit.sweep-closed-windows'],
    fetch: fetchImpl,
    sleep: async () => {},
    random: () => 0.5,
    ...overrides,
  })

describe('l’émission vers l’API d’événements d’Inngest', () => {
  it('poste le nom qualifié, la charge utile et la clé d’idempotence', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const jobs = jobsOf(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} })

      return accepted()
    })

    const result = await jobs.emit(emission)

    expect(result).toEqual({ ok: true, id: '01J0EVT' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${BASE_URL}/e/${EVENT_KEY}`)
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      name: 'job/rate-limit.sweep-closed-windows',
      // La clé d'idempotence voyage aussi comme `id`, **qualifiée par la
      // tâche** : le fournisseur la déduplique de son côté, ce qui est une
      // seconde ceinture par-dessus le registre d'exécutions du répartiteur.
      id: 'rate-limit.sweep-closed-windows:sweep@2026-09-05T10:20',
      data: { key: 'sweep@2026-09-05T10:20', data: { windowStart: '2026-09-05T10:20:00.000Z' } },
    })
  })

  /**
   * **Les deux ceintures de déduplication doivent se qualifier pareil.**
   *
   * Le registre d'exécutions condense `<tâche>:<clé>` — son commentaire dit que
   * deux tâches choisissant la même clé ne doivent pas se déduplaquer l'une
   * l'autre. Chez le fournisseur, la documentation d'Inngest dit la même chose :
   * l'identifiant « n'est pas propre au type d'événement… combinez l'identifiant
   * de l'élément avec le type d'événement ». La première version envoyait la clé
   * **nue** : deux tâches déclenchées le même jour avec une clé de jour
   * (`2026-09-05`) se seraient annulées l'une l'autre côté fournisseur, alors
   * que le registre les aurait bien distinguées (constat F6 de la revue de s33).
   */
  it('qualifie l’identifiant de déduplication du fournisseur par la tâche', async () => {
    const sent: string[] = []
    const jobs = jobsOf(
      async (_url, init) => {
        sent.push(String((JSON.parse(String(init?.body)) as { id: string }).id))

        return accepted()
      },
      { declared: ['alpha.sweep', 'beta.sweep'] },
    )

    await jobs.emit({ job: 'alpha.sweep', key: '2026-09-05', data: {} })
    await jobs.emit({ job: 'beta.sweep', key: '2026-09-05', data: {} })

    // Deux tâches, une même clé de jour, **deux** identifiants distincts.
    expect(new Set(sent).size).toBe(2)
    expect(sent).toEqual(['alpha.sweep:2026-09-05', 'beta.sweep:2026-09-05'])
  })

  it('refuse une tâche qu’aucun module activé ne déclare, sans toucher au réseau', async () => {
    const fetchImpl = vi.fn(async () => accepted())
    const jobs = jobsOf(fetchImpl as unknown as typeof fetch)

    const result = await jobs.emit({ job: 'gamma.ghost', key: 'k', data: {} })

    expect(result).toEqual({
      ok: false,
      error: { code: 'unknown_job', message: expect.stringContaining('gamma.ghost') },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('réessaie une panne du fournisseur jusqu’au plafond, puis rend l’échec', async () => {
    let attempts = 0
    const jobs = jobsOf(
      async () => {
        attempts += 1

        return new Response('nope', { status: 503 })
      },
      { maxAttempts: 3 },
    )

    const result = await jobs.emit(emission)

    expect(attempts).toBe(3)
    expect(result.ok).toBe(false)
    expect(result.ok ? null : result.error.code).toBe('provider_unavailable')
  })

  /**
   * **Une clé refusée est définitive** : la rejouer ne la répare pas, et
   * `docs/reliability.md` §3 interdit de rejouer autre chose qu'un transitoire.
   */
  it('ne réessaie pas une clé refusée', async () => {
    let attempts = 0
    const jobs = jobsOf(
      async () => {
        attempts += 1

        return new Response('unauthorized', { status: 401 })
      },
      { maxAttempts: 3 },
    )

    const result = await jobs.emit(emission)

    expect(attempts).toBe(1)
    expect(result.ok ? null : result.error.code).toBe('unauthorized')
  })

  it('abandonne l’appel au bout du délai explicite, et le dit', async () => {
    const jobs = jobsOf(
      async (_url, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          )
        }),
      { timeoutMs: 5, maxAttempts: 1 },
    )

    const result = await jobs.emit(emission)

    expect(result.ok ? null : result.error.code).toBe('timeout')
  })

  /** `docs/security.md` §5 : la clé du fournisseur ne sort jamais dans un journal. */
  it('n’écrit jamais la clé du fournisseur dans le message d’échec', async () => {
    const records: JobsLogRecord[] = []
    const jobs = jobsOf(
      async () => new Response(`clé ${EVENT_KEY} refusée`, { status: 400 }),
      { maxAttempts: 1, log: (record) => void records.push(record) },
    )

    const result = await jobs.emit(emission)
    const error = result.ok ? ({ message: '' } as JobsError) : result.error

    expect(error.message).not.toContain(EVENT_KEY)
    expect(records.map((record) => record.event)).toEqual(['job.emit_failed'])
    expect(records[0]?.message).not.toContain(EVENT_KEY)
  })
})

/**
 * **Le gestionnaire de rappel** : c'est par lui qu'Inngest exécute réellement
 * une tâche déclarée. Sans lui, l'émission partirait dans le vide.
 *
 * Le `serve` est le vrai, celui du SDK ; la charge d'appel est celle qu'envoie
 * le serveur d'Inngest. Le mode développement est explicite (`isDev`), jamais
 * déduit de `NODE_ENV`, et c'est ce qui permet à ces cas de tourner sans clé de
 * signature.
 */
describe('le gestionnaire de rappel', () => {
  const runnerOf = (dispatch: Parameters<typeof createInngestRunner>[0]['dispatch']) =>
    createInngestRunner({
      appId: 'killer-saas',
      servePath: '/api/modules/jobs/inngest',
      isDev: true,
      jobs: [
        { id: 'rate-limit.sweep-closed-windows', schedule: '*/10 * * * *' },
        { id: 'billing.trial-ending', schedule: '0 9 * * *' },
      ],
      dispatch,
    })

  const call = async (
    handler: (request: Request) => Promise<Response>,
    functionId: string,
    event: Readonly<Record<string, unknown>>,
  ): Promise<Response> => {
    const payload = {
      ctx: { run_id: 'run_1', attempt: 0, stack: { stack: [], current: 0 } },
      event,
      events: [event],
      steps: {},
      use_api: false,
    }

    return await handler(
      new Request(`http://localhost:3000/api/modules/jobs/inngest?fnId=${functionId}&stepId=step`, {
        method: 'POST',
        headers: { host: 'localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    )
  }

  it('déclare une fonction par tâche du registre', async () => {
    const handler = runnerOf(async () => ({ ok: true }))

    const response = await handler(
      new Request('http://localhost:3000/api/modules/jobs/inngest', {
        method: 'GET',
        headers: { host: 'localhost:3000' },
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ function_count: 2, mode: 'dev' })
  })

  it('exécute la tâche que l’appel nomme, avec sa clé et ses références', async () => {
    const dispatched: JobEmission[] = []
    const handler = runnerOf(async (received) => {
      dispatched.push(received)

      return { ok: true }
    })

    const response = await call(handler, 'killer-saas-rate-limit-sweep-closed-windows', {
      name: 'job/rate-limit.sweep-closed-windows',
      id: 'evt_1',
      ts: 1_788_600_000_000,
      data: { key: 'sweep@2026-09-05T10:20', data: { windowStart: '2026-09-05T10:20:00.000Z' } },
    })

    expect(response.status).toBe(200)
    expect(dispatched).toEqual([
      {
        job: 'rate-limit.sweep-closed-windows',
        key: 'sweep@2026-09-05T10:20',
        data: { windowStart: '2026-09-05T10:20:00.000Z' },
      },
    ])
  })

  /**
   * Une échéance cron ne porte aucune charge utile : la clé d'idempotence est
   * **la minute**, exactement comme dans l'exécuteur en mémoire, sans quoi deux
   * livraisons d'une même échéance produiraient deux effets.
   */
  it('dérive la clé d’une échéance cron de sa minute', async () => {
    const dispatched: JobEmission[] = []
    const handler = runnerOf(async (received) => {
      dispatched.push(received)

      return { ok: true }
    })

    await call(handler, 'killer-saas-billing-trial-ending', {
      name: 'inngest/scheduled.timer',
      id: 'evt_2',
      ts: 1_788_600_000_000,
      data: {},
    })

    expect(dispatched).toEqual([
      {
        job: 'billing.trial-ending',
        key: `billing.trial-ending@${new Date(1_788_600_000_000).toISOString().slice(0, 16)}`,
        data: {},
      },
    ])
  })

  it('rend l’échec du répartiteur au fournisseur plutôt que de le taire', async () => {
    const handler = runnerOf(async () => ({
      ok: false,
      error: { code: 'invalid_event', message: 'charge utile illisible' },
    }))

    const response = await call(handler, 'killer-saas-rate-limit-sweep-closed-windows', {
      name: 'job/rate-limit.sweep-closed-windows',
      id: 'evt_3',
      ts: 1_788_600_000_000,
      data: { key: 'k', data: {} },
    })

    expect(response.status).toBeGreaterThanOrEqual(400)
  })
})
