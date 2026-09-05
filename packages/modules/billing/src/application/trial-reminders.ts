import { JobFailure } from '@repo/core'

import {
  TRIAL_REMINDER_LEAD_DAYS,
  trialReminderWindow,
  trialsToRemind,
} from '../domain/trial-reminder'
import type { BillingRepository, EndingTrial } from './ports'

/**
 * **La relance d'essai, comme cas d'usage** (critère 7 de s33).
 *
 * Le module dit *qui* relancer ; il ne sait pas *comment*. La livraison est une
 * fonction **injectée** par le point de composition de l'application, qui seule
 * connaît le canal — email, notification in-app, les deux selon les préférences
 * du compte. `billing` ne déclare `requires: []` (ADR 034) et ne doit connaître
 * ni `auth`, ni `organizations`, ni `notifications`.
 */

/** Ce que la relance reçoit d'un essai qui se termine. */
export type TrialReminder = (trial: EndingTrial) => Promise<void>

export interface RemindEndingTrialsInput {
  readonly repository: BillingRepository
  readonly remind: TrialReminder | null
  readonly now: Date
  readonly leadDays?: number
}

/**
 * Relance les essais qui se terminent dans `leadDays` jours, et rend combien.
 *
 * **Sans fonction de livraison, la tâche échoue définitivement en la nommant.**
 * Ce n'est pas du zèle : un point de composition qui l'oublie ne casse rien de
 * visible — la tâche tournerait vert tous les jours sans relancer personne, et
 * la perte se mesurerait en essais non convertis, jamais dans un journal. Le
 * défaut est le même que celui de `provideNotifications` oublié en s32, mais
 * silencieux au lieu d'être un 500.
 */
export async function remindEndingTrials(input: RemindEndingTrialsInput): Promise<number> {
  const leadDays = input.leadDays ?? TRIAL_REMINDER_LEAD_DAYS

  if (input.remind === null) {
    throw new JobFailure(
      'invalid_event',
      'Aucune livraison de relance d’essai n’est fournie : le point de composition de ' +
        'l’application doit passer « remindTrialEnding » à provideBilling(). Sans elle, la ' +
        'tâche tournerait au vert sans relancer personne.',
    )
  }

  const window = trialReminderWindow(input.now, leadDays)
  const candidates = await input.repository.trialsEndingBetween(window)
  // La lecture borne, la règle décide : les deux dérivent du même calcul, mais
  // c'est la règle qui a le dernier mot — une fenêtre plus large que la règle
  // relancerait deux fois.
  const due = trialsToRemind(candidates, input.now, leadDays)

  for (const trial of due) {
    await input.remind(trial)
  }

  return due.length
}
