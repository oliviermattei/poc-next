import { describe, expect, it } from 'vitest'

import {
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_ORIGIN_MAX_LENGTH,
  parseFeedbackSubmission,
  parseFeedbackTarget,
  parseOriginPath,
} from './feedback'

/**
 * Les règles pures du module — **la frontière d'entrée d'un retour** (s43).
 *
 * Elles vivent dans le `domain` : aucune requête, aucune table, aucun
 * composant. Deux d'entre elles portent la sécurité de la story :
 *
 * 1. **l'URL d'origine est une donnée fournie par le client** (tâche 2). Elle
 *    arrive d'un champ caché que n'importe qui réécrit : elle se valide, elle
 *    se borne, et rien de ce qui n'est pas un chemin interne n'entre en base ;
 * 2. **la catégorie appartient à un vocabulaire fermé.** Un texte libre y
 *    ferait du filtre du back-office une liste ouverte pilotée par l'appelant.
 */

describe('parseOriginPath', () => {
  it('garde un chemin interne, sa chaîne de requête comprise', () => {
    expect(parseOriginPath('/app/settings?tab=security')).toBe('/app/settings?tab=security')
  })

  it('refuse un schéma exécutable — c’est un `href` d’écran d’administration', () => {
    expect(parseOriginPath('javascript:alert(1)')).toBeNull()
  })

  it('refuse une adresse protocole-relative, qui sort du site sans l’annoncer', () => {
    expect(parseOriginPath('//exemple-hostile.test/piege')).toBeNull()
  })

  it('refuse une adresse absolue : le module ne sait pas quelle origine est la sienne', () => {
    expect(parseOriginPath('https://exemple-hostile.test/piege')).toBeNull()
  })

  it('refuse ce qui ne commence pas par une barre oblique', () => {
    expect(parseOriginPath('app/settings')).toBeNull()
  })

  it('refuse au-delà de la borne plutôt que de tronquer en silence', () => {
    const long = `/${'a'.repeat(FEEDBACK_ORIGIN_MAX_LENGTH)}`

    expect(long.length).toBeGreaterThan(FEEDBACK_ORIGIN_MAX_LENGTH)
    expect(parseOriginPath(long)).toBeNull()
  })

  it('rend null pour une absence, sans inventer de valeur', () => {
    expect(parseOriginPath(undefined)).toBeNull()
    expect(parseOriginPath('')).toBeNull()
    expect(parseOriginPath(42)).toBeNull()
  })
})

describe('parseFeedbackSubmission', () => {
  it('accepte une soumission complète et taille le message', () => {
    const parsed = parseFeedbackSubmission({
      category: 'bug',
      message: '  Le bouton ne répond pas.  ',
      origin: '/app/settings',
    })

    expect(parsed).toEqual({
      ok: true,
      value: { category: 'bug', message: 'Le bouton ne répond pas.', originPath: '/app/settings' },
    })
  })

  it('refuse une catégorie hors du vocabulaire déclaré, en nommant le champ', () => {
    const parsed = parseFeedbackSubmission({ category: 'facture', message: 'Bonjour' })

    expect(parsed).toEqual({ ok: false, field: 'category' })
  })

  it('refuse un message vide, en nommant le champ', () => {
    expect(parseFeedbackSubmission({ category: 'idea', message: '   ' })).toEqual({
      ok: false,
      field: 'message',
    })
  })

  it('refuse un message au-delà de la borne', () => {
    expect(
      parseFeedbackSubmission({
        category: 'idea',
        message: 'a'.repeat(FEEDBACK_MESSAGE_MAX_LENGTH + 1),
      }),
    ).toEqual({ ok: false, field: 'message' })
  })

  it('accepte sans origine : une origine illisible n’empêche pas d’envoyer un retour', () => {
    const parsed = parseFeedbackSubmission({
      category: 'other',
      message: 'Merci',
      origin: 'https://exemple-hostile.test/piege',
    })

    expect(parsed).toEqual({
      ok: true,
      value: { category: 'other', message: 'Merci', originPath: null },
    })
  })
})

describe('parseFeedbackTarget', () => {
  it('lit l’identifiant posté par l’écran d’administration', () => {
    expect(parseFeedbackTarget({ id: 'fbk_1' })).toEqual({ id: 'fbk_1' })
  })

  it('refuse un corps sans identifiant', () => {
    expect(parseFeedbackTarget({})).toBeNull()
    expect(parseFeedbackTarget(null)).toBeNull()
  })
})
