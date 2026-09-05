import type { AdminUseCases } from './admin-use-cases'

/**
 * Le service du module, tel que `presentation/` le voit.
 *
 * Il est déclaré **ici**, dans `application`, et non à côté de sa construction :
 * une route qui importerait `infrastructure/` traverserait la frontière que
 * l'ADR 006 refuse, et `pnpm lint` la refuse aussi. C'est le patron du module
 * `auth` (`application/auth-service.ts`).
 */
export interface AdminService {
  readonly useCases: AdminUseCases
}

/** Ce que le module n'est pas encore : un service configuré. */
export class AdminNotConfiguredError extends Error {
  constructor() {
    super(
      'Le module « admin » n’est pas configuré : le point de composition de ' +
        'l’application doit appeler provideAdmin() avant de servir une requête.',
    )
    this.name = 'AdminNotConfiguredError'
  }
}
