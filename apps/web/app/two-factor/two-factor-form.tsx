'use client'

import { Alert, Button, Input, Label } from '@repo/ui'
import { useTranslations } from 'next-intl'
import { useState, type FormEvent } from 'react'

import { useHydrated } from '../use-hydrated'

/**
 * Le formulaire de vérification du second facteur.
 *
 * Un seul composant pour les deux moyens — code d'application et code de
 * secours —, parce qu'ils posent la même question : un code, une route du
 * module, une session ou un refus. Deux composants recopiés divergeraient au
 * premier message.
 *
 * **Le refus est une classe, jamais un code.** La route replie les cinq codes
 * du greffon sur `invalid` et `restart`, et sa garde de rejeu ajoute `used`
 * (`docs/security.md` §7) ; ce composant ne fait que choisir la clé de
 * traduction correspondante. Il ne reclasse rien, et il n'a jamais vu
 * `INVALID_CODE` ni `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`.
 */
export interface TwoFactorFormProps {
  readonly action: string
  readonly labelKey: string
  readonly submitLabelKey: string
  readonly autoComplete: string
  readonly numeric?: boolean
  readonly variant?: 'default' | 'secondary'
  /** Destination après succès : la session existe à partir de là. */
  readonly destination: string
}

/**
 * Les trois messages de refus, **par clé entière**.
 *
 * Une clé composée (`'app.twoFactor.error.' + classe`) échapperait au contrôle
 * qui vérifie que chaque clé citée existe dans **chaque** locale livrée
 * (`tests/i18n.test.ts`), faute d'extraction statique — même raison que
 * `app/oauth-buttons.tsx` et `account/connection-list.tsx`.
 */
const REFUSAL_KEYS = {
  invalid: 'app.twoFactor.error.invalid',
  restart: 'app.twoFactor.error.restart',
  used: 'app.twoFactor.error.used',
} as const

export function TwoFactorForm(props: TwoFactorFormProps) {
  const t = useTranslations()
  const hydrated = useHydrated()
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setPending(true)
    setErrorKey(null)

    const code = String(new FormData(event.currentTarget).get('code') ?? '')
    const response = await fetch(props.action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })

    setPending(false)

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: unknown } | null

      // Le repli est `invalid` : c'est le seul message qui ne suppose rien de
      // l'état du défi ni de celui du code.
      if (payload?.error === 'restart') {
        setErrorKey(REFUSAL_KEYS.restart)
      } else if (payload?.error === 'used') {
        setErrorKey(REFUSAL_KEYS.used)
      } else {
        setErrorKey(REFUSAL_KEYS.invalid)
      }

      return
    }

    window.location.assign(props.destination)
  }

  const fieldId = `two-factor-${props.autoComplete}`

  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-4">
      {errorKey === null ? null : (
        <Alert variant="destructive" role="alert">
          {t(errorKey)}
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor={fieldId}>{t(props.labelKey)}</Label>
        <Input
          id={fieldId}
          name="code"
          type="text"
          inputMode={props.numeric === true ? 'numeric' : 'text'}
          autoComplete={props.autoComplete}
          required
        />
      </div>

      <div>
        <Button
          type="submit"
          variant={props.variant ?? 'default'}
          pending={pending}
          disabled={!hydrated}
        >
          {t(props.submitLabelKey)}
        </Button>
      </div>
    </form>
  )
}
