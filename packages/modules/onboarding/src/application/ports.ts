import type { OnboardingProgress } from '../domain/onboarding'

/**
 * Ce que le module a besoin de faire de sa **seule** table.
 *
 * Une interface, pas une classe : `infrastructure` en fournit l'implémentation
 * Drizzle, et rien de cette couche-ci ne connaît l'ORM (ADR 006).
 */
export interface OnboardingProgressRepository {
  /** La progression d'un compte, ou `null` s'il n'a jamais rien franchi. */
  readonly find: (userId: string) => Promise<OnboardingProgress | null>
  /**
   * Écrit la progression du compte. **Rejouable** : une seconde écriture des
   * mêmes valeurs ne produit aucune ligne de plus (`docs/reliability.md` §1).
   */
  readonly save: (userId: string, progress: OnboardingProgress) => Promise<void>
  /** Efface la progression du compte. C'est la purge du module (RGPD). */
  readonly erase: (userId: string) => Promise<void>
}
