import { describe, expect, it, vi } from 'vitest'

import {
  assertJobsAreRunnable,
  classifyJobFailure,
  cronMatches,
  dispatchModuleJob,
  isTransientJobsError,
  jobBackoffDelayMs,
  JobFailure,
  JobsConfigurationError,
  qualifyJobId,
  scheduledJobs,
  type JobRunLedger,
} from './jobs'
import type { AnyModuleDefinition, ModuleJob } from './module'
import { buildRegistry } from './registry'
import type { JobsLogRecord } from '@repo/ports'

/**
 * **Le répartiteur de tâches** (s33) — la moitié manquante d'un contrat écrit
 * depuis le premier module.
 *
 * `registry.jobs` était agrégé depuis toujours et **n'avait aucun
 * consommateur** : un seul module sur treize déclarait un job, et il n'a jamais
 * tourné. Ces cas éprouvent la fonction qui le lit, et le plancher qui empêche
 * de relivrer cet état-là — un tableau agrégé que rien ne consomme, avec des
 * tests verts.
 */

const moduleWithJobs = (
  id: string,
  jobs: readonly ModuleJob[],
  overrides: Partial<AnyModuleDefinition> = {},
): AnyModuleDefinition => ({
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
  ...overrides,
})

const registryOf = (...modules: readonly AnyModuleDefinition[]) =>
  buildRegistry({
    available: modules,
    enabled: modules.map((module) => module.id),
    locales: ['fr', 'en'],
  })

const NOW = new Date('2026-09-05T10:00:00.000Z')

/** Journal de test : ce que le répartiteur a écrit, dans l'ordre. */
const recorder = (): { readonly log: (record: JobsLogRecord) => void; readonly records: JobsLogRecord[] } => {
  const records: JobsLogRecord[] = []

  return { log: (record) => void records.push(record), records }
}

/** Politique de reprise instantanée : les tests ne dorment pas. */
const dispatch = async (
  options: Omit<Parameters<typeof dispatchModuleJob>[0], 'log' | 'now' | 'retry' | 'sleep'> & {
    readonly log?: (record: JobsLogRecord) => void
    readonly retry?: Parameters<typeof dispatchModuleJob>[0]['retry']
  },
) =>
  await dispatchModuleJob({
    ...options,
    log: options.log ?? (() => {}),
    retry: options.retry ?? { maxAttempts: 1, baseMs: 1, maxMs: 1 },
    now: () => NOW,
    random: () => 0.5,
    sleep: async () => {},
  })

describe('l’identifiant qualifié d’un job', () => {
  it('préfixe le job par son module, comme une clé de traduction', () => {
    expect(qualifyJobId('rate-limit', 'sweep-closed-windows')).toBe(
      'rate-limit.sweep-closed-windows',
    )
  })

  it('qualifie les jobs du registre, module par module', () => {
    const registry = registryOf(
      moduleWithJobs('alpha', [{ id: 'sweep', schedule: '*/10 * * * *', run: async () => {} }]),
      moduleWithJobs('beta', [{ id: 'sweep', schedule: '0 * * * *', run: async () => {} }]),
    )

    expect(scheduledJobs(registry).map((entry) => entry.id)).toEqual(['alpha.sweep', 'beta.sweep'])
  })
})

/**
 * **Le plancher, et c'est le cœur de la story.**
 *
 * Sans lui, on relivre exactement l'état d'aujourd'hui : un ordonnanceur qui
 * démarre, trouve zéro job, et tourne à vide pendant que `rate_limit_window`
 * continue de grossir — avec une suite verte.
 */
describe('la garde de démarrage de l’ordonnanceur', () => {
  it('refuse un balayage vide : un ordonnanceur sans job ne surveille rien', () => {
    expect(() => assertJobsAreRunnable([])).toThrow(JobsConfigurationError)
    expect(() => assertJobsAreRunnable([])).toThrow(/aucune tâche/i)
  })

  it('accepte un registre qui déclare au moins une tâche', () => {
    const registry = registryOf(
      moduleWithJobs('alpha', [{ id: 'sweep', schedule: '*/10 * * * *', run: async () => {} }]),
    )

    expect(() => assertJobsAreRunnable(scheduledJobs(registry))).not.toThrow()
  })

  it('refuse deux tâches de même identifiant qualifié, en le nommant', () => {
    const duplicated = scheduledJobs(
      registryOf(
        moduleWithJobs('alpha', [
          { id: 'sweep', schedule: '*/10 * * * *', run: async () => {} },
          { id: 'sweep', schedule: '0 * * * *', run: async () => {} },
        ]),
      ),
    )

    expect(() => assertJobsAreRunnable(duplicated)).toThrow(/alpha\.sweep/)
  })
})

