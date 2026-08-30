import type {
  EmailRenderer,
  Mailer,
  MailerError,
  MailerErrorCode,
  MailerLogger,
  RenderedEmail,
  SendEmailInput,
  SendEmailResult,
} from '@repo/ports'
import { Resend } from 'resend'

import { sanitizeProviderMessage } from './log'
import { type ResendErrorResponse, backoffDelayMs, classifyResendError, isTransient } from './retry'

/**
 * L'unique implémentation livrée du port `Mailer` (ADR 008).
 *
 * Trois comportements du SDK installé (`resend@6.25.0`) ont été **relevés dans
 * le paquet**, pas dans la documentation, et ils décident de ce fichier :
 *
 * 1. `emails.send` **ne lève pas**. Une erreur d'API comme une panne réseau
 *    reviennent en `{ data: null, error: { name, message, statusCode } }` ; une
 *    panne réseau donne `application_error` avec `statusCode: null`. C'est
 *    pourquoi l'échec se lit dans la valeur de retour, et non dans un `catch`
 *    (qui reste là par prudence, pour ce que le SDK n'a pas prévu).
 * 2. `ResendOptions` ne porte **ni délai d'attente, ni `AbortSignal`** :
 *    `{ baseUrl, userAgent }`, rien d'autre, et `PostOptions` n'expose que
 *    `query` et `headers`. Le délai est donc tenu ici, par course. Conséquence
 *    à connaître et assumée : la requête sous-jacente n'est **pas annulée**,
 *    elle est abandonnée. Ce que `docs/reliability.md` §3 exige est tenu — la
 *    requête de l'appelant n'est jamais bloquée au-delà du délai — mais la
 *    socket vit sa vie jusqu'à ce que Node la ferme.
 * 3. `new Resend(undefined)` lit `process.env.RESEND_API_KEY`, et
 *    `getDefaultBaseUrl()` lit `process.env.RESEND_BASE_URL`. Le dépôt interdit
 *    toute lecture de `process.env` hors de `@repo/config` : la clé **et**
 *    l'URL sont donc toujours passées explicitement, ce qui neutralise les deux
 *    lectures.
 *
 * Le SDK écrit par ailleurs ses erreurs sur `console.error` hors production
 * (`logError`). Ce journal-là n'est pas le nôtre et n'est pas configurable ;
 * il ne contient ni clé, ni charge utile — seulement l'objet d'erreur et le
 * chemin — mais un message de fournisseur peut y nommer une adresse. C'est une
 * limite connue du paquet, bornée au développement.
 */

const DEFAULT_BASE_URL = 'https://api.resend.com'
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 250
const DEFAULT_MAX_DELAY_MS = 5_000

export interface ResendMailerOptions {
  readonly apiKey: string
  /** Expéditeur, `Nom <adresse>` ou adresse nue. Vient de la configuration. */
  readonly from: string
  readonly render: EmailRenderer
  readonly logger?: MailerLogger
  readonly baseUrl?: string
  readonly timeoutMs?: number
  readonly maxAttempts?: number
  readonly baseDelayMs?: number
  readonly maxDelayMs?: number
  /** Injectés pour que le recul, la dispersion et l'idempotence soient testables. */
  readonly sleep?: (ms: number) => Promise<void>
  readonly random?: () => number
  readonly newIdempotencyKey?: () => string
}

/** Marqueur de course : distinct de toute valeur que le SDK peut rendre. */
const TIMED_OUT = Symbol('timed-out')

/**
 * Borne l'attente de l'appelant.
 *
 * La promesse perdante est neutralisée (`catch`) : sans cela, un rejet arrivant
 * après la course remonterait en `unhandledRejection` et pourrait abattre le
 * processus.
 */
const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof TIMED_OUT> => {
  let timer: ReturnType<typeof setTimeout> | undefined

  const expiry = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs)
  })

  promise.catch(() => undefined)

  try {
    return await Promise.race([promise, expiry])
  } finally {
    clearTimeout(timer)
  }
}

