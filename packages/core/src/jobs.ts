import type { JobEmission, JobsError, JobsErrorCode, JobsLogger } from '@repo/ports'

import type { ModuleJob } from './module'
import type { ModuleRegistry, RegistryJob } from './registry'

/**
 * **Le répartiteur de tâches** — la moitié manquante d'un contrat écrit depuis
 * le premier module (s33).
 *
 * `registry.jobs` était agrégé depuis toujours et **n'avait aucun
 * consommateur** : `registry.ts` construisait le tableau, rien ne le lisait. Un
 * seul module sur treize déclarait une tâche — `rate-limit`, avec
 * `sweepClosedWindows` — et elle n'a **jamais tourné**, si bien que
 * `rate_limit_window` croît sans borne. Ce fichier est ce qui la lit.
 *
 * Il vit dans `@repo/core`, à côté de `dispatchModuleRequest`, pour la même
 * raison que lui : c'est le registre qui sait quels modules sont activés, et
 * une tâche d'un module coupé ne doit **pas exister**, plutôt qu'exister et se
 * taire. Il ne connaît ni Inngest, ni la base, ni `config/` : le fournisseur,
 * le magasin d'idempotence et le journal lui sont **injectés**, comme le garde
 * de limitation l'est au répartiteur de requêtes.
 */

/** Le refus d'une configuration de tâches. Levé au démarrage, jamais en vol. */
export class JobsConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JobsConfigurationError'
  }
}

/**
 * Un échec **que la tâche elle-même qualifie**.
 *
 * C'est la seule façon pour une tâche de dire « ne rejoue pas » : sans elle,
 * tout échec retomberait sur `provider_unavailable`, donc sur la reprise, et
 * une charge utile illisible serait réessayée jusqu'au plafond pour rien
 * (`docs/reliability.md` §3).
 */
export class JobFailure extends Error {
  readonly code: JobsErrorCode

  constructor(code: JobsErrorCode, message: string) {
    super(message)
    this.name = 'JobFailure'
    this.code = code
  }
}

/**
 * Clé qualifiée d'une tâche : deux modules peuvent nommer la leur pareil.
 *
 * Même forme et même raison que `qualifyMessageKey`.
 */
export const qualifyJobId = (moduleId: string, jobId: string): string => `${moduleId}.${jobId}`

/** Une tâche du registre, prête à ordonnancer : son identifiant est déjà qualifié. */
export interface ScheduledJob {
  readonly id: string
  readonly moduleId: string
  readonly job: ModuleJob
}

/** Les tâches des modules **activés**, qualifiées. Un module coupé n'en a aucune. */
export const scheduledJobs = (registry: ModuleRegistry): readonly ScheduledJob[] =>
  registry.jobs.map((entry: RegistryJob) => ({
    id: qualifyJobId(entry.moduleId, entry.job.id),
    moduleId: entry.moduleId,
    job: entry.job,
  }))

/** Les bornes des cinq champs d'une expression cron, dans l'ordre. */
const CRON_FIELDS: readonly { readonly name: string; readonly min: number; readonly max: number }[] =
  [
    { name: 'minute', min: 0, max: 59 },
    { name: 'heure', min: 0, max: 23 },
    { name: 'jour du mois', min: 1, max: 31 },
    { name: 'mois', min: 1, max: 12 },
    { name: 'jour de la semaine', min: 0, max: 6 },
  ]

/**
 * Les valeurs qu'un champ cron autorise, ou `null` si le champ est illisible.
 *
 * Supporté : l'astérisque, l'astérisque suivie d'un pas, une valeur, une plage
 * `a-b`, une plage avec pas, et des listes de tout cela. Ce n'est pas la grammaire complète de
 * Vixie cron — les noms de mois et de jours, `L`, `W` et `#` n'en sont pas — et
 * c'est écrit ici plutôt que sous-entendu : une expression qui les emploie est
 * **refusée au démarrage**, pas ignorée en silence.
 */
