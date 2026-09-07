import {
  parseFeedbackSubmission,
  type FeedbackCategory,
  type FeedbackStatus,
} from '../domain/feedback'
import type {
  ActiveOrganizationResolver,
  FeedbackAnnouncer,
  FeedbackRecord,
  FeedbackRepository,
} from './ports'

/**
 * Les cas d'usage du module (s43) — la couche qui **orchestre**, sans règle
 * métier à elle : celles-ci vivent dans le `domain`.
 */

export type SubmitFeedbackOutcome =
  | { readonly ok: true; readonly feedbackId: string }
  | { readonly ok: false; readonly error: 'invalid_request'; readonly field: string }
  | { readonly ok: false; readonly error: 'unavailable'; readonly field?: undefined }

/** Une ligne telle que le back-office la lit. */
export interface FeedbackListEntry {
  readonly id: string
  readonly authorId: string
  readonly organizationId: string | null
  readonly category: FeedbackCategory
  readonly message: string
  readonly originPath: string | null
  readonly status: FeedbackStatus
  readonly createdAt: Date
  readonly handledAt: Date | null
}

export interface FeedbackUseCases {
  /**
   * **Envoyer un retour** (critères 1 à 3).
   *
   * L'ordre est celui de `contact_message` (s11, constat F8) : la ligne est
   * **écrite d'abord**, annoncée ensuite. Une annonce en échec ne doit pas
   * perdre le message de l'utilisateur — ce qui reste alors est une ligne dans
   * le back-office, c'est-à-dire exactement ce que le critère 4 sert.
   */
  submit(input: {
    readonly authorId: string
    readonly body: unknown
  }): Promise<SubmitFeedbackOutcome>
  /** Une page de retours pour le back-office, filtrée au plus bas. */
  list(input: {
    readonly category: string | null
    readonly status: string | null
    readonly search: string | null
    readonly limit: number
    readonly offset: number
  }): Promise<
    | { readonly ok: true; readonly feedback: readonly FeedbackListEntry[]; readonly total: number }
    | { readonly ok: false }
  >
  /** Marque un retour comme traité (critère 5). Rejouable, sans effet supplémentaire. */
  markHandled(id: string): Promise<{ readonly ok: true; readonly handled: boolean } | { readonly ok: false }>
  /** Les retours d'un compte, pour son export (s35). */
  ofAuthor(authorId: string): Promise<readonly FeedbackRecord[]>
  /** Efface les retours d'un compte (s34). */
  eraseAuthor(authorId: string): Promise<number>
  eraseOrganization(organizationId: string): Promise<number>
}

export function createFeedbackUseCases(dependencies: {
  readonly repository: FeedbackRepository
  readonly announce: FeedbackAnnouncer
  readonly activeOrganizationOf: ActiveOrganizationResolver
  readonly now: () => Date
  readonly generateId: () => string
  readonly runInBackground: (task: Promise<unknown>) => void
}): FeedbackUseCases {
  const { repository, announce, activeOrganizationOf, now, generateId, runInBackground } =
    dependencies

  return {
    submit: async ({ authorId, body }) => {
      // **La frontière est le `domain`**, pas la route : la même fonction lit un
      // corps de formulaire natif et un corps JSON.
      const parsed = parseFeedbackSubmission(body)

      if (!parsed.ok) {
        return { ok: false, error: 'invalid_request', field: parsed.field }
      }

      const written = await repository.record({
        id: generateId(),
        authorId,
        organizationId: await activeOrganizationOf(authorId),
        category: parsed.value.category,
        message: parsed.value.message,
        originPath: parsed.value.originPath,
        at: now(),
      })

      if (!written.ok) {
        return { ok: false, error: 'unavailable' }
      }

      // **Annoncé après l'écriture, et hors du chemin de la réponse** : une
      // notification lente ne doit pas tenir la personne devant son formulaire,
      // et son échec ne doit pas perdre un message déjà écrit.
      runInBackground(
        announce({ feedbackId: written.feedback.id, category: written.feedback.category }),
      )

      return { ok: true, feedbackId: written.feedback.id }
    },
    list: async (input) => await repository.list(input),
    markHandled: async (id) => {
      const written = await repository.markHandled({ id, at: now() })

      return written.ok ? { ok: true, handled: written.handled } : { ok: false }
    },
    ofAuthor: async (authorId) => await repository.ofAuthor(authorId),
    eraseAuthor: async (authorId) => await repository.eraseAuthor(authorId),
    eraseOrganization: async (organizationId) =>
      await repository.eraseOrganization(organizationId),
  }
}