const asError = (code: MailerErrorCode, message: string, attempts: number): MailerError => ({
  code,
  message: sanitizeProviderMessage(message),
  attempts,
})

export function createResendMailer(options: ResendMailerOptions): Mailer {
  if (options.apiKey.trim() === '') {
    // Erreur de configuration, pas panne de fournisseur : elle se voit au
    // démarrage, elle ne dégrade pas requête par requête.
    throw new Error(
      'RESEND_API_KEY est vide : construisez la capture locale plutôt que cet adapter.',
    )
  }

  const client = new Resend(options.apiKey, { baseUrl: options.baseUrl ?? DEFAULT_BASE_URL })
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const backoff = {
    baseMs: options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
    maxMs: options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
    random: options.random ?? Math.random,
  }
  const newIdempotencyKey = options.newIdempotencyKey ?? (() => crypto.randomUUID())
  const log = options.logger ?? (() => undefined)

  return {
    async send(input: SendEmailInput): Promise<SendEmailResult> {
      let rendered: RenderedEmail
      try {
        rendered = await options.render(input)
      } catch {
        // Template inconnu, locale non livrée, donnée manquante : un défaut de
        // programmation. Définitif, jamais rejoué, et le réseau n'est même pas
        // touché.
        const error = asError(
          'invalid_request',
          `Rendu du template « ${input.template} » impossible.`,
          1,
        )
        log({ event: 'mailer.send_failed', template: input.template, ...toLog(error) })

        return { ok: false, error }
      }

      // **Une seule clé pour toutes les tentatives.** C'est ce qui rend la
      // reprise sûre : si c'est la réponse du fournisseur qui s'est perdue,
      // l'essai suivant n'envoie pas un second email
      // (`docs/reliability.md` §1).
      const idempotencyKey = newIdempotencyKey()
      let lastError: MailerError = asError('provider_unavailable', 'Aucune tentative.', 0)

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const outcome = await attemptSend()

        if (outcome.ok) {
          return outcome
        }

        lastError = { ...outcome.error, attempts: attempt }

        if (!isTransient(lastError.code) || attempt === maxAttempts) {
          break
        }

        log({ event: 'mailer.send_retried', template: input.template, ...toLog(lastError) })
        await sleep(backoffDelayMs(attempt, backoff))
      }

      log({ event: 'mailer.send_failed', template: input.template, ...toLog(lastError) })

      return { ok: false, error: lastError }

      async function attemptSend(): Promise<SendEmailResult> {
        try {
          const outcome = await withTimeout(
            client.emails.send(
              {
                from: options.from,
                to: input.to,
                subject: rendered.subject,
                html: rendered.html,
                text: rendered.text,
              },
              { idempotencyKey },
            ),
            timeoutMs,
          )

          if (outcome === TIMED_OUT) {
            return {
              ok: false,
              error: asError('timeout', `Aucune réponse en ${timeoutMs} ms.`, 1),
            }
          }

          if (outcome.error !== null) {
            const failure = outcome.error as ResendErrorResponse

            return {
              ok: false,
              error: asError(classifyResendError(failure), failure.message, 1),
            }
          }

          return { ok: true, id: outcome.data.id }
        } catch (cause) {
          // Le SDK installé ne lève pas — il avale ses propres exceptions et
          // rend `{ data: null, error }` — mais une version ultérieure le
          // pourrait, et une exception non rattrapée ici ferait exactement ce
          // que la forme du port existe pour empêcher : tomber chez l'appelant.
          // Aucun scénario réseau n'atteint donc ce `catch` ; le seul cas qui
          // l'exerce remplace le SDK par un objet qui lève, et c'est l'unique
          // endroit de la suite où le SDK est doublé.
          return {
            ok: false,
            error: asError(
              'provider_unavailable',
              cause instanceof Error ? cause.message : 'Erreur inattendue du SDK Resend.',
              1,
            ),
          }
        }
      }
    },
  }
}

/** Ce qui d'une erreur a le droit d'entrer dans un journal — le reste n'existe pas. */
const toLog = (error: MailerError) => ({
  code: error.code,
  attempts: error.attempts,
  message: error.message,
})
