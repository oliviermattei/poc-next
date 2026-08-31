'use client'

import { useState, type FormEvent } from 'react'

/**
 * Le formulaire des écrans d'authentification.
 *
 * Un seul composant, piloté par ses champs : inscription, connexion, magic
 * link, mot de passe oublié et réinitialisation posent la même question — un
 * corps JSON à une route du module, une redirection ou un message en retour.
 * Cinq composants recopiés divergeraient au premier message d'erreur.
 *
 * Il parle aux **routes du module**, pas à une action serveur : c'est le
 * navigateur qui reçoit le `Set-Cookie` de la session, et le parcours exercé en
 * production est exactement celui que `tests/auth.test.ts` mesure.
 */
export interface AuthFormField {
  readonly name: string
  readonly label: string
  readonly type: 'email' | 'password'
  readonly autoComplete: string
}

export interface AuthFormProps {
  readonly action: string
  readonly fields: readonly AuthFormField[]
  readonly submitLabel: string
  /** Valeurs jointes au corps sans être saisies (jeton, destination de retour). */
  readonly hiddenValues?: Readonly<Record<string, string>>
  /** Destination après succès. Absente, le message ci-dessous s'affiche. */
  readonly redirectTo?: string
  readonly successMessage?: string
}

/**
 * Le message d'un refus.
 *
 * **401 dit toujours la même chose** : compte inconnu et mot de passe invalide
 * y sont indiscernables, et le serveur rend déjà la même réponse dans les deux
 * cas (`docs/security.md` §2). Ajouter ici un « compte introuvable » rétablirait
 * l'énumération que tout le reste du parcours évite.
 */
const messageFor = (status: number): string => {
  if (status === 401) {
    return 'Identifiants invalides.'
  }

  if (status === 403) {
    return 'Vérifiez votre adresse email avant de vous connecter. Un lien vous a été envoyé.'
  }

  if (status === 502) {
    return 'L’email n’a pas pu être envoyé. Réessayez dans un instant.'
  }

  return 'Demande invalide. Vérifiez les informations saisies.'
}

export function AuthForm(props: AuthFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setPending(true)
    setError(null)

    const entries = Object.fromEntries(new FormData(event.currentTarget).entries())
    const response = await fetch(props.action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...props.hiddenValues, ...entries }),
    })

    setPending(false)

    if (!response.ok) {
      setError(messageFor(response.status))

      return
    }

    if (props.redirectTo !== undefined) {
      window.location.assign(props.redirectTo)

      return
    }

    setDone(true)
  }

  if (done && props.successMessage !== undefined) {
    return <p role="status">{props.successMessage}</p>
  }

  return (
    <form onSubmit={submit}>
      {props.fields.map((field) => (
        <p key={field.name}>
          <label htmlFor={field.name}>{field.label}</label>{' '}
          <input
            id={field.name}
            name={field.name}
            type={field.type}
            autoComplete={field.autoComplete}
            required
          />
        </p>
      ))}
      {error === null ? null : <p role="alert">{error}</p>}
      <button type="submit" disabled={pending}>
        {props.submitLabel}
      </button>
    </form>
  )
}
