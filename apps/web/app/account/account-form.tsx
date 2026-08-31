'use client'

import { Alert, Button, Input, Label } from '@repo/ui'
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
 */
export interface AccountFormField {
  readonly name: string
  readonly label: string
  readonly type: 'text' | 'email' | 'password'
  readonly autoComplete: string
  readonly defaultValue?: string
}

export interface AccountFormProps {
  readonly action: string
  readonly fields: readonly AccountFormField[]
  readonly submitLabel: string
  readonly successMessage: string
  /** Redirection après succès, quand la session ne survit pas au changement. */
  readonly redirectTo?: string
}

const messageFor = (status: number): string => {
  if (status === 400) {
    return 'Demande invalide. Vérifiez les informations saisies.'
  }

  if (status === 401 || status === 403) {
    return 'Cette action a été refusée. Vérifiez votre mot de passe actuel, puis réessayez.'
  }

  if (status === 502) {
    return 'L’email n’a pas pu être envoyé. Réessayez dans un instant.'
  }

  return 'L’enregistrement a échoué. Réessayez dans un instant.'
}

export function AccountForm({
  action,
  fields,
  submitLabel,
  successMessage,
  redirectTo,
}: AccountFormProps) {
  const router = useRouter()
  const hydrated = useHydrated()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setPending(true)
    setError(null)
    setDone(false)

    const form = event.currentTarget
    const response = await fetch(action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
    })

    setPending(false)

    if (!response.ok) {
      setError(messageFor(response.status))

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
          <Label htmlFor={field.name}>{field.label}</Label>
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
      {error === null ? null : (
        <Alert variant="destructive" role="alert">
          {error}
        </Alert>
      )}
      {done && error === null ? (
        <Alert variant="success" role="status">
          {successMessage}
        </Alert>
      ) : null}
      <div>
        <Button type="submit" pending={pending} disabled={!hydrated}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
