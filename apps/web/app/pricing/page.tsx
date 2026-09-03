import {
  BILLING_KEYS,
  billingRoutePath,
  formatOfferPrice,
  highlightedOfferId,
  selectedOfferOf,
} from '@repo/module-billing'
import { PricingTable } from '@repo/module-billing/presentation'
import { Alert } from '@repo/ui'
import { notFound } from 'next/navigation'
import { z } from 'zod'

import { BillingAction } from '../billing-actions'
import { billing } from '../../lib/billing'
import { billingCatalogue } from '../../lib/billing-catalogue'
import { currentViewer } from '../../lib/auth'
import { appIntl } from '../../lib/i18n'

/**
 * La page **publique** de tarifs (s22).
 *
 * Un seul refus, et il ne nomme aucun module :
 *
 * | Qui | Ce qu'il obtient |
 * |---|---|
 * | le produit ne vend rien | **404** — l'écran n'existe pas |
 * | tout le monde d'autre | les offres, et un chemin vers l'achat |
 *
 * Contrairement à `/billing`, elle **ne redirige pas** un visiteur anonyme :
 * comparer des offres ne demande aucun compte, et masquer une offre payante
 * empêche de la vendre. Elle lit `billingCatalogue()` — le catalogue validé au
 * démarrage — et jamais `billing.view()`, qui exige une session.
 *
 * **Aucun effet de bord, dans aucun état.** Elle rend du HTML ; la seule
 * écriture possible est déclenchée par un clic, jamais par une URL (ADR 045).
 * C'est ce qui rend un lien forgé inoffensif : `…/pricing?offer=lifetime` envoyé
 * à quelqu'un de connecté repose son choix, il ne crée aucune session de
 * paiement à son nom.
 *
 * L'offre reposée est validée par `selectedOfferOf` (`domain/pricing.ts`) : Zod
 * borne la forme, le catalogue borne les valeurs (`docs/security.md` §4). La
 * règle vit dans le domaine et non ici parce que c'est là qu'elle se prouve —
 * neutralisée dans cet écran, la confrontation au catalogue ne changeait aucun
 * rendu et la suite entière restait verte.
 */
/**
 * **Le retour d'un paiement invité, validé** (s24, critère 7,
 * `docs/security.md` §4).
 *
 * Il n'accorde **rien** et n'ouvre **aucune session** : ni depuis ce paramètre,
 * ni depuis un identifiant de session de paiement, qui n'est d'ailleurs pas
 * accepté ici. Cet écran ne lit pas la base et ne pose aucun cookie — c'est la
 * discipline que s19 a posée pour `/billing` (« un `?checkout=success` forgé
 * n'affiche qu'un bandeau »), et la voici sur le seul écran qu'un visiteur
 * anonyme peut atteindre au retour.
 *
 * Ce que l'état réel devient : il est écrit par le **webhook**, dans la base,
 * et il s'affiche sur `/billing` une fois la personne connectée par le lien
 * reçu — jamais ici, où il n'y a personne à qui l'attribuer.
 */
const CHECKOUT_RETURN = z.enum(['success', 'cancelled'])

const returnOutcomeOf = (value: string | string[] | undefined): 'success' | 'cancelled' | null => {
  const parsed = CHECKOUT_RETURN.safeParse(value)

  return parsed.success ? parsed.data : null
}

