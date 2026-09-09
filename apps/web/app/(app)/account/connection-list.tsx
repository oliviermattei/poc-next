'use client'

import { Alert, Badge, Button } from '@repo/ui'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

/**
 * Les moyens de connexion du compte, chacun déliable — sauf le dernier.
 *
 * Ce composant ne reçoit **ni jeton ni empreinte** : le serveur ne lui envoie
 * qu'un identifiant de ligne, un fournisseur et une date. Le déliement est un
 * `POST` vers la route du module, qui refuse côté serveur — dans la même
 * transaction que la suppression — de retirer le dernier moyen. `removable`
 * n'est pas la règle : c'est ce que la règle a déjà décidé, pour ne pas
 * proposer une action qui sera refusée (`docs/security.md` §3).
 *
 * Le libellé du fournisseur vient du catalogue. Un identifiant que la table
 * ci-dessous ne connaît pas — une ligne écrite par une autre version — retombe
 * sur un libellé générique : un écran ne doit pas échouer parce qu'une donnée a
 * vieilli, et l'i18n de s09 refuse tout repli silencieux sur le nom de la clé.
 */

/**
 * Les libellés, **par clé entière** — même table et même raison que
 * `app/oauth-buttons.tsx`.
 *
 * Une clé construite par concaténation (`'app.auth.oauth.provider.' + id`)
 * échappe au contrôle qui vérifie que chaque clé citée existe dans **chaque**
 * locale livrée (`tests/i18n.test.ts`), parce qu'aucune extraction statique ne
 * la voit. Écrites en toutes lettres, les cinq entrent dans le balayage : en
 * retirer une d'un catalogue fait rougir.
 *
 * `credential` est le mot de passe : la bibliothèque range son empreinte dans
 * la même table que les comptes de fournisseur, sous cet identifiant.
 */
const PROVIDER_LABEL_KEYS: Readonly<Record<string, string>> = {
  google: 'app.auth.oauth.provider.google',
  github: 'app.auth.oauth.provider.github',
  local: 'app.auth.oauth.provider.local',
  credential: 'app.auth.oauth.provider.credential',
}

const UNKNOWN_PROVIDER_LABEL_KEY = 'app.auth.oauth.provider.unknown'
export interface ConnectionRow {
  readonly id: string
  readonly providerId: string
  readonly addedAt: string
  readonly removable: boolean
}

export interface ConnectionListProps {
  readonly connections: readonly ConnectionRow[]
  readonly action: string
}

export function ConnectionList({ connections, action }: ConnectionListProps) {
  const t = useTranslations()
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const unlink = async (connection: ConnectionRow): Promise<void> => {
    setPending(connection.id)
    setFailed(false)

    const response = await fetch(action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: connection.id }),
    })

    setPending(null)

    if (!response.ok) {
      setFailed(true)

      return
    }

    router.refresh()
  }

  const providerLabel = (providerId: string): string =>
    t(PROVIDER_LABEL_KEYS[providerId] ?? UNKNOWN_PROVIDER_LABEL_KEY)

  return (
    <div className="flex flex-col gap-3">
      {failed ? (
        <Alert variant="destructive" role="alert">
          {t('app.account.connections.failed')}
        </Alert>
      ) : null}

      <ul className="flex flex-col gap-3">
        {connections.map((connection) => (
          <li
            key={connection.id}
            className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{providerLabel(connection.providerId)}</Badge>
              <span className="text-xs text-muted-foreground">
                {t('app.account.connections.added', { date: connection.addedAt })}
              </span>
            </span>

            {connection.removable ? (
              <Button
                type="button"
                variant="outline"
                pending={pending === connection.id}
                onClick={() => {
                  void unlink(connection)
                }}
              >
                {t('app.account.connections.unlink')}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">
                {t('app.account.connections.last')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
