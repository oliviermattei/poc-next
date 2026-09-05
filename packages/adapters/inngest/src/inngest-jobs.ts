import type {
  EmitJobResult,
  JobEmission,
  JobsError,
  JobsErrorCode,
  JobsLogger,
} from '@repo/ports'
import { Inngest, NonRetriableError } from 'inngest'
import { serve } from 'inngest/edge'

/**
 * L'unique implémentation livrée du port `Jobs` (ADR 008, contrainte du PRD :
 * « adapter avec **Inngest** comme seule implémentation »).
 *
 * **Deux moitiés, et elles n'ont pas la même nature :**
 *
 * 1. **l'émission** — `createInngestJobs` — est un seul POST vers l'API
 *    d'événements documentée du fournisseur (`POST <base>/e/<clé>`). Elle est
 *    écrite ici plutôt que déléguée à `client.send()` pour trois raisons
 *    mesurées sur `inngest@4.20.0` : `send` **ne porte aucun délai d'attente**
 *    (`docs/reliability.md` §3 en exige un explicite), il **reprend lui-même**
 *    ce que notre politique doit décider, et son échec est un `Error` dont le
 *    seul indice est la chaîne « Inngest API Error: 503 … » — classer une
 *    reprise sur une sous-chaîne de message est un piège que le code HTTP évite ;
 * 2. **l'exécution** — `createInngestRunner` — est le vrai `serve` du SDK. Le
 *    protocole d'appel de fonction (synchronisation, signature, pas d'exécution)
 *    n'est pas un POST documenté : le réimplémenter serait le contraire de
 *    « generate, don't guess ».
 *
 * Ce fichier ne connaît ni `@repo/core`, ni le registre, ni la base : il reçoit
 * la **liste des tâches déclarées** et une fonction de répartition. C'est ce qui
 * lui permet de rester un adapter, et à la politique de reprise de vivre à un
 * seul endroit.
 */

const DEFAULT_BASE_URL = 'https://inn.gs'
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 250
const DEFAULT_MAX_DELAY_MS = 5_000

/** Le préfixe d'événement sous lequel une tâche déclarée est déclenchable. */
export const JOB_EVENT_PREFIX = 'job/'

export interface InngestJobsOptions {
  /** La clé d'événement du fournisseur. Jamais lue de l'environnement ici. */
  readonly eventKey: string
  /** Les identifiants qualifiés que les modules **activés** déclarent. */
  readonly declared: readonly string[]
  readonly baseUrl?: string
  readonly timeoutMs?: number
  readonly maxAttempts?: number
  readonly baseDelayMs?: number
  readonly maxDelayMs?: number
  readonly log?: JobsLogger
  /** Injectés : sans cela ni le délai, ni le recul, ni la dispersion ne sont testables. */
  readonly fetch?: typeof fetch
  readonly sleep?: (ms: number) => Promise<void>
  readonly random?: () => number
}

/**
 * Ce qu'un code HTTP dit d'un échec d'émission.
 *
 * **L'inconnu retombe sur `provider_unavailable`, jamais sur définitif** :
 * traiter l'inconnu comme définitif supprimerait la reprise exactement quand
 * elle sert.
 */
const codeOfStatus = (status: number): JobsErrorCode => {
  if (status === 401 || status === 403) {
    return 'unauthorized'
  }

  if (status === 429) {
    return 'rate_limited'
  }

  if (status === 400 || status === 422) {
    return 'invalid_event'
  }

  return 'provider_unavailable'
}

/**
 * Le même classement que `isTransientJobsError` (`@repo/core`), **rejoué ici**.
 *
 * La duplication est structurelle et assumée : un adaptateur ne dépend pas du
 * socle de modules (voir `AGENTS.md` de ce package), et ADR 059 est corrigé en
 * conséquence — le classement est écrit **une fois par côté de la frontière**,
 * pas une fois dans le dépôt.
 *
 * Deux commandes, et il faut les deux — le compilateur seul ne suffisait pas
 * (constat b de la seconde revue) :
 *
 * - `pnpm typecheck` force chacun des deux à **traiter** tous les codes, des
 *   deux côtés à la fois ;
 * - `pnpm test` les force à **dire la même chose** : `tests/jobs.test.ts` les
 *   confronte sur `JOBS_ERROR_CODES`, la liste dont l'union est dérivée. C'est
 *   pour être confronté que ce classement est exporté.
 */