const fieldValues = (expression: string, min: number, max: number): ReadonlySet<number> | null => {
  const values = new Set<number>()

  for (const part of expression.split(',')) {
    if (part === '') {
      return null
    }

    const [range, step] = part.split('/')

    if (range === undefined || part.split('/').length > 2) {
      return null
    }

    let stepValue = 1

    if (step !== undefined) {
      if (!/^\d+$/.test(step)) {
        return null
      }

      stepValue = Number(step)

      if (stepValue < 1) {
        return null
      }
    }

    let from = min
    let to = max

    if (range !== '*') {
      const bounds = range.split('-')

      if (bounds.length > 2 || bounds.some((bound) => !/^\d+$/.test(bound))) {
        return null
      }

      from = Number(bounds[0])
      to = bounds.length === 2 ? Number(bounds[1]) : from

      if (from < min || to > max || from > to) {
        return null
      }
    }

    for (let value = from; value <= to; value += stepValue) {
      values.add(value)
    }
  }

  return values.size === 0 ? null : values
}

/** Une expression cron décomposée en cinq ensembles de valeurs. */
type ParsedCron = readonly ReadonlySet<number>[]

const parseCron = (schedule: string): ParsedCron | null => {
  const parts = schedule.trim().split(/\s+/)

  if (schedule.trim() === '' || parts.length !== CRON_FIELDS.length) {
    return null
  }

  const parsed: ReadonlySet<number>[] = []

  for (const [index, field] of CRON_FIELDS.entries()) {
    const values = fieldValues(parts[index] as string, field.min, field.max)

    if (values === null) {
      return null
    }

    parsed.push(values)
  }

  return parsed
}

/**
 * L'échéance tombe-t-elle à cette minute-là ?
 *
 * **En UTC**, et il faut le dire : l'ordonnanceur ne connaît pas le fuseau du
 * lecteur, et une tâche dont l'heure glisserait deux fois l'an au gré de
 * l'heure d'été serait une source de doublons et de trous. Une expression
 * illisible ne « correspond » jamais — mais elle n'arrive pas ici, parce que
 * `assertJobsAreRunnable` l'a refusée au démarrage.
 */
export function cronMatches(schedule: string, date: Date): boolean {
  const parsed = parseCron(schedule)

  if (parsed === null) {
    return false
  }

  const [minutes, hours, daysOfMonth, months, daysOfWeek] = parsed as [
    ReadonlySet<number>,
    ReadonlySet<number>,
    ReadonlySet<number>,
    ReadonlySet<number>,
    ReadonlySet<number>,
  ]

  return (
    minutes.has(date.getUTCMinutes()) &&
    hours.has(date.getUTCHours()) &&
    daysOfMonth.has(date.getUTCDate()) &&
    months.has(date.getUTCMonth() + 1) &&
    daysOfWeek.has(date.getUTCDay())
  )
}

/**
 * **La garde de démarrage de l'ordonnanceur, et son plancher.**
 *
 * Trois refus, et le premier est le cœur de la story :
 *
 * 1. **aucune tâche** — un ordonnanceur qui démarre sur un tableau vide tourne
 *    à vide en silence, ce qui est exactement l'état que s33 corrige : la clé
 *    `jobs` était agrégée depuis toujours sans consommateur, et
 *    `rate_limit_window` grossissait. Sans ce refus, on relivre ce défaut avec
 *    une suite verte ;
 * 2. **deux tâches de même identifiant qualifié** — l'une écraserait l'autre
 *    chez le fournisseur, et la disparue ne se signalerait nulle part ;
 * 3. **une expression cron illisible** — le contrat porte `schedule` en chaîne
 *    libre et **rien ne la validait**, puisque rien ne la lisait. Une
 *    expression fausse était silencieuse ; elle refuse désormais le démarrage,
 *    en nommant la tâche.
 */
export function assertJobsAreRunnable(jobs: readonly ScheduledJob[]): void {
  if (jobs.length === 0) {
    throw new JobsConfigurationError(
      'Aucune tâche planifiée n’est déclarée par les modules activés : l’ordonnanceur ' +
        'n’aurait rien à exécuter. Un module qui déclare une tâche doit être activé, ou ' +
        'l’ordonnanceur ne doit pas être monté.',
    )
  }

  assertJobSchedulesAreValid(jobs)
}

