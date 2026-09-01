'use client'

import { Alert, Button } from '@repo/ui'
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { useHydrated } from '../use-hydrated'

/**
 * La connexion par passkey, sur l'écran de connexion (s14).
 *
 * **Aucune adresse n'est demandée**, et c'est une propriété de sécurité, pas
 * une commodité : le point d'entrée du serveur ne prend aucun paramètre et ne
 * consulte l'existence d'aucun compte — le navigateur propose les passkeys
 * qu'il détient (clé découvrable). Conditionner ce bouton à une adresse saisie
 * rétablirait l'oracle d'énumération que ce parcours n'a pas
 * (`docs/security.md` §7).
 *
 * **Il n'est rendu que si le navigateur sait faire.** C'est le critère 4 de la
 * story : sur un navigateur ou un appareil incompatible, l'option est masquée
 * et les autres moyens de connexion — mot de passe, lien de connexion,
 * fournisseurs — restent servis par le serveur, inchangés. Aucun message ne
 * remplace le bouton : un bandeau « votre navigateur ne gère pas les
 * passkeys » sur chaque chargement serait du bruit permanent pour quelqu'un qui
 * n'y peut rien.
 *
 * **Un seul message de refus.** La route replie « justificatif inconnu » et
 * « signature fausse » sur le refus générique de toute connexion ; l'écran ne
 * reclasse rien, il affiche. Une annulation, elle, n'affiche rien : la personne
 * vient de fermer la fenêtre elle-même.
 */
export interface PasskeyButtonProps {
  readonly optionsAction: string
  readonly verifyAction: string
  /** Destination après connexion, déjà filtrée par l'écran appelant. */
  readonly destination: string
  /**
   * Où aller quand le serveur **n'a pas ouvert de session** parce qu'un second
   * facteur est attendu (ADR 031).
   *
   * Une passkey de ce montage prouve la possession, et rien de plus : elle ne
   * dispense pas du second facteur. Sans cette destination, la connexion d'un
   * compte protégé serait une boucle silencieuse — la réponse est un `200`,
   * donc le bouton naviguerait vers un tableau de bord qui n'a pas de session.
   */
  readonly twoFactorDestination: string
}

export function PasskeyButton(props: PasskeyButtonProps) {
  const t = useTranslations()
  const hydrated = useHydrated()
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!hydrated || !browserSupportsWebAuthn()) {
    return null
  }

  const signIn = async (): Promise<void> => {
    setPending(true)
    setFailed(false)

    const options = await fetch(props.optionsAction, { headers: { accept: 'application/json' } })

    if (!options.ok) {
      setPending(false)
      setFailed(true)

      return
    }

    let assertion: unknown

    try {
      assertion = await startAuthentication({ optionsJSON: await options.json() })
    } catch {
      // La personne a fermé la fenêtre du système. Ce n'est pas un échec, et
      // rien n'a été envoyé.
      setPending(false)

      return
    }

    const verified = await fetch(props.verifyAction, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response: assertion }),
    })

    setPending(false)

    if (!verified.ok) {
      setFailed(true)

      return
    }

    const payload = (await verified.json().catch(() => null)) as {
      readonly twoFactor?: unknown
    } | null

    window.location.assign(
      payload?.twoFactor === true ? props.twoFactorDestination : props.destination,
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {failed ? (
        <Alert variant="destructive" role="alert">
          {t('app.signIn.passkey.error')}
        </Alert>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="w-full"
        pending={pending}
        onClick={() => void signIn()}
      >
        {t('app.signIn.passkey.submit')}
      </Button>
    </div>
  )
}
