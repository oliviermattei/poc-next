'use client'

import { Alert, Button, EmptyState, Input, Label } from '@repo/ui'
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { useHydrated } from '../use-hydrated'

/**
 * Les passkeys, dans les paramètres du compte (s14).
 *
 * **Aucune règle n'est écrite ici.** L'enrôlement, le renommage et la
 * révocation passent par les routes du module : c'est elle qui exige une
 * session fraîche, qui borne le nom, qui refuse de retirer le dernier moyen de
 * connexion, et qui fait tourner la session. L'écran ne connaît que les
 * réponses — un second chemin rendrait `docs/security.md` §3 invérifiable.
 *
 * `removable` n'est pas une permission : c'est ce que la règle a **déjà**
 * décidé, pour ne pas proposer une action qui sera refusée. Le serveur la
 * réapplique sous verrou au moment de supprimer.
 *
 * **Ce composant est le seul de l'écran dont une partie n'existe pas côté
 * serveur.** Une cérémonie WebAuthn ne peut pas naître d'une soumission de
 * formulaire : elle demande `navigator.credentials`, donc du JavaScript, donc
 * un navigateur qui sait le faire. Le bouton d'enregistrement n'est rendu
 * qu'après hydratation **et** si `browserSupportsWebAuthn()` répond vrai — le
 * rendu serveur ne peut pas le savoir, c'est une propriété du navigateur. La
 * liste, elle, est servie par le serveur et reste visible partout : révoquer
 * une passkey depuis un poste incompatible doit rester possible.
 */
export interface PasskeyRow {
  readonly id: string
  /** Le nom donné par la personne. `null` tant qu'elle n'en a pas donné. */
  readonly name: string | null
  /** Déjà formatée par le serveur, dans la locale servie. */
  readonly addedAt: string
  readonly removable: boolean
}

export interface PasskeyCardProps {
  readonly passkeys: readonly PasskeyRow[]
  readonly optionsAction: string
  readonly registerAction: string
  readonly renameAction: string
  readonly revokeAction: string
}

/**
 * Les messages de refus, **par clé entière**.
 *
 * Une clé composée (`'app.account.passkeys.error.' + classe`) échapperait au
 * contrôle qui vérifie que chaque clé citée existe dans **chaque** locale
 * livrée (`tests/i18n.test.ts`), faute d'extraction statique — même raison que
 * `app/oauth-buttons.tsx`, `account/connection-list.tsx` et
 * `two-factor/two-factor-form.tsx`.
 *
 * `cancelled` ne vient pas du serveur : c'est le navigateur qui rejette quand
 * la personne ferme la fenêtre du système. Aucune requête n'est partie, aucune
 * ligne n'a été écrite — le critère « pas d'entrée orpheline » est tenu par la
 * forme du parcours, pas par un nettoyage.
 */
const REFUSAL_KEYS = {
  stale: 'app.account.passkeys.error.stale',
  refused: 'app.account.passkeys.error.refused',
  cancelled: 'app.account.passkeys.error.cancelled',
  lastMethod: 'app.account.passkeys.error.lastMethod',
} as const

type RefusalKey = (typeof REFUSAL_KEYS)[keyof typeof REFUSAL_KEYS]

/**
 * La classe rendue par une route du module, **relue** et jamais reclassée.
 *
 * Le repli est `refused` : c'est le seul message qui ne suppose rien de l'état
 * de la session ni de celui du compte.
 */
const refusalKeyOf = async (response: Response): Promise<RefusalKey> => {
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null

  if (payload?.error === 'stale') {
    return REFUSAL_KEYS.stale
  }

  return payload?.error === 'last-method' ? REFUSAL_KEYS.lastMethod : REFUSAL_KEYS.refused
}

