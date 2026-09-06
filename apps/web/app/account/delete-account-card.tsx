'use client'

import { Alert, AlertDescription, AlertTitle, Button, Input, Label } from '@repo/ui'
import { useTranslations } from 'next-intl'
import { useState, type FormEvent } from 'react'

import { useHydrated } from '../use-hydrated'
import {
  deletionOutcomeOf,
  deletionRefusalKey,
  type DeletionOutcome,
  type DeletionRefusalOutcome,
} from './rgpd-outcomes'

/**
 * **La zone dangereuse de l'écran de compte** (s34b, critères 1 et 2).
 *
 * L'écran **ne décide de rien**. Il demande l'adresse, la poste telle qu'elle
 * est saisie, et rend le refus que le serveur renvoie. La comparaison vit dans
 * le `domain` du module `auth` (`confirmsAccount`), avec la mutation de s34 qui
 * rougit si on la déplace : un bouton qui ne s'activerait qu'à la bonne saisie
 * n'est pas une confirmation, c'est une décoration que `curl` contourne
 * (`docs/security.md` §3).
 *
 * **`method="post"` en littéral écrit** : sans lui, le repli du navigateur
 * avant hydratation est un `GET` vers l'URL courante, et l'adresse saisie part
 * dans la chaîne de requête — mesuré en s08, `docs/security.md` §5, refusé par
 * `pnpm lint`.
 *
 * Composée exclusivement du design system : `Card` (posée par l'écran),
 * `Alert`, `Input`, `Label`, `Button` en variante `destructive`. Le
 * `ConfirmDialog` que `docs/design-system.md` inventorie n'existe pas dans
 * `packages/ui` — ni `AlertDialog`, dont il dérive : c'est une **lacune du
 * design system**, signalée et non comblée sur place.
 */

export interface DeleteAccountCardProps {
  /** La route du module, résolue par l'écran. */
  readonly action: string
  /** L'adresse à recopier. C'est une donnée affichée, pas une règle. */
  readonly email: string
  /** Où atterrir une fois la suppression acceptée : la session ne survit pas. */
  readonly destination: string
}

/**
 * Le refus, rendu **tel qu'il arrive**.
 *
 * Le cas du dernier propriétaire affiche **la liste que le serveur envoie**
 * (409, critère 6 de s34). L'écran ne la recalcule pas : il n'a pas les
 * appartenances, et les avoir en ferait une seconde vérité — celle qui ment le
 * jour où un transfert vient d'avoir lieu.
 */
export function DeletionRefusal({ outcome }: { readonly outcome: DeletionRefusalOutcome }) {
  const t = useTranslations()

  if (outcome.kind === 'sole_owner') {
    return (
      <Alert variant="destructive" role="alert">
        <AlertTitle>{t(deletionRefusalKey(outcome))}</AlertTitle>
        <AlertDescription>
          <ul className="mt-2 list-inside list-disc">
            {outcome.organizations.map((organization) => (
              <li key={organization}>{organization}</li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert variant="destructive" role="alert">
      {t(deletionRefusalKey(outcome))}
    </Alert>
  )
}

export function DeleteAccountCard({ action, email, destination }: DeleteAccountCardProps) {
  const t = useTranslations()
  const hydrated = useHydrated()
  const [outcome, setOutcome] = useState<DeletionOutcome | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setPending(true)
    setOutcome(null)

    const form = event.currentTarget
    const response = await fetch(action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // **Ce qui est saisi, tel quel.** Aucune comparaison, aucun rognage,
      // aucune mise en minuscules : la règle est au serveur, et la refaire ici
      // ferait deux vérités sur ce que « correspond » veut dire.
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
    })
    const body = await response.json().catch(() => null)
    const next = deletionOutcomeOf(response.status, body)

    setPending(false)
    setOutcome(next)

    if (next.kind === 'accepted') {
      // La session est révoquée côté serveur : rester sur l'écran de compte
      // afficherait un compte qui n'existe plus.
      window.location.assign(destination)
    }
  }

  return (
    <form method="post" action={action} onSubmit={submit} className="flex flex-col gap-4">
      {/* Une note permanente, pas une région vivante : elle décrit ce que le
          geste coûte, elle ne réagit à rien. */}
      <Alert variant="destructive">{t('app.account.deletion.warning')}</Alert>
      <div className="flex flex-col gap-2">
        <Label htmlFor="delete-confirmation">
          {t('app.account.deletion.confirmationLabel', { email })}
        </Label>
        <Input
          id="delete-confirmation"
          name="confirmation"
          type="text"
          autoComplete="off"
          required
        />
      </div>
      {/* L'acceptation ne s'affiche pas : elle quitte l'écran, et le type
          l'exclut de ce qui porte un message. */}
      {outcome === null || outcome.kind === 'accepted' ? null : (
        <DeletionRefusal outcome={outcome} />
      )}
      <div>
        <Button type="submit" variant="destructive" pending={pending} disabled={!hydrated}>
          {t('app.account.deletion.submit')}
        </Button>
      </div>
    </form>
  )
}
