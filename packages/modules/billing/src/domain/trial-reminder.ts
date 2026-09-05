import type { SubscriptionStatus } from './subscription'

/**
 * **La relance d'essai** (critère 7 de s33) — la règle, pure, et rien d'autre.
 *
 * `trialEnd` existait partout depuis s21 — schéma, port, cas d'usage — et
 * **rien ne le lisait pour agir** : il n'y avait pas de déclencheur. Ce fichier
 * dit *qui* relancer et *quand* ; le module dit *comment* le déclencher (une
 * tâche planifiée), et l'application dit *par quel canal*.
 */

/**
 * Combien de jours avant la fin de l'essai la relance part.
 *
 * Trois : assez tôt pour qu'un moyen de paiement puisse être ajouté sans
 * urgence, assez tard pour que le produit ait été essayé. C'est une valeur de
 * produit ; elle est ici, une fois, plutôt que dans le corps de la tâche.
 */
export const TRIAL_REMINDER_LEAD_DAYS = 3

/** Le jour calendaire d'un instant, en UTC — la granularité de la règle. */
export const utcDayOf = (date: Date): string => date.toISOString().slice(0, 10)

/**
 * La fenêtre à lire en base : le jour visé, du premier au dernier instant.
 *
 * Elle est **dérivée** du même calcul que la règle, jamais écrite deux fois :
 * une lecture plus large que la règle enverrait la relance en boucle, une
 * lecture plus étroite la ferait manquer.
 */
export function trialReminderWindow(
  now: Date,
  leadDays: number = TRIAL_REMINDER_LEAD_DAYS,
): { readonly from: Date; readonly to: Date } {
  const target = new Date(now.getTime() + leadDays * 24 * 60 * 60 * 1_000)
  const day = utcDayOf(target)

  return { from: new Date(`${day}T00:00:00.000Z`), to: new Date(`${day}T23:59:59.999Z`) }
}

/**
 * Les abonnements à relancer à cet instant.
 *
 * **Le jour visé est exact, pas « dans les trois jours »**, et c'est ce qui rend
 * la relance non répétitive sans stocker quoi que ce soit : une tâche
 * quotidienne ne trouve un abonnement donné qu'un seul jour de sa vie. Une règle
 * « il reste au plus trois jours » l'aurait trouvé trois fois, et il aurait
 * fallu une colonne « déjà relancé » — c'est-à-dire une migration pour tenir ce
 * qu'un calcul tient.
 *
 * Le registre d'exécutions du répartiteur reste la **seconde** ceinture : il
 * garantit qu'une même échéance rejouée ne relance pas deux fois.
 */
export function trialsToRemind<
  T extends { readonly status: SubscriptionStatus; readonly trialEnd: Date | null },
>(subscriptions: readonly T[], now: Date, leadDays: number = TRIAL_REMINDER_LEAD_DAYS): readonly T[] {
  const target = utcDayOf(new Date(now.getTime() + leadDays * 24 * 60 * 60 * 1_000))

  return subscriptions.filter(
    (subscription) =>
      subscription.status === 'trialing' &&
      subscription.trialEnd !== null &&
      utcDayOf(subscription.trialEnd) === target,
  )
}
