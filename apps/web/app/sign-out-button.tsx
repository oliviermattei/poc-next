'use client'

import { Button } from '@repo/ui'
import { useState } from 'react'

/**
 * La déconnexion.
 *
 * Un `POST`, jamais un lien : une déconnexion en `GET` se déclenche depuis une
 * image distante, et le préchargement d'un navigateur suffit à la provoquer.
 *
 * L'appel vit ici, **une seule fois**, et le menu de compte l'appelle comme le
 * bouton : deux implémentations divergeraient au premier changement de route.
 */
export async function signOut(action: string): Promise<void> {
  await fetch(action, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  window.location.assign('/')
}

export function SignOutButton({ action }: { readonly action: string }) {
  const [pending, setPending] = useState(false)

  return (
    <Button
      type="button"
      variant="outline"
      pending={pending}
      onClick={() => {
        setPending(true)

        void signOut(action)
      }}
    >
      Se déconnecter
    </Button>
  )
}
