'use client'

import { Alert, Badge, Button, Input, Label } from '@repo/ui'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { useHydrated } from '../use-hydrated'
import { TwoFactorQr } from './two-factor-qr'

/**
 * Le second facteur, dans les paramètres du compte (s13).
 *
 * **Aucune règle n'est écrite ici.** Chaque formulaire poste vers une route du
 * module : c'est elle qui exige le mot de passe, qui confirme le premier code,
 * qui régénère les codes de secours et qui fait tourner la session. L'écran ne
 * connaît que les réponses — un second chemin rendrait `docs/security.md` §2
 * invérifiable, puisqu'il faudrait prouver la même règle deux fois.
 *
 * Trois états, jamais deux à la fois, et un quatrième transitoire :
 *
 * 1. **désactivé** — un mot de passe, un bouton ;
 * 2. **enrôlement** — le QR, le secret à recopier, un code à confirmer ;
 * 3. **codes de secours** — les dix codes, affichés **une seule fois**. Rien ne
 *    les relit ensuite : ni cet écran, ni aucune route. Un code perdu se
 *    régénère, il ne se retrouve pas ;
 * 4. **activé** — régénérer ou désactiver, les deux sur preuve du mot de passe.
 *
 * `method="post"` est écrit en toutes lettres sur les quatre formulaires, et le
 * bouton reste désactivé jusqu'à l'hydratation : sans le premier, le repli du
 * navigateur met le mot de passe dans l'URL (mesuré en s08,
 * `docs/security.md` §5) ; sans le second, une soumission qui devance React est
 * perdue en silence.
 */
export interface TwoFactorCardProps {
  readonly enabled: boolean
  readonly enableAction: string
  readonly verifyAction: string
  readonly regenerateAction: string
  readonly disableAction: string
}

interface Enrolment {
  readonly totpURI: string
}

/**
 * Le secret d'une URI `otpauth://`, groupé par quatre.
 *
 * C'est le chemin de qui n'a pas de caméra, et celui des lecteurs d'écran :
 * une suite de trente-deux caractères se dicte mal d'un bloc.
 */
const readableSecret = (totpURI: string): string => {
  const secret = new URL(totpURI).searchParams.get('secret') ?? ''

  return (secret.match(/.{1,4}/g) ?? []).join(' ')
}

/**
 * Le champ de mot de passe, **en composant de premier niveau**.
 *
 * Deux règles se croisent ici, et elles poussent dans la même direction :
 *
 * - `passwordField('two-factor-enable-password')` serait une chaîne passée à
 *   une fonction dans les enfants d'un rendu, ce que le détecteur de texte en
 *   dur de s09 refuse — à raison : c'est la forme exacte par laquelle un
 *   libellé finit écrit en dur. En attribut JSX, `id` est technique ;
 * - un composant **défini dans le corps d'un autre** change d'identité à chaque
 *   rendu, donc React remonte son sous-arbre et le champ perd son état.
 *   `react-hooks/static-components` le refuse, et `pnpm lint` avec lui.
 */
function PasswordField({ id }: { readonly id: string }) {
  // Le libellé est **distinct** de celui de la carte « Mot de passe » — deux
  // contrôles du même écran ne partagent pas un nom accessible. Ce n'est pas
  // une question de style : mesuré, deux parcours de s08 visaient le champ de
  // l'autre carte et remplissaient le mauvais formulaire.
  const t = useTranslations()

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{t('app.account.twoFactor.passwordLabel')}</Label>
      <Input id={id} name="password" type="password" autoComplete="current-password" required />
    </div>
  )
}

