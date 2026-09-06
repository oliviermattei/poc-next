import {
  clearanceOf,
  courseOf,
  EMPTY_PROGRESS,
  progressAfter,
  type ClearIntent,
  type ClearRefusal,
  type OnboardingCourse,
  type OnboardingStep,
} from '../domain/onboarding'
import type { OnboardingProgressRepository } from './ports'

/**
 * Les cas d'usage du parcours : **lire** ce qu'il reste à faire, et **franchir**
 * une étape.
 *
 * Les étapes ne sont pas construites ici : elles sont **reçues**, par une
 * fonction que le point de composition de l'application fournit
 * (`stepsOf`). C'est la même forme que `readableScopes` pour `storage` et
 * `scopeOf` pour `notifications`, et c'est ce qui interdit à ce module de
 * connaître le nom d'un autre.
 */
export interface OnboardingUseCases {
  /** Le parcours d'un compte, tel que l'écran le lit. */
  readonly course: (userId: string) => Promise<OnboardingCourse>
  /**
   * **Le parcours reste-t-il à proposer ?** — la seule question que pose la
   * racine, à chaque rendu d'un compte connecté.
   *
   * Elle lit la progression **d'abord** : la porte à sens unique tranche sans
   * dériver aucune étape, si bien qu'un compte qui a terminé son parcours ne
   * paie plus ni la lecture de son nom, ni celle de ses appartenances, ni celle
   * de ses droits — sur le chemin le plus chaud du produit.
   */
  readonly proposed: (userId: string) => Promise<boolean>
  /**
   * Franchit une étape, ou refuse en la nommant.
   *
   * Rend le parcours **après** l'écriture : l'appelant n'a pas à relire pour
   * savoir où il en est.
   */
  readonly clear: (input: {
    readonly userId: string
    readonly stepId: string
    readonly intent: ClearIntent
  }) => Promise<
    | { readonly ok: true; readonly course: OnboardingCourse }
    | { readonly ok: false; readonly refusal: ClearRefusal }
  >
  /** Efface la progression d'un compte (RGPD, ADR 029). */
  readonly purgeUser: (userId: string) => Promise<void>
  /** Rend la progression d'un compte (RGPD, ADR 029). */
  readonly exportUser: (userId: string) => Promise<Readonly<Record<string, unknown>>>
}

export function createOnboardingUseCases(dependencies: {
  readonly progress: OnboardingProgressRepository
  /**
   * Les étapes proposées à ce compte, **dérivées** par l'application des
   * modules montés et de la donnée réelle. Le module ne les invente jamais.
   */
  readonly stepsOf: (userId: string) => Promise<readonly OnboardingStep[]>
  readonly now: () => Date
}): OnboardingUseCases {
  const { progress, stepsOf, now } = dependencies

  const read = async (userId: string) => (await progress.find(userId)) ?? EMPTY_PROGRESS

  return {
    course: async (userId) => courseOf(await stepsOf(userId), await read(userId)),

    proposed: async (userId) => {
      const progress = await read(userId)

      // La porte d'abord : terminé, c'est terminé, et rien d'autre n'est lu.
      if (progress.completedAt !== null) {
        return false
      }

      return courseOf(await stepsOf(userId), progress).proposed
    },

    clear: async ({ userId, stepId, intent }) => {
      const steps = await stepsOf(userId)
      const refusal = clearanceOf(
        steps.find((step) => step.id === stepId),
        intent,
      )

      if (refusal !== null) {
        // **Le refus n'écrit rien.** Une garde qui refuse puis persiste quand
        // même laisserait franchie une étape obligatoire jamais remplie.
        return { ok: false, refusal }
      }

      const written = progressAfter(steps, await read(userId), stepId, now())

      await progress.save(userId, written)

      return { ok: true, course: courseOf(steps, written) }
    },

    purgeUser: async (userId) => {
      await progress.erase(userId)
    },

    exportUser: async (userId) => ({ progress: await progress.find(userId) }),
  }
}
