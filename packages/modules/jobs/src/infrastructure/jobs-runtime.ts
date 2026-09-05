/**
 * Le service du module, **construit à la première requête**, pas à l'import.
 *
 * `config/features.ts` charge le contrat du module, et ce fichier est lu par
 * `pnpm ks list` comme par `pnpm db:generate`, qui n'ont ni base ni fournisseur.
 * La route de rappel reçoit donc un accès **différé** au gestionnaire, posé par
 * le point de composition de l'application (`apps/web/lib/jobs.ts`). C'est le
 * patron de `auth`, `organizations`, `marketing`, `storage` et `notifications`,
 * repris à l'identique.
 */

import type { JobsDatabase } from './drizzle-job-ledger'

export interface ConfigureJobsOptions {
  /**
   * Le gestionnaire de rappel du fournisseur — construit par l'application, qui
   * est seule à connaître Inngest, le registre et la base.
   *
   * `null` quand aucun fournisseur n'est monté : l'exécuteur local n'a pas de
   * rappel à servir, et la route répond alors **404**, comme celle d'un module
   * coupé. Une route montée qui répondrait 500 dirait au monde qu'un
   * ordonnanceur existe ici.
   */
  readonly callback: ((request: Request) => Promise<Response>) | null
  /**
   * La connexion, **reçue** du point de composition (ADR 020).
   *
   * Elle est là pour la seule tâche que ce module déclare : le balayage de son
   * propre registre d'exécutions. Le module ne construit rien — une connexion
   * ouverte à l'import s'ouvrirait pour `pnpm ks list` et `pnpm db:generate`,
   * qui n'en ont pas.
   */
  readonly db: JobsDatabase
}

export class JobsNotConfiguredError extends Error {
  constructor() {
    super(
      'Le module « jobs » n’est pas configuré : le point de composition de l’application ' +
        'doit appeler provideJobs() avant de servir une requête.',
    )
    this.name = 'JobsNotConfiguredError'
  }
}

let provider: (() => ConfigureJobsOptions) | null = null
let configured: ConfigureJobsOptions | null = null

/** Dit **comment** construire le service, sans le construire. */
export function provideJobs(factory: () => ConfigureJobsOptions): void {
  provider = factory
  configured = null
}

const require_ = (): ConfigureJobsOptions => {
  if (configured !== null) {
    return configured
  }

  if (provider === null) {
    throw new JobsNotConfiguredError()
  }

  configured = provider()

  return configured
}

export function requireJobsCallback(): ((request: Request) => Promise<Response>) | null {
  return require_().callback
}

/** La connexion du module, pour sa seule tâche planifiée. */
export function requireJobsDatabase(): JobsDatabase {
  return require_().db
}

/** Remet le module à son état non configuré. Réservé aux suites de tests. */
export function resetJobsRuntime(): void {
  provider = null
  configured = null
}
