import {
  assertJobsAreRunnable,
  buildRegistry,
  cronMatches,
  dispatchModuleJob,
  dispatchModuleRequest,
  MODULE_ROUTE_PREFIX,
  isTransientJobsError,
  qualifyJobId,
  resolveEnabledModules,
  scheduledJobs,
  JobsConfigurationError,
  type AnyModuleDefinition,
  type ModuleRegistry,
} from '@repo/core'
import {
  createDatabaseClient,
  migrationsTableFor,
  planModuleMigrations,
  runModuleMigrations,
} from '@repo/db'
import {
  createDrizzleJobLedger,
  jobsModule,
  provideJobs,
  resetJobsRuntime,
  JOB_RUN_RETENTION_DAYS,
  JOBS_CALLBACK_PATH,
} from '@repo/module-jobs'
import {
  createDrizzleRateLimiter,
  provideRateLimiter,
  rateLimitModule,
  resetRateLimitRuntime,
} from '@repo/module-rate-limit'
import { isTransientInngestError } from '@repo/adapter-inngest'
import { JOBS_ERROR_CODES, type JobsLogRecord } from '@repo/ports'
import { sql } from 'drizzle-orm'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { availableModules, enabledModules, requiredModules } from '../config/features'
import { appLocales } from '../config/i18n'
import { databaseUrl, isDatabaseReachable } from './fixtures/database'

/**
 * **Les tâches de fond** (s33) — ce qui traverse les packages.
 *
 * La règle du répartiteur vit à côté d'elle-même
 * (`packages/core/src/jobs.test.ts`), et les deux outils du port dans le leur
 * (`packages/jobs-testing/src/jobs-testing.test.ts`). Ce fichier-ci prouve ce
 * qu'aucun test unitaire ne peut prouver :
 *
 * - que **le registre livré déclare au moins une tâche** — sans quoi
 *   l'ordonnanceur tournerait à vide, ce qui est exactement l'état d'avant cette
 *   story : `registry.jobs` était agrégé depuis toujours et n'avait aucun
 *   consommateur ;
 * - que le **balayage des fenêtres closes** s'exécute pour de vrai contre un
 *   PostgreSQL, ce qui change le comportement de `rate-limit` en production ;
 * - que la **déduplication est partagée entre instances**, sur la vraie table ;
 * - que le **module coupé** exécute l'émission dans la requête appelante, ne
 *   planifie rien, et le journalise au démarrage.
 */

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

const shippedRegistry = (): ModuleRegistry =>
  buildRegistry({
    available: [...availableModules],
    enabled: [...enabledModules],
    required: [...requiredModules],
    locales: [...appLocales],
  })

const recorder = (): {
  readonly log: (record: JobsLogRecord) => void
  readonly records: JobsLogRecord[]
} => {
  const records: JobsLogRecord[] = []

  return { log: (record) => void records.push(record), records }
}

/**
 * **Le plancher**, et c'est le cœur de la story.
 *
 * Sans ces cas, on peut livrer un ordonnanceur qui n'exécute rien avec une suite
 * verte — c'est-à-dire relivrer le défaut que s33 corrige.
 */