/**
 * **Ce qu'une déclaration doit valoir, ordonnanceur monté ou non.**
 *
 * Les deux refus ci-dessous portent sur la **déclaration** — un doublon
 * d'identifiant, une expression illisible —, jamais sur l'existence d'un
 * ordonnanceur. Ils sont donc séparés du plancher, et appliqués dans **toutes**
 * les configurations : un cron faux est un défaut que le module `jobs` soit
 * activé ou non, et une garde qui ne mord que dans la configuration livrée est
 * une garde que la branche « socle » de la CI n'exécute jamais.
 *
 * Mesuré : `pnpm test:minimal-profile` — qui coupe `jobs` — laissait passer une
 * expression illisible tant que ces deux refus vivaient derrière le plancher.
 */
export function assertJobSchedulesAreValid(jobs: readonly ScheduledJob[]): void {
  const seen = new Set<string>()

  for (const { id, job } of jobs) {
    if (seen.has(id)) {
      throw new JobsConfigurationError(
        `Tâche planifiée déclarée deux fois : « ${id} ». Deux tâches de même identifiant ` +
          'qualifié s’écraseraient chez l’ordonnanceur, et la disparue ne se signalerait nulle part.',
      )
    }

    seen.add(id)

    if (parseCron(job.schedule) === null) {
      throw new JobsConfigurationError(
        `Expression cron refusée pour la tâche « ${id} » : « ${job.schedule} ». Cinq champs ` +
          'sont attendus (minute heure jour-du-mois mois jour-de-la-semaine), chacun en ' +
          '« * », « */pas », une valeur, une plage « a-b » ou une liste. Les noms de mois et ' +
          'de jours ne sont pas lus.',
      )
    }
  }
}

/**
 * Ce qui se rejoue, et rien d'autre (`docs/reliability.md` §3).
 *
 * **Un `switch` exhaustif, et c'est le point.** La version précédente était une
 * chaîne de `===` au-dessus d'un commentaire qui promettait que « l'exhaustivité
 * de `JobsErrorCode` le rappelle au compilateur » — c'était faux : ajouter
 * `quota_exceeded` à l'union laissait `pnpm typecheck --force` vert sur 32
 * paquets, et le code neuf retombait en silence du côté **définitif**, donc
 * n'était jamais réessayé (constat F3 de la revue de s33).
 *
 * La commande qui échoue quand ce n'est plus vrai est donc **`pnpm typecheck`** :
 * `const unhandled: never = code` ne compile que si tous les codes sont traités.
 */
