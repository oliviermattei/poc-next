import { randomUUID } from 'node:crypto'

import {
  FeedbackNotConfiguredError,
  type FeedbackService,
} from '../application/feedback-service'
import { createFeedbackUseCases } from '../application/feedback-use-cases'
import type {
  ActiveOrganizationResolver,
  BackOfficeAuthorizer,
  FeedbackAnnouncer,
} from '../application/ports'
import { createDrizzleFeedback, type FeedbackDatabase } from './drizzle-feedback'

/**
 * Le service du module, **construit à la première requête**, pas à l'import.
 *
 * `config/features.ts` charge le contrat du module, et ce fichier est lu par
 * `pnpm ks list` comme par `pnpm db:generate`, qui n'ont pas de base. Les routes
 * reçoivent donc un accès **différé** au service, posé par le point de
 * composition de l'application (`apps/web/lib/feedback.ts`). C'est le patron de
 * `auth`, `marketing`, `organizations` et `notifications`, repris à l'identique
 * — y compris la distinction entre `configureFeedback` (construit maintenant :
 * ce qu'une suite de tests emploie) et `provideFeedback` (dit **comment**
 * construire : ce que l'application emploie, pour qu'aucune connexion ne
 * s'ouvre au seul fait qu'une requête a atteint le répartiteur).
 */
export interface ConfigureFeedbackOptions {
  /** Connexion Drizzle, fournie par le point de composition (jamais lue ici). */
  readonly db: FeedbackDatabase
  /** L'annonce d'un nouveau retour (critère 3), résolue par l'application. */
  readonly announce: FeedbackAnnouncer
  /** L'organisation active d'un compte (critère 2), résolue par l'application. */
  readonly activeOrganizationOf: ActiveOrganizationResolver
  /**
   * **La garde du back-office** (critère 5), reçue du point de composition.
   *
   * Elle est portée par le **service** et non par la déclaration des routes,
   * pour la raison qui y porte déjà `activeOrganizationOf` : `module.ts` est
   * chargé par `config/features.ts`, donc par `pnpm ks list` et
   * `pnpm db:generate`, qui n'ont ni base ni back-office. Une garde câblée à
   * l'import serait une garde que ces commandes devraient fournir.
   */
  readonly authorizeBackOffice: BackOfficeAuthorizer
  readonly now?: () => Date
  readonly generateId?: () => string
  readonly runInBackground?: (task: Promise<unknown>) => void
}

let service: FeedbackService | null = null
let provider: (() => ConfigureFeedbackOptions) | null = null

const build = (options: ConfigureFeedbackOptions): FeedbackService => ({
  authorizeBackOffice: options.authorizeBackOffice,
  useCases: createFeedbackUseCases({
    repository: createDrizzleFeedback(options.db),
    announce: options.announce,
    activeOrganizationOf: options.activeOrganizationOf,
    now: options.now ?? (() => new Date()),
    generateId: options.generateId ?? (() => randomUUID()),
    runInBackground:
      options.runInBackground ??
      ((task: Promise<unknown>) => {
        // L'échec est déjà journalisé par l'émission ; ce `catch` n'est là que
        // pour ne pas laisser un rejet non traité tomber le processus, faute
        // d'appelant pour l'attendre.
        void task.catch(() => {})
      }),
  }),
})

/** Construit le service **maintenant**. C'est la forme qu'une suite de tests emploie. */
export function configureFeedback(options: ConfigureFeedbackOptions): FeedbackService {
  service = build(options)

  return service
}

/**
 * Dit **comment** construire le service, sans le construire.
 *
 * Le répartiteur de modules prépare les services à **chaque** requête, y
 * compris celles qu'aucune route ne satisfait : construire aussitôt ouvrirait
 * une connexion à la base pour répondre 404 sur un chemin inconnu.
 */
export function provideFeedback(factory: () => ConfigureFeedbackOptions): void {
  provider = factory
}

export function requireFeedbackService(): FeedbackService {
  if (service !== null) {
    return service
  }

  if (provider === null) {
    throw new FeedbackNotConfiguredError()
  }

  service = build(provider())

  return service
}

/** Remet le module à son état non configuré. Réservé aux suites de tests. */
export function resetFeedbackService(): void {
  service = null
  provider = null
}