describe('le registre livré, du point de vue de l’ordonnanceur', () => {
  it('déclare au moins une tâche planifiée', () => {
    const jobs = scheduledJobs(shippedRegistry())

    expect(jobs.length).toBeGreaterThanOrEqual(1)
  })

  it('est accepté par la garde de démarrage de l’ordonnanceur', () => {
    expect(() => assertJobsAreRunnable(scheduledJobs(shippedRegistry()))).not.toThrow()
  })

  /**
   * Le contrat porte `schedule` en chaîne libre, et **rien ne la validait**
   * puisque rien ne la lisait : une expression fausse était silencieuse. Ce cas
   * balaie ce que le dépôt déclare réellement, jamais une liste écrite ici.
   */
  it('ne déclare aucune expression cron illisible', () => {
    const jobs = scheduledJobs(shippedRegistry())

    // Un balayage vide passerait pour une raison qui n'en est pas une (s26).
    expect(jobs.length).toBeGreaterThanOrEqual(1)

    for (const entry of jobs) {
      expect(() => assertJobsAreRunnable([entry]), entry.id).not.toThrow(JobsConfigurationError)
    }
  })

  /** L'échéance d'une tâche déclarée, telle que le registre livré la porte. */
  const scheduleOf = (moduleId: string, jobId: string): string => {
    const entry = scheduledJobs(shippedRegistry()).find(
      (candidate) => candidate.id === qualifyJobId(moduleId, jobId),
    )

    expect(entry, `${moduleId}.${jobId} n’est pas déclarée`).toBeDefined()

    return entry?.job.schedule ?? ''
  }

  /**
   * La tâche orpheline de s28 : déclarée au contrat, **jamais exécutée** — c'est
   * elle qui laissait `rate_limit_window` croître sans borne, et le préambule
   * `e2e/support/warm-up.ts` vider la table avant chaque suite.
   *
   * **Sa cadence est éprouvée, pas seulement sa présence** (constat F2 de la
   * revue) : ramener son échéance de dix minutes à une échéance annuelle
   * laissait la suite
   * entière verte, et une purge annuelle restaure exactement le défaut que
   * cette story corrige.
   */
  it('déclare le balayage des fenêtres closes, du module de limitation', () => {
    const schedule = scheduleOf('rate-limit', 'sweep-closed-windows')

    // Toutes les dix minutes : six fois par heure, jamais entre deux.
    expect(cronMatches(schedule, new Date('2026-09-05T10:00:00.000Z'))).toBe(true)
    expect(cronMatches(schedule, new Date('2026-09-05T10:10:00.000Z'))).toBe(true)
    expect(cronMatches(schedule, new Date('2026-09-05T10:05:00.000Z'))).toBe(false)
    // Et le lendemain, et le mois suivant : une échéance annuelle rougit ici.
    expect(cronMatches(schedule, new Date('2026-09-06T03:20:00.000Z'))).toBe(true)
    expect(cronMatches(schedule, new Date('2026-11-30T23:50:00.000Z'))).toBe(true)
  })

  /**
   * **Le plancher de la tâche 2 ne suffit pas à tenir celle-ci, et il faut le
   * dire.** Il exige « au moins une tâche » : `rate-limit` et `billing` le
   * satisfont, si bien que le module `jobs` pouvait déclarer `jobs: []` sans
   * qu'aucune commande ne rougisse — mesuré le 5 septembre 2026. Ces deux
   * cas-ci visent la tâche **nommée**, parce que c'est elle qui empêche
   * `job_run` de croître sans borne, c'est-à-dire de rejouer sur une table
   * neuve le défaut que cette story corrige sur `rate_limit_window`.
   *
   * **Les deux configurations sont mesurées**, jamais une seule : une garde qui
   * ne mord que dans la configuration livrée est une garde que
   * `pnpm test:minimal-profile` n'exécute pas — et ce profil-là coupe le module
   * `jobs`.
   */
  const jobsEnabled = (enabledModules as readonly string[]).includes('jobs')

  it.runIf(jobsEnabled)('déclare le balayage du registre d’exécutions, du module de tâches', () => {
    const schedule = scheduleOf('jobs', 'sweep-job-runs')

    // Quotidienne, parce que la rétention se compte en jours : une échéance
    // annuelle laisserait `job_run` dépasser sa fenêtre de 358 jours.
    expect(cronMatches(schedule, new Date('2026-09-05T03:25:00.000Z'))).toBe(true)
    expect(cronMatches(schedule, new Date('2026-09-06T03:25:00.000Z'))).toBe(true)
    expect(cronMatches(schedule, new Date('2026-12-24T03:25:00.000Z'))).toBe(true)
    expect(cronMatches(schedule, new Date('2026-09-05T03:26:00.000Z'))).toBe(false)
    // Minute 25 : elle ne tombe jamais dans la même minute que le balayage des
    // fenêtres closes, qui passe toutes les dix minutes.
    expect(cronMatches(scheduleOf('rate-limit', 'sweep-closed-windows'), new Date('2026-09-05T03:25:00.000Z'))).toBe(
      false,
    )
  })

  const adminEnabled = (enabledModules as readonly string[]).includes('admin')

  /**
   * **Le balayage des emprunts échus** (s37b1), et sa cadence — pas seulement
   * sa présence.
   *
   * Ce qu'elle tient : une session d'impersonation abandonnée expire d'elle-même
   * (la fenêtre glissante ne la prolonge pas, `session-refresh-adapter.ts`),
   * mais **personne n'écrirait sa fin**. Ce balayage est le second bout du
   * journal ; ramené à une échéance annuelle, il laisse le journal avec des
   * débuts sans fin — et la suite entière restait verte, exactement le défaut
   * relevé en s28 sur la tâche voisine.
   *
   * Sa minute est **hors des minutes rondes**, et c'est mesuré ici : le
   * répartiteur local vide sa file en séquence, et deux tâches qui parlent à la
   * base sur la même minute se retardent l'une l'autre.
   */
  it.runIf(adminEnabled)('déclare le balayage des emprunts échus, du back-office', () => {
    const schedule = scheduleOf('admin', 'impersonation-expiry')

    // Toutes les heures, à la minute 23 : jamais deux fois dans l'heure, jamais
    // une échéance quotidienne ou annuelle.
    expect(cronMatches(schedule, new Date('2026-09-05T10:23:00.000Z'))).toBe(true)
    expect(cronMatches(schedule, new Date('2026-09-05T11:23:00.000Z'))).toBe(true)
    expect(cronMatches(schedule, new Date('2026-12-24T04:23:00.000Z'))).toBe(true)
    expect(cronMatches(schedule, new Date('2026-09-05T10:24:00.000Z'))).toBe(false)
    expect(cronMatches(schedule, new Date('2026-09-05T10:00:00.000Z'))).toBe(false)
    // Et jamais sur la même minute que les deux autres balayages qui parlent à
    // la base : dérivé de leurs échéances, jamais recopié.
    expect(
      cronMatches(scheduleOf('rate-limit', 'sweep-closed-windows'), new Date('2026-09-05T10:23:00.000Z')),
    ).toBe(false)
    expect(cronMatches(scheduleOf('auth', 'data-export'), new Date('2026-09-05T10:23:00.000Z'))).toBe(
      false,
    )
  })

  /**
   * Module coupé, il n'y a **rien à balayer** : la tâche disparaît avec lui, et
   * sa table aussi. Ce n'est pas une absence de garde, c'est la garantie
   * inverse — et elle est vérifiée, pas supposée.
   */
  it.runIf(!jobsEnabled)('module de tâches coupé : ni la tâche de balayage, ni sa table', () => {
    const registry = shippedRegistry()

    expect(scheduledJobs(registry).map((entry) => entry.id)).not.toContain(
      qualifyJobId('jobs', 'sweep-job-runs'),
    )
    expect(registry.modules.flatMap((module) => Object.keys(module.schema))).not.toContain('jobRun')
  })
})

/**
 * **Les deux classements du transitoire disent la même chose.**
 *
 * Il y en a deux, et la duplication est structurelle : `@repo/core` porte
 * celui du répartiteur, `@repo/adapter-inngest` le sien — un adaptateur ne
 * dépend pas du socle de modules. Le compilateur force chacun à **traiter**
 * tous les codes ; il ne les force pas à **s'accorder**, et l'`AGENTS.md` de
 * l'adaptateur affirmait pourtant qu'il le faisait (constat b de la seconde
 * revue de s33).
 *
 * La liste est **dérivée** — `JOBS_ERROR_CODES`, celle dont l'union est tirée —
 * donc un code ajouté demain entre dans cette confrontation sans que personne
 * y pense. C'est ce qui distingue ce cas d'un test d'inventaire.
 */
