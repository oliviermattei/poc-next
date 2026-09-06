import type {
  Analytics,
  AnalyticsError,
  AnalyticsErrorCode,
  AnalyticsEvent,
  AnalyticsLogger,
  AnalyticsPageView,
  AnalyticsProperties,
  AnalyticsResult,
} from '@repo/ports'

import { redactRecord, redactSecretsInText } from './redact'

/**
 * L'unique implémentation livrée du port `Analytics` (ADR 008, contrainte du
 * PRD : « PostHog comme seule implémentation »).
 *
 * **Écrite sur l'API de capture documentée, sans SDK**, pour les trois raisons
 * mesurées chez l'adaptateur d'Inngest et qui valent mot pour mot ici :
 * `posthog-node` porte sa propre file, ses propres reprises et son propre
 * `flush` — c'est-à-dire trois décisions que `docs/reliability.md` §3 confie à
 * l'application —, et il n'expose pas de délai d'attente par appel. La capture
 * est **un seul POST JSON** (`POST <host>/i/v0/e/`), donc le réimplémenter n'est
 * pas deviner un protocole : c'est refuser une file qu'on ne contrôle pas.
 *
 * Ce fichier ne connaît ni `@repo/core`, ni le registre, ni la base, ni le
 * consentement. Il reçoit une clé, un hôte, et des collaborateurs injectés.
 */

const DEFAULT_TIMEOUT_MS = 3_000
const DEFAULT_MAX_ATTEMPTS = 2
const DEFAULT_BASE_DELAY_MS = 200
const DEFAULT_MAX_DELAY_MS = 2_000

/** Le chemin de capture, tel que le fournisseur le documente. */
export const POSTHOG_CAPTURE_PATH = '/i/v0/e/'

/** Le nom réservé du fournisseur pour un affichage de page. */
export const POSTHOG_PAGEVIEW_EVENT = '$pageview'

export interface PostHogAnalyticsOptions {
  /** La clé de projet. Jamais lue de l'environnement ici. */
  readonly apiKey: string
  /** L'origine du fournisseur, sans barre oblique finale. */
  readonly host: string
  readonly timeoutMs?: number
  readonly maxAttempts?: number
  readonly baseDelayMs?: number
  readonly maxDelayMs?: number
  readonly log?: AnalyticsLogger
  /** Injectés : sans cela ni le délai, ni le recul, ni la dispersion ne sont testables. */
  readonly fetch?: typeof fetch
  readonly sleep?: (ms: number) => Promise<void>
  readonly random?: () => number
  readonly now?: () => Date
}

/**
 * Ce qu'un code HTTP dit d'un échec de capture.
 *
 * **L'inconnu retombe sur `provider_unavailable`, jamais sur définitif** : même
 * arbitrage que l'adaptateur d'Inngest — traiter l'inconnu comme définitif
 * supprimerait la reprise exactement quand elle sert.
 */