describe('le répartiteur, sur la tâche déclarée par un module activé', () => {
  it('exécute la tâche que l’émission nomme, et rien d’autre', async () => {
    const swept = vi.fn(async () => {})
    const other = vi.fn(async () => {})
    const registry = registryOf(
      moduleWithJobs('alpha', [{ id: 'sweep', schedule: '*/10 * * * *', run: swept }]),
      moduleWithJobs('beta', [{ id: 'other', schedule: '0 * * * *', run: other }]),
    )

    const result = await dispatch({
      registry,
      emission: { job: 'alpha.sweep', key: 'k1', data: {} },
    })

    expect(result).toEqual({ ok: true, ran: true, attempts: 1 })
    expect(swept).toHaveBeenCalledTimes(1)
    expect(other).not.toHaveBeenCalled()
  })

  it('passe la clé et les références de l’émission à la tâche', async () => {
    const seen: unknown[] = []
    const registry = registryOf(
      moduleWithJobs('alpha', [
        {
          id: 'sweep',
          schedule: '*/10 * * * *',
          run: async (context) => void seen.push(context),
        },
      ]),
    )

    await dispatch({
      registry,
      emission: { job: 'alpha.sweep', key: 'k1', data: { subscriptionId: 'sub_1' } },
    })

    expect(seen).toEqual([
      { key: 'k1', data: { subscriptionId: 'sub_1' }, attempt: 1, now: NOW },
    ])
  })

  /**
   * **Un module coupé emporte ses tâches**, et l'émission vers l'une d'elles est
   * un échec **définitif** nommé — jamais une file qui grossit sans
   * consommateur, qui est précisément l'état que cette story corrige.
   */
  it('refuse une tâche qu’aucun module activé ne déclare, sans rien exécuter', async () => {
    const run = vi.fn(async () => {})
    const registry = registryOf(
      moduleWithJobs('alpha', [{ id: 'sweep', schedule: '*/10 * * * *', run }]),
      moduleWithJobs('beta', [{ id: 'other', schedule: '0 * * * *', run: async () => {} }], {
        id: 'beta',
      }),
    )
    const { log, records } = recorder()

    const result = await dispatch({
      registry,
      emission: { job: 'gamma.ghost', key: 'k1', data: {} },
      log,
    })

    expect(result).toEqual({
      ok: false,
      error: { code: 'unknown_job', message: expect.stringContaining('gamma.ghost') },
      attempts: 0,
    })
    expect(run).not.toHaveBeenCalled()
    expect(records.map((record) => record.event)).toEqual(['job.emit_failed'])
  })

  it('journalise le début et la réussite d’une exécution', async () => {
    const registry = registryOf(
      moduleWithJobs('alpha', [{ id: 'sweep', schedule: '*/10 * * * *', run: async () => {} }]),
    )
    const { log, records } = recorder()

    await dispatch({ registry, emission: { job: 'alpha.sweep', key: 'k1', data: {} }, log })

    expect(records).toEqual([
      { event: 'job.started', job: 'alpha.sweep', key: 'k1', attempt: 1, code: null, message: null },
      {
        event: 'job.succeeded',
        job: 'alpha.sweep',
        key: 'k1',
        attempt: 1,
        code: null,
        message: null,
      },
    ])
  })
})