export const isTransientInngestError = (code: JobsErrorCode): boolean => {
  switch (code) {
    case 'provider_unavailable':
    case 'timeout':
    case 'rate_limited':
      return true
    case 'unauthorized':
    case 'invalid_event':
    case 'unknown_job':
      return false
    default: {
      const unhandled: never = code

      /* c8 ignore next -- inatteignable tant que le compilateur tient l'union. */
      throw new Error(`Code d’erreur de tâche non classé : ${String(unhandled)}`)
    }
  }
}

/**
 * Ce qu'un message a le droit de laisser passer (`docs/security.md` §5).
 *
 * La clé d'événement voyage dans l'URL de l'appel : un message qui reprendrait
 * l'URL, ou que le fournisseur renverrait en citant la clé, la mettrait au
 * journal. C'est exactement le cas mesuré chez l'adapter de paiement.
 */
const sanitize = (message: string, eventKey: string): string => {
  const withoutKey = eventKey === '' ? message : message.replaceAll(eventKey, '[clé]')
  const redacted = withoutKey
    .replaceAll(/https?:\/\/\S+/g, '[url]')
    .replaceAll(/\b(?:signkey|event-key)-[A-Za-z0-9_-]+/g, '[clé]')

  return redacted.length <= 300 ? redacted : `${redacted.slice(0, 299)}…`
}

const backoffDelayMs = (attempt: number, baseMs: number, maxMs: number, random: number): number => {
  const exponential = Math.min(maxMs, baseMs * 2 ** (attempt - 1))

  return Math.round(exponential / 2 + random * (exponential / 2))
}

