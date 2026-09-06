import type {
  CaptureResult,
  Monitoring,
  MonitoringError,
  MonitoringErrorCode,
  MonitoringEvent,
  MonitoringLogger,
} from '@repo/ports'

import { redactRecord, redactSecretsInText } from './redact'

/**
 * L'unique implémentation livrée du port `Monitoring` (ADR 008, contrainte du
 * PRD : « Sentry comme seule implémentation »).
 *
 * **Écrite sur le point d'ingestion documenté, sans SDK**, et le motif est plus
 * fort ici que pour les autres adaptateurs : `@sentry/nextjs` s'installe par
 * **instrumentation globale** — il enveloppe la configuration de Next,
 * remplace le chargeur de modules, pose des crochets sur `fetch`, `console` et
 * les composants serveur, et embarque son propre transport avec sa file et ses
 * reprises. C'est-à-dire qu'il décide, à la place de ce dépôt, du délai
 * d'attente (`docs/reliability.md` §3), de la politique de reprise, de ce qui
 * part et de ce qui est filtré (§5, le critère 2 de cette story). Une enveloppe
 * Sentry est un format documenté et stable — trois lignes JSON —, et
 * l'implémenter est ici le contraire de deviner : c'est garder les décisions que
 * le socle exige de tenir.
 *
 * **Ce que l'on perd, et qui est écrit plutôt que passé sous silence** : les
 * instrumentations automatiques du SDK (traces de performance, fil d'Ariane des
 * requêtes, capture des rejets de promesse non gérés au niveau du processus).
 * Cette story ne les demande pas — elle demande qu'une erreur non gérée
 * *arrive*, avec une trace lisible.
 *
 * Ce fichier ne connaît ni `@repo/core`, ni le registre, ni la base. Il reçoit
 * un DSN et des collaborateurs injectés.
 */

const DEFAULT_TIMEOUT_MS = 3_000
const DEFAULT_MAX_ATTEMPTS = 2
const DEFAULT_BASE_DELAY_MS = 200
const DEFAULT_MAX_DELAY_MS = 2_000

/** Le nombre de cadres envoyés. Au-delà, la trace ne dit plus rien de neuf. */
const MAX_FRAMES = 50

export interface SentryMonitoringOptions {
  /** `https://<clé publique>@<hôte>/<projet>`. Jamais lu de l'environnement ici. */
  readonly dsn: string
  readonly timeoutMs?: number
  readonly maxAttempts?: number
  readonly baseDelayMs?: number
  readonly maxDelayMs?: number
  readonly log?: MonitoringLogger
  /** Injectés : sans cela ni le délai, ni le recul, ni l'identifiant ne sont testables. */
  readonly fetch?: typeof fetch
  readonly sleep?: (ms: number) => Promise<void>
  readonly random?: () => number
  readonly now?: () => Date
  readonly eventId?: () => string
}

export interface SentryDsn {
  readonly publicKey: string
  readonly ingestUrl: string
}

export class InvalidSentryDsnError extends Error {
  constructor(dsn: string) {
    super(
      `DSN Sentry illisible (${dsn.length} caractères) : la forme attendue est ` +
        'https://<clé publique>@<hôte>/<identifiant de projet>.',
    )
    this.name = 'InvalidSentryDsnError'
  }
}

/**
 * Le point d'ingestion, **dérivé du DSN** et jamais écrit à côté de lui.
 *
 * Le message d'erreur ne recopie pas le DSN : il en donne la longueur. Une
 * configuration fautive se diagnostique sans que la valeur atterrisse dans un
 * journal (`docs/security.md` §5).
 */
