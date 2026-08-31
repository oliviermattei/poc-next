'use client'

import { useState } from 'react'

/**
 * La déconnexion.
 *
 * Un `POST`, jamais un lien : une déconnexion en `GET` se déclenche depuis une
 * image distante, et le préchargement d'un navigateur suffit à la provoquer.
 */
export function SignOutButton({ action }: { readonly action: string }) {
  const [pending, setPending] = useState(false)

  const signOut = async (): Promise<void> => {
    setPending(true)
    await fetch(action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    window.location.assign('/')
  }

  return (
    <button type="button" onClick={signOut} disabled={pending}>
      Se déconnecter
    </button>
  )
}
