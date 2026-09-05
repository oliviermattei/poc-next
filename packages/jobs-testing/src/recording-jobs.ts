import { scheduledJobs, type ModuleRegistry } from '@repo/core'
import type { EmitJobResult, JobEmission, Jobs } from '@repo/ports'

/**
 * La doublure d'enregistrement du port `Jobs` : **un outil de test**, pas un
 * fournisseur (ADR 008).
 *
 * Elle n'exécute rien, ne touche ni au réseau ni au disque. Elle garde ce qu'on
 * lui a demandé de mettre en file — son nom **et sa charge utile** — pour qu'un
 * test l'affirme. C'est le régime d'intégration tierce de la CI
 * (`docs/architecture.md`, « deux régimes, jamais mélangés ») et le critère 2 de
 * s33.
 *
 * **Elle refuse tout de même une tâche inconnue**, et ce n'est pas du zèle : une
 * doublure plus permissive que le serveur mesure la doublure. Un test qui émet
 * vers une tâche qu'aucun module activé ne déclare doit voir le même refus que
 * l'application, sans quoi il croirait éprouver une mise en file qui n'aurait
 * jamais lieu en production.
 */

export interface RecordedJobEmission {
  readonly job: string
  readonly key: string
  readonly data: Readonly<Record<string, string>>
}

export interface RecordingJobs {
  readonly jobs: Jobs
  /** Les émissions acceptées, dans l'ordre. Instantané : une lecture ne bouge plus. */
  readonly emissions: readonly RecordedJobEmission[]
  reset(): void
}

export interface RecordingJobsOptions {
  /** Le registre contre lequel l'existence de la tâche est vérifiée. */
  readonly registry: ModuleRegistry
}

export function createRecordingJobs(options: RecordingJobsOptions): RecordingJobs {
  const emissions: RecordedJobEmission[] = []
  const declared = new Set(scheduledJobs(options.registry).map((entry) => entry.id))
  let counter = 0

  return {
    jobs: {
      emit(emission: JobEmission): Promise<EmitJobResult> {
        if (!declared.has(emission.job)) {
          return Promise.resolve({
            ok: false,
            error: {
              code: 'unknown_job',
              message: `Aucun module activé ne déclare la tâche « ${emission.job} ».`,
            },
          })
        }

        emissions.push({ job: emission.job, key: emission.key, data: { ...emission.data } })
        counter += 1

        return Promise.resolve({ ok: true, id: `recorded-${counter}` })
      },
    },

    get emissions(): readonly RecordedJobEmission[] {
      // Une copie, pas la liste vivante : sinon un test qui lit avant l'émission
      // qu'il prétend observer passe au vert quand l'émission arrive après.
      return [...emissions]
    },

    reset(): void {
      emissions.length = 0
      counter = 0
    },
  }
}
