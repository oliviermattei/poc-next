import { describe, expect, it } from 'vitest'

import { BILLING_KEYS } from './message-keys'
import { BillingConfigError, parseBillingCatalogue, type BillingCatalogue } from './offer'
import { highlightedOfferId, periodicityKeyOf, selectedOfferOf } from './pricing'

/**
 * Les deux règles que la page de tarifs demande au domaine (s22), et rien
 * d'autre : ce qui se prouve ici ne sera pas rejoué à l'écran.
 *
 * Elles sont pures — ni base, ni rendu, ni traducteur — et c'est ce qui les
 * rend prouvables ainsi. La composition (quelle carte reçoit quelle variante,
 * quel prix s'affiche) est mesurée une fois, sur la page, dans
 * `tests/billing.test.ts`.
 */

const offer = (
  id: string,
  mode: 'subscription' | 'one_time',
  interval: 'month' | 'year' | null,
): unknown => ({
  id,
  mode,
  priceId: `price_${id.replaceAll('-', '_')}`,
  amount: 1000,
  currency: 'eur',
  interval,
  trialDays: null,
  perSeat: false,
})

const catalogueOf = (...offers: readonly unknown[]): BillingCatalogue =>
  parseBillingCatalogue([...offers])

describe('l’offre mise en avant', () => {
  it('est la dernière offre d’abonnement du catalogue', () => {
    // Rien dans `config/billing.ts` ne déclare qu'une offre est recommandée, et
    // le plan refuse d'y ajouter un champ : la mise en avant est **dérivée**.
    const catalogue = catalogueOf(
      offer('pro-monthly', 'subscription', 'month'),
      offer('pro-yearly', 'subscription', 'year'),
      offer('lifetime', 'one_time', null),
    )

    expect(highlightedOfferId(catalogue)).toBe('pro-yearly')
  })

  it('n’en désigne aucune quand le catalogue ne vend pas d’abonnement', () => {
    // Le témoin de refus : un produit qui ne vend qu'à l'unité n'a pas d'offre
    // « recommandée », et une carte mise en avant par défaut mentirait.
    expect(highlightedOfferId(catalogueOf(offer('lifetime', 'one_time', null)))).toBeNull()
    expect(highlightedOfferId(catalogueOf())).toBeNull()
  })

  it('n’en désigne qu’une, quel que soit le nombre d’offres', () => {
    const catalogue = catalogueOf(
      offer('pro-monthly', 'subscription', 'month'),
      offer('pro-yearly', 'subscription', 'year'),
      offer('team-monthly', 'subscription', 'month'),
    )

    expect(catalogue.filter((candidate) => candidate.id === highlightedOfferId(catalogue))).toHaveLength(
      1,
    )
  })
})

describe('la périodicité affichée d’une offre', () => {
  it('nomme le mois, l’année et le paiement unique', () => {
    // **Aucune division mensuelle pour l'annuel** : afficher « 24,17 €/mois »
    // pour un prélèvement de 290 € une fois par an est une affirmation que rien
    // ne valide. Le plan a tranché, et cette table est la trace de la décision.
    expect(periodicityKeyOf({ mode: 'subscription', interval: 'month' })).toBe(
      BILLING_KEYS.pricing.perMonth,
    )
    expect(periodicityKeyOf({ mode: 'subscription', interval: 'year' })).toBe(
      BILLING_KEYS.pricing.perYear,
    )
    expect(periodicityKeyOf({ mode: 'one_time', interval: null })).toBe(
      BILLING_KEYS.pricing.oneTime,
    )
  })

  it('refuse une offre dont le mode et la périodicité se contredisent', () => {
    // Les deux formes que `parseBillingCatalogue` refuse déjà au démarrage. Les
    // refuser ici aussi n'est pas une redondance : cette fonction est appelable
    // sur autre chose qu'une offre du catalogue, et rendre « par mois » sur un
    // achat unique annoncerait un renouvellement qui n'aura pas lieu.
    expect(() => periodicityKeyOf({ mode: 'one_time', interval: 'month' })).toThrow(
      BillingConfigError,
    )
    expect(() => periodicityKeyOf({ mode: 'subscription', interval: null })).toThrow(
      BillingConfigError,
    )
  })
})

describe('l’offre reposée par « ?offer= »', () => {
  const catalogue = catalogueOf(
    offer('pro-monthly', 'subscription', 'month'),
    offer('lifetime', 'one_time', null),
  )

  it('rend l’identifiant quand le catalogue le connaît', () => {
    expect(selectedOfferOf('pro-monthly', catalogue)).toBe('pro-monthly')
    expect(selectedOfferOf('lifetime', catalogue)).toBe('lifetime')
  })

  it('ignore un identifiant que le catalogue ne connaît pas', () => {
    // **Le site du défaut** : lire `?offer=` sans le confronter au catalogue
    // (ADR 045, `docs/security.md` §4). Zod borne la forme, le catalogue borne
    // les valeurs — sans la seconde moitié, une chaîne arbitraire de l'URL
    // ressortirait comme une offre du produit.
    expect(selectedOfferOf('inconnu', catalogue)).toBeNull()
    expect(selectedOfferOf('../secret', catalogue)).toBeNull()
    expect(selectedOfferOf('<img src=x onerror=alert(1)>', catalogue)).toBeNull()
    expect(selectedOfferOf('pro-monthly', catalogueOf())).toBeNull()
  })

  it('ignore une forme que la page n’attend pas', () => {
    // Absente, vide, répétée (`?offer=a&offer=b` arrive en tableau), ou plus
    // longue que tout identifiant d'offre : ignorée sans erreur — c'est une
    // préférence d'affichage, pas une ressource.
    expect(selectedOfferOf(undefined, catalogue)).toBeNull()
    expect(selectedOfferOf('', catalogue)).toBeNull()
    expect(selectedOfferOf(['pro-monthly', 'lifetime'], catalogue)).toBeNull()
    expect(selectedOfferOf('x'.repeat(65), catalogue)).toBeNull()
  })
})