export function parseSentryDsn(dsn: string): SentryDsn {
  const match = /^(https?):\/\/([^@\s:]+)(?::[^@\s]*)?@([^/\s]+)\/(\d+)$/.exec(dsn.trim())

  if (match === null) {
    throw new InvalidSentryDsnError(dsn)
  }

  const [, protocol, publicKey, host, projectId] = match

  return {
    publicKey: publicKey ?? '',
    ingestUrl:
      `${protocol ?? 'https'}://${host ?? ''}/api/${projectId ?? ''}/envelope/` +
      `?sentry_key=${publicKey ?? ''}&sentry_version=7`,
  }
}

export interface StackFrame {
  readonly filename: string
  readonly function: string
  readonly lineno: number
  readonly colno: number
}

/**
 * **Ce qu'une trace a le droit de peser avant d'être lue**, et c'est la garde
 * qui survivra au prochain motif écrit ici.
 *
 * Une trace réelle tient largement dedans : les cadres les plus longs observés
 * dans ce dépôt — chemin `.next/server/chunks/…`, nom de fonction, ligne et
 * colonne — pèsent moins de deux cents caractères, et le fournisseur n'affiche
 * de toute façon que `MAX_FRAMES` cadres. Ce qui est refusé est donc ce
 * qu'aucun moteur JavaScript ne produit.
 *
 * Les deux plafonds sont exportés parce que `sentry-monitoring.test.ts` en
 * **dérive** ses cas : une valeur recopiée dans un test resterait verte après
 * qu'on l'ait desserrée ici.
 */
export const MAX_STACK_LINES = 100
export const MAX_STACK_LINE_LENGTH = 512

/**
 * Ramène une trace à ce qui peut raisonnablement en être lu — **avant** que
 * quoi que ce soit ne la parcoure.
 *
 * Appelée par `capture` **avant le filtrage des secrets**, et de nouveau par
 * `parseStackFrames`, qui est exportée et qu'un appelant peut donc joindre sans
 * passer par le premier. Ce n'est pas une redondance : c'est la seule façon que
 * la borne ne dépende pas de l'ordre dans lequel on la traverse.
 *
 * Une ligne trop longue est **jetée**, jamais tronquée : tronquée, elle
 * continuerait d'être analysée, et une troncature qui coupe au milieu d'un
 * `fichier:ligne:colonne` fabriquerait un cadre faux.
 *
 * Après elle, la longueur est **bornée par une multiplication** —
 * `MAX_STACK_LINES × (MAX_STACK_LINE_LENGTH + 1)` — et non par une espérance.
 */
export function boundStack(stack: string): string {
  const kept: string[] = []

  for (const line of stack.split('\n')) {
    if (kept.length === MAX_STACK_LINES) {
      break
    }

    kept.push(line.length > MAX_STACK_LINE_LENGTH ? '' : line)
  }

  return kept.join('\n')
}

/** Le préfixe d'un cadre. Un seul quantificateur, sur une classe qui ne mord sur rien d'autre. */
const FRAME_PREFIX = /^at\s+/

/** Une ligne ou une colonne. **Borné** : au-delà de dix chiffres, ce n'est plus une position. */
const POSITION = /^\d{1,10}$/

