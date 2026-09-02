'use client'

import { BILLING_KEYS, BILLING_REFUSAL_KEYS } from '@repo/module-billing'
import { Alert, Button } from '@repo/ui'
import { useTranslations } from 'next-intl'
import { useState, type FormEvent } from 'react'

import { useFocusWhenReady } from './use-focus-when-ready'
import { useHydrated } from './use-hydrated'

/**
 * Les déclencheurs de la facturation — **dans l'application, pas dans le
 * module**, et pour une raison exécutable (ADR 027).
 *
 * Un module n'a pas le droit d'appeler `fetch` : `eslint.config.ts` refuse tout
 * appel réseau sortant hors d'une porte bornée, parce que
 * `docs/reliability.md` §3 exige un délai d'attente et des reprises maîtrisées.
 * La règle vise des appels **serveur vers un tiers** ; celui-ci va du navigateur
 * vers **notre propre route**. Le composant vit donc ici, comme
 * `app/public-form.tsx` et `app/auth-form.tsx`.
 *
 * **La navigation vers le fournisseur est faite par le script, pas par une
 * redirection de formulaire.** Une réponse 303 vers `checkout.stripe.com` serait
 * soumise à `form-action 'self'` dans les navigateurs fondés sur Chromium et
 * WebKit : il faudrait déclarer deux origines tierces dans `config/security.ts`.
 * Une navigation de premier niveau pilotée par `window.location.assign` n'est
 * bornée par aucune directive livrée. La politique reste `default-src 'self'`
 * sans une seule source tierce — voir `docs/research/s19-subscribe-stripe.md` §7.
 *
 * **`method="post"` en toutes lettres et bouton désactivé jusqu'à
 * l'hydratation**, comme partout : un `<form>` sans `method` est un `GET` vers
 * l'URL courante tant que React n'a pas la main.
 */

interface BillingActionProps {
  /** La route montée du module. Une constante de l'écran, jamais une saisie. */
  readonly action: string
  readonly labelKey: string
  /** L'identifiant d'offre envoyé au serveur. **Le seul champ**, jamais un prix. */
  readonly offerId?: string
  readonly locale: string
  readonly variant?: 'default' | 'outline'
  /**
   * Reprend le focus **une fois le bouton allumé** (s22, ADR 045).
   *
   * Une personne revenue de la connexion avec son offre en poche retrouve son
   * bouton sous le curseur ; l'ouverture du tunnel reste son geste.
   *
   * Pas `autoFocus` : le navigateur applique l'attribut servi à l'analyse du
   * document, où ce bouton est encore **désactivé** jusqu'à l'hydratation — il
   * ne focalise donc rien, et rien ne repose le focus au rallumage. Mesuré à la
   * revue de s22, `document.activeElement` restait `BODY`. Le focus est posé
   * par `useFocusWhenReady`, après l'hydratation, et `pnpm test:e2e` rougit s'il
   * disparaît.
   */
  readonly focusOnReady?: boolean
}

/** Les clés de refus que le serveur peut rendre. Une clé inconnue retombe. */
const REFUSALS = new Set(BILLING_REFUSAL_KEYS)

export function BillingAction({
  action,
  labelKey,
  offerId,
  locale,
  variant = 'default',
  focusOnReady = false,
}: BillingActionProps) {
  const t = useTranslations()
  const hydrated = useHydrated()
  const focus = useFocusWhenReady<HTMLButtonElement>(focusOnReady && hydrated)
  const [pending, setPending] = useState(false)
  const [refusalKey, setRefusalKey] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setPending(true)
    setRefusalKey(null)

    const response = await fetch(action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(offerId === undefined ? {} : { offerId, locale }),
    }).catch(() => null)

    if (response === null) {
      setPending(false)
      setRefusalKey(BILLING_KEYS.refusal.failed)

      return
    }

    const body = (await response.json().catch(() => null)) as
      | { url?: unknown; error?: unknown }
      | null

    if (response.ok && typeof body?.url === 'string') {
      // **La navigation, pas une redirection de formulaire** : voir le
      // commentaire de tête. Le bouton reste en attente, la page part.
      window.location.assign(body.url)

      return
    }

    setPending(false)
    // Une clé du serveur, confrontée à celles que le module déclare : une clé
    // inconnue atteindrait le traducteur, qui lève depuis s09 — donc un écran
    // en 500 sur un refus.
    setRefusalKey(
      typeof body?.error === 'string' && REFUSALS.has(body.error)
        ? body.error
        : BILLING_KEYS.refusal.failed,
    )
  }

  return (
    <form method="post" onSubmit={submit} className="w-full space-y-2">
      {refusalKey === null ? null : (
        <Alert variant="destructive" role="alert">
          {t(refusalKey)}
        </Alert>
      )}

      {/*
        Sans JavaScript, le bouton reste éteint : la soumission passe par
        `fetch`, et l'ADR 027 assume cette exigence. Ce qui n'était décidé nulle
        part, c'est le **silence** — un bouton mort sans un mot (constat F5 de
        la revue de s11). Le `<noscript>` le dit, et il ne coûte ni script en
        ligne ni source de politique de sécurité du contenu.
      */}
      <noscript>
        <Alert variant="warning">{t(BILLING_KEYS.noScript)}</Alert>
      </noscript>

      <Button
        type="submit"
        ref={focus}
        variant={variant}
        disabled={pending || !hydrated}
        className="w-full"
      >
        {t(labelKey)}
      </Button>
    </form>
  )
}
