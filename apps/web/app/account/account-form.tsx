'use client'

import { Alert, Button, Input, Label } from '@repo/ui'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { useHydrated } from '../use-hydrated'

/**
 * Un formulaire de paramètres.
 *
 * Il parle aux **routes du module**, comme les écrans d'authentification : la
 * règle qui décide reste côté serveur, et le formulaire n'en connaît que la
 * réponse. C'est ce qui interdit un second chemin de changement de mot de passe
 * — celui de s07 est le seul, et le §2 du socle reste vérifiable à un seul
 * endroit.
 *
 * **`method="post"`, et le bouton désactivé tant que React n'a pas repris la
 * main.** Sans le premier, le repli du navigateur est un `GET` vers l'URL
 * courante et le mot de passe part dans la chaîne de requête — mesuré, revue de
 * s08, `docs/security.md` §5. Sans le second, la soumission qui devance
 * l'hydratation est perdue en silence. Les deux valent pour tout écran qui
 * héritera de ce formulaire, pas seulement pour celui-ci.
 *
 * Après un succès, `router.refresh()` : les données affichées viennent du
 * serveur, donc l'écran doit les redemander plutôt que de recopier localement
 * ce qu'il vient d'envoyer. Recopier afficherait « enregistré » sur une valeur
 * que la base aurait pu refuser.
 *
 * Les libellés sont des **clés**, résolues ici : l'écran serveur les nomme, le
 * composant client les traduit.
 */
export interface AccountFormField {
  readonly name: string
  readonly labelKey: string
  readonly type: 'text' | 'email' | 'password'
  readonly autoComplete: string
  readonly defaultValue?: string
}

export interface AccountFormProps {
  readonly action: string
  readonly fields: readonly AccountFormField[]
  readonly submitLabelKey: string
  readonly successMessageKey: string
  /** Redirection après succès, quand la session ne survit pas au changement. */
  readonly redirectTo?: string
}

const messageKeyFor = (status: number): string => {
  if (status === 400) {
    return 'app.account.error.invalid'
  }

  if (status === 401 || status === 403) {
    return 'app.account.error.refused'
  }

  if (status === 502) {
    return 'app.account.error.mail'
  }

  return 'app.account.error.failed'
}

export function AccountForm({
  action,
  fields,
  submitLabelKey,
  successMessageKey,
  redirectTo,
}: AccountFormProps) {
  const t = useTranslations()
  const router = useRouter()
  const hydrated = useHydrated()
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setPending(true)
    setErrorKey(null)
    setDone(false)

    const form = event.currentTarget
    const response = await fetch(action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
    })

    setPending(false)

    if (!response.ok) {
      setErrorKey(messageKeyFor(response.status))

      return
    }

    setDone(true)

    if (redirectTo !== undefined) {
      window.location.assign(redirectTo)

      return
    }

    // Les champs de mot de passe ne sont pas conservés après un succès : les
    // laisser remplis, c'est les laisser renvoyer.
    form.reset()
    router.refresh()
  }

  return (
    <form method="post" onSubmit={submit} className="flex flex-col gap-4">
      {fields.map((field) => (
        <div key={field.name} className="flex flex-col gap-2">
          <Label htmlFor={field.name}>{t(field.labelKey)}</Label>
          <Input
            id={field.name}
            name={field.name}
            type={field.type}
            autoComplete={field.autoComplete}
            defaultValue={field.defaultValue}
            required
          />
        </div>
      ))}
      {errorKey === null ? null : (
        <Alert variant="destructive" role="alert">
          {t(errorKey)}
        </Alert>
      )}
      {done && errorKey === null ? (
        <Alert variant="success" role="status">
          {t(successMessageKey)}
        </Alert>
      ) : null}
      <div>
        <Button type="submit" pending={pending} disabled={!hydrated}>
          {t(submitLabelKey)}
        </Button>
      </div>
    </form>
  )
}