export default async function PricingPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!billing.available) {
    notFound()
  }

  const catalogue = billingCatalogue()
  const { session } = await currentViewer()
  const { t, locale } = await appIntl()
  const parameters = (await searchParams) ?? {}
  const selectedOfferId = selectedOfferOf(parameters['offer'], catalogue)
  const highlighted = highlightedOfferId(catalogue)
  const returned = returnOutcomeOf(parameters['checkout'])
  // Décidé **hors du JSX** : un littéral choisi par un ternaire dans un nœud
  // rendu est exactement la forme que le balayage de textes en dur de
  // `tests/i18n.test.ts` existe pour attraper, et il a raison de s'en méfier.
  const paid = returned === 'success'

  const table = (
    <PricingTable
      offers={catalogue.map((offer) => ({
        id: offer.id,
        mode: offer.mode,
        interval: offer.interval,
        trialDays: offer.trialDays,
        // **Le prix affiché vient de l'offre du catalogue**, et c'est la même
        // offre dont l'identifiant part au checkout. Le second critère de la
        // story compare les deux, et il rougit si une seconde source de prix
        // apparaît ici.
        price: formatOfferPrice(offer, locale),
      }))}
      intl={{ t }}
      highlightedOfferId={highlighted}
      selectedOfferId={selectedOfferId}
      // **Faux depuis s24** : les deux branches portent désormais le
      // déclencheur de l'application, qui affiche déjà son propre `<noscript>`
      // sous chaque bouton éteint. Le répéter en tête n'en dirait pas
      // davantage.
      noScriptNotice={false}
      actions={Object.fromEntries(
        catalogue.map((offer) => {
          // **« Acheter » pour une offre unique**, jamais « Souscrire » : le
          // libellé vient du mode déclaré au catalogue, et annoncer un
          // renouvellement qui n'aura pas lieu serait un mensonge de vente.
          const labelKey =
            offer.mode === 'one_time' ? BILLING_KEYS.purchase : BILLING_KEYS.subscribe
          const variant = offer.id === highlighted ? 'default' : 'outline'
          // ADR 045 : l'offre reposée reprend le focus. Elle ne s'achète pas
          // toute seule — le geste reste celui de la personne.
          //
          // **Deux mécanismes, parce que les deux branches n'ont pas le même
          // problème.** Le lien est focalisable dès le document servi :
          // l'attribut `autofocus` que React y rend est appliqué par le
          // navigateur à l'analyse. Le bouton, lui, est désactivé jusqu'à
          // l'hydratation, donc le même attribut ne focalise rien — il pose son
          // focus lui-même une fois allumé (`use-focus-when-ready.ts`). Les deux
          // sont mesurés par `pnpm test:e2e` (« rend le focus au bouton de
          // l'offre reposée »), sur Chromium.
          const resumed = offer.id === selectedOfferId

          return [
            offer.id,
            // **Le même déclencheur dans les deux états, deux routes**
            // (s24, critère 1). Sans session, il vise la route **publique** de
            // checkout invité : le visiteur paie sans créer de compte d'abord,
            // et son compte est créé par le webhook, jamais ici. Avec une
            // session, il vise la route `authenticated`, qui garde sa garde —
            // s24 n'a pas assoupli `openCheckout`, elle lui a donné une
            // voisine.
            //
            // Le corps est identique dans les deux cas : un identifiant
            // d'offre, une langue, et rien d'autre. Jamais un prix, jamais un
            // périmètre, jamais une adresse.
            <BillingAction
              key={offer.id}
              action={billingRoutePath(session === null ? 'guestCheckout' : 'checkout')}
              focusOnReady={resumed}
              labelKey={labelKey}
              offerId={offer.id}
              locale={locale}
              variant={variant}
            />,
          ]
        }),
      )}
    />
  )

  if (returned === null) {
    return table
  }

  return (
    <div className="space-y-8">
      {/*
        **Un bandeau, et rien d'autre.** Il ne lit pas la base, ne pose aucun
        cookie et n'ouvre aucune session : forgé, il ne fait qu'afficher ce
        texte. Ce qui fait foi est écrit par le webhook, et se lit sur
        `/billing` une fois la personne connectée par le lien reçu.
      */}
      <Alert variant={paid ? 'info' : 'warning'} role="status">
        {t(paid ? BILLING_KEYS.pricing.returnSuccess : BILLING_KEYS.pricing.returnCancelled)}
      </Alert>
      {table}
    </div>
  )
}
