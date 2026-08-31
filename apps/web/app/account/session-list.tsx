'use client'

import { Alert, Badge, Button } from '@repo/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Les sessions actives, chacune révocable.
 *
 * Ce composant n'a **aucun jeton** à sa disposition : le serveur ne lui envoie
 * qu'un identifiant, une date et un appareil. Révoquer est un `POST` vers la
 * route du module, qui vérifie côté serveur que la session appartient bien à
 * l'appelant — masquer un bouton n'a jamais été une permission
 * (`docs/security.md` §3).
 *
 * Les dates sont **formatées par le serveur** : les formater ici les rendrait
 * dans le fuseau du navigateur, différent de celui du serveur, ce que React
 * signale comme un écart d'hydratation.
 */
export interface SessionRow {
  readonly id: string
  readonly createdAt: string
  readonly device: string
  readonly ipAddress: string | null
  readonly current: boolean
}

export interface SessionListProps {
  readonly sessions: readonly SessionRow[]
  readonly action: string
}

export function SessionList({ sessions, action }: SessionListProps) {
  const router = useRouter()
  const [revoking, setRevoking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const revoke = async (session: SessionRow): Promise<void> => {
    setRevoking(session.id)
    setError(null)

    const response = await fetch(action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id }),
    })

    setRevoking(null)

    if (!response.ok) {
      setError('Cette session n’a pas pu être révoquée. Rechargez la page, puis réessayez.')

      return
    }

    // Révoquer sa propre session, c'est se déconnecter : rester sur un écran
    // protégé avec un cookie que le serveur refuse désormais afficherait une
    // page vide au premier rechargement.
    if (session.current) {
      window.location.assign('/sign-in')

      return
    }

    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3">
      {error === null ? null : (
        <Alert variant="destructive" role="alert">
          {error}
        </Alert>
      )}
      <ul className="flex flex-col gap-3">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="truncate">{session.device}</span>
                {session.current ? <Badge variant="secondary">Session courante</Badge> : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                Ouverte le {session.createdAt}
                {session.ipAddress === null ? '' : ` — ${session.ipAddress}`}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              pending={revoking === session.id}
              onClick={() => void revoke(session)}
              aria-label={`Révoquer la session ${session.device}`}
            >
              Révoquer
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