export function createInngestJobs(options: InngestJobsOptions): {
  emit(emission: JobEmission): Promise<EmitJobResult>
} {
  if (options.eventKey.trim() === '') {
    // Erreur de configuration, pas panne de fournisseur : elle se voit au
    // démarrage, elle ne dégrade pas émission par émission.
    throw new Error(
      'INNGEST_EVENT_KEY est vide : montez l’exécuteur local (JOBS_LOCAL_RUNNER=1) plutôt ' +
        'que cet adapter.',
    )
  }

  const declared = new Set(options.declared)
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const call = options.fetch ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const random = options.random ?? Math.random
  const log = options.log ?? ((): void => undefined)

  const failure = (emission: JobEmission, error: JobsError, attempt: number): EmitJobResult => {
    log({
      event: 'job.emit_failed',
      job: emission.job,
      key: emission.key,
      attempt,
      code: error.code,
      message: error.message,
    })

    return { ok: false, error }
  }

  return {
    async emit(emission: JobEmission): Promise<EmitJobResult> {
      if (!declared.has(emission.job)) {
        // Aucun appel réseau : mettre en file une tâche que personne
        // n'exécutera est exactement l'état que s33 corrige.
        return failure(
          emission,
          {
            code: 'unknown_job',
            message:
              `Aucun module activé ne déclare la tâche « ${emission.job} » : rien ne ` +
              'l’exécuterait.',
          },
          1,
        )
      }

      const body = JSON.stringify({
        name: `${JOB_EVENT_PREFIX}${emission.job}`,
        /**
         * La clé d'idempotence voyage comme `id`, **qualifiée par la tâche** :
         * le fournisseur déduplique de son côté, ce qui double le registre
         * d'exécutions du répartiteur.
         *
         * La qualification n'est pas décorative. La documentation d'Inngest dit
         * que cet identifiant « n'est pas propre au type d'événement » et
         * demande de « combiner l'identifiant de l'élément avec le type
         * d'événement » ; le registre, lui, condense déjà `<tâche>:<clé>`
         * précisément pour que deux tâches choisissant la même clé ne
         * s'annulent pas. Envoyer la clé nue faisait diverger les deux
         * ceintures, la plus lâche étant celle du fournisseur (constat F6 de la
         * revue de s33).
         */
        id: `${emission.job}:${emission.key}`,
        data: { key: emission.key, data: emission.data },
      })

      let last: JobsError = { code: 'provider_unavailable', message: 'aucune tentative' }

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)

        try {
          const response = await call(`${baseUrl}/e/${options.eventKey}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
            signal: controller.signal,
          })

          if (response.ok) {
            const payload = (await response.json().catch(() => ({}))) as {
              readonly ids?: readonly string[]
            }

            return { ok: true, id: payload.ids?.[0] ?? emission.key }
          }

          const text = await response.text().catch(() => '')

          last = {
            code: codeOfStatus(response.status),
            message: sanitize(
              `Inngest a refusé l’événement (${response.status}) : ${text}`,
              options.eventKey,
            ),
          }
        } catch (thrown) {
          const aborted = thrown instanceof Error && thrown.name === 'AbortError'

          last = {
            code: aborted ? 'timeout' : 'provider_unavailable',
            message: sanitize(
              aborted
                ? `Aucune réponse d’Inngest en ${timeoutMs} ms.`
                : `Appel à Inngest en échec : ${thrown instanceof Error ? thrown.message : String(thrown)}`,
              options.eventKey,
            ),
          }
        } finally {
          clearTimeout(timer)
        }

        if (!isTransientInngestError(last.code) || attempt === maxAttempts) {
          return failure(emission, last, attempt)
        }

        await sleep(backoffDelayMs(attempt, baseDelayMs, maxDelayMs, random()))
      }

      /* c8 ignore next -- la boucle rend toujours avant d'en sortir. */
      return failure(emission, last, maxAttempts)
    },
  }
}

/** Ce que le répartiteur rend au gestionnaire de rappel. */
export interface InngestDispatchOutcome {
  readonly ok: boolean
  readonly error?: JobsError
}

export type InngestJobDispatcher = (emission: JobEmission) => Promise<InngestDispatchOutcome>

export interface InngestRunnerOptions {
  /** L'identifiant de l'application chez le fournisseur. */
  readonly appId: string
  /** Les tâches déclarées par les modules activés : identifiant qualifié et cron. */
  readonly jobs: readonly { readonly id: string; readonly schedule: string }[]
  /** Le répartiteur — c'est lui qui tient la reprise, l'idempotence et le journal. */
  readonly dispatch: InngestJobDispatcher
  /** Le chemin sous lequel l'application sert ce gestionnaire. */
  readonly servePath: string
  readonly signingKey?: string
  readonly eventKey?: string
  readonly baseUrl?: string
  /**
   * Le mode développement, **explicite** — jamais déduit de `NODE_ENV`.
   *
   * C'est lui qui dispense de clé de signature. Le déduire de l'environnement
   * ferait accepter un appel non signé sur une machine mal étiquetée.
   */
  readonly isDev?: boolean
}

/** L'identifiant de fonction chez le fournisseur : un point n'y est pas admis. */
const functionIdOf = (jobId: string): string => jobId.replaceAll('.', '-')

/** La minute d'un instant, en UTC : la granularité d'une échéance cron. */
const minuteKey = (timestamp: number): string => new Date(timestamp).toISOString().slice(0, 16)

/**
 * Le gestionnaire de rappel : une fonction Inngest par tâche déclarée, deux
 * déclencheurs chacune — l'événement `job/<tâche>` et son échéance cron.
 *
 * **`retries: 0`, et c'est une décision.** La politique de reprise vit dans le
 * répartiteur (`dispatchModuleJob`), une fois, avec sa règle « jamais une
 * erreur de validation ». Laisser le fournisseur reprendre par-dessus
 * multiplierait les tentatives par deux et rendrait le plafond configuré faux.
 */
export function createInngestRunner(
  options: InngestRunnerOptions,
): (request: Request) => Promise<Response> {
  const client = new Inngest({
    id: options.appId,
    ...(options.eventKey === undefined ? {} : { eventKey: options.eventKey }),
    ...(options.signingKey === undefined ? {} : { signingKey: options.signingKey }),
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    isDev: options.isDev ?? false,
  })

  const functions = options.jobs.map((job) =>
    client.createFunction(
      {
        id: functionIdOf(job.id),
        retries: 0,
        triggers: [{ event: `${JOB_EVENT_PREFIX}${job.id}` }, { cron: job.schedule }],
      },
      async ({ event }: { event: { readonly ts?: number; readonly data?: unknown } }) => {
        const payload = (event.data ?? {}) as {
          readonly key?: unknown
          readonly data?: unknown
        }
        const timestamp = event.ts ?? Date.now()
        const key =
          typeof payload.key === 'string' && payload.key !== ''
            ? payload.key
            : `${job.id}@${minuteKey(timestamp)}`
        const data =
          typeof payload.data === 'object' && payload.data !== null
            ? (payload.data as Readonly<Record<string, string>>)
            : {}

        const outcome = await options.dispatch({ job: job.id, key, data })

        if (!outcome.ok) {
          const error = outcome.error ?? {
            code: 'provider_unavailable' as JobsErrorCode,
            message: 'échec sans code',
          }

          // Le fournisseur doit voir l'échec, sinon une exécution ratée passe
          // pour une réussite dans son tableau de bord. Définitif, il ne le
          // rejoue pas ; transitoire, le répartiteur a déjà épuisé sa reprise.
          throw isTransientInngestError(error.code)
            ? new Error(`${error.code} : ${error.message}`)
            : new NonRetriableError(`${error.code} : ${error.message}`)
        }

        return { ok: true }
      },
    ),
  )

  return serve({ client, functions, servePath: options.servePath })
}