describe('le classement transitoire / définitif', () => {
  it('est le même dans le socle et dans l’adaptateur, sur tous les codes', () => {
    // Un balayage vide passerait pour une raison qui n'en est pas une (s26).
    expect(JOBS_ERROR_CODES.length).toBeGreaterThanOrEqual(6)

    const divergent = JOBS_ERROR_CODES.filter(
      (code) => isTransientJobsError(code) !== isTransientInngestError(code),
    )

    expect(divergent).toEqual([])
  })

  it('classe au moins un code de chaque côté', () => {
    // Sans cette moitié, deux classements qui rendraient toujours `false`
    // seraient « d'accord » et ce fichier ne mesurerait rien.
    expect(JOBS_ERROR_CODES.filter((code) => isTransientJobsError(code)).length).toBeGreaterThan(0)
    expect(JOBS_ERROR_CODES.filter((code) => !isTransientJobsError(code)).length).toBeGreaterThan(0)
  })
})

/**
 * **Module coupé : les trois garanties** (critère 8).
 *
 * Le repli n'est pas un confort — la suppression de compte (s34) et l'export
 * (s35) sont des obligations légales du socle et orchestreront leurs traitements
 * par tâche.
 */
describe('le module « jobs » coupé', () => {
  const withoutJobs = (): ModuleRegistry =>
    buildRegistry({
      available: [...availableModules],
      enabled: enabledModules.filter((id) => id !== 'jobs'),
      required: [...requiredModules],
      locales: [...appLocales],
    })

  afterEach(() => {
    vi.doUnmock('../config/features')
    vi.resetModules()
  })

  it('ne monte aucune des routes de rappel', async () => {
    const registry = withoutJobs()

    for (const method of ['GET', 'POST', 'PUT']) {
      const response = await dispatchModuleRequest(
        registry,
        new Request(`http://localhost${MODULE_ROUTE_PREFIX}${JOBS_CALLBACK_PATH}`, { method }),
      )

      expect(response.status, method).toBe(404)
    }
  })

  it('ne déclare aucune table du module dans le schéma agrégé', () => {
    const tables = withoutJobs().modules.flatMap((module) => Object.keys(module.schema))

    expect(tables).not.toContain('jobRun')
  })

  /**
   * **L'émission s'exécute de façon synchrone dans la requête appelante**, et le
   * repli **borne son coût** : une seule tentative, sans reprise et sans
   * attente. La revue de s32 a relevé qu'une boucle d'émission synchrone et non
   * bornée sur un chemin de requête est un défaut ; un repli ne doit pas être
   * plus coûteux que ce qu'il remplace.
   */
  it('exécute une émission avant de rendre la main, sans reprise', async () => {
    vi.doMock('../config/features', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../config/features')>()

      return { ...actual, enabledModules: actual.enabledModules.filter((id) => id !== 'jobs') }
    })
    vi.resetModules()

    const { appJobs, resetAppJobs } = await import('../apps/web/lib/jobs')
    const { provideRateLimiter: provide } = await import('@repo/module-rate-limit')

    resetAppJobs()

    let swept = 0

    provide(() => ({
      consume: async () => ({ ok: true, buckets: [] }),
      sweep: async () => {
        swept += 1

        return { ok: true, removed: 0 }
      },
    }))

    const result = await appJobs().emit({
      job: qualifyJobId('rate-limit', 'sweep-closed-windows'),
      key: 'sweep:coupé',
      data: {},
    })

    // Aucune attente, aucun drainage : l'effet est là quand `emit` a rendu.
    expect(result.ok).toBe(true)
    expect(swept).toBe(1)

    resetAppJobs()
    resetRateLimitRuntime()
  })

  /**
   * **« Sans reprise » était dans le nom du cas voisin et dans aucune de ses
   * assertions** (constat F5 de la revue) : remplacer la politique du repli par
   * celle du fournisseur — trois tentatives et jusqu'à 30 s de recul — laissait
   * la suite verte, **dans la requête de l'utilisateur**.
   *
   * Le repli ne doit pas être plus coûteux que ce qu'il remplace : c'est la
   * réserve que la revue de s32 a posée sur sa boucle d'émission synchrone, et
   * la tâche 8 du plan la nomme.
   */
  it('borne le repli à une seule tentative, même sur un échec transitoire', async () => {
    vi.doMock('../config/features', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../config/features')>()

      return { ...actual, enabledModules: actual.enabledModules.filter((id) => id !== 'jobs') }
    })
    vi.resetModules()

    const { appJobs, resetAppJobs } = await import('../apps/web/lib/jobs')
    const { provideRateLimiter: provide } = await import('@repo/module-rate-limit')

    resetAppJobs()

    let attempts = 0

    provide(() => ({
      consume: async () => ({ ok: true, buckets: [] }),
      // Transitoire : c'est **exactement** ce que la politique du fournisseur
      // réessaierait trois fois.
      sweep: async () => {
        attempts += 1

        return { ok: false, error: { code: 'store_unavailable', message: 'magasin muet' } }
      },
    }))

    const started = Date.now()
    const result = await appJobs().emit({
      job: qualifyJobId('rate-limit', 'sweep-closed-windows'),
      key: 'sweep:coupé-transitoire',
      data: {},
    })

    expect(result.ok).toBe(false)
    // Une tentative, et une seule : la requête de l'appelant ne paie ni la
    // seconde, ni le recul qui la précède.
    expect(attempts).toBe(1)
    // Et aucune attente : le premier recul de la politique du fournisseur part
    // de 500 ms, donc un repli qui reprendrait le dépasserait forcément.
    expect(Date.now() - started).toBeLessThan(250)

    resetAppJobs()
    resetRateLimitRuntime()
  })

  it('journalise le repli au démarrage plutôt que de refuser', async () => {
    vi.doMock('../config/features', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../config/features')>()

      return { ...actual, enabledModules: actual.enabledModules.filter((id) => id !== 'jobs') }
    })
    vi.resetModules()

    const said: string[] = []
    const info = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      said.push(args.map(String).join(' '))
    })

    try {
      const { assertJobsConfiguration } = await import('../apps/web/lib/jobs')

      expect(() => assertJobsConfiguration()).not.toThrow()
    } finally {
      info.mockRestore()
    }

    expect(said.join('\n')).toContain('jobs.disabled')
    expect(said.join('\n')).toMatch(/synchrone/i)
  })
})

