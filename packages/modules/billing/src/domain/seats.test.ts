import { describe, expect, it } from 'vitest'

import { billableSeats, exceedsSeatLimit, offerSeatLimit, offerSyncsSeats } from './seats'

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

/* -------------------------------------------------------------------------- *
 * s47 — **le plafond de membres d'une offre**, la troisième règle du fichier.
 *
 * Voisine des deux précédentes, et **indépendante** d'elles : c'est tout
 * l'enjeu du bloc. `offerSyncsSeats` exclut l'achat unique et le forfait parce
 * qu'ils n'ont aucune quantité à corriger ; un plafond, lui, se vend
 * précisément au forfait — « jusqu'à cinq membres », prix fixe. Recopier la
 * condition de l'une dans l'autre est le premier piège nommé par la recherche.
 * -------------------------------------------------------------------------- */

describe('le plafond de membres que porte une offre', () => {
  it('rend le plafond déclaré', () => {
    expect(offerSeatLimit({ seatLimit: 5 })).toBe(5)
  })

  /**
   * **Une offre sans plafond reste illimitée** (critère 1), et les deux façons
   * de ne pas en déclarer un se valent : le champ est facultatif, un catalogue
   * écrit avant s47 l'omet, un catalogue qui le pose explicitement à `null`
   * dit la même chose.
   */
  it('rend « aucun plafond » quand l’offre n’en déclare pas', () => {
    expect(offerSeatLimit({})).toBeNull()
    expect(offerSeatLimit({ seatLimit: null })).toBeNull()
  })
})

describe('cet effectif dépasse-t-il ce plafond', () => {
  it('accepte un effectif sous le plafond', () => {
    expect(exceedsSeatLimit(4, 5)).toBe(false)
  })

  /**
   * **À égalité, on accepte.** Le nombre transmis est l'effectif *après*
   * l'écriture : un plafond de cinq doit laisser passer le cinquième membre, et
   * refuser le sixième. Une inégalité large ici plafonnerait l'offre à quatre.
   */
  it('accepte un effectif égal au plafond', () => {
    expect(exceedsSeatLimit(5, 5)).toBe(false)
  })

  it('refuse un effectif au-dessus du plafond', () => {
    expect(exceedsSeatLimit(6, 5)).toBe(true)
  })

  /**
   * **Le plafond abaissé sous l'effectif** (critère 4) : la règle refuse, et
   * elle ne fait que cela. Personne n'est retiré — aucune de ces fonctions ne
   * rend une liste de membres à expulser, et c'est structurel.
   */
  it('refuse un effectif largement au-dessus d’un plafond abaissé', () => {
    expect(exceedsSeatLimit(12, 3)).toBe(true)
  })

  it('n’oppose aucun plafond à une offre illimitée', () => {
    expect(exceedsSeatLimit(4_000, null)).toBe(false)
  })
})
