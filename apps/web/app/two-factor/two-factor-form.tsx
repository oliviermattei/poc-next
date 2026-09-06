'use client'

import { Alert, Button, Input, Label } from '@repo/ui'
import { useTranslations } from 'next-intl'
import { useState, type FormEvent } from 'react'

import {
  AUTH_NOSCRIPT_KEY,
  retryAfterMinutes,
  type RefusalMessage,
} from '../refusal-message'
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
 *
 * **Une quatrième classe depuis s28**, et elle ne vient pas de la route : le
 * répartiteur refuse le débit **avant** d'appeler le gestionnaire, donc avant
 * `twoFactorRefusal`. Le corps de ce refus-là est `rate_limited`, et il tombait
 * dans le repli `invalid` — l'écran disait « Ce code n'est pas valide. » à
 * quelqu'un dont le code est **juste**, pendant jusqu'à cinq minutes, en
 * l'invitant à réessayer.
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
 * Les messages de refus, **par clé entière**.
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
  throttled: 'app.twoFactor.error.throttled',
  throttledIn: 'app.twoFactor.error.throttledIn',
} as const

/**
 * La classe d'un refus, **statut d'abord**.
 *
 * L'ordre n'est pas indifférent : le 429 du répartiteur ne porte pas de classe
 * dans son corps (`{"error":"rate_limited"}`), et le lire après le corps le
 * ferait retomber dans le repli `invalid` — c'est précisément le défaut que le
 * constat M1 de la troisième revue a mesuré.
 *
 * Exportée parce que c'est **ici** que ce défaut vivait :
 * `tests/rate-limiting.test.ts` la neutralise à sa propre ligne, et
 * `e2e/rate-limiting.spec.ts` lit ensuite l'alerte dans un navigateur.
 */
export const twoFactorRefusalOf = (
  status: number,
  error: unknown,
  minutes: number | null,
): RefusalMessage => {
  if (status === 429) {
    return minutes === null
      ? { key: REFUSAL_KEYS.throttled, minutes: null }
      : { key: REFUSAL_KEYS.throttledIn, minutes }
  }

  if (error === 'restart') {
    return { key: REFUSAL_KEYS.restart, minutes: null }
  }

  if (error === 'used') {
    return { key: REFUSAL_KEYS.used, minutes: null }
  }

  // Le repli est `invalid` : c'est le seul message qui ne suppose rien de
  // l'état du défi ni de celui du code.
  return { key: REFUSAL_KEYS.invalid, minutes: null }
}

export function TwoFactorForm(props: TwoFactorFormProps) {
  const t = useTranslations()
  const hydrated = useHydrated()
  const [refusal, setRefusal] = useState<RefusalMessage | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setPending(true)
    setRefusal(null)

    const code = String(new FormData(event.currentTarget).get('code') ?? '')
    const response = await fetch(props.action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })

    setPending(false)

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: unknown } | null

      setRefusal(twoFactorRefusalOf(response.status, payload?.error, retryAfterMinutes(response)))

      return
    }

    window.location.assign(props.destination)
  }

  const fieldId = `two-factor-${props.autoComplete}`
  const throttled =
    refusal?.key === REFUSAL_KEYS.throttled || refusal?.key === REFUSAL_KEYS.throttledIn

  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-4">
      {refusal === null ? null : (
        // `warning` plutôt que `destructive` pour un refus de débit : rien n'est
        // cassé, il faut attendre. C'est la distinction que `public-form.tsx`
        // fait depuis s11, et elle est reprise telle quelle.
        <Alert variant={throttled ? 'warning' : 'destructive'} role="alert">
          {t(refusal.key, { minutes: refusal.minutes ?? 0 })}
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

      {/*
        Le bouton éteint dit pourquoi : même règle, même formulation et même
        clé que `app/auth-form.tsx` — c'est le même geste sur le même parcours
        (s46, constat F5 de la revue).
      */}
      <noscript>
        <Alert variant="warning">{t(AUTH_NOSCRIPT_KEY)}</Alert>
      </noscript>

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
