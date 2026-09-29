import { BILLING_KEYS, billingRoutePath, selectedOfferOf } from '@repo/module-billing'
import { BillingScreen } from '@repo/module-billing/presentation'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'

import { BillingAction } from '../../../../billing-actions'
import { currentViewer } from '../../../../../lib/auth'
import { billing, BILLING_SCREEN_PATH } from '../../../../../lib/billing'
import { billingCatalogue } from '../../../../../lib/billing-catalogue'
import { appIntl } from '../../../../../lib/i18n'

/**
 * L'écran de facturation.
 *
 * Trois refus, dans cet ordre, et aucun ne nomme un module :
 *
 * | Qui | Ce qu'il obtient |
 * |---|---|
 * | le produit ne vend rien | **404** — l'écran n'existe pas |
 * | un visiteur anonyme | redirection vers la connexion, avec son retour |
 * | un compte | son écran, et **seulement son** périmètre |
 *
 * Le premier se départage sur `billing.available`, c'est-à-dire sur une
 * **donnée** rendue par le point de composition — la même discipline que
 * `/organizations`.
 *
 * L'écran est protégé **côté serveur** : sans session il redirige, et la vue
 * qu'il lit est celle du périmètre de cette session-là, jamais d'un identifiant
 * reçu en paramètre (`docs/security.md` §3).
 */

/**
 * Le retour de paiement, **validé** (`docs/security.md` §4).
 *
 * Il n'accorde **aucun** droit : l'état affiché vient de la base, écrite par le
 * webhook. Un `?checkout=success` forgé n'affiche qu'un bandeau.
 */
const CHECKOUT_OUTCOME = z.enum(['success', 'cancelled'])

const outcomeOf = (value: string | string[] | undefined): 'success' | 'cancelled' | null => {
  const parsed = CHECKOUT_OUTCOME.safeParse(value)

  return parsed.success ? parsed.data : null
}

export default async function BillingPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!billing.available) {
    notFound()
  }

  const { session } = await currentViewer()
  const { t, path, locale } = await appIntl()
  const parameters = (await searchParams) ?? {}
  // **L'offre choisie ailleurs, reposée ici** (s64b2, ADR 045) : depuis le lien
  // « Déjà client ? » du site, ou au retour de la connexion. Validée contre le
  // catalogue par la règle du domaine — jamais interpolée telle que reçue. Elle
  // ne fait que rendre le focus à son bouton : l'achat reste un geste.
  const selectedOfferId = selectedOfferOf(parameters['offer'], billingCatalogue())

  if (session === null) {
    // Le retour garde l'offre : sans elle, la personne venue du site pour
    // acheter retrouverait un écran où rien ne dit ce qu'elle avait choisi.
    const back =
      selectedOfferId === null
        ? BILLING_SCREEN_PATH
        : `${BILLING_SCREEN_PATH}?offer=${encodeURIComponent(selectedOfferId)}`

    redirect(`${path('/sign-in')}?next=${encodeURIComponent(back)}`)
  }

  const view = await billing.view(session, locale)

  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeZone: 'UTC',
  })

  return (
    <BillingScreen
      view={view}
      intl={{ t, formatDate: (date) => dateFormatter.format(date) }}
      manageAction={
        <BillingAction
          action={billingRoutePath('portal')}
          labelKey={BILLING_KEYS.manage}
          locale={locale}
          variant="outline"
        />
      }
      subscribeActions={Object.fromEntries(
        view.offers.map((offer) => [
          offer.id,
          <BillingAction
            key={offer.id}
            action={billingRoutePath('checkout')}
            // **« Acheter » pour une offre unique** : le libellé vient du mode
            // résolu par le serveur, jamais d'une supposition de l'écran. Dire
            // « Souscrire » sur un paiement unique annoncerait un
            // renouvellement qui n'aura pas lieu.
            labelKey={offer.mode === 'one_time' ? BILLING_KEYS.purchase : BILLING_KEYS.subscribe}
            offerId={offer.id}
            locale={locale}
            focusOnReady={offer.id === selectedOfferId}
          />,
        ]),
      )}
      checkoutOutcome={outcomeOf(parameters['checkout'])}
    />
  )
}