describe('le classement des échecs d’exécution', () => {
  it('classe l’inconnu comme transitoire, jamais comme définitif', () => {
    // Traiter l'inconnu comme définitif supprimerait la reprise exactement
    // quand elle sert (`docs/reliability.md` §3).
    expect(classifyJobFailure(new Error('boom')).code).toBe('provider_unavailable')
    expect(isTransientJobsError('provider_unavailable')).toBe(true)
  })

  it('lit le code que la tâche a écrit sur son échec', () => {
    expect(classifyJobFailure(new JobFailure('invalid_event', 'charge utile illisible')).code).toBe(
      'invalid_event',
    )
  })

  /**
   * **Une erreur de validation est définitive**, et c'est la règle que
   * `docs/reliability.md` §3 nomme en toutes lettres. Zod est la validation de
   * ce dépôt : son erreur ne doit jamais partir en reprise.
   */
  it('classe une erreur de validation comme définitive', () => {
    const zodLike = Object.assign(new Error('invalid input'), {
      name: 'ZodError',
      issues: [{ path: ['subscriptionId'], message: 'Required' }],
    })

    expect(classifyJobFailure(zodLike).code).toBe('invalid_event')
    expect(isTransientJobsError('invalid_event')).toBe(false)
  })

  it('n’écrit dans le message d’échec ni charge utile ni clé de fournisseur', () => {
    const leaky = new Error(
      'échec sur https://inn.gs/e/signkey-prod-abcdef avec {"email":"qui@exemple.test"}',
    )

    const { message } = classifyJobFailure(leaky)

    expect(message).not.toContain('signkey-prod-abcdef')
    expect(message).not.toContain('qui@exemple.test')
  })
})

describe('les expressions cron', () => {
  it.each([
    ['*/10 * * * *'],
    ['0 9 * * *'],
    ['0 0 1 1 0'],
    ['15,45 * * * *'],
    ['0 9-17 * * 1-5'],
  ])('accepte %s', (expression) => {
    expect(() =>
      assertJobsAreRunnable([
        { id: 'alpha.sweep', moduleId: 'alpha', job: { id: 'sweep', schedule: expression, run: async () => {} } },
      ]),
    ).not.toThrow()
  })

  /**
   * **Le contrat porte `schedule` en chaîne libre et rien ne la validait**,
   * puisque rien ne la lisait : une expression fausse était silencieuse. Le
   * répartiteur la refuse au démarrage, en nommant la tâche.
   */
  it.each([
    ['une expression vide', ''],
    ['quatre champs au lieu de cinq', '*/10 * * *'],
    ['une minute hors bornes', '99 * * * *'],
    ['un mois hors bornes', '0 0 1 13 *', ],
    ['un pas nul', '*/0 * * * *'],
    ['une plage inversée', '0 17-9 * * *'],
    ['du texte', 'tous les matins'],
  ])('refuse %s en nommant la tâche', (_why, expression) => {
    expect(() =>
      assertJobsAreRunnable([
        {
          id: 'alpha.sweep',
          moduleId: 'alpha',
          job: { id: 'sweep', schedule: expression, run: async () => {} },
        },
      ]),
    ).toThrow(/alpha\.sweep/)
  })

  it('dit si une échéance tombe à cette minute-là', () => {
    expect(cronMatches('*/10 * * * *', new Date('2026-09-05T10:20:00.000Z'))).toBe(true)
    expect(cronMatches('*/10 * * * *', new Date('2026-09-05T10:23:00.000Z'))).toBe(false)
    expect(cronMatches('0 9 * * *', new Date('2026-09-05T09:00:00.000Z'))).toBe(true)
    expect(cronMatches('0 9 * * *', new Date('2026-09-05T10:00:00.000Z'))).toBe(false)
    // Samedi 5 septembre 2026 : jour 6 de la semaine.
    expect(cronMatches('0 9 * * 1-5', new Date('2026-09-05T09:00:00.000Z'))).toBe(false)
    expect(cronMatches('0 9 * * 6', new Date('2026-09-05T09:00:00.000Z'))).toBe(true)
  })
})

/**
 * **L'idempotence se joue deux fois, elle ne se déclare pas** —
 * `docs/reliability.md` §1 : « proven by running it twice and observing one
 * effect, never asserted in a comment ».
 */
