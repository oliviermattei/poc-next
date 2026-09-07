import type { FeedbackUseCases } from './feedback-use-cases'
import type { BackOfficeAuthorizer } from './ports'

/**
 * Le service du module, tel que `presentation/` le voit.
 *
 * Il est déclaré **ici**, dans `application`, et non à côté de sa construction :
 * une route qui importerait `infrastructure/` traverserait la frontière que
 * l'ADR 006 refuse, et `pnpm lint` la refuse aussi. C'est le patron des modules
 * `auth` et `admin` (`application/<module>-service.ts`).
 */
export interface FeedbackService {
  readonly useCases: FeedbackUseCases
  /**
   * **La garde du back-office**, écrite une seule fois dans le dépôt (les cas
   * d'usage de `admin`) et injectée ici par le point de composition.
   *
   * Elle est portée par le service et non par la déclaration des routes parce
   * que `module.ts` est chargé par `config/features.ts`, donc par
   * `pnpm ks list` et `pnpm db:generate`, qui n'ont ni base ni back-office.
   */
  readonly authorizeBackOffice: BackOfficeAuthorizer
}

/** Ce que le module n'est pas encore : un service configuré. */
export class FeedbackNotConfiguredError extends Error {
  constructor() {
    super(
      'Le module « feedback » n’est pas configuré : le point de composition ' +
        'de l’application doit appeler provideFeedback() avant de servir une requête.',
    )
    this.name = 'FeedbackNotConfiguredError'
  }
}