/**
 * **Les trois états de la route de rappel**, et il ne faut pas les confondre.
 *
 * La CI de la PR 27 a rougi sur `e2e/modules.spec.ts` — le balayage qui exige
 * qu'une route **publique d'un module activé** ne réponde pas 404 : le module
 * `jobs` est activé, sa route déclarée, et elle répondait 404 parce qu'aucun
 * fournisseur n'est configuré en CI (`JOBS_LOCAL_RUNNER=1`).
 *
 * Le 404 était un mensonge : la route **existe**, elle est déclarée par un
 * module activé et montée par le répartiteur. Ce qui manque est le fournisseur
 * derrière, et c'est une autre phrase. Les trois états sont donc distincts, et
 * ces cas les tiennent dans `pnpm test` — la leçon de cette story étant qu'une
 * garantie que personne ne peut vérifier localement casse en CI.
 */
describe('la route de rappel du fournisseur', () => {
  const registryWithJobs = (): ModuleRegistry =>
    buildRegistry({
      available: [jobsModule],
      enabled: [jobsModule.id],
      locales: [...appLocales],
    })

  const callRoute = async (registry: ModuleRegistry, method: string): Promise<Response> =>
    await dispatchModuleRequest(
      registry,
      new Request(`http://localhost${MODULE_ROUTE_PREFIX}${JOBS_CALLBACK_PATH}`, { method }),
      // La route est publique, donc limitée : sans garde, le répartiteur
      // répondrait 429 avant d'atteindre le gestionnaire (fail-closed, s28).
      { rateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) },
    )

  /**
   * La base n'est jamais touchée sur ce chemin : elle ne sert qu'à la tâche de
   * balayage du registre. La donner ici serait ouvrir une connexion pour
   * mesurer une réponse HTTP.
   */
  const withoutProvider = (): void => {
    provideJobs(() => ({ callback: null, db: undefined as never }))
  }

  afterEach(() => {
    resetJobsRuntime()
  })

  it('répond 503, et non 404, quand aucun fournisseur n’est configuré', async () => {
    withoutProvider()

    const registry = registryWithJobs()

    for (const method of ['GET', 'POST', 'PUT']) {
      const response = await callRoute(registry, method)

      // 404 dirait « ce boilerplate n'a pas de rappel de tâches », ce qui est
      // faux et enverrait chercher un défaut de routage. 503 dit ce qui est
      // vrai : l'endroit existe, il n'a pas de fournisseur derrière.
      expect(response.status, method).toBe(503)
      expect(await response.json()).toEqual({ error: 'jobs_provider_not_configured' })
    }
  })

  it('sert le gestionnaire du fournisseur quand il y en a un', async () => {
    provideJobs(() => ({
      callback: async () => new Response('{"ok":true}', { status: 200 }),
      db: undefined as never,
    }))

    const response = await callRoute(registryWithJobs(), 'POST')

    expect(response.status).toBe(200)
  })

  /**
   * **Le troisième état, et il répond bien 404** : le module coupé, la route
   * n'est dans aucune table de routage. C'est le seul des trois où « cet
   * endroit n'existe pas » est vrai.
   */
  it('répond 404 quand le module n’est pas activé', async () => {
    withoutProvider()

    const registry = buildRegistry({
      available: [jobsModule],
      enabled: [],
      locales: [...appLocales],
    })

    const response = await callRoute(registry, 'POST')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'not_found' })
  })
})

/**
 * **Le câblage lui-même** — ce que la revue de s33 a trouvé removable avec une
 * suite verte (constat F1).
 *
 * Trois points de composition, trois mutations, 2 407 cas verts chacune :
 * `prepareJobs()` dans `lib/module-services.ts`, `prepareJobs()` +
 * `startLocalJobScheduler()` dans `instrumentation.ts`, et
 * `assertJobsConfiguration(env)` dans `lib/startup.ts`. Dans la configuration
 * livrée (`JOBS_LOCAL_RUNNER=1`), ce `setInterval` est **la seule chose qui
 * déclenche jamais une tâche planifiée** : sans lui, `rate_limit_window` et
 * `job_run` recroissent sans borne et la relance d'essai ne part jamais —
 * c'est-à-dire l'état d'avant s33, un cran plus haut.
 *
 * Le troisième point est éprouvé chez son voisin (`tests/env-wiring.test.ts`,
 * « refuse de démarrer quand le module `jobs` est activé sans exécuteur ») :
 * c'est là que vivent les refus de démarrage, et les y séparer serait une
 * seconde énumération.
 */
