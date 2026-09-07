import type { FeedbackCategory, FeedbackStatus } from '../domain/feedback'

/**
 * Les **ports** du module (ADR 006) : ce dont les cas d'usage ont besoin, dit
 * par eux, sans savoir qui l'implémente.
 *
 * **Aucun ne lève** (`AGENTS.md` racine) : chacun rend un résultat discriminé,
 * si bien que le compilateur oblige l'appelant à traiter l'échec au lieu de
 * retomber sur un 500.
 */

/** Un retour, tel que le dépôt le rend. */
export interface FeedbackRecord {
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

/** Ce qu'une écriture rend : le résultat, jamais une exception. */
export type FeedbackWriteResult<TValue> =
  | ({ readonly ok: true } & TValue)
  | { readonly ok: false }

export interface FeedbackRepository {
  record(input: {
    readonly id: string
    readonly authorId: string
    readonly organizationId: string | null
    readonly category: FeedbackCategory
    readonly message: string
    readonly originPath: string | null
    readonly at: Date
  }): Promise<FeedbackWriteResult<{ readonly feedback: FeedbackRecord }>>
  /**
   * Une page de retours, **filtrée au plus bas**.
   *
   * `category`, `status` et `search` descendent jusqu'à la requête : tamiser
   * une page déjà lue rendrait un décompte et une pagination qui ne
   * correspondent pas à ce qui est affiché — la leçon que `s37c` a payée.
   */
  list(input: {
    readonly category: string | null
    readonly status: string | null
    readonly search: string | null
    readonly limit: number
    readonly offset: number
  }): Promise<
    | { readonly ok: true; readonly feedback: readonly FeedbackRecord[]; readonly total: number }
    | { readonly ok: false }
  >
  /**
   * Marque un retour comme traité (critère 5).
   *
   * `handled: false` quand il l'était déjà ou qu'il n'existe pas : la condition
   * est dans l'écriture, et le rejeu ne produit aucun effet supplémentaire
   * (`docs/reliability.md` §1).
   */
  markHandled(input: {
    readonly id: string
    readonly at: Date
  }): Promise<FeedbackWriteResult<{ readonly handled: boolean }>>
  /** Les retours d'un compte — ce que son export rend (s35). */
  ofAuthor(authorId: string): Promise<readonly FeedbackRecord[]>
  /** Efface les retours d'un compte — ce que sa purge fait (s34). Rend le compte de lignes. */
  eraseAuthor(authorId: string): Promise<number>
  /** Efface les retours d'un périmètre d'organisation. */
  eraseOrganization(organizationId: string): Promise<number>
}

/**
 * **La notification d'un nouveau retour** (critère 3), reçue du point de
 * composition.
 *
 * Le module ne connaît ni le centre de notifications, ni les superadmins, ni le
 * mailer : il **nomme l'événement qu'il possède**, et ce qui en est fait se
 * décide dans l'émission unique de l'application (`apps/web/lib/notifications.ts`),
 * qui replie déjà sur un envoi email direct quand le module `notifications` est
 * coupé. C'est la forme que `organizations` emploie depuis s32.
 *
 * Elle ne rend rien : un retour est **écrit** avant d'être annoncé, et une
 * annonce en échec ne doit pas perdre le message de l'utilisateur.
 */
export type FeedbackAnnouncer = (input: {
  readonly feedbackId: string
  readonly category: FeedbackCategory
}) => Promise<void>

/**
 * **L'organisation qu'un compte a sous les yeux** (critère 2), reçue du point
 * de composition.
 *
 * Le module ne connaît pas `organizations` — il ne le requiert pas, et le
 * produit doit rester utilisable en mode mono-utilisateur. Ce module coupé, la
 * réponse est `null` **sans toucher la base**, et aucune condition n'est écrite
 * ici : c'est la forme que `notifications` emploie depuis s32 pour son périmètre
 * de lecture.
 */
export type ActiveOrganizationResolver = (userId: string) => Promise<string | null>

/**
 * **La garde du back-office, reçue du point de composition** (critère 5).
 *
 * Elle est écrite **une seule fois** dans le dépôt, dans les cas d'usage du
 * module `admin` (`authorizeBackOffice`) : elle refuse une session **empruntée**
 * avant de juger le rôle, relit le rôle en base à chaque requête, et journalise
 * le refus. Ce module ne saurait pas la réécrire — il ne connaît ni le rôle de
 * plateforme, ni l'emprunt de session — et il n'a pas à le faire : deux copies
 * de cette règle divergeraient, et la seconde serait celle qui laisse entrer.
 *
 * Le point de composition la **ferme par défaut** : sans back-office monté,
 * elle refuse.
 */
export type BackOfficeAuthorizer = (input: {
  readonly request: Request
  readonly userId: string
}) => Promise<boolean>