export function isTransientJobsError(code: JobsErrorCode): boolean {
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
 * Ce qu'un message d'échec a le droit de laisser passer (`docs/security.md` §5).
 *
 * Une tâche échoue au milieu du code métier : son message peut contenir
 * n'importe quoi — une URL signée du fournisseur, une clé, un fragment de
 * charge utile avec une adresse. Le journal d'exécution est relu par un humain,
 * pas par une machine : il n'a besoin ni de l'un ni de l'autre.
 *
 * **Ce qui est retiré**, et c'est la liste de ce qui a été balayé : les URL, les
 * clés du fournisseur de jobs (`signkey-`, `event-key-`) et des trois autres
 * ports déjà livrés (`sk_`, `rk_`, `pk_`, `whsec_`, `re_`), et les adresses
 * email. Ce qui **reste** : le reste de la phrase, sans quoi le message ne
 * diagnostique plus rien.
 */
const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  [/https?:\/\/\S+/g, '[url]'],
  [/\b(?:signkey|event-key)-[A-Za-z0-9_-]+/g, '[clé]'],
  [/\b(?:sk|rk|pk|whsec|re)_[A-Za-z0-9_-]+/g, '[clé]'],
  [/[^\s<>"'@]+@[^\s<>"'@]+\.[A-Za-z]{2,}/g, '[adresse]'],
]

/** Un message plus long que ça ne diagnostique plus rien : il remplit un journal. */
const MAX_MESSAGE_LENGTH = 300

const sanitize = (message: string): string => {
  const redacted = REDACTIONS.reduce(
    (current, [pattern, replacement]) => current.replaceAll(pattern, replacement),
    message,
  )

  return redacted.length <= MAX_MESSAGE_LENGTH
    ? redacted
    : `${redacted.slice(0, MAX_MESSAGE_LENGTH - 1)}…`
}

/** Une erreur de validation, telle que Zod la produit — sans importer Zod ici. */
const isValidationError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { name?: unknown }).name === 'ZodError' &&
  Array.isArray((error as { issues?: unknown }).issues)

/**
 * Classe l'échec d'une exécution.
 *
 * **L'inconnu retombe sur `provider_unavailable`, jamais sur définitif** : le
 * traiter comme définitif supprimerait la reprise exactement quand elle sert.
 * La seule façon de dire « ne rejoue pas » est de le dire — par `JobFailure`, ou
 * par une erreur de validation, que `docs/reliability.md` §3 nomme.
 */
export function classifyJobFailure(error: unknown): JobsError {
  if (error instanceof JobFailure) {
    return { code: error.code, message: sanitize(error.message) }
  }

  const message = sanitize(error instanceof Error ? error.message : String(error))

  return {
    code: isValidationError(error) ? 'invalid_event' : 'provider_unavailable',
    message,
  }
}

export interface JobBackoffPolicy {
  readonly baseMs: number
  readonly maxMs: number
  /** Injecté : une attente aléatoire non injectée est une attente non testable. */
  readonly random: () => number
}

/**
 * Recul exponentiel **avec dispersion**, plafonné — la même forme que les trois
 * adaptateurs déjà livrés, et pour la même raison : sans dispersion, mille
 * instances qui échouent sur la même panne rejouent à la même milliseconde et
 * achèvent le tiers au moment où il se relève.
 *
 * `attempt` vaut 1 pour la première reprise.
 */
export function jobBackoffDelayMs(attempt: number, policy: JobBackoffPolicy): number {
  const exponential = Math.min(policy.maxMs, policy.baseMs * 2 ** (attempt - 1))

  return Math.round(exponential / 2 + policy.random() * (exponential / 2))
}

/**
 * **Le registre des exécutions déjà faites** — ce qui rend le rejeu inoffensif.
 *
 * `claim` rend `true` la première fois et `false` ensuite : c'est ce qui fait
 * qu'une même clé ne produit **qu'un** effet, prouvé en rejouant
 * (`docs/reliability.md` §1). `release` défait la réservation quand l'exécution
 * a définitivement échoué — sans quoi une panne passagère condamnerait
 * l'exécution pour toujours, ce qui n'est pas de l'idempotence mais de la perte.
 *
 * Il est **facultatif** : le module `jobs` coupé, il n'y a pas de table pour le
 * tenir, et l'émission retombe sur l'exécution synchrone dans la requête
 * appelante (critère 8). C'est une garantie en moins, dite plutôt que
 * sous-entendue.
 */
export interface JobRunLedger {
  claim(input: { readonly job: string; readonly key: string; readonly now: Date }): Promise<boolean>
  release(input: { readonly job: string; readonly key: string }): Promise<void>
}

export interface JobRetryPolicy {
  /** Tentatives au total, reprises comprises. `1` : aucune reprise. */
  readonly maxAttempts: number
  readonly baseMs: number
  readonly maxMs: number
}

export interface DispatchJobOptions {
  readonly registry: ModuleRegistry
  readonly emission: JobEmission
  /** Absent, aucune déduplication n'est tenue — le rejeu produit un second effet. */
  readonly ledger?: JobRunLedger
  readonly log: JobsLogger
  readonly retry: JobRetryPolicy
  readonly now: () => Date
  readonly random?: () => number
  readonly sleep?: (ms: number) => Promise<void>
}

export type DispatchJobResult =
  | { readonly ok: true; readonly ran: boolean; readonly attempts: number }
  | { readonly ok: false; readonly error: JobsError; readonly attempts: number }

const wait = async (ms: number): Promise<void> =>
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * Exécute la tâche déclarée que l'émission nomme.
 *
 * L'ordre est la règle, et chaque étape refuse avant la suivante :
 *
 * 1. **la tâche existe-t-elle ?** Un module coupé emporte ses tâches, et
 *    l'émission vers l'une d'elles est un échec **définitif** nommé — jamais une
 *    file qui grossit sans consommateur ;
 * 2. **cette exécution a-t-elle déjà eu lieu ?** Le registre des exécutions
 *    répond, et un rejeu ne fait rien du tout ;
 * 3. **l'exécution**, avec sa politique de reprise : une erreur transitoire est
 *    réessayée jusqu'au plafond, une erreur définitive ne l'est **pas**.
 */
export async function dispatchModuleJob(options: DispatchJobOptions): Promise<DispatchJobResult> {
  const { registry, emission, ledger, log, retry, now } = options
  const random = options.random ?? Math.random
  const sleep = options.sleep ?? wait
  const declared = scheduledJobs(registry).find((entry) => entry.id === emission.job)

  if (declared === undefined) {
    const error: JobsError = {
      code: 'unknown_job',
      message:
        `Aucun module activé ne déclare la tâche « ${emission.job} ». Un module coupé ` +
        'emporte ses tâches : rien ne l’exécutera.',
    }

    log({
      event: 'job.emit_failed',
      job: emission.job,
      key: emission.key,
      attempt: 0,
      code: error.code,
      message: error.message,
    })

    return { ok: false, error, attempts: 0 }
  }

  if (ledger !== undefined) {
    let claimed: boolean

    try {
      claimed = await ledger.claim({ job: emission.job, key: emission.key, now: now() })
    } catch (thrown) {
      /**
       * **Le magasin en panne ne fait pas lever ce répartiteur.**
       *
       * `createDrizzleJobLedger` rejette sur son délai explicite comme sur toute
       * erreur du pilote. Non attrapée, l'exception traversait la boucle de
       * vidage de l'exécuteur local et le gestionnaire de rappel du fournisseur
       * — sans **aucune** ligne de journal, alors que trois documents
       * promettaient l'inverse (constat F4 de la revue de s33). Un port ne lève
       * pas ; son répartiteur non plus.
       *
       * `attempts: 0` : la tâche n'a pas tourné, et elle ne devait pas —
       * réserver est ce qui autorise à exécuter.
       */
      const error = classifyJobFailure(thrown)

      log({
        event: 'job.failed',
        job: emission.job,
        key: emission.key,
        attempt: 0,
        code: error.code,
        message: error.message,
      })

      return { ok: false, error, attempts: 0 }
    }

    if (!claimed) {
      log({
        event: 'job.skipped',
        job: emission.job,
        key: emission.key,
        attempt: 0,
        code: null,
        message: null,
      })

      return { ok: true, ran: false, attempts: 0 }
    }
  }

  const maxAttempts = Math.max(1, retry.maxAttempts)

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    log({
      event: 'job.started',
      job: emission.job,
      key: emission.key,
      attempt,
      code: null,
      message: null,
    })

    try {
      await declared.job.run({
        key: emission.key,
        data: emission.data,
        attempt,
        now: now(),
      })

      log({
        event: 'job.succeeded',
        job: emission.job,
        key: emission.key,
        attempt,
        code: null,
        message: null,
      })

      return { ok: true, ran: true, attempts: attempt }
    } catch (thrown) {
      const error = classifyJobFailure(thrown)
      const retryable = isTransientJobsError(error.code) && attempt < maxAttempts

      log({
        event: retryable ? 'job.retrying' : 'job.failed',
        job: emission.job,
        key: emission.key,
        attempt,
        code: error.code,
        message: error.message,
      })

      if (!retryable) {
        // **La libération ne masque pas l'échec qu'elle suit.** Un magasin qui
        // refuse ici laisserait l'appelant croire à une panne de magasin là où la
        // tâche a échoué pour une autre raison — et le journal porterait le
        // mauvais code. La réservation reste alors en place : le rejeu sera
        // sauté, ce qui est le sens fermé.
        try {
          await ledger?.release({ job: emission.job, key: emission.key })
        } catch {
          /* Rien à ajouter : l'échec d'origine est déjà journalisé ci-dessus. */
        }

        return { ok: false, error, attempts: attempt }
      }

      await sleep(jobBackoffDelayMs(attempt, { baseMs: retry.baseMs, maxMs: retry.maxMs, random }))
    }
  }

  /* c8 ignore next -- la boucle rend toujours avant d'en sortir. */
  throw new Error('unreachable')
}
