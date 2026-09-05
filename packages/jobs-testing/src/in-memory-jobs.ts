import {
  cronMatches,
  dispatchModuleJob,
  scheduledJobs,
  type JobRetryPolicy,
  type JobRunLedger,
  type ModuleRegistry,
} from '@repo/core'
import type { EmitJobResult, JobEmission, Jobs, JobsLogger } from '@repo/ports'

/**
 * **Le mode local du port `Jobs`** (critère 9 de s33) : il exécute pour de vrai,
 * en mémoire, **sans clé, sans réseau et sans service**.
 *
 * C'est ce qui permet à un dépôt fraîchement cloné de faire tourner ses tâches
 * avec `pnpm dev`, et c'est la règle du dépôt : « Every port must be usable
 * locally with no provider key — through an **explicit** local mode, never
 * inferred from `NODE_ENV` ». L'opt-in est `JOBS_LOCAL_RUNNER=1`, lu par
 * `apps/web/lib/jobs-config.ts` ; ce fichier-ci ne lit aucune variable.
 *
 * **Ce qu'il ne remplace pas.** Inngest reste la seule implémentation du port
 * (ADR 008) : cet exécuteur est un outil, comme la capture locale des emails.
 * Il ne survit pas au processus — sa file et son registre d'exécutions vivent en
 * mémoire — et il ne partage rien entre instances. Deux propriétés qui le
 * distinguent du fournisseur, et qui sont écrites plutôt que sous-entendues :
 * un redémarrage perd la file, et deux instances exécuteraient deux fois la
 * même échéance.
 */

export interface InMemoryJobsOptions {
  readonly registry: ModuleRegistry
  readonly log: JobsLogger
  readonly retry: JobRetryPolicy
  readonly now: () => Date
  readonly random?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  /**
   * Comment le vidage de la file est différé **hors de la requête appelante**.
   *
   * Injecté, et c'est le point : le repli synchrone (critère 8) exécute dans la
   * requête, le mode local **non**. Une suite de tests passe une fonction qui ne
   * fait rien et commande `drain()` elle-même, plutôt que de courir après un
   * `setTimeout`.
   */
  readonly defer?: (run: () => void) => void
}

export interface InMemoryJobs {
  readonly jobs: Jobs
  /** Le registre des exécutions déjà faites — en mémoire, donc perdu au redémarrage. */
  readonly ledger: JobRunLedger
  /** Exécute tout ce qui est en file, dans l'ordre d'émission. */
  drain(): Promise<void>
  /**
   * Fait passer l'ordonnanceur sur une minute : met en file les tâches dont
   * l'échéance y tombe, puis vide la file.
   *
   * La clé d'idempotence est **la minute elle-même** — `<tâche>@<minute>` —, si
   * bien que rejouer la même minute ne produit qu'un effet, ce que
   * `docs/reliability.md` §1 exige d'être prouvé en rejouant.
   */
  tick(now: Date): Promise<void>
}

/** Le registre des exécutions faites, en mémoire. */
const memoryLedger = (): JobRunLedger => {
  const claimed = new Set<string>()

  return {
    claim: ({ job, key }) => {
      const identity = `${job}:${key}`

      if (claimed.has(identity)) {
        return Promise.resolve(false)
      }

      claimed.add(identity)

      return Promise.resolve(true)
    },
    release: ({ job, key }) => {
      claimed.delete(`${job}:${key}`)

      return Promise.resolve()
    },
  }
}

/** La minute d'un instant, en UTC : la granularité d'une expression cron. */
const minuteKey = (date: Date): string => date.toISOString().slice(0, 16)

export function createInMemoryJobs(options: InMemoryJobsOptions): InMemoryJobs {
  const { registry, log, retry, now } = options
  const defer = options.defer ?? ((run: () => void) => void setTimeout(run, 0))
  const ledger = memoryLedger()
  const queue: JobEmission[] = []
  let draining = false

  const run = async (emission: JobEmission): Promise<void> => {
    await dispatchModuleJob({
      registry,
      emission,
      ledger,
      log,
      retry,
      now,
      random: options.random,
      sleep: options.sleep,
    })
  }

  const drain = async (): Promise<void> => {
    if (draining) {
      return
    }

    draining = true

    try {
      while (queue.length > 0) {
        const emission = queue.shift() as JobEmission

        // Le répartiteur ne lève pas : il rend un résultat et journalise. Une
        // tâche en échec ne doit pas emporter les émissions suivantes — c'est
        // la file qu'un `throw` viderait sans rien dire.
        await run(emission)
      }
    } finally {
      draining = false
    }
  }

  return {
    jobs: {
      emit(emission: JobEmission): Promise<EmitJobResult> {
        const declared = scheduledJobs(registry).some((entry) => entry.id === emission.job)

        if (!declared) {
          return Promise.resolve({
            ok: false,
            error: {
              code: 'unknown_job',
              message:
                `Aucun module activé ne déclare la tâche « ${emission.job} » : rien ne ` +
                'l’exécuterait.',
            },
          })
        }

        queue.push(emission)
        defer(() => void drain())

        return Promise.resolve({ ok: true, id: `${emission.job}:${emission.key}` })
      },
    },

    ledger,

    drain,

    async tick(at: Date): Promise<void> {
      const minute = minuteKey(at)

      for (const entry of scheduledJobs(registry)) {
        if (cronMatches(entry.job.schedule, at)) {
          queue.push({ job: entry.id, key: `${entry.id}@${minute}`, data: {} })
        }
      }

      await drain()
    },
  }
}