export function PasskeyCard(props: PasskeyCardProps) {
  const t = useTranslations()
  const router = useRouter()
  const hydrated = useHydrated()
  const [pending, setPending] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<RefusalKey | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const supported = hydrated && browserSupportsWebAuthn()

  const register = async (): Promise<void> => {
    setPending('register')
    setErrorKey(null)

    const options = await fetch(props.optionsAction, { headers: { accept: 'application/json' } })

    if (!options.ok) {
      setPending(null)
      setErrorKey(await refusalKeyOf(options))

      return
    }

    let attestation: unknown

    try {
      attestation = await startRegistration({ optionsJSON: await options.json() })
    } catch {
      // Fermer la fenêtre du système est un geste, pas une panne. Rien n'est
      // parti, rien n'a été écrit.
      setPending(null)
      setErrorKey(REFUSAL_KEYS.cancelled)

      return
    }

    const registered = await fetch(props.registerAction, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response: attestation }),
    })

    setPending(null)

    if (!registered.ok) {
      setErrorKey(await refusalKeyOf(registered))

      return
    }

    router.refresh()
  }

  const rename = async (event: FormEvent<HTMLFormElement>, passkey: PasskeyRow): Promise<void> => {
    event.preventDefault()
    setPending(passkey.id)
    setErrorKey(null)

    const name = String(new FormData(event.currentTarget).get('name') ?? '')
    const renamed = await fetch(props.renameAction, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passkeyId: passkey.id, name }),
    })

    setPending(null)

    if (!renamed.ok) {
      setErrorKey(await refusalKeyOf(renamed))

      return
    }

    setEditing(null)
    router.refresh()
  }

  const revoke = async (passkey: PasskeyRow): Promise<void> => {
    setPending(passkey.id)
    setErrorKey(null)

    const revoked = await fetch(props.revokeAction, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passkeyId: passkey.id }),
    })

    setPending(null)

    if (!revoked.ok) {
      setErrorKey(await refusalKeyOf(revoked))

      return
    }

    router.refresh()
  }

  const addButton = supported ? (
    <Button type="button" pending={pending === 'register'} onClick={() => void register()}>
      {t('app.account.passkeys.register')}
    </Button>
  ) : null

  return (
    <div className="flex flex-col gap-4">
      {errorKey === null ? null : (
        <Alert variant="destructive" role="alert">
          {t(errorKey)}
        </Alert>
      )}

      {props.passkeys.length === 0 ? (
        <EmptyState
          title={t('app.account.passkeys.empty.title')}
          description={t('app.account.passkeys.empty.description')}
          action={addButton}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {props.passkeys.map((passkey) => {
              const label = passkey.name ?? t('app.account.passkeys.unnamed')

              return (
                <li
                  key={passkey.id}
                  className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  {editing === passkey.id ? (
                    // Un seul champ à l'écran à la fois : *n* champs portant le
                    // même nom accessible ne se distinguent pas au lecteur
                    // d'écran.
                    <form
                      method="post"
                      onSubmit={(event) => void rename(event, passkey)}
                      className="flex w-full flex-col gap-3"
                    >
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="passkey-name">
                          {t('app.account.passkeys.nameLabel')}
                        </Label>
                        <Input
                          id="passkey-name"
                          name="name"
                          type="text"
                          defaultValue={passkey.name ?? ''}
                          required
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="submit"
                          pending={pending === passkey.id}
                          disabled={!hydrated}
                        >
                          {t('app.account.passkeys.save')}
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                          {t('app.account.passkeys.cancel')}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {t('app.account.passkeys.added', { date: passkey.addedAt })}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setEditing(passkey.id)}
                          aria-label={t('app.account.passkeys.renameLabel', { name: label })}
                        >
                          {t('app.account.passkeys.rename')}
                        </Button>
                        {passkey.removable ? (
                          <Button
                            type="button"
                            variant="destructive"
                            pending={pending === passkey.id}
                            onClick={() => void revoke(passkey)}
                            aria-label={t('app.account.passkeys.revokeLabel', { name: label })}
                          >
                            {t('app.account.passkeys.revoke')}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t('app.account.passkeys.last')}
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </li>
              )
            })}
          </ul>

          {/*
            Un conteneur, pour que le bouton ne s'étire pas sur toute la
            largeur de la carte : les enfants d'une colonne flex prennent la
            largeur disponible, et c'est la forme qu'emploient déjà les autres
            cartes de l'écran. Vérifié au navigateur, 390 px et 1280 px.
          */}
          <div>{addButton}</div>
        </>
      )}
    </div>
  )
}