/**
 * Découpe une trace en cadres — **la moitié du critère 1 que le code tient**.
 *
 * Envoyer la trace en texte libre serait plus simple et ne servirait à rien : le
 * fournisseur ne symbolise que des cadres, si bien qu'une erreur arriverait
 * minifiée quelles que soient les cartes source envoyées au build. L'autre
 * moitié — que les cartes soient réellement **envoyées** — est le travail de
 * `scripts/source-maps.ts`.
 *
 * L'ordre est **inversé** : le fournisseur attend le cadre le plus ancien en
 * premier, alors qu'une trace JavaScript se lit du plus récent au plus ancien.
 * Une liste dans le mauvais sens affiche l'erreur à l'envers, ce qui se voit
 * tout de suite mais ne rougit nulle part.
 *
 * **Le découpage se fait par balayage de chaînes, pas par une expression sur la
 * ligne entière**, et c'est un correctif de sécurité, pas un goût. L'écriture
 * précédente — `/^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/` —
 * faisait concourir trois quantificateurs illimités sur les mêmes caractères
 * (`\s+` puis deux `.+?`), et CodeQL l'a signalée `js/polynomial-redos`. La
 * mesure, elle, était pire que « polynomiale » : `'at ' + '  '.repeat(2000)` —
 * **4 003 caractères** — coûtait **43,9 s** de processeur. Et l'entrée n'a rien
 * de théorique : `POST /analytics/client-error` est **publique**, laissée sans
 * session par cette story pour attraper les erreurs d'avant la connexion, et
 * son corps porte une trace de 20 000 caractères au choix de l'appelant. La
 * limitation de débit borne le **nombre** de requêtes, jamais le coût de l'une
 * d'elles.
 *
 * La technique retenue : **un préfixe ancré, puis des `indexOf` depuis la
 * droite**. `fichier:ligne:colonne` se lit sans ambiguïté par les deux derniers
 * deux-points — ce qui traite au passage les chemins qui en contiennent
 * (`https://hôte/f.js:1:2`, `C:\\dossier\\f.js:1:2`), là où une expression
 * gourmande devait revenir sur ses pas pour les trouver. Aucun quantificateur
 * illimité n'y concourt avec un autre : le coût est linéaire en la longueur de
 * la ligne, et la ligne est bornée.
 */
const parseFrame = (raw: string): StackFrame | null => {
  const line = raw.trim()
  const prefix = FRAME_PREFIX.exec(line)

  if (prefix === null) {
    return null
  }

  let rest = line.slice(prefix[0].length)
  let name = '<anonyme>'

  // `fonction (fichier:ligne:colonne)` — la forme de V8 dès qu'un nom existe.
  if (rest.endsWith(')')) {
    const open = rest.lastIndexOf(' (')

    if (open === -1) {
      rest = rest.slice(0, -1)
    } else {
      name = rest.slice(0, open)
      rest = rest.slice(open + 2, -1)
    }
  }

  const colonBeforeColumn = rest.lastIndexOf(':')
  const colonBeforeLine =
    colonBeforeColumn <= 0 ? -1 : rest.lastIndexOf(':', colonBeforeColumn - 1)

  if (colonBeforeLine <= 0) {
    return null
  }

  const lineno = rest.slice(colonBeforeLine + 1, colonBeforeColumn)
  const colno = rest.slice(colonBeforeColumn + 1)

  if (!POSITION.test(lineno) || !POSITION.test(colno)) {
    return null
  }

  return {
    filename: rest.slice(0, colonBeforeLine),
    function: name === '' ? '<anonyme>' : name,
    lineno: Number.parseInt(lineno, 10),
    colno: Number.parseInt(colno, 10),
  }
}

export function parseStackFrames(stack: string | null): readonly StackFrame[] {
  if (stack === null) {
    return []
  }

  const frames: StackFrame[] = []

  for (const line of boundStack(stack).split('\n')) {
    const frame = parseFrame(line)

    if (frame !== null) {
      frames.push(frame)
    }

    if (frames.length === MAX_FRAMES) {
      break
    }
  }

  return frames.reverse()
}

const codeOfStatus = (status: number): MonitoringErrorCode => {
  if (status === 401 || status === 403) {
    return 'unauthorized'
  }

  if (status === 429) {
    return 'rate_limited'
  }

  if (status === 400 || status === 413 || status === 422) {
    return 'invalid_event'
  }

  return 'provider_unavailable'
}

/**
 * Le classement transitoire / définitif, **lu par la politique de reprise** et
 * confronté par `tests/analytics.test.ts` à l'annotation que porte chaque code
 * de `MONITORING_ERROR_CODES`.
 */
export const isTransientMonitoringError = (code: MonitoringErrorCode): boolean => {
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
      throw new Error(`Code d’erreur de monitoring non classé : ${String(unhandled)}`)
    }
  }
}