export function TwoFactorCard(props: TwoFactorCardProps) {
  const t = useTranslations()
  const router = useRouter()
  const hydrated = useHydrated()
  const [pending, setPending] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [backupCodes, setBackupCodes] = useState<readonly string[] | null>(null)

  const post = async (action: string, body: unknown): Promise<unknown | null> => {
    setPending(true)
    setErrorKey(null)

    const response = await fetch(action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    setPending(false)

    if (!response.ok) {
      setErrorKey('app.account.twoFactor.error.refused')

      return null
    }

    return await response.json().catch(() => null)
  }

  const fieldValue = (event: FormEvent<HTMLFormElement>, name: string): string =>
    String(new FormData(event.currentTarget).get(name) ?? '')

  const start = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    const payload = (await post(props.enableAction, {
      password: fieldValue(event, 'password'),
    })) as { totpURI?: string; backupCodes?: readonly string[] } | null

    if (payload?.totpURI === undefined) {
      return
    }

    setEnrolment({ totpURI: payload.totpURI })
    setBackupCodes(payload.backupCodes ?? [])
  }

  const confirm = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    const confirmed = await post(props.verifyAction, { code: fieldValue(event, 'code') })

    if (confirmed === null) {
      return
    }

    // Le second facteur est actif à partir d'ici, et la session vient de
    // tourner. Les codes de secours restent affichés — c'est leur seule
    // apparition —, mais l'état **serveur** est redemandé : sans cela, le badge
    // annonce « Désactivée » sur un compte qui vient d'être protégé, et un
    // badge de statut qui ment est pire qu'absent. `router.refresh()` conserve
    // l'état du composant client, donc les codes restent à l'écran.
    setEnrolment(null)
    router.refresh()
  }

  const regenerate = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    const payload = (await post(props.regenerateAction, {
      password: fieldValue(event, 'password'),
    })) as { backupCodes?: readonly string[] } | null

    if (payload?.backupCodes === undefined) {
      return
    }

    setBackupCodes(payload.backupCodes)
  }

  const disable = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()

    const disabled = await post(props.disableAction, { password: fieldValue(event, 'password') })

    if (disabled === null) {
      return
    }

    setBackupCodes(null)
    router.refresh()
  }

  const refusal =
    errorKey === null ? null : (
      <Alert variant="destructive" role="alert">
        {t(errorKey)}
      </Alert>
    )

  if (enrolment !== null) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t('app.account.twoFactor.scan')}</p>

        <TwoFactorQr value={enrolment.totpURI} label={t('app.account.twoFactor.qrLabel')} />

        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{t('app.account.twoFactor.manual')}</p>
          <p className="rounded-sm border border-border bg-muted px-3 py-2 font-mono text-sm tracking-widest break-all">
            {readableSecret(enrolment.totpURI)}
          </p>
        </div>

        {refusal}

        <form method="post" onSubmit={confirm} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="two-factor-code">{t('app.account.twoFactor.codeLabel')}</Label>
            <Input
              id="two-factor-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </div>
          <div>
            <Button type="submit" pending={pending} disabled={!hydrated}>
              {t('app.account.twoFactor.confirm')}
            </Button>
          </div>
        </form>
      </div>
    )
  }

  if (backupCodes !== null) {
    return (
      <div className="flex flex-col gap-4">
        {/*
          Un avertissement qui reste, pas une confirmation qui s'efface : c'est
          une information à agir (`docs/design-system.md`, § Feedback).
        */}
        <Alert variant="warning" role="status">
          {t('app.account.twoFactor.backupCodes.notice')}
        </Alert>

        <ul className="grid gap-2 sm:grid-cols-2">
          {backupCodes.map((code) => (
            <li
              key={code}
              className="rounded-sm border border-border bg-muted px-3 py-2 font-mono text-sm tracking-widest"
            >
              {code}
            </li>
          ))}
        </ul>

        <div>
          <Button
            type="button"
            variant="outline"
            disabled={!hydrated}
            onClick={() => {
              setBackupCodes(null)
              router.refresh()
            }}
          >
            {t('app.account.twoFactor.backupCodes.acknowledge')}
          </Button>
        </div>
      </div>
    )
  }

  if (props.enabled) {
    return (
      <div className="flex flex-col gap-4">
        {refusal}

        <form method="post" onSubmit={regenerate} className="flex flex-col gap-4">
          <PasswordField id="two-factor-regenerate-password" />
          <div>
            <Button type="submit" variant="outline" pending={pending} disabled={!hydrated}>
              {t('app.account.twoFactor.regenerate')}
            </Button>
          </div>
        </form>

        <form method="post" onSubmit={disable} className="flex flex-col gap-4">
          <PasswordField id="two-factor-disable-password" />
          <div>
            <Button type="submit" variant="destructive" pending={pending} disabled={!hydrated}>
              {t('app.account.twoFactor.disable')}
            </Button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {refusal}

      <form method="post" onSubmit={start} className="flex flex-col gap-4">
        <PasswordField id="two-factor-enable-password" />
        <div>
          <Button type="submit" pending={pending} disabled={!hydrated}>
            {t('app.account.twoFactor.enable')}
          </Button>
        </div>
      </form>
    </div>
  )
}

/** L'état du second facteur, en un mot — `Badge` de l'en-tête de la carte. */
export function TwoFactorBadge({ enabled }: { readonly enabled: boolean }) {
  const t = useTranslations()

  return enabled ? (
    <Badge variant="success">{t('app.account.twoFactor.state.on')}</Badge>
  ) : (
    <Badge variant="secondary">{t('app.account.twoFactor.state.off')}</Badge>
  )
}
