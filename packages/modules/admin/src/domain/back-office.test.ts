import { describe, expect, it } from 'vitest'

import {
  BACK_OFFICE_PAGE_SIZE,
  MAX_BACK_OFFICE_PAGE,
  pageCountOf,
  pageWindowOf,
  parseBackOfficeQuery,
  parseBackOfficeSubscriptionsQuery,
  subscriptionsExportFileName,
} from './back-office'

/**
 * Les règles pures des listes du back-office (s37b2), éprouvées **sans base et
 * sans écran** : ce sont elles qui décident ce qu'une adresse demande et ce que
 * la base doit lire.
 *
 * Elles sont ici plutôt que dans un écran pour la raison habituelle du dépôt :
 * une frontière lue dans un `.tsx` n'est éprouvable qu'en rendant quelque chose,
 * donc en pratique jamais.
 */

describe('ce qu’une liste de back-office lit de son adresse', () => {
  it('rend la page 1 et aucune recherche quand l’adresse ne porte rien', () => {
    expect(parseBackOfficeQuery({})).toEqual({ search: null, page: 1 })
  })

  it('coupe les blancs de la recherche, et une recherche vide n’en est pas une', () => {
    expect(parseBackOfficeQuery({ q: '  ada@example.test  ' })).toEqual({
      search: 'ada@example.test',
      page: 1,
    })
    expect(parseBackOfficeQuery({ q: '   ' }).search).toBeNull()
  })

  it('refuse une page qui n’est pas un entier servable, sans jamais lever', () => {
    // Le fait qui compte : une adresse forgée rend une **page servable**, jamais
    // une erreur. Un écran de back-office qui tomberait en 500 sur `?page=abc`
    // apprendrait à son visiteur qu'il existe.
    for (const page of ['abc', '0', '-3', '1.5', '', String(MAX_BACK_OFFICE_PAGE + 1)]) {
      expect(parseBackOfficeQuery({ page }), page).toEqual({ search: null, page: 1 })
    }

    expect(parseBackOfficeQuery({ page: '3' }).page).toBe(3)
  })

  it('refuse une recherche démesurée plutôt que de la passer à la base', () => {
    expect(parseBackOfficeQuery({ q: 'a'.repeat(300) }).search).toBeNull()
  })

  it('ne lit qu’une valeur quand le paramètre est répété', () => {
    // Next rend `string[]` sur `?q=a&q=b`. Passer le tableau à la requête
    // paramétrée serait une valeur d'un type que personne n'attend.
    expect(parseBackOfficeQuery({ q: ['ada', 'bob'] }).search).toBe('ada')
    expect(parseBackOfficeQuery({ page: ['2', '5'] }).page).toBe(2)
  })
})

describe('la fenêtre de lecture et le nombre de pages', () => {
  it('lit exactement une page, à l’endroit que la page demande', () => {
    expect(pageWindowOf({ page: 1, pageSize: BACK_OFFICE_PAGE_SIZE })).toEqual({
      limit: BACK_OFFICE_PAGE_SIZE,
      offset: 0,
    })
    expect(pageWindowOf({ page: 3, pageSize: 20 })).toEqual({ limit: 20, offset: 40 })
  })

  it('compte au moins une page, même sans aucun compte', () => {
    // Zéro page n'existe pas : la pagination rendrait une navigation vide et
    // l'état vide n'aurait pas de page courante à nommer.
    expect(pageCountOf({ total: 0, pageSize: 20 })).toBe(1)
    expect(pageCountOf({ total: 20, pageSize: 20 })).toBe(1)
    expect(pageCountOf({ total: 21, pageSize: 20 })).toBe(2)
  })
})

/**
 * **Ce qu'une liste d'inscriptions publiques lit en plus** (s37c) : une source.
 *
 * Elle ne lève pas davantage que la recherche : ce qui n'est pas lisible est
 * remplacé par son défaut — « toutes les sources » — et jamais transmis à la
 * base. Un écran de back-office qui tomberait en 500 sur `?source=<n'importe
 * quoi>` apprendrait à son visiteur qu'il existe.
 *
 * **Aucune liste de sources n'est écrite ici** : le domaine s'arrête à la
 * forme. Quelles sources existent est une question à la base, pas au code —
 * `s42` en ajoutera une, et cet écran n'a pas à le savoir.
 */
describe('la source qu’une liste d’inscriptions lit de son adresse', () => {
  it('reprend ce que la liste commune lit, et n’exige aucune source', () => {
    expect(parseBackOfficeSubscriptionsQuery({})).toEqual({
      source: null,
      search: null,
      page: 1,
    })
    expect(parseBackOfficeSubscriptionsQuery({ q: '  ada@  ', page: '3' })).toEqual({
      source: null,
      search: 'ada@',
      page: 3,
    })
  })

  it('taille la source, et une source vide n’en est pas une', () => {
    expect(parseBackOfficeSubscriptionsQuery({ source: '  newsletter  ' }).source).toBe(
      'newsletter',
    )
    expect(parseBackOfficeSubscriptionsQuery({ source: '   ' }).source).toBeNull()
  })

  it('refuse une source démesurée plutôt que de la passer à la base', () => {
    expect(parseBackOfficeSubscriptionsQuery({ source: 'a'.repeat(300) }).source).toBeNull()
  })

  it('ne lit qu’une valeur quand le paramètre est répété', () => {
    expect(
      parseBackOfficeSubscriptionsQuery({ source: ['newsletter', 'waitlist'] }).source,
    ).toBe('newsletter')
  })
})

/**
 * **Le nom du fichier exporté** (s37c), et ce qu'il ne porte pas.
 *
 * Il **dit la sélection** : un export qui suit le filtre affiché doit se
 * reconnaître une fois sur le disque, à côté de trois autres. Mais il ne porte
 * que la **source** : la recherche est un texte libre reçu de l'adresse, et le
 * nom de fichier part dans un en-tête `content-disposition`. Y coller une
 * valeur arbitraire est une surface d'injection d'en-tête ; la présence d'une
 * recherche est donc marquée, jamais son contenu.
 */
describe('le nom du fichier d’export des inscriptions', () => {
  it('nomme la sélection sans jamais recopier la recherche', () => {
    expect(subscriptionsExportFileName({ source: null, search: null })).toBe(
      'inscriptions.csv',
    )
    expect(subscriptionsExportFileName({ source: 'newsletter', search: null })).toBe(
      'inscriptions-newsletter.csv',
    )
    // La recherche est **signalée**, jamais recopiée.
    const searched = subscriptionsExportFileName({ source: null, search: 'ada@example.test' })

    expect(searched).not.toContain('ada')
    expect(searched).not.toBe('inscriptions.csv')
  })

  it('ne laisse aucun caractère d’en-tête entrer dans le nom', () => {
    // Une source vient de la base, mais elle a été écrite par la configuration
    // d'un autre dépôt : le nom se dérive d'elle, il ne la recopie pas.
    for (const source of [
      'news"letter',
      'news\r\nSet-Cookie: a=b',
      '../../etc/passwd',
      'a'.repeat(200),
      '???',
    ]) {
      const name = subscriptionsExportFileName({ source, search: null })

      expect(name, source).toMatch(/^[a-z0-9-]+\.csv$/)
      expect(name.length, source).toBeLessThanOrEqual(64)
    }
  })
})