const sanitize = (message: string, publicKey: string): string => {
  const withoutKey = publicKey === '' ? message : message.replaceAll(publicKey, '[clé]')
  const redacted = redactSecretsInText(withoutKey).replaceAll(/https?:\/\/\S+/g, '[url]')

  return redacted.length <= 300 ? redacted : `${redacted.slice(0, 299)}…`
}

const failure = (code: MonitoringErrorCode, message: string): MonitoringError => ({ code, message })

const randomEventId = (): string =>
  Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')

/**
 * L'implémentation. Elle **ne lève jamais** : elle est appelée depuis un
 * gestionnaire d'erreur, où lever remplacerait l'erreur d'origine par la nôtre.
 */
export function createSentryMonitoring(options: SentryMonitoringOptions): Monitoring {
  const {
    dsn,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    log,
    fetch: fetchImpl = globalThis.fetch,
    sleep = async (ms: number) => await new Promise((resolve) => setTimeout(resolve, ms)),
    random = Math.random,
    now = () => new Date(),
    eventId = randomEventId,
  } = options

  const { publicKey, ingestUrl } = parseSentryDsn(dsn)

  const postOnce = async (body: string, id: string): Promise<CaptureResult> => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    try {
      const response = await fetchImpl(ingestUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-sentry-envelope' },
        body,
        signal: controller.signal,
      })

      if (response.ok) {
        return { ok: true, id }
      }

      const text = await response.text().catch(() => '')

      return {
        ok: false,
        error: failure(
          codeOfStatus(response.status),
          sanitize(`${String(response.status)} ${text}`.trim(), publicKey),
        ),
      }
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError'

      return {
        ok: false,
        error: failure(
          aborted ? 'timeout' : 'provider_unavailable',
          sanitize(error instanceof Error ? error.message : 'appel impossible', publicKey),
        ),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    capture: async (event: MonitoringEvent): Promise<CaptureResult> => {
      // **Le filtrage passe avant la mise en forme de l'enveloppe** : rien de ce
      // qui a été retiré ne peut réapparaître par un champ recopié plus bas.
      const { values: context, redacted } = redactRecord(event.context)
      const message = redactSecretsInText(event.message)
      // **Bornée avant d'être filtrée**, et l'ordre est le correctif : le
      // filtrage des secrets parcourt lui aussi la trace, et il est le prochain
      // motif qu'une trace démesurée ferait payer cher.
      const stack = event.stack === null ? null : redactSecretsInText(boundStack(event.stack))
      const id = eventId()
      const sentAt = now().toISOString()

      const envelope = [
        JSON.stringify({ event_id: id, sent_at: sentAt }),
        JSON.stringify({ type: 'event' }),
        JSON.stringify({
          event_id: id,
          timestamp: sentAt,
          platform: 'javascript',
          level: 'error',
          release: event.release,
          tags: { origin: event.origin },
          extra: context,
          exception: {
            values: [
              {
                type: event.type,
                value: message,
                stacktrace: { frames: parseStackFrames(stack) },
              },
            ],
          },
        }),
      ].join('\n')

      let last: CaptureResult = {
        ok: false,
        error: failure('provider_unavailable', 'aucune tentative'),
      }

      for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
        last = await postOnce(envelope, id)

        if (last.ok) {
          log?.({
            event: 'monitoring.sent',
            origin: event.origin,
            type: event.type,
            code: null,
            message: null,
            redacted,
          })

          return last
        }

        if (!isTransientMonitoringError(last.error.code) || attempt === maxAttempts) {
          break
        }

        const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))

        await sleep(Math.round(exponential / 2 + random() * (exponential / 2)))
      }

      if (!last.ok) {
        log?.({
          event: 'monitoring.failed',
          origin: event.origin,
          type: event.type,
          code: last.error.code,
          message: last.error.message,
          redacted,
        })
      }

      return last
    },
  }
}
