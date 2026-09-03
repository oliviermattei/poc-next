import { describe, expect, it } from 'vitest'

import { billableSeats, offerSyncsSeats } from './seats'

/**
 * Les deux règles pures de la facturation au siège (s23).
 *
 * Elles sont ici, et pas au point de composition, parce que ce sont des
 * décisions : *quelles offres suivent le nombre de membres*, et *quelle lecture
 * de membres autorise une écriture chez le fournisseur*. La seconde est celle
 * qui peut faire baisser une facture à tort, et c'est pour cela qu'elle est une
 * fonction plutôt qu'un `if` perdu dans une boucle de réconciliation.
 */

describe('quelles offres suivent le nombre de membres', () => {
  const offer = (perSeat: boolean, mode: 'subscription' | 'one_time') => ({ perSeat, mode })

  it('ne synchronise qu’une offre d’abonnement facturée au siège', () => {
    expect(offerSyncsSeats(offer(true, 'subscription'))).toBe(true)
  })

  it('ne synchronise pas un abonnement au forfait', () => {
    expect(offerSyncsSeats(offer(false, 'subscription'))).toBe(false)
  })

  /**
   * **Le cas que le catalogue n'interdit pas** (question ouverte de la
   * recherche) : `perSeat` est un booléen indépendant du mode, si bien qu'un
   * achat unique peut être déclaré au siège. Il n'a pas d'abonnement à
   * corriger — il n'y a rien à synchroniser, et cette règle le tranche sans
   * qu'un champ neuf apparaisse dans `config/billing.ts`.
   */
  it('ne synchronise pas un achat unique, même déclaré au siège', () => {
    expect(offerSyncsSeats(offer(true, 'one_time'))).toBe(false)
  })

  it('ne synchronise pas un achat unique au forfait', () => {
    expect(offerSyncsSeats(offer(false, 'one_time'))).toBe(false)
  })
})

describe('quelle lecture de membres autorise une écriture', () => {
  it('facture le nombre de membres lu', () => {
    expect(billableSeats(4)).toBe(4)
  })

  /**
   * **Le défaut de facturation silencieux que la recherche redoute.**
   *
   * Une lecture qui n'a rien rendu — base en cours de migration, module
   * `organizations` coupé, périmètre compte — n'est pas « zéro membre ». La
   * traiter comme un nombre ferait *baisser* une facture sur un silence.
   */
  it('n’autorise aucune écriture sur une lecture inconnue', () => {
    expect(billableSeats(null)).toBeNull()
  })

  it('n’autorise aucune écriture sur une organisation sans membre', () => {
    // Une organisation à demi supprimée en cours de lecture rendrait zéro. Il
    // n'existe pas d'organisation à zéro membre : c'est une lecture partielle,
    // pas un état.
    expect(billableSeats(0)).toBeNull()
    expect(billableSeats(-1)).toBeNull()
  })
})
