'use client'

import { Alert, Button, Input, Label } from '@repo/ui'
import { useTranslations } from 'next-intl'
import { useId, useState, type FormEvent } from 'react'

import { AUTH_NOSCRIPT_KEY, retryAfterMinutes, type RefusalMessage } from './refusal-message'
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
 * **Il compose avec `packages/ui`, sans `Form`** (s46). `docs/design-system.md`
 * annonce `Form`, `FormField` et `FormMessage` comme la voie du dépôt pour un
 * formulaire ; ils n'existent pas, et ce sont les liaisons de
 * `react-hook-form`, qui n'est pas une dépendance de ce dépôt. Les livrer pour
 * cinq écrans qui rendent un ou deux champs et un bouton ferait entrer une
 * bibliothèque et une abstraction pour rien. **C'est un manque du design system
 * signalé, pas comblé sur place**, et il est signalé **là où le prochain agent
 * le lira** : `docs/design-system.md`, § « Lacune : la liaison de formulaire, et
 * la largeur d'un écran centré (s46) ». Ici l'erreur est
 * **globale** — le serveur ne nomme aucun champ, et il ne le doit pas : compte
 * inconnu et mot de passe faux sont indiscernables (`docs/security.md` §7).
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
const REFUSAL_KEYS = {
  throttled: 'app.auth.error.throttled',
  throttledIn: 'app.auth.error.throttledIn',
  unauthorized: 'app.auth.error.unauthorized',
  mail: 'app.auth.error.mail',
  invalid: 'app.auth.error.invalid',
} as const

export const authRefusalOf = (status: number, minutes: number | null): RefusalMessage => {
  if (status === 429) {
    return minutes === null
      ? { key: REFUSAL_KEYS.throttled, minutes: null }
      : { key: REFUSAL_KEYS.throttledIn, minutes }
  }

  if (status === 401) {
    return { key: REFUSAL_KEYS.unauthorized, minutes: null }
  }

  if (status === 502) {
    return { key: REFUSAL_KEYS.mail, minutes: null }
  }

  return { key: REFUSAL_KEYS.invalid, minutes: null }
}

export function AuthForm(props: AuthFormProps) {
  const t = useTranslations()
  const hydrated = useHydrated()
  /**
   * **Le préfixe des identifiants de champ, propre à cette instance.**
   *
   * L'écran de connexion monte **deux** formulaires, et tous deux portent un
   * champ nommé `email` : un identifiant tiré du seul nom du champ était donc
   * en double dans le document, et l'étiquette « Adresse email (lien de
   * connexion) » désignait le champ du formulaire de mot de passe — pour un
   * lecteur d'écran, pour un clic sur l'étiquette, et pour le `getByLabel` des
   * parcours. `useId` rend un préfixe stable entre le rendu du serveur et
   * l'hydratation, ce qu'un compteur de module ne ferait pas.
   */
  const uid = useId()
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
    // La confirmation **remplace** le formulaire, comme dans
    // `app/public-form.tsx` : c'est le seul état qui ne laisse pas croire
    // qu'il faut renvoyer.
    return (
      <Alert variant="success" role="status">
        {t(props.successMessageKey)}
      </Alert>
    )
  }

  const throttled =
    refusal?.key === REFUSAL_KEYS.throttled || refusal?.key === REFUSAL_KEYS.throttledIn

  return (
    <form method="post" onSubmit={submit} className="flex min-w-0 flex-col gap-4">
      {refusal === null ? null : (
        // `warning` plutôt que `destructive` pour un refus de débit : rien
        // n'est cassé, il faut attendre. C'est la distinction que
        // `app/public-form.tsx` fait depuis s11 et que `two-factor-form.tsx`
        // reprend ; le refus reste **au-dessus** des champs, comme le design
        // system l'exige d'une erreur globale de formulaire.
        <Alert variant={throttled ? 'warning' : 'destructive'} role="alert">
          {t(refusal.key, { minutes: refusal.minutes ?? 0 })}
        </Alert>
      )}

      {props.fields.map((field) => {
        // L'expression vit **hors du JSX** : un littéral d'un seul mot entre
        // accolades dans des enfants est lu comme du texte affiché par
        // `tests/i18n.test.ts`, et il a raison de le lire ainsi.
        const fieldId = `${uid}${field.name}`

        return (
          <div key={field.name} className="flex min-w-0 flex-col gap-2">
            <Label htmlFor={fieldId}>{t(field.labelKey)}</Label>
            <Input
              id={fieldId}
              name={field.name}
              type={field.type}
              autoComplete={field.autoComplete}
              required
            />
          </div>
        )
      })}

      {/*
        **Le bouton éteint dit pourquoi.** Sans JavaScript, `useHydrated` le
        laisse éteint pour toujours : l'écran a l'air fini et ne l'est pas.
        C'est ce que `apps/web/AGENTS.md` exige depuis le constat F5 de la revue
        de s11, et ce que `app/public-form.tsx` et `app/billing-actions.tsx`
        faisaient déjà — pas ces écrans-ci, jusqu'à s46. Un `<noscript>` ne
        demande ni script en ligne ni source de politique de sécurité du contenu
        supplémentaire.
      */}
      <noscript>
        <Alert variant="warning">{t(AUTH_NOSCRIPT_KEY)}</Alert>
      </noscript>

      <Button type="submit" className="w-full" pending={pending} disabled={!hydrated}>
        {t(props.submitLabelKey)}
      </Button>
    </form>
  )
}
