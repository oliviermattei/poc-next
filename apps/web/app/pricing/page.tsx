import {
  BILLING_KEYS,
  PRICING_SCREEN_PATH,
  billingRoutePath,
  formatOfferPrice,
  highlightedOfferId,
  selectedOfferOf,
} from '@repo/module-billing'
import { PricingTable } from '@repo/module-billing/presentation'
import { Button } from '@repo/ui'
import Link from 'next/link'
import { notFound } from 'next/navigation'

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
  const { t, locale, path } = await appIntl()
  const parameters = (await searchParams) ?? {}
  const selectedOfferId = selectedOfferOf(parameters['offer'], catalogue)
  const highlighted = highlightedOfferId(catalogue)

  return (
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
      // Sans session, les déclencheurs sont des liens : rien ne dit encore que
      // le tunnel exigera JavaScript, et l'écran le dit. Avec une session, le
      // déclencheur de l'application le dit déjà sous chaque bouton éteint.
      noScriptNotice={session === null}
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
          // Le retour, écrit **sur une ligne** : le balayage de textes en dur
          // de `tests/i18n.test.ts` lit un gabarit coupé en deux comme une
          // chaîne affichée, et il a raison de se méfier des gabarits.
          const back = `${PRICING_SCREEN_PATH}?offer=${offer.id}`
          const signInHref = `${path('/sign-in')}?next=${encodeURIComponent(back)}`

          return [
            offer.id,
            session === null ? (
              <Button key={offer.id} asChild className="w-full" variant={variant}>
                {/*
                  **Sans session, un lien — pas un formulaire.** La route de
                  checkout est `authenticated` : un déclencheur monté ici
                  partirait vers un 403, bruit inutile et signal trompeur. Le
                  retour est un chemin **interne**, mis dans la forme publique
                  de la locale par l'écran de connexion, une seule fois.
                */}
                <Link autoFocus={resumed} href={signInHref}>
                  {t(labelKey)}
                </Link>
              </Button>
            ) : (
              // Avec une session, le **déclencheur de l'application** : il porte
              // déjà l'état d'attente, le `<noscript>` et la désactivation
              // avant hydratation, et il n'envoie qu'un identifiant d'offre.
              <BillingAction
                key={offer.id}
                action={billingRoutePath('checkout')}
                focusOnReady={resumed}
                labelKey={labelKey}
                offerId={offer.id}
                locale={locale}
                variant={variant}
              />
            ),
          ]
        }),
      )}
    />
  )
}