describe('le rejeu d’une même exécution', () => {
  const ledgerOf = (): JobRunLedger => {
    const claimed = new Set<string>()

    return {
      claim: async ({ job, key }) => {
        const identity = `${job}:${key}`

        if (claimed.has(identity)) {
          return false
        }

        claimed.add(identity)

        return true
      },
      release: async ({ job, key }) => void claimed.delete(`${job}:${key}`),
    }
  }

  it('ne produit qu’un seul effet pour deux émissions de même clé', async () => {
    let effects = 0
    const registry = registryOf(
      moduleWithJobs('alpha', [
        { id: 'sweep', schedule: '*/10 * * * *', run: async () => void (effects += 1) },
      ]),
    )
    const ledger = ledgerOf()
    const emission = { job: 'alpha.sweep', key: 'sweep:10:00', data: {} }

    const first = await dispatch({ registry, emission, ledger })
    const second = await dispatch({ registry, emission, ledger })

    expect(effects).toBe(1)
    expect(first).toEqual({ ok: true, ran: true, attempts: 1 })
    expect(second).toEqual({ ok: true, ran: false, attempts: 0 })
  })

  it('exécute deux fois deux clés différentes', async () => {
    let effects = 0
    const registry = registryOf(
      moduleWithJobs('alpha', [
        { id: 'sweep', schedule: '*/10 * * * *', run: async () => void (effects += 1) },
      ]),
    )
    const ledger = ledgerOf()

    await dispatch({ registry, emission: { job: 'alpha.sweep', key: 'a', data: {} }, ledger })
    await dispatch({ registry, emission: { job: 'alpha.sweep', key: 'b', data: {} }, ledger })

    expect(effects).toBe(2)
  })

  it('journalise le rejeu comme sauté, sans rien exécuter', async () => {
    const registry = registryOf(
      moduleWithJobs('alpha', [{ id: 'sweep', schedule: '*/10 * * * *', run: async () => {} }]),
    )
    const ledger = ledgerOf()
    const emission = { job: 'alpha.sweep', key: 'k', data: {} }
    const { log, records } = recorder()

    await dispatch({ registry, emission, ledger })
    await dispatch({ registry, emission, ledger, log })

    expect(records.map((record) => record.event)).toEqual(['job.skipped'])
  })

  /**
   * **Un magasin en panne ne fait pas lever le répartiteur.**
   *
   * Trois documents affirmaient qu'un refus du registre « reporte l'exécution à
   * la prochaine échéance, et le répartiteur la journalise » — et
   * `createDrizzleJobLedger` rejette sur son délai de cinq secondes comme sur
   * toute erreur du pilote, si bien que `dispatchModuleJob` levait **avant tout
   * appel au journal** (constat F4 de la revue de s33). `in-memory-jobs.ts`
   * construit sa boucle de vidage sur la même promesse.
   */
  it('rend un échec journalisé quand le registre d’exécutions est en panne', async () => {
    const run = vi.fn(async () => {})
    const registry = registryOf(
      moduleWithJobs('alpha', [{ id: 'sweep', schedule: '*/10 * * * *', run }]),
    )
    const { log, records } = recorder()

    const result = await dispatch({
      registry,
      emission: { job: 'alpha.sweep', key: 'k', data: {} },
      ledger: {
        claim: async () => {
          throw new Error('Le registre d’exécutions n’a pas répondu en 5000 ms.')
        },
        release: async () => {},
      },
      log,
    })

    expect(result).toEqual({
      ok: false,
      error: { code: 'provider_unavailable', message: expect.any(String) },
      attempts: 0,
    })
    // La tâche n'a **pas** tourné : réserver est ce qui autorise à exécuter.
    expect(run).not.toHaveBeenCalled()
    expect(records.map((record) => record.event)).toEqual(['job.failed'])
  })

  /**
   * Une libération en panne ne doit pas **masquer** l'échec qu'elle suivait :
   * l'appelant apprendrait une panne de magasin là où la tâche a échoué pour une
   * autre raison, et le journal porterait le mauvais code.
   */
  it('garde l’échec d’origine quand la libération échoue elle aussi', async () => {
    const registry = registryOf(
      moduleWithJobs('alpha', [
        {
          id: 'sweep',
          schedule: '*/10 * * * *',
          run: async () => {
            throw new JobFailure('invalid_event', 'charge utile illisible')
          },
        },
      ]),
    )
    const { log, records } = recorder()

    const result = await dispatch({
      registry,
      emission: { job: 'alpha.sweep', key: 'k', data: {} },
      ledger: {
        claim: async () => true,
        release: async () => {
          throw new Error('magasin injoignable')
        },
      },
      log,
    })

    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid_event', message: expect.stringContaining('charge utile') },
      attempts: 1,
    })
    expect(records.at(-1)?.code).toBe('invalid_event')
  })

  /**
   * Un échec **libère** la clé : sans cela, une panne passagère condamnerait
   * l'exécution pour toujours, ce qui est l'inverse de l'idempotence — c'est de
   * la perte.
   */
  it('libère la clé quand l’exécution a définitivement échoué', async () => {
    let attempts = 0
    const registry = registryOf(
      moduleWithJobs('alpha', [
        {
          id: 'sweep',
          schedule: '*/10 * * * *',
          run: async () => {
            attempts += 1

            if (attempts === 1) {
              throw new JobFailure('invalid_event', 'charge utile illisible')
            }
          },
        },
      ]),
    )
    const ledger = ledgerOf()
    const emission = { job: 'alpha.sweep', key: 'k', data: {} }

    const failed = await dispatch({ registry, emission, ledger })
    const retried = await dispatch({ registry, emission, ledger })

    expect(failed.ok).toBe(false)
    expect(retried).toEqual({ ok: true, ran: true, attempts: 1 })
    expect(attempts).toBe(2)
  })
})

