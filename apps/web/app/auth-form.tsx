'use client'

import { useTranslations } from 'next-intl'
import { useState, type FormEvent } from 'react'

import { useHydrated } from './use-hydrated'

/**
 * Le formulaire des écrans d'authentification.
 *
 * Un seul composant, piloté par ses champs : inscription, connexion, magic
 * link, mot de passe oublié et réinitialisation posent la même question — un
 * corps JSON à une route du module, une redirection ou un message en retour.
 * Cinq composants recopiés divergeraient au premier message d'erreur.
 *
 * **`method="post"`, et le bouton désactivé tant que React n'a pas repris la
 * main.** Un `<form>` sans `method` est un `GET` vers l'URL courante dès que le
 * gestionnaire n'est pas encore attaché : mesuré, `/sign-in?email=…&password=…`
 * — le mot de passe dans le journal d'accès, dans l'historique et dans le
 * `Referer` (`docs/security.md` §5). L'attribut ferme la fuite, `useHydrated`
 * ferme la perte silencieuse.
 *
 * Il parle aux **routes du module**, pas à une action serveur : c'est le
 * navigateur qui reçoit le `Set-Cookie` de la session, et le parcours exercé en
 * production est exactement celui que `tests/auth.test.ts` mesure.
 *
 * Les libellés arrivent en **clés de traduction**, jamais en texte : c'est
 * l'écran appelant qui nomme la clé, le formulaire qui la résout. Passer le
 * texte déjà traduit obligerait chaque écran serveur à traduire ce que le
 * composant client sait faire, et à le refaire à chaque champ.
 */
export interface AuthFormField {
  readonly name: string
  /** Clé de traduction du libellé, jamais le libellé. */
  readonly labelKey: string
  readonly type: 'email' | 'password'
  readonly autoComplete: string
}

export interface AuthFormProps {
  readonly action: string
  readonly fields: readonly AuthFormField[]
  readonly submitLabelKey: string
  /** Valeurs jointes au corps sans être saisies (jeton, destination de retour). */
  readonly hiddenValues?: Readonly<Record<string, string>>
  /** Destination après succès. Absente, le message ci-dessous s'affiche. */
  readonly redirectTo?: string
  readonly successMessageKey?: string
}

/**
 * La clé du message d'un refus.
 *
 * **401 dit toujours la même chose** : compte inconnu, mot de passe invalide et
 * adresse non vérifiée y sont indiscernables, et le serveur rend déjà la même
 * réponse dans les trois cas (`docs/security.md` §7). Ajouter ici un « compte
 * introuvable » — ou une branche `403` qui dirait « vérifiez votre adresse » —
 * rétablirait dans le navigateur l'énumération que la route vient de fermer.
 *
 * L'invitation à vérifier son adresse est donc **constante** : elle est écrite
 * dans le refus, quel qu'il soit, et l'écran de connexion porte le lien vers
 * `/verify-email`, dont la route de renvoi répond la même chose que l'adresse
 * existe ou non.
 */
const messageKeyFor = (status: number): string => {
  if (status === 401) {
    return 'app.auth.error.unauthorized'
  }

  if (status === 502) {
    return 'app.auth.error.mail'
  }

  return 'app.auth.error.invalid'
}

export function AuthForm(props: AuthFormProps) {
  const t = useTranslations()
  const hydrated = useHydrated()
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setPending(true)
    setErrorKey(null)

    const entries = Object.fromEntries(new FormData(event.currentTarget).entries())
    const response = await fetch(props.action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...props.hiddenValues, ...entries }),
    })

    setPending(false)

    if (!response.ok) {
      setErrorKey(messageKeyFor(response.status))

      return
    }

    if (props.redirectTo !== undefined) {
      window.location.assign(props.redirectTo)

      return
    }

    setDone(true)
  }

  if (done && props.successMessageKey !== undefined) {
    return <p role="status">{t(props.successMessageKey)}</p>
  }

  return (
    <form method="post" onSubmit={submit}>
      {props.fields.map((field) => (
        <p key={field.name}>
          <label htmlFor={field.name}>{t(field.labelKey)}</label>{' '}
          <input
            id={field.name}
            name={field.name}
            type={field.type}
            autoComplete={field.autoComplete}
            required
          />
        </p>
      ))}
      {errorKey === null ? null : <p role="alert">{t(errorKey)}</p>}
      <button type="submit" disabled={pending || !hydrated}>
        {t(props.submitLabelKey)}
      </button>
    </form>
  )
}