describe('le câblage des tâches, aux points de composition', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  /**
   * **Le défaut de `provideNotifications` en s32, reproduit** : sans cet appel,
   * `requireRateLimiter()` et `requireJobsCallback()` lèvent — la tâche de
   * balayage n'a pas de compteur, et la route publique de rappel répond 500.
   *
   * Le **contrôle positif** est la moitié qui compte : on vérifie d'abord que
   * la garde sait refuser, sinon ce cas mesurerait un `require*` qui ne refuse
   * jamais rien.
   */
  const jobsMounted = (enabledModules as readonly string[]).includes('jobs')

  it('donne au compteur de limitation ce qu’aucune requête ne procure', async () => {
    vi.resetModules()

    const { prepareModuleServices } = await import('../apps/web/lib/module-services')
    const rateLimit = await import('@repo/module-rate-limit')

    rateLimit.resetRateLimitRuntime()

    // Contrôle positif : sans le câblage, la garde refuse en le disant. Sans
    // cette moitié, ce cas mesurerait un `require*` qui ne refuse jamais rien.
    expect(() => rateLimit.requireRateLimiter()).toThrow(rateLimit.RateLimiterNotProvidedError)

    prepareModuleServices()

    // Après le câblage, il ne peut plus échouer **pour cette raison-là**. Ce
    // qu'il fait ensuite dépend de la base, et n'appartient pas à ce cas.
    //
    // `rate-limit` est du socle (`requiredModules`) : cette garantie vaut dans
    // **toutes** les configurations, y compris celle où `jobs` est coupé — c'est
    // elle qui donne un corps à la tâche de balayage.
    expect(() => rateLimit.requireRateLimiter()).not.toThrow(rateLimit.RateLimiterNotProvidedError)

    rateLimit.resetRateLimitRuntime()
  })

  it.runIf(jobsMounted)('donne au module de tâches son gestionnaire de rappel', async () => {
    vi.resetModules()

    const { prepareModuleServices } = await import('../apps/web/lib/module-services')
    const jobs = await import('@repo/module-jobs')

    jobs.resetJobsRuntime()

    expect(() => jobs.requireJobsCallback()).toThrow(jobs.JobsNotConfiguredError)

    prepareModuleServices()

    // Sans ce câblage, la route publique de rappel répond **500** en disant que
    // le module n'est pas configuré — le défaut exact de `provideNotifications`
    // en s32, que `application/trial-reminders.ts` cite par son nom.
    expect(() => jobs.requireJobsCallback()).not.toThrow(jobs.JobsNotConfiguredError)

    jobs.resetJobsRuntime()
  })

  /**
   * **L'ordonnanceur tourne réellement.** Ce n'est pas « `setInterval` a été
   * appelé » — c'est une échéance qui tombe et une tâche déclarée qui
   * s'exécute, mesurée sur l'horloge que le point de démarrage installe.
   */
  it.runIf(jobsMounted)('exécute une tâche planifiée à son échéance, depuis le point de démarrage', async () => {
    vi.resetModules()
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_FROM', '')
    vi.stubEnv('EMAIL_LOCAL_CAPTURE', '1')
    vi.stubEnv('AUTH_SECRET', 'x'.repeat(40))
    vi.stubEnv('APP_URL', 'http://localhost:3000')
    vi.stubEnv('STORAGE_S3_BUCKET', '')
    vi.stubEnv('STORAGE_S3_REGION', '')
    vi.stubEnv('STORAGE_S3_ACCESS_KEY_ID', '')
    vi.stubEnv('STORAGE_S3_SECRET_ACCESS_KEY', '')
    vi.stubEnv('STORAGE_LOCAL_DIRECTORY', '.storage')
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
    vi.stubEnv('PAYMENTS_LOCAL_MODE', '1')
    vi.stubEnv('INNGEST_EVENT_KEY', '')
    vi.stubEnv('INNGEST_SIGNING_KEY', '')
    vi.stubEnv('INNGEST_BASE_URL', '')
    vi.stubEnv('JOBS_LOCAL_RUNNER', '1')
    vi.stubEnv('NEXT_PHASE', '')
    vi.stubEnv('SKIP_ENV_VALIDATION', '')

    // Une minute avant l'échéance de dix minutes : le premier battement de la
    // boucle la fait tomber.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-05T10:19:30.000Z'))

    try {
      const { register } = await import('../apps/web/instrumentation')
      const rateLimit = await import('@repo/module-rate-limit')

      await register()

      let swept = 0

      // Posé **après** le démarrage : il écrase le compteur réel, et c'est la
      // seule neutralisation possible — aucune variable d'environnement ne
      // débranche l'ordonnanceur.
      rateLimit.provideRateLimiter(() => ({
        consume: async () => ({ ok: true, buckets: [] }),
        sweep: async () => {
          swept += 1

          return { ok: true, removed: 0 }
        },
      }))

      expect(swept).toBe(0)

      await vi.advanceTimersByTimeAsync(60_000)

      // 10 h 20 : l'échéance des dix minutes tombe, et la tâche que le module
      // `rate-limit` déclare depuis s28 s'exécute — pour la première fois de
      // l'histoire de ce dépôt.
      expect(swept).toBe(1)

      rateLimit.resetRateLimitRuntime()
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * **L'autre moitié du critère 8, et elle se mesure sur la même horloge** :
   * module coupé, aucune tâche planifiée ne s'exécute. Une garde qui ne mord que
   * dans la configuration livrée est une garde que `pnpm test:minimal-profile`
   * n'exécute pas — et ce profil-là coupe justement `jobs`.
   */
  it.runIf(!jobsMounted)('n’ordonnance rien quand le module de tâches est coupé', async () => {
    vi.resetModules()
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.stubEnv('DATABASE_URL', 'postgres://app:app@localhost:5432/app')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('EMAIL_FROM', '')
    vi.stubEnv('EMAIL_LOCAL_CAPTURE', '1')
    vi.stubEnv('AUTH_SECRET', 'x'.repeat(40))
    vi.stubEnv('APP_URL', 'http://localhost:3000')
    vi.stubEnv('STORAGE_S3_BUCKET', '')
    vi.stubEnv('STORAGE_S3_REGION', '')
    vi.stubEnv('STORAGE_S3_ACCESS_KEY_ID', '')
    vi.stubEnv('STORAGE_S3_SECRET_ACCESS_KEY', '')
    vi.stubEnv('STORAGE_LOCAL_DIRECTORY', '.storage')
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
    vi.stubEnv('PAYMENTS_LOCAL_MODE', '1')
    vi.stubEnv('NEXT_PHASE', '')
    vi.stubEnv('SKIP_ENV_VALIDATION', '')

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-05T10:19:30.000Z'))

    try {
      const { register } = await import('../apps/web/instrumentation')
      const rateLimit = await import('@repo/module-rate-limit')

      await register()

      let swept = 0

      rateLimit.provideRateLimiter(() => ({
        consume: async () => ({ ok: true, buckets: [] }),
        sweep: async () => {
          swept += 1

          return { ok: true, removed: 0 }
        },
      }))

      // Une heure d'horloge, six échéances de dix minutes traversées : aucune
      // ne s'exécute, parce qu'il n'y a pas d'ordonnanceur.
      await vi.advanceTimersByTimeAsync(60 * 60_000)

      expect(swept).toBe(0)

      rateLimit.resetRateLimitRuntime()
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * **Le mode local, et le refus de deviner** (critère 9).
 *
 * `AGENTS.md` : « Every port must be usable locally with no provider key —
 * through an **explicit** local mode, never inferred from `NODE_ENV`. Explicit
 * means the developer opts in and a process with neither a key nor the flag
 * refuses to start, naming the variable. »
 */
describe('le choix de l’exécuteur', () => {
  const env = (overrides: Record<string, string | undefined>) =>
    ({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://app:app@localhost:5432/app',
      ...overrides,
    }) as unknown as Parameters<
      typeof import('../apps/web/lib/jobs-config').resolveJobsConfig
    >[0]

  it('refuse de démarrer sans clé et sans drapeau, en nommant les deux', async () => {
    const { resolveJobsConfig } = await import('../apps/web/lib/jobs-config')

    expect(() => resolveJobsConfig(env({}))).toThrow(/INNGEST_EVENT_KEY/)
    expect(() => resolveJobsConfig(env({}))).toThrow(/JOBS_LOCAL_RUNNER/)
  })

  it('monte l’exécuteur en mémoire sur le seul drapeau, sans aucune clé', async () => {
    const { resolveJobsConfig } = await import('../apps/web/lib/jobs-config')

    expect(resolveJobsConfig(env({ JOBS_LOCAL_RUNNER: '1' }))).toEqual({ kind: 'local' })
  })

  it('ne déduit jamais le mode local de NODE_ENV', async () => {
    const { resolveJobsConfig } = await import('../apps/web/lib/jobs-config')

    // `development` sans drapeau ni clé refuse exactement comme `production` :
    // un mode local déduit de l'environnement se trompera un jour
    // d'environnement.
    expect(() => resolveJobsConfig(env({ NODE_ENV: 'development' }))).toThrow(/JOBS_LOCAL_RUNNER/)
  })

  it('monte le fournisseur quand les deux clés sont là', async () => {
    const { resolveJobsConfig } = await import('../apps/web/lib/jobs-config')

    expect(
      resolveJobsConfig(
        env({ INNGEST_EVENT_KEY: 'evt-key', INNGEST_SIGNING_KEY: 'signkey-test' }),
      ),
    ).toEqual({ kind: 'provider', eventKey: 'evt-key', signingKey: 'signkey-test', baseUrl: null })
  })

  /**
   * La valeur vide vaut absente, comme partout ailleurs : `.env.example` livre
   * `INNGEST_EVENT_KEY=`, et le lire « clé renseignée » ferait monter le
   * fournisseur sur une chaîne vide (revue de s06, G2).
   */
  it('lit une clé vide comme absente', async () => {
    const { resolveJobsConfig } = await import('../apps/web/lib/jobs-config')

    expect(
      resolveJobsConfig(
        env({ INNGEST_EVENT_KEY: '  ', INNGEST_SIGNING_KEY: '', JOBS_LOCAL_RUNNER: '1' }),
      ),
    ).toEqual({ kind: 'local' })
  })
})

const databaseReachable = await isDatabaseReachable()

/**
 * **Ce qu'aucun test unitaire ne peut prouver** : que la tâche orpheline de s28
 * efface réellement des lignes, et que la déduplication est partagée entre
 * instances.
 */
describe.skipIf(!databaseReachable)('sur une base réelle', () => {
  const PROBE_SCHEMA = 'jobs_probe'
  const probeUrl = (): string => {
    const url = new URL(databaseUrl)

    url.searchParams.set('options', `-c search_path=${PROBE_SCHEMA}`)

    return url.toString()
  }

  let admin: ReturnType<typeof createDatabaseClient>
  /** Deux connexions : c'est ce que deux conteneurs ont de commun, et rien d'autre. */
  let first: ReturnType<typeof createDatabaseClient>
  let second: ReturnType<typeof createDatabaseClient>

  const modules = [rateLimitModule, jobsModule] as readonly AnyModuleDefinition[]
  const journalOf = (moduleId: string): string => `${migrationsTableFor(moduleId)}_jobs_probe`

  beforeAll(async () => {
    admin = createDatabaseClient({ connectionString: databaseUrl, maxConnections: 1 })

    await admin.db.execute(sql`drop schema if exists ${sql.identifier(PROBE_SCHEMA)} cascade`)
    await admin.db.execute(sql`create schema ${sql.identifier(PROBE_SCHEMA)}`)
    await admin.db.execute(sql`create schema if not exists drizzle`)

    for (const module of modules) {
      await admin.db.execute(sql`drop table if exists drizzle.${sql.identifier(journalOf(module.id))}`)
    }

    first = createDatabaseClient({ connectionString: probeUrl(), maxConnections: 1 })
    second = createDatabaseClient({ connectionString: probeUrl(), maxConnections: 1 })

    await runModuleMigrations({
      db: first.db,
      plan: planModuleMigrations({
        modules: resolveEnabledModules({
          available: modules,
          enabled: modules.map((module) => module.id),
        }),
        repoRoot: REPO_ROOT,
      }).map((step) => ({ ...step, migrationsTable: journalOf(step.moduleId) })),
    })
  })

  afterAll(async () => {
    await first.close()
    await second.close()
    await admin.db.execute(sql`drop schema if exists ${sql.identifier(PROBE_SCHEMA)} cascade`)

    for (const module of modules) {
      await admin.db.execute(sql`drop table if exists drizzle.${sql.identifier(journalOf(module.id))}`)
    }

    await admin.close()
  })

  beforeEach(async () => {
    await first.db.execute(sql`truncate table rate_limit_window`)
    await first.db.execute(sql`truncate table job_run`)
    resetRateLimitRuntime()
  })

  afterEach(() => {
    resetRateLimitRuntime()
  })

  const registry = (): ModuleRegistry =>
    buildRegistry({
      available: modules,
      enabled: modules.map((module) => module.id),
      locales: [...appLocales],
    })

  const dispatch = async (
    job: string,
    key: string,
    ledgerDb: ReturnType<typeof createDatabaseClient> = first,
    log: (record: JobsLogRecord) => void = () => {},
  ) =>
    await dispatchModuleJob({
      registry: registry(),
      emission: { job, key, data: {} },
      ledger: createDrizzleJobLedger({ db: ledgerDb.db }),
      log,
      retry: { maxAttempts: 1, baseMs: 1, maxMs: 1 },
      now: () => new Date('2026-09-05T10:20:00.000Z'),
      sleep: async () => {},
    })

  /**
   * **Task 7 : la tâche orpheline tourne.** Elle est déclarée depuis s28, son
   * corps était vide, et `rate_limit_window` n'a donc jamais été purgée. La
   * brancher **change le comportement de `rate-limit` en production** : le
   * magasin se vide désormais tout seul, y compris sur une application au repos.
   */
  it('efface les fenêtres closes, et laisse les fenêtres ouvertes', async () => {
    const limiter = createDrizzleRateLimiter({ db: first.db })
    const closed = new Date('2026-09-05T09:00:00.000Z')
    const open = new Date('2026-09-05T10:19:00.000Z')

    await limiter.consume({
      buckets: [{ key: '/auth/sign-in:client:203.0.113.1', max: 5, windowSeconds: 60 }],
      now: closed,
    })
    await limiter.consume({
      buckets: [{ key: '/auth/sign-in:client:203.0.113.2', max: 5, windowSeconds: 3_600 }],
      now: open,
    })

    const before = await first.db.execute<{ count: number }>(
      sql`select count(*)::int as count from rate_limit_window`,
    )

    expect(before.rows[0]?.count).toBe(2)

    provideRateLimiter(() => limiter)

    const outcome = await dispatch(
      qualifyJobId('rate-limit', 'sweep-closed-windows'),
      'sweep:2026-09-05T10:20',
    )

    expect(outcome.ok).toBe(true)

    const after = await first.db.execute<{ count: number }>(
      sql`select count(*)::int as count from rate_limit_window`,
    )

    // La fenêtre d'une minute ouverte à 9 h est close à 10 h 20 ; celle d'une
    // heure ouverte à 10 h 19 ne l'est pas.
    expect(after.rows[0]?.count).toBe(1)
  })

  /**
   * **L'idempotence se joue deux fois, sur la vraie table** — et depuis deux
   * connexions distinctes, parce que c'est ce que deux conteneurs derrière un
   * répartiteur de charge ont en commun. Un ensemble en mémoire de processus
   * laisserait les deux exécuter.
   */
  it('n’exécute qu’une fois la même échéance vue par deux instances', async () => {
    const limiter = createDrizzleRateLimiter({ db: first.db })
    let swept = 0

    provideRateLimiter(() => ({
      consume: limiter.consume,
      sweep: async (now) => {
        swept += 1

        return await limiter.sweep(now)
      },
    }))

    const job = qualifyJobId('rate-limit', 'sweep-closed-windows')
    const { log, records } = recorder()

    const one = await dispatch(job, 'sweep:2026-09-05T10:20', first, log)
    const two = await dispatch(job, 'sweep:2026-09-05T10:20', second, log)

    expect(swept).toBe(1)
    expect(one).toEqual({ ok: true, ran: true, attempts: 1 })
    expect(two).toEqual({ ok: true, ran: false, attempts: 0 })
    expect(records.map((record) => record.event)).toContain('job.skipped')

    // Une autre échéance passe : la déduplication porte sur la clé, pas sur la
    // tâche.
    await dispatch(job, 'sweep:2026-09-05T10:30', second, log)

    expect(swept).toBe(2)
  })

  /** La table ne porte aucune clé en clair : elle condense, comme le compteur. */
  it('ne stocke aucune clé d’idempotence en clair', async () => {
    provideRateLimiter(() => ({
      consume: async () => ({ ok: true, buckets: [] }),
      sweep: async () => ({ ok: true, removed: 0 }),
    }))

    await dispatch(
      qualifyJobId('rate-limit', 'sweep-closed-windows'),
      'sweep:compte@exemple.test',
    )

    const rows = await first.db.execute<{ run: string; job: string }>(
      sql`select run, job from job_run`,
    )

    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]?.run).toMatch(/^[0-9a-f]{64}$/)
    expect(rows.rows[0]?.run).not.toContain('exemple.test')
    // La tâche, elle, reste en clair : c'est un identifiant de code, il ne
    // désigne personne, et sans lui la table ne dit plus ce qu'elle contient.
    expect(rows.rows[0]?.job).toBe('rate-limit.sweep-closed-windows')
  })

  /**
   * **La table qui déduplique se purge elle-même** — sans quoi cette story
   * réintroduirait, sur `job_run`, exactement le défaut qu'elle corrige sur
   * `rate_limit_window` : une table qui grossit sans borne parce que la tâche
   * qui la balaie est déclarée et n'a pas de consommateur.
   */
  it('efface les réservations hors fenêtre de rétention, et garde les autres', async () => {
    // **Importé en tête, jamais dynamiquement** : un cas voisin appelle
    // `vi.resetModules()`, et un import dynamique rendrait alors une **seconde
    // instance** du module — on configurerait celle-ci pendant que le registre
    // exécute la fermeture de l'autre. Mesuré : la tâche échouait sur
    // « le module n'est pas configuré ».
    provideJobs(() => ({ callback: null, db: first.db }))

    const now = new Date('2026-09-05T10:20:00.000Z')
    const day = 24 * 60 * 60 * 1_000
    // Une réservation d'avant la fenêtre, et une de la veille : la borne est
    // dérivée de la constante, jamais recopiée — la déplacer déplace le cas.
    const outside = new Date(now.getTime() - (JOB_RUN_RETENTION_DAYS + 1) * day)
    const inside = new Date(now.getTime() - day)
    const ledger = createDrizzleJobLedger({ db: first.db })

    await ledger.claim({ job: 'alpha.old', key: 'k-old', now: outside })
    await ledger.claim({ job: 'alpha.recent', key: 'k-recent', now: inside })

    const before = await first.db.execute<{ count: number }>(
      sql`select count(*)::int as count from job_run`,
    )

    expect(before.rows[0]?.count).toBe(2)

    const outcome = await dispatchModuleJob({
      registry: registry(),
      emission: { job: qualifyJobId('jobs', 'sweep-job-runs'), key: 'sweep@10:20', data: {} },
      ledger,
      log: () => {},
      retry: { maxAttempts: 1, baseMs: 1, maxMs: 1 },
      now: () => now,
      sleep: async () => {},
    })

    expect(outcome.ok).toBe(true)

    const remaining = await first.db.execute<{ job: string }>(sql`select job from job_run`)

    // La réservation de l'exécution en cours survit aussi : elle vient d'être
    // prise, elle est dans la fenêtre.
    expect(remaining.rows.map((row) => row.job).sort()).toEqual(['alpha.recent', 'jobs.sweep-job-runs'])

    resetJobsRuntime()
  })

  /**
   * Un échec **libère** la clé : sans cela, une panne passagère condamnerait
   * l'échéance pour toujours, ce qui n'est pas de l'idempotence mais de la
   * perte.
   */
  it('libère la réservation quand l’exécution a échoué', async () => {
    provideRateLimiter(() => ({
      consume: async () => ({ ok: true, buckets: [] }),
      sweep: async () => ({ ok: false, error: { code: 'invalid_bucket', message: 'seuil nul' } }),
    }))

    const failed = await dispatch(
      qualifyJobId('rate-limit', 'sweep-closed-windows'),
      'sweep:2026-09-05T10:20',
    )

    expect(failed.ok).toBe(false)

    const rows = await first.db.execute<{ count: number }>(
      sql`select count(*)::int as count from job_run`,
    )

    expect(rows.rows[0]?.count).toBe(0)
  })
})

/**
 * **La relance d'essai, comme tâche réelle** (critère 7).
 *
 * La règle pure vit à côté d'elle-même
 * (`packages/modules/billing/src/domain/billing-rules.test.ts`). Ici : que la
 * tâche est **déclarée par le module** et que le répartiteur l'exécute à son
 * échéance — ce qui manquait n'était pas le modèle de données, c'était le
 * déclencheur.
 */
describe('la relance d’essai', () => {
  /**
   * **L'attente est dérivée de la configuration**, jamais écrite : le module
   * `billing` est optionnel, et `pnpm test:minimal-profile` le coupe. Un cas qui
   * exigerait la tâche quoi qu'il arrive rougirait dans une configuration
   * parfaitement valide — mesuré le 5 septembre 2026, sur cette recette-là.
   */
  const billingEnabled = (enabledModules as readonly string[]).includes('billing')

  it.runIf(billingEnabled)(
    'est déclarée par le module de facturation, avec une échéance quotidienne',
    () => {
      const entry = scheduledJobs(shippedRegistry()).find(
        (candidate) => candidate.id === qualifyJobId('billing', 'trial-ending-reminder'),
      )

      expect(entry).toBeDefined()
      // 9 h UTC, tous les jours : une relance est un email, et l'échéance doit
      // tomber une fois par jour, pas une fois par minute.
      expect(cronMatches(entry?.job.schedule ?? '', new Date('2026-09-05T09:00:00.000Z'))).toBe(
        true,
      )
      expect(cronMatches(entry?.job.schedule ?? '', new Date('2026-09-05T09:01:00.000Z'))).toBe(
        false,
      )
      expect(cronMatches(entry?.job.schedule ?? '', new Date('2026-09-06T09:00:00.000Z'))).toBe(
        true,
      )
    },
  )

  it('échoue définitivement quand aucune livraison n’est fournie, en la nommant', async () => {
    const { remindEndingTrials } = await import('@repo/module-billing')

    await expect(
      remindEndingTrials({
        repository: {
          trialsEndingBetween: async () => [],
        } as unknown as Parameters<typeof remindEndingTrials>[0]['repository'],
        remind: null,
        now: new Date('2026-09-05T09:00:00.000Z'),
      }),
    ).rejects.toThrow(/remindTrialEnding/)
  })

  it('ne relance que les essais dont la fin tombe le jour visé', async () => {
    const { remindEndingTrials } = await import('@repo/module-billing')
    const reminded: string[] = []

    const trial = (id: string, trialEnd: string, status = 'trialing') => ({
      providerSubscriptionId: id,
      offerId: 'pro-monthly',
      status,
      trialEnd: new Date(trialEnd),
      scopeKind: 'user' as const,
      scopeId: `user_${id}`,
    })

    const count = await remindEndingTrials({
      repository: {
        // Le dépôt rend large : c'est la règle qui tranche, et ce cas le
        // prouve — une doublure qui filtrerait à la place du serveur mesurerait
        // la doublure.
        trialsEndingBetween: async () => [
          trial('sub_due', '2026-09-08T12:00:00.000Z'),
          trial('sub_tomorrow', '2026-09-06T12:00:00.000Z'),
          trial('sub_canceled', '2026-09-08T12:00:00.000Z', 'canceled'),
        ],
      } as unknown as Parameters<typeof remindEndingTrials>[0]['repository'],
      remind: async (candidate) => void reminded.push(candidate.providerSubscriptionId),
      now: new Date('2026-09-05T09:00:00.000Z'),
    })

    expect(reminded).toEqual(['sub_due'])
    expect(count).toBe(1)
  })
})