/**
 * **La politique de reprise, et ce qu'elle ne réessaie pas.**
 * `docs/reliability.md` §3 : « transient errors only — retrying a validation
 * error is a defect ».
 */
describe('la reprise d’une tâche en échec', () => {
  const failingRegistry = (error: unknown, failures: number) => {
    let attempts = 0

    const registry = registryOf(
      moduleWithJobs('alpha', [
        {
          id: 'sweep',
          schedule: '*/10 * * * *',
          run: async () => {
            attempts += 1

            if (attempts <= failures) {
              throw error
            }
          },
        },
      ]),
    )

    return { registry, attemptsMade: () => attempts }
  }

  it('réessaie une erreur transitoire jusqu’au plafond configuré', async () => {
    const { registry, attemptsMade } = failingRegistry(new Error('le tiers est muet'), 99)
    const { log, records } = recorder()

    const result = await dispatch({
      registry,
      emission: { job: 'alpha.sweep', key: 'k', data: {} },
      retry: { maxAttempts: 3, baseMs: 10, maxMs: 100 },
      log,
    })

    expect(attemptsMade()).toBe(3)
    expect(result).toEqual({
      ok: false,
      error: { code: 'provider_unavailable', message: expect.any(String) },
      attempts: 3,
    })
    expect(records.filter((record) => record.event === 'job.retrying')).toHaveLength(2)
    expect(records.at(-1)?.event).toBe('job.failed')
  })

  it('rend la main dès que la reprise réussit', async () => {
    const { registry, attemptsMade } = failingRegistry(new Error('le tiers est muet'), 1)

    const result = await dispatch({
      registry,
      emission: { job: 'alpha.sweep', key: 'k', data: {} },
      retry: { maxAttempts: 3, baseMs: 10, maxMs: 100 },
    })

    expect(attemptsMade()).toBe(2)
    expect(result).toEqual({ ok: true, ran: true, attempts: 2 })
  })

  /**
   * **Le cas qui compte.** Réessayer une validation est un défaut, pas une
   * prudence : la charge utile ne changera pas d'une tentative à l'autre.
   */
  it('ne réessaie jamais une erreur définitive, quel que soit le plafond', async () => {
    const { registry, attemptsMade } = failingRegistry(
      new JobFailure('invalid_event', 'identifiant d’abonnement absent'),
      99,
    )
    const { log, records } = recorder()

    const result = await dispatch({
      registry,
      emission: { job: 'alpha.sweep', key: 'k', data: {} },
      retry: { maxAttempts: 5, baseMs: 10, maxMs: 100 },
      log,
    })

    expect(attemptsMade()).toBe(1)
    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid_event', message: expect.any(String) },
      attempts: 1,
    })
    expect(records.filter((record) => record.event === 'job.retrying')).toHaveLength(0)
    expect(records.at(-1)).toEqual({
      event: 'job.failed',
      job: 'alpha.sweep',
      key: 'k',
      attempt: 1,
      code: 'invalid_event',
      message: expect.stringContaining('abonnement'),
    })
  })

  it('attend entre deux tentatives, en reculant et avec dispersion', () => {
    const policy = { baseMs: 100, maxMs: 1_000 }

    // Sans dispersion, mille instances qui échouent sur la même panne rejouent
    // à la même milliseconde et achèvent le tiers au moment où il se relève.
    expect(jobBackoffDelayMs(1, { ...policy, random: () => 0 })).toBe(50)
    expect(jobBackoffDelayMs(1, { ...policy, random: () => 1 })).toBe(100)
    expect(jobBackoffDelayMs(2, { ...policy, random: () => 0 })).toBe(100)
    expect(jobBackoffDelayMs(9, { ...policy, random: () => 1 })).toBe(1_000)
  })
})
