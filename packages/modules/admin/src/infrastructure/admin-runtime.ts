import { AdminNotConfiguredError, type AdminService } from '../application/admin-service'
import { createAdminUseCases } from '../application/admin-use-cases'
import type { AdminAccountsPort } from '../application/ports'
import type { AdminSecurityLog } from '../domain/security-event'
import { consoleSecurityLog } from './console-security-log'
import {
  createDrizzlePlatformRoleRepository,
  type AdminDatabase,
} from './drizzle-platform-role-repository'

/**
 * Le service du module, **construit à la première requête servie**, pas à
 * l'import.
 *
 * `config/features.ts` charge le contrat du module, et ce fichier est lu par
 * `pnpm ks list` comme par `pnpm db:generate`, qui n'ont pas de base. Les
 * routes reçoivent donc un accès **différé** au service, posé par le point de
 * composition de l'application — c'est le patron de `auth` et de
 * `organizations`, et une route appelée avant cette configuration échoue en le
 * disant plutôt que de servir à moitié.
 */

export interface ConfigureAdminOptions {
  /** Connexion Drizzle, fournie par le point de composition (jamais lue ici). */
  readonly db: AdminDatabase
  /**
   * Ce que le module sait des comptes — **fourni**, jamais lu dans les tables
   * de `auth` : le module ne connaît que ce port (`application/ports.ts`).
   */
  readonly accounts: AdminAccountsPort
  /**
   * L'adresse du **premier** superadmin, ou `null`.
   *
   * Le module ne lit aucune variable d'environnement (`docs/security.md` §5) :
   * il reçoit la réponse du seul fichier qui a le droit de la lire.
   */
  readonly designatedEmail: string | null
  /** Le journal des événements de sécurité. Par défaut, la sortie standard. */
  readonly securityLog?: AdminSecurityLog
  /** L'horloge, injectable : une date non injectée est une date non testable. */
  readonly now?: () => Date
}

let service: AdminService | null = null
let provider: (() => ConfigureAdminOptions) | null = null

const build = (options: ConfigureAdminOptions): AdminService => ({
  useCases: createAdminUseCases({
    roles: createDrizzlePlatformRoleRepository(options.db, options.accounts),
    accounts: options.accounts,
    designatedEmail: options.designatedEmail,
    securityLog: options.securityLog ?? consoleSecurityLog,
    now: options.now ?? (() => new Date()),
  }),
})

/** Construit le service **maintenant**. C'est la forme qu'une suite de tests emploie. */
export function configureAdmin(options: ConfigureAdminOptions): AdminService {
  service = build(options)

  return service
}

/**
 * Dit **comment** construire le service, sans le construire.
 *
 * C'est la forme que le point de composition de l'application emploie, et la
 * différence n'est pas cosmétique : le répartiteur prépare les services à
 * **chaque** requête, y compris celles qu'aucune route ne satisfait.
 * Construire aussitôt ouvrirait une connexion à la base pour répondre 404 sur
 * un chemin inconnu — mesuré en s15, `tests/module-off.test.ts` échouait sur
 * exactement ce cas.
 */
export function provideAdmin(factory: () => ConfigureAdminOptions): void {
  provider = factory
}

export function requireAdminService(): AdminService {
  if (service !== null) {
    return service
  }

  if (provider === null) {
    throw new AdminNotConfiguredError()
  }

  service = build(provider())

  return service
}

/** Remet le module à son état non configuré. Réservé aux suites de tests. */
export function resetAdminService(): void {
  service = null
  provider = null
}
