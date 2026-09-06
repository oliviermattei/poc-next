'use client'

import { Alert, Button } from '@repo/ui'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { useHydrated } from '../use-hydrated'
import {
  dataExportRefusalKey,
  dataExportRefusalOf,
  dataExportStateKey,
  type DataExportRefusal,
} from './rgpd-outcomes'

/**
 * **La demande d'export de ses données** (s34b, critères 5 et 6).
 *
 * Trois choses s'y jouent, et aucune n'est une règle de cet écran.
 *
 * 1. **Le jeton n'atteint jamais l'écran.** Le lien de téléchargement part par
 *    email, et sa route est **publique** : il donne accès à l'ensemble des
 *    données d'une personne. Ce composant reçoit un état — l'instant de la
 *    demande, son état, l'échéance du lien — et rien d'autre. Le mettre dans
 *    une URL de page le laisserait dans l'historique du navigateur, dans le
 *    `Referer` et dans les journaux d'accès.
 * 2. **Une demande en cours remplace le bouton.** Le serveur refuse la seconde
 *    (409, critère 7 de s35) : proposer l'action serait promettre un refus. Ce
 *    qui décide vient du **serveur** — `state.pending` est dérivé des demandes
 *    qu'il rend, pas d'un compteur du navigateur.
 * `action` est écrit sur le `<form>` en plus de `method` : avant l'hydratation,
 * le repli natif du navigateur doit atteindre la route du module et non l'écran
 * courant. Le bouton est éteint jusque-là (`useHydrated`), donc ce chemin n'est
 * pas nominal — mais un formulaire qui poste ailleurs que là où il dit est un
 * piège, et la moitié `method` de la règle de `s08` ne le couvre pas.
 *
 * 3. **Chaque refus garde son message.** Déjà en cours, débit dépassé,
 *    mise en file refusée : la revue de s35 avait relevé qu'aucun écran ne
 *    montrait le 429, et un message générique jetterait ce que le serveur a
 *    soigneusement distingué (`rgpd-outcomes.ts`).
 */

/** Une demande, telle que le serveur la rend — dates déjà formatées par lui. */
export interface DataExportRequestRow {
  readonly status: string
  readonly requestedAt: string
  readonly expiresAt: string | null
}

export interface DataExportCardProps {
  /** La route du module, résolue par l'écran. */
  readonly action: string
  /** Une demande est-elle en cours ? Décidé par le serveur, jamais ici. */
  readonly pending: boolean
  /** La demande la plus récente, ou `null` quand il n'y en a jamais eu. */
  readonly latest: DataExportRequestRow | null
}

export function DataExportCard({ action, pending, latest }: DataExportCardProps) {
  const t = useTranslations()
  const router = useRouter()
  const hydrated = useHydrated()
  const [refusal, setRefusal] = useState<DataExportRefusal | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [sending, setSending] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setSending(true)
    setRefusal(null)
    setAccepted(false)

    // Le périmètre est **déclaré**, jamais deviné : c'est ce que
    // `dataExportRequestBodySchema` attend côté serveur. Le compte, lui, vient
    // de la session et n'a aucun champ ici.
    const response = await fetch(action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'user' }),
    })
    const refused = dataExportRefusalOf(response)

    setSending(false)
    setRefusal(refused)

    if (refused === null) {
      setAccepted(true)
      // L'état affiché vient du serveur : on le lui redemande plutôt que de
      // recopier localement ce qu'on croit avoir déclenché.
      router.refresh()
    }
  }

  // Hors du JSX, comme `app/public-form.tsx` : le balayage de
  // `tests/i18n.test.ts` lit une comparaison à un littéral dans une expression
  // d'attribut comme un fragment de texte, et il a raison de s'en méfier.
  const throttled = refusal?.kind === 'throttled'
  const failed = latest?.status === 'failed'
  // Le message chiffré n'existe que quand le serveur a chiffré l'attente ; les
  // autres l'ignorent, et `dataExportRefusalKey` choisit alors la clé sans
  // nombre.
  const minutes = refusal !== null && refusal.kind === 'throttled' ? (refusal.minutes ?? 0) : 0

  return (
    <div className="flex flex-col gap-4">
      {/* Une note permanente : le lien ne s'affiche pas ici, et c'est délibéré. */}
      <Alert variant="info">{t('app.account.export.notice')}</Alert>

      {latest === null ? null : (
        <Alert variant={failed ? 'warning' : 'default'} role="status">
          {t(dataExportStateKey(latest.status), {
            date: latest.requestedAt,
            expiry: latest.expiresAt ?? '',
          })}
        </Alert>
      )}

      {refusal === null ? null : (
        <Alert variant={throttled ? 'warning' : 'destructive'} role="alert">
          {t(dataExportRefusalKey(refusal), { minutes })}
        </Alert>
      )}

      {accepted ? (
        <Alert variant="success" role="status">
          {t('app.account.export.done')}
        </Alert>
      ) : null}

      {pending || accepted ? null : (
        <form method="post" action={action} onSubmit={submit}>
          <Button type="submit" pending={sending} disabled={!hydrated}>
            {t('app.account.export.submit')}
          </Button>
        </form>
      )}
    </div>
  )
}
