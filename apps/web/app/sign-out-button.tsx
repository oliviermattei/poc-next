'use client'

import { Button } from '@repo/ui'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

/**
 * La déconnexion.
 *
 * Un `POST`, jamais un lien : une déconnexion en `GET` se déclenche depuis une
 * image distante, et le préchargement d'un navigateur suffit à la provoquer.
 *
 * L'appel vit ici, **une seule fois**, et le menu de compte l'appelle comme le
 * bouton : deux implémentations divergeraient au premier changement de route.
 *
 * La destination après déconnexion est reçue, pas décidée : elle porte le
 * préfixe de locale quand il y en a un, et rien quand il n'y en a pas.
 */
export async function signOut(action: string, destination = '/'): Promise<void> {
  await fetch(action, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  window.location.assign(destination)
}

export function SignOutButton({
  action,
  destination,
}: {
  readonly action: string
  readonly destination: string
}) {
  const t = useTranslations()
  const [pending, setPending] = useState(false)

  return (
    <Button
      type="button"
      variant="outline"
      pending={pending}
      onClick={() => {
        setPending(true)

        void signOut(action, destination)
      }}
    >
      {t('app.account.signOut')}
    </Button>
  )
}
