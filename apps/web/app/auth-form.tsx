'use client'

import { useTranslations } from 'next-intl'
import { useState, type FormEvent } from 'react'

import { retryAfterMinutes, type RefusalMessage } from './refusal-message'
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
  /**
   * Où aller quand le serveur **n'a pas ouvert de session** parce qu'un second
   * facteur est attendu (s13).
   *
   * Sans cette destination, la connexion d'un compte protégé serait une boucle
   * silencieuse : la réponse est un `200`, donc le formulaire redirigerait vers
   * le tableau de bord, qui n'a pas de session et renverrait vers `/sign-in`.
   * Le marqueur lu ici (`twoFactor`) est celui que la **route** pose ; aucun
   * code de la bibliothèque n'atteint ce composant.
   */
  readonly twoFactorRedirectTo?: string
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
 *
 * **429 est une classe à part depuis s28**, et c'est un défaut mesuré qui l'a
 * imposée : la limitation de débit refuse au **répartiteur**, donc sans
 * atteindre la route, et ce refus tombait dans le repli « Demande invalide.
 * Vérifiez les informations saisies. » — on disait à quelqu'un dont la saisie
 * est correcte qu'elle ne l'est pas, en l'invitant à recommencer, c'est-à-dire
 * à faire exactement ce que la limitation demande de ne pas faire. La classe
 * `throttled` est celle de `app/public-form.tsx` depuis s11 ; elle est étendue
 * ici, pas réinventée.
 *
 * Exportée parce que c'est **ici** que le défaut vivait :
 * `tests/rate-limiting.test.ts` la neutralise à sa propre ligne, et
 * `e2e/rate-limiting.spec.ts` lit ensuite l'alerte dans un navigateur.
 */
export const authRefusalOf = (status: number, minutes: number | null): RefusalMessage => {
  if (status === 429) {
    return minutes === null
      ? { key: 'app.auth.error.throttled', minutes: null }
      : { key: 'app.auth.error.throttledIn', minutes }
  }

  if (status === 401) {
    return { key: 'app.auth.error.unauthorized', minutes: null }
  }

  if (status === 502) {
    return { key: 'app.auth.error.mail', minutes: null }
  }

  return { key: 'app.auth.error.invalid', minutes: null }
}

export function AuthForm(props: AuthFormProps) {
  const t = useTranslations()
  const hydrated = useHydrated()
  const [refusal, setRefusal] = useState<RefusalMessage | null>(null)
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setPending(true)
    setRefusal(null)

    const entries = Object.fromEntries(new FormData(event.currentTarget).entries())
    const response = await fetch(props.action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...props.hiddenValues, ...entries }),
    })

    setPending(false)

    if (!response.ok) {
      setRefusal(authRefusalOf(response.status, retryAfterMinutes(response)))

      return
    }

    if (props.twoFactorRedirectTo !== undefined) {
      const payload = (await response.json().catch(() => null)) as {
        readonly twoFactor?: unknown
      } | null

      if (payload?.twoFactor === true) {
        window.location.assign(props.twoFactorRedirectTo)

        return
      }
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
      {refusal === null ? null : (
        <p role="alert">{t(refusal.key, { minutes: refusal.minutes ?? 0 })}</p>
      )}
      <button type="submit" disabled={pending || !hydrated}>
        {t(props.submitLabelKey)}
      </button>
    </form>
  )
}
