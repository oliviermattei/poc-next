import { buildRegistry, type AnyModuleDefinition, type ModuleJob } from '@repo/core'
import type { JobsLogRecord } from '@repo/ports'
import { describe, expect, it } from 'vitest'

import { createInMemoryJobs } from './in-memory-jobs'
import { createRecordingJobs } from './recording-jobs'

/**
 * Les deux outils du port `Jobs` (s33), et ils ne servent pas à la même chose :
 *
 * - **la doublure d'enregistrement** est le régime de CI (critère 2). Elle
 *   n'exécute rien : elle garde ce qu'on a émis pour qu'un test l'affirme ;
 * - **l'exécuteur en mémoire** est le **mode local** (critère 9). Il exécute
 *   pour de vrai, sans clé, sans réseau, sans service — c'est ce qui permet à
 *   `pnpm dev` de faire tourner les tâches d'un dépôt fraîchement cloné.
 *
 * Ni l'un ni l'autre n'est un second fournisseur (ADR 008) : Inngest reste la
 * seule implémentation, et un outil de test ne la concurrence pas.
 */

const moduleWithJobs = (id: string, jobs: readonly ModuleJob[]): AnyModuleDefinition => ({
  id,
  requires: [],
  schema: {},
  migrations: null,
  routes: [],
  navigation: [],
  publicUrls: () => [],
  messages: { fr: {}, en: {} },
  emails: [],
  webhooks: [],
  jobs,
  dataCategories: [],
  retention: {},
  purge: async () => {},
  export: async () => ({}),
})

const registryOf = (...modules: readonly AnyModuleDefinition[]) =>
  buildRegistry({
    available: modules,
    enabled: modules.map((module) => module.id),
    locales: ['fr', 'en'],
  })

/** Rien n'est différé tout seul : les cas commandent le vidage de la file. */
const runnerOf = (
  registry: ReturnType<typeof registryOf>,
  records: JobsLogRecord[] = [],
): ReturnType<typeof createInMemoryJobs> =>
  createInMemoryJobs({
    registry,
    log: (record) => void records.push(record),
    retry: { maxAttempts: 1, baseMs: 1, maxMs: 1 },
    now: () => new Date('2026-09-05T10:20:00.000Z'),
    random: () => 0.5,
    sleep: async () => {},
    defer: () => {},
  })

describe('la doublure d’enregistrement', () => {
  it('garde le nom du job et sa charge utile, sans rien exécuter', async () => {
    let effects = 0
    const registry = registryOf(
      moduleWithJobs('alpha', [
        { id: 'sweep', schedule: '*/10 * * * *', run: async () => void (effects += 1) },
      ]),
    )
    const recording = createRecordingJobs({ registry })

    const result = await recording.jobs.emit({
      job: 'alpha.sweep',
      key: 'sweep:10:20',
      data: { windowStart: '2026-09-05T10:20:00.000Z' },
    })

    expect(result.ok).toBe(true)
    expect(recording.emissions).toEqual([
      {
        job: 'alpha.sweep',
        key: 'sweep:10:20',
        data: { windowStart: '2026-09-05T10:20:00.000Z' },
      },
    ])
    expect(effects).toBe(0)
  })

  it('refuse une tâche qu’aucun module activé ne déclare, et n’enregistre rien', async () => {
    const recording = createRecordingJobs({ registry: registryOf(moduleWithJobs('alpha', [])) })

    const result = await recording.jobs.emit({ job: 'alpha.ghost', key: 'k', data: {} })

    expect(result).toEqual({
      ok: false,
      error: { code: 'unknown_job', message: expect.stringContaining('alpha.ghost') },
    })
    expect(recording.emissions).toEqual([])
  })
})

describe('l’exécuteur en mémoire', () => {
  it('exécute une émission, avec sa clé et ses références', async () => {
    const seen: { key: string; data: Readonly<Record<string, string>> }[] = []
    const registry = registryOf(
      moduleWithJobs('alpha', [
        {
          id: 'remind',
          schedule: '0 9 * * *',
          run: async ({ key, data }) => void seen.push({ key, data }),
        },
      ]),
    )
    const runner = runnerOf(registry)

    await runner.jobs.emit({ job: 'alpha.remind', key: 'k1', data: { subscriptionId: 'sub_1' } })

    expect(seen).toEqual([])

    await runner.drain()

    expect(seen).toEqual([{ key: 'k1', data: { subscriptionId: 'sub_1' } }])
  })

  it('n’exécute rien pour une tâche qu’aucun module activé ne déclare', async () => {
    const runner = runnerOf(registryOf(moduleWithJobs('alpha', [])))

    const result = await runner.jobs.emit({ job: 'alpha.ghost', key: 'k', data: {} })

    await runner.drain()

    expect(result.ok).toBe(false)
  })

  /**
   * **La tâche planifiée s'exécute selon son expression cron** (critère 4), et
   * chaque exécution est journalisée.
   */
  it('exécute une tâche dont l’échéance tombe à cette minute-là', async () => {
    let swept = 0
    const registry = registryOf(
      moduleWithJobs('alpha', [
        { id: 'sweep', schedule: '*/10 * * * *', run: async () => void (swept += 1) },
        { id: 'daily', schedule: '0 9 * * *', run: async () => {} },
      ]),
    )
    const records: JobsLogRecord[] = []
    const runner = runnerOf(registry, records)

    await runner.tick(new Date('2026-09-05T10:20:00.000Z'))

    expect(swept).toBe(1)
    expect(records.map((record) => [record.event, record.job])).toEqual([
      ['job.started', 'alpha.sweep'],
      ['job.succeeded', 'alpha.sweep'],
    ])
  })

  it('n’exécute rien à une minute qu’aucune échéance ne vise', async () => {
    let swept = 0
    const registry = registryOf(
      moduleWithJobs('alpha', [
        { id: 'sweep', schedule: '*/10 * * * *', run: async () => void (swept += 1) },
      ]),
    )
    const runner = runnerOf(registry)

    await runner.tick(new Date('2026-09-05T10:23:00.000Z'))

    expect(swept).toBe(0)
  })

  /**
   * **L'idempotence se joue deux fois** (`docs/reliability.md` §1). Deux
   * ordonnanceurs — deux instances de l'application — qui voient la même minute
   * ne doivent produire qu'un effet.
   */
  it('ne produit qu’un effet quand la même minute est jouée deux fois', async () => {
    let swept = 0
    const registry = registryOf(
      moduleWithJobs('alpha', [
        { id: 'sweep', schedule: '*/10 * * * *', run: async () => void (swept += 1) },
      ]),
    )
    const runner = runnerOf(registry)
    const minute = new Date('2026-09-05T10:20:00.000Z')

    await runner.tick(minute)
    await runner.tick(minute)

    expect(swept).toBe(1)

    await runner.tick(new Date('2026-09-05T10:30:00.000Z'))

    expect(swept).toBe(2)
  })

  it('ne perd pas les émissions suivantes quand une tâche échoue', async () => {
    let done = 0
    const registry = registryOf(
      moduleWithJobs('alpha', [
        {
          id: 'boom',
          schedule: '0 9 * * *',
          run: async () => {
            throw new Error('le tiers est muet')
          },
        },
        { id: 'fine', schedule: '0 9 * * *', run: async () => void (done += 1) },
      ]),
    )
    const runner = runnerOf(registry)

    await runner.jobs.emit({ job: 'alpha.boom', key: 'k1', data: {} })
    await runner.jobs.emit({ job: 'alpha.fine', key: 'k2', data: {} })
    await runner.drain()

    expect(done).toBe(1)
  })
})