const codeOfStatus = (status: number): AnalyticsErrorCode => {
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
 * Le classement transitoire / définitif, **lu par la politique de reprise**.
 *
 * `docs/reliability.md` §3 : on ne rejoue jamais une erreur de validation. Il
 * est exporté pour être **confronté** à l'annotation de chaque code de
 * `ANALYTICS_ERROR_CODES` par `tests/analytics.test.ts` : le compilateur force à
 * traiter tous les codes, il ne force pas à en dire quelque chose de juste.
 */
export const isTransientAnalyticsError = (code: AnalyticsErrorCode): boolean => {
  switch (code) {
    case 'provider_unavailable':
    case 'timeout':
    case 'rate_limited':
      return true
    case 'unauthorized':
    case 'invalid_event':
    case 'not_configured':
      return false
    default: {
      const unhandled: never = code

      /* c8 ignore next -- inatteignable tant que le compilateur tient l'union. */
      throw new Error(`Code d’erreur d’analytique non classé : ${String(unhandled)}`)
    }
  }
}

/**
 * Ce qu'un message a le droit de laisser passer (`docs/security.md` §5).
 *
 * La clé de projet voyage dans le **corps** de l'appel, et le fournisseur la
 * cite volontiers dans ses erreurs de validation. Un message qui la reprendrait
 * la mettrait au journal.
 */
const sanitize = (message: string, apiKey: string): string => {
  const withoutKey = apiKey === '' ? message : message.replaceAll(apiKey, '[clé]')
  const redacted = redactSecretsInText(withoutKey)
    .replaceAll(/https?:\/\/\S+/g, '[url]')
    .replaceAll(/\bphc_[A-Za-z0-9_-]+/g, '[clé]')

  return redacted.length <= 300 ? redacted : `${redacted.slice(0, 299)}…`
}

const backoffDelayMs = (attempt: number, baseMs: number, maxMs: number, random: number): number => {
  const exponential = Math.min(maxMs, baseMs * 2 ** (attempt - 1))

  return Math.round(exponential / 2 + random * (exponential / 2))
}

const failure = (code: AnalyticsErrorCode, message: string): AnalyticsError => ({ code, message })

interface CapturePayload {
  readonly event: string
  readonly distinctId: string
  readonly properties: AnalyticsProperties
}

/**
 * L'implémentation, construite avec ses collaborateurs.
 *
 * Elle **ne lève jamais** : toute panne, tout abandon, toute réponse illisible
 * revient en `{ ok: false, error }`. C'est ce que `docs/reliability.md` §2
 * exige d'un port qui dégrade — une mesure perdue ne doit jamais devenir une
 * réponse perdue.
 */
export function createPostHogAnalytics(options: PostHogAnalyticsOptions): Analytics {
  const {
    apiKey,
    host,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    log,
    fetch: fetchImpl = globalThis.fetch,
    sleep = async (ms: number) => await new Promise((resolve) => setTimeout(resolve, ms)),
    random = Math.random,
    now = () => new Date(),
  } = options

  const endpoint = `${host.replace(/\/$/, '')}${POSTHOG_CAPTURE_PATH}`

  const postOnce = async (payload: CapturePayload): Promise<AnalyticsResult> => {
    // **Le délai d'attente est explicite** (`docs/reliability.md` §3), et il est
    // court : une mesure n'a aucun appelant qui l'attend, mais elle est émise
    // depuis une requête qui, elle, en a un.
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          event: payload.event,
          distinct_id: payload.distinctId,
          properties: payload.properties,
          timestamp: now().toISOString(),
        }),
        signal: controller.signal,
      })

      if (response.ok) {
        return { ok: true, id: `${payload.event}:${payload.distinctId}` }
      }

      const body = await response.text().catch(() => '')

      return {
        ok: false,
        error: failure(
          codeOfStatus(response.status),
          sanitize(`${String(response.status)} ${body}`.trim(), apiKey),
        ),
      }
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError'

      return {
        ok: false,
        error: failure(
          aborted ? 'timeout' : 'provider_unavailable',
          sanitize(error instanceof Error ? error.message : 'appel impossible', apiKey),
        ),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  const send = async (payload: CapturePayload, redacted: readonly string[]) => {
    let last: AnalyticsResult = {
      ok: false,
      error: failure('provider_unavailable', 'aucune tentative'),
    }

    for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
      last = await postOnce(payload)

      if (last.ok) {
        log?.({
          event: 'analytics.sent',
          name: payload.event,
          code: null,
          message: null,
          redacted,
        })

        return last
      }

      // **Jamais de reprise sur une erreur définitive** (`docs/reliability.md`
      // §3) : rejouer une validation ne fait que multiplier l'échec.
      if (!isTransientAnalyticsError(last.error.code) || attempt === maxAttempts) {
        break
      }

      await sleep(backoffDelayMs(attempt, baseDelayMs, maxDelayMs, random()))
    }

    if (!last.ok) {
      log?.({
        event: 'analytics.failed',
        name: payload.event,
        code: last.error.code,
        message: last.error.message,
        redacted,
      })
    }

    return last
  }

  return {
    track: async (event: AnalyticsEvent) => {
      // **Le filtrage passe avant la mise en forme de la requête** : ce qui est
      // retiré ne peut donc pas réapparaître par une propriété recopiée plus bas.
      const { values, redacted } = redactRecord(event.properties)

      return await send(
        { event: event.name, distinctId: event.distinctId, properties: values },
        redacted,
      )
    },
    page: async (view: AnalyticsPageView) => {
      const { values, redacted } = redactRecord(view.properties)

      return await send(
        {
          event: POSTHOG_PAGEVIEW_EVENT,
          distinctId: view.distinctId,
          // `$pathname` et non `$current_url` : le port ne transporte qu'un
          // chemin, et une URL complète emporte la query — où vivent les jetons
          // de vérification et de réinitialisation de ce dépôt.
          properties: { ...values, $pathname: view.path },
        },
        redacted,
      )
    },
  }
}
